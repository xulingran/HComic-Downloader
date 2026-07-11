import { fireEvent, render, screen } from '@testing-library/react'
import { useSliderDrag } from '@/hooks/useSliderDrag'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SliderHarnessProps {
  totalPages?: number
  onPageChange: (page: number) => void
  onDragEnd: (page: number) => void
  onDragStart: () => void
}

function SliderHarness({
  totalPages = 20,
  onPageChange,
  onDragEnd,
  onDragStart,
}: SliderHarnessProps) {
  const slider = useSliderDrag(totalPages, onPageChange, onDragEnd, onDragStart)
  return (
    <div
      ref={slider.sliderRef}
      role="slider"
      aria-valuemin={1}
      aria-valuemax={totalPages}
      aria-valuenow={1}
      data-dragging={String(slider.isDragging)}
      onPointerDown={slider.handleSliderPointerDown}
      onPointerMove={slider.handleSliderPointerMove}
      onPointerUp={slider.handleSliderPointerUp}
      onPointerCancel={slider.cancelDrag}
      onLostPointerCapture={slider.cancelDrag}
    />
  )
}

describe('useSliderDrag', () => {
  const onPageChange = vi.fn()
  const onDragEnd = vi.fn()
  const onDragStart = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderSlider(width = 200) {
    render(
      <SliderHarness
        onPageChange={onPageChange}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
      />,
    )
    const slider = screen.getByRole('slider')
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 0, width, right: width, top: 0, bottom: 24, height: 24, x: 0, y: 0,
    }) as DOMRect)
    slider.setPointerCapture = vi.fn()
    return slider
  }

  it('updates continuously and reports the final page once on pointer up', () => {
    const slider = renderSlider()

    fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 })
    fireEvent.pointerMove(slider, { clientX: 150, pointerId: 1 })
    fireEvent.pointerMove(slider, { clientX: 151, pointerId: 1 })
    fireEvent.pointerUp(slider, { pointerId: 1 })
    fireEvent.pointerUp(slider, { pointerId: 1 })

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onPageChange.mock.calls).toEqual([[5], [15]])
    expect(onDragEnd.mock.calls).toEqual([[15]])
    expect(slider).toHaveAttribute('data-dragging', 'false')
  })

  it('clamps captured pointer movement to the first and last page', () => {
    const slider = renderSlider()

    fireEvent.pointerDown(slider, { clientX: -50, pointerId: 2 })
    fireEvent.pointerMove(slider, { clientX: 350, pointerId: 2 })
    fireEvent.pointerUp(slider, { pointerId: 2 })

    expect(onPageChange.mock.calls).toEqual([[1], [20]])
    expect(onDragEnd.mock.calls).toEqual([[20]])
  })

  it('ignores a zero-width track instead of entering a stuck drag', () => {
    const slider = renderSlider(0)

    fireEvent.pointerDown(slider, { clientX: 0, pointerId: 3 })

    expect(onDragStart).toHaveBeenCalledTimes(0)
    expect(onPageChange).toHaveBeenCalledTimes(0)
    expect(onDragEnd).toHaveBeenCalledTimes(0)
    expect(slider).toHaveAttribute('data-dragging', 'false')
  })

  it('cleans up cancellation idempotently and accepts a later drag', () => {
    const slider = renderSlider()

    fireEvent.pointerDown(slider, { clientX: 50, pointerId: 4 })
    fireEvent.pointerCancel(slider, { pointerId: 4 })
    fireEvent.lostPointerCapture(slider, { pointerId: 4 })
    expect(slider).toHaveAttribute('data-dragging', 'false')
    expect(onDragEnd).toHaveBeenCalledTimes(0)

    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 5 })
    fireEvent.pointerUp(slider, { pointerId: 5 })

    expect(onDragStart).toHaveBeenCalledTimes(2)
    expect(onPageChange.mock.calls).toEqual([[5], [10]])
    expect(onDragEnd.mock.calls).toEqual([[10]])
  })
})
