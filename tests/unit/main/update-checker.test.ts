// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFetch, mockGetVersion } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockGetVersion: vi.fn().mockReturnValue('1.0.0'),
}))

vi.mock('electron', () => ({
  net: { fetch: mockFetch },
  app: { getVersion: mockGetVersion },
}))

import { compareVersions, checkForUpdates, resetUpdateCache } from '../../../electron/update-checker'

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('returns positive when latest is greater (patch)', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeGreaterThan(0)
  })

  it('returns positive when latest is greater (minor)', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBeGreaterThan(0)
  })

  it('returns positive when latest is greater (major)', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeGreaterThan(0)
  })

  it('returns negative when current is greater', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeLessThan(0)
  })

  it('handles v prefix', () => {
    expect(compareVersions('1.0.0', 'v1.0.1')).toBeGreaterThan(0)
  })

  it('handles shorter version strings', () => {
    expect(compareVersions('1.0', '1.0.1')).toBeGreaterThan(0)
  })
})

describe('checkForUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetVersion.mockReturnValue('1.0.0')
    resetUpdateCache()
  })

  it('returns hasUpdate when newer version found', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v1.1.0',
        body: "## What's Changed\n- New feature",
        html_url: 'https://github.com/xulingran/HComic-Downloader/releases/tag/v1.1.0',
      }),
    })

    const result = await checkForUpdates()

    expect(result).toEqual({
      hasUpdate: true,
      latestVersion: '1.1.0',
      changelog: "## What's Changed\n- New feature",
      releaseUrl: 'https://github.com/xulingran/HComic-Downloader/releases/tag/v1.1.0',
    })
  })

  it('returns hasUpdate false when already up to date', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v1.0.0',
        body: '',
        html_url: 'https://github.com/xulingran/HComic-Downloader/releases/tag/v1.0.0',
      }),
    })

    const result = await checkForUpdates()
    expect(result).toEqual({ hasUpdate: false })
  })

  it('returns error when API request fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
    })

    const result = await checkForUpdates()
    expect(result).toEqual({ hasUpdate: false, error: 'GitHub API returned 403' })
  })

  it('returns error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await checkForUpdates()
    expect(result).toEqual({ hasUpdate: false, error: 'Network error' })
  })
})
