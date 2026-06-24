// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  IPC_CHANNELS,
  NOTIFICATION_CHANNELS,
  PYTHON_NOTIFICATION_METHODS,
  PYTHON_IPC_CHANNEL_MAP,
  type IPCMethods,
} from '../../../shared/types'

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

    const knownNonPython = ['open-external', 'select-directory', 'open-login-window', 'check', 'get-diagnostics', 'write-clipboard']
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
      'check_downloaded_status', 'start_migration', 'confirm_migration',
      'pause_migration', 'resume_migration', 'cancel_migration',
      'get_migration_status', 'resolve_unmatched',
      'get_cache_stats', 'get_cache_dir', 'open_cache_dir', 'clear_preview_cache', 'clear_all_cache',
      'get_history', 'add_history', 'delete_history', 'clear_history',
      'get_comic_detail',       'get_favourite_tags', 'clear_favourite_tags', 'remove_favourite_tag',
      'sync_favourite_tags', 'get_tag_list', 'refresh_tag_list',
      'moeimg_login', 'bika_login', 'bika_categories', 'hcomic_login', 'get_jmcomic_domains',
      'force_pack_album', 'get_album_progress',
      'pause_album', 'resume_album', 'cancel_album',
      'run_health_check', 'scan_orphan_temps', 'cleanup_orphan_temps', 'get_storage_stats',
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
    const electronOnlyNotifications = new Set(['UPDATE_CHECK_RESULT', 'FATAL_ERROR', 'DEEP_LINK', 'STARTUP_PROGRESS'])
    const notifKeys = Object.keys(NOTIFICATION_CHANNELS).filter(k => !electronOnlyNotifications.has(k))
    const pyNotifKeys = Object.keys(PYTHON_NOTIFICATION_METHODS)
    expect(notifKeys.sort()).toEqual(pyNotifKeys.sort())
  })

  it('no IPC channel string should appear as a raw string in preload or main — all use IPC_CHANNELS constant', () => {
    const channelValues = new Set(Object.values(IPC_CHANNELS))
    const notifValues = new Set(Object.values(NOTIFICATION_CHANNELS))
    const pyNotifValues = new Set(Object.values(PYTHON_NOTIFICATION_METHODS))

    expect(channelValues.size).toBeGreaterThan(0)
    expect(notifValues.size).toBeGreaterThan(0)
    expect(pyNotifValues.size).toBeGreaterThan(0)
  })
})
