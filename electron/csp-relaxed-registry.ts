/**
 * 需要宽松 CSP（含 'unsafe-eval'）的 webContents 集合。
 *
 * 背景：Electron 的 session.webRequest 对同一事件只保留**单个监听器**，后注册
 * 的会覆盖先注册的（见 electron/electron#18301）。登录窗口与主窗口共用
 * default session，历史上 setupCSP（主窗口，全局）与 setupLoginWindowCSP（登录
 * 窗口，按 url 过滤）会互相覆盖，导致：
 *   - 登录窗口打开期间主窗口 CSP 监听器被覆盖、CSP 失效；
 *   - 登录窗口关闭后调用 removeCspHandler 把监听器置空，全局 CSP 永久丢失。
 *
 * 修复：保留单一全局 CSP 监听器（main.ts 的 setupCSP），通过此集合区分主窗口
 * 与登录窗口的 webContents，注入对应强度的 CSP。登录窗口在此注册自己，关闭时
 * 取消注册；全程不新增第二个 webRequest 监听器，杜绝覆盖回归。
 *
 * 用 WeakSet 而非 Set：webContents 销毁后自动失去引用，即使忘记取消注册也不会
 * 内存泄漏；注销函数仅做显式清理的对称收尾。
 */
const relaxedCspWebContents = new WeakSet<Electron.WebContents>()

/** 注册某 webContents 需要宽松 CSP（登录窗口专用）。 */
export function registerRelaxedCspWebContents(wc: Electron.WebContents): void {
  relaxedCspWebContents.add(wc)
}

/** 取消注册。webContents 销毁后集合会自动回收，此调用仅为对称收尾。 */
export function unregisterRelaxedCspWebContents(wc: Electron.WebContents): void {
  relaxedCspWebContents.delete(wc)
}

/** 全局 CSP 监听器查询：该 webContents 是否需要宽松策略。 */
export function needsRelaxedCsp(wc: Electron.WebContents | null | undefined): boolean {
  return !!wc && relaxedCspWebContents.has(wc)
}
