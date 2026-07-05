import { useState, useEffect, useRef, type RefObject } from 'react'

interface AuthSettingsProps {
  loginSectionRef: RefObject<HTMLDivElement>
  loginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  loginMessage: string
  hcomicSavedUsername: string
  hcomicSavedPassword: string
  jmLoginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  jmLoginMessage: string
  moeimgLoginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  moeimgLoginMessage: string
  moeimgSavedUsername: string
  moeimgSavedPassword: string
  bikaLoginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  bikaLoginMessage: string
  bikaSavedUsername: string
  bikaSavedPassword: string
  copymangaLoginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  copymangaLoginMessage: string
  nhLoginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  nhLoginMessage: string
  nhSavedUsername: string
  nhSavedPassword: string
  onApplyAuth: (curlText: string, source?: string) => Promise<void>
  onTestAuth: (source?: string) => Promise<void>
  onOpenLoginWindow: (source?: string) => Promise<void>
  onHcomicLogin: (username: string, password: string) => Promise<void>
  onMoeimgLogin: (username: string, password: string) => Promise<void>
  onBikaLogin: (username: string, password: string) => Promise<void>
  onNhLogin: (username: string, password: string) => Promise<void>
  onClearAuth: (source: string) => Promise<void>
}

type AuthStatus = AuthSettingsProps['loginStatus']

export function AuthSettings({
  loginSectionRef,
  loginStatus,
  loginMessage,
  hcomicSavedUsername,
  hcomicSavedPassword,
  jmLoginStatus,
  jmLoginMessage,
  moeimgLoginStatus,
  moeimgLoginMessage,
  moeimgSavedUsername,
  moeimgSavedPassword,
  bikaLoginStatus,
  bikaLoginMessage,
  bikaSavedUsername,
  bikaSavedPassword,
  copymangaLoginStatus,
  copymangaLoginMessage,
  nhLoginStatus,
  nhLoginMessage,
  nhSavedUsername,
  nhSavedPassword,
  onApplyAuth,
  onTestAuth,
  onOpenLoginWindow,
  onHcomicLogin,
  onMoeimgLogin,
  onBikaLogin,
  onNhLogin,
  onClearAuth,
}: AuthSettingsProps) {
  const [curlText, setCurlText] = useState('')
  const [hcomicUsername, setHcomicUsername] = useState(hcomicSavedUsername || '')
  const [hcomicPassword, setHcomicPassword] = useState(hcomicSavedPassword || '')
  const [showHcomicPassword, setShowHcomicPassword] = useState(false)
  const [jmCurlText, setJmCurlText] = useState('')
  const [moeimgUsername, setMoeimgUsername] = useState(moeimgSavedUsername || '')
  const [moeimgPassword, setMoeimgPassword] = useState(moeimgSavedPassword || '')
  const [moeimgCurlText, setMoeimgCurlText] = useState('')
  const [showMoeimgPassword, setShowMoeimgPassword] = useState(false)
  const [bikaUsername, setBikaUsername] = useState(bikaSavedUsername || '')
  const [bikaPassword, setBikaPassword] = useState(bikaSavedPassword || '')
  const [showBikaPassword, setShowBikaPassword] = useState(false)
  const [nhUsername, setNhUsername] = useState(nhSavedUsername || '')
  const [nhPassword, setNhPassword] = useState(nhSavedPassword || '')
  const [nhApiKey, setNhApiKey] = useState('')
  const [showNhPassword, setShowNhPassword] = useState(false)

  // 配置异步加载：挂载后 savedUsername/savedPassword 才到达，同步到本地 state。
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setHcomicUsername(hcomicSavedUsername || '') }, [hcomicSavedUsername])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setHcomicPassword(hcomicSavedPassword || '') }, [hcomicSavedPassword])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMoeimgUsername(moeimgSavedUsername || '') }, [moeimgSavedUsername])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMoeimgPassword(moeimgSavedPassword || '') }, [moeimgSavedPassword])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBikaUsername(bikaSavedUsername || '') }, [bikaSavedUsername])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBikaPassword(bikaSavedPassword || '') }, [bikaSavedPassword])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNhUsername(nhSavedUsername || '') }, [nhSavedUsername])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNhPassword(nhSavedPassword || '') }, [nhSavedPassword])

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
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">用户名或邮箱</label>
            <input
              type="text"
              value={hcomicUsername}
              onChange={(e) => setHcomicUsername(e.target.value)}
              placeholder="HComic 用户名或邮箱"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">密码</label>
            <div className="relative">
              <input
                type={showHcomicPassword ? 'text' : 'password'}
                value={hcomicPassword}
                onChange={(e) => setHcomicPassword(e.target.value)}
                placeholder="HComic 密码"
                className="w-full px-3 py-2 pr-10 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onMouseDown={() => setShowHcomicPassword(true)}
                onMouseUp={() => setShowHcomicPassword(false)}
                onMouseLeave={() => setShowHcomicPassword(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1"
                aria-label={showHcomicPassword ? '隐藏密码' : '显示密码'}
              >
                {showHcomicPassword ? (
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
              await onHcomicLogin(hcomicUsername, hcomicPassword)
            }}
            disabled={!hcomicUsername.trim() || !hcomicPassword.trim() || loginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loginStatus === 'verifying' ? '登录中...' : '登录'}
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] py-2">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span>或</span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

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
        label="jm"
        status={jmLoginStatus}
        message={jmLoginMessage}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenLoginWindow('jm')}
            disabled={jmLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {jmLoginStatus === 'verifying' ? '登录中...' : '弹窗登录'}
          </button>
          <span className="text-xs text-[var(--text-secondary)]">在弹窗中登录 jm 账号</span>
        </div>

        <textarea
          value={jmCurlText}
          onChange={(e) => setJmCurlText(e.target.value)}
          placeholder="粘贴 jm 的 Cookie 字符串或 curl 命令"
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]
                     resize-none font-mono"
        />

        <div className="flex gap-3">
          <button
            onClick={() => onApplyAuth(jmCurlText, 'jm')}
            disabled={!jmCurlText.trim() || jmLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            应用登录信息
          </button>
          <button
            onClick={() => onTestAuth('jm')}
            disabled={jmLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {jmLoginStatus === 'verifying' ? '测试中...' : '测试登录'}
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

      <AuthSourceCard
        label="哔咔 (Bika)"
        status={bikaLoginStatus}
        message={bikaLoginMessage}
      >
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">用户名</label>
            <input
              type="text"
              value={bikaUsername}
              onChange={(e) => setBikaUsername(e.target.value)}
              placeholder="哔咔用户名"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">密码</label>
            <div className="relative">
              <input
                type={showBikaPassword ? 'text' : 'password'}
                value={bikaPassword}
                onChange={(e) => setBikaPassword(e.target.value)}
                placeholder="哔咔密码"
                className="w-full px-3 py-2 pr-10 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onMouseDown={() => setShowBikaPassword(true)}
                onMouseUp={() => setShowBikaPassword(false)}
                onMouseLeave={() => setShowBikaPassword(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1"
                aria-label={showBikaPassword ? '隐藏密码' : '显示密码'}
              >
                {showBikaPassword ? (
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
              await onBikaLogin(bikaUsername, bikaPassword)
            }}
            disabled={!bikaUsername.trim() || !bikaPassword.trim() || bikaLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bikaLoginStatus === 'verifying' ? '登录中...' : '登录'}
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)] mt-2">
          使用哔咔用户名和密码登录
        </p>
      </AuthSourceCard>

      <AuthSourceCard
        label="拷贝漫画"
        status={copymangaLoginStatus}
        message={copymangaLoginMessage}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenLoginWindow('copymanga')}
            disabled={copymangaLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copymangaLoginStatus === 'verifying' ? '登录中...' : '弹窗登录'}
          </button>
          <span className="text-xs text-[var(--text-secondary)]">在弹窗中登录拷贝漫画账号，登录完成后关闭弹窗即可自动识别 Cookie</span>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => onTestAuth('copymanga')}
            disabled={copymangaLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copymangaLoginStatus === 'verifying' ? '测试中...' : '测试登录'}
          </button>
        </div>
      </AuthSourceCard>

      <AuthSourceCard
        label="NH"
        status={nhLoginStatus}
        message={nhLoginMessage}
      >
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">用户名</label>
            <input
              type="text"
              value={nhUsername}
              onChange={(e) => setNhUsername(e.target.value)}
              placeholder="nhentai 用户名"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">密码</label>
            <div className="relative">
              <input
                type={showNhPassword ? 'text' : 'password'}
                value={nhPassword}
                onChange={(e) => setNhPassword(e.target.value)}
                placeholder="nhentai 密码"
                className="w-full px-3 py-2 pr-10 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onMouseDown={() => setShowNhPassword(true)}
                onMouseUp={() => setShowNhPassword(false)}
                onMouseLeave={() => setShowNhPassword(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1"
                aria-label={showNhPassword ? '隐藏密码' : '显示密码'}
              >
                {showNhPassword ? (
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
              await onNhLogin(nhUsername, nhPassword)
            }}
            disabled={!nhUsername.trim() || !nhPassword.trim() || nhLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {nhLoginStatus === 'verifying' ? '登录中...' : '登录'}
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] py-2">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span>或</span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">API Key（推荐）</label>
            <input
              type="text"
              value={nhApiKey}
              onChange={(e) => setNhApiKey(e.target.value)}
              placeholder="从 nhentai 账户设置页生成 API Key"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <button
            onClick={() => {
              const curl = `curl 'https://nhentai.net/api/v2/user' -H 'Authorization: Key ${nhApiKey.trim()}'`
              onApplyAuth(curl, 'nh')
            }}
            disabled={!nhApiKey.trim() || nhLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            应用 API Key
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)] mt-2">
          推荐在<a
            href="https://nhentai.net/user/settings#apikeys"
            onClick={(e) => {
              e.preventDefault()
              window.hcomic?.openUrl('https://nhentai.net/user/settings#apikeys')
            }}
            className="text-[var(--accent)] hover:underline"
          >nhentai 账户设置</a>
          生成 API Key 后粘贴到此处。也可使用账号密码登录（可能受 Cloudflare 影响）。
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => onTestAuth('nh')}
            disabled={nhLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {nhLoginStatus === 'verifying' ? '测试中...' : '测试登录'}
          </button>
          <button
            onClick={async () => {
              await onClearAuth('nh')
              setNhUsername('')
              setNhPassword('')
              setNhApiKey('')
            }}
            disabled={nhLoginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--bg-secondary)] text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            登出
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
  // Default expanded when attention is needed (first render only).
  // User-controlled: once manually toggled, only auto-expands on
  // invalid/error transitions — never auto-collapses on success.
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
        aria-expanded={expanded}
        aria-label={`${expanded ? '收起' : '展开'} ${label} 登录设置`}
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
