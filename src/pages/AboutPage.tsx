import { useState, useCallback } from 'react'
import type { MouseEvent } from 'react'
import type { UpdateInfo, UpdateCheckResult } from '@shared/types'
import { LogoIcon } from '../components/LogoIcon'
import { UpdateDialog } from '../components/UpdateDialog'

declare const __APP_NAME__: string
declare const __APP_DESCRIPTION__: string
declare const __APP_VERSION__: string

const REPOSITORY_URL = 'https://github.com/xulingran/HComic-Downloader'

type CheckState = 'idle' | 'checking' | 'up-to-date' | 'error'

export function AboutPage() {
  const [checkState, setCheckState] = useState<CheckState>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const openRepository = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (window.hcomic) {
      window.hcomic.openUrl(REPOSITORY_URL)
    } else {
      window.open(REPOSITORY_URL, '_blank')
    }
  }

  const handleCheckUpdate = useCallback(async () => {
    setCheckState('checking')
    setErrorMessage('')
    try {
      const result: UpdateCheckResult = await window.hcomic.checkForUpdates()
      if (result.hasUpdate) {
        setUpdateInfo({
          latestVersion: result.latestVersion,
          changelog: result.changelog,
          releaseUrl: result.releaseUrl,
        })
        setCheckState('idle')
      } else if (result.error) {
        setCheckState('error')
        setErrorMessage(result.error)
      } else {
        setCheckState('up-to-date')
      }
    } catch {
      setCheckState('error')
      setErrorMessage('检查更新失败')
    }
  }, [])

  const statusText = checkState === 'checking'
    ? '检查中...'
    : checkState === 'up-to-date'
      ? '已是最新版本'
      : checkState === 'error'
        ? errorMessage || '检查失败'
        : ''

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-6">关于</h2>

      <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border)] p-8 space-y-6">
        {/* 应用图标 */}
        <div className="flex justify-center">
          <LogoIcon size={80} className="drop-shadow-lg" />
        </div>

        {/* 应用名称 */}
        <div className="text-center">
          <h3 className="text-2xl font-bold text-[var(--text-primary)]">
            {__APP_NAME__}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            {__APP_DESCRIPTION__}
          </p>
        </div>

        {/* 信息列表 */}
        <div className="border-t border-[var(--border)] pt-6 space-y-4">
          <div className="flex items-center justify-between py-2 px-4 rounded-lg bg-[var(--bg-secondary)]">
            <span className="text-sm text-[var(--text-secondary)]">版本号</span>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                v{__APP_VERSION__}
              </span>
              <button
                onClick={handleCheckUpdate}
                disabled={checkState === 'checking'}
                className="px-3 py-1 text-xs rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
              >
                {checkState === 'checking' ? '检查中...' : '检查更新'}
              </button>
            </div>
          </div>

          {statusText && checkState !== 'idle' && checkState !== 'checking' && (
            <div className={`text-xs px-4 ${
              checkState === 'up-to-date' ? 'text-green-600' : 'text-red-500'
            }`}>
              {statusText}
            </div>
          )}

          <div className="flex items-center justify-between gap-4 py-2 px-4 rounded-lg bg-[var(--bg-secondary)]">
            <span className="text-sm text-[var(--text-secondary)]">仓库地址</span>
            <a
              href={REPOSITORY_URL}
              onClick={openRepository}
              className="text-sm font-medium text-[var(--accent)] hover:underline truncate"
            >
              {REPOSITORY_URL}
            </a>
          </div>
        </div>
      </div>

      {updateInfo && (
        <UpdateDialog
          info={updateInfo}
          onClose={() => setUpdateInfo(null)}
        />
      )}
    </div>
  )
}
