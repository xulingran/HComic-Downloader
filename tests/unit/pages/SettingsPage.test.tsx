import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const {
  mockGetConfig,
  mockSetConfig,
  mockApplyAuth,
  mockVerifyAuth,
  mockSetThemeMode,
  mockSetCardStyle
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSetConfig: vi.fn(),
  mockApplyAuth: vi.fn(),
  mockVerifyAuth: vi.fn(),
  mockSetThemeMode: vi.fn(),
  mockSetCardStyle: vi.fn()
}))

vi.mock('@/hooks/useIpc', () => ({
  useConfig: vi.fn().mockReturnValue({ getConfig: mockGetConfig, setConfig: mockSetConfig }),
  useAuth: vi.fn().mockReturnValue({ applyAuth: mockApplyAuth, verifyAuth: mockVerifyAuth })
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    themeMode: 'auto',
    cardStyle: 'cover',
    setThemeMode: mockSetThemeMode,
    setCardStyle: mockSetCardStyle
  }))
}))

import { SettingsPage } from '@/pages/SettingsPage'

const defaultConfig = {
  downloadDir: '/downloads',
  concurrentDownloads: 4,
  timeout: 30,
  retryTimes: 3,
  cbzFilenameTemplate: '{author}-{title}.cbz',
  batchDownloadDelay: 1,
  autoRetryMaxAttempts: 2,
  notifyOnComplete: true,
  notifyWhenForeground: 'inactive' as const,
  defaultSource: 'hcomic',
  outputFormat: 'cbz' as const
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockResolvedValue({ config: defaultConfig })
    mockSetConfig.mockResolvedValue({ success: true })
  })

  it('renders settings page header', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('设置')).toBeInTheDocument()
    })
  })

  it('renders appearance section', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('外观')).toBeInTheDocument()
    })
  })

  it('renders theme mode buttons', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('浅色')).toBeInTheDocument()
      expect(screen.getByText('深色')).toBeInTheDocument()
      expect(screen.getByText('跟随系统')).toBeInTheDocument()
    })
  })

  it('renders card style buttons', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('封面 + 标题')).toBeInTheDocument()
      expect(screen.getByText('详细列表')).toBeInTheDocument()
    })
  })

  it('renders download section', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('下载')).toBeInTheDocument()
    })
  })

  it('renders output format buttons', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('FOLDER')).toBeInTheDocument()
      expect(screen.getByText('ZIP')).toBeInTheDocument()
      expect(screen.getByText('CBZ')).toBeInTheDocument()
    })
  })

  it('renders download directory input with loaded value', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      const input = screen.getByPlaceholderText('留空使用默认目录') as HTMLInputElement
      expect(input.value).toBe('/downloads')
    })
  })

  it('renders source section', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('来源')).toBeInTheDocument()
    })
  })

  it('renders source buttons', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Moeimg')).toBeInTheDocument()
    })
    // HComic appears in both source section and login section, so use getAllByText
    expect(screen.getAllByText('HComic').length).toBeGreaterThanOrEqual(2)
  })

  it('renders login section', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('登录')).toBeInTheDocument()
    })
  })

  it('renders notification section', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('通知')).toBeInTheDocument()
    })
  })

  it('calls setThemeMode and setConfig when theme button clicked', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('浅色')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('浅色'))

    expect(mockSetThemeMode).toHaveBeenCalledWith('light')
    expect(mockSetConfig).toHaveBeenCalledWith('themeMode', 'light')
  })

  it('calls setCardStyle and setConfig when card style button clicked', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('详细列表')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('详细列表'))

    expect(mockSetCardStyle).toHaveBeenCalledWith('detailed')
    expect(mockSetConfig).toHaveBeenCalledWith('cardStyle', 'detailed')
  })

  it('calls setConfig when output format button clicked', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('ZIP')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('ZIP'))

    expect(mockSetConfig).toHaveBeenCalledWith('outputFormat', 'zip')
  })

  it('calls setConfig when download directory changes', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('留空使用默认目录')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('留空使用默认目录')
    await userEvent.clear(input)
    await userEvent.type(input, '/new/path')

    expect(mockSetConfig).toHaveBeenCalledWith('downloadDir', '/new/path')
  })

  it('calls setConfig when source button clicked', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Moeimg')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('Moeimg'))

    expect(mockSetConfig).toHaveBeenCalledWith('defaultSource', 'moeimg')
  })

  it('renders login status as idle initially', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('未配置')).toBeInTheDocument()
    })
  })

  it('renders apply and test auth buttons', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('应用登录信息')).toBeInTheDocument()
      expect(screen.getByText('测试登录')).toBeInTheDocument()
    })
  })

  it('apply auth button is disabled when curl text is empty', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('应用登录信息')).toBeInTheDocument()
    })

    const applyBtn = screen.getByText('应用登录信息').closest('button')!
    expect(applyBtn).toBeDisabled()
  })

  it('apply auth works when curl text provided', async () => {
    mockApplyAuth.mockResolvedValue({})
    mockVerifyAuth.mockResolvedValue({ valid: true, message: 'OK' })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/从浏览器获取 curl 命令/)).toBeInTheDocument()
    })

    const textarea = screen.getByPlaceholderText(/从浏览器获取 curl 命令/)
    await userEvent.type(textarea, 'curl https://example.com')

    const applyBtn = screen.getByText('应用登录信息').closest('button')!
    expect(applyBtn).not.toBeDisabled()

    await userEvent.click(applyBtn)

    await waitFor(() => {
      expect(mockApplyAuth).toHaveBeenCalledWith('curl https://example.com')
      expect(mockVerifyAuth).toHaveBeenCalled()
    })
  })

  it('shows valid status when verifyAuth returns valid', async () => {
    mockApplyAuth.mockResolvedValue({})
    mockVerifyAuth.mockResolvedValue({ valid: true, message: 'Login OK' })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/从浏览器获取 curl 命令/)).toBeInTheDocument()
    })

    const textarea = screen.getByPlaceholderText(/从浏览器获取 curl 命令/)
    await userEvent.type(textarea, 'curl cmd')
    await userEvent.click(screen.getByText('应用登录信息'))

    await waitFor(() => {
      expect(screen.getByText('有效')).toBeInTheDocument()
      expect(screen.getByText('Login OK')).toBeInTheDocument()
    })
  })

  it('shows invalid status when verifyAuth returns invalid', async () => {
    mockApplyAuth.mockResolvedValue({})
    mockVerifyAuth.mockResolvedValue({ valid: false, message: 'Session expired' })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/从浏览器获取 curl 命令/)).toBeInTheDocument()
    })

    const textarea = screen.getByPlaceholderText(/从浏览器获取 curl 命令/)
    await userEvent.type(textarea, 'curl cmd')
    await userEvent.click(screen.getByText('应用登录信息'))

    await waitFor(() => {
      expect(screen.getByText('失效')).toBeInTheDocument()
      expect(screen.getByText('Session expired')).toBeInTheDocument()
    })
  })

  it('shows error status when applyAuth throws', async () => {
    mockApplyAuth.mockRejectedValue(new Error('Network error'))

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/从浏览器获取 curl 命令/)).toBeInTheDocument()
    })

    const textarea = screen.getByPlaceholderText(/从浏览器获取 curl 命令/)
    await userEvent.type(textarea, 'curl cmd')
    await userEvent.click(screen.getByText('应用登录信息'))

    await waitFor(() => {
      expect(screen.getByText('错误')).toBeInTheDocument()
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('test auth button calls verifyAuth', async () => {
    mockVerifyAuth.mockResolvedValue({ valid: true, message: 'OK' })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('测试登录')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('测试登录'))

    await waitFor(() => {
      expect(mockVerifyAuth).toHaveBeenCalled()
    })
  })

  it('test auth shows error when verifyAuth throws', async () => {
    mockVerifyAuth.mockRejectedValue(new Error('Connection failed'))

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('测试登录')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('测试登录'))

    await waitFor(() => {
      expect(screen.getByText('错误')).toBeInTheDocument()
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
    })
  })

  it('shows saving indicator when saving', async () => {
    mockSetConfig.mockReturnValue(new Promise(() => {})) // never resolves

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('浅色')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('浅色'))

    expect(screen.getByText('保存中...')).toBeInTheDocument()
  })

  it('handles getConfig error gracefully', async () => {
    mockGetConfig.mockRejectedValue(new Error('IPC error'))

    render(<SettingsPage />)

    // Should still render settings sections even if config load fails
    await waitFor(() => {
      expect(screen.getByText('设置')).toBeInTheDocument()
    })
  })

  it('verifies existing cookie on load', async () => {
    mockGetConfig.mockResolvedValue({
      config: { ...defaultConfig, cookie: 'existing_cookie' }
    })
    mockVerifyAuth.mockResolvedValue({ valid: true, message: 'Valid session' })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(mockVerifyAuth).toHaveBeenCalled()
      expect(screen.getByText('有效')).toBeInTheDocument()
    })
  })

  it('handles existing cookie verification failure gracefully', async () => {
    mockGetConfig.mockResolvedValue({
      config: { ...defaultConfig, cookie: 'existing_cookie' }
    })
    mockVerifyAuth.mockRejectedValue(new Error('Failed'))

    render(<SettingsPage />)

    await waitFor(() => {
      expect(mockVerifyAuth).toHaveBeenCalled()
    })

    // Should revert to idle status
    await waitFor(() => {
      expect(screen.getByText('未配置')).toBeInTheDocument()
    })
  })

  it('toggles notification on/off', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('下载完成通知')).toBeInTheDocument()
    })

    // Find and click the toggle button
    const toggleBtn = screen.getByText('下载完成通知')
      .closest('div')!
      .querySelector('button')!
    await userEvent.click(toggleBtn)

    expect(mockSetConfig).toHaveBeenCalledWith('notifyOnComplete', false)
  })

  it('renders foreground notification buttons', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('仅后台时')).toBeInTheDocument()
      expect(screen.getByText('始终通知')).toBeInTheDocument()
    })
  })

  it('calls setConfig when foreground notification mode changes', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('始终通知')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('始终通知'))

    expect(mockSetConfig).toHaveBeenCalledWith('notifyWhenForeground', 'always')
  })
})
