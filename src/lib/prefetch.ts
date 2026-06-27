/**
 * 懒加载 chunk 的空闲预热。
 *
 * 应用就绪后（startupProgress.done）在浏览器空闲窗口静默加载高频 lazy chunk，
 * 把首次访问的下载/编译成本前移到用户无感知时段。仅加载模块到内存，不渲染。
 *
 * 预热清单（按首次访问概率）：抽屉、阅读器、侧栏常用页面、有跳转入口的设置页。
 * 低频页面（工具箱/维护/关于/更新对话框）不预热，保持按需加载。
 */
import { scheduleIdle } from './scheduler'

/**
 * 高频 chunk 的动态 import 工厂。
 * 与 App.tsx 顶部的 React.lazy import 引用相同的模块路径——触发它们即把 chunk 拉入内存，
 * 之后 React.lazy 渲染时直接命中已加载的模块（webpack/Vite 会复用已解析的 promise）。
 *
 * 每个工厂独立 try/catch：单个 chunk 加载失败不影响其余预热。
 */
const PREFETCH_IMPORTERS: Array<() => Promise<unknown>> = [
  () => import('../components/ComicInfoDrawer'),
  () => import('../components/ComicReaderModal'),
  () => import('../pages/DownloadPage'),
  () => import('../pages/FavouritesPage'),
  () => import('../pages/HistoryPage'),
  () => import('../pages/SettingsPage'),
]

/**
 * 在空闲期依次预加载高频 chunk。
 *
 * - 通过 scheduleIdle 调度，不抢占主线程
 * - 每个 import 独立 .catch，失败不中断后续
 * - 顺序而非并发：避免一次性发起 6 个网络请求，给浏览器调度空间
 *
 * @returns 用于测试的 promise：所有 prefetch 完成时 resolve（不论成败）
 */
export function prefetchHighFrequencyChunks(): Promise<void> {
  return new Promise((resolve) => {
    scheduleIdle(async () => {
      for (const importer of PREFETCH_IMPORTERS) {
        try {
          await importer()
        } catch {
          // 单个 chunk 预热失败静默忽略，不影响其余
        }
      }
      resolve()
    })
  })
}
