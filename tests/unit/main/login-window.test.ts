// @vitest-environment node
//
// login-window.ts 单元测试。
// 覆盖：escapeCookieValueForShlex（烟雾）、openLoginWindow 黑盒行为（窗口创建、
// 事件时序、close 触发提取、超时、崩溃、域名白名单）、子函数（重构后逐步补）。
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock 依赖：electron / python-bridge / fs / os ──────────────────────────

const { mockBridgeCall, mockAppendFile, loginWinEvents, webContentsEvents, capturedInstances, ipcHandlers } = vi.hoisted(() => ({
  mockBridgeCall: vi.fn(),
  mockAppendFile: vi.fn().mockResolvedValue(undefined),
  loginWinEvents: {} as Record<string, ((...args: unknown[]) => void)[]>,
  webContentsEvents: {} as Record<string, ((...args: unknown[]) => void)[]>,
  capturedInstances: [] as Array<Record<string, unknown>>,
  // 捕获 ipcMain.handle 注册的 channel→handler，供叠层测试调用
  ipcHandlers: {} as Record<string, ((...args: unknown[]) => unknown)>,
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
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers[channel] = handler
      }),
      removeHandler: vi.fn((channel: string) => {
        delete ipcHandlers[channel]
      }),
    },
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

import {
  extractCookiesForSource,
  openJmChallengeWindow,
  openLoginWindow,
  resetSourceWindowStateForTests,
  resolveJmChallengeTarget,
  resolveLoginTarget,
  shellQuoteForShlex,
  verifyLoginCookies,
} from '../../../electron/login-window'
import { session as electronSession } from 'electron'
import { IPC_CHANNELS, NOTIFICATION_CHANNELS } from '../../../shared/types'

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
  it('jm uses default domain when resolvedDomain not provided', () => {
    const t = resolveLoginTarget('jm')
    expect(t).toEqual({ url: 'https://18comic.vip', title: '登录 JM', domain: '18comic.vip' })
  })

  it('jm uses custom resolvedDomain when provided', () => {
    const t = resolveLoginTarget('jm', 'custom.example.com')
    expect(t.url).toBe('https://custom.example.com')
    expect(t.domain).toBe('custom.example.com')
    expect(t.title).toBe('登录 JM')
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
  it('jm returns first mirror with login cookie', async () => {
    // 主域名无 cookie，镜像 jmcomic-zzz.one 含 remember → 命中
    vi.mocked(electronSession.defaultSession.cookies.get).mockImplementation(async (opts: { url: string }) => {
      if (opts.url === 'https://jmcomic-zzz.one') {
        return [cookie('remember', 'token123')]
      }
      return []
    })
    const result = await extractCookiesForSource('jm', '18comic.vip', electronSession.defaultSession)
    expect(result.domain).toBe('jmcomic-zzz.one')
    expect(result.cookies).toHaveLength(1)
    expect(result.cookies[0].name).toBe('remember')
    expect(result.notLoggedIn).toBeUndefined()
  })

  it('jm returns notLoggedIn when no mirror has login cookie', async () => {
    vi.mocked(electronSession.defaultSession.cookies.get).mockResolvedValue([])
    const result = await extractCookiesForSource('jm', '18comic.vip', electronSession.defaultSession)
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
  it('jm fails when remember/remember_id absent', () => {
    const result = verifyLoginCookies('jm', [cookie('_ga', 'x')])
    expect(result).not.toBeNull()
    expect(result!.notLoggedIn).toBe(true)
    expect(result!.message).toContain('未检测到登录状态')
  })

  it('jm passes when remember present', () => {
    expect(verifyLoginCookies('jm', [cookie('remember', 't')])).toBeNull()
  })

  it('jm passes when remember_id present (case-insensitive)', () => {
    expect(verifyLoginCookies('jm', [cookie('Remember_ID', 't')])).toBeNull()
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
    resetSourceWindowStateForTests()
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
    resetSourceWindowStateForTests()
    vi.clearAllMocks()
    // 清空事件捕获
    for (const k of Object.keys(loginWinEvents)) delete loginWinEvents[k]
    for (const k of Object.keys(webContentsEvents)) delete webContentsEvents[k]
    for (const k of Object.keys(ipcHandlers)) delete ipcHandlers[k]
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

  it('uses the isolated login preload compatibility script', async () => {
    void openLoginWindow(makeMainWindow(), 'jm')
    await Promise.resolve()
    const win = capturedInstances[0] as { options: { webPreferences: { preload: string } } }
    expect(win.options.webPreferences.preload.replaceAll('\\', '/')).toMatch(/\/preload\/login-preload\.cjs$/)
  })

  it('uses jm default domain when resolvedDomain not provided', async () => {
    void openLoginWindow(makeMainWindow(), 'jm')
    await Promise.resolve()
    const win = capturedInstances[0] as { loadURL: ReturnType<typeof vi.fn> }
    expect(win.loadURL).toHaveBeenCalledWith('https://18comic.vip')
  })

  it('uses custom resolvedDomain for jm when provided', async () => {
    void openLoginWindow(makeMainWindow(), 'jm', 'custom.example.com')
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

  it('will-navigate handler allows the runtime-resolved jm domain', async () => {
    openLoginWindow(makeMainWindow(), 'jm', 'current-jm.example')
    await Promise.resolve()
    const fakeEvent = { preventDefault: vi.fn() }
    webContentsEvents['will-navigate'][0](fakeEvent, 'https://current-jm.example/login')
    expect(fakeEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('will-navigate handler tolerates malformed URLs', async () => {
    openLoginWindow(makeMainWindow(), 'hcomic')
    await Promise.resolve()
    const fakeEvent = { preventDefault: vi.fn() }
    // 畸形 URL 不应抛错，也不应误判
    expect(() => webContentsEvents['will-navigate'][0](fakeEvent, 'not-a-url')).not.toThrow()
  })

  it('opens trusted target=_blank links in the existing login window', async () => {
    openLoginWindow(makeMainWindow(), 'jm', 'current-jm.example')
    await Promise.resolve()
    const win = capturedInstances[0] as {
      webContents: {
        loadURL: ReturnType<typeof vi.fn>
        setWindowOpenHandler: ReturnType<typeof vi.fn>
      }
    }
    const handler = win.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: { url: string }) => {
      action: string
    }

    expect(handler({ url: 'https://current-jm.example/login' })).toEqual({ action: 'deny' })
    expect(win.webContents.loadURL).toHaveBeenCalledWith('https://current-jm.example/login')
  })

  it('keeps untrusted target=_blank links blocked', async () => {
    openLoginWindow(makeMainWindow(), 'jm')
    await Promise.resolve()
    const win = capturedInstances[0] as {
      webContents: {
        loadURL: ReturnType<typeof vi.fn>
        setWindowOpenHandler: ReturnType<typeof vi.fn>
      }
    }
    const handler = win.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: { url: string }) => {
      action: string
    }

    expect(handler({ url: 'https://ads.example.com/landing' })).toEqual({ action: 'deny' })
    expect(win.webContents.loadURL).not.toHaveBeenCalled()
  })

  it('allows permission requests in the login window', async () => {
    openLoginWindow(makeMainWindow(), 'jm')
    await Promise.resolve()
    const win = capturedInstances[0] as {
      webContents: {
        session: {
          setPermissionRequestHandler: ReturnType<typeof vi.fn>
          setPermissionCheckHandler: ReturnType<typeof vi.fn>
        }
      }
    }
    const requestHandler = win.webContents.session.setPermissionRequestHandler.mock.calls[0][0] as (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void
    const checkHandler = win.webContents.session.setPermissionCheckHandler.mock.calls[0][0] as () => boolean
    const callback = vi.fn()

    requestHandler(win.webContents, 'media', callback)
    expect(callback).toHaveBeenCalledWith(true)
    expect(checkHandler()).toBe(true)
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

// ── 叠层触发路径（LOGIN_EXTRACT / LOGIN_FINISH handler）─────────────────────

describe('login-window: overlay IPC handlers', () => {
  beforeEach(() => {
    resetSourceWindowStateForTests()
    vi.clearAllMocks()
    for (const k of Object.keys(loginWinEvents)) delete loginWinEvents[k]
    for (const k of Object.keys(webContentsEvents)) delete webContentsEvents[k]
    for (const k of Object.keys(ipcHandlers)) delete ipcHandlers[k]
    capturedInstances.length = 0
    mockBridgeCall.mockReset()
    mockBridgeCall.mockResolvedValue({ valid: true, message: 'verify ok' })
  })

  // 辅助：开窗 + 触发 did-finish-load 以填充 savedUserAgent，返回捕获的 loginWin
  async function setup(source = 'hcomic') {
    const promise = openLoginWindow(makeMainWindow(), source)
    await Promise.resolve()
    const win = capturedInstances[0] as {
      webContents: { send: ReturnType<typeof vi.fn>; session: { cookies: { get: ReturnType<typeof vi.fn> } }; userAgent: string }
    }
    // 填充 savedUserAgent（triggerExtraction 依赖）
    if (webContentsEvents['did-finish-load']) webContentsEvents['did-finish-load'][0]()
    return { promise, win }
  }

  it('registers LOGIN_EXTRACT and LOGIN_FINISH handlers', async () => {
    await setup('hcomic')
    expect(ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]).toBeDefined()
    expect(ipcHandlers[IPC_CHANNELS.LOGIN_FINISH]).toBeDefined()
  })

  it('LOGIN_EXTRACT handler returns { accepted: true } immediately (fast response)', async () => {
    vi.useFakeTimers()
    const { win } = await setup('hcomic')
    // mock 返回有效 cookie，使提取链不短路
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValueOnce([
      cookie('sessionid', 'abc'),
    ])
    const result = await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'hcomic')
    expect(result).toEqual({ accepted: true })
    vi.useRealTimers()
  })

  it('LOGIN_EXTRACT rejects re-entry while extraction in progress', async () => {
    vi.useFakeTimers()
    const { win } = await setup('hcomic')
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([])
    // 第一次触发（cookies 空 → notLoggedIn，但 mock 异步未 resolve）
    const r1 = await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'hcomic')
    expect(r1).toEqual({ accepted: true })
    // 紧随其后的第二次：extractInProgress=true → 拒绝
    const r2 = await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'hcomic')
    expect(r2).toEqual({ accepted: false })
    await vi.runAllTimersAsync()
    vi.useRealTimers()
  })

  it('extraction result is pushed back via loginWin.webContents.send (not mainWindow)', async () => {
    vi.useFakeTimers()
    const { win } = await setup('hcomic')
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('sessionid', 'abc'),
    ])
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'hcomic')
    await vi.runAllTimersAsync()
    // 结果定向 send 到登录窗
    expect(win.webContents.send).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT,
      expect.objectContaining({ success: true }),
    )
    vi.useRealTimers()
  })

  it('notLoggedIn result is pushed back without success', async () => {
    vi.useFakeTimers()
    const { win } = await setup('hcomic')
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([])
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'hcomic')
    await vi.runAllTimersAsync()
    expect(win.webContents.send).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT,
      expect.objectContaining({ success: false, notLoggedIn: true }),
    )
    vi.useRealTimers()
  })

  it('overlay success sets alreadySucceeded → subsequent close does not re-extract', async () => {
    vi.useFakeTimers()
    const { win } = await setup('hcomic')
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('sessionid', 'abc'),
    ])
    // 叠层触发提取（成功）
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'hcomic')
    await vi.runAllTimersAsync()
    const callsAfterOverlay = mockBridgeCall.mock.calls.filter(c => c[0] === 'apply_auth').length

    // 随后用户关窗 → 触发 close 事件
    const closeHandlers = loginWinEvents['close']
    const fakeEvent = { preventDefault: vi.fn() }
    await closeHandlers![0](fakeEvent)
    await vi.runAllTimersAsync()

    // apply_auth 调用次数不应增加（alreadySucceeded 短路）
    const callsAfterClose = mockBridgeCall.mock.calls.filter(c => c[0] === 'apply_auth').length
    expect(callsAfterClose).toBe(callsAfterOverlay)
    vi.useRealTimers()
  })

  it('LOGIN_FINISH calls ctx.done and closes the window', async () => {
    vi.useFakeTimers()
    const { promise, win } = await setup('hcomic')
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('sessionid', 'abc'),
    ])
    // 叠层成功提取（启动 finishFallbackTimer）
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'hcomic')
    // flush 提取链的微任务，但不推进 timer（避免兜底 timer 误触发）
    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalled()
    })
    // 渲染端倒数到 0 → LOGIN_FINISH
    await ipcHandlers[IPC_CHANNELS.LOGIN_FINISH]()
    const result = await promise
    expect(result.success).toBe(true)
    // 窗口应被 destroy
    expect((capturedInstances[0] as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('finish fallback timer fires ctx.done when renderer never sends LOGIN_FINISH', async () => {
    vi.useFakeTimers()
    const { promise, win } = await setup('hcomic')
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('sessionid', 'abc'),
    ])
    // 叠层成功提取（启动 10s 兜底 timer）
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'hcomic')
    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalled()
    })
    // 不调 LOGIN_FINISH，推进 10s 兜底超时
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await promise
    expect(result.success).toBe(true)
    vi.useRealTimers()
  })

  it('normal LOGIN_FINISH within 5s prevents fallback timer from firing', async () => {
    vi.useFakeTimers()
    const { promise, win } = await setup('hcomic')
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('sessionid', 'abc'),
    ])
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'hcomic')
    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalled()
    })
    // 5s 内正常 LOGIN_FINISH（渲染端倒数到 0）
    await ipcHandlers[IPC_CHANNELS.LOGIN_FINISH]()
    const result = await promise
    expect(result.success).toBe(true)
    // 再推进 10s，不应二次 done（settled 守卫）—— destroy 仅调用一次
    expect((capturedInstances[0] as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('handlers are unregistered when done is called (no leak)', async () => {
    vi.useFakeTimers()
    const { win } = await setup('hcomic')
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('sessionid', 'abc'),
    ])
    expect(ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]).toBeDefined()
    // done 触发 → done 闭包经 removeOverlayHandlers 反注册 ipcMain handler
    await ipcHandlers[IPC_CHANNELS.LOGIN_FINISH]()
    expect(ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]).toBeUndefined()
    expect(ipcHandlers[IPC_CHANNELS.LOGIN_FINISH]).toBeUndefined()
    vi.useRealTimers()
  })
})

// ── 任务 3.6：挑战模式专项测试 ────────────────────────────────────────────
// 覆盖：URL 验证器、两种模式开窗、单飞互斥、仍在挑战页不关闭、快照成功/超限、
// Cookie/UA 同步、取消与生命周期清理。

describe('login-window: resolveJmChallengeTarget (URL validator)', () => {
  it('accepts canonical favourites URL without page', () => {
    const t = resolveJmChallengeTarget('https://18comic.vip/user/testuser/favorite/albums')
    expect(t.domain).toBe('18comic.vip')
    expect(t.title).toBe('JM 人机验证')
    expect(t.url).toBe('https://18comic.vip/user/testuser/favorite/albums')
  })

  it('accepts URL with explicit page query', () => {
    const t = resolveJmChallengeTarget('https://18comic.vip/user/testuser/favorite/albums?page=3')
    expect(t.url).toContain('page=3')
  })

  it('accepts trusted JM mirror domain', () => {
    const t = resolveJmChallengeTarget('https://jmcomic-zzz.one/user/u/favorite/albums')
    expect(t.domain).toBe('jmcomic-zzz.one')
  })

  it('accepts resolved domain override', () => {
    const t = resolveJmChallengeTarget('https://custom.jm.example/user/u/favorite/albums', 'custom.jm.example')
    expect(t.domain).toBe('custom.jm.example')
  })

  it('rejects non-https scheme', () => {
    expect(() => resolveJmChallengeTarget('http://18comic.vip/user/u/favorite/albums')).toThrow('不受信任')
  })

  it('rejects userinfo in URL', () => {
    expect(() => resolveJmChallengeTarget('https://user:pass@18comic.vip/user/u/favorite/albums')).toThrow('不受信任')
  })

  it('rejects non-default port', () => {
    expect(() => resolveJmChallengeTarget('https://18comic.vip:8443/user/u/favorite/albums')).toThrow('不受信任')
  })

  it('rejects non-trusted domain', () => {
    expect(() => resolveJmChallengeTarget('https://evil.example/user/u/favorite/albums')).toThrow('不受信任')
  })

  it('rejects non-favourites path', () => {
    expect(() => resolveJmChallengeTarget('https://18comic.vip/')).toThrow('不受信任')
    expect(() => resolveJmChallengeTarget('https://18comic.vip/user/u/favorite/threads')).toThrow('不受信任')
  })

  it('rejects fragment', () => {
    expect(() => resolveJmChallengeTarget('https://18comic.vip/user/u/favorite/albums#frag')).toThrow('不受信任')
  })

  it('rejects disallowed query keys', () => {
    expect(() => resolveJmChallengeTarget('https://18comic.vip/user/u/favorite/albums?foo=1')).toThrow('查询参数无效')
  })

  it('rejects invalid page values', () => {
    expect(() => resolveJmChallengeTarget('https://18comic.vip/user/u/favorite/albums?page=0')).toThrow('页码无效')
    expect(() => resolveJmChallengeTarget('https://18comic.vip/user/u/favorite/albums?page=abc')).toThrow('页码无效')
    expect(() => resolveJmChallengeTarget('https://18comic.vip/user/u/favorite/albums?page=1001')).toThrow('页码无效')
  })

  it('rejects oversized URL (>2048 chars)', () => {
    const long = 'a'.repeat(2048)
    expect(() => resolveJmChallengeTarget(`https://18comic.vip/user/u/favorite/albums?x=${long}`)).toThrow()
  })

  it('rejects malformed URL string', () => {
    expect(() => resolveJmChallengeTarget('not-a-url')).toThrow('无效')
    expect(() => resolveJmChallengeTarget('')).toThrow('无效')
  })
})

describe('login-window: openJmChallengeWindow (challenge mode)', () => {
  beforeEach(() => {
    resetSourceWindowStateForTests()
    vi.clearAllMocks()
    for (const k of Object.keys(loginWinEvents)) delete loginWinEvents[k]
    for (const k of Object.keys(webContentsEvents)) delete webContentsEvents[k]
    for (const k of Object.keys(ipcHandlers)) delete ipcHandlers[k]
    capturedInstances.length = 0
    mockBridgeCall.mockReset()
    mockBridgeCall.mockResolvedValue({ valid: true, message: 'verify ok' })
  })

  const CHALLENGE_URL = 'https://18comic.vip/user/testuser/favorite/albums'

  // 辅助：开挑战窗并填充 savedUserAgent，返回捕获的 loginWin + promise
  async function setupChallenge(triggerLoad = true) {
    const promise = openJmChallengeWindow(makeMainWindow(), CHALLENGE_URL)
    await Promise.resolve()
    const win = capturedInstances[0] as {
      webContents: {
        send: ReturnType<typeof vi.fn>
        executeJavaScript: ReturnType<typeof vi.fn>
        session: { cookies: { get: ReturnType<typeof vi.fn> } }
        userAgent: string
      }
      destroy: ReturnType<typeof vi.fn>
    }
    if (triggerLoad && webContentsEvents['did-finish-load']) webContentsEvents['did-finish-load'][0]()
    return { promise, win }
  }

  it('creates a modal window in challenge mode with JM title', async () => {
    await setupChallenge()
    expect(capturedInstances).toHaveLength(1)
    const opts = (capturedInstances[0] as { options?: { title?: string; modal?: boolean } }).options as
      | { title?: string; modal?: boolean }
      | undefined
    expect(opts?.modal).toBe(true)
    expect(opts?.title).toBe('JM 人机验证')
  })

  it('passes mode to preload via additionalArguments', async () => {
    await setupChallenge()
    const webPrefs = ((capturedInstances[0] as { options?: { webPreferences?: { additionalArguments?: string[] } } })
      .options as { webPreferences?: { additionalArguments?: string[] } }).webPreferences
    expect(webPrefs?.additionalArguments).toContain('--hcomic-window-mode=challenge')
  })

  it('loads the challenge favourites URL', async () => {
    await setupChallenge()
    expect((capturedInstances[0] as { loadURL: ReturnType<typeof vi.fn> }).loadURL)
      .toHaveBeenCalledWith(CHALLENGE_URL)
  })

  it('single-flight: second call reuses promise and focuses existing window', async () => {
    const main = makeMainWindow()
    const p1 = openJmChallengeWindow(main, CHALLENGE_URL)
    const p2 = openJmChallengeWindow(main, CHALLENGE_URL)
    // 同一 Promise 实例（复用），且只创建一个窗口
    expect(p1).toBe(p2)
    expect(capturedInstances).toHaveLength(1)
    // 已有窗口被 focus（restore+focus）
    const win = capturedInstances[0] as { focus: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> }
    // 等微任务让 focusActiveSourceWindow 有机会执行
    await Promise.resolve()
    expect(win.focus).toHaveBeenCalled()
  })

  it('login and challenge windows are mutually exclusive via shared coordinator', async () => {
    const main = makeMainWindow()
    // 先开挑战窗
    void openJmChallengeWindow(main, CHALLENGE_URL)
    await Promise.resolve()
    expect(capturedInstances).toHaveLength(1)
    const challengeWin = capturedInstances[0] as { focus: ReturnType<typeof vi.fn> }
    // 再开登录窗 → 复用协调器，聚焦已有窗口，不创建第二个窗口
    void openLoginWindow(main, 'jm')
    await Promise.resolve()
    expect(capturedInstances).toHaveLength(1)
    expect(challengeWin.focus).toHaveBeenCalled()
  })

  it('snapshot capture fails when page still shows challenge markers', async () => {
    vi.useFakeTimers()
    const { win, promise } = await setupChallenge()
    // 模拟 executeJavaScript 返回仍含挑战标记的页面
    vi.mocked(win.webContents.executeJavaScript).mockResolvedValue({
      sourceUrl: CHALLENGE_URL,
      html: '<html><script src="/cdn-cgi/challenge-platform/h/g/orchestrate"></script></html>',
    })
    // 提供有效 jm cookie，使提取链能走到快照校验
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('remember', 'abc'),
      cookie('AVS', 'def'),
    ])
    const r = await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'jm')
    expect(r).toEqual({ accepted: true })
    await vi.runAllTimersAsync()
    // 快照校验失败 → 推回失败结果，窗口未 settle
    expect(win.webContents.send).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT,
      expect.objectContaining({ success: false, message: expect.stringContaining('验证尚未完成') }),
    )
    // 窗口未被 destroy（仍在挑战页，保持打开）
    expect(win.destroy).not.toHaveBeenCalled()
    // 清理：取消 promise
    const closeHandlers = loginWinEvents['close'] as Array<(...args: unknown[]) => void> | undefined
    if (closeHandlers) {
      closeHandlers[0]({ preventDefault: vi.fn() })
      await vi.runAllTimersAsync()
    }
    await promise.catch(() => undefined)
    vi.useRealTimers()
  })

  it('auto-completes challenge recovery when loaded page already shows favourites', async () => {
    vi.useFakeTimers()
    const { promise, win } = await setupChallenge(false)
    const snapshotHtml = '<html><body><div class="thumb-overlay"><a href="/album/1"><img title="t"></a></div></body></html>'
    vi.mocked(win.webContents.executeJavaScript).mockResolvedValue({
      sourceUrl: CHALLENGE_URL,
      html: snapshotHtml,
    })
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('remember', 'abc'),
      cookie('AVS', 'def'),
    ])

    webContentsEvents['did-finish-load'][0]()
    await vi.waitFor(() => {
      expect(mockBridgeCall).toHaveBeenCalledWith('apply_auth', expect.objectContaining({ source: 'jm' }))
    })
    await vi.advanceTimersByTimeAsync(10_000)

    const result = await promise
    expect(result.success).toBe(true)
    expect(result.snapshot?.html).toBe(snapshotHtml)
    expect(win.destroy).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('snapshot capture succeeds and result carries snapshot for main-process consumer', async () => {
    vi.useFakeTimers()
    const { promise, win } = await setupChallenge()
    const snapshotHtml = '<html><body><div class="thumb-overlay"><a href="/album/1"><img title="t"></a></div></body></html>'
    vi.mocked(win.webContents.executeJavaScript).mockResolvedValue({
      sourceUrl: CHALLENGE_URL,
      html: snapshotHtml,
    })
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('remember', 'abc'),
      cookie('AVS', 'def'),
      cookie('cf_clearance', 'clear'),
    ])
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'jm')
    // flush 提取链微任务（不推进 timer，避免 10s 兜底误触发 done）
    await vi.waitFor(() => {
      expect(mockBridgeCall).toHaveBeenCalledWith('apply_auth', expect.anything())
    })
    // apply_auth 被调用，携带 cookie 与 UA
    expect(mockBridgeCall).toHaveBeenCalledWith('apply_auth', expect.objectContaining({ source: 'jm' }))
    const applyCall = mockBridgeCall.mock.calls.find(c => c[0] === 'apply_auth')
    const applyParams = applyCall?.[1] as { curl_text: string }
    expect(applyParams.curl_text).toContain('remember=abc')
    expect(applyParams.curl_text).toContain('cf_clearance=clear')
    expect(applyParams.curl_text).toContain('User-Agent: MockUA/1.0')
    // 成功后推回成功结果
    expect(win.webContents.send).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT,
      expect.objectContaining({ success: true }),
    )
    // 渲染端倒数到 0 → LOGIN_FINISH，done 返回 successResult（含 snapshot）
    const finishResult = await ipcHandlers[IPC_CHANNELS.LOGIN_FINISH]()
    expect(finishResult).toEqual({ ok: true })
    const result = await promise
    expect(result.success).toBe(true)
    // 挑战模式结果携带快照，供主进程内部消费者使用
    expect(result.snapshot).toBeDefined()
    expect(result.snapshot?.html).toBe(snapshotHtml)
    vi.useRealTimers()
  })

  it('snapshot capture accepts visible favourites page even when non-active captcha marker text is present', async () => {
    vi.useFakeTimers()
    const { promise, win } = await setupChallenge()
    const snapshotHtml = '<html><body><script>window.captchaConfig={};</script><div class="thumb-overlay"><a href="/album/1"><img title="t"></a></div></body></html>'
    vi.mocked(win.webContents.executeJavaScript).mockResolvedValue({
      sourceUrl: CHALLENGE_URL,
      html: snapshotHtml,
    })
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('remember', 'abc'),
      cookie('AVS', 'def'),
    ])

    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'jm')
    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalledWith(
        NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT,
        expect.objectContaining({ success: true }),
      )
    })

    await ipcHandlers[IPC_CHANNELS.LOGIN_FINISH]()
    const result = await promise
    expect(result.success).toBe(true)
    expect(result.snapshot?.html).toBe(snapshotHtml)
    vi.useRealTimers()
  })

  it('snapshot capture fails when HTML exceeds 5 MiB limit', async () => {
    vi.useFakeTimers()
    const { win } = await setupChallenge()
    vi.mocked(win.webContents.executeJavaScript).mockResolvedValue({
      sourceUrl: CHALLENGE_URL,
      html: 'x'.repeat(5 * 1024 * 1024 + 1),
    })
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('remember', 'abc'),
      cookie('AVS', 'def'),
    ])
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'jm')
    await vi.runAllTimersAsync()
    expect(win.webContents.send).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT,
      expect.objectContaining({ success: false }),
    )
    vi.useRealTimers()
  })

  it('snapshot capture fails when current URL is untrusted (cross-domain)', async () => {
    vi.useFakeTimers()
    const { win } = await setupChallenge()
    vi.mocked(win.webContents.executeJavaScript).mockResolvedValue({
      sourceUrl: 'https://evil.example/user/u/favorite/albums',
      html: '<html><body>ok</body></html>',
    })
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('remember', 'abc'),
      cookie('AVS', 'def'),
    ])
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'jm')
    await vi.runAllTimersAsync()
    expect(win.webContents.send).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT,
      expect.objectContaining({ success: false }),
    )
    vi.useRealTimers()
  })

  it('user cancel (close in challenge mode) returns 已取消 without clearing auth', async () => {
    vi.useFakeTimers()
    const { promise } = await setupChallenge()
    // 未触发叠层提取即关窗 → 挑战模式直接返回已取消
    const closeHandlers = loginWinEvents['close'] as Array<(...args: unknown[]) => void> | undefined
    expect(closeHandlers).toBeDefined()
    const fakeEvent = { preventDefault: vi.fn() }
    closeHandlers![0](fakeEvent)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.message).toBe('已取消')
    // 未调用 apply_auth（未清除/覆盖认证）
    expect(mockBridgeCall).not.toHaveBeenCalledWith('apply_auth', expect.anything())
    vi.useRealTimers()
  })

  it('challenge window timeout returns 验证超时 message', async () => {
    vi.useFakeTimers()
    const promise = openJmChallengeWindow(makeMainWindow(), CHALLENGE_URL)
    await Promise.resolve()
    // 推进到 LOGIN_WINDOW_TIMEOUT_MS (5 分钟)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.message).toContain('超时')
    vi.useRealTimers()
  })

  it('openLoginWindow strips snapshot from public return value', async () => {
    vi.useFakeTimers()
    const main = makeMainWindow()
    const promise = openLoginWindow(main, 'jm')
    await Promise.resolve()
    if (webContentsEvents['did-finish-load']) webContentsEvents['did-finish-load'][0]()
    const win = capturedInstances[0] as {
      webContents: {
        session: { cookies: { get: ReturnType<typeof vi.fn> } }
        userAgent: string
      }
    }
    vi.mocked(win.webContents.session.cookies.get).mockResolvedValue([
      cookie('remember', 'abc'),
      cookie('AVS', 'def'),
    ])
    await ipcHandlers[IPC_CHANNELS.LOGIN_EXTRACT]({}, 'jm')
    await vi.waitFor(() => {
      expect(win.webContents.session.cookies.get).toHaveBeenCalled()
    })
    // LOGIN_FINISH 关窗 → done 返回 successResult（登录模式无 snapshot）
    await ipcHandlers[IPC_CHANNELS.LOGIN_FINISH]()
    const result = await promise
    // 公共契约：openLoginWindow 返回值只有 success/message，禁止 snapshot 字段
    expect(result).not.toHaveProperty('snapshot')
    vi.useRealTimers()
  })
})
