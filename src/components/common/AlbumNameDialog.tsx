import { useState, useEffect, useRef } from 'react'
import { Modal } from './Modal'

interface AlbumNameDialogProps {
  isOpen: boolean
  defaultName: string
  comicCount: number
  onConfirm: (albumName: string) => void
  onCancel: () => void
}

export function AlbumNameDialog({ isOpen, defaultName, comicCount, onConfirm, onCancel }: AlbumNameDialogProps) {
  // defaultName 仅作初值。Modal 关闭即卸载本组件，下次打开重新挂载，
  // useState 自然拿到最新 defaultName，不再需要 wasOpen 渲染期同步逻辑。
  const [name, setName] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      // 自动聚焦并选中默认文本，方便用户直接修改
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) {
      onConfirm(trimmed)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      contentClassName="w-full max-w-md rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] p-6 shadow-xl"
    >
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
        下载为专辑
      </h3>
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        将选中的 {comicCount} 本漫画打包为一个专辑下载
      </p>
      <form onSubmit={handleSubmit}>
        <label className="block text-sm text-[var(--text-primary)] mb-2">
          专辑名称
        </label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="输入专辑名称"
          maxLength={256}
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="px-4 py-2 text-sm rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            确认下载
          </button>
        </div>
      </form>
    </Modal>
  )
}
