import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReaderModeStage } from '@/components/common/ReaderModeStage'

describe('ReaderModeStage', () => {
  it('fades a hundreds-page viewport without transforming or promoting the long list', () => {
    render(
      <ReaderModeStage phase="exiting" reduceMotion={false}>
        <div data-testid="long-reader-list">
          {Array.from({ length: 300 }, (_, index) => <div key={index}>page {index + 1}</div>)}
        </div>
      </ReaderModeStage>,
    )

    const stage = screen.getByTestId('reader-mode-stage')
    expect(screen.getByTestId('long-reader-list').children).toHaveLength(300)
    expect(stage.style.transform).toBe('')
    expect(stage.style.willChange).toBe('')
    expect(stage).toHaveStyle({ pointerEvents: 'none' })
  })
})
