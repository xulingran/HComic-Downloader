import { IPC_ERROR_CODES } from '@shared/types'

/** 需要预验证认证状态的来源（扩展时在此添加，如 'bika'） */
export const AUTH_REQUIRED_SOURCES = new Set(['jmcomic'])

/** 判断来源是否需要预验证认证 */
export function requiresAuth(source: string): boolean {
  return AUTH_REQUIRED_SOURCES.has(source)
}

/** 判断 IPC 错误是否为认证失败（支持结构化错误码和字符串匹配兜底） */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (err as Record<string, unknown>)?.code === IPC_ERROR_CODES.AUTH_REQUIRED
    || msg.includes('AUTH_REQUIRED')
    || msg.includes('401')
    || msg.includes('403')
}
