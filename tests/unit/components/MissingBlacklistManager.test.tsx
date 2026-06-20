import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MissingBlacklistManager } from '@/components/tools/MissingBlacklistManager'
import type { MissingBlacklist } from '@shared/types'

let storeState: {
  missingBlacklist: MissingBlacklist
  removeMissingIgnore: ReturnType<typeof vi.fn>
  confirmMissingMemberCount: ReturnType<typeof vi.fn>
}

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}))

const emptyFpMap = new Map<string, number>()

describe('MissingBlacklistManager', () => {
  beforeEach(() => {
    storeState = {
      missingBlacklist: { hcomic: [], moeimg: [], jmcomic: [], bika: [], copymanga: [] },
      removeMissingIgnore: vi.fn(),
      confirmMissingMemberCount: vi.fn(),
    }
  })

  it('renders panel title', () => {
    render(<MissingBlacklistManager fingerprintToSize={emptyFpMap} onClose={vi.fn()} />)
    expect(screen.getByText('已忽略的同系列组')).toBeInTheDocument()
  })

  it('shows empty state when no entries for active source', () => {
    render(<MissingBlacklistManager fingerprintToSize={emptyFpMap} onClose={vi.fn()} />)
    expect(screen.getByText('暂无已忽略的同系列组')).toBeInTheDocument()
  })

  it('lists fingerprints for default source', () => {
    storeState.missingBlacklist = {
      ...storeState.missingBlacklist,
      hcomic: [
        { fingerprint: '魔法少女物语', memberCount: 2 },
        { fingerprint: '异世界冒险记', memberCount: 3 },
      ],
    }
    render(<MissingBlacklistManager defaultSource="hcomic" fingerprintToSize={emptyFpMap} onClose={vi.fn()} />)
    expect(screen.getByText('魔法少女物语')).toBeInTheDocument()
    expect(screen.getByText('异世界冒险记')).toBeInTheDocument()
  })

  it('switches source via tabs', async () => {
    storeState.missingBlacklist = {
      ...storeState.missingBlacklist,
      hcomic: [{ fingerprint: 'hcomic条目', memberCount: 1 }],
      jmcomic: [{ fingerprint: 'jmcomic条目', memberCount: 1 }],
    }
    render(<MissingBlacklistManager defaultSource="hcomic" fingerprintToSize={emptyFpMap} onClose={vi.fn()} />)
    expect(screen.getByText('hcomic条目')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /jmcomic/i }))
    expect(screen.getByText('jmcomic条目')).toBeInTheDocument()
    expect(screen.queryByText('hcomic条目')).not.toBeInTheDocument()
  })

  it('calls removeMissingIgnore when ✕ clicked', async () => {
    storeState.missingBlacklist = {
      ...storeState.missingBlacklist,
      hcomic: [{ fingerprint: '魔法少女物语', memberCount: 2 }],
    }
    render(<MissingBlacklistManager defaultSource="hcomic" fingerprintToSize={emptyFpMap} onClose={vi.fn()} />)
    const removeBtn = screen.getByTitle('取消忽略')
    await userEvent.click(removeBtn)
    expect(storeState.removeMissingIgnore).toHaveBeenCalledWith('hcomic', '魔法少女物语')
  })

  it('closes when backdrop clicked', async () => {
    const onClose = vi.fn()
    const { container } = render(<MissingBlacklistManager fingerprintToSize={emptyFpMap} onClose={onClose} />)
    await userEvent.click(container.firstChild as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when panel content clicked', async () => {
    const onClose = vi.fn()
    render(<MissingBlacklistManager fingerprintToSize={emptyFpMap} onClose={onClose} />)
    await userEvent.click(screen.getByText('已忽略的同系列组'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows count badge on source tab', () => {
    storeState.missingBlacklist = {
      ...storeState.missingBlacklist,
      hcomic: [
        { fingerprint: 'a', memberCount: 1 },
        { fingerprint: 'b', memberCount: 1 },
        { fingerprint: 'c', memberCount: 1 },
      ],
    }
    render(<MissingBlacklistManager defaultSource="hcomic" fingerprintToSize={emptyFpMap} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /HComic/i })).toHaveTextContent('(3)')
  })

  it('marks changed entries and shows confirm button', () => {
    // 基线 memberCount=2，当前检测到 3 → 变动
    const fpMap = new Map([['魔法少女物语', 3]])
    storeState.missingBlacklist = {
      ...storeState.missingBlacklist,
      hcomic: [{ fingerprint: '魔法少女物语', memberCount: 2 }],
    }
    render(<MissingBlacklistManager defaultSource="hcomic" fingerprintToSize={fpMap} onClose={vi.fn()} />)
    expect(screen.getByText(/成员数变化：2 → 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument()
  })

  it('does not show confirm button for unchanged entries', () => {
    const fpMap = new Map([['魔法少女物语', 2]])
    storeState.missingBlacklist = {
      ...storeState.missingBlacklist,
      hcomic: [{ fingerprint: '魔法少女物语', memberCount: 2 }],
    }
    render(<MissingBlacklistManager defaultSource="hcomic" fingerprintToSize={fpMap} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '确认' })).not.toBeInTheDocument()
  })

  it('does not show confirm for null memberCount (baseline not established)', () => {
    const fpMap = new Map([['魔法少女物语', 3]])
    storeState.missingBlacklist = {
      ...storeState.missingBlacklist,
      hcomic: [{ fingerprint: '魔法少女物语', memberCount: null }],
    }
    render(<MissingBlacklistManager defaultSource="hcomic" fingerprintToSize={fpMap} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '确认' })).not.toBeInTheDocument()
    expect(screen.getByText(/基线未建立/)).toBeInTheDocument()
  })

  it('calls confirmMissingMemberCount when confirm clicked', async () => {
    const fpMap = new Map([['魔法少女物语', 3]])
    storeState.missingBlacklist = {
      ...storeState.missingBlacklist,
      hcomic: [{ fingerprint: '魔法少女物语', memberCount: 2 }],
    }
    render(<MissingBlacklistManager defaultSource="hcomic" fingerprintToSize={fpMap} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(storeState.confirmMissingMemberCount).toHaveBeenCalledWith('hcomic', '魔法少女物语', 3)
  })
})
