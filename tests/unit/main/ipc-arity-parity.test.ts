// @vitest-environment node
//
// 防御 H4 类契约漂移：preload 转发了 N 个参数，但 main 的 ipcMain.handle
// 只消费了 M < N 个，多余的参数被静默丢弃（如历史上 fetchPreviewImage 的
// imageQuality 被三层全部丢弃）。这类漂移无法被 TypeScript 捕获（main handler
// 用 unknown 收参），也无法被 ipc-channel-consistency.test.ts 捕获（它只校验
// 通道字符串存在性）。
//
// 本测试用纯文本扫描（不导入 electron，避免 mock 复杂度与运行时耦合）抽取
// 每个 H4 风险通道在 preload 与 main 两端的形参/实参签名，逐通道断言一致。
// 不做全量正则参数计数（多行对象字面量参数会导致计数误报），而是为每个风险
// 通道写**精确的签名片段断言**——显式、稳定、命中即说明回归。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname_test = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname_test, '..', '..', '..')
const PRELOAD_PATH = join(REPO_ROOT, 'electron', 'preload.ts')
const MAIN_PATH = join(REPO_ROOT, 'electron', 'main.ts')
const PYTHON_SERVER_PATH = join(REPO_ROOT, 'python', 'ipc_server.py')

const preloadSrc = readFileSync(PRELOAD_PATH, 'utf-8')
const mainSrc = readFileSync(MAIN_PATH, 'utf-8')
const pythonServerSrc = readFileSync(PYTHON_SERVER_PATH, 'utf-8')

describe('IPC preload→main→python 参数透传契约（H4 类回归防护）', () => {
  it('preload 应在源文件中存在（防止路径失效静默通过）', () => {
    expect(preloadSrc.length, 'preload 源读取为空').toBeGreaterThan(0)
    expect(mainSrc.length, 'main 源读取为空').toBeGreaterThan(0)
    expect(pythonServerSrc.length, 'ipc_server.py 源读取为空').toBeGreaterThan(0)
  })

  describe('fetchPreviewImage: imageQuality 必须端到端透传', () => {
    // H4 历史问题：preload 收 imageQuality，main handler 形参列表漏掉它，
    // ipc_server.py dispatch 也漏读 params['image_quality']。三处都必须出现。
    it('preload 收集 imageQuality 并转发给 invoke', () => {
      // preload 中 fetchPreviewImage 的形参应含 imageQuality
      expect(preloadSrc).toMatch(/fetchPreviewImage:\s*\([^)]*imageQuality[^)]*\)/)
      // invoke 调用应把 imageQuality 传给主进程
      expect(preloadSrc).toMatch(/ipcRenderer\.invoke\(\s*IPC_CHANNELS\.FETCH_PREVIEW_IMAGE[^)]*imageQuality/)
    })

    it('main handler 形参列表必须包含 imageQuality', () => {
      // ipcMain.handle(IPC_CHANNELS.FETCH_PREVIEW_IMAGE, async (_, imageUrl, scrambleId, comicId, imageQuality) => ...
      const handlerRe = /ipcMain\.handle\(\s*IPC_CHANNELS\.FETCH_PREVIEW_IMAGE\s*,\s*async\s*\(([^)]*)\)\s*=>/
      const m = handlerRe.exec(mainSrc)
      expect(m, '未找到 FETCH_PREVIEW_IMAGE 的 ipcMain.handle 注册').not.toBeNull()
      const params = m![1]
      expect(params, 'main handler 形参缺少 imageQuality').toContain('imageQuality')
    })

    it('main handler 必须把 image_quality 写入发给 Python 的 params', () => {
      // FETCH_PREVIEW_IMAGE handler 内应出现 params.image_quality = imageQuality
      const handlerBlockRe = /ipcMain\.handle\(\s*IPC_CHANNELS\.FETCH_PREVIEW_IMAGE[\s\S]*?bridge\.call\('fetch_preview_image'[\s\S]*?\)\s*\)/
      const m = handlerBlockRe.exec(mainSrc)
      expect(m, '未找到 fetch_preview_image 的 bridge.call').not.toBeNull()
      expect(m![0], 'main 未把 image_quality 加入 params').toContain('image_quality')
    })

    it('Python ipc_server.py dispatch 必须读取并传递 image_quality', () => {
      // dispatch 分支应读取 params['image_quality'] 并传入 _async_fetch_preview_image。
      // 用整个 fetch_preview_image 分支到下一个 dispatch 入口为止。
      const dispatchRe = /if method == "fetch_preview_image":([\s\S]*?)(?=if method ==|await self\._dispatch_request)/
      const m = dispatchRe.exec(pythonServerSrc)
      expect(m, '未找到 Python fetch_preview_image dispatch 分支').not.toBeNull()
      const block = m![1]
      expect(block, 'Python dispatch 未读取 image_quality 参数').toContain('image_quality')
      expect(block, 'Python dispatch 未把 image_quality 传给 _async_fetch_preview_image')
        .toContain('image_quality=image_quality')
    })
  })

  describe('fetchPreviewImage: generation 必须端到端透传（reader-jump-preload-priority）', () => {
    // 同型 H4 防护：generation（预加载优先级代数）也跨 preload→main→python 三层，
    // 任一层漏读都会让阅读器跳转优先级静默失效。三层都必须出现。
    it('preload 收集 generation 并转发给 invoke', () => {
      expect(preloadSrc).toMatch(/fetchPreviewImage:\s*\([^)]*generation[^)]*\)/)
      expect(preloadSrc).toMatch(/ipcRenderer\.invoke\(\s*IPC_CHANNELS\.FETCH_PREVIEW_IMAGE[\s\S]*?generation/)
    })

    it('main handler 形参列表必须包含 generation', () => {
      const handlerRe = /ipcMain\.handle\(\s*IPC_CHANNELS\.FETCH_PREVIEW_IMAGE\s*,\s*async\s*\(([^)]*)\)\s*=>/
      const m = handlerRe.exec(mainSrc)
      expect(m, '未找到 FETCH_PREVIEW_IMAGE 的 ipcMain.handle 注册').not.toBeNull()
      expect(m![1], 'main handler 形参缺少 generation').toContain('generation')
    })

    it('main handler 必须把 generation 写入发给 Python 的 params', () => {
      const handlerBlockRe = /ipcMain\.handle\(\s*IPC_CHANNELS\.FETCH_PREVIEW_IMAGE[\s\S]*?bridge\.call\('fetch_preview_image'[\s\S]*?\)\s*\)/
      const m = handlerBlockRe.exec(mainSrc)
      expect(m, '未找到 fetch_preview_image 的 bridge.call').not.toBeNull()
      expect(m![0], 'main 未把 generation 加入 params').toContain('generation')
    })

    it('Python ipc_server.py dispatch 必须读取并传递 generation', () => {
      const dispatchRe = /if method == "fetch_preview_image":([\s\S]*?)(?=if method ==|await self\._dispatch_request)/
      const m = dispatchRe.exec(pythonServerSrc)
      expect(m, '未找到 Python fetch_preview_image dispatch 分支').not.toBeNull()
      const block = m![1]
      expect(block, 'Python dispatch 未读取 generation 参数').toContain('generation')
      expect(block, 'Python dispatch 未把 generation 传给 _preview_executor.submit')
        .toContain('generation=generation')
    })

    it('cancel_preview_generations 通道三层注册一致', () => {
      // preload 暴露 cancelPreviewGenerations
      expect(preloadSrc).toMatch(/cancelPreviewGenerations:\s*\([^)]*before[^)]*\)/)
      expect(preloadSrc).toMatch(/IPC_CHANNELS\.CANCEL_PREVIEW_GENERATIONS/)
      // main 注册 ipcMain.handle
      expect(mainSrc).toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.CANCEL_PREVIEW_GENERATIONS/)
      expect(mainSrc).toMatch(/bridge\.call\('cancel_preview_generations'/)
      // Python dispatch 表注册方法名
      expect(pythonServerSrc).toMatch(/"cancel_preview_generations":\s*"handle_cancel_preview_generations"/)
    })
  })

  describe('openDownloadDir / openCacheDir: 路径校验契约对称', () => {
    it('preload 必须做对称的下载目录校验（绝对路径/遍历/控制字符）', () => {
      // H1/H2 修复点：preload 不应再是仅 length>0 的弱校验
      const openDirRe = /openDownloadDir:[\s\S]*?return\s+ipcRenderer\.invoke\(\s*IPC_CHANNELS\.OPEN_DOWNLOAD_DIR/
      const m = openDirRe.exec(preloadSrc)
      expect(m, '未找到 openDownloadDir 实现').not.toBeNull()
      const block = m![0]
      expect(block, 'openDownloadDir 应调用 validateDownloadDir 做对称校验').toContain('validateDownloadDir')
    })

    it('preload openCacheDir 必须复用同样的对称校验', () => {
      const openCacheRe = /openCacheDir:[\s\S]*?return\s+ipcRenderer\.invoke\(\s*IPC_CHANNELS\.OPEN_CACHE_DIR/
      const m = openCacheRe.exec(preloadSrc)
      expect(m, '未找到 openCacheDir 实现').not.toBeNull()
      const block = m![0]
      expect(block, 'openCacheDir 应调用 validateDownloadDir 做对称校验').toContain('validateDownloadDir')
    })

    it('main 必须用 downloadDirValidator 做权威校验并校验是目录（共享 openDirectoryInFileManager）', () => {
      // OPEN_DOWNLOAD_DIR 与 OPEN_CACHE_DIR 共用 openDirectoryInFileManager，
      // 校验逻辑（downloadDirValidator + isDirectory）落在该辅助函数内。
      const helperRe = /(?:async\s+)?function\s+openDirectoryInFileManager\s*\([^)]*\)\s*(?::[^{]+)?\{[\s\S]*?\n\}/
      const m = helperRe.exec(mainSrc)
      expect(m, '未找到 openDirectoryInFileManager 辅助函数').not.toBeNull()
      const block = m![0]
      expect(block, '辅助函数应调用 downloadDirValidator 做权威校验').toContain('downloadDirValidator')
      expect(block, '辅助函数应校验路径是目录（防文件路径被 openPath 当目录打开）').toContain('isDirectory')
      expect(block, '辅助函数应调用 shell.openPath').toContain('shell.openPath')
    })

    it('main 应为 OPEN_DOWNLOAD_DIR 与 OPEN_CACHE_DIR 注册独立 handler 并委托给共享辅助函数', () => {
      expect(mainSrc).toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.OPEN_DOWNLOAD_DIR[\s\S]*?openDirectoryInFileManager/)
      expect(mainSrc).toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.OPEN_CACHE_DIR[\s\S]*?openDirectoryInFileManager/)
    })
  })

  describe('resolveUnmatched: preload 与 main 校验对称', () => {
    it('preload 必须校验 matches 结构（dbKey 数组 + file_path 字符串）', () => {
      const re = /resolveUnmatched:[\s\S]*?return\s+ipcRenderer\.invoke\(\s*IPC_CHANNELS\.RESOLVE_UNMATCHED/
      const m = re.exec(preloadSrc)
      expect(m, '未找到 resolveUnmatched 实现').not.toBeNull()
      const block = m![0]
      // H3 修复点：preload 应校验数组上限 + 每项结构，而非仅 Array.isArray
      expect(block, 'resolveUnmatched 应校验 matches.length 上限').toMatch(/matches\.length\s*>\s*10000/)
      expect(block, 'resolveUnmatched 应校验 dbKey 是字符串数组').toContain('dbKey')
      expect(block, 'resolveUnmatched 应校验 file_path').toContain('file_path')
    })
  })
})
