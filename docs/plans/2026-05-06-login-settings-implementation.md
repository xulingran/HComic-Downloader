# 登录信息设置功能 - 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Electron 设置页面新增登录信息设置卡片，支持粘贴 curl 命令自动配置 hcomic 登录认证并验证。

**Architecture:** Python 后端新增 `apply_auth` 和 `verify_auth` IPC 方法，复用已有的 `auth_parser.extract_auth_from_curl` 和 `parser.verify_login_status`。Electron main 进程注册对应 IPC handler。React 前端在 SettingsPage 新增登录卡片，通过 IPC 调用后端。

**Tech Stack:** Python (ipc_server.py, auth_parser.py), TypeScript/Electron (main.ts), React + TailwindCSS (SettingsPage.tsx)

---

### Task 1: Python 后端 - 新增 apply_auth IPC 方法

**Files:**
- Modify: `python/ipc_server.py:143-168` (handle_request 的 handlers 字典)

**Step 1: 在 IPCServer 类中添加 handle_apply_auth 方法**

在 `handle_set_config` 方法之后（约第 112 行）添加：

```python
def handle_apply_auth(self, curl_text: str) -> Dict:
    if not curl_text or not curl_text.strip():
        raise ValueError("请粘贴 curl 命令")

    from auth_parser import extract_auth_from_curl

    cookie, user_agent = extract_auth_from_curl(curl_text.strip())
    self.config.set_source_auth("hcomic", cookie=cookie, user_agent=user_agent)
    self.config.save(_get_config_path())

    # 同步到 parser
    self.parser.configure_auth(cookie=cookie, user_agent=user_agent, source="hcomic")

    return {"cookie": cookie, "user_agent": user_agent}
```

**Step 2: 注册到 handlers 字典**

在 `handle_request` 方法的 `handlers` 字典中添加：

```python
"apply_auth": self.handle_apply_auth,
```

**Step 3: 验证**

启动 app 后在终端发送测试 JSON：
```bash
echo '{"jsonrpc":"2.0","id":"1","method":"apply_auth","params":{"curl_text":"curl -H \"Cookie: test=123\" -H \"User-Agent: Mozilla/5.0\" https://example.com"}}' | python python/ipc_server.py
```
预期: 返回包含 cookie 和 user_agent 的 JSON result。

**Step 4: Commit**

```bash
git add python/ipc_server.py
git commit -m "feat: add apply_auth IPC method for curl-based login"
```

---

### Task 2: Python 后端 - 新增 verify_auth IPC 方法

**Files:**
- Modify: `python/ipc_server.py`

**Step 1: 在 IPCServer 类中添加 handle_verify_auth 方法**

在 `handle_apply_auth` 之后添加：

```python
def handle_verify_auth(self) -> Dict:
    is_valid, message = self.parser.verify_login_status()
    return {"valid": is_valid, "message": message}
```

**Step 2: 注册到 handlers 字典**

```python
"verify_auth": self.handle_verify_auth,
```

**Step 3: Commit**

```bash
git add python/ipc_server.py
git commit -m "feat: add verify_auth IPC method for login validation"
```

---

### Task 3: Electron 主进程 - 注册新 IPC handler

**Files:**
- Modify: `electron/main.ts:46-80` (registerIPCHandlers 函数)

**Step 1: 在 registerIPCHandlers 中添加两个新 handler**

在 `python:get-statistics` handler 之后添加：

```typescript
ipcMain.handle('python:apply-auth', async (_, curlText) => {
  return bridge.call('apply_auth', { curl_text: curlText })
})

ipcMain.handle('python:verify-auth', async () => {
  return bridge.call('verify_auth')
})
```

**Step 2: Commit**

```bash
git add electron/main.ts
git commit -m "feat: register apply-auth and verify-auth IPC handlers"
```

---

### Task 4: 前端 - 在 useIpc.ts 中新增 useAuth hook

**Files:**
- Modify: `src/hooks/useIpc.ts`

**Step 1: 在文件末尾添加 useAuth hook**

```typescript
export function useAuth() {
  const { invoke } = useIpc()

  const applyAuth = useCallback(async (curlText: string) => {
    return invoke('python:apply-auth', curlText)
  }, [invoke])

  const verifyAuth = useCallback(async () => {
    return invoke('python:verify-auth')
  }, [invoke])

  return { applyAuth, verifyAuth }
}
```

**Step 2: Commit**

```bash
git add src/hooks/useIpc.ts
git commit -m "feat: add useAuth hook for login IPC calls"
```

---

### Task 5: 前端 - SettingsPage 新增登录设置卡片

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

**Step 1: 添加 import 和类型**

在文件顶部的 import 中添加 `useAuth`：

```typescript
import { useConfig } from '../hooks/useIpc'
import { useAuth } from '../hooks/useIpc'
```

在组件内部、现有 hooks 之后添加：

```typescript
const { applyAuth, verifyAuth } = useAuth()
const [curlText, setCurlText] = useState('')
const [loginStatus, setLoginStatus] = useState<'idle' | 'verifying' | 'valid' | 'invalid' | 'error'>('idle')
const [loginMessage, setLoginMessage] = useState('')
```

**Step 2: 页面加载时检查现有登录状态**

在 `loadConfig` 函数末尾，加载完 config 后添加自动验证逻辑：

```typescript
// 在 loadConfig 的 try 块末尾添加
const authCookie = result.config?.cookie
if (authCookie) {
  setLoginStatus('verifying')
  try {
    const verifyResult = await verifyAuth()
    setLoginStatus(verifyResult.valid ? 'valid' : 'invalid')
    setLoginMessage(verifyResult.message || '')
  } catch {
    setLoginStatus('idle')
  }
}
```

**Step 3: 添加 handleApplyAuth 处理函数**

在 `saveConfig` 函数之后添加：

```typescript
const handleApplyAuth = async () => {
  if (!curlText.trim()) return
  setLoginStatus('verifying')
  setLoginMessage('')
  try {
    await applyAuth(curlText.trim())
    const verifyResult = await verifyAuth()
    setLoginStatus(verifyResult.valid ? 'valid' : 'invalid')
    setLoginMessage(verifyResult.message || '')
    setCurlText('')
  } catch (err: any) {
    setLoginStatus('error')
    setLoginMessage(err.message || '操作失败')
  }
}
```

**Step 4: 在"来源"卡片和"通知"卡片之间添加登录卡片 JSX**

在"来源"卡片 `</div>` 和"通知"卡片 `<div>` 之间插入：

```tsx
<div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
  <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
    登录
  </h3>

  <div className="space-y-4">
    <div className="flex items-center justify-between">
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
    </div>

    <div>
      <textarea
        value={curlText}
        onChange={(e) => setCurlText(e.target.value)}
        placeholder={`从浏览器获取 curl 命令：\n1. 打开 h-comic.com 并登录\n2. F12 → Network → 右键任意请求 → Copy → Copy as cURL\n3. 粘贴到此处`}
        rows={4}
        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                   text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]
                   resize-none font-mono"
      />
    </div>

    <button
      onClick={handleApplyAuth}
      disabled={!curlText.trim() || loginStatus === 'verifying'}
      className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                 bg-[var(--accent)] text-white hover:opacity-90
                 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loginStatus === 'verifying' ? '验证中...' : '应用登录信息'}
    </button>

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
```

**Step 5: 启动 dev server 验证 UI**

```bash
npm run dev
```

验证：
1. 设置页面出现"登录"卡片
2. 粘贴 curl 后点击按钮，状态徽标更新
3. 有效时显示绿色"有效"，无效时显示红色"失效"

**Step 6: Commit**

```bash
git add src/pages/SettingsPage.tsx src/hooks/useIpc.ts
git commit -m "feat: add login settings card to settings page"
```
