import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  readerModeIndicatorTransition,
  readerPresenceVariants,
  overlayPresenceVariants,
  reduceSafe,
  useReducedMotionPreference,
} from '../../lib/anim'
import type { DisplayMode, BlankPosition } from '../../hooks/useReaderSettings'
import type { ChapterInfo } from '@shared/types'

/**
 * 漫画阅读器共享视觉外壳。
 *
 * 抽自 ``ComicReaderModal``，统一在线预览阅读器与本地漫画库阅读器的 UI：
 * - 遮罩 + 从下滑入动画（reduceSafe 兼容 reduced-motion）
 * - 模糊背景 header（关闭 / 标题 / 页码）
 * - 模糊背景 footer（章节导航 / 页码 / 拖拽滑块 / 快捷键提示 / 设置齿轮）
 * - 浮动设置面板（图标式显示模式切换 / 补白 / 页距 / 宽度 / 缩放 / 可选插槽）
 *
 * 数据层（预加载、历史、图片源）由各 modal 自行管理，本组件只消费已计算好的
 * 状态与回调；对"在线 vs 本地"差异用可选 props 表达（``preloadedRanges``、
 * ``bikaImageQualitySlot``、章节导航）。
 *
 * 键盘快捷键留在各 modal（含边界翻章等交互细节），避免双重监听器。
 */

export interface PreloadedRange {
  start: number
  end: number
}

interface ReaderShellProps {
  /** 外壳显隐；false 时渲染 null（与 modal open 语义一致） */
  open: boolean
  onClose: () => void
  title: string
  /** 当前页（1-based） */
  currentPage: number
  /** 含补白页的有效总页数（用于滑块 aria-valuemax） */
  effectiveTotal: number
  /** 章节列表；传入则渲染上/下一章按钮 */
  chapters?: ChapterInfo[]
  /** 当前章节索引；-1 表示未选章（不渲染导航或全部禁用） */
  currentChapterIndex?: number
  onGoToChapter?: (index: number) => void
  /** 打开章节列表；多章节阅读器可提供直接跳章入口 */
  onOpenChapterPicker?: () => void
  /** 仅在内容已加载且页码范围有效时显示页码导航 */
  navigationEnabled: boolean
  /** 阅读设置状态与 setter（来自共享 useReaderSettings） */
  displayMode: DisplayMode
  onDisplayModeRequest: (mode: DisplayMode) => void
  imageWidth: number
  setImageWidth: (value: number) => void
  pageGap: number
  setPageGap: (value: number) => void
  blankPosition: BlankPosition
  setBlankPosition: (pos: BlankPosition) => void
  /** 缩放（来自共享 useZoom） */
  zoom: number
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  /** 设置面板开关（受控） */
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  /** 滑块拖拽（来自共享 useSliderDrag） */
  sliderRef: React.RefObject<HTMLDivElement>
  isDragging: boolean
  handleSliderPointerDown: (e: React.PointerEvent) => void
  handleSliderPointerMove: (e: React.PointerEvent) => void
  handleSliderPointerUp: (e: React.PointerEvent) => void
  cancelDrag: (e: React.PointerEvent) => void
  /** 预加载范围段；在线版传真实范围，本地版传空数组（滑块不渲染蓝段） */
  preloadedRanges?: PreloadedRange[]
  /** 内容区（loading/error/empty/ChapterPicker/scroll/PageFlipView 由各 modal 注入） */
  children: React.ReactNode
  /** 在线 bika 清晰度控件插槽；本地不传则隐藏 */
  bikaImageQualitySlot?: React.ReactNode
}

export function ReaderShell({
  open,
  onClose,
  title,
  currentPage,
  effectiveTotal,
  chapters,
  currentChapterIndex = -1,
  onGoToChapter,
  onOpenChapterPicker,
  navigationEnabled,
  displayMode,
  onDisplayModeRequest,
  imageWidth,
  setImageWidth,
  pageGap,
  setPageGap,
  blankPosition,
  setBlankPosition,
  zoom,
  zoomIn,
  zoomOut,
  resetZoom,
  settingsOpen,
  setSettingsOpen,
  sliderRef,
  isDragging,
  handleSliderPointerDown,
  handleSliderPointerMove,
  handleSliderPointerUp,
  cancelDrag,
  preloadedRanges = [],
  children,
  bikaImageQualitySlot,
}: ReaderShellProps) {
  const reduceMotion = useReducedMotionPreference()
  const readerVariants = reduceMotion ? reduceSafe(readerPresenceVariants) : readerPresenceVariants
  const settingsPanelRef = useRef<HTMLDivElement>(null)

  // 点击设置面板外部时关闭（齿轮按钮自身由其 onClick 切换，此处只处理空白区域）
  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: MouseEvent) => {
      if (settingsPanelRef.current?.contains(e.target as Node)) return
      const btn = (e.target as Element).closest('[aria-label="阅读设置"]')
      if (btn) return
      setSettingsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen, setSettingsOpen])

  if (!open) return null

  const progress = effectiveTotal > 0 ? Math.round((currentPage / effectiveTotal) * 100) : 0
  const hasChapters = Boolean(chapters && chapters.length > 1)
  const hasPrevChapter = hasChapters && currentChapterIndex > 0
  const hasNextChapter = hasChapters && currentChapterIndex >= 0 && currentChapterIndex < (chapters!.length - 1)

  return (
    <div className="fixed inset-0 z-50">
      <div>
        <motion.div
          key="reader-overlay"
          variants={overlayPresenceVariants}
          initial="initial"
          animate="animate"
          className="absolute inset-0 bg-black/50"
          onClick={onClose}
        />
        <motion.div
          key="reader-content"
          variants={readerVariants}
          initial="initial"
          animate="animate"
          className="absolute inset-0 flex flex-col bg-[#1a1a2e]"
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3 shrink-0"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-white text-sm hover:bg-white/10 transition-colors shrink-0"
                style={{ background: 'rgba(255,255,255,0.1)' }}
              >
                关闭
              </button>
              <span className="text-sm text-gray-400 truncate">{title}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hasChapters && onOpenChapterPicker && (
                <button
                  aria-label="章节列表"
                  onClick={onOpenChapterPicker}
                  className="px-2.5 py-1 rounded-full text-xs text-white hover:bg-white/20 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.1)' }}
                >
                  章节
                </button>
              )}
              {navigationEnabled && (
                <span
                  className="px-2.5 py-1 rounded-full text-xs text-white"
                  style={{ background: 'rgba(255,255,255,0.15)' }}
                >
                  {currentPage} / {effectiveTotal}
                </span>
              )}
            </div>
          </div>

          {/* Content */}
          {children}

          {/* Footer */}
          {navigationEnabled && (
            <div
              className="px-5 py-2 shrink-0 relative"
              style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
            >
            <div className="flex items-center gap-3">
              {hasChapters && (
                <button
                  aria-label="上一章"
                  disabled={!hasPrevChapter}
                  onClick={() => onGoToChapter?.(currentChapterIndex - 1)}
                  className="px-2 py-1 rounded text-xs text-white transition-colors hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  style={{ background: 'rgba(255,255,255,0.08)' }}
                >
                  ‹ 上一章
                </button>
              )}
              <span className="text-xs text-gray-500">{currentPage} / {effectiveTotal}</span>
              <div
                ref={sliderRef}
                data-track
                role="slider"
                aria-valuemin={1}
                aria-valuemax={effectiveTotal}
                aria-valuenow={currentPage}
                aria-label="页面进度"
                className="flex-1 h-6 flex items-center cursor-pointer"
                style={{ padding: '8px 0' }}
                onPointerDown={handleSliderPointerDown}
                onPointerMove={handleSliderPointerMove}
                onPointerUp={handleSliderPointerUp}
                onPointerCancel={cancelDrag}
                onLostPointerCapture={cancelDrag}
              >
                <div className="w-full relative" style={{ height: '4px' }}>
                  <div className="absolute inset-0 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.1)' }} />
                  {preloadedRanges.map((range, i) => {
                    const total = effectiveTotal
                    const left = ((range.start - 1) / total) * 100
                    const width = ((range.end - range.start + 1) / total) * 100
                    return (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 rounded-full pointer-events-none"
                        style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%`, background: 'rgba(108,140,255,0.25)' }}
                      />
                    )
                  })}
                  <div
                    className="absolute left-0 top-0 bottom-0 rounded-full"
                    style={{ width: `${progress}%`, background: '#6c8cff' }}
                  />
                  <div
                    className="absolute top-1/2 rounded-full"
                    style={{
                      left: `${progress}%`,
                      transform: 'translate(-50%, -50%)',
                      width: isDragging ? 18 : 14,
                      height: isDragging ? 18 : 14,
                      background: '#6c8cff',
                      boxShadow: '0 0 6px rgba(108,140,255,0.5)',
                      transition: isDragging ? 'none' : 'left 0.2s, width 0.15s, height 0.15s',
                      ...(isDragging ? { touchAction: 'none' } : {}),
                    }}
                  />
                </div>
              </div>
              {hasChapters && (
                <button
                  aria-label="下一章"
                  disabled={!hasNextChapter}
                  onClick={() => onGoToChapter?.(currentChapterIndex + 1)}
                  className="px-2 py-1 rounded text-xs text-white transition-colors hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  style={{ background: 'rgba(255,255,255,0.08)' }}
                >
                  下一章 ›
                </button>
              )}
              <span className="text-xs text-gray-500">
                {displayMode === 'scroll' ? 'ESC 关闭 | ↑↓ 滚动' : 'ESC 关闭 | ←→ 翻页'}
              </span>
              <button
                aria-label="阅读设置"
                onClick={() => setSettingsOpen(!settingsOpen)}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                style={{ color: settingsOpen ? '#6c8cff' : 'rgba(255,255,255,0.5)' }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="2.5" />
                  <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
                </svg>
              </button>
            </div>

            {settingsOpen && (
              <div
                ref={settingsPanelRef}
                className="absolute bottom-full right-4 mb-2 rounded-lg"
                style={{
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(8px)',
                  padding: '12px 16px',
                  width: '220px',
                }}
              >
                <div className="flex flex-col gap-3">
                  {/* 显示模式切换 */}
                  <div className="flex rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <ModeButton label="连续滚动" icon={scrollIcon} active={displayMode === 'scroll'} indicatorId="reader-display-mode-indicator" reduceMotion={reduceMotion} onClick={() => onDisplayModeRequest('scroll')} />
                    <ModeButton label="单页显示" icon={singleIcon} active={displayMode === 'single'} indicatorId="reader-display-mode-indicator" reduceMotion={reduceMotion} onClick={() => onDisplayModeRequest('single')} />
                    <ModeButton label="双页显示" icon={doubleIcon} active={displayMode === 'double'} indicatorId="reader-display-mode-indicator" reduceMotion={reduceMotion} onClick={() => onDisplayModeRequest('double')} />
                  </div>
                  {displayMode === 'double' && (
                    <div className="flex rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <ModeButton label="无补白" icon={blankNoneIcon} active={blankPosition === 'none'} onClick={() => setBlankPosition('none')} />
                      <ModeButton label="前补白" icon={blankFrontIcon} active={blankPosition === 'front'} onClick={() => setBlankPosition('front')} />
                      <ModeButton label="后补白" icon={blankEndIcon} active={blankPosition === 'end'} onClick={() => setBlankPosition('end')} />
                    </div>
                  )}
                  {displayMode === 'scroll' && (
                    <>
                      <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
                        <span>页面间距</span>
                        <span className="text-gray-500" style={{ minWidth: '32px', textAlign: 'right' }}>{pageGap}px</span>
                      </label>
                      <input
                        aria-label="页面间距"
                        type="range"
                        min={0}
                        max={80}
                        step={2}
                        value={pageGap}
                        onChange={(e) => setPageGap(Number(e.target.value))}
                        className="w-full accent-[#6c8cff]"
                      />
                    </>
                  )}
                  <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
                    <span>图片宽度</span>
                    <span className="text-gray-500" style={{ minWidth: '32px', textAlign: 'right' }}>{imageWidth}%</span>
                  </label>
                  <input
                    aria-label="图片宽度"
                    type="range"
                    min={30}
                    max={100}
                    step={1}
                    value={imageWidth}
                    onChange={(e) => setImageWidth(Number(e.target.value))}
                    className="w-full accent-[#6c8cff]"
                  />
                  {/* 缩放 */}
                  <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
                    <span>缩放</span>
                    <span className="text-gray-500" style={{ minWidth: '40px', textAlign: 'right' }}>{Math.round(zoom * 100)}%</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={zoomOut}
                      className="px-2 py-0.5 text-xs rounded bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white"
                    >
                      −
                    </button>
                    <button
                      onClick={zoomIn}
                      className="px-2 py-0.5 text-xs rounded bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white"
                    >
                      +
                    </button>
                    <button
                      onClick={resetZoom}
                      className="px-2 py-0.5 text-xs rounded bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white ml-auto"
                    >
                      重置
                    </button>
                  </div>
                  {bikaImageQualitySlot}
                </div>
              </div>
            )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}

// ── 设置面板图标按钮与 SVG ──────────────────────────────────────────

function ModeButton({ label, icon, active, onClick, indicatorId, reduceMotion = false }: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  indicatorId?: string
  reduceMotion?: boolean
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className="relative flex-1 flex items-center justify-center py-1.5 transition-colors"
      style={{
        background: active && !indicatorId ? 'rgba(108,140,255,0.2)' : 'transparent',
        color: active ? '#6c8cff' : 'rgba(255,255,255,0.4)',
      }}
    >
      {active && indicatorId && (
        <motion.span
          data-testid="reader-mode-indicator"
          layoutId={indicatorId}
          className="absolute inset-0"
          style={{ background: 'rgba(108,140,255,0.2)' }}
          transition={reduceMotion ? { duration: 0 } : readerModeIndicatorTransition}
        />
      )}
      <span className="relative z-10 flex items-center justify-center">{icon}</span>
    </button>
  )
}

const scrollIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="1" width="8" height="14" rx="1" />
    <path d="M8 11v2.5M6 12l2 1.5L10 12" />
  </svg>
)

const singleIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="1" width="10" height="14" rx="1" />
  </svg>
)

const doubleIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" />
    <rect x="9" y="1" width="6" height="14" rx="1" />
  </svg>
)

const blankNoneIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" />
    <rect x="9" y="1" width="6" height="14" rx="1" />
  </svg>
)

const blankFrontIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" strokeDasharray="2 2" />
    <rect x="9" y="1" width="6" height="14" rx="1" />
  </svg>
)

const blankEndIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" />
    <rect x="9" y="1" width="6" height="14" rx="1" strokeDasharray="2 2" />
  </svg>
)

// ── 内容区状态组件（loading / error / empty）────────────────────────

export function ReaderLoadingState({ className }: { className: string }) {
  return (
    <div className={`flex items-center justify-center ${className} text-gray-400`}>
      <svg className="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      加载中...
    </div>
  )
}

export function ReaderErrorState({
  message,
  onClose,
  onRetry,
  className,
}: {
  message: string
  onClose: () => void
  onRetry?: () => void
  className: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center ${className} text-gray-400 gap-3`}>
      <span>无法加载漫画内容</span>
      <span className="text-xs text-gray-500">{message}</span>
      <div className="flex items-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 rounded-lg text-sm text-white"
            style={{ background: 'rgba(108,140,255,0.35)' }}
          >
            重试
          </button>
        )}
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm text-white"
          style={{ background: 'rgba(255,255,255,0.1)' }}
        >
          关闭
        </button>
      </div>
    </div>
  )
}

export function ReaderEmptyState({ onClose, className }: { onClose: () => void; className: string }) {
  return (
    <div className={`flex flex-col items-center justify-center ${className} text-gray-400 gap-3`}>
      <span>无可用图片</span>
      <button
        onClick={onClose}
        className="px-4 py-2 rounded-lg text-sm text-white"
        style={{ background: 'rgba(255,255,255,0.1)' }}
      >
        关闭
      </button>
    </div>
  )
}
