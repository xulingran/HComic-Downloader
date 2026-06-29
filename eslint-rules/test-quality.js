/**
 * 本地自定义 ESLint 规则：测试质量闸门
 *
 * 实现 openspec/changes/test-discipline-gate 的 test-quality-gate 规范。
 * 把 test-discipline 的判断标准从被动文档转为主动门控。
 *
 * 两条规则：
 *   1. no-bare-mock-assertion —— 拦截"仅断言 mock 被调用、不同时验证真实行为"的用例
 *   2. no-pure-store-crud-roundtrip —— 拦截 store 测试中"setX(v) + getState().x === v"的纯 CRUD 往返
 *
 * 判定准则（与 test-discipline "mock 替换测试"一致）：
 * 若把被 mock 的对象替换为真实实现后断言仍必然成立，则该断言为同义反复。
 *
 * ESLint flat config 用 plugins: { 'test-quality': {...} } 注册，
 * 规则级别在 eslint.config.js 中先设为 'warn'（Phase 2a），Phase 1 合并后转 'error'（Phase 2b）。
 *
 * @type {import('eslint').ESLint.Plugin}
 */

/**
 * 判断一个 AST 节点是否为"真实行为断言"（承载项目代码信号）。
 * 真实行为断言形态：
 *   - expect(...).toEqual/toBe/toMatch/... （非 toHaveBeenCalled* 家族）
 *   - expect(await fn()).resolves / .rejects.toThrow
 *   - expect(x).toHaveBeenCalledWith(transformedArg) —— 参数本身承载信号
 *   - await expect(...).rejects.toThrow
 *
 * 非真实断言（仅 mock 调用计数）：
 *   - expect(mock).toHaveBeenCalled()
 *   - expect(mock).toHaveBeenCalledTimes(n)
 *
 * @param {import('estree').Node} node - CallExpression 节点（应为 expect(...) 调用）
 * @returns {boolean} 是否为真实行为断言
 */
function isRealBehaviorAssertion(node) {
  // expect(...) 调用返回 MemberExpression（.method）再调用
  // 结构：CallExpression(callee=MemberExpression(object=CallExpression(expect), property=matcher))
  // 我们在这里检查外层 matcher 是否属于"真实行为"家族。
  // 注意：本函数预期被传入 expect(...) 的返回值的 .matcher 调用节点。
  if (!node) return false
  // node 是 expect(x).matcher() 整体 CallExpression
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression') return false
  const matcher = callee.property
  if (!matcher || matcher.type !== 'Identifier') return false
  const name = matcher.name

  // toHaveBeenCalledWith(transformedArg) —— 参数承载信号，放行（即使伴随 mock）
  // 但 toHaveBeenCalled() / toHaveBeenCalledTimes(n) 不放行（纯计数）
  if (name === 'toHaveBeenCalledWith') return true

  // 纯 mock 计数断言 —— 非真实行为
  const bareMockMatchers = new Set([
    'toHaveBeenCalled',
    'toHaveBeenCalledTimes',
    'toHaveBeenCalledBefore',
    'toHaveBeenCalledAfter',
    'toHaveBeenCalledWith', // 已在上方放行，此处保留仅为文档完整
  ])
  bareMockMatchers.delete('toHaveBeenCalledWith') // 已放行

  if (bareMockMatchers.has(name)) return false

  // 其余 matcher（toBe/toEqual/toMatch/toContain/toBeNull/toThrow/...）均为真实行为断言
  return true
}

/**
 * 遍历一个节点的所有后代 CallExpression。
 * @param {import('estree').Node} node
 * @param {(callNode: import('estree').CallExpression) => void} visit
 */
function walkCallExpressions(node, visit) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'CallExpression') visit(node)
  for (const key of Object.keys(node)) {
    // 跳过元字段
    if (key === 'type' || key === 'start' || key === 'end' || key === 'range' || key === 'loc' || key === 'parent') continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && typeof c.type === 'string') walkCallExpressions(c, visit)
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      walkCallExpressions(child, visit)
    }
  }
}

/**
 * 判断 CallExpression 是否为 expect(x).matcher(...) 形态，并返回该整体调用。
 * @param {import('estree').CallExpression} callNode
 * @returns {boolean}
 */
function isExpectCall(callNode) {
  const callee = callNode.callee
  if (!callee) return false
  // expect(x).matcher() —— callee 是 MemberExpression，其 object 是 CallExpression(expect)
  if (callee.type === 'MemberExpression') {
    const obj = callee.object
    if (obj && obj.type === 'CallExpression' && obj.callee && obj.callee.type === 'Identifier' && obj.callee.name === 'expect') {
      return true
    }
  }
  // await expect(x).resolves/rejects.matcher() —— callee.object 可能是 MemberExpression(.resolves)
  // 其 object 是 CallExpression(expect)
  if (callee.type === 'MemberExpression' && callee.object && callee.object.type === 'MemberExpression') {
    const inner = callee.object.object
    if (inner && inner.type === 'CallExpression' && inner.callee && inner.callee.type === 'Identifier' && inner.callee.name === 'expect') {
      return true
    }
  }
  return false
}

/**
 * 判断一个 expect(x)[.not].matcher(args) 整体调用节点的"信号类别"。
 *
 * 用于 no-bare-mock-assertion 规则的精炼判定（cleanup-test-quality-backlog Phase A）。
 * 区分"裸调用"（无信号，拦截）与"断言性次数/否定断言"（承载信号，放行）。
 *
 * @param {import('estree').CallExpression} callNode - expect(x).matcher(args) 整体调用
 * @returns {'real' | 'mockOnly' | null} 'real' = 承载真实信号；'mockOnly' = 裸调用无信号；null = 非 mock 调用断言
 */
function classifyExpectAssertion(callNode) {
  const callee = callNode.callee
  if (!callee || callee.type !== 'MemberExpression') return null
  const matcher = callee.property
  if (!matcher || matcher.type !== 'Identifier') return null
  const name = matcher.name

  // 检测 .not 修饰：expect(x).not.matcher() —— callee.object 是 MemberExpression(.not)
  // 否定断言承载"未触发"信号（cancel/守卫/短路），一律放行
  const hasNotModifier =
    callee.object && callee.object.type === 'MemberExpression' && callee.object.property &&
    callee.object.property.type === 'Identifier' && callee.object.property.name === 'not'

  // toHaveBeenCalledWith(transformedArg) —— 参数承载信号，放行（既有行为，保留）
  if (name === 'toHaveBeenCalledWith') return 'real'

  // 否定 mock 调用断言：not.toHaveBeenCalled() / not.toHaveBeenCalledTimes(n) —— 放行
  if (hasNotModifier && (name === 'toHaveBeenCalled' || name === 'toHaveBeenCalledTimes')) {
    return 'real'
  }

  // toHaveBeenCalledTimes(<字面量>) —— 断言性次数（"触发 N 次"），承载信号，放行
  // toHaveBeenCalledTimes(<非字面量>) —— 如 expect.any(Number) / 变量，等价"被调用过"，拦截
  if (name === 'toHaveBeenCalledTimes') {
    const arg = callNode.arguments && callNode.arguments[0]
    if (arg && arg.type === 'Literal') {
      return 'real' // 字面量次数承载确定的"触发 N 次"信号
    }
    return 'mockOnly' // 非字面量次数（expect.any / 变量）无确定信号
  }

  // 裸调用断言家族：toHaveBeenCalled / toHaveBeenCalledBefore / toHaveBeenCalledAfter
  // （无参，仅"被调用过"），拦截
  const bareMock = new Set(['toHaveBeenCalled', 'toHaveBeenCalledBefore', 'toHaveBeenCalledAfter'])
  if (bareMock.has(name)) return 'mockOnly'

  // 其余 expect matcher（toBe/toEqual/toMatch/toContain/toThrow/...）均为真实行为断言
  return null
}

/** @type {Record<string, import('eslint').Rule.RuleModule>} */
const rules = {
  'no-bare-mock-assertion': {
    meta: {
      type: 'problem',
      docs: {
        description: '禁止仅断言 mock 被调用而不同时验证真实行为的测试用例（test-discipline 同义反复防护）',
      },
      schema: [],
      messages: {
        bare: '此 it/test 块仅含 mock 调用断言（{{matcher}}），缺少返回值/状态/抛错的真实行为断言。mock 替换测试：把 mock 换成真实实现，此断言仍必然成立。请补充行为断言或删除该 mock 调用断言。',
      },
    },
    create(context) {
      // 收集每个 it/test 块内的断言形态，在块结束时判定
      // 用栈处理嵌套（describe 内 it）
      /** @type {Array<{hasMockOnly: boolean, mockMatchers: string[], hasReal: boolean, mockCallNodes: import('estree').CallExpression[]}>} */
      const stack = []

      function pushBlock() {
        stack.push({ hasMockOnly: false, mockMatchers: [], hasReal: false, mockCallNodes: [] })
      }
      function popBlock(node) {
        const frame = stack.pop()
        if (!frame) return
        // 仅当存在 mock-only 断言且无任何真实断言时报错
        if (frame.mockMatchers.length > 0 && !frame.hasReal) {
          for (const mockNode of frame.mockCallNodes) {
            context.report({
              node: mockNode,
              messageId: 'bare',
              data: { matcher: frame.mockMatchers.join(', ') },
            })
          }
        }
      }

      return {
        // it(...) / test(...) 回调进入时压栈
        CallExpression(node) {
          const callee = node.callee
          if (
            callee &&
            callee.type === 'Identifier' &&
            (callee.name === 'it' || callee.name === 'test')
          ) {
            pushBlock()
          }
        },
        // 单一 exit 处理器：同时处理 it/test 弹栈与 expect 断言收集
        // （禁止用两个同名 'CallExpression:exit' 键——后者会覆盖前者导致弹栈失效）
        'CallExpression:exit'(node) {
          const callee = node.callee

          // 先处理 expect 断言（仍在 it/test 块内，取最内层栈帧）
          if (isExpectCall(node)) {
            const frame = stack[stack.length - 1]
            if (frame) {
              // 精炼判定（cleanup-test-quality-backlog Phase A）：
              // 区分"断言性次数/否定断言"（real，放行）与"裸调用"（mockOnly，拦截）
              const klass = classifyExpectAssertion(node)
              if (klass === 'mockOnly') {
                const matcherName = callee.property.name
                frame.hasMockOnly = true
                frame.mockMatchers.push(matcherName)
                frame.mockCallNodes.push(node)
              } else if (klass === 'real') {
                // 断言性次数 / 否定断言 / toHaveBeenCalledWith —— 承载信号，计入真实断言
                frame.hasReal = true
              }
              // klass === null：其他真实行为 matcher（toBe/toEqual/...），计入真实断言
              else if (klass === null) {
                frame.hasReal = true
              }
            }
          }

          // 再处理 it/test 块弹栈（在收集完内部断言后判定）
          if (
            callee &&
            callee.type === 'Identifier' &&
            (callee.name === 'it' || callee.name === 'test')
          ) {
            popBlock(node)
          }
        },
      }
    },
  },

  'no-pure-store-crud-roundtrip': {
    meta: {
      type: 'problem',
      docs: {
        description: '禁止 store 测试中"setX(v) + 仅断言 getState().x === v"的纯 CRUD 往返（test-discipline 框架基本保证防护）',
      },
      schema: [],
      messages: {
        crud: '此 store 用例疑似纯 CRUD 往返（setX(v) 后仅断言 getState().x === v），验证 Zustand 框架基本保证。若该用例验证派生逻辑（上下文隔离/字段映射/预加载不覆盖等），请在 it 标题或行内注释加 [derived] 标记；否则应删除。',
      },
    },
    create(context) {
      const stack = []

      function pushBlock(titleNode) {
        /** @type {any} */
        const titleText = titleNode && titleNode.value !== undefined ? String(titleNode.value) : ''
        stack.push({
          hasDerivedMarker: /\[derived\]/i.test(titleText),
          setterCalls: [], // store.getState().setX(v) 调用节点
          matcherCalls: [], // expect(x).matcher(args) 整体调用节点（含参数）
        })
      }

      function popBlock(node) {
        const frame = stack.pop()
        if (!frame) return
        if (frame.hasDerivedMarker) return // 显式声明派生，放行

        // 判定为纯 CRUD 往返的条件（保守，宁可漏报不可误报）：
        //   1. 至少 1 个 setter 调用（setX(v) 形态）
        //   2. 至少 1 个断言
        //   3. 所有断言都是"简单 toBe/toEqual(字面量值)"形态
        //      —— 期望值为字面量/标识符/一元表达式；matcher 仅 toBe/toEqual
        //      （toEqual 对象/数组、toHaveLength/toContain/toMatch 等视为可能派生，放行）
        if (frame.setterCalls.length === 0) return
        if (frame.matcherCalls.length === 0) return

        const allSimpleCrud = frame.matcherCalls.every((callNode) => {
          // callNode 是 expect(x).matcher(args) 整体
          const callee = callNode.callee // MemberExpression(.matcher)
          if (!callee || callee.type !== 'MemberExpression') return false
          const matcher = callee.property
          if (!matcher || matcher.type !== 'Identifier') return false
          // 仅 toBe/toEqual 视为简单等值断言；其余 matcher 放行（视为可能派生）
          if (matcher.name !== 'toBe' && matcher.name !== 'toEqual') return false
          // 期望值：matcher 调用的第一个参数
          const expected = callNode.arguments && callNode.arguments[0]
          if (!expected) return false
          // 字面量/标识符/一元表达式视为 CRUD 标量；对象/数组/调用视为可能派生，放行
          const crudValueTypes = new Set(['Literal', 'Identifier', 'UnaryExpression'])
          return crudValueTypes.has(expected.type)
        })

        if (allSimpleCrud) {
          // 上报首个 setter 调用节点（避免每个 setter 重复报告同一用例）
          context.report({
            node: frame.setterCalls[0],
            messageId: 'crud',
          })
        }
      }

      return {
        CallExpression(node) {
          const callee = node.callee
          if (
            callee &&
            callee.type === 'Identifier' &&
            (callee.name === 'it' || callee.name === 'test')
          ) {
            pushBlock(node.arguments[0])
          }
        },
        'CallExpression:exit'(node) {
          const callee = node.callee

          // 在 it/test 块内：收集 setter 调用与 matcher 断言
          const frame = stack[stack.length - 1]
          if (frame) {
            // setter 调用：xxx.getState().setX(...) 形态
            // callee = MemberExpression(property=setX)
            if (
              callee &&
              callee.type === 'MemberExpression' &&
              callee.property &&
              callee.property.type === 'Identifier' &&
              /^set[A-Z]/.test(callee.property.name)
            ) {
              frame.setterCalls.push(node)
            }

            // expect(x).matcher(args) 整体调用
            if (isExpectCall(node)) {
              frame.matcherCalls.push(node)
            }
          }

          // it/test 块弹栈（在收集完内部节点后判定）
          if (
            callee &&
            callee.type === 'Identifier' &&
            (callee.name === 'it' || callee.name === 'test')
          ) {
            popBlock(node)
          }
        },
      }
    },
  },
}

export default { rules }
