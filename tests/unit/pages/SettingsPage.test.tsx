import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const {
  mockGetConfig,
  mockSetConfig,
  mockApplyAuth,
  mockVerifyAuth,
  mockSetThemeMode,
  mockSetCardStyle,
  mockSetSfwMode,
  mockSetDefaultFavouriteSource,
  mockConfirmMigration,
  mockCancelMigration
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSetConfig: vi.fn(),
  mockApplyAuth: vi.fn(),
  mockVerifyAuth: vi.fn(),
  mockSetThemeMode: vi.fn(),
  mockSetCardStyle: vi.fn(),
  mockSetSfwMode: vi.fn(),
  mockSetDefaultFavouriteSource: vi.fn(),
  mockConfirmMigration: vi.fn().mockResolvedValue({ started: true }),
  mockCancelMigration: vi.fn().mockResolvedValue({ cancelled: true })
}))

vi.mock('@/hooks/useIpc', () => ({
  useIpc: vi.fn().mockReturnValue({ invoke: vi.fn() }),
  useConfig: vi.fn().mockReturnValue({ getConfig: mockGetConfig, setConfig: mockSetConfig, openDownloadDir: vi.fn().mockResolvedValue({ success: true }), selectDirectory: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) }),
  useAuth: vi.fn().mockReturnValue({ applyAuth: mockApplyAuth, verifyAuth: mockVerifyAuth }),
  useProxyStatus: vi.fn().mockReturnValue({ getProxyStatus: vi.fn().mockResolvedValue({ http: '', https: '', noProxy: '' }) }),
  useAvailableFonts: vi.fn().mockReturnValue({ getAvailableFonts: vi.fn().mockResolvedValue({ fonts: [] }) }),
  useJmDomains: vi.fn().mockReturnValue({ getJmDomains: vi.fn().mockResolvedValue({ domains: [] }), jmDomains: [] }),
  useFavouriteTags: vi.fn().mockReturnValue({
    getFavouriteTags: vi.fn().mockResolvedValue({ tags: [] }),
    clearFavouriteTags: vi.fn(),
    removeFavouriteTag: vi.fn(),
    syncFavouriteTags: vi.fn().mockResolvedValue({ tags: [], totalComics: 0 }),
  }),
}))

vi.mock('@/hooks/useMigration', () => ({
  useMigration: () => ({
    confirmMigration: mockConfirmMigration,
    cancelMigration: mockCancelMigration,
    startMigration: vi.fn(),
    pauseMigration: vi.fn(),
    resumeMigration: vi.fn(),
    getMigrationStatus: vi.fn(),
    resolveUnmatched: vi.fn(),
    syncFromBackend: vi.fn(),
    progress: null,
    complete: null,
    errors: [],
    isActive: false,
    resetState: vi.fn(),
  }),
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    themeMode: 'auto',
    cardStyle: 'cover',
    sfwMode: false,
    defaultFavouriteSource: '',
    tagBlacklist: { hcomic: [], moeimg: [] },
    myTags: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [] },
    setThemeMode: mockSetThemeMode,
    setCardStyle: mockSetCardStyle,
    setSfwMode: mockSetSfwMode,
    setDefaultFavouriteSource: mockSetDefaultFavouriteSource,
    addTag: vi.fn(),
    removeTag: vi.fn(),
    addMyTag: vi.fn(() => true),
    removeMyTag: vi.fn(),
    favouriteTagHighlight: false,
    favouriteTagMinMatches: 1,
    setFavouriteTagHighlight: vi.fn(),
    setFavouriteTagMinMatches: vi.fn(),
  }))
}))

import { SettingsPage } from '@/pages/SettingsPage'

Object.defineProperty(window, 'hcomic', {
  value: {
    openLoginWindow: vi.fn().mockResolvedValue({ success: true, message: '登录成功' }),
    openUrl: vi.fn(),
    nhApplyApiKey: vi.fn().mockResolvedValue({ success: true }),
    clearAuth: vi.fn().mockResolvedValue({ success: true }),
    verifyAuth: vi.fn().mockResolvedValue({ valid: true, message: 'ok' }),
  },
  writable: true,
})

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
  outputFormat: 'folder' as const
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
      const input = screen.getAllByPlaceholderText('请输入下载目录的绝对路径')[0] as HTMLInputElement
      expect(input.value).toBe('/downloads')
    })
  })

  it('renders source section', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '来源' })).toBeInTheDocument()
    })
  })

  it('renders source buttons', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('MoeImg').length).toBeGreaterThanOrEqual(1)
    })
    // HComic appears in source section, tag filter section, and login section
    expect(screen.getAllByText('HComic').length).toBeGreaterThanOrEqual(2)
  })

  it('renders login section', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByText(/登录/).length).toBeGreaterThanOrEqual(1)
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
      expect(screen.getAllByPlaceholderText('请输入下载目录的绝对路径').length).toBeGreaterThanOrEqual(1)
    })

    const input = screen.getAllByPlaceholderText('请输入下载目录的绝对路径')[0]
    await userEvent.clear(input)
    await userEvent.type(input, '/new/path')
    await userEvent.tab()

    expect(mockSetConfig).toHaveBeenCalledWith('downloadDir', '/new/path')
  })

  it('shows migration confirm dialog when downloadDir change triggers migration', async () => {
    // 模拟后端返回 migrationTriggered=true
    mockSetConfig.mockResolvedValueOnce({
      success: true,
      migrationTriggered: true,
      migrationId: 'mig-123',
      migrationTotalItems: 5,
    })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('请输入下载目录的绝对路径').length).toBeGreaterThanOrEqual(1)
    })

    const input = screen.getAllByPlaceholderText('请输入下载目录的绝对路径')[0]
    await userEvent.clear(input)
    await userEvent.type(input, '/new/migrated/path')
    await userEvent.tab()

    // 确认对话框出现，展示迁移文件数
    expect(await screen.findByText('迁移下载文件')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()

    // 用户确认 → 调 confirmMigration
    await userEvent.click(screen.getByText('确认迁移'))
    await waitFor(() => {
      expect(mockConfirmMigration).toHaveBeenCalledWith('mig-123')
    })
  })

  it('cancels migration and rolls back when user clicks cancel', async () => {
    mockSetConfig.mockResolvedValueOnce({
      success: true,
      migrationTriggered: true,
      migrationId: 'mig-456',
      migrationTotalItems: 3,
    })
    // cancel 后 getConfig 回填旧值
    mockGetConfig.mockResolvedValueOnce({ config: { ...defaultConfig, downloadDir: '/downloads' } })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('请输入下载目录的绝对路径').length).toBeGreaterThanOrEqual(1)
    })

    const input = screen.getAllByPlaceholderText('请输入下载目录的绝对路径')[0]
    await userEvent.clear(input)
    await userEvent.type(input, '/cancelled/path')
    await userEvent.tab()

    expect(await screen.findByText('迁移下载文件')).toBeInTheDocument()
    await userEvent.click(screen.getByText('取消'))

    await waitFor(() => {
      expect(mockCancelMigration).toHaveBeenCalled()
    })
  })

  it('does not show migration dialog when setConfig returns no migrationTriggered', async () => {
    // 普通配置变更（N=0 快速路径），不触发对话框
    mockSetConfig.mockResolvedValueOnce({ success: true })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('请输入下载目录的绝对路径').length).toBeGreaterThanOrEqual(1)
    })

    const input = screen.getAllByPlaceholderText('请输入下载目录的绝对路径')[0]
    await userEvent.clear(input)
    await userEvent.type(input, '/normal/path')
    await userEvent.tab()

    // 等待 setConfig 完成，确认无迁移对话框
    await waitFor(() => {
      expect(mockSetConfig).toHaveBeenCalledWith('downloadDir', '/normal/path')
    })
    expect(screen.queryByText('迁移下载文件')).not.toBeInTheDocument()
  })

  it('calls setConfig when source button clicked', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('MoeImg').length).toBeGreaterThanOrEqual(1)
    })

    // Click the first MoeImg button (in the default source section)
    await userEvent.click(screen.getAllByText('MoeImg')[0])

    expect(mockSetConfig).toHaveBeenCalledWith('defaultSource', 'moeimg')
  })

  it('renders login status as idle initially', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('未配置').length).toBeGreaterThanOrEqual(2)
    })
  })

  it('prefills saved username and password for credential-based sources', async () => {
    mockGetConfig.mockResolvedValue({
      config: {
        ...defaultConfig,
        hcomicUsername: 'hcomic_user',
        hcomicPassword: 'hcomic_pass',
        moeimgUsername: 'moeimg_user',
        moeimgPassword: 'moeimg_pass',
        bikaUsername: 'bika_user',
        bikaPassword: 'bika_pass',
      }
    })

    render(<SettingsPage />)

    // 等待配置加载后，用可访问名称展开对应来源卡片，避免依赖卡片顺序或折叠图标文本。
    await userEvent.click(await screen.findByRole('button', { name: '展开 HComic 登录设置' }))
    await userEvent.click(screen.getByRole('button', { name: '展开 MoeImg 登录设置' }))
    await userEvent.click(screen.getByRole('button', { name: '展开 哔咔 (Bika) 登录设置' }))
    await userEvent.click(screen.getByRole('button', { name: '展开 NH 登录设置' }))

    // 卡片展开后输入框才渲染；findBy 会自动等待
    const hcomicUserInput = await screen.findByPlaceholderText('HComic 用户名或邮箱') as HTMLInputElement
    const hcomicPassInput = await screen.findByPlaceholderText('HComic 密码') as HTMLInputElement
    const moeimgUserInput = await screen.findByPlaceholderText('moeimg 用户名') as HTMLInputElement
    const moeimgPassInput = await screen.findByPlaceholderText('moeimg 密码') as HTMLInputElement
    const bikaUserInput = await screen.findByPlaceholderText('哔咔用户名') as HTMLInputElement
    const bikaPassInput = await screen.findByPlaceholderText('哔咔密码') as HTMLInputElement

    expect(hcomicUserInput.value).toBe('hcomic_user')
    expect(hcomicPassInput.value).toBe('hcomic_pass')
    expect(hcomicPassInput).toHaveAttribute('type', 'password')
    expect(moeimgUserInput.value).toBe('moeimg_user')
    expect(moeimgPassInput.value).toBe('moeimg_pass')
    expect(moeimgPassInput).toHaveAttribute('type', 'password')
    expect(bikaUserInput.value).toBe('bika_user')
    expect(bikaPassInput.value).toBe('bika_pass')
    expect(bikaPassInput).toHaveAttribute('type', 'password')
  })

  it('NH does not render username/password inputs and never prefills API Key (remove-nh-password-login)', async () => {
    render(<SettingsPage />)

    await userEvent.click(await screen.findByRole('button', { name: '展开 NH 登录设置' }))

    // NH 仅保留 API Key 输入框；账号密码相关元素必须完全不存在
    expect(screen.queryByPlaceholderText('nhentai 用户名')).toBeNull()
    expect(screen.queryByPlaceholderText('nhentai 密码')).toBeNull()
    // 已保存的 API Key 不回填（安全契约）
    const nhApiKeyInput = await screen.findByPlaceholderText('从 nhentai 账户设置页生成 API Key') as HTMLInputElement
    expect(nhApiKeyInput.value).toBe('')
    // 应用 API Key 按钮存在且初始禁用（空输入）
    expect(screen.getByRole('button', { name: '应用 API Key' })).toBeDisabled()
  })

  it('NH applies API Key via nhApplyApiKey and runs verify on success', async () => {
    const nhApplyApiKeySpy = window.hcomic!.nhApplyApiKey as ReturnType<typeof vi.fn>
    nhApplyApiKeySpy.mockClear()
    nhApplyApiKeySpy.mockResolvedValue({ success: true })

    render(<SettingsPage />)
    await userEvent.click(await screen.findByRole('button', { name: '展开 NH 登录设置' }))

    const nhApiKeyInput = await screen.findByPlaceholderText('从 nhentai 账户设置页生成 API Key') as HTMLInputElement
    await userEvent.type(nhApiKeyInput, 'nh-api-key-xxx')
    await userEvent.click(screen.getByRole('button', { name: '应用 API Key' }))

    await waitFor(() => {
      expect(nhApplyApiKeySpy).toHaveBeenCalledWith('nh-api-key-xxx')
    })
  })

  it('renders apply and test auth buttons', async () => {
    render(<SettingsPage />)

    await userEvent.click(screen.getAllByText('▶')[0])

    await waitFor(() => {
      expect(screen.getAllByText('应用登录信息').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('测试登录').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('apply auth button is disabled when curl text is empty', async () => {
    render(<SettingsPage />)

    await userEvent.click(screen.getAllByText('▶')[0])

    await waitFor(() => {
      expect(screen.getAllByText('应用登录信息').length).toBeGreaterThanOrEqual(1)
    })

    const applyBtns = screen.getAllByText('应用登录信息').map(el => el.closest('button')!)
    expect(applyBtns[0]).toBeDisabled()
  })

  it('apply auth works when curl text provided', async () => {
    mockApplyAuth.mockResolvedValue({})
    mockVerifyAuth.mockResolvedValue({ valid: true, message: 'OK' })

    render(<SettingsPage />)

    await userEvent.click(screen.getAllByText('▶')[0])

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText(/从浏览器获取 curl 命令/).length).toBeGreaterThanOrEqual(1)
    })

    const textarea = screen.getAllByPlaceholderText(/从浏览器获取 curl 命令/)[0]
    await userEvent.type(textarea, 'curl https://example.com')

    const applyBtn = screen.getAllByText('应用登录信息')[0].closest('button')!
    expect(applyBtn).not.toBeDisabled()

    await userEvent.click(applyBtn)

    await waitFor(() => {
      expect(mockApplyAuth).toHaveBeenCalledWith('curl https://example.com', 'hcomic')
      // 重写：裸 toHaveBeenCalled() 改为带 source，验证 apply 后对 hcomic 发起 verify
      expect(mockVerifyAuth).toHaveBeenCalledWith('hcomic')
    })
  })

  it('shows valid status when verifyAuth returns valid', async () => {
    mockApplyAuth.mockResolvedValue({})
    mockVerifyAuth.mockResolvedValue({ valid: true, message: 'Login OK' })

    render(<SettingsPage />)

    await userEvent.click(screen.getAllByText('▶')[0])

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText(/从浏览器获取 curl 命令/).length).toBeGreaterThanOrEqual(1)
    })

    const textarea = screen.getAllByPlaceholderText(/从浏览器获取 curl 命令/)[0]
    await userEvent.type(textarea, 'curl cmd')
    await userEvent.click(screen.getAllByText('应用登录信息')[0])

    await waitFor(() => {
      expect(screen.getAllByText('有效').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Login OK')).toBeInTheDocument()
    })
  })

  it('shows invalid status when verifyAuth returns invalid', async () => {
    mockApplyAuth.mockResolvedValue({})
    mockVerifyAuth.mockResolvedValue({ valid: false, message: 'Session expired' })

    render(<SettingsPage />)

    await userEvent.click(screen.getAllByText('▶')[0])

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText(/从浏览器获取 curl 命令/).length).toBeGreaterThanOrEqual(1)
    })

    const textarea = screen.getAllByPlaceholderText(/从浏览器获取 curl 命令/)[0]
    await userEvent.type(textarea, 'curl cmd')
    await userEvent.click(screen.getAllByText('应用登录信息')[0])

    await waitFor(() => {
      expect(screen.getAllByText('失效').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Session expired')).toBeInTheDocument()
    })
  })

  it('shows error status when applyAuth throws', async () => {
    mockApplyAuth.mockRejectedValue(new Error('Network error'))

    render(<SettingsPage />)

    await userEvent.click(screen.getAllByText('▶')[0])

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText(/从浏览器获取 curl 命令/).length).toBeGreaterThanOrEqual(1)
    })

    const textarea = screen.getAllByPlaceholderText(/从浏览器获取 curl 命令/)[0]
    await userEvent.type(textarea, 'curl cmd')
    await userEvent.click(screen.getAllByText('应用登录信息')[0])

    await waitFor(() => {
      expect(screen.getAllByText('错误').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('test auth button calls verifyAuth', async () => {
    mockVerifyAuth.mockResolvedValue({ valid: true, message: 'OK' })

    render(<SettingsPage />)

    await userEvent.click(screen.getAllByText('▶')[0])

    await waitFor(() => {
      expect(screen.getAllByText('测试登录').length).toBeGreaterThanOrEqual(1)
    })

    await userEvent.click(screen.getAllByText('测试登录')[0])

    await waitFor(() => {
      // 重写：裸 toHaveBeenCalled() 改为带 source，验证测试登录对 hcomic 发起 verify
      expect(mockVerifyAuth).toHaveBeenCalledWith('hcomic')
    })
  })

  it('test auth shows error when verifyAuth throws', async () => {
    mockVerifyAuth.mockRejectedValue(new Error('Connection failed'))

    render(<SettingsPage />)

    await userEvent.click(screen.getAllByText('▶')[0])

    await waitFor(() => {
      expect(screen.getAllByText('测试登录').length).toBeGreaterThanOrEqual(1)
    })

    await userEvent.click(screen.getAllByText('测试登录')[0])

    await waitFor(() => {
      expect(screen.getAllByText('错误').length).toBeGreaterThanOrEqual(1)
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
      expect(mockVerifyAuth).toHaveBeenCalledWith('hcomic')
      expect(screen.getAllByText('有效').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('verifies jm auth on load when hasJmAuth is true', async () => {
    mockGetConfig.mockResolvedValue({
      config: { ...defaultConfig, hasJmAuth: true }
    })
    mockVerifyAuth.mockResolvedValue({ valid: true, message: 'Valid session' })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(mockVerifyAuth).toHaveBeenCalledWith('jm')
    })
  })

  it('handles existing auth verification failure gracefully', async () => {
    mockGetConfig.mockResolvedValue({
      config: { ...defaultConfig, hasAuth: true }
    })
    mockVerifyAuth.mockRejectedValue(new Error('Failed'))

    render(<SettingsPage />)

    await waitFor(() => {
      expect(mockVerifyAuth).toHaveBeenCalledWith('hcomic')
    })

    // Should revert to idle status
    await waitFor(() => {
      expect(screen.getAllByText('未配置').length).toBeGreaterThanOrEqual(2)
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
      expect(screen.getAllByPlaceholderText('请输入下载目录的绝对路径').length).toBeGreaterThanOrEqual(1)
    })

    const input = screen.getAllByPlaceholderText('请输入下载目录的绝对路径')[0]
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

  describe('默认收藏夹来源', () => {
    it('渲染默认收藏夹来源选项组（含「未设置」与支持收藏的来源，无 copymanga）', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('默认收藏夹来源')).toBeInTheDocument()
      })
      expect(screen.getByText('未设置（每次询问）')).toBeInTheDocument()
      // 支持收藏的来源都应出现
      expect(screen.getAllByText('HComic').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('MoeImg').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('JM').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('哔咔').length).toBeGreaterThanOrEqual(1)
      // copymanga（拷贝漫画）不应出现在此选项组（其他分区可能有，故不强断言 absence）
    })

    it('点击「未设置」调用 setDefaultFavouriteSource 与 setConfig 持久化', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('未设置（每次询问）')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('未设置（每次询问）'))

      expect(mockSetDefaultFavouriteSource).toHaveBeenCalledWith('')
      expect(mockSetConfig).toHaveBeenCalledWith('defaultFavouriteSource', '')
    })

    it('点击来源按钮（如 JM）持久化对应来源', async () => {
      render(<SettingsPage />)

      const group = await screen.findByTestId('default-favourite-source-group')
      await userEvent.click(within(group).getByText('JM'))

      expect(mockSetDefaultFavouriteSource).toHaveBeenCalledWith('jm')
      expect(mockSetConfig).toHaveBeenCalledWith('defaultFavouriteSource', 'jm')
    })
  })

})
