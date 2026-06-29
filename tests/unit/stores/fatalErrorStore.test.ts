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

  // 已删除 'setError 应设置致命错误' 与 'setError 应覆盖旧错误（单例）'
  // （cleanup-test-quality-backlog Phase B）：两者均为纯 store CRUD 往返
  // （setError(e) → getState().error === e），useFatalErrorStore.setError 实现为单行
  // set({error: e})，验证 Zustand setState 框架基本保证，无项目代码信号。
  // 保留 clear 与最小错误用例——它们验证状态转换/可选字段传播的派生行为。

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
