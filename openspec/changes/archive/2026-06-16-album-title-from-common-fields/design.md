## 上下文

"下载为专辑"入口（`SearchPage` / `FavouritesPage` → `AlbumNameDialog`）当前把默认专辑名写死为 `批量下载 - ${N}本漫画`，没有利用选中漫画的标题；同时该默认值因 React state 不同步 bug 实际显示为 `批量下载 - 0本漫画`。

项目已存在 `src/utils/titleSimilarity.ts`，提供 `normalizeTitle`（去括号/全角转半角/压空白）、`lcsRatio`（最长公共子序列比例）、`findDuplicateGroups`（并查集聚类）。重复检测能力（`openspec/specs/duplicate-detector`）已依赖该模块，是经过验证的稳定基础。

漫画标题（hcomic / jmcomic / bika / moeimg）高度结构化，常见形态：
- `[作者] 作品名 第N话`
- `[社团] 作品名 第N话`
- `[作者] 作品名 (汉化组)`
- `作品名 第N话`（无作者前缀）

同一作品的不同章节/卷共享"作者前缀 + 作品名"主体，差异主要在"第N话"后缀。这给了我们"切块求交集"的天然切分点。

## 目标 / 非目标

**目标：**
- 用选中漫画标题计算一个合理的默认专辑名，输入框预填该值，用户仍可改。
- 优先保留 `[作者] 作品名` 这种共有主体。
- 复用 `titleSimilarity.ts` 现有工具函数，新增一个纯函数 `extractAlbumTitle`。
- 修复 `AlbumNameDialog` 的 `defaultName` 不同步 bug。
- 计算失败 / 共有部分过短时，回退到旧文案 `批量下载 - ${N}本漫画`（N 必须准确）。

**非目标：**
- 不改后端 `handle_download_batch_as_album` 的契约——它继续按传入的 `album_title` 工作。
- 不做"自动识别这是不是同一作品"的判断——用户既然手动选了多本并点了"下载为专辑"，就视为其意图，我们只负责给个合理默认名。
- 不持久化"上次提取的专辑名"——每次打开弹窗都重算。
- 不引入新的第三方分词库。

## 决策

### 决策 1：算法策略——分词求交集，兜底公共前缀

**选择**：三段式算法 `extractAlbumTitle(titles: string[]): string | null`。

```
Step 1  选中数 < 2 直接返回 null。

Step 2  分词：对【原始标题】按 /[\s\-—_～~]+/ 切块，求集合交集。
        分隔符覆盖中文漫画标题常见格式：
          - 空格（"作者 作品 第N话"）
          - 连字符 - —（"系列名-子标题"）
          - 下划线 _（"作者_作品"）
          - 波浪号 ～ ~（"标题～副标题"）
        集合交集位置无关，容忍 token 顺序差异。

Step 3  作者前缀独立判定：扫描原始标题，若【所有】标题都以同一个
        [括号内容] 开头，则把该 [作者] 作为强制前缀。
        —— 与 Step 2 的集合交集【独立判定】，避免"作者恰好不在
           空格切出的 token 里"的边角（如 "[作者]作品名" 无空格）。

Step 4  组装：作者前缀 + 交集 tokens 用空格拼接；
        trim 后长度 < 2 返回 null。
        作者前缀去重：若交集 body 已含作者片段（紧连或独立 token），
        不重复拼接。

Step 5  兜底：交集为空时，对【原始标题】求字符级最长公共前缀，
        trim 后 ≥ 2 才用；否则返回 null。
```

**为什么选这个**：
- hcomic/jmcomic 标题用空格/连字符分段，"集合交集"正好捕获"作者 + 作品名"或"共有尾部片段"。
- 集合（而非序列）交集容忍 token 顺序差异，比 LCS 实现简单且对中文标题更直观。
- 单独判定作者前缀，保证 `[作者]作品名`（无空格）这种边角也能保留作者。
- 最长公共前缀作为兜底，覆盖"全是连续汉字无分隔符"的边角。

**考虑过的替代方案**：
- ❌ 直接用 `findDuplicateGroups` 把选中漫画聚类再取组代表：那是"判断是否相似"，不是"提取共有部分"，语义不对，且会引入阈值参数。
- ❌ LCS 回溯定位公共子串：实现复杂（要回溯 DP 表），且 LCS 可能跳着匹配出无意义片段。
- ❌ LLM 抽取：离线不可用、延迟高、结果不稳定，违背"尽量复用已有代码"。

**分隔符扩展的由来**：初版仅按 `/\s+/` 分词，真实场景中发现 `偷袭观者-困困觉` / `观者-结末-困困觉` / `玄尘佛母-无相法身-困困觉` 这类用连字符分隔、共有部分在尾部的标题提取失败（交集和字符级前缀都为空）。扩展为 `/[\s\-—_～~]+/` 后，交集能正确捕获尾部共有的"困困觉"。

### 决策 2：落点放在前端，在"打开弹窗"的点击 handler 中计算

**选择**：在 `SearchPage` / `FavouritesPage` 的 `handleBatchDownloadAsAlbumClick`（点击"下载为专辑"按钮的 handler）中计算 `defaultName`，结果存入组件 state，`AlbumNameDialog` 读 state。

**为什么不是 useMemo**：
- 初版用 `useMemo(() => ..., [selectedIds, selectedComics])` 缓存默认名。但点击按钮时这俩依赖**没变**（变的是 `showAlbumDialog`），memo 返回缓存、不重新执行。
- 这导致两个问题：(1) 日志（诊断点）不在"打开弹窗"时输出，而在"用户勾选漫画"时输出，难以排查；(2) 若用户勾选后、打开弹窗前有异步翻页导致 `selectedComics()` 缓存变化，memo 的旧值会过时。
- 改为在 handler 中计算：日志在正确时机输出，且 `selectedComics()` 打开瞬间求值能拿到最新数据。

**为什么是前端而非后端**：
- 用户在输入框里能看到、能改——这是"建议"而非"强制"，前端预填最自然。
- 选中漫画数据已经在内存（`selectedCacheRef`），无需 IPC 往返。
- 与现有交互（弹窗 → 输入 → 确认）完全兼容，零后端改动。

### 决策 3：修复 defaultName 同步——渲染期间检测 prop 变化

**选择**：`AlbumNameDialog` 用"渲染期间检测 prop 变化"模式（React 官方推荐）同步 `defaultName`，而非 `useEffect`。

```ts
const [wasOpen, setWasOpen] = useState(isOpen)
if (isOpen && !wasOpen) {
  setName(defaultName)      // 弹窗从关→开：同步最新默认名
  setWasOpen(true)
} else if (!isOpen && wasOpen) {
  setWasOpen(false)
}
```

**为什么不用 useEffect**：
- 初版用 `useEffect(() => { if (isOpen) setName(defaultName) }, [isOpen])`，被 ESLint 规则 `react-hooks/set-state-in-effect` 拦截（该规则禁止在 effect 中直接 setState）。
- "渲染期间检测 prop 变化并同步 state"是 React 官方明确认可的模式（[docs](https://react.dev/reference/react/useState#storing-information-from-previous-renders)），无额外渲染开销，且不触发该 lint 规则。

**行为保证**：
- 仅在 `isOpen` 翻转为 true 的那次渲染重置；弹窗保持打开期间即使用户编辑触发重渲染也不会被覆盖（`wasOpen` 已为 true，分支不进入）。
- 对常驻挂载（靠 `isOpen` 控制显隐）和条件挂载两种用法都成立。

### 决策 4：pickAlbumDefaultName 包装函数——提取 + 日志 + 回退

**选择**：新增 `pickAlbumDefaultName(titles, count): string` 包装函数，封装三件事：
1. 调用 `extractAlbumTitle` 提取共有字段
2. 提取成功/失败时打 `console.info` 日志（带 inputCount、sample、result/fallback）
3. 提取失败时回退 `批量下载 - ${count}本漫画`

**为什么是包装函数而非在 extractAlbumTitle 内打日志**：
- `extractAlbumTitle` 是纯函数，被单元测试覆盖；在内部打 console 会让测试输出变吵。
- 日志属于"调用诊断"关注点，放在调用方更合适；包装函数让两个 page 的调用方零重复。

**为什么用 console.info 而非 console.debug**：
- 初版用 `console.debug`，实测在 Chrome DevTools 默认配置下被隐藏（debug 属于 verbose 级别，默认关闭）。
- 关键诊断信息用 `info` 确保默认可见，遵循项目既有 `[模块前缀]` 范式（如 `[preview]`、`[diagnostics]`）。

## 风险 / 权衡

- **[风险] 分词对无分隔符的纯中文/日文标题失效** → 由 Step 5 的最长公共前缀兜底；仍失效则返回 null 走旧文案。可接受——这是"默认名建议"，不是关键路径。
- **[风险] 选中跨作品的混合（如同一搜索结果页里不同作品）导致交集为空** → 算法返回 null，回退 `批量下载 - N本漫画`。这正是"提取失败时回退"的语义，符合预期。
- **[权衡] 集合交集忽略 token 顺序** → 可能把"作品A 外传" 与 "外传 作品A" 误判为共有 "作品A 外传"。实践中漫画标题极少这种倒装，可接受；且即便拼出怪名，用户在输入框里一眼就能改。
- **[权衡] 作者前缀单独判定而非走交集** → 增加一条独立逻辑分支，但保证了 `[作者]作品名`（无空格）这种边角一定保留作者。值得这点复杂度。
- **[权衡] 分隔符扩展可能切碎含连字符的标题** → 如 `[作者] 作品-第1话` 会切成 `[作者]`/`作品`/`第1话`，交集可能变碎。但实践中"作品名"与"卷话号"本就是不同语义单元，切碎反而更精确；且兜底路径仍可用。

## 开放问题

无。算法细节、阈值（长度 ≥ 2）、回退文案（`批量下载 - ${N}本漫画`）、分隔符集合、日志级别均已实现并验证。
