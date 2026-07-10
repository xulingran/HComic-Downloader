import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InlineLoading } from '@/components/common/InlineLoading'

describe('InlineLoading', () => {
  it('居中渲染不确定性 spinner（rounded-full + motion-safe:animate-spin，非确定性进度环）', () => {
    const { container } = render(<InlineLoading />)
    const spinner = container.querySelector('.rounded-full.motion-safe\\:animate-spin')
    expect(spinner).not.toBeNull()
    // spinner 环样式与 LoadingOverlay / PageSkeleton 一致
    expect(spinner?.className).toContain('border-t-[var(--accent)]')
    expect(spinner?.className).toContain('border-[var(--text-tertiary)]')
    expect(spinner?.className).toContain('w-8 h-8')
    // 不确定性动画，不含确定性进度环的 circle 结构
    expect(container.querySelector('circle')).toBeNull()
  })

  it('外层容器含 py-12 / gap-3 / flex flex-col 居中布局', () => {
    const { container } = render(<InlineLoading />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('flex')
    expect(wrapper.className).toContain('flex-col')
    expect(wrapper.className).toContain('items-center')
    expect(wrapper.className).toContain('justify-center')
    expect(wrapper.className).toContain('gap-3')
    expect(wrapper.className).toContain('py-12')
  })

  it('默认文案为「加载中...」', () => {
    render(<InlineLoading />)
    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('自定义文案透传且默认文案消失', () => {
    render(<InlineLoading text="正在加载第 3 页" />)
    expect(screen.getByText('正在加载第 3 页')).toBeInTheDocument()
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
  })

  it('text="" 时不渲染文案节点', () => {
    render(<InlineLoading text="" />)
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
    // spinner 仍存在
    expect(document.querySelector('.rounded-full.motion-safe\\:animate-spin')).not.toBeNull()
  })

  it('className 合并到外层容器（在 py-12 之后）', () => {
    const { container } = render(<InlineLoading className="h-full" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('py-12')
    expect(wrapper.className).toContain('h-full')
  })
})
