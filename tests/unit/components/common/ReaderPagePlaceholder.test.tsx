import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ReaderPagePlaceholder } from '@/components/common/ReaderPagePlaceholder'

describe('ReaderPagePlaceholder', () => {
  it('uses reader background color #1a1a2e (not theme-driven)', () => {
    const { container } = render(<ReaderPagePlaceholder />)
    const placeholder = container.firstElementChild as HTMLElement
    // jsdom 把 #1a1a2e 解析为 rgb(26, 26, 46)；断言 rgb 形式更稳健
    expect(placeholder.style.backgroundColor).toBe('rgb(26, 26, 46)')
  })

  it('maintains 3/4 aspect ratio to avoid height jump on load', () => {
    const { container } = render(<ReaderPagePlaceholder />)
    const placeholder = container.firstElementChild as HTMLElement
    expect(placeholder.style.aspectRatio).toBe('3 / 4')
  })

  it('renders a spinner with animate-spin', () => {
    const { container } = render(<ReaderPagePlaceholder />)
    const spinner = container.querySelector('svg.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('uses gray-400 for sufficient contrast on dark background', () => {
    const { container } = render(<ReaderPagePlaceholder />)
    const spinner = container.querySelector('svg.animate-spin')!
    // SVG 元素的 className 是 SVGAnimatedString，用 getAttribute 取类字符串
    expect(spinner.getAttribute('class')).toContain('text-gray-400')
  })

  it('is marked aria-hidden (placeholder is not content)', () => {
    const { container } = render(<ReaderPagePlaceholder />)
    const placeholder = container.firstElementChild as HTMLElement
    expect(placeholder).toHaveAttribute('aria-hidden')
  })

  it('applies custom className for outer sizing', () => {
    const { container } = render(<ReaderPagePlaceholder className="h-full w-full" />)
    const placeholder = container.firstElementChild as HTMLElement
    expect(placeholder.className).toContain('h-full')
    expect(placeholder.className).toContain('w-full')
  })
})
