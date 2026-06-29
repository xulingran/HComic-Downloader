import { describe, it, expect, beforeEach } from 'vitest'
import { useFatalErrorStore } from '@/stores/useFatalErrorStore'
import type { FatalErrorEvent } from '@shared/types'

const mockError: FatalErrorEvent = {
  message: '后端服务启动失败',
  detail: 'spawn error',
  kind: 'backend-spawn',
}

describe('useFatalErrorStore', () => {
  beforeEach(() => {
    useFatalErrorStore.setState({ error: null })
  })

  it('应有正确的初始状态（无错误）', () => {
    expect(useFatalErrorStore.getState().error).toBeNull()
  })

  it('clear 应清除致命错误', () => {
    useFatalErrorStore.getState().setError(mockError)
    useFatalErrorStore.getState().clear()
    expect(useFatalErrorStore.getState().error).toBeNull()
  })

  it('应支持无 detail/kind 的最小错误', () => {
    useFatalErrorStore.getState().setError({ message: '简单错误' })
    const error = useFatalErrorStore.getState().error
    expect(error?.message).toBe('简单错误')
    expect(error?.detail).toBeUndefined()
    expect(error?.kind).toBeUndefined()
  })
})
