# 设置页面快捷跳转栏 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SettingsPage 左侧添加 sticky 导航栏，点击可平滑滚动到对应设置区域，点击项短暂高亮后恢复。

**Architecture:** 仅修改 `SettingsPage.tsx`，将现有单列 `max-w-3xl` 布局改为 `flex` 横排：左侧 150px sticky 侧栏 + 右侧设置内容。侧栏使用 `SECTIONS` 静态配置数组渲染，`useState` 管理短暂高亮状态，`scrollIntoView` 实现平滑跳转。

**Tech Stack:** React, TypeScript, Tailwind CSS

---

## 文件结构

| 文件 | 变更 | 职责 |
|---|---|---|
| `src/pages/SettingsPage.tsx` | 修改 | 布局改造 + 侧栏渲染 + 跳转逻辑 + 给各区块加 id |

---

### Task 1: 布局改造 + 快捷跳转栏

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: 添加 SECTIONS 配置和 sidebar 状态**

在 `SettingsPage` 组件函数的顶部（各 `useState` 行之后）添加：

```typescript
const SECTIONS = [
  { id: 'appearance', label: '外观设置', icon: '🎨' },
  { id: 'download',   label: '下载设置', icon: '📥' },
  { id: 'source',     label: '来源',     icon: '🌐' },
  { id: 'tag-filter', label: '标签过滤', icon: '🏷️' },
  { id: 'auth',       label: '认证设置', icon: '🔑' },
  { id: 'proxy',      label: '代理设置', icon: '🔌' },
  { id: 'notification', label: '通知设置', icon: '🔔' },
  { id: 'cache',      label: '缓存管理', icon: '💾' },
] as const

const [activeSection, setActiveSection] = useState<string | null>(null)
```

- [ ] **Step 2: 改造 JSX 布局结构**

将 return 语句中的最外层 `<div className="max-w-3xl space-y-6">` 替换为 `flex` 横排布局。在 `<div>` 开头添加 sidebar，原有内容包裹在右侧 flex-1 容器中。同时给每个设置区块添加 `id` 属性。

整个 `return` 语句替换为：

```tsx
  const handleSectionClick = (sectionId: string) => {
    setActiveSection(sectionId)
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => setActiveSection(null), 1500)
  }

  return (
    <div className="flex gap-0 max-w-5xl">
      {/* Sidebar */}
      <div className="w-[150px] shrink-0">
        <nav className="sticky top-6 space-y-0.5 pr-3">
          <div className="px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] tracking-wide">
            设置区域
          </div>
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => handleSectionClick(section.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                ${activeSection === section.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
            >
              <span className="mr-2">{section.icon}</span>
              {section.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-6">
        <Toast message="已成功获取" visible={showLoginToast} />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">设置</h2>
          <div className="flex items-center gap-2">
            {saveError && (
              <span className="text-sm text-red-500">{saveError}</span>
            )}
            {isSaving && (
              <span className="text-sm text-[var(--text-secondary)]">保存中...</span>
            )}
          </div>
        </div>

        {migrationHook.isActive && (
          <div className="bg-[var(--accent)]/10 border border-[var(--accent)] rounded-xl px-6 py-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                正在后台迁移漫画库 ({migrationHook.progress?.completed ?? 0}/{migrationHook.progress?.total ?? 0})
              </p>
              <div className="w-full h-1.5 bg-[var(--bg-secondary)] rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                  style={{
                    width: `${migrationHook.progress && migrationHook.progress.total > 0
                      ? Math.round((migrationHook.progress.completed / migrationHook.progress.total) * 100) : 0}%`
                  }}
                />
              </div>
            </div>
            <button
              onClick={() => setIsMigrationOpen(true)}
              className="px-3 py-1.5 text-sm rounded-lg bg-[var(--accent)] text-white whitespace-nowrap"
            >
              查看详情
            </button>
          </div>
        )}

        <div id="section-appearance">
          <AppearanceSettings
            themeMode={themeMode}
            cardStyle={cardStyle}
            sfwMode={sfwMode}
            availableFonts={availableFonts}
            fontName={fontName}
            fontSize={fontSize}
            onThemeChange={handleThemeChange}
            onCardStyleChange={handleCardStyleChange}
            onSfwModeChange={handleSfwModeChange}
            onFontNameChange={setFontName}
            onFontSizeChange={setFontSize}
            setConfig={setConfig}
            setSaveError={setSaveError}
            setIsSaving={setIsSaving}
          />
        </div>

        <div id="section-download">
          <DownloadSettings
            outputFormat={outputFormat}
            config={{
              downloadDir: config.downloadDir,
              concurrentDownloads: config.concurrentDownloads,
              timeout: config.timeout,
              retryTimes: config.retryTimes,
              cbzFilenameTemplate: config.cbzFilenameTemplate,
              batchDownloadDelay: config.batchDownloadDelay,
            }}
            onOutputFormatChange={handleOutputFormatChange}
            onConfigChange={handleConfigChange}
            onTextConfigChange={handleTextConfigChange}
            onTextConfigBlur={handleTextConfigBlur}
            openDownloadDir={openDownloadDir}
            onSelectDirectory={async () => {
              const result = await selectDirectory('选择下载目录', config.downloadDir || undefined)
              if (!result.canceled && result.filePaths.length > 0) {
                handleConfigChange('downloadDir', result.filePaths[0])
              }
            }}
            setSaveError={setSaveError}
            onOpenMigration={() => setIsMigrationOpen(true)}
          />
        </div>

        <div id="section-source">
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
            <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
              来源
            </h3>
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">默认来源</label>
              <div className="flex gap-3">
                {['hcomic', 'moeimg'].map((source) => (
                  <button
                    key={source}
                    onClick={() => handleConfigChange('defaultSource', source)}
                    className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                      config.defaultSource === source
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                    }`}
                  >
                    {source === 'hcomic' ? 'HComic' : 'Moeimg'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div id="section-tag-filter">
          <TagFilterSettings
            tagBlacklist={tagBlacklist}
            addTag={addTag}
            removeTag={removeTag}
          />
        </div>

        <div id="section-auth">
          <AuthSettings
            loginSectionRef={loginSectionRef}
            loginStatus={loginStatus}
            loginMessage={loginMessage}
            onApplyAuth={handleApplyAuth}
            onTestAuth={handleTestAuth}
            onOpenLoginWindow={handleOpenLoginWindow}
          />
        </div>

        <div id="section-proxy">
          <ProxySettings
            proxyStatus={proxyStatus}
            proxyLoading={proxyLoading}
            onRefresh={loadProxyStatus}
          />
        </div>

        <div id="section-notification">
          <NotificationSettings
            notifyOnComplete={config.notifyOnComplete}
            notifyWhenForeground={config.notifyWhenForeground}
            onConfigChange={handleConfigChange}
          />
        </div>

        <div id="section-cache">
          <CacheSettings
            sizeLimitMB={config.previewCacheSizeLimitMB}
            onSizeLimitChange={(mb) => handleConfigChange('previewCacheSizeLimitMB', mb)}
          />
        </div>

        <MigrationDialog
          isOpen={isMigrationOpen}
          onClose={() => setIsMigrationOpen(false)}
          currentDownloadDir={config.downloadDir}
          onSelectDirectory={selectDirectory}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 运行 TypeScript 类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 构建验证**

Run: `npx electron-vite build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat: add quick-jump sidebar navigation to SettingsPage"
```
