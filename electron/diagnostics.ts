import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { getLogDir } from './log-init'

/** 诊断报告中每个日志文件读取的尾部行数（无会话标记或会话过长时的上限） */
const TAIL_LINES = 200

/**
 * 读取本次会话的日志。文件不存在或读取失败时返回降级占位文本。
 *
 * 优先从最后一个 sessionMarker 行开始截取（即本次启动后的全部日志），
 * 避免把多次启动累积的历史报错带进诊断报告。若找不到标记则回退到尾部 TAIL_LINES 行；
 * 若会话内容超过 TAIL_LINES 行则只取尾部（防止报告过大）。
 *
 * @param filePath 日志文件路径
 * @param sessionMarker 会话起始标记子串（main.log 用 '[log-init]'，python.log 用 '[session-start]'）
 * @param excludeMarker 需过滤的行子串（main.log 传 '[Python]' 以排除 stderr 转发副本，
 *                      因这些内容已在 python.log 段独立呈现，避免诊断报告重复）
 */
function readSession(filePath: string, sessionMarker: string, excludeMarker?: string): string {
  try {
    if (!fs.existsSync(filePath)) {
      return '(日志文件不存在)'
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    const allLines = content.split('\n')
    // 末尾若为空行（文件以 \n 结尾）则剔除
    const trimmed = allLines[allLines.length - 1] === '' ? allLines.slice(0, -1) : allLines

    // 查找最后一个会话标记行
    let startIdx = 0
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i].includes(sessionMarker)) {
        startIdx = i
        break
      }
    }

    let session = trimmed.slice(startIdx)
    // 排除转发副本行（main.log 中的 [Python] 行与 python.log 重复）
    if (excludeMarker) {
      session = session.filter((line) => !line.includes(excludeMarker))
    }
    // 会话过长时仍取尾部，控制报告体积
    const tail = session.length > TAIL_LINES ? session.slice(-TAIL_LINES) : session
    return tail.join('\n') || '(日志为空)'
  } catch (e) {
    return `(读取失败: ${e instanceof Error ? e.message : String(e)})`
  }
}

/**
 * 构建结构化诊断报告字符串。
 *
 * 报告结构：
 *   ## 环境  — 应用版本、平台、Electron 版本、生成时间
 *   ## 主进程日志 — main.log 尾部 200 行
 *   ## Python 后端日志 — python.log 尾部 200 行
 *
 * 任何日志文件缺失或读取失败均降级为占位文本，不阻断整体报告生成。
 * 注意：日志可能含 cookie/搜索词等敏感信息，由调用方负责提示用户。
 */
export function buildDiagnostics(): string {
  const logDir = getLogDir()
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

  const envSection = [
    '## 环境',
    `- 版本: ${app.getVersion()}`,
    `- 平台: ${process.platform} ${process.arch}`,
    `- Electron: ${process.versions.electron}`,
    `- Node: ${process.versions.node}`,
    `- 时间: ${now}`,
  ].join('\n')

  // main.log 排除 [Python] 转发行（与 python.log 重复），只保留纯 Electron 日志
  const mainLog = readSession(path.join(logDir, 'main.log'), '[log-init]', '[Python]')
  const pythonLog = readSession(path.join(logDir, 'python.log'), '[session-start]')

  return [
    'HComic Downloader 诊断报告',
    '═══════════════════════════════════════',
    envSection,
    '',
    '## 主进程日志（本次会话）',
    mainLog,
    '',
    '## Python 后端日志（本次会话）',
    pythonLog,
    '═══════════════════════════════════════',
  ].join('\n')
}
