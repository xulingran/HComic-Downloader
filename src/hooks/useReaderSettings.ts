import { useCallback, useSyncExternalStore } from 'react'

const PAGE_GAP_KEY = 'hcomic-reader-page-gap'
const IMAGE_WIDTH_KEY = 'hcomic-reader-image-width'

const PAGE_GAP_MIN = 0
const PAGE_GAP_MAX = 80
const PAGE_GAP_DEFAULT = 4

const IMAGE_WIDTH_MIN = 30
const IMAGE_WIDTH_MAX = 100
const IMAGE_WIDTH_DEFAULT = 70

const DISPLAY_MODE_KEY = 'hcomic-reader-display-mode'

const VALID_DISPLAY_MODES = ['scroll', 'single', 'double'] as const
export type DisplayMode = typeof VALID_DISPLAY_MODES[number]
export type BlankPosition = 'none' | 'front' | 'end'
const DISPLAY_MODE_DEFAULT: DisplayMode = 'scroll'

const readerSettingKeys = new Set([PAGE_GAP_KEY, IMAGE_WIDTH_KEY, DISPLAY_MODE_KEY])
const readerSettingListeners = new Set<() => void>()

function subscribeReaderSettings(listener: () => void): () => void {
  readerSettingListeners.add(listener)
  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key && readerSettingKeys.has(event.key)) listener()
  }
  window.addEventListener('storage', handleStorage)
  return () => {
    readerSettingListeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
  }
}

function notifyReaderSettings(): void {
  readerSettingListeners.forEach((listener) => listener())
}

function readStoredValue(key: string, min: number, max: number, fallback: number): number {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < min || parsed > max) return fallback
  return parsed
}

function readDisplayMode(): DisplayMode {
  const raw = localStorage.getItem(DISPLAY_MODE_KEY)
  return raw && (VALID_DISPLAY_MODES as readonly string[]).includes(raw)
    ? raw as DisplayMode
    : DISPLAY_MODE_DEFAULT
}

const readPageGap = () => readStoredValue(PAGE_GAP_KEY, PAGE_GAP_MIN, PAGE_GAP_MAX, PAGE_GAP_DEFAULT)
const readImageWidth = () => readStoredValue(IMAGE_WIDTH_KEY, IMAGE_WIDTH_MIN, IMAGE_WIDTH_MAX, IMAGE_WIDTH_DEFAULT)

export function useReaderSettings() {
  const pageGap = useSyncExternalStore(subscribeReaderSettings, readPageGap, () => PAGE_GAP_DEFAULT)
  const imageWidth = useSyncExternalStore(subscribeReaderSettings, readImageWidth, () => IMAGE_WIDTH_DEFAULT)
  const displayMode = useSyncExternalStore(subscribeReaderSettings, readDisplayMode, () => DISPLAY_MODE_DEFAULT)

  const setPageGap = useCallback((value: number) => {
    const clamped = Math.max(PAGE_GAP_MIN, Math.min(PAGE_GAP_MAX, value))
    localStorage.setItem(PAGE_GAP_KEY, String(clamped))
    notifyReaderSettings()
  }, [])

  const setImageWidth = useCallback((value: number) => {
    const clamped = Math.max(IMAGE_WIDTH_MIN, Math.min(IMAGE_WIDTH_MAX, value))
    localStorage.setItem(IMAGE_WIDTH_KEY, String(clamped))
    notifyReaderSettings()
  }, [])

  const setDisplayMode = useCallback((value: DisplayMode) => {
    if ((VALID_DISPLAY_MODES as readonly string[]).includes(value)) {
      localStorage.setItem(DISPLAY_MODE_KEY, value)
      notifyReaderSettings()
    }
  }, [])

  return { pageGap, imageWidth, setPageGap, setImageWidth, displayMode, setDisplayMode }
}
