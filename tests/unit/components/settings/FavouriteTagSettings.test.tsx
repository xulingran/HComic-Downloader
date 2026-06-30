import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// 可变 store mock：测试修改 settingsState 来模拟不同标签状态
const mockAddMyTag = vi.fn(() => true)
const mockRemoveMyTag = vi.fn()
const mockSetFavouriteTagHighlight = vi.fn()
const mockSetFavouriteTagMinMatches = vi.fn()
let settingsState: Record<string, unknown> = {}
const resetSettingsState = () => {
  settingsState = {
    favouriteTagHighlight: true,
    favouriteTagMinMatches: 1,
    myTags: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [] },
    tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [] },
    addMyTag: mockAddMyTag,
    removeMyTag: mockRemoveMyTag,
    setFavouriteTagHighlight: mockSetFavouriteTagHighlight,
    setFavouriteTagMinMatches: mockSetFavouriteTagMinMatches,
  }
}
resetSettingsState()

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: () => settingsState,
}))

const mockGetFavouriteTags = vi.fn().mockResolvedValue({ tags: [] })
const mockSyncFavouriteTags = vi.fn().mockResolvedValue({ tags: [], totalComics: 0 })
vi.mock('@/hooks/useIpc', () => ({
  useFavouriteTags: () => ({
    getFavouriteTags: mockGetFavouriteTags,
    syncFavouriteTags: mockSyncFavouriteTags,
    clearFavouriteTags: vi.fn(),
    removeFavouriteTag: vi.fn(),
  }),
}))

import { FavouriteTagSettings } from '@/components/settings/FavouriteTagSettings'

describe('FavouriteTagSettings - 推荐标签 / 检测标签双区', () => {
  beforeEach(() => {
    resetSettingsState()
    mockAddMyTag.mockClear()
    mockAddMyTag.mockReturnValue(true)
    mockRemoveMyTag.mockClear()
    mockGetFavouriteTags.mockClear()
    mockGetFavouriteTags.mockResolvedValue({ tags: [] })
    mockSyncFavouriteTags.mockClear()
  })

  it('检测标签为空时显示引导文案', async () => {
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(mockGetFavouriteTags).toHaveBeenCalled())

    expect(screen.getByText('请先同步收藏夹以生成检测标签')).toBeInTheDocument()
  })

  it('检测标签候选池展示高频标签带 count', async () => {
    mockGetFavouriteTags.mockResolvedValue({
      tags: [{ tag: 'NTR', count: 12 }, { tag: '校園', count: 8 }],
    })
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(screen.getByText(/NTR/)).toBeInTheDocument())

    expect(screen.getByText(/\(12\)/)).toBeInTheDocument()
    expect(screen.getByText(/\(8\)/)).toBeInTheDocument()
  })

  it('点击检测标签候选 chip 调用 addMyTag 加入推荐', async () => {
    const user = userEvent.setup()
    mockGetFavouriteTags.mockResolvedValue({
      tags: [{ tag: 'NTR', count: 12 }],
    })
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(screen.getByText(/NTR/)).toBeInTheDocument())

    await user.click(screen.getByText(/NTR/))

    expect(mockAddMyTag).toHaveBeenCalledWith('hcomic', 'NTR')
  })

  it('已推荐的检测标签 chip 显示打勾并置灰，点击移除', async () => {
    const user = userEvent.setup()
    settingsState.myTags = { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [] }
    mockGetFavouriteTags.mockResolvedValue({
      tags: [{ tag: 'NTR', count: 12 }],
    })
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(screen.getByText(/\(12\)/)).toBeInTheDocument())

    // 检测区的 chip 是 button 元素且含 count (12)；推荐区的 chip 是 span 不含 count
    const detectedChip = screen.getByText(/\(12\)/).closest('button')!
    expect(detectedChip.textContent).toContain('✓')
    await user.click(detectedChip)
    expect(mockRemoveMyTag).toHaveBeenCalledWith('hcomic', 'NTR')
  })

  it('已被屏蔽的检测标签 chip 置灰禁用，不可点击加入', async () => {
    settingsState.tagBlacklist = { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [] }
    mockGetFavouriteTags.mockResolvedValue({
      tags: [{ tag: 'NTR', count: 12 }],
    })
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(screen.getByText(/NTR/)).toBeInTheDocument())

    const chip = screen.getByText(/NTR/).closest('button')
    expect(chip?.disabled).toBe(true)
    expect(chip?.className).toContain('line-through')
  })

  it('手动输入框：输入合法标签回车调用 addMyTag', async () => {
    const user = userEvent.setup()
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(mockGetFavouriteTags).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('手动添加标签名（可添加 sync 未检测到的标签）')
    await user.type(input, '小众标签{Enter}')

    expect(mockAddMyTag).toHaveBeenCalledWith('hcomic', '小众标签')
  })

  it('手动输入空字符串显示错误提示', async () => {
    const user = userEvent.setup()
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(mockGetFavouriteTags).toHaveBeenCalled())

    await user.click(screen.getByText('添加'))

    expect(screen.getByText('标签不能为空')).toBeInTheDocument()
    expect(mockAddMyTag).not.toHaveBeenCalled()
  })

  it('手动输入与已推荐重复时显示去重提示', async () => {
    const user = userEvent.setup()
    settingsState.myTags = { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [] }
    mockAddMyTag.mockReturnValue(false) // 模拟 store 拒绝（重复）
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(mockGetFavouriteTags).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('手动添加标签名（可添加 sync 未检测到的标签）')
    await user.type(input, 'NTR')
    await user.click(screen.getByText('添加'))

    expect(screen.getByText('该标签已在推荐列表中')).toBeInTheDocument()
  })

  it('推荐标签区展示已收藏的 my_tags 带 ★ 和移除按钮', async () => {
    settingsState.myTags = { hcomic: ['触手', '人妻'], moeimg: [], jm: [], bika: [], copymanga: [] }
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(mockGetFavouriteTags).toHaveBeenCalled())

    expect(screen.getByText(/★ 触手/)).toBeInTheDocument()
    expect(screen.getByText(/★ 人妻/)).toBeInTheDocument()
    expect(screen.getByText('2 个')).toBeInTheDocument()
  })

  it('点击推荐标签的移除按钮调用 removeMyTag', async () => {
    const user = userEvent.setup()
    settingsState.myTags = { hcomic: ['触手'], moeimg: [], jm: [], bika: [], copymanga: [] }
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(mockGetFavouriteTags).toHaveBeenCalled())

    const removeBtn = screen.getByTitle('移除推荐')
    await user.click(removeBtn)

    expect(mockRemoveMyTag).toHaveBeenCalledWith('hcomic', '触手')
  })

  it('点击「从收藏夹同步」调用 syncFavouriteTags 并刷新检测标签', async () => {
    const user = userEvent.setup()
    mockSyncFavouriteTags.mockResolvedValue({
      tags: [{ tag: '同步标签', count: 5 }],
      totalComics: 10,
    })
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(mockGetFavouriteTags).toHaveBeenCalled())

    await user.click(screen.getByText('从收藏夹同步'))

    await waitFor(() => expect(mockSyncFavouriteTags).toHaveBeenCalledWith('hcomic'))
    await waitFor(() => expect(screen.getByText(/同步标签/)).toBeInTheDocument())
    expect(screen.getByText(/已同步 10 本漫画/)).toBeInTheDocument()
  })

  it('来源切换后重新加载对应来源的检测标签', async () => {
    const user = userEvent.setup()
    render(<FavouriteTagSettings />)
    await waitFor(() => expect(mockGetFavouriteTags).toHaveBeenCalledWith('hcomic'))

    const select = screen.getByDisplayValue('HComic')
    await user.selectOptions(select, 'jm')

    await waitFor(() => expect(mockGetFavouriteTags).toHaveBeenCalledWith('jm'))
  })
})
