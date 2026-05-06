# Electron 全栈测试设计

**日期**: 2026-05-06
**目标**: 为 Electron 主进程 + React 渲染层添加全栈测试，整体覆盖率达到 70%+

## 方案选择

**选定方案**: 分层 Mock 架构（方案 A）

各层独立用 Mock 隔离测试，兼顾速度、稳定性和覆盖率。

## 工具链

| 工具 | 用途 |
|------|------|
| Vitest | 测试框架，与 Electron Vite 原生兼容 |
| @testing-library/react | React 组件测试 |
| @testing-library/jest-dom | DOM 断言扩展 |
| @testing-library/user-event | 用户交互模拟 |
| @vitest/coverage-v8 | 覆盖率报告 |
| jsdom | DOM 环境模拟 |

## 项目结构

```
tests/
├── unit/
│   ├── main/               # Electron 主进程测试
│   │   ├── main.test.ts
│   │   └── ipc-handlers.test.ts
│   ├── preload/            # Preload 脚本测试
│   │   └── preload.test.ts
│   ├── hooks/              # React hooks 测试
│   │   ├── useIpc.test.ts
│   │   ├── useSearch.test.ts
│   │   └── useDownload.test.ts
│   ├── stores/             # Zustand stores 测试
│   │   ├── comicStore.test.ts
│   │   ├── downloadStore.test.ts
│   │   └── settingsStore.test.ts
│   └── components/         # React 组件测试
│       ├── ComicCard.test.tsx
│       ├── Sidebar.test.tsx
│       └── ...
├── integration/
│   └── ipc-chain.test.ts   # IPC 端到端调用链
├── setup.ts                # 全局 setup（jsdom 等）
└── __mocks__/              # 共享 mock 文件
    ├── electron.ts
    └── ipc.ts
```

## 各层测试策略

### 主进程 (electron/main.ts)

**Mock 策略**: 模拟 `electron` 模块和 `child_process`

**覆盖内容**:
- 窗口创建和生命周期管理
- 10+ 个 IPC handler 的请求/响应逻辑
- Python 子进程启动和通信
- 配置文件读写
- 错误处理路径

### Preload (electron/preload.ts)

**覆盖内容**:
- `contextBridge.exposeInMainWorld` 调用验证
- 暴露的 API 完整性（方法名、参数、返回值）
- 错误边界处理

### React Hooks (src/hooks/)

**工具**: `@testing-library/react` 的 `renderHook`

**覆盖内容**:
- `useIpc`: IPC 调用、参数传递、响应处理、错误状态
- `useSearch`: 搜索流程、分页、结果缓存
- `useDownload`: 下载启动、进度更新、取消、完成
- 其他 hooks 的状态转换

### Zustand Stores (src/stores/)

**覆盖内容**:
- 初始状态正确性
- 每个 action 的状态变更
- 复杂状态逻辑（批量操作、状态重置）

### React 组件 (src/components/)

**覆盖内容**:
- 各页面组件的正确渲染
- 用户交互（点击、输入、选择）
- 条件渲染（加载态、错误态、空态）
- ComicCard 批量选择交互
- Sidebar 导航切换

### IPC 集成测试

**覆盖内容**:
- 模拟 renderer → preload → main → Python 完整调用链
- 验证各层数据传递完整性
- 错误从 Python 层传递到 renderer 层的链路

## 覆盖率目标

| 层 | 目标 | 优先级 |
|----|------|--------|
| 主进程 | 80%+ | 高 |
| Preload | 90%+ | 高 |
| Hooks | 75%+ | 高 |
| Stores | 85%+ | 中 |
| 组件 | 60%+ | 中 |
| **整体** | **70%+** | - |

## 配置

### vitest.config.ts

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70
      },
      include: ['electron/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/types/**', '**/*.config.*']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared')
    }
  }
})
```

### package.json 脚本

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:ui": "vitest --ui"
}
```

## 依赖

```bash
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```
