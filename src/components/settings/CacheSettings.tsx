import { useState, useEffect, useCallback } from 'react'
import type { CacheStats } from '@shared/types'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface CacheSettingsProps {
  onSizeLimitChange: (mb: number) => void
  sizeLimitMB: number
}

export function CacheSettings({ onSizeLimitChange, sizeLimitMB }: CacheSettingsProps) {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState<'preview' | 'all' | null>(null)
  const [inputValue, setInputValue] = useState(String(sizeLimitMB))
  const [showConfirm, setShowConfirm] = useState<'preview' | 'all' | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const result = await window.hcomic!.getCacheStats()
      setStats(result)
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStats()
  }, [loadStats])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValue(String(sizeLimitMB))
  }, [sizeLimitMB])

  const handleClear = async (type: 'preview' | 'all') => {
    setShowConfirm(null)
    setClearing(type)
    try {
      if (type === 'preview') {
        await window.hcomic!.clearPreviewCache()
      } else {
        await window.hcomic!.clearAllCache()
      }
      await loadStats()
    } catch {
      // silently fail
    } finally {
      setClearing(null)
    }
  }

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const mb = Number(e.target.value)
    setInputValue(String(mb))
    onSizeLimitChange(mb)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  const handleInputBlur = () => {
    const parsed = parseInt(inputValue, 10)
    if (isNaN(parsed) || parsed < 100) {
      setInputValue(String(100))
      onSizeLimitChange(100)
    } else if (parsed > 2048) {
      setInputValue(String(2048))
      onSizeLimitChange(2048)
    } else {
      onSizeLimitChange(parsed)
    }
  }

  const ConfirmDialog = showConfirm ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full mx-4">
        <p className="text-sm text-[var(--text-primary)] mb-2 font-medium">
          {showConfirm === 'preview' ? '清除预览缓存' : '清除全部缓存'}
        </p>
        <p className="text-xs text-[var(--text-secondary)] mb-6">
          {showConfirm === 'preview'
            ? '将删除所有预览页面图片缓存，封面图缓存会保留。此操作不可撤销。'
            : '将删除所有封面图和预览页面图片缓存。此操作不可撤销。'}
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowConfirm(null)}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            onClick={() => handleClear(showConfirm)}
            className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white"
          >
            确认清除
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-4">
      {ConfirmDialog}
      <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
        缓存管理
      </h3>

      {loading ? (
        <p className="text-sm text-[var(--text-secondary)]">加载中...</p>
      ) : stats ? (
        <>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">封面缓存</span>
              <span className="text-[var(--text-primary)]">
                {stats.cover.file_count} 张 · ≈ {formatSize(stats.cover.total_size_bytes)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">预览缓存</span>
              <span className="text-[var(--text-primary)]">
                {stats.preview.file_count} 张 · ≈ {formatSize(stats.preview.total_size_bytes)}
              </span>
            </div>
            <div className="border-t border-[var(--border)] pt-2 flex justify-between font-medium">
              <span className="text-[var(--text-primary)]">合计</span>
              <span className="text-[var(--text-primary)]">
                {stats.total.file_count} 张 · ≈ {formatSize(stats.total.total_size_bytes)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              缓存上限
            </label>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              覆盖封面图和预览页面的缓存总量上限
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={100}
                max={2048}
                step={50}
                value={sizeLimitMB}
                onChange={handleSliderChange}
                className="flex-1 h-1.5 rounded-full appearance-none bg-[var(--bg-secondary)] cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={inputValue}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                  className="w-16 px-2 py-1 text-sm text-center rounded border border-[var(--border)]
                    bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <span className="text-sm text-[var(--text-secondary)]">MB</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowConfirm('preview')}
              disabled={clearing !== null}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-[var(--border)]
                text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {clearing === 'preview' ? '清除中...' : '清除预览缓存'}
            </button>
            <button
              onClick={() => setShowConfirm('all')}
              disabled={clearing !== null}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-red-300
                text-red-500 hover:bg-red-50 transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {clearing === 'all' ? '清除中...' : '清除全部缓存'}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">无法获取缓存信息</p>
      )}
    </div>
  )
}
