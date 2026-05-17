import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const {
  mockGetConfig,
  mockSetConfig,
  mockApplyAuth,
  mockVerifyAuth,
  mockSetThemeMode,
  mockSetCardStyle,
  mockSetSfwMode
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSetConfig: vi.fn(),
  mockApplyAuth: vi.fn(),
  mockVerifyAuth: vi.fn(),
  mockSetThemeMode: vi.fn(),
  mockSetCardStyle: vi.fn(),
  mockSetSfwMode: vi.fn()
}))

vi.mock('@/hooks/useIpc', () => ({
  useIpc: vi.fn().mockReturnValue({ invoke: vi.fn() }),
  useConfig: vi.fn().mockReturnValue({ getConfig: mockGetConfig, setConfig: mockSetConfig, openDownloadDir: vi.fn().mockResolvedValue({ success: true }), selectDirectory: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) }),
  useAuth: vi.fn().mockReturnValue({ applyAuth: mockApplyAuth, verifyAuth: mockVerifyAuth }),
  useProxyStatus: vi.fn().mockReturnValue({ getProxyStatus: vi.fn().mockResolvedValue({ http: '', https: '', noProxy: '' }) }),
  useAvailableFonts: vi.fn().mockReturnValue({ getAvailableFonts: vi.fn().mockResolvedValue({ fonts: [] }) }),
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    themeMode: 'auto',
    cardStyle: 'cover',
    sfwMode: false,
    setThemeMode: mockSetThemeMode,
    setCardStyle: mockSetCardStyle,
    setSfwMode: mockSetSfwMode
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
      const input = screen.getByPlaceholderText('请输入下载目录的绝对路径') as HTMLInputElement
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

  it('calls setCardStyle when card style button clicked', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('详细列表')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('详细列表'))

    expect(mockSetCardStyle).toHaveBeenCalledWith('detailed')
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
      expect(screen.getByPlaceholderText('请输入下载目录的绝对路径')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('请输入下载目录的绝对路径')
    await userEvent.clear(input)
    await userEvent.type(input, '/new/path')
    await userEvent.tab()

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

  it('verifies existing auth on load', async () => {
    mockGetConfig.mockResolvedValue({
      config: { ...defaultConfig, hasAuth: true }
    })
    mockVerifyAuth.mockResolvedValue({ valid: true, message: 'Valid session' })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(mockVerifyAuth).toHaveBeenCalled()
      expect(screen.getByText('有效')).toBeInTheDocument()
    })
  })

  it('handles existing auth verification failure gracefully', async () => {
    mockGetConfig.mockResolvedValue({
      config: { ...defaultConfig, hasAuth: true }
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

  it('hydrates themeMode from config on load', async () => {
    mockGetConfig.mockResolvedValue({
      config: { ...defaultConfig, themeMode: 'dark' }
    })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(mockSetThemeMode).toHaveBeenCalledWith('dark')
    })
  })

  it('restores previous value on blur save failure', async () => {
    mockSetConfig.mockRejectedValueOnce(new Error('Invalid value'))
    // After failure, getConfig returns the previous valid value
    mockGetConfig
      .mockResolvedValueOnce({ config: defaultConfig })
      .mockResolvedValueOnce({ config: defaultConfig })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('请输入下载目录的绝对路径')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('请输入下载目录的绝对路径')
    await userEvent.clear(input)
    await userEvent.tab()

    await waitFor(() => {
      // getConfig should be called again to restore the previous value
      expect(mockGetConfig).toHaveBeenCalledTimes(2)
    })
  })

  it('preserves zero values for numeric config fields', async () => {
    mockGetConfig.mockResolvedValue({
      config: {
        ...defaultConfig,
        retryTimes: 0,
        batchDownloadDelay: 0,
        autoRetryMaxAttempts: 0,
        concurrentDownloads: 0,
        timeout: 0,
      }
    })

    render(<SettingsPage />)

    await waitFor(() => {
      // Verify zero values are shown, not default fallbacks
      expect(screen.getByText('并发下载数 (0)')).toBeInTheDocument()
      expect(screen.getByText('超时时间 (0秒)')).toBeInTheDocument()
      expect(screen.getByText('重试次数 (0)')).toBeInTheDocument()
      expect(screen.getByText('批量下载延迟 (0秒)')).toBeInTheDocument()
    })
  })

  describe('SFW mode', () => {
    it('renders SFW mode section with buttons', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('SFW 模式')).toBeInTheDocument()
        expect(screen.getByText('开启')).toBeInTheDocument()
        expect(screen.getByText('关闭')).toBeInTheDocument()
      })
    })

    it('toggles SFW mode on when "开启" clicked', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('开启')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('开启'))

      expect(mockSetSfwMode).toHaveBeenCalledWith(true)
      expect(mockSetConfig).toHaveBeenCalledWith('sfwMode', true)
    })

    it('toggles SFW mode off when "关闭" clicked', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('关闭')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('关闭'))

      expect(mockSetSfwMode).toHaveBeenCalledWith(false)
      expect(mockSetConfig).toHaveBeenCalledWith('sfwMode', false)
    })

    it('restores previous SFW mode on save failure', async () => {
      mockSetConfig.mockRejectedValueOnce(new Error('Save failed'))
      const prevSfwMode = false

      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('开启')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('开启'))

      await waitFor(() => {
        expect(mockSetSfwMode).toHaveBeenCalledWith(prevSfwMode)
      })
    })
  })
})
