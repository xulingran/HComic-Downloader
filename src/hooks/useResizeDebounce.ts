import { useEffect, useRef } from 'react'

/**
 * Debounced resize observer hook.
 * Calls callback 100ms after the last resize event.
 * Used for recalculating card grid columns on window resize.
 */
export function useResizeDebounce(callback: () => void, delayMs = 100) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = useRef(callback)
  callbackRef.current = callback // eslint-disable-line react-hooks/refs

  useEffect(() => {
    const handleResize = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        callbackRef.current()
      }, delayMs)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [delayMs])
}