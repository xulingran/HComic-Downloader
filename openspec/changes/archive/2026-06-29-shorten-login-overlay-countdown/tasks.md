## 1. 修改倒数起始秒数

- [x] 1.1 在 `electron/login-preload.ts` 将 `COUNTDOWN_START` 常量从 `5` 改为 `3`（保留 `/** 倒数起始秒数 */` 注释）
- [x] 1.2 确认 `renderCounting` 函数无需改动（其读取 `COUNTDOWN_START`，自动生效；两个场景：普通 cookie 提取成功 + JM 人机验证成功均由它驱动）

## 2. 同步注释

- [x] 2.1 更新 `electron/login-window.ts` 中 `LOGIN_FINISH_FALLBACK_MS` 上方注释「渲染端倒数默认 5s」为「渲染端倒数默认 3s」（仅文档，逻辑不变；10s 兜底值保持不动）
- [x] 2.2 更新 `electron/login-preload.ts` 顶部叠层注释「成功后倒数 5 秒自动关窗」为「成功后倒数 3 秒自动关窗」

## 3. 同步单测断言

- [x] 3.1 在 `tests/unit/preload/login-preload.test.ts` 将「counting state with countdown number 5」用例的断言 `expect(num.textContent).toBe('5')` 改为 `'3'`，并更新用例标题中的 `5`
- [x] 3.2 将「countdown reaches 0 → fires LOGIN_FINISH」用例的 `vi.advanceTimersByTimeAsync(5_000)` 改为 `3_000`
- [x] 3.3 将「verification success → counting state with countdown 5」用例的断言 `'5'` 改为 `'3'`，并更新用例标题中的 `5`
- [x] 3.4 将「countdown reaches 0 → fires LOGIN_FINISH (closes window)」用例的 `5_000` 改为 `3_000`

## 4. 验证

- [x] 4.1 运行 `npm test`（前端单测，确认 login-preload 测试全绿）
- [x] 4.2 运行 `npx tsc --noEmit`（类型检查）
- [x] 4.3 运行 `npm run lint`（ESLint）
- [x] 4.4 运行 `npm run lint:test-quality`（测试质量闸门）
