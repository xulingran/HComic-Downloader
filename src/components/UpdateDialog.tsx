import type { UpdateInfo } from '@shared/types'
import { Modal } from './common/Modal'

interface UpdateDialogProps {
  info: UpdateInfo
  onClose: () => void
}

function renderChangelogMarkdown(md: string): string {
  if (!md) return ''
  const lines = md.split('\n')
  const parts: string[] = []
  let inList = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ')) {
      if (inList) { parts.push('</ul>'); inList = false }
      parts.push(`<h3>${inline(trimmed.slice(3))}</h3>`)
    } else if (trimmed.startsWith('### ')) {
      if (inList) { parts.push('</ul>'); inList = false }
      parts.push(`<h4>${inline(trimmed.slice(4))}</h4>`)
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { parts.push('<ul>'); inList = true }
      parts.push(`<li>${inline(trimmed.slice(2))}</li>`)
    } else if (trimmed === '') {
      if (inList) { parts.push('</ul>'); inList = false }
    } else {
      if (inList) { parts.push('</ul>'); inList = false }
      parts.push(`<p>${inline(trimmed)}</p>`)
    }
  }
  if (inList) parts.push('</ul>')
  return parts.join('')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text: string): string {
  const escaped = escapeHtml(text)
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">$1</a>')
}

export function UpdateDialog({ info, onClose }: UpdateDialogProps) {
  const handleDownload = () => {
    window.hcomic?.openUrl(info.releaseUrl)
    onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      contentClassName="bg-[var(--bg-primary)] rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
    >
      {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-lg font-medium text-[var(--text-primary)]">
            发现新版本 v{info.latestVersion}
          </h3>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {info.changelog ? (
            <div
              className="text-sm text-[var(--text-secondary)] [&_a]:text-[var(--accent)] [&_a:hover]:underline [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-[var(--text-primary)] [&_h4]:text-sm [&_h4]:font-medium [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-[var(--text-primary)] [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_li]:text-sm [&_p]:text-sm [&_p]:my-1"
              dangerouslySetInnerHTML={{ __html: renderChangelogMarkdown(info.changelog) }}
            />
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">暂无更新日志</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          >
            稍后提醒
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white"
          >
            去下载
          </button>
        </div>
    </Modal>
  )
}
