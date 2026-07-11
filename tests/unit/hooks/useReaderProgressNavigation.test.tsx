import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useReaderProgressNavigation } from '@/hooks/useReaderProgressNavigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function ProgressHarness({ mode = 'scroll' }: { mode?: 'scroll' | 'single' | 'double' }) {
  const [currentPage, setCurrentPage] = useState(1)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const progress = useReaderProgressNavigation({
    totalPages: 10,
    currentPage,
    setCurrentPage,
    displayMode: mode,
    loadingState: 'loaded',
    pageRefs,
  })

  return (
    <>
      <div
        ref={progress.sliderRef}
        role="slider"
        aria-valuemin={1}
        aria-valuemax={10}
        aria-valuenow={currentPage}
        data-frozen={String(progress.freezePageTrackingRef.current)}
        onPointerDown={progress.handleSliderPointerDown}
        onPointerMove={progress.handleSliderPointerMove}
        onPointerUp={progress.handleSliderPointerUp}
        onPointerCancel={progress.cancelDrag}
        onLostPointerCapture={progress.cancelDrag}
      />
      {Array.from({ length: 10 }, (_, index) => (
        <div
          key={index}
          ref={(element) => { pageRefs.current[index] = element }}
          data-testid={`page-${index + 1}`}
        />
      ))}
    </>
  )
}

describe('useReaderProgressNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scrolls the target page immediately while dragging in scroll mode', () => {
    render(<ProgressHarness />)
    const slider = screen.getByRole('slider')
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 24, height: 24, x: 0, y: 0,
    }) as DOMRect)
    slider.setPointerCapture = vi.fn()
    const target = screen.getByTestId('page-5')
    target.scrollIntoView = vi.fn()

    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 })

    expect(slider).toHaveAttribute('aria-valuenow', '5')
    expect(target.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: 'instant', block: 'start' })
    expect(slider).toHaveAttribute('data-frozen', 'true')
  })

  it('updates page state without scrolling in page-flip modes', () => {
    render(<ProgressHarness mode="single" />)
    const slider = screen.getByRole('slider')
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 24, height: 24, x: 0, y: 0,
    }) as DOMRect)
    slider.setPointerCapture = vi.fn()
    const target = screen.getByTestId('page-7')
    target.scrollIntoView = vi.fn()

    fireEvent.pointerDown(slider, { clientX: 140, pointerId: 2 })

    expect(slider).toHaveAttribute('aria-valuenow', '7')
    expect(target.scrollIntoView).toHaveBeenCalledTimes(0)
  })
})
