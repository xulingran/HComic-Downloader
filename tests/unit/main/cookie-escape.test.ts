// @vitest-environment node
//
// 仅测试 login-window.ts 导出的 shellQuoteForShlex 纯函数 + 真实生产 curl 文本的
// shlex round-trip 契约。该函数不依赖 electron API，但 login-window.ts 模块顶层会
// import electron，故此处仍需 mock electron 以避免模块加载失败。
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  session: {
    defaultSession: {
      cookies: { get: vi.fn().mockResolvedValue([]) },
      webRequest: { onHeadersReceived: vi.fn() },
    },
    fromPartition: vi.fn().mockReturnValue({
      cookies: { get: vi.fn().mockResolvedValue([]) },
      webRequest: { onHeadersReceived: vi.fn() },
    }),
  },
}))

// Mock python-bridge 以避免模块加载时尝试 spawn 子进程
vi.mock('../../../electron/python-bridge', () => ({
  getPythonBridge: () => ({ call: vi.fn() }),
}))

// Mock fs：login-window.ts 的 diag 改为异步 appendFile，但模块仍可能引用 fs 的同步 API
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  promises: { appendFile: vi.fn().mockResolvedValue(undefined) },
}))

import { shellQuoteForShlex } from '../../../electron/login-window'

describe('shellQuoteForShlex', () => {
  it('wraps plain value in single quotes', () => {
    expect(shellQuoteForShlex('abc123')).toBe("'abc123'")
  })

  it('escapes single quote using posix quote-split trick', () => {
    // a'b → 'a'\''b'
    // shlex.split(posix=True) 解析后还原为 a'b
    expect(shellQuoteForShlex("a'b")).toBe("'a'\\''b'")
  })

  it('escapes multiple single quotes (verified via replace semantics)', () => {
    // 不硬编码期望字面量（反斜杠转义容易数错），改用 replace 反向验证语义：
    // 把转义结果中所有 '\'' 序列替换回 '，再去掉外层引号，应得回原值。
    const input = "a''b"
    const escaped = shellQuoteForShlex(input)
    expect(escaped.startsWith("'") && escaped.endsWith("'")).toBe(true)
    // 去掉外层引号后，把每个 '\''（闭合单引号+转义单引号+重开单引号）还原为 '
    const restored = escaped.slice(1, -1).replace(/'\\''/g, "'")
    expect(restored).toBe(input)
  })

  it('preserves backslash literally inside single quotes', () => {
    // 单引号内反斜杠是字面量，无需转义
    expect(shellQuoteForShlex('a\\b')).toBe("'a\\b'")
  })

  it('preserves semicolon and space literally', () => {
    // cookie 中常见的 ; 和空格在单引号内是字面量
    expect(shellQuoteForShlex('key=val; path=/')).toBe("'key=val; path=/'")
  })

  it('preserves unicode characters', () => {
    expect(shellQuoteForShlex('中文测试')).toBe("'中文测试'")
  })

  it('rejects C0 control characters', () => {
    expect(() => shellQuoteForShlex('a\x00b')).toThrow('control characters')
    expect(() => shellQuoteForShlex('a\x1fb')).toThrow('control characters')
    expect(() => shellQuoteForShlex('a\nb')).toThrow('control characters')
  })

  it('rejects DEL character', () => {
    expect(() => shellQuoteForShlex('a\x7fb')).toThrow('control characters')
  })

  it('accepts empty string', () => {
    expect(shellQuoteForShlex('')).toBe("''")
  })
})

// 跨语言端到端验证：模拟**真实生产 curl 文本拼接**，用 Python shlex.split 还原。
// 这是 #7 修复的核心契约——Electron 拼 curl 文本，Python auth_parser 用 shlex 解析。
//
// 关键：必须模拟与 applyAndVerifyCookies 完全一致的拼接方式：
//   curl 'https://${domain}' -b ${shellQuote(rawCookieStr)} -H ${shellQuote(rawUaHeader)}
// （-b / -H 后**无外层引号**，shellQuote 自带引号）
// 用真实 Python 解释器验证是最权威的回归保护——历史上曾经因为外层加引号导致
// cookie value 含 ' 时 shlex 抛 No closing quotation。
import { execFileSync } from 'child_process'

// Python 不可用时跳过：CI 环境应保证 python3 可用，但开发者本地可能无。
// 注意：Windows 上 %PATH%\WindowsApps\python3*.exe 是 Microsoft Store 占位 stub，
// `python3 --version` 进程能成功退出却不产生任何输出（真实解释器会打印版本到 stdout）。
// 因此探测不能只看进程是否抛错，必须执行真实脚本并校验 stdout——否则 stub 会被误判为可用，
// 后续调用会因 stub 静默吞掉 stdin 而失败。
// 此外探测与实际调用必须使用**同一个**命令：早期实现探测时遍历 ['python3','python']
// 找到可用者，但 shlexExtractCookieAndUa 写死 'python3'，导致本地仅有 python 可用时
// 探测通过、调用却失败。下面解析出的 pythonCmd 复用到探测与调用两处。
const PYTHON_CANDIDATES = ['python3', 'python']

function resolvePythonCommand(): string | null {
  for (const cmd of PYTHON_CANDIDATES) {
    try {
      const out = execFileSync(cmd, ['-c', 'print("ok")'], {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      if (out.trim() === 'ok') return cmd
    } catch {
      // 继续尝试下一个候选命令
    }
  }
  return null
}

const pythonCmd = resolvePythonCommand()

/** 镜像 applyAndVerifyAuth 的 curl 文本构造逻辑 */
function buildProductionCurlText(cookies: Array<[string, string]>, domain: string, userAgent: string): string {
  const rawCookieStr = cookies.map(([k, v]) => `${k}=${v}`).join('; ')
  const rawUaHeader = `User-Agent: ${userAgent}`
  return `curl 'https://${domain}' -b ${shellQuoteForShlex(rawCookieStr)} -H ${shellQuoteForShlex(rawUaHeader)}`
}

function shlexExtractCookieAndUa(curlText: string): { cookie: string; userAgent: string } {
  // 仅在 pythonCmd 解析成功后调用（describe 内已用 if (pythonCmd) 守卫），此处断言以满足类型。
  if (!pythonCmd) throw new Error('python not available')
  // 镜像 auth_parser.py 的关键解析路径：shlex.split + 找 -b / -H User-Agent
  const script = `import shlex,sys
tokens = shlex.split(sys.stdin.read(), posix=True)
cookie = ''
ua = ''
i = 0
while i < len(tokens):
    t = tokens[i]
    if t in ('-b', '--cookie') and i+1 < len(tokens):
        cookie = tokens[i+1].strip()
        i += 2
        continue
    if t in ('-H', '--header') and i+1 < len(tokens):
        name, _, val = tokens[i+1].partition(':')
        if name.strip().lower() == 'user-agent':
            ua = val.strip()
        i += 2
        continue
    i += 1
sys.stdout.write(cookie + '\\n' + ua)
`
  const out = execFileSync(pythonCmd, ['-c', script], {
    input: curlText,
    encoding: 'utf-8',
    timeout: 5000,
  })
  // Windows 下 execFileSync 的 stdout 可能带 \r，统一去除
  const [cookie, ua] = out.replace(/\r/g, '').split('\n')
  return { cookie, userAgent: ua }
}

describe('shellQuoteForShlex — production curl text round-trip (Python)', () => {
  // 端到端：模拟真实 cookie 列表 + UA，构造生产 curl 文本，验证 shlex 能还原
  // 每个 case 同时验证 cookie 与 user-agent 两条解析路径。
  const cases = [
    {
      name: 'plain cookies + plain UA',
      cookies: [['session', 'abc123'], ['token', 'xyz789']] as Array<[string, string]>,
      userAgent: 'Mozilla/5.0',
      expectedCookie: 'session=abc123; token=xyz789',
      expectedUa: 'Mozilla/5.0',
    },
    {
      name: "cookie value with single quote (the bug scenario)",
      cookies: [['name', "with'quote"]] as Array<[string, string]>,
      userAgent: 'Mozilla/5.0',
      expectedCookie: "name=with'quote",
      expectedUa: 'Mozilla/5.0',
    },
    {
      name: 'UA with single quote',
      cookies: [['k', 'v']] as Array<[string, string]>,
      userAgent: "UA'with'quote",
      expectedCookie: 'k=v',
      expectedUa: "UA'with'quote",
    },
    {
      name: 'cookie value with semicolon + space (RFC 6265 legal)',
      cookies: [['k', 'val; path=/']] as Array<[string, string]>,
      userAgent: 'UA test',
      expectedCookie: 'k=val; path=/',
      expectedUa: 'UA test',
    },
    {
      name: 'multiple cookies, one with quote',
      cookies: [['a', 'b'], ['c', "x'y"], ['d', 'z']] as Array<[string, string]>,
      userAgent: 'UA',
      expectedCookie: "a=b; c=x'y; d=z",
      expectedUa: 'UA',
    },
    {
      name: 'empty cookie value',
      cookies: [['k', '']] as Array<[string, string]>,
      userAgent: 'UA',
      expectedCookie: 'k=',
      expectedUa: 'UA',
    },
    {
      name: 'unicode in cookie and UA',
      cookies: [['sid', '中文']] as Array<[string, string]>,
      userAgent: '客户端/1.0',
      expectedCookie: 'sid=中文',
      expectedUa: '客户端/1.0',
    },
  ]

  for (const c of cases) {
    const itOrSkip = pythonCmd ? it : it.skip
    itOrSkip(`round-trips: ${c.name}`, () => {
      const curlText = buildProductionCurlText(c.cookies, 'example.com', c.userAgent)
      const { cookie, userAgent } = shlexExtractCookieAndUa(curlText)
      expect(cookie).toBe(c.expectedCookie)
      expect(userAgent).toBe(c.expectedUa)
    })
  }

  // 显式回归：旧的失败场景（cookie value 含 '）必须不再抛 shlex 错误
  if (pythonCmd) {
    it('regression: single quote in value no longer raises shlex error', () => {
      const curlText = buildProductionCurlText([['name', "a'b'c"]], 'example.com', "UA'x")
      // 不应抛错（旧实现会因外层引号嵌套导致 ValueError: No closing quotation）
      expect(() => shlexExtractCookieAndUa(curlText)).not.toThrow()
    })
  }
})
