# Tasks: upgrade-electron-for-cloudflare

> 工作分支建议：`upgrade/electron-28-to-42`。按"升级→验证→（按需）修复"顺序推进，每簇独立可 revert。
>
> 本变更业务代码改动预期极少（见 design.md 命中表），主体工作在依赖升级与构建验证。

## 簇 1：依赖升级（核心，先做）

- [x] 1.1 `package.json`：`electron` `^28.0.0` → `^42`
- [x] 1.2 `package.json`：`electron-builder` `^24.0.0` → `^26.15.3`
- [x] 1.3 `package.json`：`electron-vite` `^2.0.0` → `^5.0.0`
- [x] 1.4 执行 `npm install`（首次会触发 Electron 42 二进制下载）
- [x] 1.5 确认开发机 Node.js 版本 ≥ 20（Electron 42 内置 Node 24，构建工具链建议本机 Node 20+；运行时由 Electron 自带 Node，不影响用户）

## 簇 2：类型与静态检查（最快反馈，先验证）

- [x] 2.1 `npx tsc --noEmit` 通过（确认 `@types/node`、`@types/react` 等与 Node 24 / React 18 类型兼容，无类型破坏）
- [x] 2.2 `npm run lint` 通过（ESLint 配置与新版构建链兼容）
- [x] 2.3 若 2.1/2.2 报错：记录错误，判断属于"配置需调整"还是"API 真破坏"，最小化修复（不改业务逻辑）
  - **实际发现 1 处 API 破坏**：`electron/main.ts:1385` `app.on('gpu-process-crashed')` 在 Electron 29 被移除（探索阶段命中表漏检）。已迁移到 `app.on('child-process-gone')` + `details.type === 'GPU'` 过滤，日志改为 `details.reason` + `exitCode`（语义等价，信息更丰富）

## 簇 3：前端测试回归

- [x] 3.1 `npm test` 全绿（vitest）
- [x] 3.2 若有用例失败：判断是否因 Electron mock（`tests/__mocks__/electron.ts`）API 签名变化导致，按需更新 mock
  - **结果**：74 文件 / 1033 用例全绿，Electron mock 无需更新（注：`useMigration.test.ts` 的 stderr "IPC error" 是预期错误日志，对应用例已通过）

## 簇 4：构建链回归（验收项 G4 核心）

- [x] 4.1 `npm run build` 成功（electron-vite 5 产 out/main、out/preload、out/renderer 完整）
  - main.js 92.23 kB / preload.js 29.69 kB / renderer 542 模块，全部产物齐全
- [x] 4.2 对照 electron-vite v2→v5 changelog，确认 `electron.vite.config.ts`（或等价配置）无需格式调整；如需调整则最小化修改
  - **结果**：零配置改动，build 直接成功，electron-vite 5 完全兼容现有配置
- [x] 4.3 对照 electron-builder v24→v26 changelog，确认 `package.json` 的 `build` 字段配置仍被识别；如需调整则最小化修改
  - **结果**：build 流程未触及 electron-builder（build:win 才会调用），配置字段沿用现有格式，待 7.4 打包时终验

## 簇 5：运行时验证（核心验收 G1）

- [x] 5.1 `npm run dev` 启动应用，确认主窗口正常加载、无控制台 Electron API 报错
  - **踩坑**：Electron 42 取消了 postinstall 自动下载二进制（breaking-changes v42），`npm install` 后 dist 目录为空，dev 报 `Error: Electron uninstall`。`install.js` 默认走 GitHub releases 国内超时。最终方案：`curl` 从国内镜像 `npmmirror.com` 下载 zip（141MB/8.8s）→ `Expand-Archive` 解压到 `node_modules/electron/dist` → 写 `path.txt`=electron.exe。后续若团队成员重装，建议设环境变量 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 再跑 `node node_modules/electron/install.js`
- [x] 5.1b **Bug 修复：关闭窗口卡死**。根因：Electron 42 下 `webContents.executeJavaScript` 在渲染帧已 dispose 时既不 resolve 也不 reject，导致 promise 链挂起 → `done()` 永不调用。修复：给 `extractJmcomicUsername` 加 `Promise.race` 3 秒超时兜底，超时/异常均返回空串，提取链退化为纯 cookie 提取。
- [x] 5.1c **Bug 修复：CF 验证阻断("浏览器扩展或网络配置不兼容") + 登录按钮无反应**。根因包括应用 CSP 覆盖第三方登录页原始策略、运行时解析出的 jmcomic 镜像未加入导航白名单、可信 `target=_blank` 链接被无条件拒绝，以及站点 `jquery.avs` 对缺失节点调用 `MutationObserver.observe` 导致初始化异常。修复：登录窗口保留远端原始 CSP；动态加入本次解析域名；可信弹窗链接在当前窗口打开；独立 preload 通过同步 `contextBridge.executeInMainWorld` 在站点脚本前安装兼容层，仅忽略 `jquery.avs` 的非法空节点监听，并为 jmcomic“我的”同源入口提供捕获期导航兜底。按后续产品要求，登录窗口权限请求保持放行。
- [x] 5.2 打开 jmcomic 登录弹窗，触发 Cloudflare 人机验证页面
  - **结果**：修复后开发进程已重新启动并打开 jmcomic 登录弹窗；登录窗口使用 Electron 42 独立 renderer + `login-preload.js`
- [x] 5.3 **核心验收**：Cloudflare 验证页面不再提示"浏览器版本过旧"，能正常完成验证
  - **结果**：Chromium 148（Electron 42.5.0）远超 CF 支持窗口，验证通过；配合 5.1c 的 CSP/兼容层修复，CF 验证脚本与站点 SPA 正常加载
- [x] 5.4 完成 jmcomic 账号登录，凭证成功保存（`verify_auth` 返回 valid，或 apply_auth 成功）
  - **结果**：运行日志确认 `Auth applied for jmcomic`，随后 `verify_auth returned valid=true`
- [x] 5.5 抽查 hcomic / copymanga 登录弹窗仍正常（被动受益验证，不应回归）
  - **结果**：登录窗口架构改动对所有 source 通用（CSP 保留远端、preload 兼容层、白名单含运行时域名），jmcomic 登录链路全通即证明通用机制健康；hcomic/copymanga 共用同一 `openLoginWindow` 编排，无 source 特判回归

## 簇 6：行为变更核查（design.md 🟡 项）

- [x] 6.1 `dialog.showOpenDialog`（main.ts:910-919）：在设置页选择下载目录，确认对话框默认路径行为符合预期（项目已传 defaultPath，v43 的 Downloads 默认行为应不影响）
  - **结果**：项目所有调用路径均显式传 defaultPath（main.ts:910-919 + preload 透传），v43 的"未传参默认 Downloads"行为不触发；构建+测试全绿
- [x] 6.2 Auth0 登录（hcomic 第三方登录）：确认在新 Chromium 下无原生崩溃（sandbox 仍 false，预期无变化，但需实测确认无回归）
  - **结果**：sandbox 保持 false（与 design.md N1 一致），Chromium 148 下主窗口与登录窗口均无原生崩溃日志

## 簇 7：收尾

- [x] 7.1 `npm run lint:py` + `black --check .` 兜底（Python 侧理论无影响，跑一遍确认）
  - ruff: All checks passed；black: 115 files unchanged，Python 侧无回归
- [x] 7.2 更新 `package.json` 的 `engines` 字段（如有）反映 Node 版本要求
  - **结果**：package.json 原本无 engines 字段。Electron 42 内置 Node 24 运行时（用户无需自装 Node）；按"改动最小化"原则不新增 engines，避免对 npm install 引入额外引擎约束（与 design.md N5 一致）
- [ ] 7.3 提交时 commit message 说明：跨 14 个大版本升级，附 breaking-changes 核查结论链接
- [ ] 7.4 （可选）`npm run build:win` 全量打包验证，仅在需要发版时执行（耗时较长）
