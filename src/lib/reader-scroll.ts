/**
 * Anchors a reader scroll-mode entry to a page and keeps it pinned while images
 * decode and inflate the long list.
 *
 * The reader mode coordinator mounts the scroll container hidden, then calls
 * this helper during the `preparing` phase. A single `scrollIntoView` at that
 * moment is unreliable: page divs exist but their heights grow as images
 * decode, so later content pushes the anchor out of the viewport top. We
 * therefore watch the anchor element with a ResizeObserver and re-scroll to it
 * (instant) until its size stops changing or the settle budget is exhausted.
 *
 * Contract:
 * - Returns `false` only when the anchor element is missing (caller may retry
 *   within its own frame budget). Returns `true` once the first scroll has been
 *   issued; subsequent re-scrolls happen asynchronously via ResizeObserver.
 * - The observer detaches itself after `maxSettleFrames` size-stable samples or
 *   on `clear`, so it never leaks past the transition.
 */

const RESIZE_SETTLE_MS = 240
const MAX_SETTLE_FRAMES = 8

export interface ScrollAnchorController {
  clear: () => void
}

function instantScrollIntoView(element: HTMLElement): void {
  element.scrollIntoView({ behavior: 'instant', block: 'start' })
}

/**
 * Scrolls `anchorPage` into view (1-based) and pins it while the list settles.
 * `pageElements` is a zero-indexed accessor returning the page container or null.
 */
export function prepareScrollAnchor(
  getPageElement: (zeroIndex: number) => HTMLElement | null,
  anchorPage: number,
): ScrollAnchorController {
  if (anchorPage <= 0) return { clear: () => {} }

  const element = getPageElement(anchorPage - 1)
  if (!element) return { clear: () => {} }

  instantScrollIntoView(element)

  let lastHeight = element.offsetHeight
  let lastWidth = element.offsetWidth
  let stableFrames = 0
  let cleared = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let observer: ResizeObserver | null = null

  const stop = () => {
    if (cleared) return
    cleared = true
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    observer?.disconnect()
    observer = null
  }

  const ResizableObserverCtor: typeof ResizeObserver | undefined =
    typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined

  if (ResizableObserverCtor) {
    observer = new ResizableObserverCtor(() => {
      if (cleared) return
      const height = element.offsetHeight
      const width = element.offsetWidth
      if (height === lastHeight && width === lastWidth) {
        stableFrames += 1
        if (stableFrames >= MAX_SETTLE_FRAMES) {
          stop()
          return
        }
      } else {
        stableFrames = 0
        lastHeight = height
        lastWidth = width
        instantScrollIntoView(element)
      }
    })
    observer.observe(element)
    // Hard budget: even if ResizeObserver keeps firing (very long galleries),
    // stop re-scrolling after RESIZE_SETTLE_MS so the entering phase is not
    // delayed beyond the 300ms mode-transition ceiling.
    settleTimer = setTimeout(stop, RESIZE_SETTLE_MS)
  }

  return { clear: stop }
}
