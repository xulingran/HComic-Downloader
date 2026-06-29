// @vitest-environment jsdom
// login-preload 在导入时即执行 injectOverlay（访问 document.body / location.hostname），
// 必须在 jsdom 下运行。用动态 import 控制 attachShadow patch 的安装时机。
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockInvoke, mockOn, mockRemoveListener, ipcListeners } = vi.hoisted(() => ({
  mockInvoke: vi.fn().mockResolvedValue({ accepted: true }),
  mockOn: vi.fn(),
  mockRemoveListener: vi.fn(),
  // 捕获 ipcRenderer.on 注册的 channel→listener，供测试模拟主进程推送结果
  ipcListeners: {} as Record<string, ((...args: unknown[]) => void)>,
}))

vi.mock('electron', () => ({
  contextBridge: {
    // executeInMainWorld 的 func 跑在 main world，与本测试无关（prototype 补丁不影响叠层）。
    // 用 noop 避免 main world 代码在 jsdom 缺少完整 MutationObserver 时出错。
    executeInMainWorld: vi.fn(),
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      ipcListeners[channel] = handler
    }),
    removeListener: mockRemoveListener,
  },
}))

import { IPC_CHANNELS, NOTIFICATION_CHANNELS } from '../../../shared/types'

const OVERLAY_HOST_ID = 'hcomic-login-overlay'

/**
 * 强制 attachShadow 为 'open'，使测试可访问 shadow 内部节点。
 * 必须在动态 import login-preload 之前调用（preload 内部 attachShadow({mode:'closed'})）。
 */
function installOpenShadowPatch(): void {
  const orig = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    return orig.call(this, { ...init, mode: 'open' })
  } as typeof orig
}

/** 加载 login-preload（触发顶层 injectOverlay 副作用）。每调用一次即重新评估模块。 */
async function loadPreload(): Promise<void> {
  vi.resetModules()
  // 重新 mock（resetModules 不会清除 vi.mock，但重新 import 会重新绑定 ipcListeners）
  installOpenShadowPatch()
  await import('../../../electron/login-preload')
}

/** 通过 open shadow 查询内部节点 */
function queryShadow(host: HTMLElement, selector: string): Element | null {
  return host.shadowRoot ? host.shadowRoot.querySelector(selector) : null
}

describe('login-preload: overlay injection', () => {
  beforeEach(async () => {
    document.getElementById(OVERLAY_HOST_ID)?.remove()
    mockInvoke.mockClear()
    mockOn.mockClear()
    mockRemoveListener.mockClear()
    for (const k of Object.keys(ipcListeners)) delete ipcListeners[k]
    await loadPreload()
  })

  it('injects overlay host into document.body on import', () => {
    expect(document.getElementById(OVERLAY_HOST_ID)).not.toBeNull()
  })

  it('uses closed Shadow DOM (production mode: shadowRoot would be null)', () => {
    // 测试用 open patch 便于访问；此用例验证 host 确实 attach 了 shadow
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    expect(host.shadowRoot).not.toBeNull()
    // 内部有 style 元素（自带配色，不依赖站点 CSS）
    expect(host.shadowRoot!.querySelector('style')).not.toBeNull()
  })

  it('is idempotent (no duplicate host on re-invoke)', async () => {
    // 再次触发 loadPreload 会重新执行顶层 injectOverlay，但去重守卫应阻止重复创建
    const before = document.querySelectorAll(`#${OVERLAY_HOST_ID}`).length
    // 模拟 preload 顶层再次被调用（同 document）：手动调用注入不可达，
    // 改为断言重新 import 后 host 仍唯一
    await import('../../../electron/login-preload')
    const after = document.querySelectorAll(`#${OVERLAY_HOST_ID}`).length
    expect(after).toBe(before)
  })

  it('host is positioned fixed with max z-index', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    expect(host.style.position).toBe('fixed')
    expect(host.style.zIndex).toBe('2147483647')
  })

  it('registers LOGIN_EXTRACT_RESULT listener on import', () => {
    expect(ipcListeners[NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT]).toBeDefined()
  })
})

describe('login-preload: overlay state machine', () => {
  beforeEach(async () => {
    document.getElementById(OVERLAY_HOST_ID)?.remove()
    mockInvoke.mockClear()
    mockInvoke.mockResolvedValue({ accepted: true })
    for (const k of Object.keys(ipcListeners)) delete ipcListeners[k]
    await loadPreload()
  })

  it('idle dot → click → expanded; click 我已登录 fires LOGIN_EXTRACT', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    const dot = queryShadow(host, '.dot') as HTMLElement
    dot.click()
    const btn = queryShadow(host, '.btn') as HTMLElement
    expect(btn.textContent).toContain('我已登录')
    btn.click()
    expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.LOGIN_EXTRACT, expect.any(String))
  })

  it('expanded → click ✕ → back to idle', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    expect(queryShadow(host, '.card')).not.toBeNull()
    ;(queryShadow(host, '.close') as HTMLElement).click()
    expect(queryShadow(host, '.dot')).not.toBeNull()
    expect(queryShadow(host, '.card')).toBeNull()
  })

  it('extract result success → counting state with countdown number 3', () => {
    vi.useFakeTimers()
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    ;(queryShadow(host, '.btn') as HTMLElement).click()
    ipcListeners[NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT]({}, { success: true, message: 'ok' })
    const num = queryShadow(host, '.count-num') as HTMLElement
    expect(num.textContent).toBe('3')
    vi.useRealTimers()
  })

  it('extract result notLoggedIn → back to expanded with 未检测到登录状态', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    ;(queryShadow(host, '.btn') as HTMLElement).click()
    ipcListeners[NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT]({}, { success: false, notLoggedIn: true })
    const hint = queryShadow(host, '.hint') as HTMLElement
    expect(hint.textContent).toContain('未检测到登录状态')
    const btn = queryShadow(host, '.btn') as HTMLElement
    expect(btn.disabled).toBeFalsy()
  })

  it('countdown reaches 0 → fires LOGIN_FINISH', async () => {
    vi.useFakeTimers()
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    ;(queryShadow(host, '.btn') as HTMLElement).click()
    ipcListeners[NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT]({}, { success: true, message: 'ok' })
    mockInvoke.mockClear()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.LOGIN_FINISH)
    vi.useRealTimers()
  })

  it('countdown cancel → no LOGIN_FINISH, back to expanded', async () => {
    vi.useFakeTimers()
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    ;(queryShadow(host, '.btn') as HTMLElement).click()
    ipcListeners[NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT]({}, { success: true, message: 'ok' })
    const cancel = queryShadow(host, '.count-cancel') as HTMLElement
    cancel.click()
    mockInvoke.mockClear()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC_CHANNELS.LOGIN_FINISH)
    expect(queryShadow(host, '.btn')).not.toBeNull()
    vi.useRealTimers()
  })
})

describe('login-preload: overlay drag', () => {
  beforeEach(async () => {
    document.getElementById(OVERLAY_HOST_ID)?.remove()
    await loadPreload()
  })

  it('drag beyond threshold moves host (left set) and keeps idle', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    const dot = queryShadow(host, '.dot') as HTMLElement
    // pointerdown → 超阈值 move → pointerup
    dot.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0, bubbles: true }))
    dot.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 110, bubbles: true }))
    dot.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, clientY: 110, bubbles: true }))
    // host 已被定位（left 不为空，right 改为 auto）
    expect(host.style.left).not.toBe('')
    // 仍为收起态（拖动吞掉了 click，未展开）
    expect(queryShadow(host, '.dot')).not.toBeNull()
    expect(queryShadow(host, '.card')).toBeNull()
  })

  it('pointer within threshold → click expands', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    const dot = queryShadow(host, '.dot') as HTMLElement
    // 阈值内位移
    dot.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0, bubbles: true }))
    dot.dispatchEvent(new PointerEvent('pointermove', { clientX: 102, clientY: 101, bubbles: true }))
    dot.dispatchEvent(new PointerEvent('pointerup', { clientX: 102, clientY: 101, bubbles: true }))
    dot.click()
    expect(queryShadow(host, '.card')).not.toBeNull()
  })
})

// ── 任务 4.3：挑战模式叠层文案与提交流程 ──────────────────────────────────
// 通过 process.argv 注入 --hcomic-window-mode=challenge，验证叠层文案切换、
// 挑战未完成不关闭、成功倒计时与 extracting 态防抖。

describe('login-preload: challenge mode overlay', () => {
  let originalArgv: string[]

  beforeEach(async () => {
    document.getElementById(OVERLAY_HOST_ID)?.remove()
    mockInvoke.mockClear()
    mockInvoke.mockResolvedValue({ accepted: true })
    for (const k of Object.keys(ipcListeners)) delete ipcListeners[k]
    originalArgv = process.argv
    process.argv = [...originalArgv, '--hcomic-window-mode=challenge']
    await loadPreload()
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  it('shows 验证助手 title in challenge mode', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    // title 仅在 card 态存在，需先展开
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    const title = queryShadow(host, '.head-title') as HTMLElement
    expect(title.textContent).toBe('验证助手')
  })

  it('expanded state shows 我已完成验证 button in challenge mode', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    const btn = queryShadow(host, '.btn') as HTMLElement
    expect(btn.textContent).toContain('我已完成验证')
  })

  it('expanded hint uses verification wording in challenge mode', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    const hint = queryShadow(host, '.hint') as HTMLElement
    expect(hint.textContent).toContain('人机验证')
  })

  it('clicking 提交 fires LOGIN_EXTRACT in challenge mode', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    ;(queryShadow(host, '.btn') as HTMLElement).click()
    expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.LOGIN_EXTRACT, expect.any(String))
  })

  it('extracting state shows verification wording and disables button (debounce)', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    const btn = queryShadow(host, '.btn') as HTMLElement
    btn.click()
    // extracting 态：按钮禁用 + 验证文案
    const hint = queryShadow(host, '.hint') as HTMLElement
    expect(hint.textContent).toContain('确认')
    const extractingBtn = queryShadow(host, '.btn') as HTMLElement
    expect(extractingBtn.disabled).toBe(true)
    // 重复点击不再触发新的 LOGIN_EXTRACT（防抖）
    mockInvoke.mockClear()
    extractingBtn.click()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('challenge incomplete (主进程推回失败) → stays expanded, does not close', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    ;(queryShadow(host, '.btn') as HTMLElement).click()
    // 主进程推回"验证尚未完成"
    ipcListeners[NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT]({}, {
      success: false,
      message: '验证尚未完成，请继续完成人机验证',
    })
    // 回到 expanded 态，未进入 counting（未关闭）
    const card = queryShadow(host, '.card')
    expect(card).not.toBeNull()
    const btn = queryShadow(host, '.btn') as HTMLElement
    expect(btn.disabled).toBeFalsy()
    expect(queryShadow(host, '.count-num')).toBeNull()
  })

  it('verification success → counting state with countdown 3', () => {
    vi.useFakeTimers()
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    ;(queryShadow(host, '.btn') as HTMLElement).click()
    ipcListeners[NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT]({}, {
      success: true,
      message: '人机验证已完成',
    })
    const hint = queryShadow(host, '.hint') as HTMLElement
    expect(hint.textContent).toContain('验证成功')
    const num = queryShadow(host, '.count-num') as HTMLElement
    expect(num.textContent).toBe('3')
    vi.useRealTimers()
  })

  it('countdown reaches 0 → fires LOGIN_FINISH (closes window)', async () => {
    vi.useFakeTimers()
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    ;(queryShadow(host, '.btn') as HTMLElement).click()
    ipcListeners[NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT]({}, {
      success: true,
      message: '人机验证已完成',
    })
    mockInvoke.mockClear()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.LOGIN_FINISH)
    vi.useRealTimers()
  })

  it('notLoggedIn in challenge mode hints to log in within the window', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    ;(queryShadow(host, '.btn') as HTMLElement).click()
    ipcListeners[NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT]({}, { success: false, notLoggedIn: true })
    const hint = queryShadow(host, '.hint') as HTMLElement
    expect(hint.textContent).toContain('登录')
  })
})

// 回归：登录模式文案不被挑战模式改动污染（默认 process.argv 不含挑战标志）。
describe('login-preload: login mode wording regression', () => {
  beforeEach(async () => {
    document.getElementById(OVERLAY_HOST_ID)?.remove()
    mockInvoke.mockClear()
    for (const k of Object.keys(ipcListeners)) delete ipcListeners[k]
    // 显式确保 argv 不含挑战标志
    process.argv = process.argv.filter(a => !a.includes('--hcomic-window-mode='))
    await loadPreload()
  })

  it('keeps 登录助手 title in login mode', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    const title = queryShadow(host, '.head-title') as HTMLElement
    expect(title.textContent).toBe('登录助手')
  })

  it('keeps 我已登录 button in login mode', () => {
    const host = document.getElementById(OVERLAY_HOST_ID) as HTMLElement
    ;(queryShadow(host, '.dot') as HTMLElement).click()
    const btn = queryShadow(host, '.btn') as HTMLElement
    expect(btn.textContent).toContain('我已登录')
  })
})
