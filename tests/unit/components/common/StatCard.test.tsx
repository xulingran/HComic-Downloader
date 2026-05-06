import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatCard } from '@/components/common/StatCard'

describe('StatCard', () => {
  it('renders title', () => {
    render(<StatCard title="总下载" value={42} icon="📥" color="var(--accent)" />)

    expect(screen.getByText('总下载')).toBeInTheDocument()
  })

  it('renders numeric value', () => {
    render(<StatCard title="总下载" value={42} icon="📥" color="var(--accent)" />)

    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders string value', () => {
    render(<StatCard title="总大小" value="1.5 GB" icon="💾" color="var(--warning)" />)

    expect(screen.getByText('1.5 GB')).toBeInTheDocument()
  })

  it('renders icon', () => {
    render(<StatCard title="已完成" value={10} icon="✅" color="var(--success)" />)

    expect(screen.getByText('✅')).toBeInTheDocument()
  })

  it('renders subtitle when provided', () => {
    render(
      <StatCard
        title="失败"
        value={5}
        icon="❌"
        color="var(--error)"
        subtitle="50% 成功率"
      />
    )

    expect(screen.getByText('50% 成功率')).toBeInTheDocument()
  })

  it('does not render subtitle when not provided', () => {
    const { container } = render(
      <StatCard title="总下载" value={42} icon="📥" color="var(--accent)" />
    )

    // The subtitle div should not exist
    const valueEl = screen.getByText('42')
    // subtitle would be a sibling after value
    expect(valueEl.nextElementSibling).toBeNull()
  })
})
