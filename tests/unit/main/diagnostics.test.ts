import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted 确保 mock 引用在 vi.mock 提升后仍可访问
const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => true),
  mockReadFileSync: vi.fn(() => '[2026-06-13] [error] 测试日志行'),
}))

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    mkdirSync: vi.fn(),
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  mkdirSync: vi.fn(),
}))

// getLogDir 指向固定路径，避免触碰真实 home
vi.mock('../../../electron/log-init', () => ({
  getLogDir: () => '/mock/logs',
}))

// app.getVersion 返回固定版本
vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.0' },
}))

import { buildDiagnostics } from '../../../electron/diagnostics'

describe('buildDiagnostics', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockReadFileSync.mockReset()
    // 默认：文件存在且可读
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('[2026-06-13] [error] 测试日志行')
  })

  it('报告包含环境信息（版本、平台、时间）', () => {
    const report = buildDiagnostics()
    expect(report).toContain('HComic Downloader 诊断报告')
    expect(report).toContain('版本: 1.2.0')
    expect(report).toContain('平台:')
    expect(report).toContain('时间:')
  })

  it('日志文件不存在时降级显示占位文本', () => {
    mockExistsSync.mockReturnValue(false)
    const report = buildDiagnostics()
    expect(report).toContain('(日志文件不存在)')
  })

  it('读取失败时降级显示读取失败文本', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('permission denied')
    })
    const report = buildDiagnostics()
    expect(report).toContain('读取失败')
    expect(report).toContain('permission denied')
  })

  it('正常读取时包含日志内容与本次会话分节标题', () => {
    const report = buildDiagnostics()
    expect(report).toContain('测试日志行')
    expect(report).toContain('主进程日志（本次会话）')
    expect(report).toContain('Python 后端日志（本次会话）')
  })

  it('有会话标记时只截取标记后的内容', () => {
    // 模拟多次启动累积：历史行 + 标记 + 本次行
    // main.log 和 python.log 各用对应标记，readFileSync 会被调用两次
    let callCount = 0
    mockReadFileSync.mockImplementation(() => {
      callCount++
      // 第一次调用是 main.log，第二次是 python.log
      const marker = callCount === 1 ? '[log-init]' : '[session-start]'
      return (
        `[2026-06-14] [info] 历史过期日志\n` +
        `[2026-06-14] [info] ${marker} session started\n` +
        `[2026-06-14] [error] 本次报错`
      )
    })
    const report = buildDiagnostics()
    expect(report).toContain('本次报错')
    expect(report).not.toContain('历史过期日志')
  })

  it('main.log 中的 [Python] 转发行被排除（避免与 python.log 重复）', () => {
    let callCount = 0
    mockReadFileSync.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // main.log：含 [Python] 转发行 + 纯 Electron 行
        return (
          `[2026-06-14] [info] [log-init] logging initialized\n` +
          `[2026-06-14] [info] [Python] 转发的 Python 日志\n` +
          `[2026-06-14] [error] 纯 Electron 错误`
        )
      }
      // python.log
      return `[2026-06-14] [info] [session-start] python backend started\n`
    })
    const report = buildDiagnostics()
    // 纯 Electron 日志保留
    expect(report).toContain('纯 Electron 错误')
    // [Python] 转发行在 main.log 段被过滤（python.log 段不含此字样）
    expect(report).not.toContain('转发的 Python 日志')
  })
})
