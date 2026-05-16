import { useState, type RefObject } from 'react'

interface AuthSettingsProps {
  loginSectionRef: RefObject<HTMLDivElement>
  loginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  loginMessage: string
  onApplyAuth: (curlText: string) => Promise<void>
  onTestAuth: () => Promise<void>
}

export function AuthSettings({
  loginSectionRef,
  loginStatus,
  loginMessage,
  onApplyAuth,
  onTestAuth,
}: AuthSettingsProps) {
  const [curlText, setCurlText] = useState('')

  return (
    <div ref={loginSectionRef} className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
      <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
        登录
      </h3>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">HComic</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            loginStatus === 'valid' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
            loginStatus === 'invalid' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
            loginStatus === 'verifying' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
            loginStatus === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
            'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}>
            {loginStatus === 'valid' ? '有效' :
             loginStatus === 'invalid' ? '失效' :
             loginStatus === 'verifying' ? '验证中...' :
             loginStatus === 'error' ? '错误' : '未配置'}
          </span>
        </div>

        <div>
          <textarea
            value={curlText}
            onChange={(e) => setCurlText(e.target.value)}
            placeholder={`从浏览器获取 curl 命令：\n1. 打开 h-comic.com 并登录\n2. F12 → Network → 右键任意请求 → Copy as cURL\n3. 粘贴到此处`}
            rows={4}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]
                       resize-none font-mono"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => onApplyAuth(curlText)}
            disabled={!curlText.trim() || loginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            应用登录信息
          </button>
          <button
            onClick={onTestAuth}
            disabled={loginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loginStatus === 'verifying' ? '测试中...' : '测试登录'}
          </button>
          <button
            onClick={() => window.hcomic?.openUrl('https://h-comic.com')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]"
          >
            打开网站登录
          </button>
        </div>

        {loginMessage && (
          <p className={`text-xs ${
            loginStatus === 'valid' ? 'text-green-600 dark:text-green-400' :
            loginStatus === 'invalid' ? 'text-red-600 dark:text-red-400' :
            'text-[var(--text-secondary)]'
          }`}>
            {loginMessage}
          </p>
        )}
      </div>
    </div>
  )
}
