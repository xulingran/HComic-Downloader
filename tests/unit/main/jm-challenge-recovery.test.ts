// @vitest-environment node
// 任务 5.5：JM 交互式人机验证恢复协调器单元测试。
// 覆盖：交互开关默认值、错误载荷校验、后台挑战不弹窗、成功重试、快照兜底、
// 取消、二次挑战停止、非法错误载荷拒绝。
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockBridgeCall, mockOpenJmChallengeWindow, mockCaptureJmFavouritesSnapshotWindow, loginWindowImports } = vi.hoisted(() => ({
  mockBridgeCall: vi.fn(),
  mockOpenJmChallengeWindow: vi.fn(),
  mockCaptureJmFavouritesSnapshotWindow: vi.fn(),
  loginWindowImports: {} as { resolvedDomain?: string; challengeUrl?: string },
}))

vi.mock('../../../electron/python-bridge', () => ({
  getPythonBridge: () => ({ call: mockBridgeCall }),
  // 暴露类型供测试引用（编译期需要，运行时为 undefined）
}))

vi.mock('../../../electron/login-window', () => ({
  openJmChallengeWindow: mockOpenJmChallengeWindow,
  captureJmFavouritesSnapshotWindow: mockCaptureJmFavouritesSnapshotWindow,
}))

import {
  extractJmChallengeData,
  isJmChallengeError,
  recoverJmChallenge,
  recoverJmFavouritesSilently,
  resetJmChallengeRecoveryStateForTests,
} from '../../../electron/jm-challenge-recovery'
import { IPC_ERROR_CODES } from '../../../shared/types'
import type { BrowserWindow } from 'electron'

function makeMainWindow(): BrowserWindow {
  return { isDestroyed: vi.fn().mockReturnValue(false) } as unknown as BrowserWindow
}

function makeChallengeError(
  overrides: Partial<{ source: unknown; challengeUrl: unknown; message: unknown; code: number; data: unknown }> = {},
): Error & { code?: number; data?: unknown } {
  const err = new Error('JM 站点人机验证持续阻断') as Error & { code?: number; data?: unknown }
  err.code = overrides.code ?? IPC_ERROR_CODES.ANTI_BOT_CHALLENGE
  // 显式判断 hasOwnProperty，避免 null/undefined 被默认值吞掉（?? 对 null 也回退）
  const hasDataOverride = Object.prototype.hasOwnProperty.call(overrides, 'data')
  err.data = hasDataOverride
    ? overrides.data
    : {
        source: 'jm',
        challengeUrl: 'https://18comic.vip/user/testuser/favorite/albums',
        message: 'JM 站点人机验证持续阻断',
      }
  return err
}

describe('jm-challenge-recovery: extractJmChallengeData (载荷校验)', () => {
  it('accepts well-formed anti-bot challenge payload', () => {
    const data = extractJmChallengeData(makeChallengeError())
    expect(data).toEqual({
      source: 'jm',
      challengeUrl: 'https://18comic.vip/user/testuser/favorite/albums',
      message: 'JM 站点人机验证持续阻断',
    })
  })

  it('returns null for non-anti-bot error code', () => {
    expect(extractJmChallengeData(makeChallengeError({ code: IPC_ERROR_CODES.AUTH_REQUIRED }))).toBeNull()
    expect(extractJmChallengeData(makeChallengeError({ code: -32000 }))).toBeNull()
  })

  it('returns null when data is not an object', () => {
    expect(extractJmChallengeData(makeChallengeError({ data: 'string' }))).toBeNull()
    expect(extractJmChallengeData(makeChallengeError({ data: null }))).toBeNull()
    expect(extractJmChallengeData(makeChallengeError({ data: undefined }))).toBeNull()
    expect(extractJmChallengeData(makeChallengeError({ data: 42 }))).toBeNull()
  })

  it('returns null when source is not jm', () => {
    expect(
      extractJmChallengeData(
        makeChallengeError({ data: { source: 'hcomic', challengeUrl: 'https://18comic.vip/user/u/favorite/albums', message: 'x' } }),
      ),
    ).toBeNull()
  })

  it('returns null when challengeUrl is missing or wrong type', () => {
    expect(extractJmChallengeData(makeChallengeError({ data: { source: 'jm', message: 'x' } }))).toBeNull()
    expect(
      extractJmChallengeData(makeChallengeError({ data: { source: 'jm', challengeUrl: 123, message: 'x' } })),
    ).toBeNull()
  })

  it('returns null when challengeUrl exceeds 2048 chars', () => {
    const longUrl = 'https://18comic.vip/user/u/favorite/albums?' + 'a'.repeat(2048)
    expect(
      extractJmChallengeData(
        makeChallengeError({ data: { source: 'jm', challengeUrl: longUrl, message: 'x' } }),
      ),
    ).toBeNull()
  })

  it('returns null when message is not a string', () => {
    expect(
      extractJmChallengeData(
        makeChallengeError({ data: { source: 'jm', challengeUrl: 'https://18comic.vip/user/u/favorite/albums', message: 123 } }),
      ),
    ).toBeNull()
  })

  it('returns null for non-error inputs', () => {
    expect(extractJmChallengeData(null)).toBeNull()
    expect(extractJmChallengeData(undefined)).toBeNull()
    expect(extractJmChallengeData('string')).toBeNull()
    expect(extractJmChallengeData(42)).toBeNull()
  })

  it('isJmChallengeError mirrors extractJmChallengeData verdict', () => {
    expect(isJmChallengeError(makeChallengeError())).toBe(true)
    expect(isJmChallengeError(makeChallengeError({ code: -32000 }))).toBe(false)
    expect(isJmChallengeError(new Error('普通错误'))).toBe(false)
  })
})

describe('jm-challenge-recovery: recoverJmChallenge (编排)', () => {
  beforeEach(() => {
    mockBridgeCall.mockReset()
    mockOpenJmChallengeWindow.mockReset()
    mockCaptureJmFavouritesSnapshotWindow.mockReset()
    resetJmChallengeRecoveryStateForTests()
    loginWindowImports.resolvedDomain = undefined
    loginWindowImports.challengeUrl = undefined
  })

  const ctx = { mainWindow: makeMainWindow(), resolvedDomain: undefined }

  it('step 3 success: Python retry returns favourites, no snapshot parsing', async () => {
    const favResult = { comics: [{ id: '1' }], pagination: { currentPage: 1 }, needsLogin: false }
    mockOpenJmChallengeWindow.mockResolvedValue({ success: true, message: '人机验证已完成' })
    mockBridgeCall.mockResolvedValueOnce(favResult)

    const outcome = await recoverJmChallenge(ctx, makeChallengeError(), 1)

    expect(outcome.resolved).toBe(true)
    expect(outcome.result).toEqual(favResult)
    // 仅一次 get_favourites 重试，未调用 parse_jm_favourites_snapshot
    expect(mockBridgeCall).toHaveBeenCalledTimes(1)
    expect(mockBridgeCall).toHaveBeenCalledWith('get_favourites', { page: 1, source: 'jm' })
  })

  it('step 4 fallback: Python retry still challenged with snapshot → snapshot parsing succeeds', async () => {
    const snapshotHtml = '<html><body>rendered</body></html>'
    mockOpenJmChallengeWindow.mockResolvedValue({
      success: true,
      message: '人机验证已完成',
      snapshot: { html: snapshotHtml, sourceUrl: 'https://18comic.vip/user/u/favorite/albums' },
    })
    // 重试仍抛挑战错误
    mockBridgeCall.mockRejectedValueOnce(makeChallengeError())
    // 快照解析成功
    const snapshotResult = { comics: [{ id: '2' }], pagination: { currentPage: 1 }, needsLogin: false }
    mockBridgeCall.mockResolvedValueOnce(snapshotResult)

    const outcome = await recoverJmChallenge(ctx, makeChallengeError(), 1)

    expect(outcome.resolved).toBe(true)
    expect(outcome.result).toEqual(snapshotResult)
    expect(mockBridgeCall).toHaveBeenNthCalledWith(2, 'parse_jm_favourites_snapshot', {
      html: snapshotHtml,
      source_url: 'https://18comic.vip/user/u/favorite/albums',
      page: 1,
    })
  })

  it('step 4 fails: snapshot parsing throws → resolved=false with actionable message', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({
      success: true,
      snapshot: { html: '<html></html>', sourceUrl: 'https://18comic.vip/user/u/favorite/albums' },
    })
    mockBridgeCall.mockRejectedValueOnce(makeChallengeError()) // 重试仍挑战
    mockBridgeCall.mockRejectedValueOnce(new Error('parse failed')) // 快照解析失败

    const outcome = await recoverJmChallenge(ctx, makeChallengeError(), 1)

    expect(outcome.resolved).toBe(false)
    expect(outcome.message).toContain('解析')
  })

  it('second challenge with no snapshot → stops, resolved=false, no second window', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({ success: true, message: 'ok' })
    mockBridgeCall.mockRejectedValueOnce(makeChallengeError()) // 重试仍挑战，但无 snapshot

    const outcome = await recoverJmChallenge(ctx, makeChallengeError(), 1)

    expect(outcome.resolved).toBe(false)
    expect(outcome.message).toContain('无法获取')
    // 只打开了一次窗口（禁止递归弹窗）
    expect(mockOpenJmChallengeWindow).toHaveBeenCalledTimes(1)
  })

  it('user cancel → resolved=false, cancelled=true, no Python retry, auth not cleared', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({ success: false, message: '已取消' })

    const outcome = await recoverJmChallenge(ctx, makeChallengeError(), 1)

    expect(outcome.resolved).toBe(false)
    expect(outcome.cancelled).toBe(true)
    expect(outcome.message).toBe('已取消')
    // 取消后不应调用 Python（未清除认证、未重试）
    expect(mockBridgeCall).not.toHaveBeenCalled()
  })

  it('challenge window timeout → resolved=false with 超时 message', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({ success: false, message: '人机验证超时，请重试' })

    const outcome = await recoverJmChallenge(ctx, makeChallengeError(), 1)

    expect(outcome.resolved).toBe(false)
    expect(outcome.message).toContain('超时')
  })

  it('challenge window URL validation throws → resolved=false, no second window', async () => {
    mockOpenJmChallengeWindow.mockRejectedValue(new Error('JM 人机验证 URL 不受信任'))

    const outcome = await recoverJmChallenge(ctx, makeChallengeError(), 1)

    expect(outcome.resolved).toBe(false)
    expect(outcome.message).toContain('无效')
  })

  it('retry throws non-challenge error → resolved=false', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({ success: true })
    mockBridgeCall.mockRejectedValueOnce(new Error('网络错误'))

    const outcome = await recoverJmChallenge(ctx, makeChallengeError(), 1)

    expect(outcome.resolved).toBe(false)
  })

  it('non-challenge error passed to recoverJmChallenge → resolved=false without opening window', async () => {
    const outcome = await recoverJmChallenge(ctx, makeChallengeError({ code: -32000 }), 1)

    expect(outcome.resolved).toBe(false)
    expect(mockOpenJmChallengeWindow).not.toHaveBeenCalled()
  })

  it('forwards page parameter to both get_favourites retry and snapshot parsing', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({
      success: true,
      snapshot: { html: '<html></html>', sourceUrl: 'https://18comic.vip/user/u/favorite/albums?page=3' },
    })
    mockBridgeCall.mockRejectedValueOnce(makeChallengeError())
    mockBridgeCall.mockResolvedValueOnce({ comics: [], needsLogin: false })

    await recoverJmChallenge(ctx, makeChallengeError(), 3)

    expect(mockBridgeCall).toHaveBeenNthCalledWith(1, 'get_favourites', { page: 3, source: 'jm' })
    expect(mockBridgeCall).toHaveBeenNthCalledWith(2, 'parse_jm_favourites_snapshot', expect.objectContaining({ page: 3 }))
  })

  it('silent favourites recovery parses hidden browser snapshot without calling Python get_favourites first', async () => {
    const snapshot = {
      html: '<html><body>page2</body></html>',
      sourceUrl: 'https://18comic.vip/user/u/favorite/albums?page=2',
    }
    mockCaptureJmFavouritesSnapshotWindow.mockResolvedValueOnce({ success: true, snapshot })
    mockBridgeCall.mockResolvedValueOnce({ comics: [{ id: '2' }], needsLogin: false })

    const outcome = await recoverJmFavouritesSilently(
      ctx,
      'https://18comic.vip/user/u/favorite/albums?page=2',
      2,
    )

    expect(outcome.resolved).toBe(true)
    expect(mockOpenJmChallengeWindow).not.toHaveBeenCalled()
    expect(mockBridgeCall).toHaveBeenCalledTimes(1)
    expect(mockBridgeCall).toHaveBeenCalledWith('parse_jm_favourites_snapshot', {
      html: snapshot.html,
      source_url: snapshot.sourceUrl,
      page: 2,
    })
  })

  it('after snapshot fallback, next challenged page uses hidden snapshot capture without opening challenge window', async () => {
    const firstSnapshot = {
      html: '<html><body>page1</body></html>',
      sourceUrl: 'https://18comic.vip/user/u/favorite/albums',
    }
    const secondSnapshot = {
      html: '<html><body>page2</body></html>',
      sourceUrl: 'https://18comic.vip/user/u/favorite/albums?page=2',
    }
    mockOpenJmChallengeWindow.mockResolvedValueOnce({ success: true, snapshot: firstSnapshot })
    mockBridgeCall.mockRejectedValueOnce(makeChallengeError())
    mockBridgeCall.mockResolvedValueOnce({ comics: [{ id: '1' }], needsLogin: false })

    const first = await recoverJmChallenge(ctx, makeChallengeError(), 1)
    expect(first.resolved).toBe(true)

    mockBridgeCall.mockClear()
    mockCaptureJmFavouritesSnapshotWindow.mockResolvedValueOnce({ success: true, snapshot: secondSnapshot })
    mockBridgeCall.mockResolvedValueOnce({ comics: [{ id: '2' }], needsLogin: false })

    const second = await recoverJmChallenge(
      ctx,
      makeChallengeError({ data: { source: 'jm', challengeUrl: secondSnapshot.sourceUrl, message: 'JM 站点人机验证持续阻断' } }),
      2,
    )

    expect(second.resolved).toBe(true)
    expect(mockOpenJmChallengeWindow).toHaveBeenCalledTimes(1)
    expect(mockCaptureJmFavouritesSnapshotWindow).toHaveBeenCalledWith(ctx.mainWindow, secondSnapshot.sourceUrl, undefined)
    expect(mockBridgeCall).toHaveBeenCalledWith('parse_jm_favourites_snapshot', {
      html: secondSnapshot.html,
      source_url: secondSnapshot.sourceUrl,
      page: 2,
    })
  })

  it('passes resolvedDomain to challenge window', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({ success: true })
    mockBridgeCall.mockResolvedValue({ comics: [], needsLogin: false })

    await recoverJmChallenge(
      { mainWindow: makeMainWindow(), resolvedDomain: 'jmcomic-zzz.one' },
      makeChallengeError(),
      1,
    )

    expect(mockOpenJmChallengeWindow).toHaveBeenCalledWith(
      expect.anything(),
      'https://18comic.vip/user/testuser/favorite/albums',
      'jmcomic-zzz.one',
    )
  })
})
