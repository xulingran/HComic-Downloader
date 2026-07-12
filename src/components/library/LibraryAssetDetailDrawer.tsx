import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LibraryAssetDetail } from '@shared/types'
import type { LocalReaderLaunchMode } from '../../stores/useLocalReaderStore'
import { useToastStore } from '../../stores/useToastStore'
import {
  drawerPresenceVariants,
  overlayPresenceVariants,
  reduceSafe,
  useReducedMotionPreference,
} from '../../lib/anim'

interface LibraryAssetDetailDrawerProps {
  asset: LibraryAssetDetail | null
  open: boolean
  onClose: () => void
  onOpenReader: (assetId: string, launchMode: LocalReaderLaunchMode) => void
  onChanged: () => void
}

/** 资产详情抽屉——展示元数据并提供阅读、定位、健康检查、删除等操作。 */
export function LibraryAssetDetailDrawer({
  asset,
  open,
  onClose,
  onOpenReader,
  onChanged,
}: LibraryAssetDetailDrawerProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [healthChecking, setHealthChecking] = useState(false)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const [metadataTitle, setMetadataTitle] = useState('')
  const [metadataAuthor, setMetadataAuthor] = useState('')
  const [metadataTags, setMetadataTags] = useState('')
  const [metadataSaving, setMetadataSaving] = useState(false)

  const handleReveal = useCallback(async () => {
    if (!asset) return
    try {
      await window.hcomic!.libraryRevealAsset(asset.assetId, asset.version)
    } catch {
      useToastStore.getState().error('定位失败')
    }
  }, [asset])

  const handleHealthCheck = useCallback(async () => {
    if (!asset) return
    setHealthChecking(true)
    try {
      const result = await window.hcomic!.libraryHealthCheck(asset.assetId, asset.version)
      if (result.healthy) {
        useToastStore.getState().success('健康检查通过')
      } else {
        useToastStore.getState().info(`发现 ${result.issues.length} 个问题`)
      }
      onChanged()
    } catch {
      useToastStore.getState().error('健康检查失败')
    } finally {
      setHealthChecking(false)
    }
  }, [asset, onChanged])

  const handleDelete = useCallback(async () => {
    if (!asset) return
    try {
      const prep = await window.hcomic!.libraryPrepareDelete(asset.assetId, asset.version)
      // 已显示确认框，直接执行
      const result = await window.hcomic!.libraryCommitDelete(prep.token)
      if (result.success) {
        useToastStore.getState().success(`已移入回收站，释放 ${formatBytes(result.freedBytes)}`)
        setConfirmDelete(false)
        onClose()
        onChanged()
      } else {
        useToastStore.getState().error(result.message || '删除失败')
      }
    } catch (e) {
      useToastStore.getState().error(e instanceof Error ? e.message : '删除失败')
    }
  }, [asset, onClose, onChanged])

  const handleRename = useCallback(async () => {
    if (!asset || !newName.trim()) return
    try {
      const result = await window.hcomic!.libraryRename(asset.assetId, newName.trim(), true, asset.version)
      if (result.success) {
        useToastStore.getState().success('重命名成功')
        setRenaming(false)
        setNewName('')
        onChanged()
        onClose()
      } else {
        useToastStore.getState().error(result.message || '重命名失败')
      }
    } catch (e) {
      useToastStore.getState().error(e instanceof Error ? e.message : '重命名失败')
    }
  }, [asset, newName, onChanged, onClose])

  const handleEditMetadata = useCallback(async () => {
    if (!asset) return
    setMetadataSaving(true)
    try {
      const tags = metadataTags.split(',').map((tag) => tag.trim()).filter(Boolean)
      const result = await window.hcomic!.libraryEditMetadata(
        asset.assetId,
        { title: metadataTitle.trim(), author: metadataAuthor.trim(), tags },
        asset.version,
      )
      useToastStore.getState().success(
        result.writtenToFile ? '元数据已写入 ComicInfo.xml' : '元数据已保存为应用内覆盖',
      )
      setEditingMetadata(false)
      onChanged()
      onClose()
    } catch (error) {
      useToastStore.getState().error(error instanceof Error ? error.message : '元数据保存失败')
    } finally {
      setMetadataSaving(false)
    }
  }, [asset, metadataAuthor, metadataTags, metadataTitle, onChanged, onClose])

  // 与 ComicInfoDrawer 一致的动画令牌：reduced-motion 时降级为纯 opacity
  const reduceMotion = useReducedMotionPreference()
  const drawerVariants = reduceMotion ? reduceSafe(drawerPresenceVariants) : drawerPresenceVariants
  const hasSavedProgress = asset?.readingPage != null
  const savedChapterValid = Boolean(asset && (
    asset.chapters.length <= 1
      ? hasSavedProgress
      : hasSavedProgress && asset.readingChapterId
        && asset.chapters.some((chapter) => chapter.chapterId === asset.readingChapterId)
  ))
  const savedChapterName = asset?.chapters.find(
    (chapter) => chapter.chapterId === asset.readingChapterId,
  )?.name

  return (
    <AnimatePresence>
      {open && asset && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            key="library-drawer-overlay"
            variants={overlayPresenceVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-40 bg-black/40"
            onClick={onClose}
            data-testid="detail-drawer-overlay"
          />

          {/* 抽屉面板 */}
          <motion.div
            key="library-drawer-panel"
            variants={drawerVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-primary)] p-6 shadow-xl"
            data-testid="library-detail-drawer"
          >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
        >
          ✕
        </button>

        {/* 标题 */}
        <h2 className="mb-1 pr-8 text-lg font-semibold text-[var(--text-primary)]">{asset.title}</h2>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">{asset.author}</p>

        {/* 封面 */}
        {asset.coverKey && (
          <div className="mb-4 aspect-[3/4] max-w-[200px] overflow-hidden rounded-lg bg-[var(--bg-secondary)]">
            <img src={`app-image://library/${asset.coverKey}`} alt={asset.title} className="h-full w-full object-cover" />
          </div>
        )}

        {/* 元数据 */}
        <dl className="mb-4 space-y-2 text-sm">
          {asset.tags.length > 0 && (
            <div>
              <dt className="text-xs text-[var(--text-secondary)]">标签</dt>
              <dd className="flex flex-wrap gap-1">
                {asset.tags.map((tag) => (
                  <span key={tag} className="rounded bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-primary)]">
                    {tag}
                  </span>
                ))}
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-[var(--text-secondary)]">来源</dt>
            <dd>{asset.sourceSite || '本地'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--text-secondary)]">格式</dt>
            <dd>{asset.format.toUpperCase()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--text-secondary)]">页数</dt>
            <dd>{asset.pageCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--text-secondary)]">大小</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--text-secondary)]">文件</dt>
            <dd className="truncate text-xs" title={asset.pathSummary}>
              {asset.pathSummary}
            </dd>
          </div>
          {asset.chapters.length > 1 && (
            <div>
              <dt className="text-xs text-[var(--text-secondary)]">章节 ({asset.chapters.length})</dt>
              <dd className="text-xs">{asset.chapters.map((ch) => ch.name).join(' · ')}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-[var(--text-secondary)]">健康</dt>
            <dd>{HEALTH_LABELS[asset.healthStatus] ?? asset.healthStatus}</dd>
          </div>
          {asset.metadataOverridden && (
            <div className="text-xs text-[var(--text-secondary)]">⚠ 部分元数据为应用内覆盖</div>
          )}
        </dl>

        {/* 操作按钮 */}
        <div className="space-y-2">
          {savedChapterValid ? (
            <div className="space-y-2" data-testid="detail-reading-actions">
              <p className="text-xs text-[var(--text-secondary)]" data-testid="detail-reading-progress">
                上次读到{savedChapterName ? `${savedChapterName} · ` : ''}第 {asset.readingPage} 页
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => onOpenReader(asset.assetId, 'restart')}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  data-testid="detail-restart-btn"
                >
                  从头开始
                </button>
                <button
                  onClick={() => onOpenReader(asset.assetId, 'resume')}
                  className="min-w-0 flex-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  data-testid="detail-read-btn"
                >
                  继续阅读
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {hasSavedProgress && (
                <p className="text-xs text-[var(--text-secondary)]" data-testid="detail-invalid-progress">
                  原阅读章节已失效，请从头开始
                </p>
              )}
              <button
                onClick={() => onOpenReader(asset.assetId, 'restart')}
                className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                data-testid="detail-read-btn"
              >
                {hasSavedProgress ? '从头开始' : '开始阅读'}
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleReveal}
              className="flex-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              📂 定位
            </button>
            <button
              onClick={handleHealthCheck}
              disabled={healthChecking}
              className="flex-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
            >
              {healthChecking ? '检查中…' : '🏥 体检'}
            </button>
            <button
              onClick={() => {
                setNewName(asset.title)
                setRenaming(true)
              }}
              className="flex-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              ✏ 重命名
            </button>
          </div>

          <button
            onClick={() => {
              setMetadataTitle(asset.title)
              setMetadataAuthor(asset.author)
              setMetadataTags(asset.tags.join(', '))
              setEditingMetadata(true)
            }}
            className="w-full rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            data-testid="detail-edit-metadata-btn"
          >
            📝 编辑元数据
          </button>

          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full rounded-lg bg-[var(--bg-secondary)] border border-[var(--error)]/30 px-4 py-2 text-sm text-[var(--error)] hover:bg-[var(--error)]/5"
          >
            🗑 移入回收站
          </button>
        </div>

        {/* 重命名表单 */}
        {renaming && (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="mb-2 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]"
              placeholder="新名称"
            />
            <div className="flex gap-2">
              <button
                onClick={handleRename}
                className="flex-1 rounded bg-[var(--accent)] px-3 py-1 text-sm text-white"
              >
                确认
              </button>
              <button
                onClick={() => setRenaming(false)}
                className="flex-1 rounded bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-1 text-sm"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {editingMetadata && (
          <div className="mt-4 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-sm">
            <label className="block text-xs text-[var(--text-secondary)]">标题
              <input value={metadataTitle} onChange={(event) => setMetadataTitle(event.target.value)} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]" />
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">作者
              <input value={metadataAuthor} onChange={(event) => setMetadataAuthor(event.target.value)} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]" />
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">标签（逗号分隔）
              <textarea value={metadataTags} onChange={(event) => setMetadataTags(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]" />
            </label>
            <p className="text-[10px] text-[var(--text-secondary)]">
              {asset.format === 'cbz' ? '将安全重写 ComicInfo.xml。' : 'ZIP/文件夹仅保存为应用内覆盖，不修改原文件。'}
            </p>
            <div className="flex gap-2">
              <button disabled={metadataSaving} onClick={handleEditMetadata} className="flex-1 rounded bg-[var(--accent)] px-3 py-1 text-white disabled:opacity-40">
                {metadataSaving ? '保存中…' : '保存'}
              </button>
              <button disabled={metadataSaving} onClick={() => setEditingMetadata(false)} className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1 disabled:opacity-40">取消</button>
            </div>
          </div>
        )}

        {/* 删除确认 */}
        {confirmDelete && (
          <div className="mt-4 rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/5 p-3 text-sm">
            <p className="mb-2 text-[var(--text-primary)]">确认移入回收站？</p>
            <p className="mb-3 text-xs text-[var(--text-secondary)]">
              {asset.title} · {asset.format.toUpperCase()} · {formatBytes(asset.sizeBytes)}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                className="flex-1 rounded bg-[var(--error)] px-3 py-1 text-sm text-white"
              >
                确认删除
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-1 text-sm"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

const HEALTH_LABELS: Record<string, string> = {
  unknown: '未知',
  healthy: '健康',
  warning: '有警告',
  error: '有问题',
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Math.round((bytes / Math.pow(k, i)) * 10) / 10} ${sizes[i]}`
}
