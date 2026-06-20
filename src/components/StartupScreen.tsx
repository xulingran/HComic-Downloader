import { motion } from 'framer-motion'
import { useState } from 'react'
import type { StartupProgressState } from '../hooks/useStartupProgress'

/**
 * 启动进度界面（React 版）。
 *
 * 视觉必须与 index.html 内联骨架屏像素级一致：
 * - 同 logo（assets/icon.svg）
 * - 同 spinner（index.html 的 skeleton-spin 0.8s linear → Tailwind animate-spin）
 * - 同文案（"HComic Downloader 启动中…"）
 * - 同进度条结构（track + fill + percent + label）
 * - 同配色（亮/暗模式，与 index.html 的 hex 值一致）
 *
 * React 挂载时 createRoot().render() 替换 index.html 骨架屏 DOM，
 * 本组件接管渲染，用户感知不到切换。done=true 时由父级 AnimatePresence 淡出。
 *
 * 配色关键决策：不用 Tailwind dark: 前缀（依赖 data-theme 属性），
 * 因为 data-theme 由 useTheme 在 useEffect 里设置，晚于 React 首次渲染。
 * 若用 dark:，深色系统下 StartupScreen 首帧会显示亮色，与 index.html 骨架屏
 * （跟随 prefers-color-scheme）不一致，造成颜色闪烁。
 * 改用 matchMedia 同步判断系统主题（与 index.html @media 行为一致），
 * 用内联 style 应用对应 hex，保证首帧颜色正确。
 */
function useSystemDarkMode(): boolean {
  // useState 初始化时同步读取，确保首次渲染就是正确颜色
  return useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)[0]
}

export function StartupScreen({ percent, label }: StartupProgressState) {
  const dark = useSystemDarkMode()
  // 配色与 index.html 骨架屏的 hex 值完全一致
  const colors = {
    bg: dark ? '#1a1a2e' : '#f5f5f5',
    text: dark ? '#e0e0e0' : '#333',
    spinnerBorder: dark ? '#3a3a5c' : '#d0d0d0',
    spinnerTop: dark ? '#7c5cbf' : '#4a90d9',
    mainText: dark ? '#b0b0b0' : '#555',
    track: dark ? '#3a3a5c' : '#d0d0d0',
    fill: dark ? '#7c5cbf' : '#4a90d9',
    label: dark ? '#909090' : '#777',
    percent: dark ? '#b0b0b0' : '#555',
  }

  return (
    <motion.div
      className="flex flex-col items-center justify-center fixed inset-0 z-50"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      style={{
        background: colors.bg,
        color: colors.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        className="w-6 h-6 rounded-full mb-4 animate-spin"
        style={{
          border: `3px solid ${colors.spinnerBorder}`,
          borderTopColor: colors.spinnerTop,
        }}
      />
      <img
        src="assets/icon.svg"
        alt="HComic Downloader"
        className="w-14 h-14 rounded-[14px] mb-5 animate-pulse"
      />
      <div
        className="text-sm whitespace-nowrap animate-pulse"
        style={{ color: colors.mainText }}
      >
        HComic Downloader 启动中…
      </div>
      <div className="w-[220px] mt-[18px]">
        <div
          className="w-full h-1 rounded-sm overflow-hidden"
          style={{ background: colors.track }}
        >
          <div
            className="h-full rounded-sm"
            style={{
              width: `${percent}%`,
              background: colors.fill,
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        <div className="flex justify-between items-center mt-2 text-xs whitespace-nowrap">
          <span className="overflow-hidden text-ellipsis max-w-[140px]" style={{ color: colors.label }}>
            {label}
          </span>
          <span className="tabular-nums" style={{ color: colors.percent }}>
            {percent}%
          </span>
        </div>
      </div>
    </motion.div>
  )
}
