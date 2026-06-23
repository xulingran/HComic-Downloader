import { useState, useCallback } from 'react'
import { useMaintenance } from '@/hooks/useIpc'
import { useToastStore } from '@/stores/useToastStore'
import type { OrphanTempItem, CleanupOrphanResult } from '@shared/types'
import { Panel, Button } from './ui'
import { formatSize, formatDate } from './utils'

export function OrphanCleanupPanel() {
  const { scanOrphanTemps, cleanupOrphanTemps } = useMaintenance()
  const toast = useToastStore()
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [orphans, setOrphans] = useState<OrphanTempItem[]>([])
  const [totalSize, setTotalSize] = useState(0)
  const [result, setResult] = useState<CleanupOrphanResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const handleScan = useCallback(async () => {
    setLoading(true)
    setResult(null)
    setSelected(new Set())
    try {
      const res = await scanOrphanTemps()
      setOrphans(res.orphans)
      setTotalSize(res.totalSizeBytes)
      if (res.orphans.length === 0) {
        toast.success('未发现孤儿临时目录')
      }
    } catch (e) {
      toast.error(`扫描失败：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [scanOrphanTemps, toast])

  const toggleSelect = useCallback((path: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const allSelected = orphans.length > 0 && selected.size === orphans.length
  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(orphans.map(o => o.path)))
    }
  }, [allSelected, orphans])

  const selectedSize = Array.from(selected).reduce((sum, p) => {
    const item = orphans.find(o => o.path === p)
    return sum + (item?.sizeBytes ?? 0)
  }, 0)

  const handleClean = useCallback(async () => {
    const paths = Array.from(selected)
    if (paths.length === 0) return
    setCleaning(true)
    try {
      const res = await cleanupOrphanTemps(paths)
      setResult(res)
      setOrphans(prev => prev.filter(o => !paths.includes(o.path)))
      setSelected(new Set())
      setTotalSize(prev => Math.max(0, prev - res.freedBytes))
      toast.success(`已清理 ${res.removed} 个目录，释放 ${formatSize(res.freedBytes)}`)
      if (res.failed.length > 0) {
        toast.error(`${res.failed.length} 个目录清理失败`)
      }
    } catch (e) {
      toast.error(`清理失败：${(e as Error).message}`)
    } finally {
      setCleaning(false)
    }
  }, [selected, cleanupOrphanTemps, toast])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={handleScan} disabled={loading}>
          {loading ? '扫描中…' : '扫描临时目录'}
        </Button>
        {orphans.length > 0 && (
          <>
            <Button onClick={toggleAll} variant="secondary">
              {allSelected ? '取消全选' : '全选'}
            </Button>
            <Button onClick={handleClean} disabled={cleaning || selected.size === 0} variant="danger">
              {cleaning ? '清理中…' : `清理选中 (${formatSize(selectedSize)})`}
            </Button>
          </>
        )}
        {orphans.length > 0 && (
          <span className="text-sm text-[var(--text-secondary)]">
            共 {orphans.length} 个，合计 {formatSize(totalSize)}
          </span>
        )}
      </div>

      {orphans.length === 0 && !loading && result === null && (
        <div className="text-sm text-[var(--text-secondary)]">点击扫描查找超过 24 小时且未被引用的临时目录</div>
      )}

      {orphans.length > 0 && (
        <Panel className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    aria-label="全选"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-[var(--accent)]"
                  />
                </th>
                <th className="px-3 py-2 text-left">路径</th>
                <th className="px-3 py-2 text-left">大小</th>
                <th className="px-3 py-2 text-left">最后修改</th>
              </tr>
            </thead>
            <tbody>
              {orphans.map(o => (
                <tr key={o.path} className="border-t border-[var(--border)] hover:bg-[var(--bg-secondary)]">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${o.path}`}
                      checked={selected.has(o.path)}
                      onChange={() => toggleSelect(o.path)}
                      className="accent-[var(--accent)]"
                    />
                  </td>
                  <td className="px-3 py-2 text-[var(--text-primary)] break-all max-w-md">{o.path}</td>
                  <td className="px-3 py-2 text-[var(--text-primary)] whitespace-nowrap">{formatSize(o.sizeBytes)}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{formatDate(o.modifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {result && (
        <div className="text-sm text-[var(--text-secondary)]">
          清理完成：移除 {result.removed} 个，释放 {formatSize(result.freedBytes)}，失败 {result.failed.length} 个
        </div>
      )}
    </div>
  )
}
