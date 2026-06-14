import { useState } from 'react'
import { useFatalErrorStore } from '../stores/useFatalErrorStore'
import { copyDiagnosticsWithConfirm } from '../utils/diagnostics'

/**
 * 致命错误横幅（方案 B2）。
 *
 * 行为：
 * - 常驻顶部：不自动消失，直到用户点 [×] 关闭
 * - 不阻塞操作：横幅位于内容区顶部，页面仍可滚动、切菜单
 * - 单例：useFatalErrorStore.error 非 null 时显示，新错误覆盖旧的
 */
export function FatalBanner() {
  const error = useFatalErrorStore((s) => s.error)
  const clear = useFatalErrorStore((s) => s.clear)
  const [copying, setCopying] = useState(false)

  if (!error) return null

  const handleCopy = async () => {
    setCopying(true)
    try {
      await copyDiagnosticsWithConfirm()
    } finally {
      setCopying(false)
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 border-b border-red-500/40
                 bg-red-950/40 text-sm text-red-100"
      role="alert"
    >
      <span className="text-lg flex-shrink-0">⚠</span>
      <span className="flex-1 font-medium">{error.message}</span>
      <button
        onClick={handleCopy}
        disabled={copying}
        className="px-3 py-1 rounded-lg text-xs font-medium
                   bg-red-600/80 text-white hover:bg-red-600
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors whitespace-nowrap"
      >
        {copying ? '复制中…' : '复制诊断日志'}
      </button>
      <button
        onClick={clear}
        className="text-red-200/80 hover:text-red-100 transition-colors flex-shrink-0"
        aria-label="关闭"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
