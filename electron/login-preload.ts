import { contextBridge, ipcRenderer } from 'electron'

// ── 叠层 IPC 通道（局部常量，不 import shared/types）────────────────────────
//
// 为什么不 import '../shared/types'：login-preload 与主 preload 共用 rollup
// 预构建。一旦 login-preload 引入 shared/types，rollup 会把 types 拆成共享 chunk
// （out/preload/chunks/types-*.cjs），主 preload.cjs 也会改为 require 该 chunk。
// 在 electron-vite dev 模式下此共享 chunk 解析会失败，导致主 preload 的
// contextBridge.exposeInMainWorld('hcomic', ...) 不执行 → window.hcomic undefined。
//
// 因此这里内联 3 个通道字符串。值必须与 shared/types.ts 的 IPC_CHANNELS /
// NOTIFICATION_CHANNELS 保持一致（手动同步，由 ipc-channel-consistency.test 守护）。
const LOGIN_EXTRACT_CHANNEL = 'login-extract'
const LOGIN_FINISH_CHANNEL = 'login-finish'
const LOGIN_EXTRACT_RESULT_CHANNEL = 'login-extract-result'

// ── 现有 main world prototype 补丁（保持不动）──────────────────────────────
// 必须在 main world 执行（影响页面脚本的全局原型），与下方的叠层注入
// （isolated world，用 ipcRenderer）职责分离。

function installMainWorldCompatibility(): void {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        const observerPrototype = window.MutationObserver?.prototype as
          | (MutationObserver & { __hcomicCompatInstalled?: boolean })
          | undefined

        if (observerPrototype && !observerPrototype.__hcomicCompatInstalled) {
          const nativeObserve = observerPrototype.observe
          Object.defineProperty(observerPrototype, '__hcomicCompatInstalled', {
            value: true,
            configurable: false,
            enumerable: false,
            writable: false,
          })

          observerPrototype.observe = function (
            this: MutationObserver,
            target: Node,
            options?: MutationObserverInit,
          ): void {
            if (!(target instanceof Node)) {
              const stack = new Error().stack || ''
              if (/jquery\.avs(?:-|\.|\/)/i.test(stack)) return
            }
            nativeObserve.call(this, target, options)
          }
        }

        // jm 的 jquery.avs 初始化异常会连带使底部"我的"入口失去响应。
        // 捕获期只兜底文字精确为"我的"的同源入口，其他按钮和站点行为不受影响。
        document.addEventListener('click', (event) => {
          if (!/(?:^|\.)18comic\.|(?:^|\.)jmcomic/i.test(location.hostname)) return
          const target = event.target
          if (!(target instanceof Element)) return

          const control = target.closest('a, button, [role="button"]')
          if (!control || control.textContent?.trim() !== '我的') return

          const rawHref = control instanceof HTMLAnchorElement
            ? control.getAttribute('href')
            : control.getAttribute('data-href')
          const destination = new URL(rawHref || '/user/', location.href)
          if (destination.origin !== location.origin) return

          event.preventDefault()
          event.stopImmediatePropagation()
          location.assign(destination.href)
        }, true)
      },
    })
  } catch (err) {
    // 兼容补丁是非关键路径；不得阻断后续叠层注入。
    console.warn('[HComicLoginOverlay] main-world compatibility patch skipped:', err)
  }
}

installMainWorldCompatibility()

// ── 登录弹窗叠层（isolated world，用 ipcRenderer）──────────────────────────
//
// 叠层承载显式的 cookie 提取入口：用户在第三方站点登录后点「我已登录」触发提取，
// 成功后倒数 3 秒自动关窗。与"关窗即提取"的隐式兜底并存。
//
// 隔离：Shadow DOM（closed mode）—— 第三方站点 CSS 穿不透、页面 JS 拿不到内部引用。
// 世界：本段跑在 isolated world（preload 顶层），可访问 ipcRenderer；DOM 节点与
//       main world 共享，故 shadow host 真实出现在页面上。

const OVERLAY_HOST_ID = 'hcomic-login-overlay'
/** 拖动位移阈值（px）：低于此值视为 click，超过视为拖动 */
const DRAG_THRESHOLD_PX = 4
/** 倒数起始秒数 */
const COUNTDOWN_START = 3
const WINDOW_MODE = process.argv.includes('--hcomic-window-mode=challenge') ? 'challenge' : 'login'

type OverlayState = 'idle' | 'expanded' | 'extracting' | 'counting'
type WindowMode = 'login' | 'challenge'

/** 按 location.hostname 推断 source，传给主进程提取 */
function inferSource(): string {
  const host = location.hostname.toLowerCase()
  if (/(?:^|\.)18comic\.(?:vip|org)|jmcomic/i.test(host)) return 'jm'
  if (/(?:^|\.)2026copy\.com|copymanga/i.test(host)) return 'copymanga'
  return 'hcomic'
}

/**
 * 注入叠层。幂等（host 已存在则跳过）；body 不存在时等 DOMContentLoaded。
 * 整体 try/catch：注入失败仅 console.error，不影响页面加载与上方 prototype 补丁。
 */
function injectOverlay(source: string, mode: WindowMode): void {
  try {
    if (document.getElementById(OVERLAY_HOST_ID)) return
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => injectOverlay(source, mode), { once: true })
      return
    }
    buildOverlay(source, mode)
  } catch (err) {
    console.error('[HComicLoginOverlay] inject failed:', err)
  }
}

/** 叠层自带样式（Shadow DOM 内 <style>，不依赖站点 CSS 变量） */
const OVERLAY_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .dot {
    width: 28px; height: 28px; border-radius: 50%;
    background: rgba(17,24,39,.92); backdrop-filter: blur(8px);
    border: 2px solid rgba(59,130,246,.9);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    color: #f9fafb; font-size: 14px; font-weight: 700;
    box-shadow: 0 2px 8px rgba(0,0,0,.3);
    transition: transform .12s ease;
    user-select: none;
  }
  .dot:hover { transform: scale(1.1); }
  .card {
    width: 220px; border-radius: 12px;
    background: rgba(17,24,39,.92); backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,.1);
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
    color: #f9fafb; padding: 14px; user-select: none;
  }
  .head { display: flex; align-items: center; justify-content: space-between; cursor: grab; margin-bottom: 8px; }
  .head:active { cursor: grabbing; }
  .head-title { font-size: 12px; font-weight: 600; opacity: .8; }
  .close { cursor: pointer; font-size: 16px; line-height: 1; opacity: .6; border: none; background: none; color: inherit; padding: 0 2px; }
  .close:hover { opacity: 1; }
  .hint { font-size: 12px; line-height: 1.5; margin-bottom: 10px; opacity: .85; min-height: 18px; }
  .hint.err { color: #ef4444; }
  .btn {
    width: 100%; padding: 8px 0; border-radius: 8px; border: none;
    background: #3b82f6; color: #fff; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: opacity .12s ease;
  }
  .btn:hover:not(:disabled) { opacity: .9; }
  .btn:disabled { opacity: .5; cursor: default; }
  .count-num { font-size: 40px; font-weight: 700; text-align: center; color: #10b981; margin: 6px 0; }
  .count-label { font-size: 12px; text-align: center; opacity: .85; margin-bottom: 10px; }
  .count-cancel { width: 100%; padding: 6px 0; border-radius: 8px; border: 1px solid rgba(255,255,255,.2);
    background: transparent; color: #f9fafb; font-size: 12px; cursor: pointer; }
  .count-cancel:hover { background: rgba(255,255,255,.08); }
  .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,.3);
    border-top-color: #fff; border-radius: 50%; animation: hcspin .8s linear infinite; vertical-align: middle; margin-right: 6px; }
  @keyframes hcspin { to { transform: rotate(360deg); } }
`

/** 构建叠层 DOM、状态机、事件绑定。仅在 host 不存在时调用。 */
function buildOverlay(source: string, mode: WindowMode): void {
  const host = document.createElement('div')
  host.id = OVERLAY_HOST_ID
  host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;'
  const shadow = host.attachShadow({ mode: 'closed' })

  const styleEl = document.createElement('style')
  styleEl.textContent = OVERLAY_STYLES
  shadow.appendChild(styleEl)

  // 结构容器：dot（收起态）/ card（其余态）共用此 mount 点
  const mount = document.createElement('div')
  shadow.appendChild(mount)

  let state: OverlayState = 'idle'
  let countdownTimer: ReturnType<typeof setInterval> | null = null
  let resultCleanup: (() => void) | null = null

  // ── 渲染函数 ──────────────────────────────────────────────
  function renderDot(): void {
    mount.innerHTML = ''
    const dot = document.createElement('div')
    dot.className = 'dot'
    dot.textContent = '✓'
    bindDrag(host, dot)
    dot.addEventListener('click', () => {
      if (state === 'idle') setState('expanded')
    })
    mount.appendChild(dot)
  }

  function renderCard(opts: {
    hint: string
    hintClass?: string
    btnText: string
    btnDisabled?: boolean
    btnSpinner?: boolean
    btnOnClick?: () => void
    extra?: HTMLElement
  }): void {
    mount.innerHTML = ''
    const card = document.createElement('div')
    card.className = 'card'

    const head = document.createElement('div')
    head.className = 'head'
    const title = document.createElement('span')
    title.className = 'head-title'
    title.textContent = mode === 'challenge' ? '验证助手' : '登录助手'
    const closeBtn = document.createElement('button')
    closeBtn.className = 'close'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => setState('idle'))
    head.appendChild(title)
    head.appendChild(closeBtn)
    bindDrag(host, head)
    card.appendChild(head)

    const hint = document.createElement('div')
    hint.className = 'hint' + (opts.hintClass ? ' ' + opts.hintClass : '')
    hint.textContent = opts.hint
    card.appendChild(hint)

    if (opts.extra) card.appendChild(opts.extra)

    if (opts.btnText) {
      const btn = document.createElement('button')
      btn.className = 'btn'
      btn.disabled = !!opts.btnDisabled
      if (opts.btnSpinner) {
        const sp = document.createElement('span')
        sp.className = 'spinner'
        btn.appendChild(sp)
        btn.appendChild(document.createTextNode(opts.btnText))
      } else {
        btn.textContent = opts.btnText
      }
      if (opts.btnOnClick && !opts.btnDisabled) {
        btn.addEventListener('click', opts.btnOnClick)
      }
      card.appendChild(btn)
    }

    mount.appendChild(card)
  }

  function renderExpanded(hintText: string, hintClass?: string): void {
    renderCard({
      hint: hintText,
      hintClass,
      btnText: mode === 'challenge' ? '我已完成验证' : '我已登录',
      btnOnClick: onExtractClick,
    })
  }

  function renderCounting(): void {
    let remaining = COUNTDOWN_START
    const numEl = document.createElement('div')
    numEl.className = 'count-num'
    numEl.textContent = String(remaining)
    const labelEl = document.createElement('div')
    labelEl.className = 'count-label'
    labelEl.textContent = `${remaining} 秒后自动关闭`

    renderCard({
      hint: mode === 'challenge' ? '✅ 验证成功' : '✅ 登录成功',
      btnText: '',
      extra: (() => {
        const wrap = document.createElement('div')
        wrap.appendChild(numEl)
        wrap.appendChild(labelEl)
        const cancel = document.createElement('button')
        cancel.className = 'count-cancel'
        cancel.textContent = '取消'
        cancel.addEventListener('click', cancelCountdown)
        wrap.appendChild(cancel)
        return wrap
      })(),
    })

    countdownTimer = setInterval(() => {
      remaining -= 1
      numEl.textContent = String(remaining)
      labelEl.textContent = `${remaining} 秒后自动关闭`
      if (remaining <= 0) {
        clearTimer()
        void ipcRenderer.invoke(LOGIN_FINISH_CHANNEL)
      }
    }, 1000)
  }

  // ── 状态切换 ──────────────────────────────────────────────
  function setState(next: OverlayState): void {
    state = next
    if (next === 'idle') renderDot()
    else if (next === 'expanded') {
      renderExpanded(mode === 'challenge' ? '完成站点人机验证后点此继续' : '登录后点此获取凭证')
    }
    else if (next === 'extracting') {
      renderCard({
        hint: mode === 'challenge' ? '正在确认验证状态…' : '正在获取凭证…',
        btnText: mode === 'challenge' ? '确认中' : '提取中',
        btnDisabled: true,
        btnSpinner: true,
      })
    } else if (next === 'counting') {
      renderCounting()
    }
  }

  // ── 事件处理 ──────────────────────────────────────────────
  function onExtractClick(): void {
    if (state !== 'expanded') return
    setState('extracting')
    // invoke 仅拿 accepted 快响应；结果由 LOGIN_EXTRACT_RESULT 推送
    void ipcRenderer.invoke(LOGIN_EXTRACT_CHANNEL, source).catch((err) => {
      console.error('[HComicLoginOverlay] LOGIN_EXTRACT invoke failed:', err)
      setState('expanded')
      renderExpanded('请求失败，请重试', 'err')
    })
  }

  function onExtractResult(_event: unknown, payload: { success: boolean; message?: string; notLoggedIn?: boolean }): void {
    if (payload.success) {
      setState('counting')
      return
    }
    if (payload.notLoggedIn) {
      setState('expanded')
      renderExpanded(mode === 'challenge' ? '未检测到登录状态，请先在当前窗口登录' : '未检测到登录状态', 'err')
      return
    }
    // 其他失败：显示后端返回的 message
    setState('expanded')
    renderExpanded(payload.message || '获取失败，请重试', 'err')
  }

  function cancelCountdown(): void {
    clearTimer()
    setState('expanded')
  }

  function clearTimer(): void {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  // 订阅提取结果（页面卸载/导航时清理，避免泄漏 + 重复绑定）
  const resultHandler = (_e: unknown, payload: unknown) => onExtractResult(_e, payload as Parameters<typeof onExtractResult>[1])
  ipcRenderer.on(LOGIN_EXTRACT_RESULT_CHANNEL, resultHandler)
  resultCleanup = () => {
    ipcRenderer.removeListener(LOGIN_EXTRACT_RESULT_CHANNEL, resultHandler)
  }

  // 初始渲染
  setState('idle')

  document.body.appendChild(host)

  // 页面卸载时清理（导航重注入 preload 时旧 listener 会随帧销毁，此处兜底）
  window.addEventListener('pagehide', () => {
    clearTimer()
    if (resultCleanup) resultCleanup()
  })
}

/**
 * 为 host 绑定拖动（pointer 事件）。dragHandle 是触发拖动的子元素（圆点/卡片顶栏）。
 * 位移阈值区分 click 与拖动：超阈值更新 host.top/left 并标记吞掉后续 click。
 */
function bindDrag(host: HTMLElement, dragHandle: HTMLElement): void {
  let startX = 0
  let startY = 0
  let dragging = false
  let moved = false

  dragHandle.addEventListener('pointerdown', (e: PointerEvent) => {
    // 仅响应主键；不抢占按钮/链接的交互
    if (e.button !== 0) return
    startX = e.clientX
    startY = e.clientY
    dragging = true
    moved = false
  })

  dragHandle.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    moved = true
    // host 左上角跟随指针移动量；改 left 锚定，清除 right 避免拉伸
    const rect = host.getBoundingClientRect()
    host.style.left = `${rect.left + dx}px`
    host.style.top = `${rect.top + dy}px`
    host.style.right = 'auto'
    startX = e.clientX
    startY = e.clientY
  })

  const endDrag = () => {
    if (!dragging) return
    dragging = false
    // 若发生过拖动，阻止紧随其后的 click（防止拖动结束误触展开/收起）
    if (moved) {
      const swallow = (ev: Event) => {
        ev.stopPropagation()
        ev.preventDefault()
        dragHandle.removeEventListener('click', swallow, true)
      }
      dragHandle.addEventListener('click', swallow, true)
    }
  }
  dragHandle.addEventListener('pointerup', endDrag)
  dragHandle.addEventListener('pointercancel', endDrag)
}

// preload 顶层执行：注入叠层
try {
  injectOverlay(inferSource(), WINDOW_MODE)
} catch (err) {
  console.error('[HComicLoginOverlay] bootstrap failed:', err)
}
