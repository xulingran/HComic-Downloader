import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { AboutPage } from '@/pages/AboutPage'

const openUrl = vi.fn()

beforeAll(() => {
  Object.assign(globalThis, {
    __APP_NAME__: 'hcomic-downloader',
    __APP_DESCRIPTION__: 'HComic Downloader - Electron Edition',
    __APP_VERSION__: '1.0.0',
  })
})

beforeEach(() => {
  openUrl.mockClear()
  window.hcomic = { openUrl } as typeof window.hcomic
})

describe('AboutPage', () => {
  it('opens the repository through the Electron external URL API', () => {
    render(<AboutPage />)

    const repositoryLink = screen.getByRole('link', {
      name: 'https://github.com/xulingran/HComic-Downloader',
    })

    expect(screen.getByText('仓库地址')).toBeInTheDocument()
    expect(repositoryLink).toHaveAttribute('href', 'https://github.com/xulingran/HComic-Downloader')
    fireEvent.click(repositoryLink)

    expect(openUrl).toHaveBeenCalledWith('https://github.com/xulingran/HComic-Downloader')
  })
})
