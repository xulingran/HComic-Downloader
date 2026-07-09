import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingOverlay } from '@/components/common/LoadingOverlay'

describe('LoadingOverlay', () => {
  it('light 档使用 backdrop-blur-[8px] + bg/80，旧结果基本不可辨认', () => {
    const { container } = render(<LoadingOverlay intensity="light" />)
    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.className).toContain('backdrop-blur-[8px]')
    expect(overlay.className).toContain('bg-[var(--bg-primary)]/80')
    // 与 strong 档互斥
    expect(overlay.className).not.toContain('backdrop-blur-[16px]')
    expect(overlay.className).not.toContain('bg-[var(--bg-primary)]/92')
  })

  it('遮罩覆盖整个视口（fixed inset-0），spinner 在视口正中而非网格容器中心', () => {
    const { container } = render(<LoadingOverlay intensity="light" />)
    const overlay = container.firstElementChild as HTMLElement
    // fixed inset-0：相对视口定位，确保高/矮内容下 spinner 都在视口正中
    expect(overlay.className).toContain('fixed')
    expect(overlay.className).toContain('inset-0')
    expect(overlay.className).not.toContain('absolute')
    expect(overlay.className).toContain('z-50')
  })

  it('strong 档使用 backdrop-blur-[16px] + bg/92，旧结果几乎完全遮蔽', () => {
    const { container } = render(<LoadingOverlay intensity="strong" />)
    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.className).toContain('backdrop-blur-[16px]')
    expect(overlay.className).toContain('bg-[var(--bg-primary)]/92')
    expect(overlay.className).not.toContain('backdrop-blur-[8px]')
    expect(overlay.className).not.toContain('bg-[var(--bg-primary)]/80')
  })

  it('居中渲染不确定性 spinner（rounded-full + motion-safe:animate-spin，非确定性进度环）', () => {
    const { container } = render(<LoadingOverlay intensity="light" />)
    const spinner = container.querySelector('.rounded-full.motion-safe\\:animate-spin')
    expect(spinner).not.toBeNull()
    // spinner 是不确定性动画，不含确定性进度环的 stroke-dashoffset / circle 结构
    expect(container.querySelector('circle')).toBeNull()
    expect(spinner?.className).toContain('border-t-[var(--accent)]')
  })

  it('默认文案为「加载中...」，作为强遮罩下的语义锚点', () => {
    render(<LoadingOverlay intensity="light" />)
    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('自定义文案透传', () => {
    render(<LoadingOverlay intensity="strong" text="正在加载第 3 页" />)
    expect(screen.getByText('正在加载第 3 页')).toBeInTheDocument()
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
  })
})
