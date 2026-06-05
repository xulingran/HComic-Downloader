import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CircularProgress } from '@/components/common/CircularProgress'

describe('CircularProgress', () => {
  it('renders SVG with correct width and height attributes', () => {
    const { container } = render(<CircularProgress progress={50} size={40} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('width', '40')
    expect(svg).toHaveAttribute('height', '40')
  })

  it('shows percentage text when showText=true and size >= 28', () => {
    const { container } = render(<CircularProgress progress={42} size={32} showText={true} />)
    const text = container.querySelector('text')
    expect(text).toBeInTheDocument()
    expect(text!.textContent).toBe('42')
  })

  it('does NOT show text when showText=false', () => {
    const { container } = render(<CircularProgress progress={50} size={32} showText={false} />)
    const text = container.querySelector('text')
    expect(text).not.toBeInTheDocument()
  })

  it('does NOT show text when size < 28', () => {
    const { container } = render(<CircularProgress progress={50} size={24} showText={true} />)
    const text = container.querySelector('text')
    expect(text).not.toBeInTheDocument()
  })

  it('uses correct stroke color for downloading status (var(--accent))', () => {
    const { container } = render(<CircularProgress progress={50} status="downloading" />)
    const circles = container.querySelectorAll('circle')
    // Second circle is the progress arc
    expect(circles[1]).toHaveAttribute('stroke', 'var(--accent)')
  })

  it('uses correct stroke color for failed status (#ef4444)', () => {
    const { container } = render(<CircularProgress progress={50} status="failed" />)
    const circles = container.querySelectorAll('circle')
    expect(circles[1]).toHaveAttribute('stroke', '#ef4444')
  })

  it('uses correct stroke color for completed status (#22c55e)', () => {
    const { container } = render(<CircularProgress progress={100} status="completed" />)
    const circles = container.querySelectorAll('circle')
    expect(circles[1]).toHaveAttribute('stroke', '#22c55e')
  })

  it('applies animate-spin class when status=queued and progress=0', () => {
    const { container } = render(<CircularProgress progress={0} status="queued" />)
    const svg = container.querySelector('svg')!
    expect(svg.className.baseVal ?? svg.getAttribute('class')).toContain('animate-spin')
  })

  it('does NOT apply animate-spin when status is not queued', () => {
    const { container } = render(<CircularProgress progress={50} status="downloading" />)
    const svg = container.querySelector('svg')!
    const classStr = svg.className.baseVal ?? svg.getAttribute('class') ?? ''
    expect(classStr).not.toContain('animate-spin')
  })

  it('calculates correct strokeDashoffset based on progress', () => {
    const size = 32
    const strokeWidth = 3
    const radius = (size - strokeWidth) / 2
    const circumference = 2 * Math.PI * radius
    const progress = 75
    const expectedOffset = circumference * (1 - progress / 100)

    const { container } = render(
      <CircularProgress progress={progress} size={size} strokeWidth={strokeWidth} />
    )
    const circles = container.querySelectorAll('circle')
    expect(circles[1].getAttribute('stroke-dashoffset')).toBe(String(expectedOffset))
  })
})
