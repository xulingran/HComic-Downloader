import { describe, it, expect, beforeEach } from 'vitest'
import { useSidebarStore } from '@/stores/useSidebarStore'

describe('useSidebarStore', () => {
  beforeEach(() => {
    // 重置为默认收起态，隔离用例间状态
    useSidebarStore.setState({ isOpen: false })
  })

  it('默认应为收起态 (isOpen=false)', () => {
    expect(useSidebarStore.getState().isOpen).toBe(false)
  })

  it('open() 应将 isOpen 置为 true', () => {
    useSidebarStore.getState().open()
    expect(useSidebarStore.getState().isOpen).toBe(true)
  })

  it('close() 应将 isOpen 置为 false', () => {
    useSidebarStore.getState().open()
    useSidebarStore.getState().close()
    expect(useSidebarStore.getState().isOpen).toBe(false)
  })

  it('toggle() 应在收起/展开两态间翻转', () => {
    expect(useSidebarStore.getState().isOpen).toBe(false)

    useSidebarStore.getState().toggle()
    expect(useSidebarStore.getState().isOpen).toBe(true)

    useSidebarStore.getState().toggle()
    expect(useSidebarStore.getState().isOpen).toBe(false)
  })
})
