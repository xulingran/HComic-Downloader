import { useState, useEffect, useRef } from 'react'
import { useMigration } from '../../hooks/useMigration'
import type { MigrationPlanPreview } from '@shared/types'

interface MigrationDialogProps {
  isOpen: boolean
  onClose: () => void
  currentDownloadDir: string
  onSelectDirectory: (title: string, defaultPath?: string) => Promise<{ canceled: boolean; filePaths: string[] }>
}

type MigrationMode = 'full' | 'repair'
type DialogPhase = 'select' | 'preview' | 'executing' | 'done'

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

export function MigrationDialog({ isOpen, onClose, currentDownloadDir, onSelectDirectory }: MigrationDialogProps) {
  const {
    startMigration, confirmMigration, pauseMigration,
    cancelMigration, progress, complete, errors,
    isActive, resetState, syncFromBackend,
  } = useMigration()

  const [phase, setPhase] = useState<DialogPhase>('select')
  const [mode, setMode] = useState<MigrationMode>('full')
  const [targetDir, setTargetDir] = useState('')
  const [preview, setPreview] = useState<MigrationPlanPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (phase === 'executing' && complete) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase('done')
    }
  }, [complete, phase])

  useEffect(() => {
    if (isOpen) {
      syncFromBackend()
    }
  }, [isOpen, syncFromBackend])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [errors, progress])

  if (!isOpen) return null

  const handleNext = async () => {
    setError(null)
    if (!targetDir.trim()) {
      setError('请输入目标目录')
      return
    }
    try {
      const result = await startMigration(targetDir, mode)
      setPreview(result)
      setPhase('preview')
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || '生成迁移计划失败')
    }
  }

  const handleStart = async () => {
    if (!preview) return
    setError(null)
    try {
      await confirmMigration(preview.migrationId)
      setPhase('executing')
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || '启动迁移失败')
    }
  }

  const handlePause = async () => {
    try {
      await pauseMigration()
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || '暂停失败')
    }
  }

  const handleCancel = async () => {
    try {
      await cancelMigration()
      resetState()
      setPhase('select')
      onClose()
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || '取消失败')
    }
  }

  const handleClose = () => {
    if (phase === 'executing' && isActive) {
      onClose()
      return
    }
    resetState()
    setPhase('select')
    setPreview(null)
    setError(null)
    onClose()
  }

  const percent = progress && progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-base font-medium text-[var(--text-primary)]">
            迁移漫画库
          </h3>
          <button
            onClick={handleClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xl"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {phase === 'select' && (
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('full')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm transition-colors ${
                    mode === 'full'
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                  }`}
                >
                  完整迁移
                </button>
                <button
                  onClick={() => setMode('repair')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm transition-colors ${
                    mode === 'repair'
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                  }`}
                >
                  修复数据库
                </button>
              </div>

              {mode === 'full' && (
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                    当前目录
                  </label>
                  <div className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] text-sm text-[var(--text-secondary)]">
                    {currentDownloadDir}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  {mode === 'full' ? '目标目录' : '新的下载目录'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={targetDir}
                    onChange={(e) => setTargetDir(e.target.value)}
                    placeholder="请输入绝对路径"
                    className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                               text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const result = await onSelectDirectory(
                          mode === 'full' ? '选择目标目录' : '选择新的下载目录',
                          targetDir || undefined
                        )
                        if (!result.canceled && result.filePaths.length > 0) {
                          setTargetDir(result.filePaths[0])
                        }
                      } catch {
                        setError('选择目录失败，请手动输入路径')
                      }
                    }}
                    className="px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                               text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] whitespace-nowrap"
                  >
                    浏览
                  </button>
                </div>
              </div>

              {mode === 'repair' && (
                <p className="text-xs text-[var(--text-secondary)]">
                  如果你已经手动将漫画文件搬到了新目录，使用此模式扫描并修复数据库记录。
                </p>
              )}
            </>
          )}

          {phase === 'preview' && preview && (
            <>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">迁移文件数</span>
                  <span className="text-[var(--text-primary)] font-medium">{preview.totalItems}</span>
                </div>
                {mode === 'full' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">源目录</span>
                      <span className="text-[var(--text-primary)] text-xs truncate ml-4">{preview.sourceDir}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">目标目录</span>
                      <span className="text-[var(--text-primary)] text-xs truncate ml-4">{preview.targetDir}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">移动方式</span>
                      <span className="text-[var(--text-primary)]">
                        {preview.isSameDrive ? '同盘移动（瞬间完成）' : '跨盘移动（需要复制文件）'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {preview.totalItems === 0 && (
                <div className="text-sm text-yellow-600 bg-yellow-500/10 rounded-lg px-3 py-2">
                  未找到可迁移的文件
                </div>
              )}
            </>
          )}

          {phase === 'executing' && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-primary)]">
                    {progress?.currentFile || '准备中...'}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {progress?.completed || 0} / {progress?.total || 0} ({percent}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>

              {errors.length > 0 && (
                <div
                  ref={logRef}
                  className="max-h-32 overflow-y-auto space-y-1 text-xs"
                >
                  {errors.map((err, i) => (
                    <div key={i} className="text-red-500">
                      {err.file_path ? `${basename(err.file_path)}: ` : ''}{err.message}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {phase === 'done' && complete && (
            <>
              <div className="text-center space-y-2">
                <div className="text-3xl">
                  {complete.failed > 0 ? '⚠️' : '✅'}
                </div>
                <div className="text-sm text-[var(--text-primary)]">
                  迁移完成：成功 {complete.succeeded} 个
                  {complete.failed > 0 && `，失败 ${complete.failed} 个`}
                  （耗时 {complete.elapsed}s）
                </div>
              </div>

              {complete.failed > 0 && (
                <div className="max-h-24 overflow-y-auto space-y-1 text-xs">
                  {errors.map((err, i) => (
                    <div key={i} className="text-red-500">
                      {err.file_path}: {err.message}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
          {phase === 'select' && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={handleNext}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white"
              >
                下一步
              </button>
            </>
          )}

          {phase === 'preview' && (
            <>
              <button
                onClick={() => { setPhase('select'); setPreview(null) }}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              >
                返回
              </button>
              <button
                onClick={handleStart}
                disabled={!preview || preview.totalItems === 0}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
              >
                开始迁移
              </button>
            </>
          )}

          {phase === 'executing' && (
            <>
              <button
                onClick={handlePause}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              >
                暂停
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white"
              >
                取消迁移
              </button>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
              >
                后台运行
              </button>
            </>
          )}

          {phase === 'done' && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white"
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
