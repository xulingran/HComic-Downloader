import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMaintenance, useMaintenanceProgress } from '@/hooks/useIpc'
import { useToastStore } from '@/stores/useToastStore'
import type { HealthCheckResultItem } from '@shared/types'
import { Button, ProgressBar } from './ui'

function IssueItem({ item }: { item: HealthCheckResultItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--bg-secondary)]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-red-500">⚠️</span>
          <span className="text-sm text-[var(--text-primary)] truncate">{item.title || item.outputPath}</span>
          <span className="text-xs text-[var(--text-secondary)] shrink-0">({item.checks.length} 项)</span>
        </div>
        <span className="text-xs text-[var(--text-secondary)]">{open ? '收起' : '展开'}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              <div className="text-xs text-[var(--text-secondary)] break-all">{item.outputPath}</div>
              <div className="text-xs text-[var(--text-secondary)]">
                期望页数：{item.expectedPages}，实际页数：{item.actualPages}
              </div>
              <ul className="space-y-1">
                {item.checks.map((c, idx) => (
                  <li key={idx} className="text-sm text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded px-2 py-1">
                    <span className="font-medium">{c.kind}</span>
                    {c.page !== undefined && <span className="text-xs text-[var(--text-secondary)] ml-2">第 {c.page} 页</span>}
                    <div className="text-[var(--text-secondary)]">{c.detail}</div>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function HealthCheckPanel() {
  const { runHealthCheck } = useMaintenance()
  const { progress, clear } = useMaintenanceProgress()
  const toast = useToastStore()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ scanned: number; issues: HealthCheckResultItem[] } | null>(null)

  const handleRun = useCallback(async () => {
    setLoading(true)
    setResult(null)
    clear() // 重置上次扫描的残留进度，避免进度条闪烁旧值
    try {
      const res = await runHealthCheck('all')
      setResult(res)
      if (res.issues.length === 0) {
        toast.success(`健康检查完成：${res.scanned} 项全部正常`)
      } else {
        toast.error(`发现 ${res.issues.length} 项异常`)
      }
    } catch (e) {
      toast.error(`健康检查失败：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [runHealthCheck, toast, clear])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={handleRun} disabled={loading}>
          {loading ? '检查中…' : '开始检查'}
        </Button>
        {result && (
          <span className="text-sm text-[var(--text-secondary)]">
            已扫描 {result.scanned} 项，异常 {result.issues.length} 项
          </span>
        )}
      </div>

      {loading && progress && (
        <ProgressBar current={progress.current} total={progress.total} label={progress.label} />
      )}

      {result && result.issues.length > 0 && (
        <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
          {result.issues.map((item, idx) => (
            <IssueItem key={`${item.outputPath}-${idx}`} item={item} />
          ))}
        </div>
      )}

      {result && result.issues.length === 0 && (
        <div className="text-sm text-green-500">✅ 所有下载项均健康</div>
      )}
    </div>
  )
}
