// @vitest-environment node
// 任务 5.5：JM 交互式人机验证恢复协调器单元测试。
// 覆盖：交互开关默认值、错误载荷校验、后台挑战不弹窗、成功重试、快照兜底、
// 取消、二次挑战停止、非法错误载荷拒绝。
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

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
  recoverJmSearchChallenge,
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

describe('jm-challenge-recovery: recoverJmSearchChallenge (搜索恢复编排)', () => {
  beforeEach(() => {
    mockBridgeCall.mockReset()
    mockOpenJmChallengeWindow.mockReset()
    mockCaptureJmFavouritesSnapshotWindow.mockReset()
    resetJmChallengeRecoveryStateForTests()
  })

  const ctx = { mainWindow: makeMainWindow(), resolvedDomain: undefined }
  const searchParams = { query: 'test', mode: 'keyword', page: 1, source: 'jm', tag: '' }

  it('retry success: search retry returns results, no snapshot parsing', async () => {
    const searchResult = { comics: [{ id: '1' }], pagination: { currentPage: 1, totalPages: 1, totalItems: 1 } }
    mockOpenJmChallengeWindow.mockResolvedValue({ success: true, message: '人机验证已完成' })
    mockBridgeCall.mockResolvedValueOnce(searchResult)

    const outcome = await recoverJmSearchChallenge(ctx, makeChallengeError(), searchParams)

    expect(outcome.resolved).toBe(true)
    expect(outcome.result).toEqual(searchResult)
    // 重试调用 search，而非 get_favourites；不调用快照解析
    expect(mockBridgeCall).toHaveBeenCalledTimes(1)
    expect(mockBridgeCall).toHaveBeenCalledWith('search', expect.objectContaining({ query: 'test', mode: 'keyword', page: 1 }))
  })

  it('retry still challenged → search snapshot fallback succeeds', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({
      success: true,
      snapshot: { html: '<html>search results</html>', sourceUrl: 'https://18comic.vip/search/photos?main_tag=0&search_query=test' },
    })
    mockBridgeCall
      .mockRejectedValueOnce(makeChallengeError()) // search 重试仍挑战
      .mockResolvedValueOnce({ comics: [{ id: '1' }], pagination: { currentPage: 1 } }) // 快照解析成功

    const outcome = await recoverJmSearchChallenge(ctx, makeChallengeError(), searchParams)

    expect(outcome.resolved).toBe(true)
    expect(outcome.result).toEqual({ comics: [{ id: '1' }], pagination: { currentPage: 1 } })
    // 第一次调 search 重试，第二次调 parse_jm_search_snapshot 快照解析
    expect(mockBridgeCall).toHaveBeenCalledTimes(2)
    expect(mockBridgeCall).toHaveBeenNthCalledWith(2, 'parse_jm_search_snapshot', expect.objectContaining({
      query: 'test',
      page: 1,
    }))
    // 禁止调用收藏夹快照入口
    expect(mockBridgeCall).not.toHaveBeenCalledWith('parse_jm_favourites_snapshot', expect.anything())
    // 禁止递归弹窗
    expect(mockOpenJmChallengeWindow).toHaveBeenCalledTimes(1)
  })

  it('user cancel → resolved=false, cancelled=true, no Python retry', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({ success: false, message: '已取消' })

    const outcome = await recoverJmSearchChallenge(ctx, makeChallengeError(), searchParams)

    expect(outcome.resolved).toBe(false)
    expect(outcome.cancelled).toBe(true)
    expect(mockBridgeCall).not.toHaveBeenCalled()
  })

  it('forwards original search params (query/mode/page/source/tag) to retry', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({ success: true })
    mockBridgeCall.mockResolvedValueOnce({ comics: [], pagination: { currentPage: 2 } })

    await recoverJmSearchChallenge(ctx, makeChallengeError(), {
      query: '漫画',
      mode: 'tag',
      page: 2,
      source: 'jm',
      tag: '百合',
    })

    expect(mockBridgeCall).toHaveBeenCalledWith('search', {
      query: '漫画',
      mode: 'tag',
      page: 2,
      source: 'jm',
      tag: '百合',
    })
  })

  it('non-challenge error → resolved=false without opening window', async () => {
    const outcome = await recoverJmSearchChallenge(ctx, makeChallengeError({ code: -32000 }), searchParams)

    expect(outcome.resolved).toBe(false)
    expect(mockOpenJmChallengeWindow).not.toHaveBeenCalled()
  })

  it('challenge window URL validation throws → resolved=false', async () => {
    mockOpenJmChallengeWindow.mockRejectedValue(new Error('JM 人机验证 URL 不受信任'))

    const outcome = await recoverJmSearchChallenge(ctx, makeChallengeError(), searchParams)

    expect(outcome.resolved).toBe(false)
    expect(outcome.message).toContain('无效')
  })

  // ── 任务 3.4：首页根 URL 与普通搜索 URL 原样传给挑战窗口 ───────────────────
  it('home root URL passed as-is to challenge window, retries search once after success', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({ success: true, message: '人机验证已完成' })
    mockBridgeCall.mockResolvedValueOnce({ comics: [], pagination: { currentPage: 1 } })

    const outcome = await recoverJmSearchChallenge(
      ctx,
      makeChallengeError({ data: { source: 'jm', challengeUrl: 'https://18comic.vip/', message: 'JM 站点人机验证持续阻断' } }),
      searchParams,
    )

    expect(outcome.resolved).toBe(true)
    // 首页根 URL 必须原样传给窗口（禁止改写为收藏夹 URL）
    expect(mockOpenJmChallengeWindow).toHaveBeenCalledWith(ctx.mainWindow, 'https://18comic.vip/', undefined)
    // 成功后只用原参数重试 search 一次
    expect(mockBridgeCall).toHaveBeenCalledTimes(1)
    expect(mockBridgeCall).toHaveBeenCalledWith('search', expect.objectContaining({ query: searchParams.query, page: searchParams.page }))
  })

  it('search URL passed as-is to challenge window, retries search once after success', async () => {
    const searchChallengeUrl = 'https://18comic.vip/search/photos?main_tag=0&search_query=test'
    mockOpenJmChallengeWindow.mockResolvedValue({ success: true })
    mockBridgeCall.mockResolvedValueOnce({ comics: [{ id: '1' }] })

    const outcome = await recoverJmSearchChallenge(
      ctx,
      makeChallengeError({ data: { source: 'jm', challengeUrl: searchChallengeUrl, message: 'JM 站点人机验证持续阻断' } }),
      searchParams,
    )

    expect(outcome.resolved).toBe(true)
    // 搜索 URL 原样传给窗口
    expect(mockOpenJmChallengeWindow).toHaveBeenCalledWith(ctx.mainWindow, searchChallengeUrl, undefined)
    // 只重试一次，不调用快照入口
    expect(mockBridgeCall).toHaveBeenCalledTimes(1)
    expect(mockBridgeCall).not.toHaveBeenCalledWith('parse_jm_favourites_snapshot', expect.anything())
  })

  it('home root URL: success after search retry does NOT call snapshot fallback', async () => {
    // 重试成功时不应走快照兜底
    mockOpenJmChallengeWindow.mockResolvedValue({
      success: true,
      snapshot: { html: '<html>home</html>', sourceUrl: 'https://18comic.vip/' },
    })
    mockBridgeCall.mockResolvedValueOnce({ comics: [{ id: '1' }] })

    await recoverJmSearchChallenge(
      ctx,
      makeChallengeError({ data: { source: 'jm', challengeUrl: 'https://18comic.vip/', message: 'x' } }),
      searchParams,
    )

    expect(mockBridgeCall).not.toHaveBeenCalledWith('parse_jm_favourites_snapshot', expect.anything())
  })

  it('home empty-search: retry still challenged → home snapshot fallback succeeds', async () => {
    const homeSearchParams = { query: '', mode: 'keyword', page: 1, source: 'jm', tag: '' }
    mockOpenJmChallengeWindow.mockResolvedValue({
      success: true,
      snapshot: { html: '<html>home sections</html>', sourceUrl: 'https://18comic.vip/' },
    })
    mockBridgeCall
      .mockRejectedValueOnce(makeChallengeError()) // search 重试仍挑战
      .mockResolvedValueOnce({ comics: [{ id: '1' }], pagination: { currentPage: 1 }, sections: [] })

    const outcome = await recoverJmSearchChallenge(
      ctx,
      makeChallengeError({ data: { source: 'jm', challengeUrl: 'https://18comic.vip/', message: 'x' } }),
      homeSearchParams,
    )

    expect(outcome.resolved).toBe(true)
    // 首页空搜索走 parse_jm_home_snapshot，而非 parse_jm_search_snapshot
    expect(mockBridgeCall).toHaveBeenNthCalledWith(2, 'parse_jm_home_snapshot', expect.objectContaining({
      html: '<html>home sections</html>',
    }))
    expect(mockBridgeCall).not.toHaveBeenCalledWith('parse_jm_search_snapshot', expect.anything())
  })

  it('search snapshot fallback fails → resolved=false with actionable message', async () => {
    mockOpenJmChallengeWindow.mockResolvedValue({
      success: true,
      snapshot: { html: '<html></html>', sourceUrl: 'https://18comic.vip/search/photos?main_tag=0&search_query=test' },
    })
    mockBridgeCall
      .mockRejectedValueOnce(makeChallengeError()) // search 重试仍挑战
      .mockRejectedValueOnce(new Error('parse error')) // 快照解析失败

    const outcome = await recoverJmSearchChallenge(ctx, makeChallengeError(), searchParams)

    expect(outcome.resolved).toBe(false)
    expect(outcome.message).toContain('解析')
  })

  it('home root URL: records safe diagnostic on URL validation failure (renderer gets generic message)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockOpenJmChallengeWindow.mockRejectedValue(new Error('JM 人机验证 URL 不受信任'))

    const outcome = await recoverJmSearchChallenge(
      ctx,
      makeChallengeError({ data: { source: 'jm', challengeUrl: 'https://18comic.vip/', message: 'x' } }),
      searchParams,
    )

    expect(outcome.resolved).toBe(false)
    // renderer 收到通用文案，不含 URL/query
    expect(outcome.message).toBe('人机验证地址无效，请稍后重试')
    // 主进程记录了安全诊断（仅类别，不含完整 URL/搜索词）
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[JmChallengeRecovery]'))
    // 诊断日志不得包含 challengeUrl 原文或 search_query
    const diagLine = warnSpy.mock.calls[0]?.[0] as string
    expect(diagLine).not.toContain('search_query')
    warnSpy.mockRestore()
  })
})

// ── 任务 3.5：recovery 与 login-window 实际 URL 纯函数校验的跨模块契约测试 ─────
// 防止 recovery 层接受的 URL 样本与 login-window 的 allowlist 再次分叉。
// 文件顶部 mock 了 login-window，此处通过 vi.importActual 获取真实的纯函数校验器，
// 对 recovery 会接受的 URL 样本逐一验证，确保 allowlist 不再漂移。
describe('jm-challenge-recovery × login-window: challenge URL contract (no mock)', () => {
  // 真实校验器：vi.importActual 绕过文件顶部的 vi.mock
  type RealValidator = {
    resolveJmChallengeTarget: (url: string, resolvedDomain?: string) => { url: string; domain: string }
    validateJmFavouritesSnapshotUrl: (url: string, resolvedDomain?: string) => void
    validateJmSearchSnapshotUrl: (url: string, resolvedDomain?: string) => void
    validateJmHomeSnapshotUrl: (url: string, resolvedDomain?: string) => void
  }
  let real: RealValidator
  beforeAll(async () => {
    real = await vi.importActual<typeof import('../../../electron/login-window')>('../../../electron/login-window')
  })

  // recovery 会接受的所有合法 challengeUrl 样本，必须通过 login-window 的真实校验器
  const recoveryAcceptedUrls: ReadonlyArray<{ label: string; url: string }> = [
    { label: 'home root (default domain)', url: 'https://18comic.vip/' },
    { label: 'home root (mirror)', url: 'https://jmcomic-zzz.one/' },
    { label: 'search canonical', url: 'https://18comic.vip/search/photos?main_tag=0&search_query=test' },
    { label: 'search with page', url: 'https://18comic.vip/search/photos?main_tag=0&search_query=test&page=2' },
    { label: 'search empty query', url: 'https://18comic.vip/search/photos?main_tag=0&search_query=' },
    { label: 'favourites canonical', url: 'https://18comic.vip/user/testuser/favorite/albums' },
    { label: 'favourites with page', url: 'https://18comic.vip/user/testuser/favorite/albums?page=3' },
  ]

  for (const { label, url } of recoveryAcceptedUrls) {
    it(`recovery sample passes real resolveJmChallengeTarget: ${label}`, () => {
      expect(() => real.resolveJmChallengeTarget(url)).not.toThrow()
    })
  }

  // recovery 样本中只有收藏夹 URL 可作为快照；首页/搜索必须被快照校验拒绝
  const snapshotRejectedUrls: ReadonlyArray<{ label: string; url: string }> = [
    { label: 'home root cannot be snapshot', url: 'https://18comic.vip/' },
    { label: 'search cannot be snapshot', url: 'https://18comic.vip/search/photos?main_tag=0&search_query=test' },
  ]

  for (const { label, url } of snapshotRejectedUrls) {
    it(`recovery sample rejected by validateJmFavouritesSnapshotUrl: ${label}`, () => {
      expect(() => real.validateJmFavouritesSnapshotUrl(url)).toThrow('不受信任')
    })
  }

  // recovery 会拒绝的非法 challengeUrl 样本，必须被真实校验器拒绝
  const recoveryRejectedUrls: ReadonlyArray<{ label: string; url: string }> = [
    { label: 'non-trusted domain', url: 'https://evil.example/' },
    { label: 'non-https', url: 'http://18comic.vip/' },
    { label: 'arbitrary path', url: 'https://18comic.vip/albums/hanman' },
    { label: 'search with unknown param', url: 'https://18comic.vip/search/photos?main_tag=0&search_query=test&evil=1' },
    { label: 'search missing main_tag', url: 'https://18comic.vip/search/photos?search_query=test' },
    { label: 'search missing search_query', url: 'https://18comic.vip/search/photos?main_tag=0' },
    { label: 'userinfo', url: 'https://user:pass@18comic.vip/' },
  ]

  for (const { label, url } of recoveryRejectedUrls) {
    it(`recovery sample rejected by real resolveJmChallengeTarget: ${label}`, () => {
      expect(() => real.resolveJmChallengeTarget(url)).toThrow()
    })
  }

  // 搜索 URL 可作为搜索快照，但不可作为收藏夹/首页快照
  const searchSnapshotAcceptedUrls: ReadonlyArray<{ label: string; url: string }> = [
    { label: 'search canonical', url: 'https://18comic.vip/search/photos?main_tag=0&search_query=test' },
    { label: 'search with page', url: 'https://18comic.vip/search/photos?main_tag=0&search_query=test&page=2' },
    { label: 'search empty query', url: 'https://18comic.vip/search/photos?main_tag=0&search_query=' },
  ]

  for (const { label, url } of searchSnapshotAcceptedUrls) {
    it(`search snapshot validator accepts: ${label}`, () => {
      expect(() => real.validateJmSearchSnapshotUrl(url)).not.toThrow()
    })
  }

  it('search snapshot validator rejects home root URL', () => {
    expect(() => real.validateJmSearchSnapshotUrl('https://18comic.vip/')).toThrow('不受信任')
  })

  it('search snapshot validator rejects favourites URL', () => {
    expect(() => real.validateJmSearchSnapshotUrl('https://18comic.vip/user/testuser/favorite/albums')).toThrow('不受信任')
  })

  // 首页 URL 可作为首页快照，但不可作为收藏夹/搜索快照
  const homeSnapshotAcceptedUrls: ReadonlyArray<{ label: string; url: string }> = [
    { label: 'home root (default domain)', url: 'https://18comic.vip/' },
    { label: 'home root (mirror)', url: 'https://jmcomic-zzz.one/' },
  ]

  for (const { label, url } of homeSnapshotAcceptedUrls) {
    it(`home snapshot validator accepts: ${label}`, () => {
      expect(() => real.validateJmHomeSnapshotUrl(url)).not.toThrow()
    })
  }

  it('home snapshot validator rejects search URL', () => {
    expect(() => real.validateJmHomeSnapshotUrl('https://18comic.vip/search/photos?main_tag=0&search_query=test')).toThrow('不受信任')
  })

  it('home snapshot validator rejects favourites URL', () => {
    expect(() => real.validateJmHomeSnapshotUrl('https://18comic.vip/user/testuser/favorite/albums')).toThrow('不受信任')
  })

  it('home snapshot validator rejects root with query', () => {
    expect(() => real.validateJmHomeSnapshotUrl('https://18comic.vip/?foo=1')).toThrow()
  })
})
