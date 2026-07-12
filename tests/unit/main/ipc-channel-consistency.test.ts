// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  IPC_CHANNELS,
  NOTIFICATION_CHANNELS,
  PYTHON_NOTIFICATION_METHODS,
  PYTHON_IPC_CHANNEL_MAP,
  type IPCMethods,
} from '../../../shared/types'

const __filename_test = fileURLToPath(import.meta.url)
const __dirname_test = dirname(__filename_test)
const REPO_ROOT = join(__dirname_test, '..', '..', '..')

describe('IPC Channel Consistency', () => {
  it('every IPC_CHANNELS entry should have a corresponding PYTHON_IPC_CHANNEL_MAP entry or be a non-python channel', () => {
    const pythonChannels = Object.values(IPC_CHANNELS).filter(
      (ch): ch is string => typeof ch === 'string' && ch.startsWith('python:')
    )
    const nonPythonChannels = Object.values(IPC_CHANNELS).filter(
      (ch): ch is string => typeof ch === 'string' && !ch.startsWith('python:')
    )

    for (const ch of pythonChannels) {
      expect(
        PYTHON_IPC_CHANNEL_MAP[ch as keyof typeof PYTHON_IPC_CHANNEL_MAP],
        `Python channel "${ch}" in IPC_CHANNELS has no PYTHON_IPC_CHANNEL_MAP entry`,
      ).toBeDefined()
    }

    const knownNonPython = ['open-external', 'select-directory', 'open-login-window', 'check', 'get-diagnostics', 'write-clipboard', 'login-extract', 'login-finish']
    for (const ch of nonPythonChannels) {
      expect(
        knownNonPython,
        `Unexpected non-python channel "${ch}" — add to knownNonPython list`,
      ).toContain(ch.replace(/^[^:]+:/, ''))
    }
  })

  it('every PYTHON_IPC_CHANNEL_MAP method should exist in IPCMethods', () => {
    const ipcMethodKeys: ReadonlyArray<keyof IPCMethods> = [
      'search', 'random', 'download', 'download_batch_as_album', 'check_download_conflict', 'get_favourites',
      'add_to_favourites', 'check_favourite', 'remove_from_favourites',
      'get_config', 'set_config', 'get_downloads', 'cancel_download',
      'apply_auth', 'verify_auth', 'shutdown', 'fetch_cover',
      'pause_task', 'resume_task', 'retry_task', 'toggle_global_pause',
      'get_proxy_status', 'get_available_fonts', 'open_download_dir',
      'get_download_detail', 'get_preview_urls', 'get_chapter_preview_urls', 'fetch_preview_image',
      'cancel_preview_generations',
      'check_downloaded_status', 'start_migration', 'confirm_migration',
      'pause_migration', 'resume_migration', 'cancel_migration',
      'get_migration_status', 'resolve_unmatched',
      'get_cache_stats', 'get_cache_dir', 'get_image_cache_dirs', 'open_cache_dir', 'clear_preview_cache', 'clear_all_cache',
      'get_history', 'add_history', 'delete_history', 'clear_history',
      'get_comic_detail',       'get_favourite_tags', 'clear_favourite_tags', 'remove_favourite_tag',
      'sync_favourite_tags', 'get_tag_list', 'refresh_tag_list',
      'moeimg_login', 'bika_login', 'bika_categories', 'hcomic_login', 'nh_apply_api_key', 'clear_source_auth', 'get_jm_domains',
      'force_pack_album', 'get_album_progress',
      'pause_album', 'resume_album', 'cancel_album',
      'run_health_check', 'scan_orphan_temps', 'cleanup_orphan_temps', 'get_storage_stats',
      'library_list', 'library_stats', 'library_detail', 'library_chapters',
      'library_scan_status', 'library_start_scan', 'library_cancel_scan',
      'library_cover', 'library_page_manifest', 'library_get_page',
      'library_get_reading_progress', 'library_save_reading_progress',
      'library_reveal_asset', 'library_health_check', 'library_prepare_delete',
      'library_commit_delete', 'library_rename', 'library_edit_metadata',
    ]

    for (const [channel, method] of Object.entries(PYTHON_IPC_CHANNEL_MAP)) {
      expect(
        ipcMethodKeys,
        `Method "${method}" from channel "${channel}" not found in IPCMethods keys`,
      ).toContain(method)
    }
  })

  it('NOTIFICATION_CHANNELS and PYTHON_NOTIFICATION_METHODS should have matching keys (excluding Electron-only channels)', () => {
    // STARTUP_PROGRESS: Python 经 stderr 输出 PROGRESS 行，PythonBridge 解析后转发，
    // 不走 Python JSON-RPC notification 通道，故属于 Electron-only。
    const electronOnlyNotifications = new Set(['UPDATE_CHECK_RESULT', 'FATAL_ERROR', 'DEEP_LINK', 'STARTUP_PROGRESS', 'LOGIN_EXTRACT_RESULT'])
    const notifKeys = Object.keys(NOTIFICATION_CHANNELS).filter(k => !electronOnlyNotifications.has(k))
    const pyNotifKeys = Object.keys(PYTHON_NOTIFICATION_METHODS)
    expect(notifKeys.sort()).toEqual(pyNotifKeys.sort())
  })

  it('preload and main must reference every IPC channel via IPC_CHANNELS constant — no raw string literals', () => {
    // 修正记录（test-discipline-gate Phase 1 / 任务 3.1）：原版本用例标题承诺"扫描源文件中不出现裸
    // 通道字符串"，但实现只断言常量集合非空（名不副实）。现让它名副其实——读取 preload.ts 与 main.ts
    // 源码，断言没有任何 IPC_CHANNELS 值作为裸字符串字面量出现，强制所有通道引用走常量。
    // 漏写（如新增通道后忘记加到 IPC_CHANNELS 却在 main 里手写 'python:xxx'）会被本用例捕获。
    const preloadSrc = readFileSync(join(REPO_ROOT, 'electron', 'preload.ts'), 'utf-8')
    const mainSrc = readFileSync(join(REPO_ROOT, 'electron', 'main.ts'), 'utf-8')

    const channelValues = Object.values(IPC_CHANNELS).filter(
      (ch): ch is string => typeof ch === 'string'
    )
    expect(channelValues.length, 'IPC_CHANNELS 必须非空').toBeGreaterThan(0)

    // 收集每个通道值作为裸字符串字面量（单/双引号/反引号包裹）的出现位置。
    // 允许的例外：通道值出现在注释中（// 或 /* 行）——这类是文档而非代码引用。
    const violations: string[] = []
    for (const src of [
      { name: 'preload.ts', content: preloadSrc },
      { name: 'main.ts', content: mainSrc },
    ]) {
      for (const ch of channelValues) {
        // 转义通道值用于正则（含 ':' '-' 等无需转义的字符，但稳妥处理）
        const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        // 匹配被引号包裹的通道值：'python:search' / "python:search" / `python:search`
        const quotedRe = new RegExp(`(['"\`])${escaped}\\1`, 'g')
        let m: RegExpExecArray | null
        while ((m = quotedRe.exec(src.content)) !== null) {
          // 判断该匹配是否在注释行内（行内 // 或处于 /* */ 块）
          const lineStart = src.content.lastIndexOf('\n', m.index) + 1
          const lineUpToMatch = src.content.slice(lineStart, m.index)
          if (lineUpToMatch.includes('//')) continue // 行注释，放行
          violations.push(`${src.name}: 裸通道字符串 "${ch}"（应改用 IPC_CHANNELS 常量引用）`)
        }
      }
    }
    expect(violations, `发现裸通道字符串字面量:\n${violations.join('\n')}`).toEqual([])
  })

  it('registers nh-apply-api-key and removes nh-login (remove-nh-password-login spec)', () => {
    // 正向：新通道与 Python 方法必须存在
    expect(PYTHON_IPC_CHANNEL_MAP['python:nh-apply-api-key']).toBe('nh_apply_api_key')
    expect(IPC_CHANNELS.NH_APPLY_API_KEY).toBe('python:nh-apply-api-key')
    // 负向：旧账号密码登录通道必须彻底移除
    expect(PYTHON_IPC_CHANNEL_MAP['python:nh-login']).toBeUndefined()
    expect((IPC_CHANNELS as Record<string, unknown>).NH_LOGIN).toBeUndefined()
  })
})
