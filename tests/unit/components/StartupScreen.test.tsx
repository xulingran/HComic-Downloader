import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StartupScreen } from '@/components/StartupScreen'

describe('StartupScreen', () => {
  it('应渲染 logo、spinner、启动文案', () => {
    render(<StartupScreen percent={0} label="正在启动应用…" done={false} />)

    expect(screen.getByAltText('HComic Downloader')).toBeInTheDocument()
    expect(screen.getByText('HComic Downloader 启动中…')).toBeInTheDocument()
  })

  it('应渲染当前阶段文案', () => {
    render(<StartupScreen percent={50} label="下载引擎已就绪" done={false} />)

    expect(screen.getByText('下载引擎已就绪')).toBeInTheDocument()
  })

  it('应渲染百分比文字', () => {
    render(<StartupScreen percent={42} label="初始化中" done={false} />)

    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('percent 变化时进度条宽度应更新', () => {
    const { rerender } = render(<StartupScreen percent={25} label="A" done={false} />)

    // 进度条填充元素：查找带 width 内联样式的 div
    // 先断言 25% 状态
    const fillAt25 = document.querySelector('[style*="width: 25%"]')
    expect(fillAt25).not.toBeNull()

    rerender(<StartupScreen percent={75} label="B" done={false} />)
    const fillAt75 = document.querySelector('[style*="width: 75%"]')
    expect(fillAt75).not.toBeNull()
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('label 同步更新', () => {
    const { rerender } = render(<StartupScreen percent={25} label="配置已加载" done={false} />)
    expect(screen.getByText('配置已加载')).toBeInTheDocument()

    rerender(<StartupScreen percent={50} label="下载引擎已就绪" done={false} />)
    expect(screen.getByText('下载引擎已就绪')).toBeInTheDocument()
    expect(screen.queryByText('配置已加载')).not.toBeInTheDocument()
  })
})
