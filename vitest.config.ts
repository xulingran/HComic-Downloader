import { defineConfig } from 'vitest/config'
import path from 'path'

// 测试始终需要 React 的 development build：@testing-library/react 依赖 act()，
// 而 react/index.js 会根据 NODE_ENV 选择 development / production.min。
// 外部 shell 若已设置 NODE_ENV=production（如构建脚本泄漏），会污染 vitest 进程，
// 导致全部组件测试报 "act(...) is not supported in production builds of React"。
// 在此强制为 development，保证测试环境可复现。
process.env.NODE_ENV = 'development'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
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
