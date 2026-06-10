import type { MouseEvent } from 'react'

import { LogoIcon } from '../components/LogoIcon'

declare const __APP_NAME__: string
declare const __APP_DESCRIPTION__: string
declare const __APP_VERSION__: string

const REPOSITORY_URL = 'https://github.com/xulingran/HComic-Downloader'

export function AboutPage() {
  const openRepository = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!window.hcomic) return

    event.preventDefault()
    window.hcomic.openUrl(REPOSITORY_URL)
  }

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
            <span className="text-sm font-medium text-[var(--text-primary)]">
              v{__APP_VERSION__}
            </span>
          </div>

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
    </div>
  )
}
