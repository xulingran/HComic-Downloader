interface LoginExpiredDialogProps {
  open: boolean
  onClose: () => void
  onGoToSettings: () => void
  onOpenWebsite: () => void
}

export function LoginExpiredDialog({ open, onClose, onGoToSettings, onOpenWebsite }: LoginExpiredDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">登录已过期</h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          您的登录信息已过期，请重新登录后继续使用收藏夹功能。
        </p>
        <div className="space-y-2 mb-4 text-sm text-[var(--text-secondary)]">
          <p>1. 打开 h-comic.com 并登录</p>
          <p>2. 按 F12 打开开发者工具</p>
          <p>3. Network 面板 → 右键任意请求 → Copy as cURL</p>
          <p>4. 回到设置页面粘贴 curl 命令并应用</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] text-sm"
          >
            关闭
          </button>
          <button
            onClick={onOpenWebsite}
            className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] text-sm"
          >
            打开网站
          </button>
          <button
            onClick={onGoToSettings}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm"
          >
            前往设置
          </button>
        </div>
      </div>
    </div>
  )
}