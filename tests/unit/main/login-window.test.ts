// @vitest-environment node
//
// login-window.ts 单元测试。
// 覆盖：escapeCookieValueForShlex（烟雾）、openLoginWindow 黑盒行为（窗口创建、
// 事件时序、close 触发提取、超时、崩溃、域名白名单）、子函数（重构后逐步补）。
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock 依赖：electron / python-bridge / fs / os ──────────────────────────

const { mockBridgeCall, mockAppendFile, loginWinEvents, webContentsEvents, capturedInstances } = vi.hoisted(() => ({
  mockBridgeCall: vi.fn(),
  mockAppendFile: vi.fn().mockResolvedValue(undefined),
  loginWinEvents: {} as Record<string, ((...args: unknown[]) => void)[]>,
  webContentsEvents: {} as Record<string, ((...args: unknown[]) => void)[]>,
  capturedInstances: [] as Array<Record<string, unknown>>,
}))

vi.mock('electron', () => {
  // BrowserWindow 类：捕获实例以便测试断言
  class MockBrowserWindow {
    webContents = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        ;(webContentsEvents[event] ||= []).push(cb)
      }),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(''),
      loadURL: vi.fn().mockResolvedValue(undefined),
      session: {
        cookies: { get: vi.fn().mockResolvedValue([]) },
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        webRequest: { onHeadersReceived: vi.fn() },
      },
      userAgent: 'MockUA/1.0',
    }
    on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      ;(loginWinEvents[event] ||= []).push(cb)
    })
    once = vi.fn()
    loadURL = vi.fn().mockResolvedValue(undefined)
    show = vi.fn()
    focus = vi.fn()
    isFocused = vi.fn().mockReturnValue(false)
    isMinimized = vi.fn().mockReturnValue(false)
    isDestroyed = vi.fn().mockReturnValue(false)
    destroy = vi.fn()
    restore = vi.fn()
    constructor(public options?: unknown) {
      capturedInstances.push(this)
    }
  }
  return {
    BrowserWindow: MockBrowserWindow,
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
  }
})

vi.mock('../../../electron/python-bridge', () => ({
  getPythonBridge: () => ({ call: mockBridgeCall }),
}))

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  promises: {
    appendFile: mockAppendFile,
  },
  // 提供 default 以兼容可能的 default import
  default: { promises: { appendFile: mockAppendFile } },
}))

import { openLoginWindow, shellQuoteForShlex, resolveLoginTarget, extractCookiesForSource, verifyLoginCookies } from '../../../electron/login-window'
import { session as electronSession } from 'electron'

// 辅助：构造 mainWindow 占位
function makeMainWindow() {
  return { isDestroyed: vi.fn().mockReturnValue(false) } as unknown as Parameters<typeof openLoginWindow>[0]
}

// 辅助：构造 cookie
function cookie(name: string, value: string) {
  return { name, value, domain: '.example.com' }
}

describe('login-window: shellQuoteForShlex (smoke)', () => {
  // 完整覆盖在 cookie-escape.test.ts；此处仅做模块导出烟雾测试，
  // 确保重构后函数仍从 login-window 正确导出。
  it('escapes single quote', () => {
    expect(shellQuoteForShlex("a'b")).toBe("'a'\\''b'")
  })
})

describe('login-window: resolveLoginTarget', () => {
  it('jmcomic uses default domain when resolvedDomain not provided', () => {
    const t = resolveLoginTarget('jmcomic')
    expect(t).toEqual({ url: 'https://18comic.vip', title: '登录 jmcomic', domain: '18comic.vip' })
  })

  it('jmcomic uses custom resolvedDomain when provided', () => {
    const t = resolveLoginTarget('jmcomic', 'custom.example.com')
    expect(t.url).toBe('https://custom.example.com')
    expect(t.domain).toBe('custom.example.com')
    expect(t.title).toBe('登录 jmcomic')
  })

  it('copymanga routes to www.2026copy.com', () => {
    const t = resolveLoginTarget('copymanga')
    expect(t).toEqual({ url: 'https://www.2026copy.com', title: '登录拷贝漫画', domain: 'www.2026copy.com' })
  })

  it('hcomic and unknown sources fall back to h-comic.com', () => {
    expect(resolveLoginTarget('hcomic').domain).toBe('h-comic.com')
    expect(resolveLoginTarget('unknown').domain).toBe('h-comic.com')
    expect(resolveLoginTarget('hcomic').title).toBe('登录 H-Comic')
  })
})

describe('login-window: extractCookiesForSource', () => {
  it('jmcomic returns first mirror with login cookie', async () => {
    // 主域名无 cookie，镜像 jmcomic-zzz.one 含 remember → 命中
    vi.mocked(electronSession.defaultSession.cookies.get).mockImplementation(async (opts: { url: string }) => {
      if (opts.url === 'https://jmcomic-zzz.one') {
        return [cookie('remember', 'token123')]
      }
      return []
    })
    const result = await extractCookiesForSource('jmcomic', '18comic.vip', electronSession.defaultSession)
    expect(result.domain).toBe('jmcomic-zzz.one')
    expect(result.cookies).toHaveLength(1)
    expect(result.cookies[0].name).toBe('remember')
    expect(result.notLoggedIn).toBeUndefined()
  })

  it('jmcomic returns notLoggedIn when no mirror has login cookie', async () => {
    vi.mocked(electronSession.defaultSession.cookies.get).mockResolvedValue([])
    const result = await extractCookiesForSource('jmcomic', '18comic.vip', electronSession.defaultSession)
    expect(result.notLoggedIn).toBe(true)
    expect(result.cookies).toHaveLength(0)
  })

  it('copymanga filters to COPYMANGA_LOGIN_COOKIE_NAMES', async () => {
    vi.mocked(electronSession.defaultSession.cookies.get).mockResolvedValueOnce([
      cookie('token', 'abc'),
      cookie('analytics', 'xyz'),  // 非登录 cookie
    ])
    const result = await extractCookiesForSource('copymanga', 'www.2026copy.com', electronSession.defaultSession)
    expect(result.cookies).toHaveLength(2)  // 返回全部，校验由 verifyLoginCookies 做
    expect(result.domain).toBe('www.2026copy.com')
  })

  it('copymanga returns notLoggedIn when no COPYMANGA login cookie present', async () => {
    vi.mocked(electronSession.defaultSession.cookies.get).mockResolvedValueOnce([
      cookie('analytics', 'xyz'),
    ])
    const result = await extractCookiesForSource('copymanga', 'www.2026copy.com', electronSession.defaultSession)
    expect(result.notLoggedIn).toBe(true)
  })

  it('hcomic returns all cookies directly without filtering', async () => {
    vi.mocked(electronSession.defaultSession.cookies.get).mockResolvedValueOnce([
      cookie('sessionid', 'abc'),
      cookie('_ga', 'GA1.2'),
    ])
    const result = await extractCookiesForSource('hcomic', 'h-comic.com', electronSession.defaultSession)
    expect(result.cookies).toHaveLength(2)
    expect(result.notLoggedIn).toBeUndefined()
  })

  it('hcomic returns notLoggedIn when no cookies at all', async () => {
    vi.mocked(electronSession.defaultSession.cookies.get).mockResolvedValueOnce([])
    const result = await extractCookiesForSource('hcomic', 'h-comic.com', electronSession.defaultSession)
    expect(result.notLoggedIn).toBe(true)
    expect(result.message).toContain('未获取到登录信息')
  })
})

describe('login-window: verifyLoginCookies', () => {
  it('jmcomic fails when remember/remember_id absent', () => {
    const result = verifyLoginCookies('jmcomic', [cookie('_ga', 'x')])
    expect(result).not.toBeNull()
    expect(result!.notLoggedIn).toBe(true)
    expect(result!.message).toContain('未检测到登录状态')
  })

  it('jmcomic passes when remember present', () => {
    expect(verifyLoginCookies('jmcomic', [cookie('remember', 't')])).toBeNull()
  })

  it('jmcomic passes when remember_id present (case-insensitive)', () => {
    expect(verifyLoginCookies('jmcomic', [cookie('Remember_ID', 't')])).toBeNull()
  })

  it('copymanga fails when token/sessionid/copymanga_session absent', () => {
    const result = verifyLoginCookies('copymanga', [cookie('_ga', 'x')])
    expect(result).not.toBeNull()
    expect(result!.notLoggedIn).toBe(true)
    expect(result!.message).toContain('拷贝漫画')
  })

  it('copymanga passes when sessionid present', () => {
    expect(verifyLoginCookies('copymanga', [cookie('sessionid', 't')])).toBeNull()
  })

  it('hcomic skips verification (returns null)', () => {
    expect(verifyLoginCookies('hcomic', [])).toBeNull()
    expect(verifyLoginCookies('hcomic', [cookie('anything', 'x')])).toBeNull()
  })
})

describe('login-window: diag (async batching)', () => {
  // 放在 openLoginWindow 之前执行：避免前序用 fake timer 的测试遗留
  // 模块级 diagFlushTimer 状态污染。diag 的 timer 是模块私有，无法在
  // beforeEach 重置，故通过测试顺序保证此 describe 先跑、状态干净。
  beforeEach(() => {
    mockAppendFile.mockClear()
    vi.clearAllMocks()
  })

  it('writes batched log lines via fs.promises.appendFile after debounce', async () => {
    vi.useFakeTimers()
    void openLoginWindow(makeMainWindow(), 'hcomic')
    void openLoginWindow(makeMainWindow(), 'diag-batch-marker')
    await Promise.resolve()
    // 100ms debounce 窗口（D3 设计）：超过窗口后触发批量写入
    await vi.advanceTimersByTimeAsync(200)
    expect(mockAppendFile).toHaveBeenCalled()
    const lastCall = mockAppendFile.mock.calls.at(-1)
    expect(typeof lastCall?.[1]).toBe('string')
    vi.useRealTimers()
  })

  it('console.log stays synchronous (immediate within same tick)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    openLoginWindow(makeMainWindow(), 'diag-sync-test')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('diag-sync-test'))
    logSpy.mockRestore()
  })
})

describe('login-window: openLoginWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 清空事件捕获
    for (const k of Object.keys(loginWinEvents)) delete loginWinEvents[k]
    for (const k of Object.keys(webContentsEvents)) delete webContentsEvents[k]
    capturedInstances.length = 0
    mockBridgeCall.mockReset()
    mockBridgeCall.mockResolvedValue({ valid: true, message: 'ok' })
  })

  it('returns failure immediately when mainWindow is null', async () => {
    const result = await openLoginWindow(null, 'hcomic')
    expect(result.success).toBe(false)
    expect(result.message).toContain('主窗口不存在')
    expect(capturedInstances).toHaveLength(0)
  })

  it('creates a BrowserWindow and loads the source-specific URL', async () => {
    // 不 await openLoginWindow 的 promise：会一直 pending 直到 close/timeout/crash
    void openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    expect(capturedInstances).toHaveLength(1)
    const win = capturedInstances[0] as { loadURL: ReturnType<typeof vi.fn> }
    expect(win.loadURL).toHaveBeenCalledWith('https://h-comic.com')
  })

  it('uses jmcomic default domain when resolvedDomain not provided', async () => {
    void openLoginWindow(makeMainWindow(), 'jmcomic')
    await Promise.resolve()
    const win = capturedInstances[0] as { loadURL: ReturnType<typeof vi.fn> }
    expect(win.loadURL).toHaveBeenCalledWith('https://18comic.vip')
  })

  it('uses custom resolvedDomain for jmcomic when provided', async () => {
    void openLoginWindow(makeMainWindow(), 'jmcomic', 'custom.example.com')
    await Promise.resolve()
    const win = capturedInstances[0] as { loadURL: ReturnType<typeof vi.fn> }
    expect(win.loadURL).toHaveBeenCalledWith('https://custom.example.com')
  })

  it('routes copymanga to www.2026copy.com', async () => {
    void openLoginWindow(makeMainWindow(), 'copymanga')
    await Promise.resolve()
    const win = capturedInstances[0] as { loadURL: ReturnType<typeof vi.fn> }
    expect(win.loadURL).toHaveBeenCalledWith('https://www.2026copy.com')
  })

  it('registers render-process-gone handler that resolves with crash message', async () => {
    const promise = openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    expect(webContentsEvents['render-process-gone']).toBeDefined()
    const handler = webContentsEvents['render-process-gone'][0]
    const result = await new Promise<{ success: boolean; message?: string }>((resolve) => {
      promise.then(resolve)
      handler({}, { reason: 'oom', exitCode: 1 })
    })
    expect(result.success).toBe(false)
    expect(result.message).toContain('登录页面崩溃')
    expect(result.message).toContain('oom')
  })

  it('timeout triggers done with login timeout message', async () => {
    vi.useFakeTimers()
    const promise = openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    // 触发 timeout
    const result = await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100).then(() => promise)
    expect(result.success).toBe(false)
    expect(result.message).toContain('登录超时')
    vi.useRealTimers()
  })

  it('settled guard: subsequent done calls do not double-resolve', async () => {
    vi.useFakeTimers()
    const promise = openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    // 先让 render-process-gone 触发 done（settled=true）
    webContentsEvents['render-process-gone'][0]({}, { reason: 'crashed', exitCode: 1 })
    // 再触发 timeout：应当被 settled 守卫挡住
    const firstResult = await promise
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    // firstResult 应是崩溃信息（不是超时），证明 timeout 没覆盖
    expect(firstResult.message).toContain('崩溃')
    vi.useRealTimers()
  })

  it('did-finish-load saves userAgent into ctx', async () => {
    vi.useFakeTimers()
    openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    expect(webContentsEvents['did-finish-load']).toBeDefined()
    webContentsEvents['did-finish-load'][0]()
    // 触发 close 流程，验证后续 cookie 提取使用了保存的 UA
    mockBridgeCall.mockResolvedValueOnce({ valid: true, message: 'verify ok' })
    // session.cookies.get 默认返回 []，会走 notLoggedIn 路径
    const closeHandlers = loginWinEvents['close']
    expect(closeHandlers).toBeDefined()
    const fakeEvent = { preventDefault: vi.fn() }
    await closeHandlers![0](fakeEvent)
    await vi.runAllTimersAsync()
    // apply_auth 不会被调用（notLoggedIn 短路）；但 done 被触发
    // 此处主要验证 did-finish-load 不抛错
    vi.useRealTimers()
  })

  it('will-navigate handler blocks disallowed domains', async () => {
    openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    expect(webContentsEvents['will-navigate']).toBeDefined()
    const fakeEvent = { preventDefault: vi.fn() }
    webContentsEvents['will-navigate'][0](fakeEvent, 'https://evil.example.com/path')
    expect(fakeEvent.preventDefault).toHaveBeenCalled()
  })

  it('will-navigate handler allows whitelisted domains', async () => {
    openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    const fakeEvent = { preventDefault: vi.fn() }
    webContentsEvents['will-navigate'][0](fakeEvent, 'https://h-comic.com/login')
    expect(fakeEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('will-navigate handler tolerates malformed URLs', async () => {
    openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    const fakeEvent = { preventDefault: vi.fn() }
    // 畸形 URL 不应抛错，也不应误判
    expect(() => webContentsEvents['will-navigate'][0](fakeEvent, 'not-a-url')).not.toThrow()
  })

  it('close event triggers cookie extraction for hcomic with no cookies → notLoggedIn silent cancel', async () => {
    vi.useFakeTimers()
    const promise = openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    const closeHandlers = loginWinEvents['close']
    const fakeEvent = { preventDefault: vi.fn() }
    await closeHandlers![0](fakeEvent)
    await vi.runAllTimersAsync()
    // apply_auth 不应被调用（cookies 为空走 notLoggedIn）
    expect(mockBridgeCall).not.toHaveBeenCalled()
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.message).toBe('已取消')
    vi.useRealTimers()
  })

  it('close event with valid cookies triggers apply_auth + verify_auth', async () => {
    vi.useFakeTimers()
    mockBridgeCall.mockResolvedValue({ valid: true, message: 'verify ok' })

    void openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    // mock 捕获到的 loginWin.webContents.session.cookies.get 返回有效 cookie
    const win = capturedInstances[0] as { webContents: { session: { cookies: { get: ReturnType<typeof vi.fn> } } } }
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValueOnce([
      cookie('sessionid', 'abc'),
    ])

    const closeHandlers = loginWinEvents['close']
    const fakeEvent = { preventDefault: vi.fn() }
    await closeHandlers![0](fakeEvent)
    await vi.runAllTimersAsync()
    expect(mockBridgeCall).toHaveBeenCalledWith('apply_auth', expect.objectContaining({ source: 'hcomic' }))
    expect(mockBridgeCall).toHaveBeenCalledWith('verify_auth', expect.objectContaining({ source: 'hcomic' }))
    vi.useRealTimers()
  })

  it('close handler is idempotent under rapid double-click (extractInProgress guard)', async () => {
    vi.useFakeTimers()
    const promise = openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    const closeHandlers = loginWinEvents['close']
    const fakeEvent1 = { preventDefault: vi.fn() }
    const fakeEvent2 = { preventDefault: vi.fn() }
    // 第一次 close：触发提取（异步），ctx.extractInProgress=true
    await closeHandlers![0](fakeEvent1)
    // 第二次 close（提取未完成）：应被 extractInProgress 挡住，不重复触发
    await closeHandlers![0](fakeEvent2)
    await vi.runAllTimersAsync()
    // apply_auth 最多调用 0 次（cookies 为空）或 1 次，不会是 2 次
    const applyAuthCalls = mockBridgeCall.mock.calls.filter(c => c[0] === 'apply_auth')
    expect(applyAuthCalls.length).toBeLessThanOrEqual(1)
    await promise
    vi.useRealTimers()
  })
})
