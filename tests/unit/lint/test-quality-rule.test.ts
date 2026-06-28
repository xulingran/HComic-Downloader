// @vitest-environment node
//
// 闸门规则的自我验证测试（test-quality-gate 规范 / 决策 5）。
// 复用 test_config_isolation_guard.py 的守卫模式：闸门规则是"测试的测试"，
// 其自身必须有测试覆盖，否则规则演进（如调整 AST 匹配）会静默失效。
//
// 用 ESLint Linter API 直接运行 eslint-rules/test-quality.js 的两条规则，
// 喂入合成反例（应被报告）与正例（应被放行），断言判定正确。
import { describe, it, expect } from 'vitest'
import { Linter } from 'eslint'
import testQualityPlugin from '../../../eslint-rules/test-quality.js'

const linter = new Linter()

interface RunOptions {
  ruleName: 'no-bare-mock-assertion' | 'no-pure-store-crud-roundtrip'
  code: string
}

/** 运行规则并返回消息数（即违规数）。 */
function runRule({ ruleName, code }: RunOptions): number {
  const messages = linter.verify(code, {
    plugins: { 'test-quality': testQualityPlugin },
    rules: { [`test-quality/${ruleName}`]: 'error' },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  })
  return messages.length
}

describe('no-bare-mock-assertion', () => {
  describe('反例（应被拦截）', () => {
    it('裸 toHaveBeenCalled 不同时验证行为', () => {
      const code = `it('bare', () => { const m = vi.fn(); m(); expect(m).toHaveBeenCalled() })`
      expect(runRule({ ruleName: 'no-bare-mock-assertion', code })).toBe(1)
    })

    it('裸 toHaveBeenCalledTimes 不同时验证行为', () => {
      const code = `it('bare', () => { const m = vi.fn(); m(); m(); expect(m).toHaveBeenCalledTimes(2) })`
      expect(runRule({ ruleName: 'no-bare-mock-assertion', code })).toBe(1)
    })

    it('多个裸 mock 断言组合仍被报告', () => {
      const code = `it('bare', () => { const m = vi.fn(); m(); expect(m).toHaveBeenCalled(); expect(m).toHaveBeenCalledTimes(1) })`
      expect(runRule({ ruleName: 'no-bare-mock-assertion', code })).toBe(2)
    })
  })

  describe('正例（应被放行）', () => {
    it('纯真实断言（无 mock）', () => {
      const code = `it('real', () => { expect(1).toBe(1) })`
      expect(runRule({ ruleName: 'no-bare-mock-assertion', code })).toBe(0)
    })

    it('mock 断言伴随返回值断言', () => {
      const code = `it('with-behavior', () => {
        const m = vi.fn().mockReturnValue(42)
        const r = m()
        expect(m).toHaveBeenCalled()
        expect(r).toBe(42)
      })`
      expect(runRule({ ruleName: 'no-bare-mock-assertion', code })).toBe(0)
    })

    it('toHaveBeenCalledWith 放行（参数承载信号）', () => {
      const code = `it('with-args', () => {
        const m = vi.fn()
        m('transformed-arg')
        expect(m).toHaveBeenCalledWith('transformed-arg')
      })`
      expect(runRule({ ruleName: 'no-bare-mock-assertion', code })).toBe(0)
    })

    it('mock 断言伴随 DOM/状态断言', () => {
      const code = `it('with-dom', () => {
        const handler = vi.fn()
        // 模拟点击触发 handler
        expect(document.body).toBeDefined()
        expect(handler).toHaveBeenCalled()
      })`
      expect(runRule({ ruleName: 'no-bare-mock-assertion', code })).toBe(0)
    })

    it('rejects.toThrow 视为真实行为断言', () => {
      const code = `it('rejects', async () => {
        const m = vi.fn().mockRejectedValue(new Error('x'))
        await expect(m()).rejects.toThrow('x')
      })`
      expect(runRule({ ruleName: 'no-bare-mock-assertion', code })).toBe(0)
    })
  })
})

describe('no-pure-store-crud-roundtrip', () => {
  describe('反例（应被拦截）', () => {
    it('纯 setX + toBe(字面量) 往返', () => {
      const code = `it('crud', () => {
        store.getState().setThemeMode('dark')
        expect(store.getState().themeMode).toBe('dark')
      })`
      expect(runRule({ ruleName: 'no-pure-store-crud-roundtrip', code })).toBe(1)
    })

    it('多个 setter + 多个简单 toBe 断言', () => {
      const code = `it('crud-multi', () => {
        store.getState().setA(1)
        store.getState().setB(2)
        expect(store.getState().a).toBe(1)
        expect(store.getState().b).toBe(2)
      })`
      expect(runRule({ ruleName: 'no-pure-store-crud-roundtrip', code })).toBe(1)
    })
  })

  describe('正例（应被放行）', () => {
    it('[derived] 标记豁免', () => {
      const code = `it('derived logic [derived]', () => {
        store.getState().setError('x')
        expect(store.getState().error).toBe('x')
      })`
      expect(runRule({ ruleName: 'no-pure-store-crud-roundtrip', code })).toBe(0)
    })

    it('非 setter 断言（无 setX 调用）', () => {
      const code = `it('no-setter', () => {
        expect({ a: 1 }).toEqual({ a: 1 })
      })`
      expect(runRule({ ruleName: 'no-pure-store-crud-roundtrip', code })).toBe(0)
    })

    it('toEqual 对象断言视为可能派生（放行）', () => {
      const code = `it('object-equality', () => {
        store.getState().setPagination(p)
        expect(store.getState().pagination).toEqual({ currentPage: 1, totalPages: 5 })
      })`
      expect(runRule({ ruleName: 'no-pure-store-crud-roundtrip', code })).toBe(0)
    })

    it('非 toBe/toEqual matcher 视为可能派生（放行）', () => {
      const code = `it('match-matcher', () => {
        store.getState().setError('boom')
        expect(store.getState().error).toMatch(/boom/)
      })`
      expect(runRule({ ruleName: 'no-pure-store-crud-roundtrip', code })).toBe(0)
    })
  })
})
