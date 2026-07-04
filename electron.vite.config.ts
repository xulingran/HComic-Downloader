import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          preload: path.resolve(__dirname, 'electron/preload.ts'),
          'login-preload': path.resolve(__dirname, 'electron/login-preload.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    root: '.',
    // 固定 dev server 到 loopback：TUN 模式代理（Clash/Mihomo 等）冷启动时会
    // 劫持 localhost 流量，固定到 127.0.0.1:5173 + strictPort 让 session 级
    // bypass 规则可稳定匹配，并避免端口漂移导致 dev server 首次加载失败。
    // 见 specs/dev-server-connectivity。
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      hmr: { host: '127.0.0.1', port: 5173, protocol: 'ws' },
    },
    define: {
      __APP_NAME__: JSON.stringify(pkg.name),
      __APP_DESCRIPTION__: JSON.stringify(pkg.description),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'index.html')
        },
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'framer-motion': ['framer-motion'],
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './shared')
      }
    }
  }
})
