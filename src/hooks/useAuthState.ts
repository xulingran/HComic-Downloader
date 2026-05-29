import { useState, useCallback } from 'react'
import { useAuth } from './useIpc'

type AuthStatus = 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'

export function useAuthState(source: string) {
  const [status, setStatus] = useState<AuthStatus>('idle')
  const [message, setMessage] = useState('')
  const { applyAuth, verifyAuth } = useAuth()

  const apply = useCallback(async (curlText: string) => {
    if (!curlText.trim()) return
    setStatus('verifying')
    setMessage('')
    try {
      await applyAuth(curlText.trim(), source)
      const verifyResult = await verifyAuth(source)
      setStatus(verifyResult.valid ? 'valid' : 'invalid')
      setMessage(verifyResult.message || '')
    } catch (err: unknown) {
      setStatus('error')
      setMessage((err instanceof Error ? err.message : String(err)) || '操作失败')
    }
  }, [applyAuth, verifyAuth, source])

  const test = useCallback(async () => {
    setStatus('verifying')
    setMessage('')
    try {
      const verifyResult = await verifyAuth(source)
      setStatus(verifyResult.valid ? 'valid' : 'invalid')
      setMessage(verifyResult.message || '')
    } catch (err: unknown) {
      setStatus('error')
      setMessage((err instanceof Error ? err.message : String(err)) || '验证失败')
    }
  }, [verifyAuth, source])

  const openWindow = useCallback(async (prevStatus: AuthStatus) => {
    setStatus('verifying')
    setMessage('')
    try {
      const result = await window.hcomic?.openLoginWindow(source)
      if (!result) {
        setStatus(prevStatus)
        return
      }
      if (result.success) {
        setStatus('valid')
        setMessage(result.message || '登录成功')
      } else {
        if (result.message === '已取消') {
          setStatus(prevStatus)
        } else {
          setStatus('error')
          setMessage(result.message || '登录失败')
        }
      }
    } catch (err: unknown) {
      setStatus('error')
      setMessage((err instanceof Error ? err.message : '') || '登录失败')
    }
  }, [source])

  const verifyFromConfig = useCallback(async (hasAuth: boolean) => {
    if (!hasAuth) return
    setStatus('verifying')
    try {
      const verifyResult = await verifyAuth(source)
      setStatus(verifyResult.valid ? 'valid' : 'invalid')
      setMessage(verifyResult.message || '')
    } catch {
      setStatus('idle')
    }
  }, [verifyAuth, source])

  return { status, message, apply, test, openWindow, verifyFromConfig, setStatus, setMessage }
}
