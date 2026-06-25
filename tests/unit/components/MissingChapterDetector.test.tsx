import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MissingChapterDetector } from '@/components/tools/MissingChapterDetector'

const mockGetFavourites = vi.fn()
const mockSetPendingSearch = vi.fn()
const mockSetResult = vi.fn()
const mockAddMissingIgnore = vi.fn()
const mockRemoveMissingIgnore = vi.fn()
const mockConfirmMissingMemberCount = vi.fn()

vi.mock('@/hooks/useIpc', () => ({
  useFavourites: () => ({ getFavourites: mockGetFavourites }),
}))

// Mock useDrawerStore：MissingGroup 用 openDrawer + setPendingSearch
vi.mock('@/stores/useDrawerStore', () => ({
  useDrawerStore: (selector: (state: {
    openDrawer: () => void
    setPendingSearch: typeof mockSetPendingSearch
  }) => unknown) => selector({
    openDrawer: vi.fn(),
    setPendingSearch: mockSetPendingSearch,
  }),
}))

vi.mock('@/stores/useReaderStore', () => ({
  useReaderStore: (selector: (state: { openReader: () => void }) => unknown) =>
    selector({ openReader: vi.fn() }),
}))

// Mock useCoverImage — MissingGroup 内部使用它渲染封面
vi.mock('@/hooks/useCoverImage', () => ({
  useCoverImage: () => ({ coverSrc: 'data:image/png;base64,mock', retry: vi.fn() }),
}))

// 可变的 settingsStore 状态镜像：MissingGroup 用 sfwMode，MissingChapterDetector
// 用 missingBlacklist + 三个方法
let settingsState: {
  sfwMode: boolean
  missingBlacklist: Record<string, Array<{ fingerprint: string; memberCount: number | null }>>
  addMissingIgnore: typeof mockAddMissingIgnore
  removeMissingIgnore: typeof mockRemoveMissingIgnore
  confirmMissingMemberCount: typeof mockConfirmMissingMemberCount
}

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: typeof settingsState) => unknown) => selector(settingsState),
}))

// 可变的 store 状态镜像，便于在每个用例里配置缓存
let storeResultsState: Record<string, unknown> = {}

vi.mock('@/stores/useMissingChaptersStore', () => ({
  useMissingChaptersStore: (selector: (s: {
    results: typeof storeResultsState
    setResult: typeof mockSetResult
  }) => unknown) => selector({
    results: storeResultsState,
    setResult: mockSetResult,
  }),
}))

describe('MissingChapterDetector', () => {
  beforeEach(() => {
    mockGetFavourites.mockReset()
    mockSetPendingSearch.mockReset()
    mockSetResult.mockReset()
    mockAddMissingIgnore.mockReset()
    mockRemoveMissingIgnore.mockReset()
    mockConfirmMissingMemberCount.mockReset()
    storeResultsState = {}
    settingsState = {
      sfwMode: false,
      missingBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [] },
      addMissingIgnore: mockAddMissingIgnore,
      removeMissingIgnore: mockRemoveMissingIgnore,
      confirmMissingMemberCount: mockConfirmMissingMemberCount,
    }
    mockGetFavourites.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
      needsLogin: false,
    })
  })

  it('渲染标题与开始检测按钮', () => {
    render(<MissingChapterDetector />)
    expect(screen.getByText('查缺补漏')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument()
  })

  it('初始态显示引导文案"选择来源并点击开始检测"', () => {
    render(<MissingChapterDetector />)
    expect(screen.getByText('选择来源并点击开始检测')).toBeInTheDocument()
  })

  it('未登录时显示"请先登录当前来源"', async () => {
    mockGetFavourites.mockResolvedValueOnce({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
      needsLogin: true,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByText('请先登录当前来源')).toBeInTheDocument()
  })

  it('分页拉取时按序调用 getFavourites', async () => {
    const comics = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      title: `作品${i + 1}`,
      url: '',
      coverUrl: '',
      source: 'hcomic',
    }))

    mockGetFavourites
      .mockResolvedValueOnce({
        comics: comics.slice(0, 3),
        pagination: { currentPage: 1, totalPages: 2, totalItems: 5 },
        needsLogin: false,
      })
      .mockResolvedValueOnce({
        comics: comics.slice(3),
        pagination: { currentPage: 2, totalPages: 2, totalItems: 5 },
        needsLogin: false,
      })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(mockGetFavourites).toHaveBeenCalledTimes(2)
    expect(mockGetFavourites).toHaveBeenNthCalledWith(1, 1, 'hcomic')
    expect(mockGetFavourites).toHaveBeenNthCalledWith(2, 2, 'hcomic')
  })

  it('无相似标题时显示空态文案', async () => {
    const comics = [
      { id: '1', title: '魔法少女物语', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '异世界冒险记', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByText('未发现疑似同系列的收藏')).toBeInTheDocument()
  })

  it('检测到同系列组时显示免责声明', async () => {
    const comics = [
      { id: '1', title: '作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByText(/同系列判定基于标题相似度推测/)).toBeInTheDocument()
  })

  it('统计文案显示已分析与组数', async () => {
    const comics = [
      { id: '1', title: '作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByText(/已分析 2 本漫画，发现 1 组同系列收藏/)).toBeInTheDocument()
  })

  it('每组显示"搜索此系列"按钮', async () => {
    const comics = [
      { id: '1', title: '[作者] 作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '[作者] 作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByRole('button', { name: /搜索此系列/ })).toBeInTheDocument()
  })

  it('点击"搜索此系列"调用 setPendingSearch', async () => {
    const comics = [
      { id: '1', title: '[作者] 作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '[作者] 作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))
    const searchBtn = await screen.findByRole('button', { name: /搜索此系列/ })
    await userEvent.click(searchBtn)

    // extractAlbumTitle 提取 "[作者] 作品"，清洗后方括号标记后为 "作品"
    // 清洗后长度 ≥ 2，触发搜索
    expect(mockSetPendingSearch).toHaveBeenCalledWith('作品', 'keyword')
  })

  it('单页失败时显示警告文案', async () => {
    mockGetFavourites
      .mockResolvedValueOnce({
        comics: [
          { id: '1', title: '作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
          { id: '2', title: '作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
        ],
        pagination: { currentPage: 1, totalPages: 2, totalItems: 4 },
        needsLogin: false,
      })
      .mockRejectedValueOnce(new Error('network'))

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByText(/1 页数据获取失败/)).toBeInTheDocument()
  })

  it('真实 LEVEL 系列：搜索词应剥离版本标记和序号', async () => {
    // 来自真实收藏夹日志的 LEVEL 系列，验证搜索词清洗
    const comics = [
      { id: '1', title: '[にのこや (にの子)] エルフに淫紋を付ける本 LEVEL:9 [中国翻訳] [DL版]', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '[にのこや (にの子)] エルフに淫紋を付ける本 LEVEL:8 [中国翻訳] [DL版]', url: '', coverUrl: '', source: 'hcomic' },
      { id: '3', title: '[にのこや (にの子)] エルフに淫紋を付ける本 LEVEL:7 [中国翻訳] [DL版]', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 3 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))
    const searchBtn = await screen.findByRole('button', { name: /搜索此系列/ })
    await userEvent.click(searchBtn)

    // extractAlbumTitle 提取含 [中国翻訳] [DL版] 的交集，清洗后应只剩作品名主体
    // 期望搜索词为 "エルフに淫紋を付ける本"（剥离所有方括号标记和 LEVEL:N）
    expect(mockSetPendingSearch).toHaveBeenCalledWith(
      expect.stringContaining('エルフに淫紋を付ける本'),
      'keyword',
    )
    // 不应包含版本标记
    const calledQuery = mockSetPendingSearch.mock.calls[0][0] as string
    expect(calledQuery).not.toContain('中国翻訳')
    expect(calledQuery).not.toContain('DL版')
    expect(calledQuery).not.toMatch(/LEVEL/i)
  })

  it('真实样本回归：全角方括号【1-4】与行尾裸数字正确清洗', async () => {
    // 用户反馈的真实组：6 本标题，含全角【1-4】区间包裹与行尾裸数字 5/4/3/2
    // 期望搜索词为纯作品名 "女子寮管理人の僕はギャル寮生に振り回されてます"
    // 不应残留 【1-4】 / [中国翻訳] / [DL版] / 行尾数字 / 作者前缀
    const comics = [
      { id: '1', title: '[猫耳と黒マスク (cielo)] 女子寮管理人の僕はギャル寮生に振り回されてます5 [中国翻訳]', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '[猫耳と黒マスク (cielo)] 女子寮管理人の僕はギャル寮生に振り回されてます4 [中国翻訳] [DL版]', url: '', coverUrl: '', source: 'hcomic' },
      { id: '3', title: '[猫耳と黒マスク (cielo)] 女子寮管理人の僕はギャル寮生に振り回されてます3 [中国翻訳]', url: '', coverUrl: '', source: 'hcomic' },
      { id: '4', title: '[猫耳と黒マスク (cielo)] 女子寮管理人の僕はギャル寮生に振り回されてます2 [中国翻訳]', url: '', coverUrl: '', source: 'hcomic' },
      { id: '5', title: '[猫耳と黒マスク (cielo)] 女子寮管理人の僕はギャル寮生に振り回されてます [中国翻訳] [DL版]', url: '', coverUrl: '', source: 'hcomic' },
      { id: '6', title: '[全彩乱涂机上色] [猫耳と黒マスク (cielo)] 女子寮管理人の僕はギャル寮生に振り回されてます【1-4】', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 6 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))
    const searchBtn = await screen.findByRole('button', { name: /搜索此系列/ })
    await userEvent.click(searchBtn)

    const calledQuery = mockSetPendingSearch.mock.calls[0][0] as string
    // 必须包含作品名主体
    expect(calledQuery).toContain('女子寮管理人の僕はギャル寮生に振り回されてます')
    // 不应残留任何噪声标记
    expect(calledQuery).not.toContain('【1-4】')
    expect(calledQuery).not.toContain('中国翻訳')
    expect(calledQuery).not.toContain('DL版')
    expect(calledQuery).not.toContain('全彩乱涂机上色')
    expect(calledQuery).not.toContain('猫耳と黒マスク')
    // 不应残留行尾裸数字
    expect(calledQuery).not.toMatch(/\d+$/)
  })

  it('多组都能搜索（回退策略）：extractAlbumTitle 失败的组也能提取搜索词', async () => {
    // 构造两组：组A 标题规整可提取共有字段；组B 标题差异大，extractAlbumTitle
    // 返回 null，但回退策略应取组内成员清洗后的标题作为搜索词
    const comics = [
      // 组A：同系列，可提取共有"作品甲"
      { id: '1', title: '[作者] 作品甲 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '[作者] 作品甲 第3话', url: '', coverUrl: '', source: 'hcomic' },
      // 组B：标题差异大，无共有字段，但每个成员自身清洗后有内容
      { id: '3', title: '某独立作品 vol.2', url: '', coverUrl: '', source: 'hcomic' },
      { id: '4', title: '另一独立作品 vol.2', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 4 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    // 两组都应显示「搜索此系列」按钮，且都可用（非 disabled）
    const searchButtons = await screen.findAllByRole('button', { name: /搜索此系列/ })
    expect(searchButtons).toHaveLength(2)
    for (const btn of searchButtons) {
      expect(btn).not.toBeDisabled()
    }
  })

  it('检测结果写入 store（跨页面保留）：检测完成后调用 setResult', async () => {
    const comics = [
      { id: '1', title: '作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    // 等待检测完成
    await screen.findByText(/已分析 2 本漫画/)

    // setResult 应被调用，写入 source='hcomic' 的结果
    expect(mockSetResult).toHaveBeenCalledWith('hcomic', expect.objectContaining({
      totalFetched: 2,
      skippedPages: 0,
    }))
    const writtenResult = mockSetResult.mock.calls[0][1] as { groups: unknown[] }
    expect(writtenResult.groups.length).toBeGreaterThanOrEqual(1)
  })

  it('从 store 缓存恢复：挂载时若有缓存直接显示结果，不重新拉取', async () => {
    // 预置缓存：hcomic 已有检测结果
    storeResultsState = {
      hcomic: {
        groups: [{
          comics: [
            { id: 'cached-1', title: '缓存作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
            { id: 'cached-2', title: '缓存作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
          ],
          scores: new Map(),
        }],
        totalFetched: 2,
        skippedPages: 0,
      },
    }

    render(<MissingChapterDetector />)

    // 应直接显示缓存的结果（无需点击检测）
    expect(await screen.findByText(/已分析 2 本漫画，发现 1 组同系列收藏/)).toBeInTheDocument()
    // 不应调用 getFavourites（未触发新检测）
    expect(mockGetFavourites).not.toHaveBeenCalled()
  })

  it('每组显示"忽略此组"按钮', async () => {
    const comics = [
      { id: '1', title: '作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByRole('button', { name: '忽略此组' })).toBeInTheDocument()
  })

  it('点击"忽略此组"调用 addMissingIgnore', async () => {
    const comics = [
      { id: '1', title: '作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))
    await screen.findByText(/疑似重复组|同系列组/)

    await userEvent.click(screen.getByRole('button', { name: '忽略此组' }))
    // groupFingerprint 取组内归一化标题字典序最小值 = "作品 第1话"（归一化后）
    expect(mockAddMissingIgnore).toHaveBeenCalledWith('hcomic', expect.any(String), 2)
  })

  it('已忽略组默认折叠且带"取消忽略"按钮', async () => {
    // 预置黑名单：指纹 = "作品 第1话"（归一化后字典序最小）
    settingsState.missingBlacklist = {
      ...settingsState.missingBlacklist,
      hcomic: [{ fingerprint: '作品 第1话', memberCount: 2 }],
    }
    const comics = [
      { id: '1', title: '作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    // 统计文案含"其中 1 组已忽略"
    expect(await screen.findByText(/其中 1 组已忽略/)).toBeInTheDocument()
    // ignored 区段分隔标题可见
    expect(screen.getByText(/已忽略（1 组/)).toBeInTheDocument()
    // ignored 组带"取消忽略"按钮
    expect(screen.getByRole('button', { name: '取消忽略' })).toBeInTheDocument()
  })

  it('点击"取消忽略"调用 removeMissingIgnore', async () => {
    settingsState.missingBlacklist = {
      ...settingsState.missingBlacklist,
      hcomic: [{ fingerprint: '作品 第1话', memberCount: 2 }],
    }
    const comics = [
      { id: '1', title: '作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))
    await screen.findByText(/其中 1 组已忽略/)

    await userEvent.click(screen.getByRole('button', { name: '取消忽略' }))
    expect(mockRemoveMissingIgnore).toHaveBeenCalledWith('hcomic', '作品 第1话')
  })

  it('打开管理面板', async () => {
    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: /管理已忽略/ }))
    expect(await screen.findByText('已忽略的同系列组')).toBeInTheDocument()
  })

  it('成员变动时显示徽章', async () => {
    // 黑名单记录 memberCount=2，但本次检测组实际有 3 本 → 变动
    settingsState.missingBlacklist = {
      ...settingsState.missingBlacklist,
      hcomic: [{ fingerprint: '作品 第1话', memberCount: 2 }],
    }
    const comics = [
      { id: '1', title: '作品 第1话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '作品 第3话', url: '', coverUrl: '', source: 'hcomic' },
      { id: '3', title: '作品 第5话', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 3 },
      needsLogin: false,
    })

    render(<MissingChapterDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))
    await screen.findByText(/其中 1 组已忽略/)

    // 徽章显示数字 1（成员数 2 → 3）
    const managerBtn = screen.getByRole('button', { name: /管理已忽略/ })
    expect(managerBtn.querySelector('.bg-red-500')).toHaveTextContent('1')
  })
})
