import { useToastStore } from '../stores/useToastStore'

/**
 * 将文本写入剪贴板。
 *
 * 走主进程 IPC（Electron clipboard.writeText），绕开渲染进程 navigator.clipboard
 * 对文档焦点的依赖——window.confirm 关闭后焦点可能未及时恢复，会抛 "Document is not focused"。
 * 主进程路径无焦点要求，复制始终可用，也无需依赖已废弃的 execCommand。
 */
async function copyText(text: string): Promise<void> {
  await window.hcomic!.writeClipboard(text)
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
