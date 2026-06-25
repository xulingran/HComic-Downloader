import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, crashReporter } from 'electron'
import fs from 'fs'
import path from 'path'
import { getPythonBridge } from './python-bridge'
import { checkForUpdates } from './update-checker'
import { NotificationManager } from './notification-manager'
import { openLoginWindow } from './login-window'
import { needsRelaxedCsp } from './csp-relaxed-registry'
import { initLogging } from './log-init'
import { buildDiagnostics } from './diagnostics'
import {
  SEARCH_MODES, SOURCE_VALUES,
  DOWNLOAD_STATUSES, ACTIVE_DOWNLOAD_STATUSES, IMAGE_QUALITIES,
  IPC_CHANNELS, NOTIFICATION_CHANNELS, PYTHON_NOTIFICATION_METHODS,
  type DownloadProgressEvent,
  type DeepLinkTarget,
} from '../shared/types'
import {
  type Validator,
  ValidationError,
  string,
  number,
  boolean,
  object,
  integer,
  maxLength,
  length,
  range,
  minValue,
  oneOf,
  and,
  noControlChars,
  noPathSeparators,
  noPathTraversal,
  absolutePath,
  assert,
  withOptionalSource,
  tagBlacklist as tagBlacklistValidator,
  duplicateBlacklist as duplicateBlacklistValidator,
  missingBlacklist as missingBlacklistValidator,
} from './validators'

// 初始化日志：必须在最早阶段执行，以捕获启动期异常并接管 console.*
initLogging()

// ── Windows crash workarounds ──
// Prevent Windows Code Integrity from killing renderer/gpu processes on
// certain configurations (common cause of silent "no terminal output" crashes).
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity')
app.commandLine.appendSwitch('disable-gpu-sandbox')

// Crash reporter captures native crash dumps for post-mortem analysis.
try {
  crashReporter.start({ uploadToServer: false })
} catch { /* crash reporter unsupported in this build */ }

let mainWindow: BrowserWindow | null = null

/**
 * 启动进度缓存：记录 Python 经 stderr 推送的最新进度。
 *
 * 为什么需要：渲染进程的订阅者（index.html 原生 JS、React useStartupProgress）
 * 注册时机晚于部分 PROGRESS 事件（Python 极快就绪时，事件在 React 挂载前就发完），
 * 纯 push 模型会丢失历史事件导致进度条卡在 0%。did-finish-load 时重发此缓存值，
 * 让后注册的订阅者也能立即拿到最新进度（pull 初始 + push 增量混合模式）。
 *
 * 缓存值 null 表示尚未收到任何 PROGRESS（did-finish-load 时发送默认初始进度）。
 */
let latestStartupProgress: { percent: number; label: string } | null = null
/**
 * 应用关闭状态机，合并原 isQuitting / shutdownDone 两个布尔标志：
 * - 'running'：正常运行
 * - 'quitting'：已进入 before-quit，正在等待 Python 后端优雅关闭
 * - 'done'：关闭流程已收尾，即将真正退出
 *
 * 单一状态避免双标志的冗余与组合歧义（如 isQuitting=true & shutdownDone=true
 * 这种不应出现的中间态）。
 */
type ShutdownState = 'running' | 'quitting' | 'done'
let shutdownState: ShutdownState = 'running'
const notificationManager = new NotificationManager()

const CLOSE_GET_DOWNLOADS_TIMEOUT_MS = 3_000
const DEV_SERVER_MAX_RETRIES = 5
const DEV_SERVER_RETRY_DELAY_MS = 1_000
const SHUTDOWN_TIMEOUT_MS = 5_000
/** 应用启动后延迟多久执行首次更新检查（避开启动高负载期） */
const STARTUP_UPDATE_CHECK_DELAY_MS = 3_000

const ALLOWED_EXTERNAL_DOMAINS = [
  'github.com',
  'h-comic.com',
  'moeimg.net',
  'moeimg.fan',
  '18comic.vip',
  '18comic.org',
  'jmcomic.me',
  // jm mirror domains — need periodic maintenance as mirrors change frequently
  'jmcomic-zzz.one',
  'jmcomic-zzz.xyz',
  'jmcomic-ne.net',
  'comic18j-robo.me',
  '18comic-cpp.com',
]

/** Image server domains that need Referer injection, mapped to their Referer origin. */
const REFERER_OVERRIDES: Record<string, string> = {
  'h-comic.link': 'https://h-comic.com/',
  'moeimg.fan': 'https://moeimg.fan/',
}

/** Dynamic jm CDN domain, updated from Python backend config. */
let jmCdnDomain: string | null = null
/** Dynamic jm main domain, updated from Python backend config. */
let jmMainDomain: string | null = null

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/

const CBZ_TEMPLATE_ALLOWED_PLACEHOLDERS = ['{author}', '{title}', '{id}']

function validateBraces(template: string): boolean {
  let depth = 0
  for (let i = 0; i < template.length; i++) {
    if (template[i] === '{') {
      if (i + 1 < template.length && template[i + 1] === '{') { i++; continue }
      depth++
    } else if (template[i] === '}') {
      if (i + 1 < template.length && template[i + 1] === '}') { i++; continue }
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

function validatePlaceholders(template: string): boolean {
  if (/\{\}/.test(template)) return false
  const parts = template.match(/\{[^{}]+\}/g) || []
  return parts.every(p => CBZ_TEMPLATE_ALLOWED_PLACEHOLDERS.includes(p))
}

const cbzTemplateValidator = and(
  string(),
  length(1, 256),
  noPathSeparators(),
  noPathTraversal(),
  (v): v is string => validateBraces(v as string) && validatePlaceholders(v as string),
)

const downloadDirValidator = and(
  string(),
  length(1, 1024),
  noPathTraversal(),
  noControlChars(),
  absolutePath(),
)

const MODE_VALUES = new Set<string>(SEARCH_MODES)
// SOURCE_VALUES 由 shared/types.ts 派生提供，避免本地重复 new Set(COMIC_SOURCES)

// ── Composable field-level comic validators ──────────────────────────────

const comicIdValidator = and(string(), length(1, 256), noPathSeparators(), noPathTraversal(), noControlChars())

const tagsValidator: Validator<string[]> = (value): value is string[] => {
  if (!Array.isArray(value) || value.length > 100) {
    throw new ValidationError('Invalid comicData.tags')
  }
  return value.every(t => {
    try { return and(string(), maxLength(64))(t) }
    catch { return false }
  })
}

function validateDownloadPayload(comicId: unknown, comicData: unknown) {
  assert(comicIdValidator, comicId, 'download comicId')
  assert(object(), comicData, 'download comicData')
  const data = comicData as Record<string, unknown>

  assert(and(string(), length(1, 256)), data.title, 'comicData.title')

  if (data.pages !== undefined) {
    assert(and(number(), integer(), range(0, 100000)), data.pages, 'comicData.pages')
  }

  if (data.mediaId !== undefined && data.mediaId !== null) {
    assert(and(string(), maxLength(256)), data.mediaId, 'comicData.mediaId')
  }

  assert(and(string(), length(1, 64), noControlChars()), data.source, 'comicData.source')

  if (data.sourceSite !== undefined && data.sourceSite !== null) {
    assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), data.sourceSite, 'comicData.sourceSite')
  }

  if (data.tags !== undefined && data.tags !== null) {
    assert(tagsValidator, data.tags, 'comicData.tags')
  }

  if (data.author !== undefined && data.author !== null) {
    assert(and(string(), maxLength(256)), data.author, 'comicData.author')
  }
}

function validateDownloadProgress(params: unknown): DownloadProgressEvent {
  assert(object(), params, 'download progress params')
  const p = params as Record<string, unknown>

  assert(and(string(), length(1, 256)), p.taskId, 'download progress: taskId')
  assert(and(string(), oneOf(DOWNLOAD_STATUSES)), p.status, 'download progress: status')
  assert(and(number(), range(0, 100)), p.progress, 'download progress: progress')
  assert(and(number(), integer(), minValue(0)), p.current, 'download progress: current')
  assert(and(number(), integer(), minValue(0)), p.total, 'download progress: total')

  assert(and(string(), length(1, 256)), p.title, 'download progress: title')

  let current = p.current
  if (typeof p.current === 'number' && typeof p.total === 'number' && current > p.total) {
    console.warn(`Invalid download progress: current (${current}) exceeds total (${p.total}), clamping for task ${p.taskId}`)
    current = p.total
  }
  return { ...p, current } as unknown as DownloadProgressEvent
}

const CONFIG_VALIDATORS: Record<string, Validator<unknown>> = {
  themeMode: and(string(), oneOf(['light', 'dark', 'auto'] as const)),
  outputFormat: and(string(), oneOf(['folder', 'zip', 'cbz'] as const)),
  downloadDir: downloadDirValidator,
  concurrentDownloads: and(number(), integer(), range(1, 10)),
  timeout: and(number(), range(5, 300)),
  retryTimes: and(number(), integer(), range(0, 10)),
  cbzFilenameTemplate: cbzTemplateValidator,
  batchDownloadDelay: and(number(), range(0, 60)),
  autoRetryMaxAttempts: and(number(), integer(), range(0, 5)),
  notifyOnComplete: boolean(),
  notifyWhenForeground: and(string(), oneOf(['inactive', 'always'] as const)),
  defaultSource: and(string(), oneOf(Array.from(SOURCE_VALUES) as readonly string[])),
  fontName: and(string(), maxLength(128)),
  fontSize: and(number(), integer(), range(12, 20)),
  sfwMode: boolean(),
  cardStyle: and(string(), oneOf(['cover', 'detailed'] as const)),
  tagBlacklist: tagBlacklistValidator(),
  duplicateBlacklist: duplicateBlacklistValidator(),
  missingBlacklist: missingBlacklistValidator(),
  previewCacheSizeLimitMB: and(number(), integer(), range(100, 2048)),
  jmDomain: and(string(), maxLength(256)),
  favouriteTagHighlight: boolean(),
  favouriteTagMinMatches: and(number(), integer(), range(1, 10)),
  checkUpdateOnStart: boolean(),
  bikaImageQuality: and(string(), oneOf(IMAGE_QUALITIES)),
  previewPreloadForward: and(number(), integer(), range(0, 30)),
  previewPreloadBackward: and(number(), integer(), range(0, 10)),
  previewPreloadConcurrency: and(number(), integer(), range(1, 6)),
  previewPreloadAdaptive: boolean(),
}

// ── Reusable validation helpers ──────────────────────────────────────────

const taskIdValidator = and(string(), length(1, 256))

function validateTaskId(id: unknown, label = 'taskId'): asserts id is string {
  assert(taskIdValidator, id, label)
}

/**
 * 校验目录路径并在系统文件管理器中打开。
 *
 * 共享「打开下载目录」与「打开缓存目录」的安全校验：绝对路径、无路径遍历、
 * 无控制字符、必须是已存在目录。任一校验失败即抛错，绝不调用 openPath。
 * `label` 仅用于区分错误文案与日志语义（download / cache），二者校验等价。
 */
async function openDirectoryInFileManager(dirPath: unknown, label: string): Promise<{ success: boolean }> {
  assert(downloadDirValidator, dirPath, 'directory path')
  let stats: fs.Stats
  try {
    stats = fs.statSync(dirPath)
  } catch (err) {
    // 区分"路径不存在"（高频、可恢复）与其他 stat 失败（权限不足、路径过长），
    // 给用户可行动的错误提示。
    // 注意：不用 new Error(msg, { cause }) 第二参数形式——项目 tsconfig lib 是 ES2020，
    // 缺少 ES2022.Error 库，构造器第二参数会触发 TS2554，直接 .cause 赋值触发 TS2500。
    // 用 Object.assign 注入 cause，行为等价（Node 运行时原生支持 Error.prototype.cause），
    // 且不依赖 lib 升级、不需要 cast。
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw Object.assign(new Error(`${label} directory does not exist: ${dirPath}`), { cause: err })
    }
    throw Object.assign(new Error(`Cannot access directory: ${dirPath}`), { cause: err })
  }
  if (!stats.isDirectory()) throw new Error(`Path is not a directory: ${dirPath}`)
  const errorMsg = await shell.openPath(dirPath)
  if (errorMsg) {
    throw new Error(`Failed to open directory: ${errorMsg}`)
  }
  return { success: true }
}

function validateUrlFormat(url: unknown, label = 'URL', maxLength = 2048): asserts url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > maxLength) {
    throw new Error(`Invalid ${label}`)
  }
  try { new URL(url) } catch { throw new Error(`Invalid ${label} format`) }
}

function validateHttpsUrlWithDomains(
  url: unknown,
  allowedDomains: string[],
  label = 'URL',
  maxLength = 2048,
): asserts url is string {
  validateUrlFormat(url, label, maxLength)
  const parsed = new URL(url as string)
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed')
  if (!allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
    throw new Error('Domain not allowed')
  }
}

function validateComicObject(data: unknown): asserts data is Record<string, unknown> {
  assert(object(), data, 'comic data')
}

function loadWithRetry(win: BrowserWindow, url: string, attempt = 0) {
  const onFail = () => {
    if (win.isDestroyed()) return
    if (attempt >= DEV_SERVER_MAX_RETRIES) {
      console.error(`Dev server failed to load after ${DEV_SERVER_MAX_RETRIES} retries`)
      win.show()
      return
    }
    console.log(`Dev server not ready, retrying (${attempt + 1}/${DEV_SERVER_MAX_RETRIES})...`)
    setTimeout(() => {
      if (!win.isDestroyed()) {
        loadWithRetry(win, url, attempt + 1)
      }
    }, DEV_SERVER_RETRY_DELAY_MS)
  }
  win.webContents.once('did-fail-load', onFail)
  win.webContents.once('did-finish-load', () => {
    win.webContents.removeListener('did-fail-load', onFail)
  })
  win.loadURL(url).catch(() => {})
}

/**
 * 需要宽松 CSP（含 'unsafe-eval'）的 webContents 集合 —— 登录窗口加载的第三方
 * SPA（Auth0 / h-comic / jm 镜像）需要在 script-src 中放宽 'unsafe-eval'。
 *
 * 关键约束：Electron 的 session.webRequest 对同一事件只保留**单个监听器**，
 * 后注册的会覆盖先注册的（见 electron/electron#18301）。登录窗口与主窗口共用
 * default session，因此历史上 setupCSP（全局）与 setupLoginWindowCSP（登录）
 * 会互相覆盖，导致"登录窗口打开期间主窗口 CSP 失效 / 登录窗口关闭后全局 CSP
 * 被置空"。修复方式：保留单一全局监听器（setupCSP），通过此集合在监听器内
 * 区分主窗口与登录窗口的 webContents，注入对应强度的 CSP。
 */

function setupCSP(win: BrowserWindow) {
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const baseCspDirectives = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    isDev ? "connect-src 'self' https: ws:" : "connect-src 'self' https:",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ]

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (needsRelaxedCsp(details.webContents)) {
      // 保留第三方登录站点的原始 CSP。覆盖它可能改变页面资源和 DOM 初始化
      // 时序，阻断 Cloudflare 动态脚本、iframe、worker，或触发站点脚本空节点异常。
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [baseCspDirectives.join('; ')],
      },
    })
  })
}

function setupRefererInjection(win: BrowserWindow) {
  const refererFilterUrls = Object.keys(REFERER_OVERRIDES).flatMap(d => [
    `https://${d}/*`, `https://*.${d}/*`,
  ])
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: refererFilterUrls },
    (details, callback) => {
      const url = new URL(details.url)
      for (const [domain, referer] of Object.entries(REFERER_OVERRIDES)) {
        if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
          details.requestHeaders['Referer'] = referer
          break
        }
      }
      callback(details)
    }
  )
}

function setupWindowCloseHandler(win: BrowserWindow) {
  win.on('close', async (e) => {
    if (shutdownState !== 'running') return

    // Always prevent to allow async work (Electron won't await async handlers)
    e.preventDefault()

    // Snapshot the window reference before any await
    const snap = win

    try {
      const bridge = getPythonBridge()
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), CLOSE_GET_DOWNLOADS_TIMEOUT_MS)
      )
      const result = await Promise.race([
        bridge.call('get_downloads'),
        timeout,
      ]) as { tasks: Array<{ status: string }> } | null

      // Timeout — just close the window
      if (!result) {
        if (snap && !snap.isDestroyed()) snap.destroy()
        return
      }

      if (shutdownState !== 'running' || !snap || snap.isDestroyed() || mainWindow !== snap) return

      const activeTasks = result.tasks.filter(
        t => ACTIVE_DOWNLOAD_STATUSES.has(t.status)
      )

      if (activeTasks.length > 0) {
        const choice = dialog.showMessageBoxSync(snap, {
          type: 'question',
          title: '确认退出',
          message: `还有 ${activeTasks.length} 个下载任务正在进行中。`,
          detail: '退出将取消所有正在进行的下载。',
          buttons: ['取消下载并退出', '继续下载'],
          defaultId: 1,
          cancelId: 1,
        })
        if (choice === 0) {
          shutdownState = 'quitting'
          app.quit()
        }
      } else {
        snap.destroy()
      }
    } catch {
      if (snap && !snap.isDestroyed()) snap.destroy()
    }
  })
}

function getAppIconPath(): string {
  const assetsDir = path.join(__dirname, '../../assets')
  const platform = process.platform
  if (platform === 'win32') {
    return path.join(assetsDir, 'icon.ico')
  }
  if (platform === 'darwin') {
    return path.join(assetsDir, 'icon_512.png')
  }
  return path.join(assetsDir, 'icon.png')
}

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.js')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
    icon: getAppIconPath(),
    show: true
  })

  notificationManager.setMainWindow(mainWindow)

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    let parsed: URL
    try {
      parsed = new URL(devServerUrl)
    } catch {
      throw new Error(`Invalid ELECTRON_RENDERER_URL: ${devServerUrl}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`ELECTRON_RENDERER_URL must be http or https: ${devServerUrl}`)
    }
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new Error(`ELECTRON_RENDERER_URL must be localhost: ${devServerUrl}`)
    }
    loadWithRetry(mainWindow, devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  setupCSP(mainWindow)
  setupRefererInjection(mainWindow)

  if (!process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.on('did-fail-load', (_event, _errorCode, errorDescription) => {
      console.error('Failed to load:', errorDescription)
      mainWindow?.show()
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 渲染进程就绪后补发暂存的深度链接（协议唤起早于窗口加载完成的情况）。
  // 用 on 而非 once：窗口重载后若仍有 pending 也应补发，且补发后立即清空，
  // 不会重复推送。
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink && mainWindow && !mainWindow.isDestroyed()) {
      const target = pendingDeepLink
      pendingDeepLink = null
      mainWindow.webContents.send(NOTIFICATION_CHANNELS.DEEP_LINK, target)
    }
    // 重发最新启动进度：渲染进程的订阅者（index.html JS / React hook）注册
    // 时机可能晚于 Python 的 PROGRESS 事件（Python 极快就绪时事件在订阅前发完），
    // did-finish-load 时重发缓存值让它们立即拿到最新进度，避免卡在 0%。
    // 若 Python 尚未输出任何 PROGRESS，发送默认初始进度 10%。
    if (mainWindow && !mainWindow.isDestroyed()) {
      const progress = latestStartupProgress ?? { percent: 10, label: '正在启动应用…' }
      mainWindow.webContents.send(NOTIFICATION_CHANNELS.STARTUP_PROGRESS, progress)
    }
  })

  setupWindowCloseHandler(mainWindow)
}

// ── IPC Handler Groups ──────────────────────────────────────────────────────

type Bridge = ReturnType<typeof getPythonBridge>

function syncNotificationSettings(bridge: Bridge) {
  bridge.call('get_config').then((result: unknown) => {
    const config = (result as Record<string, unknown>)?.config as Record<string, unknown> | undefined
    if (!config) return
    if (typeof config.notifyOnComplete === 'boolean'
      && (config.notifyWhenForeground === 'inactive' || config.notifyWhenForeground === 'always')) {
      notificationManager.updateSettings(
        config.notifyOnComplete,
        config.notifyWhenForeground,
      )
    } else if (typeof config.notifyOnComplete === 'boolean') {
      notificationManager.updateSettings(
        config.notifyOnComplete,
        'inactive',
      )
    }
  }).catch((err) => { console.warn('Failed to sync notification settings:', err) })
}

function registerNotificationHandlers(bridge: Bridge) {
  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.DOWNLOAD_PROGRESS, (params) => {
    const event = validateDownloadProgress(params)
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.DOWNLOAD_PROGRESS, event)
    notificationManager.handleProgress(event)
  })

  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.MIGRATION_PROGRESS, (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, params)
  })

  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.MIGRATION_COMPLETE, (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, params)
  })

  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.MIGRATION_ERROR, (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_ERROR, params)
  })

  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.ALBUM_PROGRESS, (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.ALBUM_PROGRESS, params)
  })

  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.MAINTENANCE_PROGRESS, (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MAINTENANCE_PROGRESS, params)
  })

  // 致命错误：后端进程启动失败或重启超限时转发到渲染进程横幅。
  // 复用安全发送模式（检查 mainWindow 存在且未销毁）。
  bridge.onFatal = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(NOTIFICATION_CHANNELS.FATAL_ERROR, payload)
    }
  }

  // 启动进度：Python __init__ 各阶段经 stderr 输出 PROGRESS 行，
  // PythonBridge 解析后转发到渲染进程驱动启动进度条。
  // 复用与 onFatal 相同的安全发送模式（mainWindow 可能在启动期被关闭）。
  // 同时缓存最新进度：渲染进程订阅者注册可能晚于事件（Python 极快就绪时），
  // did-finish-load 时重发缓存值让后注册者也能拿到最新进度。
  bridge.onStartupProgress = (event) => {
    latestStartupProgress = event
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(NOTIFICATION_CHANNELS.STARTUP_PROGRESS, event)
    }
  }
}

function registerSearchHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.SEARCH, async (_, query, mode, page, source, tag) => {
    assert(and(string(), maxLength(512)), query, 'search query')
    assert(and(string(), oneOf(Array.from(MODE_VALUES))), mode, 'search mode')
    assert(and(number(), integer(), range(1, 1000)), page, 'search page')
    const params: Record<string, unknown> = { query, mode, page }
    withOptionalSource(params, source, 'search')
    if (tag !== undefined && tag !== null && tag !== '') {
      assert(and(string(), maxLength(128), noControlChars()), tag, 'search tag')
      params.tag = tag
    }
    return bridge.call('search', params)
  })

  ipcMain.handle(IPC_CHANNELS.RANDOM, async (_, source?: string) => {
    const params: Record<string, unknown> = {}
    withOptionalSource(params, source, 'random')
    return bridge.call('random', params)
  })
}

function registerDownloadHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_BATCH_AS_ALBUM, async (_, comics: unknown, albumTitle: unknown, overwrite?: unknown) => {
    if (!Array.isArray(comics) || comics.length === 0) throw new ValidationError('Invalid download_batch_as_album comics: empty')
    if (comics.length > 200) throw new ValidationError('Invalid download_batch_as_album comics: too many')
    for (const c of comics) {
      assert(object(), c, 'download_batch_as_album comic item')
    }
    assert(and(string(), length(1, 256), noControlChars()), albumTitle, 'download_batch_as_album albumTitle')
    const params: Record<string, unknown> = { comics, album_title: albumTitle }
    if (overwrite === true) {
      params.overwrite = true
    }
    return bridge.call('download_batch_as_album', params)
  })

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD, async (_, comicId, comicData, overwrite?: unknown, chapterIds?: unknown) => {
    validateDownloadPayload(comicId, comicData)
    const params: Record<string, unknown> = { comic_id: comicId, comic_data: comicData }
    if (overwrite === true) {
      params.overwrite = true
    }
    if (Array.isArray(chapterIds) && chapterIds.length > 0) {
      if (chapterIds.length > 1000) throw new ValidationError('Invalid download chapterIds: too many')
      for (const cid of chapterIds) {
        assert(and(string(), length(1, 256)), cid, 'download chapterId')
      }
      params.chapter_ids = chapterIds
    }
    return bridge.call('download', params)
  })

  ipcMain.handle(IPC_CHANNELS.CHECK_DOWNLOAD_CONFLICT, async (_, comicData) => {
    assert(object(), comicData, 'comic data')
    return bridge.call('check_download_conflict', { comic_data: comicData })
  })

  ipcMain.handle(IPC_CHANNELS.GET_FAVOURITES, async (_, page?: unknown, source?: unknown) => {
    const p = page ?? 1
    assert(and(number(), integer(), range(1, 1000)), p, 'favourites page')
    const params: Record<string, unknown> = { page: p }
    withOptionalSource(params, source, 'favourites')
    return bridge.call('get_favourites', params)
  })

  ipcMain.handle(IPC_CHANNELS.ADD_TO_FAVOURITES, async (_, comicId: unknown, source?: unknown) => {
    assert(comicIdValidator, comicId, 'add_to_favourites comicId')
    const params: Record<string, unknown> = { comic_id: comicId }
    withOptionalSource(params, source, 'add_to_favourites')
    return bridge.call('add_to_favourites', params)
  })

  ipcMain.handle(IPC_CHANNELS.CHECK_FAVOURITE, async (_, comicId: unknown, source?: unknown) => {
    assert(comicIdValidator, comicId, 'check_favourite comicId')
    const params: Record<string, unknown> = { comic_id: comicId }
    withOptionalSource(params, source, 'check_favourite')
    return bridge.call('check_favourite', params)
  })

  ipcMain.handle(IPC_CHANNELS.REMOVE_FROM_FAVOURITES, async (_, comicId: unknown, source?: unknown) => {
    assert(comicIdValidator, comicId, 'remove_from_favourites comicId')
    const params: Record<string, unknown> = { comic_id: comicId }
    withOptionalSource(params, source, 'remove_from_favourites')
    return bridge.call('remove_from_favourites', params)
  })

  ipcMain.handle(IPC_CHANNELS.GET_DOWNLOADS, async () => {
    return bridge.call('get_downloads')
  })

  const registerTaskAction = (channel: string, method: string, label: string) => {
    ipcMain.handle(channel, async (_, taskId) => {
      validateTaskId(taskId, `${label} taskId`)
      return bridge.call(method, { task_id: taskId })
    })
  }

  registerTaskAction(IPC_CHANNELS.CANCEL_DOWNLOAD, 'cancel_download', 'cancel_download')
  registerTaskAction(IPC_CHANNELS.PAUSE_TASK, 'pause_task', 'pause_task')
  registerTaskAction(IPC_CHANNELS.RESUME_TASK, 'resume_task', 'resume_task')
  registerTaskAction(IPC_CHANNELS.RETRY_TASK, 'retry_task', 'retry_task')
  registerTaskAction(IPC_CHANNELS.GET_DOWNLOAD_DETAIL, 'get_download_detail', 'get_download_detail')

  ipcMain.handle(IPC_CHANNELS.TOGGLE_GLOBAL_PAUSE, async () => {
    return bridge.call('toggle_global_pause')
  })
}

function registerConfigHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, async () => {
    const result = await bridge.call('get_config') as { config?: { jmCdnDomain?: string; jmDomain?: string } }
    if (result?.config?.jmCdnDomain) {
      const domain = result.config.jmCdnDomain
      if (DOMAIN_RE.test(domain)) {
        jmCdnDomain = domain
      } else {
        console.warn('Invalid jm CDN domain from backend, ignoring:', domain)
      }
    }
    if (result?.config?.jmDomain) {
      const domain = result.config.jmDomain
      if (DOMAIN_RE.test(domain)) {
        jmMainDomain = domain
      } else {
        console.warn('Invalid jm main domain from backend, ignoring:', domain)
      }
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.SET_CONFIG, async (_, key, value) => {
    if (typeof key !== 'string' || value === undefined) {
      throw new Error('Invalid set_config parameters')
    }
    const validator = CONFIG_VALIDATORS[key]
    if (!validator) {
      throw new Error(`Unknown config key: ${key}`)
    }
    try {
      if (!validator(value)) {
        throw new ValidationError(`Invalid value for ${key}`, key, value)
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        const wrappedErr = new Error(`Invalid value for ${key}: ${JSON.stringify(value)}`)
        ;(wrappedErr as Error & { cause?: unknown }).cause = err
        throw wrappedErr
      }
      throw err
    }
    const prevNotifyOnComplete = notificationManager.notifyOnCompleteValue
    const prevNotifyWhenForeground = notificationManager.notifyWhenForegroundValue
    try {
      if (key === 'notifyOnComplete' && typeof value === 'boolean') {
        notificationManager.updateSettings(value, prevNotifyWhenForeground)
      }
      if (key === 'notifyWhenForeground' && (value === 'inactive' || value === 'always')) {
        notificationManager.updateSettings(prevNotifyOnComplete, value)
      }
      const result = await bridge.call('set_config', { key, value })
      // jmDomain 设置成功后，更新主进程域名白名单
      if (key === 'jmDomain' && typeof value === 'string' && value && DOMAIN_RE.test(value)) {
        jmMainDomain = value
      }
      return result
    } catch (err) {
      notificationManager.updateSettings(prevNotifyOnComplete, prevNotifyWhenForeground)
      throw err
    }
  })
}

function registerAuthHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.APPLY_AUTH, async (_, curlText, source) => {
    if (typeof curlText !== 'string' || curlText.trim().length === 0 || curlText.length > 65536) {
      throw new Error('Invalid apply_auth curlText')
    }
    const params: Record<string, unknown> = { curl_text: curlText.trim() }
    if (source !== undefined && source !== null) {
      params.source = source
    }
    return bridge.call('apply_auth', params)
  })

  ipcMain.handle(IPC_CHANNELS.VERIFY_AUTH, async (_, source) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      params.source = source
    }
    return bridge.call('verify_auth', params)
  })

  ipcMain.handle(IPC_CHANNELS.MOEIMG_LOGIN, async (_, username, password) => {
    if (typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
      throw new Error('Invalid moeimg username')
    }
    if (typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
      throw new Error('Invalid moeimg password')
    }
    return bridge.call('moeimg_login', { username: username.trim(), password: password.trim() })
  })

  ipcMain.handle(IPC_CHANNELS.BIKA_LOGIN, async (_, username, password) => {
    if (typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
      throw new Error('Invalid bika username')
    }
    if (typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
      throw new Error('Invalid bika password')
    }
    return bridge.call('bika_login', { username: username.trim(), password: password.trim() })
  })

  ipcMain.handle(IPC_CHANNELS.BIKA_CATEGORIES, async () => {
    return bridge.call('bika_categories', {})
  })

  ipcMain.handle(IPC_CHANNELS.HCOMIC_LOGIN, async (_, username, password) => {
    if (typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
      throw new Error('Invalid hcomic username')
    }
    if (typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
      throw new Error('Invalid hcomic password')
    }
    return bridge.call('hcomic_login', { username: username.trim(), password: password.trim() })
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_LOGIN_WINDOW, async (_, source) => {
    // 对 jm，先获取配置以更新域名
    if (source === 'jm' && !jmMainDomain) {
      try {
        const result = await bridge.call('get_config') as { config?: { jmDomain?: string } }
        if (result?.config?.jmDomain && DOMAIN_RE.test(result.config.jmDomain)) {
          jmMainDomain = result.config.jmDomain
        }
      } catch (e) {
        console.warn('Failed to get jm domain:', e)
      }
    }
    return openLoginWindow(mainWindow, source || 'hcomic', jmMainDomain || undefined)
  })

  ipcMain.handle(IPC_CHANNELS.SHUTDOWN, async () => {
    return bridge.call('shutdown')
  })
}

function registerSystemHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_, url: string) => {
    // 动态添加 jm CDN 域名
    const allowedDomains = [...ALLOWED_EXTERNAL_DOMAINS]
    if (jmCdnDomain && !allowedDomains.includes(jmCdnDomain)) {
      allowedDomains.push(jmCdnDomain)
    }
    if (jmMainDomain && !allowedDomains.includes(jmMainDomain)) {
      allowedDomains.push(jmMainDomain)
    }
    validateHttpsUrlWithDomains(url, allowedDomains, 'URL')
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC_CHANNELS.GET_PROXY_STATUS, async () => {
    return bridge.call('get_proxy_status')
  })

  ipcMain.handle(IPC_CHANNELS.GET_AVAILABLE_FONTS, async () => {
    return bridge.call('get_available_fonts')
  })

  ipcMain.handle(IPC_CHANNELS.GET_JM_DOMAINS, async () => {
    return bridge.call('get_jm_domains')
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_DOWNLOAD_DIR, async (_, dirPath: unknown) => {
    return openDirectoryInFileManager(dirPath, 'Download')
  })

  ipcMain.handle(IPC_CHANNELS.SELECT_DIRECTORY, async (_, title: string, defaultPath?: string) => {
    const win = mainWindow
    if (!win) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(win, {
      title,
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle(IPC_CHANNELS.GET_DIAGNOSTICS, async () => {
    return buildDiagnostics()
  })

  // 写入系统剪贴板：在主进程执行，绕开渲染进程 navigator.clipboard 对文档焦心的依赖
  // （window.confirm 后焦点未恢复会抛 "Document is not focused"）。
  // 主进程权威校验：与项目其他 IPC handler 一致，不依赖 preload 透传的 TS 类型签名。
  ipcMain.handle(IPC_CHANNELS.WRITE_CLIPBOARD, async (_, text: unknown) => {
    assert(and(string(), length(1, 2_000_000)), text, 'clipboard text')
    clipboard.writeText(text)
  })
}

function registerPreviewHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.FETCH_COVER, async (_, url: string) => {
    validateUrlFormat(url, 'cover image URL')
    const parsed = new URL(url as string)
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed')
    return bridge.call('fetch_cover', { url })
  })

  ipcMain.handle(IPC_CHANNELS.GET_PREVIEW_URLS, async (_, comicData: unknown) => {
    validateComicObject(comicData)
    const data = comicData as Record<string, unknown>
    assert(comicIdValidator, data.id, 'comic id')
    if (data.sourceSite !== undefined && data.sourceSite !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), data.sourceSite, 'comicData.sourceSite')
    }
    return bridge.call('get_preview_urls', { comic_data: comicData })
  })

  ipcMain.handle(IPC_CHANNELS.GET_CHAPTER_PREVIEW_URLS, async (_, chapterId: unknown, albumId?: unknown, sourceSite?: unknown) => {
    assert(and(string(), length(1, 256)), chapterId, 'chapterId')
    const params: Record<string, unknown> = { chapter_id: chapterId }
    if (albumId !== undefined && albumId !== null) {
      assert(and(string(), length(1, 256)), albumId, 'albumId')
      params.album_id = albumId
    }
    if (sourceSite !== undefined && sourceSite !== null) {
      assert(and(string(), length(1, 64)), sourceSite, 'sourceSite')
      params.source_site = sourceSite
    }
    return bridge.call('get_chapter_preview_urls', params)
  })

  ipcMain.handle(IPC_CHANNELS.FETCH_PREVIEW_IMAGE, async (_, imageUrl: unknown, scrambleId?: unknown, comicId?: unknown, imageQuality?: unknown) => {
    assert(and(string(), length(1, 2048)), imageUrl, 'preview image URL')
    let parsed: URL
    try { parsed = new URL(imageUrl) } catch { throw new Error('Invalid preview image URL format') }
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed for preview images')
    const params: Record<string, unknown> = { image_url: imageUrl }
    if (typeof scrambleId === 'string' && scrambleId) params.scramble_id = scrambleId
    if (typeof comicId === 'string' && comicId) params.comic_id = comicId
    if (typeof imageQuality === 'string' && imageQuality) {
      if (!IMAGE_QUALITIES.includes(imageQuality as typeof IMAGE_QUALITIES[number])) {
        throw new Error('Invalid imageQuality')
      }
      params.image_quality = imageQuality
    }
    return bridge.call('fetch_preview_image', params)
  })

  ipcMain.handle(IPC_CHANNELS.CHECK_DOWNLOADED_STATUS, async (_, comics: unknown) => {
    if (!Array.isArray(comics) || comics.length === 0) {
      throw new Error('Invalid comics')
    }
    if (comics.length > 200) {
      throw new Error('Too many comics')
    }
    for (const c of comics) {
      assert(object(), c, 'comic in check_downloaded_status')
      const data = c as Record<string, unknown>
      assert(comicIdValidator, data.id, 'comic id in check_downloaded_status')
    }
    return bridge.call('check_downloaded_status', { comics })
  })

  ipcMain.handle(IPC_CHANNELS.GET_COMIC_DETAIL, async (_, comicId: unknown, source?: unknown, sourceUrl?: unknown) => {
    assert(comicIdValidator, comicId, 'get_comic_detail comicId')
    const params: Record<string, unknown> = { comic_id: comicId }
    withOptionalSource(params, source, 'get_comic_detail')
    if (sourceUrl !== undefined && sourceUrl !== null) {
      assert(and(string(), length(1, 2048)), sourceUrl, 'get_comic_detail sourceUrl')
      params.source_url = sourceUrl
    }
    return bridge.call('get_comic_detail', params)
  })
}

function registerMigrationHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.START_MIGRATION, async (_, targetDir: unknown, mode: unknown) => {
    assert(downloadDirValidator, targetDir, 'targetDir')
    if (mode !== 'full' && mode !== 'repair') {
      throw new Error('mode must be "full" or "repair"')
    }
    return bridge.call('start_migration', { target_dir: targetDir, mode })
  })

  ipcMain.handle(IPC_CHANNELS.CONFIRM_MIGRATION, async (_, migrationId: unknown) => {
    assert(taskIdValidator, migrationId, 'migrationId')
    return bridge.call('confirm_migration', { migration_id: migrationId })
  })

  ipcMain.handle(IPC_CHANNELS.PAUSE_MIGRATION, async () => {
    return bridge.call('pause_migration')
  })

  ipcMain.handle(IPC_CHANNELS.RESUME_MIGRATION, async () => {
    return bridge.call('resume_migration')
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL_MIGRATION, async () => {
    return bridge.call('cancel_migration')
  })

  ipcMain.handle(IPC_CHANNELS.GET_MIGRATION_STATUS, async () => {
    return bridge.call('get_migration_status')
  })

  ipcMain.handle(IPC_CHANNELS.RESOLVE_UNMATCHED, async (_, matches: unknown) => {
    if (!Array.isArray(matches) || matches.length > 10000) {
      throw new ValidationError('Invalid matches')
    }
    for (const m of matches) {
      if (typeof m !== 'object' || m === null) throw new ValidationError('Invalid match item')
      const item = m as Record<string, unknown>
      if (!Array.isArray(item.dbKey) || typeof item.file_path !== 'string') {
        throw new ValidationError('Invalid match item: dbKey must be array, file_path must be string')
      }
    }
    const params = {
      matches: (matches as unknown as Array<{ dbKey: string[]; file_path: string }>).map(m => ({
        db_key: m.dbKey,
        file_path: m.file_path,
      })),
    }
    return bridge.call('resolve_unmatched', params)
  })
}

function registerCacheHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_CACHE_STATS, async () => {
    return bridge.call('get_cache_stats')
  })

  ipcMain.handle(IPC_CHANNELS.GET_CACHE_DIR, async () => {
    return bridge.call('get_cache_dir')
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_CACHE_DIR, async (_, dirPath: unknown) => {
    return openDirectoryInFileManager(dirPath, 'Cache')
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_PREVIEW_CACHE, async () => {
    return bridge.call('clear_preview_cache')
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_ALL_CACHE, async () => {
    return bridge.call('clear_all_cache')
  })
}

function registerHistoryHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async (_, page?: unknown) => {
    const p = page ?? 1
    assert(and(number(), integer(), range(1, 1000)), p, 'history page')
    return bridge.call('get_history', { page: p })
  })

  ipcMain.handle(IPC_CHANNELS.ADD_HISTORY, async (_, params: unknown) => {
    assert(and(object()), params, 'add_history params')
    const p = params as Record<string, unknown>
    assert(comicIdValidator, p.comicId, 'add_history comicId')
    assert(and(string(), length(1, 256)), p.title, 'add_history title')
    assert(and(string(), maxLength(2048)), p.coverUrl, 'add_history coverUrl')
    assert(and(string(), length(1, 64), noControlChars()), p.source, 'add_history source')
    assert(and(string(), maxLength(64), noControlChars()), p.sourceSite, 'add_history sourceSite')
    assert(and(string(), maxLength(256)), p.mediaId, 'add_history mediaId')
    assert(and(string(), maxLength(2048)), p.sourceUrl, 'add_history sourceUrl')
    assert(and(number(), integer(), minValue(0)), p.lastPage, 'add_history lastPage')
    assert(and(number(), integer(), minValue(0)), p.totalPages, 'add_history totalPages')
    return bridge.call('add_history', {
      comic_id: p.comicId,
      title: p.title,
      cover_url: p.coverUrl,
      source: p.source,
      source_site: p.sourceSite,
      media_id: p.mediaId,
      source_url: p.sourceUrl,
      last_page: p.lastPage,
      total_pages: p.totalPages,
    })
  })

  ipcMain.handle(IPC_CHANNELS.DELETE_HISTORY, async (_, comicId: unknown, source: unknown) => {
    assert(comicIdValidator, comicId, 'delete_history comicId')
    assert(and(string(), length(1, 64), noControlChars()), source, 'delete_history source')
    return bridge.call('delete_history', { comic_id: comicId, source })
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_HISTORY, async () => {
    return bridge.call('clear_history')
  })
}

function registerFavouriteTagHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_FAVOURITE_TAGS, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    withOptionalSource(params, source, 'get_favourite_tags')
    return bridge.call('get_favourite_tags', params)
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_FAVOURITE_TAGS, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    withOptionalSource(params, source, 'clear_favourite_tags')
    return bridge.call('clear_favourite_tags', params)
  })

  ipcMain.handle(IPC_CHANNELS.REMOVE_FAVOURITE_TAG, async (_, tag: unknown, source?: unknown) => {
    assert(and(string(), length(1, 64), noControlChars()), tag, 'remove_favourite_tag tag')
    const params: Record<string, unknown> = { tag }
    withOptionalSource(params, source, 'remove_favourite_tag')
    return bridge.call('remove_favourite_tag', params)
  })

  ipcMain.handle(IPC_CHANNELS.SYNC_FAVOURITE_TAGS, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    withOptionalSource(params, source, 'sync_favourite_tags')
    return bridge.call('sync_favourite_tags', params, 300_000) // 5 min timeout for large sync + enrichment
  })
}

function registerTagListHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_TAG_LIST, async (_, source?: unknown, keyword?: unknown, page?: unknown, limit?: unknown) => {
    const params: Record<string, unknown> = {}
    withOptionalSource(params, source, 'get_tag_list')
    if (keyword !== undefined && keyword !== null) {
      assert(and(string(), maxLength(128), noControlChars()), keyword, 'get_tag_list keyword')
      params.keyword = keyword
    }
    if (page !== undefined && page !== null) {
      assert(integer(), page, 'get_tag_list page')
      params.page = page
    }
    if (limit !== undefined && limit !== null) {
      assert(and(integer(), range(1, 500)), limit, 'get_tag_list limit')
      params.limit = limit
    }
    return bridge.call('get_tag_list', params)
  })

  ipcMain.handle(IPC_CHANNELS.REFRESH_TAG_LIST, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    withOptionalSource(params, source, 'refresh_tag_list')
    return bridge.call('refresh_tag_list', params, 300_000) // 5 min timeout for full sync
  })
}

function registerAlbumHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.FORCE_PACK_ALBUM, async (_, sourceSite: unknown, albumId: unknown, overwrite?: unknown) => {
    assert(and(string(), length(1, 256)), sourceSite, 'forcePackAlbum sourceSite')
    assert(and(string(), length(1, 256)), albumId, 'getAlbumProgress albumId')
    return bridge.call('force_pack_album', {
      source_site: sourceSite,
      album_id: albumId,
      overwrite: overwrite ?? false,
    })
  })

  ipcMain.handle(IPC_CHANNELS.GET_ALBUM_PROGRESS, async (_, sourceSite: unknown, albumId: unknown) => {
    assert(and(string(), length(1, 256)), sourceSite, 'getAlbumProgress sourceSite')
    assert(and(string(), length(1, 256)), albumId, 'getAlbumProgress albumId')
    return bridge.call('get_album_progress', {
      source_site: sourceSite,
      album_id: albumId,
    })
  })

  const registerAlbumTaskAction = (channel: string, method: string, label: string) => {
    ipcMain.handle(channel, async (_, sourceSite: unknown, albumId: unknown) => {
      assert(and(string(), length(1, 256)), sourceSite, `${label} sourceSite`)
      assert(and(string(), length(1, 256)), albumId, `${label} albumId`)
      return bridge.call(method, { source_site: sourceSite, album_id: albumId })
    })
  }

  registerAlbumTaskAction(IPC_CHANNELS.PAUSE_ALBUM, 'pause_album', 'pauseAlbum')
  registerAlbumTaskAction(IPC_CHANNELS.RESUME_ALBUM, 'resume_album', 'resumeAlbum')
  registerAlbumTaskAction(IPC_CHANNELS.CANCEL_ALBUM, 'cancel_album', 'cancelAlbum')
}

function registerMaintenanceHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.RUN_HEALTH_CHECK, async (_, scope?: unknown, comicKeys?: unknown) => {
    const s = scope ?? 'all'
    assert(and(string(), oneOf(['all', 'selected'])), s, 'runHealthCheck scope')
    const params: Record<string, unknown> = { scope: s }
    if (comicKeys !== undefined && comicKeys !== null) {
      // 显式 Array.isArray 校验，避免对 {foo:1} 这类非数组对象误判通过（旧实现用 object() 断言给出虚假安全感）
      if (!Array.isArray(comicKeys) || comicKeys.length > 10_000) {
        throw new ValidationError('comicKeys must be an array')
      }
      for (const key of comicKeys) {
        if (!Array.isArray(key) || key.length < 3 || key.length > 8) {
          throw new ValidationError('Each comicKey must be an array of 3-8 strings')
        }
        for (const k of key) {
          assert(and(string(), length(1, 256), noControlChars()), k, 'runHealthCheck comicKey element')
        }
      }
      params.comic_keys = comicKeys
    }
    return bridge.call('run_health_check', params)
  })

  ipcMain.handle(IPC_CHANNELS.SCAN_ORPHAN_TEMPS, async () => {
    return bridge.call('scan_orphan_temps')
  })

  ipcMain.handle(IPC_CHANNELS.CLEANUP_ORPHAN_TEMPS, async (_, paths?: unknown) => {
    const params: Record<string, unknown> = {}
    if (paths !== undefined && paths !== null) {
      if (!Array.isArray(paths) || paths.length > 10_000) {
        throw new ValidationError('paths must be an array')
      }
      for (const p of paths) {
        assert(and(string(), length(1, 1024), absolutePath(), noPathTraversal(), noControlChars()), p, 'cleanupOrphanTemps path')
      }
      params.paths = paths
    }
    return bridge.call('cleanup_orphan_temps', params)
  })

  ipcMain.handle(IPC_CHANNELS.GET_STORAGE_STATS, async () => {
    return bridge.call('get_storage_stats')
  })
}

function registerIPCHandlers() {
  const bridge = getPythonBridge()

  syncNotificationSettings(bridge)
  registerNotificationHandlers(bridge)
  registerSearchHandlers(bridge)
  registerDownloadHandlers(bridge)
  registerConfigHandlers(bridge)
  registerAuthHandlers(bridge)
  registerSystemHandlers(bridge)
  registerPreviewHandlers(bridge)
  registerMigrationHandlers(bridge)
  registerCacheHandlers(bridge)
  registerHistoryHandlers(bridge)
  registerFavouriteTagHandlers(bridge)
  registerTagListHandlers(bridge)
  registerAlbumHandlers(bridge)
  registerMaintenanceHandlers(bridge)

  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    return checkForUpdates()
  })
}

function scheduleStartupUpdateCheck() {
  const bridge = getPythonBridge()
  bridge.call('get_config').then((result: unknown) => {
    const config = (result as Record<string, unknown>)?.config as Record<string, unknown> | undefined
    if (!config) return
    if (config.checkUpdateOnStart === false) return

    setTimeout(async () => {
      try {
        const updateResult = await checkForUpdates()
        if (updateResult.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(NOTIFICATION_CHANNELS.UPDATE_CHECK_RESULT, {
            latestVersion: updateResult.latestVersion,
            changelog: updateResult.changelog,
            releaseUrl: updateResult.releaseUrl,
          })
        }
      } catch {
        // Silent failure for auto-check
      }
    }, STARTUP_UPDATE_CHECK_DELAY_MS)
  }).catch(() => {
    // Failed to read config, skip update check
  })
}

// ── Deep-link (hcomic://) handling ──
//
// 解析 `hcomic://<action>?<params>` 为结构化导航目标，转发给渲染进程。
// 同时处理三种唤起路径：
//   1. macOS `open-url`（协议已注册为默认客户端）
//   2. Windows 冷启动：协议 URL 作为命令行 argv 传入（argv 扫描）
//   3. Windows 热启动：`second-instance` 的 argv 参数
// 渲染进程挂载前的唤起会暂存为 pending，待其就绪后补发，避免丢失导航意图。
const DEEP_LINK_SCHEME = 'hcomic:'
let pendingDeepLink: DeepLinkTarget | null = null

function parseDeepLink(raw: string): DeepLinkTarget | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol.toLowerCase() !== DEEP_LINK_SCHEME) return null
  // action 取 host（`hcomic://comic?...` → `comic`）；空 action 视为无效
  const action = parsed.hostname.toLowerCase()
  if (!action) return null
  const params: Record<string, string> = {}
  parsed.searchParams.forEach((value, key) => {
    // 仅保留字符串键值对，重复键后者覆盖（URLSearchParams 已做 decode）
    params[key] = value
  })
  return { action, params, raw }
}

function dispatchDeepLink(target: DeepLinkTarget): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(NOTIFICATION_CHANNELS.DEEP_LINK, target)
  } else {
    // 渲染进程尚未就绪：暂存，createWindow 完成后补发
    pendingDeepLink = target
  }
}

function handleDeepLinkUrl(raw: string): void {
  const target = parseDeepLink(raw)
  if (!target) return
  // 前置主窗口：协议唤起应当把应用带到前台
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  dispatchDeepLink(target)
}

// 从命令行 argv 中提取首个 hcomic:// 协议 URL（Windows 冷启动入口）
function extractDeepLinkFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith(DEEP_LINK_SCHEME)) {
      return arg
    }
  }
  return null
}

// ── Single instance lock ──
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

// ── Global renderer crash guard ──
// Prevent sub-window renderer crashes (e.g. login popup) from silently
// taking down the entire app. The login-window already has its own
// render-process-gone handler; this is the last-resort safety net.
app.on('render-process-gone', (_event, _webContents, details) => {
  console.error(`[App] renderer process gone: ${details.reason} (exit code ${details.exitCode})`)
})

// GPU process crash is a common cause of silent native crashes on Windows
// when loading complex web content (e.g. Auth0). Log it so we can triage.
// 注：Electron 29 移除了 app.on('gpu-process-crashed')，迁移到
// child-process-gone，用 details.type === 'GPU' 过滤出原 GPU 崩溃事件。
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU') {
    console.error(`[App] GPU process gone: ${details.reason} (exit code ${details.exitCode})`)
  }
})

app.whenReady().then(() => {
  try {
    // ── Platform-specific icon setup ──
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.hcomic.downloader')
    } else if (process.platform === 'darwin' && app.dock) {
      const iconPath = getAppIconPath()
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(iconPath)
      }
    }

    // ── URI protocol registration (hcomic://) ──
    if (process.platform !== 'linux') {
      app.setAsDefaultProtocolClient('hcomic')
    }

    createWindow()
    registerIPCHandlers()
    scheduleStartupUpdateCheck()

    // ── Windows 冷启动深度链接 ──
    // 协议 URL 作为命令行 argv 传入首个实例；此时 mainWindow 可能尚未
    // did-finish-load，parseDeepLink 解析后由 dispatchDeepLink 暂存 pending，
    // 待渲染进程就绪后补发（见下方 did-finish-load 钩子）。
    const coldStartUrl = extractDeepLinkFromArgv(process.argv)
    if (coldStartUrl) {
      const target = parseDeepLink(coldStartUrl)
      if (target) pendingDeepLink = target
    }
  } catch (err) {
    dialog.showErrorBox('启动失败', '应用初始化失败: ' + (err as Error).message)
    app.quit()
  }
})

// ── Handle URI protocol activation (macOS) ──
// `open-url` 携带唤起的 hcomic:// URL；解析后转发渲染进程做导航。
// 非协议 URL 或解析失败时退化为单纯前置主窗口（保留旧行为兼容）。
app.on('open-url', (event, url: string) => {
  event.preventDefault()
  if (typeof url === 'string' && url.toLowerCase().startsWith(DEEP_LINK_SCHEME)) {
    handleDeepLinkUrl(url)
    return
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

// ── Handle URI protocol activation (Windows) ──
// `second-instance` 在第二个实例启动时触发；argv 可能包含 hcomic:// URL
// （协议热启动）。解析后转发渲染进程；无协议 URL 时仅前置主窗口。
app.on('second-instance', (_event, argv: readonly string[]) => {
  const deepLinkUrl = extractDeepLinkFromArgv(argv)
  if (deepLinkUrl) {
    handleDeepLinkUrl(deepLinkUrl)
    return
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', (e) => {
  if (shutdownState === 'done') return
  e.preventDefault()
  shutdownState = 'quitting'
  const bridge = getPythonBridge()

  let timer: NodeJS.Timeout | null = null
  const doQuit = () => {
    if (shutdownState === 'done') return
    if (timer) clearTimeout(timer)
    bridge.kill()
    shutdownState = 'done'
    app.quit()
  }

  timer = setTimeout(doQuit, SHUTDOWN_TIMEOUT_MS)
  bridge.shutdown().finally(() => doQuit())
})
