import { IPC_ERROR_CODES } from '@shared/types'
import { sourceRequiresAuth } from './source'

/** 判断来源是否需要预验证认证 */
export function requiresAuth(source: string): boolean {
  return sourceRequiresAuth(source)
}

/** 判断 IPC 错误是否为认证失败（支持结构化错误码和字符串匹配兜底） */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (err as Record<string, unknown>)?.code === IPC_ERROR_CODES.AUTH_REQUIRED
    || msg.includes('AUTH_REQUIRED')
    || msg.includes('401')
    || msg.includes('403')
}
