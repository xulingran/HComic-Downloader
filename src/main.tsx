import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// React 接管首屏后，显式卸载 index.html 原生骨架屏订阅的 STARTUP_PROGRESS 监听器。
// DOM 虽已被 createRoot().render() 替换（回调靠 null 保护静默失效），但 ipcRenderer
// 监听器仍残留——此处调用 index.html 暴露的 teardown 释放它（PP-40 资源释放）。
// render() 是同步的，执行到此时 #root 已替换为 React 树。
;(window as unknown as { __teardownStartupProgress?: () => void }).__teardownStartupProgress?.()
