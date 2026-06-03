import { useState, useEffect, useRef, type RefObject } from 'react'

interface AuthSettingsProps {
  loginSectionRef: RefObject<HTMLDivElement>
  loginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  loginMessage: string
  jmcomicLoginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  jmcomicLoginMessage: string
  moeimgLoginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  moeimgLoginMessage: string
  moeimgSavedUsername: string
  onApplyAuth: (curlText: string, source?: string) => Promise<void>
  onTestAuth: (source?: string) => Promise<void>
  onOpenLoginWindow: (source?: string) => Promise<void>
  onMoeimgLogin: (username: string, password: string) => Promise<void>
}

type AuthStatus = AuthSettingsProps['loginStatus']

export function AuthSettings({
  loginSectionRef,
  loginStatus,
  loginMessage,
  jmcomicLoginStatus,
  jmcomicLoginMessage,
  moeimgLoginStatus,
  moeimgLoginMessage,
  moeimgSavedUsername,
  onApplyAuth,
  onTestAuth,
  onOpenLoginWindow,
  onMoeimgLogin,
}: AuthSettingsProps) {
  const [curlText, setCurlText] = useState('')
  const [jmcomicCurlText, setJmcomicCurlText] = useState('')
  const [moeimgUsername, setMoeimgUsername] = useState(moeimgSavedUsername || '')
  const [moeimgPassword, setMoeimgPassword] = useState('')
  const [moeimgCurlText, setMoeimgCurlText] = useState('')
  const [showMoeimgPassword, setShowMoeimgPassword] = useState(false)

  return (
    <div ref={loginSectionRef} className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
      <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
        登录
      </h3>

      <AuthSourceCard
        label="HComic"
        status={loginStatus}
        message={loginMessage}
        first
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenLoginWindow()}
            disabled={loginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loginStatus === 'verifying' ? '登录中...' : '弹窗登录'}
          </button>
          <span className="text-xs text-[var(--text-secondary)]">在弹窗中登录 H-Comic 账号，登录完成后关闭弹窗即可自动识别 Cookie</span>
        </div>

        <textarea
          value={curlText}
          onChange={(e) => setCurlText(e.target.value)}
          placeholder={`从浏览器获取 curl 命令：\n1. 打开 h-comic.com 并登录\n2. F12 → Network → 右键任意请求 → Copy as cURL\n3. 粘贴到此处`}
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]
                     resize-none font-mono"
        />

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
            onClick={() => onTestAuth()}
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
      </AuthSourceCard>

      <AuthSourceCard
        label="禁漫天堂"
        status={jmcomicLoginStatus}
        message={jmcomicLoginMessage}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenLoginWindow('jmcomic')}
            disabled={jmcomicLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {jmcomicLoginStatus === 'verifying' ? '登录中...' : '弹窗登录'}
          </button>
          <span className="text-xs text-[var(--text-secondary)]">在弹窗中登录禁漫天堂账号</span>
        </div>

        <textarea
          value={jmcomicCurlText}
          onChange={(e) => setJmcomicCurlText(e.target.value)}
          placeholder="粘贴禁漫天堂的 Cookie 字符串或 curl 命令"
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]
                     resize-none font-mono"
        />

        <div className="flex gap-3">
          <button
            onClick={() => onApplyAuth(jmcomicCurlText, 'jmcomic')}
            disabled={!jmcomicCurlText.trim() || jmcomicLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            应用登录信息
          </button>
          <button
            onClick={() => onTestAuth('jmcomic')}
            disabled={jmcomicLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {jmcomicLoginStatus === 'verifying' ? '测试中...' : '测试登录'}
          </button>
        </div>
      </AuthSourceCard>

      <AuthSourceCard
        label="MoeImg"
        status={moeimgLoginStatus}
        message={moeimgLoginMessage}
      >
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">用户名</label>
            <input
              type="text"
              value={moeimgUsername}
              onChange={(e) => setMoeimgUsername(e.target.value)}
              placeholder="moeimg 用户名"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">密码</label>
            <div className="relative">
              <input
                type={showMoeimgPassword ? 'text' : 'password'}
                value={moeimgPassword}
                onChange={(e) => setMoeimgPassword(e.target.value)}
                placeholder="moeimg 密码"
                className="w-full px-3 py-2 pr-10 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onMouseDown={() => setShowMoeimgPassword(true)}
                onMouseUp={() => setShowMoeimgPassword(false)}
                onMouseLeave={() => setShowMoeimgPassword(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1"
                aria-label={showMoeimgPassword ? '隐藏密码' : '显示密码'}
              >
                {showMoeimgPassword ? (
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <button
            onClick={async () => {
              await onMoeimgLogin(moeimgUsername, moeimgPassword)
            }}
            disabled={!moeimgUsername.trim() || !moeimgPassword.trim() || moeimgLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {moeimgLoginStatus === 'verifying' ? '登录中...' : '登录'}
          </button>
        </div>

        <textarea
          value={moeimgCurlText}
          onChange={(e) => setMoeimgCurlText(e.target.value)}
          placeholder="或粘贴包含 __SESSION cookie 的 curl 命令"
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]
                     resize-none font-mono"
        />

        <div className="flex gap-3">
          <button
            onClick={() => onApplyAuth(moeimgCurlText, 'moeimg')}
            disabled={!moeimgCurlText.trim() || moeimgLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            应用 curl
          </button>
          <button
            onClick={() => onTestAuth('moeimg')}
            disabled={moeimgLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {moeimgLoginStatus === 'verifying' ? '测试中...' : '测试登录'}
          </button>
        </div>
      </AuthSourceCard>
    </div>
  )
}

function AuthSourceCard({
  label,
  status,
  message,
  first,
  children,
}: {
  label: string
  status: AuthStatus
  message: string
  first?: boolean
  children: React.ReactNode
}) {
  const needsAttention = status === 'invalid' || status === 'error'
  const [expanded, setExpanded] = useState(needsAttention)
  const prevNeedsAttention = useRef(needsAttention)

  useEffect(() => {
    if (needsAttention && !prevNeedsAttention.current) {
      setExpanded(true)
    }
    prevNeedsAttention.current = needsAttention
  }, [needsAttention])

  return (
    <div className={first ? '' : 'border-t border-[var(--border)] pt-4'}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-left hover:bg-[var(--bg-secondary)] rounded-lg px-2 py-1 -mx-2 transition-colors"
      >
        <span className="text-xs text-[var(--text-secondary)] transition-transform" style={expanded ? { transform: 'rotate(90deg)' } : undefined}>
          ▶
        </span>
        <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          status === 'valid' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
          status === 'invalid' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
          status === 'verifying' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
          status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
          'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
        }`}>
          {status === 'valid' ? '有效' :
           status === 'invalid' ? '失效' :
           status === 'verifying' ? '验证中...' :
           status === 'error' ? '错误' : '未配置'}
        </span>
      </button>

      {expanded && (
        <div className="space-y-4 mt-3 pl-7">
          {children}
          {message && (
            <p className={`text-xs ${
              status === 'valid' ? 'text-green-600 dark:text-green-400' :
              status === 'invalid' || status === 'error' ? 'text-red-600 dark:text-red-400' :
              'text-[var(--text-secondary)]'
            }`}>
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
