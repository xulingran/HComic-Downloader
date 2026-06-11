import { net, app } from 'electron'
import type { UpdateCheckResult } from '../shared/types'

const GITHUB_REPO = 'xulingran/HComic-Downloader'
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

const CACHE_TTL_MS = 10 * 60 * 1000
let cachedResult: { timestamp: number; result: UpdateCheckResult } | null = null

export function resetUpdateCache(): void {
  cachedResult = null
}

export function compareVersions(current: string, latest: string): number {
  const normalize = (v: string): number[] =>
    v.replace(/^v/, '').split('.').map(s => {
      const n = parseInt(s, 10)
      return Number.isNaN(n) ? 0 : n
    })
  const cur = normalize(current)
  const lat = normalize(latest)
  for (let i = 0; i < 3; i++) {
    if ((lat[i] || 0) > (cur[i] || 0)) return 1
    if ((lat[i] || 0) < (cur[i] || 0)) return -1
  }
  return 0
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return cachedResult.result
  }

  try {
    const response = await net.fetch(RELEASES_API_URL)
    if (!response.ok) {
      const result: UpdateCheckResult = { hasUpdate: false, error: `GitHub API returned ${response.status}` }
      cachedResult = { timestamp: Date.now(), result }
      return result
    }
    const data = await response.json() as {
      tag_name: string
      body: string
      html_url: string
    }
    const latestVersion = data.tag_name.replace(/^v/, '')
    const currentVersion = app.getVersion()

    if (compareVersions(currentVersion, latestVersion) > 0) {
      const result: UpdateCheckResult = {
        hasUpdate: true,
        latestVersion,
        changelog: data.body || '',
        releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      }
      cachedResult = { timestamp: Date.now(), result }
      return result
    }
    const result: UpdateCheckResult = { hasUpdate: false }
    cachedResult = { timestamp: Date.now(), result }
    return result
  } catch (err) {
    const result: UpdateCheckResult = { hasUpdate: false, error: err instanceof Error ? err.message : String(err) }
    cachedResult = { timestamp: Date.now(), result }
    return result
  }
}
