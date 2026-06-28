/**
 * JM 收藏夹交互式人机验证恢复协调器。
 *
 * 当用户主动加载/刷新/翻页 JM 收藏夹且 Python 后台恢复仍被 Cloudflare 挑战拦截时，
 * 主进程在此模块内串行编排：
 *   1. 解析结构化挑战错误（JSON-RPC -32002），校验来源、URL 与字段类型。
 *   2. 打开挑战窗口（复用登录窗口单飞协调器），让用户完成人机验证。
 *   3. 验证成功后同步浏览器 Cookie/UA 到 Python 认证配置。
 *   4. 用原页码和来源对 Python `get_favourites` 自动重试一次（禁止递归）。
 *   5. 重试仍被挑战且有合格快照时，把快照交给 Python 解析入口兜底。
 *   6. 任何环节失败（取消、超时、无快照、解析失败）→ 返回可操作错误，不再次弹窗。
 *
 * 安全约束：
 *   - Cookie/UA 原文、HTML 正文仅留在主进程与本地 Python 子进程之间，禁止进入 React renderer 或日志。
 *   - 一次用户动作最多一个窗口、一次 Python 重试、一次快照解析。
 *   - 用户取消或恢复失败不清除认证数据、不映射为登录失效。
 */
import type { BrowserWindow } from 'electron'
import { getPythonBridge, type PythonBridgeError } from './python-bridge'
import { openJmChallengeWindow, type JmChallengeSnapshot } from './login-window'
import { IPC_ERROR_CODES, type AntiBotChallengeData } from '../shared/types'

/** 挑战 URL 与 challengeUrl 字段最大长度（与 Python 端 _JM_SNAPSHOT_MAX_URL_LEN 对齐） */
const CHALLENGE_URL_MAX_LEN = 2048

export interface JmChallengeRecoveryContext {
  /** 主窗口引用，用于挂载模态挑战窗口 */
  mainWindow: BrowserWindow | null
  /** 当前 JM 主域名（用户配置的镜像域名，无则用默认 18comic.vip） */
  resolvedDomain?: string
}

export interface JmChallengeRecoveryOutcome {
  /** 恢复是否产生了可用的收藏夹结果 */
  resolved: boolean
  /** 收藏夹结果（resolved=true 时存在） */
  result?: { comics: unknown[]; pagination?: unknown; needsLogin: boolean }
  /** 用户可读的操作提示（resolved=false 时存在） */
  message?: string
  /** 区分用户主动取消与系统失败：取消保留缓存语义，失败提示重试 */
  cancelled?: boolean
}

/**
 * 从 PythonBridge 抛出的 Error 上提取并严格校验反爬挑战数据。
 *
 * 仅当 code === IPC_ERROR_CODES.ANTI_BOT_CHALLENGE 且 data 形如
 * { source: 'jm', challengeUrl: string, message: string } 时返回；
 * 任何字段缺失、类型不符或 URL 超长都视为无可信上下文，返回 null。
 *
 * 返回 null 时调用方应按普通错误处理，禁止据此打开 BrowserWindow。
 */
export function extractJmChallengeData(err: unknown): AntiBotChallengeData | null {
  if (!err || typeof err !== 'object') return null
  const e = err as PythonBridgeError
  if (e.code !== IPC_ERROR_CODES.ANTI_BOT_CHALLENGE) return null
  const data = e.data
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.source !== 'jm') return null
  if (typeof d.challengeUrl !== 'string' || d.challengeUrl.length === 0 || d.challengeUrl.length > CHALLENGE_URL_MAX_LEN) {
    return null
  }
  if (typeof d.message !== 'string') return null
  return { source: 'jm', challengeUrl: d.challengeUrl, message: d.message }
}

/**
 * 判断一个错误是否为可交互恢复的 JM 反爬挑战。
 *
 * 仅当错误码、来源、URL、消息字段全部合法时返回 true。调用方据此决定是否启动恢复；
 * 非交互调用（allowInteractiveChallenge=false）即使返回 true 也应按可恢复错误结束。
 */
export function isJmChallengeError(err: unknown): boolean {
  return extractJmChallengeData(err) !== null
}

/**
 * 运行 JM 收藏夹交互式人机验证恢复。
 *
 * 调用契约：
 *   - 仅在 source === 'jm' 且 allowInteractiveChallenge === true 且 isJmChallengeError(err) 时调用。
 *   - recoveryError 必须是经过 extractJmChallengeData 校验通过的挑战错误。
 *
 * 编排（每步失败即停止，不递归）：
 *   1. openJmChallengeWindow → 用户验证（取消/超时/崩溃 → 返回 cancelled=true）。
 *   2. 凭据已由挑战窗口在成功路径内同步到 Python（apply_auth）。
 *   3. bridge.call('get_favourites', {page, source:'jm'}) 重试一次。
 *      - 成功 → 返回 resolved=true + result。
 *      - 仍为挑战错误且有快照 → 走步骤 4。
 *      - 仍为挑战错误且无快照 → 返回 resolved=false + message。
 *      - 其他错误 → 返回 resolved=false + message。
 *   4. bridge.call('parse_jm_favourites_snapshot', {html, source_url, page}) 解析快照。
 *      - 成功 → 返回 resolved=true + result。
 *      - 失败 → 返回 resolved=false + message。
 */
export async function recoverJmChallenge(
  ctx: JmChallengeRecoveryContext,
  recoveryError: unknown,
  page: number,
): Promise<JmChallengeRecoveryOutcome> {
  const challengeData = extractJmChallengeData(recoveryError)
  // 防御：调用方应先校验，但此处再次确认，避免异常载荷触发窗口
  if (!challengeData) {
    return { resolved: false, message: '收藏夹请求遇到问题，请稍后重试' }
  }

  // 步骤 1：打开挑战窗口。openJmChallengeWindow 在 URL 非法时抛 Error，
  // 在用户取消/超时/窗口失败时返回 success=false（不抛）。
  let windowResult: { success: boolean; message?: string; snapshot?: JmChallengeSnapshot }
  try {
    windowResult = await openJmChallengeWindow(ctx.mainWindow, challengeData.challengeUrl, ctx.resolvedDomain)
  } catch {
    // URL 校验失败等不可恢复错误：不再次弹窗，返回可操作错误
    return { resolved: false, message: '收藏夹人机验证地址无效，请稍后重试' }
  }

  if (!windowResult.success) {
    // 用户取消 / 超时 / 窗口崩溃：保留缓存语义，不映射为登录失效
    return {
      resolved: false,
      cancelled: true,
      message: windowResult.message || '已取消',
    }
  }

  // 步骤 2-3：用原页码重试一次 Python 收藏夹请求（不递归进入恢复）
  const bridge = getPythonBridge()
  let retryResult: unknown
  try {
    retryResult = await bridge.call('get_favourites', { page, source: 'jm' })
  } catch (retryErr) {
    // 重试仍为挑战错误且有合格快照 → 走步骤 4
    if (isJmChallengeError(retryErr) && windowResult.snapshot) {
      return parseSnapshotFallback(bridge, windowResult.snapshot, page)
    }
    // 其他错误（含无快照的二次挑战）→ 停止恢复
    return {
      resolved: false,
      message: '人机验证后仍无法获取收藏夹，请稍后重试',
    }
  }

  // 重试成功 → 返回标准结果，禁止调用快照解析
  return {
    resolved: true,
    result: retryResult as { comics: unknown[]; pagination?: unknown; needsLogin: boolean },
  }
}

/**
 * 步骤 4：将浏览器快照交给 Python JM 解析入口兜底。
 *
 * 快照的 sourceUrl 必须来自可信 JM 收藏夹 URL（已在 captureJmChallengeSnapshot 校验），
 * Python 端会再次校验 URL/host/path/大小，禁止信任 Electron 传入值。
 */
async function parseSnapshotFallback(
  bridge: ReturnType<typeof getPythonBridge>,
  snapshot: JmChallengeSnapshot,
  page: number,
): Promise<JmChallengeRecoveryOutcome> {
  try {
    const parsed = await bridge.call('parse_jm_favourites_snapshot', {
      html: snapshot.html,
      source_url: snapshot.sourceUrl,
      page,
    })
    return {
      resolved: true,
      result: parsed as { comics: unknown[]; pagination?: unknown; needsLogin: boolean },
    }
  } catch {
    return {
      resolved: false,
      message: '已通过人机验证，但无法解析收藏夹页面，请稍后重试',
    }
  }
}
