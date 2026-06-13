import { useToastStore } from '../stores/useToastStore'

/**
 * 将文本写入剪贴板。
 *
 * 优先用 Clipboard API；失败时（常见于 Electron 中 window.confirm 关闭后
 * 文档未及时恢复焦点，抛 "Document is not focused"）降级到隐藏 textarea +
 * execCommand('copy') 兜底，确保复制始终可用。
 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // 降级：execCommand 路径不依赖文档焦点
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  // 移出视口避免触发滚动，但仍需在 DOM 中以获得选中能力
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (!ok) throw new Error('execCommand copy returned false')
  } catch (e) {
    document.body.removeChild(textarea)
    throw e
  }
}

/**
 * 复制诊断日志到剪贴板。
 *
 * 复制前提示用户日志可能含 cookie/搜索词等敏感信息。
 * 复制成功/失败通过 Toast 反馈。供 FatalBanner 与 SettingsPage 复用。
 */
export async function copyDiagnosticsWithConfirm(): Promise<void> {
  // 敏感信息确认：日志可能包含 cookie、搜索词等隐私内容
  const confirmed = window.confirm(
    '诊断日志可能包含 cookie、搜索词等敏感信息。\n确认要复制到剪贴板吗？',
  )
  if (!confirmed) {
    return
  }

  const toast = useToastStore.getState()
  try {
    const report = await window.hcomic!.getDiagnostics()
    await copyText(report)
    toast.success('诊断日志已复制到剪贴板')
  } catch (e) {
    toast.error('复制诊断日志失败')
    console.error('[diagnostics] copyDiagnostics failed:', e)
  }
}
