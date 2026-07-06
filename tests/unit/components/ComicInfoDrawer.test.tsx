import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDrawerStore } from '@/stores/useDrawerStore'
import { sourceNeedsDetailEnrich, sourceSupportsFavourites, sourceSupportsTagRecommendation } from '@/utils/source'
import type { ComicInfo } from '@shared/types'

// --- Mocks（必须用 @/ 别名，相对路径 mock 会失效导致真实模块加载、jsdom 下渲染循环 OOM）---

vi.mock('@/components/common/Toast', () => ({
  Toast: ({ message, visible }: { message: string; visible: boolean }) =>
    visible ? <div>{message}</div> : null,
}))
const { mockIsAuthError, mockAddToFavourites, mockRemoveFromFavourites } = vi.hoisted(() => ({
  mockIsAuthError: vi.fn((_error: unknown) => false),
  mockAddToFavourites: vi.fn().mockResolvedValue({ success: true }),
  mockRemoveFromFavourites: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/utils/auth', () => ({ isAuthError: mockIsAuthError }))
vi.mock('@/utils/source', () => ({
  normalizeSourceKey: (s: string) => s,
  sourceSupportsFavourites: vi.fn((source: string) => ['hcomic', 'moeimg', 'jm', 'bika', 'nh'].includes(source)),
  // 默认 true：hcomic/moeimg/jm/bika 真实均支持推荐，让既有 hcomic 用例保留推荐入口行为。
  // 新增 NH 门控用例通过 vi.mocked(...).mockReturnValue(false) 覆盖为不支持来源。
  sourceSupportsTagRecommendation: vi.fn(() => true),
  // 默认返回 false（保持现有用例行为：hcomic + 有 tags 不触发 enrich）。
  // 新 enrich 失败用例通过 vi.mocked(...).mockReturnValue(...) 覆盖为按来源返回。
  sourceNeedsDetailEnrich: vi.fn(() => false),
}))
// 可变 store mock：测试可修改 settingsState 来模拟不同标签状态（已屏蔽/已推荐/未设置）
const mockAddTag = vi.fn(() => true)
const mockRemoveTag = vi.fn()
const mockAddMyTag = vi.fn(() => true)
const mockRemoveMyTag = vi.fn()
let settingsState: Record<string, unknown> = {}
const resetSettingsState = () => {
  settingsState = {
    tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
    myTags: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
    favouriteTagHighlight: false,
    addTag: mockAddTag,
    removeTag: mockRemoveTag,
    addMyTag: mockAddMyTag,
    removeMyTag: mockRemoveMyTag,
  }
}
resetSettingsState()
vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: () => settingsState,
}))
const mockCheckFavourite = vi.fn().mockResolvedValue({ isFavourited: false })
const mockGetComicDetail = vi.fn().mockResolvedValue({ comic: null })
vi.mock('@/hooks/useIpc', () => ({
  useAddToFavourites: () => ({ addToFavourites: mockAddToFavourites }),
  useRemoveFromFavourites: () => ({ removeFromFavourites: mockRemoveFromFavourites }),
  useCheckFavourite: () => ({ checkFavourite: mockCheckFavourite }),
  useComicDetail: () => ({ getComicDetail: mockGetComicDetail }),
}))

const { ComicInfoDrawer } = await import('@/components/ComicInfoDrawer')

// --- Fixtures -------------------------------------------------------------

const comicWithTags: ComicInfo = {
  id: '1',
  title: '测试漫画',
  url: 'https://example.com/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'hcomic',
  sourceSite: 'hcomic',
  author: '作者A',
  tags: ['NTR', '魔法少女'],
  parodies: ['原作X'],
  characters: ['角色Y'],
}

// 用真实 store，把 actions 替换为 spy，同时保留 store 内部一致性。
const store = useDrawerStore
const setPendingSearchSpy = vi.fn()
const closeDrawerSpy = vi.fn()

const openDrawerWith = (comic: ComicInfo) => {
  store.setState({
    drawerComic: comic,
    isOpen: true,
    pendingSearch: null,
    setPendingSearch: (...args: never[]) => setPendingSearchSpy(...args),
    closeDrawer: () => closeDrawerSpy(),
  })
}

beforeEach(() => {
  setPendingSearchSpy.mockClear()
  closeDrawerSpy.mockClear()
  resetSettingsState()
  mockAddTag.mockClear()
  mockAddTag.mockReturnValue(true)
  mockRemoveTag.mockClear()
  mockAddMyTag.mockClear()
  mockAddMyTag.mockReturnValue(true)
  mockRemoveMyTag.mockClear()
  mockCheckFavourite.mockReset()
  mockCheckFavourite.mockResolvedValue({ isFavourited: false })
  mockAddToFavourites.mockReset()
  mockAddToFavourites.mockResolvedValue({ success: true })
  mockRemoveFromFavourites.mockReset()
  mockRemoveFromFavourites.mockResolvedValue({ success: true })
  mockIsAuthError.mockReset()
  mockIsAuthError.mockReturnValue(false)
  vi.mocked(sourceSupportsFavourites).mockImplementation(
    (source: string) => ['hcomic', 'moeimg', 'jm', 'bika', 'nh'].includes(source),
  )
  // 重置来源能力 mock 为默认（支持推荐），防止上一用例 mockReturnValue(false) 泄漏
  vi.mocked(sourceSupportsTagRecommendation).mockReturnValue(true)
  vi.mocked(sourceNeedsDetailEnrich).mockReturnValue(false)
})

afterEach(() => {
  store.setState({
    drawerComic: null,
    isOpen: false,
    pendingSearch: null,
  })
})

// --- Tests ----------------------------------------------------------------

// 等待异步 effect（mock 的 IPC hook resolve 触发的 state 更新）沉淀，避免 act() 警告
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('ComicInfoDrawer - 点击 tag 加入搜索', () => {
  beforeEach(async () => {
    openDrawerWith(comicWithTags)
    await settle()
  })

  it('点击标签调用 setPendingSearch(tag, "tag", true)，不关闭抽屉', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('NTR'))

    expect(setPendingSearchSpy).toHaveBeenCalledWith('NTR', 'tag', true)
    expect(closeDrawerSpy).not.toHaveBeenCalled()
  })

  it('点击标签后显示「已加入搜索」Toast 提示', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('NTR'))

    expect(screen.getByText('已加入搜索：NTR')).toBeInTheDocument()
  })

  it('连续点击多个标签都追加搜索且抽屉保持打开', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('NTR'))
    await user.click(screen.getByText('魔法少女'))

    expect(setPendingSearchSpy).toHaveBeenCalledTimes(2)
    expect(setPendingSearchSpy).toHaveBeenNthCalledWith(1, 'NTR', 'tag', true)
    expect(setPendingSearchSpy).toHaveBeenNthCalledWith(2, '魔法少女', 'tag', true)
    expect(screen.getByText('已加入搜索：魔法少女')).toBeInTheDocument()
    expect(closeDrawerSpy).not.toHaveBeenCalled()
  })

  it('点击「原著」走 handleSearch（替换模式 + 关闭抽屉）', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('原作X'))

    expect(setPendingSearchSpy).toHaveBeenCalledWith('原作X', 'tag', false)
    expect(closeDrawerSpy).toHaveBeenCalledTimes(1)
  })

  it('点击「角色」走 handleSearch（替换模式 + 关闭抽屉）', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('角色Y'))

    expect(setPendingSearchSpy).toHaveBeenCalledWith('角色Y', 'tag', false)
    expect(closeDrawerSpy).toHaveBeenCalledTimes(1)
  })

  it('点击「作者」走 handleSearch author 模式 + 关闭抽屉', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('作者A'))

    expect(setPendingSearchSpy).toHaveBeenCalledWith('作者A', 'author', false)
    expect(closeDrawerSpy).toHaveBeenCalledTimes(1)
  })
})

describe('ComicInfoDrawer - 元数据信息渲染', () => {
  it('显示 Category 并可点击触发 category 搜索', async () => {
    openDrawerWith({
      ...comicWithTags,
      category: 'artist cg',
      publishDate: '2026-06-01',
      language: 'chinese',
    })
    await settle()

    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    // Category 文案渲染为可点击按钮
    const categoryBtn = screen.getByText('artist cg')
    await user.click(categoryBtn)

    expect(setPendingSearchSpy).toHaveBeenCalledWith('artist cg', 'category', false)
    expect(closeDrawerSpy).toHaveBeenCalledTimes(1)
  })

  it('信息行显示更新时间与语言', async () => {
    openDrawerWith({
      ...comicWithTags,
      publishDate: '2026-06-01',
      language: 'chinese',
    })
    await settle()

    render(<ComicInfoDrawer />)
    await settle()

    expect(screen.getByText(/更新 2026-06-01/)).toBeInTheDocument()
    expect(screen.getByText(/chinese/)).toBeInTheDocument()
  })

  it('元数据缺失时不渲染对应空标签', async () => {
    // comicWithTags 无 category/publishDate/language
    openDrawerWith(comicWithTags)
    await settle()

    render(<ComicInfoDrawer />)
    await settle()

    expect(screen.queryByText(/更新/)).not.toBeInTheDocument()
    // category 文案不渲染
    expect(screen.queryByText('artist cg')).not.toBeInTheDocument()
  })
})

describe('ComicInfoDrawer - 收藏状态提交', () => {
  const nhComic: ComicInfo = {
    ...comicWithTags,
    id: 'nh-12345',
    source: 'NH',
    sourceSite: 'nh',
  }

  async function renderNhDrawer(initiallyFavourited = false) {
    mockCheckFavourite.mockResolvedValueOnce({ isFavourited: initiallyFavourited })
    openDrawerWith(nhComic)
    render(<ComicInfoDrawer />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: initiallyFavourited ? '已加入收藏' : '加入收藏' })).toBeEnabled()
    })
  }

  it('NH 加入收藏真实成功后才提交已收藏状态', async () => {
    const user = userEvent.setup()
    await renderNhDrawer()

    await user.click(screen.getByRole('button', { name: '加入收藏' }))

    expect(mockAddToFavourites).toHaveBeenCalledWith('nh-12345', 'nh')
    expect(await screen.findByRole('button', { name: '已加入收藏' })).toBeEnabled()
    expect(screen.getByText('已加入收藏夹')).toBeInTheDocument()
  })

  it('NH 加入收藏返回 false 时保留未收藏状态并提示失败', async () => {
    mockAddToFavourites.mockResolvedValueOnce({ success: false })
    const user = userEvent.setup()
    await renderNhDrawer()

    await user.click(screen.getByRole('button', { name: '加入收藏' }))

    expect(await screen.findByRole('button', { name: '加入收藏' })).toBeEnabled()
    expect(screen.getByText('加入收藏夹失败')).toBeInTheDocument()
  })

  it('NH 移除收藏返回 false 时恢复已收藏状态并提示失败', async () => {
    mockRemoveFromFavourites.mockResolvedValueOnce({ success: false })
    const user = userEvent.setup()
    await renderNhDrawer(true)

    await user.click(screen.getByRole('button', { name: '已加入收藏' }))

    expect(mockRemoveFromFavourites).toHaveBeenCalledWith('nh-12345', 'nh')
    expect(await screen.findByRole('button', { name: '已加入收藏' })).toBeEnabled()
    expect(screen.getByText('移除收藏失败')).toBeInTheDocument()
  })

  it('NH 收藏认证失效时恢复原状态并提示登录', async () => {
    const authError = new Error('NH 认证已失效')
    mockAddToFavourites.mockRejectedValueOnce(authError)
    mockIsAuthError.mockImplementationOnce(error => error === authError)
    const user = userEvent.setup()
    await renderNhDrawer()

    await user.click(screen.getByRole('button', { name: '加入收藏' }))

    expect(await screen.findByRole('button', { name: '加入收藏' })).toBeEnabled()
    expect(screen.getByText('请先登录后再操作')).toBeInTheDocument()
  })

  it.each(['hcomic', 'moeimg', 'jm', 'bika'])('%s 收藏成功行为保持不变', async (source) => {
    const user = userEvent.setup()
    openDrawerWith({ ...comicWithTags, id: `${source}-1`, source, sourceSite: source })
    render(<ComicInfoDrawer />)
    await waitFor(() => expect(screen.getByRole('button', { name: '加入收藏' })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: '加入收藏' }))

    expect(mockAddToFavourites).toHaveBeenCalledWith(`${source}-1`, source)
    expect(await screen.findByRole('button', { name: '已加入收藏' })).toBeEnabled()
  })
})

describe('ComicInfoDrawer - tag enrich 失败兜底', () => {
  // 模拟 JM 收藏夹条目：sourceSite='jm'、列表项无 tags（JM 收藏夹 HTML 不含 tag 字段）。
  const jmComicNoTags: ComicInfo = {
    id: 'jm-1',
    title: 'JM 测试漫画',
    url: 'https://example.com/album/jm-1',
    coverUrl: 'https://example.com/cover.jpg',
    source: 'JM',
    sourceSite: 'jm',
    author: '作者J',
    tags: [],
  }

  const mockedNeedsEnrich = vi.mocked(sourceNeedsDetailEnrich)

  beforeEach(() => {
    // 现有用例（hcomic+有tags）依赖默认 false；此处仅在本 describe 内覆盖为 true。
    mockedNeedsEnrich.mockReturnValue(true)
    // 隔离：重置 getComicDetail mock，每个用例自行 mockResolvedValueOnce
    mockGetComicDetail.mockReset()
  })

  afterEach(() => {
    // 恢复默认，避免影响其它 describe
    mockedNeedsEnrich.mockReturnValue(false)
    mockGetComicDetail.mockResolvedValue({ comic: null })
  })

  it('JM 列表项无 tags 且 enrich 失败（comic=null）时显示重试 UI', async () => {
    mockGetComicDetail.mockResolvedValueOnce({ comic: null })
    openDrawerWith(jmComicNoTags)
    await settle()

    render(<ComicInfoDrawer />)
    await settle()

    expect(screen.getByText('标签加载失败')).toBeInTheDocument()
    expect(screen.getByText('重试')).toBeInTheDocument()
  })

  it('首次 enrich 请求未完成时只显示加载提示，不误报失败', async () => {
    const detailRequest = deferred<{ comic: ComicInfo | null }>()
    mockGetComicDetail.mockReturnValueOnce(detailRequest.promise)
    openDrawerWith(jmComicNoTags)

    render(<ComicInfoDrawer />)

    expect(await screen.findByText('标签加载中...')).toBeInTheDocument()
    expect(screen.queryByText('标签加载失败')).not.toBeInTheDocument()
    expect(screen.queryByText('重试')).not.toBeInTheDocument()

    await act(async () => {
      detailRequest.resolve({ comic: null })
      await detailRequest.promise
    })

    expect(await screen.findByText('标签加载失败')).toBeInTheDocument()
    expect(screen.getByText('重试')).toBeInTheDocument()
  })

  it('点击重试后 enrich 成功则失败 UI 消失、标签渲染', async () => {
    const user = userEvent.setup()
    // 第一次 enrich（effect 初次触发）：返回 null → 失败 UI
    mockGetComicDetail.mockResolvedValueOnce({ comic: null })
    openDrawerWith(jmComicNoTags)
    await settle()

    render(<ComicInfoDrawer />)
    await settle()

    expect(screen.getByText('标签加载失败')).toBeInTheDocument()

    // 第二次 enrich（点重试触发）：先保持 pending，验证 loading UI，再返回带 tags 的 comic
    const retryRequest = deferred<{ comic: ComicInfo | null }>()
    mockGetComicDetail.mockReturnValueOnce(retryRequest.promise)

    await user.click(screen.getByText('重试'))

    expect(await screen.findByText('标签加载中...')).toBeInTheDocument()
    expect(screen.queryByText('标签加载失败')).not.toBeInTheDocument()
    expect(screen.queryByText('重试')).not.toBeInTheDocument()

    await act(async () => {
      retryRequest.resolve({ comic: { ...jmComicNoTags, tags: ['百合', '全彩'] } })
      await retryRequest.promise
    })

    await waitFor(() => expect(screen.getByText('百合')).toBeInTheDocument())
    expect(screen.queryByText('标签加载失败')).not.toBeInTheDocument()
    expect(screen.getByText('全彩')).toBeInTheDocument()
  })

  it('enrich 成功时不显示失败 UI', async () => {
    mockGetComicDetail.mockResolvedValueOnce({
      comic: { ...jmComicNoTags, tags: ['成功标签'] },
    })
    openDrawerWith(jmComicNoTags)
    await settle()

    render(<ComicInfoDrawer />)
    await settle()

    expect(screen.queryByText('标签加载失败')).not.toBeInTheDocument()
    expect(screen.getByText('成功标签')).toBeInTheDocument()
  })
})

describe('ComicInfoDrawer - 标签操作弹窗（推荐/屏蔽四态）', () => {
  beforeEach(async () => {
    openDrawerWith(comicWithTags)
    await settle()
  })

  // 触发小按钮点击：tag chip 的小按钮在 group-hover 时显示，测试用 title 定位。
  // 多个 tag chip 可能有相同 title，取第一个（对应 comicWithTags 的 'NTR'）。
  const clickTagActionButton = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
    const btn = screen.getAllByTitle(title)[0]
    await user.click(btn)
  }

  it('未设置标签：点击小按钮弹出「加入推荐 / 屏蔽」两个选项', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await clickTagActionButton(user, '加入推荐 / 屏蔽')

    expect(screen.getByText('★ 加入推荐标签')).toBeInTheDocument()
    expect(screen.getByText('× 加入屏蔽标签')).toBeInTheDocument()
  })

  it('未设置标签：点击「加入推荐标签」调用 addMyTag', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await clickTagActionButton(user, '加入推荐 / 屏蔽')
    await user.click(screen.getByText('★ 加入推荐标签'))

    expect(mockAddMyTag).toHaveBeenCalledWith('hcomic', 'NTR')
  })

  it('未设置标签：点击「加入屏蔽标签」调用 addTag', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await clickTagActionButton(user, '加入推荐 / 屏蔽')
    await user.click(screen.getByText('× 加入屏蔽标签'))

    expect(mockAddTag).toHaveBeenCalledWith('hcomic', 'NTR')
  })

  it('已推荐标签：小按钮显示 ★，点击弹出「取消推荐」', async () => {
    settingsState.myTags = { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [] }
    settingsState.favouriteTagHighlight = true
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await clickTagActionButton(user, '取消推荐')

    expect(screen.getByText(/该标签已是推荐标签/)).toBeInTheDocument()
    await user.click(screen.getByText('取消推荐'))
    expect(mockRemoveMyTag).toHaveBeenCalledWith('hcomic', 'NTR')
  })

  it('已屏蔽标签：小按钮显示 ✓，点击弹出「取消屏蔽」', async () => {
    settingsState.tagBlacklist = { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [] }
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await clickTagActionButton(user, '取消屏蔽')

    expect(screen.getByText(/该标签已被屏蔽/)).toBeInTheDocument()
    await user.click(screen.getByText('取消屏蔽'))
    expect(mockRemoveTag).toHaveBeenCalledWith('hcomic', 'NTR')
  })

  it('加入推荐时与黑名单互斥冲突：addMyTag 返回 false 显示提示', async () => {
    mockAddMyTag.mockReturnValue(false)
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await clickTagActionButton(user, '加入推荐 / 屏蔽')
    await user.click(screen.getByText('★ 加入推荐标签'))

    expect(mockAddMyTag).toHaveBeenCalledWith('hcomic', 'NTR')
    expect(screen.getByText(/已被屏蔽，请先取消屏蔽/)).toBeInTheDocument()
  })

  it('加入屏蔽时与推荐互斥冲突：addTag 返回 false 显示提示', async () => {
    mockAddTag.mockReturnValue(false)
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await clickTagActionButton(user, '加入推荐 / 屏蔽')
    await user.click(screen.getByText('× 加入屏蔽标签'))

    expect(mockAddTag).toHaveBeenCalledWith('hcomic', 'NTR')
    expect(screen.getByText(/已是推荐标签，请先取消推荐/)).toBeInTheDocument()
  })

  // --- P1 回归：不支持推荐的来源（NH）禁止出现推荐入口 ---

  it('NH 来源未设置标签：小按钮标题为「加入屏蔽」，弹窗无推荐选项', async () => {
    // NH 真实 supportsTagRecommendation === false，模拟该来源能力
    vi.mocked(sourceSupportsTagRecommendation).mockReturnValue(false)
    const user = userEvent.setup()
    openDrawerWith({ ...comicWithTags, sourceSite: 'nh' })
    await settle()
    render(<ComicInfoDrawer />)
    await settle()

    // 小按钮退化为「加入屏蔽」（无「加入推荐 / 屏蔽」双选项标题）
    await clickTagActionButton(user, '加入屏蔽')

    // 弹窗为单操作「加入屏蔽」确认，禁止出现推荐相关文案
    expect(screen.getByText(/将屏蔽标签/)).toBeInTheDocument()
    expect(screen.queryByText('★ 加入推荐标签')).not.toBeInTheDocument()
    expect(screen.getByText('加入屏蔽')).toBeInTheDocument()

    // 确认后调用 addTag（屏蔽），禁止调用 addMyTag（推荐假成功写入）
    await user.click(screen.getByText('加入屏蔽'))
    expect(mockAddTag).toHaveBeenCalledWith('nh', 'NTR')
    expect(mockAddMyTag).not.toHaveBeenCalled()
  })

  it('NH 来源未设置标签：禁止出现「加入推荐」文案或调用 addMyTag', async () => {
    vi.mocked(sourceSupportsTagRecommendation).mockReturnValue(false)
    const user = userEvent.setup()
    openDrawerWith({ ...comicWithTags, sourceSite: 'nh' })
    await settle()
    render(<ComicInfoDrawer />)
    await settle()

    await clickTagActionButton(user, '加入屏蔽')

    // 关键不变量：整个交互路径不得触发推荐写入
    expect(mockAddMyTag).not.toHaveBeenCalled()
    // 取消关闭弹窗，确保无残留推荐入口
    await user.click(screen.getByText('取消'))
  })

  it('支持推荐的来源（hcomic）推荐入口行为不变，防门控误伤', async () => {
    // hcomic 真实 supportsTagRecommendation === true（mock 默认即 true）
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await clickTagActionButton(user, '加入推荐 / 屏蔽')

    // 推荐选项照常可用
    expect(screen.getByText('★ 加入推荐标签')).toBeInTheDocument()
    expect(screen.getByText('× 加入屏蔽标签')).toBeInTheDocument()
    await user.click(screen.getByText('★ 加入推荐标签'))
    expect(mockAddMyTag).toHaveBeenCalledWith('hcomic', 'NTR')
  })
})
