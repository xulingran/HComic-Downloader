import { useCallback, useEffect, useRef, useState } from 'react'
import { DURATION, useReducedMotionPreference } from '../lib/anim'
import { resolveReaderModeTarget, type ReaderModeTarget } from '../lib/reader-mode'
import type { BlankPosition, DisplayMode } from './useReaderSettings'

export type ReaderModeTransitionPhase = 'idle' | 'exiting' | 'preparing' | 'entering'

interface ReaderModeTransitionOptions {
  displayMode: DisplayMode
  setDisplayMode: (mode: DisplayMode) => void
  currentPage: number
  setCurrentPage: (page: number) => void
  totalPages: number
  blankPosition: BlankPosition
  setBlankPosition: (position: BlankPosition) => void
  enabled?: boolean
  prepareTarget?: (mode: DisplayMode, anchorPage: number) => boolean
  reduceMotionOverride?: boolean
}

const PREPARE_RETRY_MS = 16
const MAX_PREPARE_ATTEMPTS = 3

function isPagedMode(mode: DisplayMode): boolean {
  return mode !== 'scroll'
}

export function useReaderModeTransition({
  displayMode,
  setDisplayMode,
  currentPage,
  setCurrentPage,
  totalPages,
  blankPosition,
  setBlankPosition,
  enabled = true,
  prepareTarget,
  reduceMotionOverride,
}: ReaderModeTransitionOptions) {
  const systemReduceMotion = useReducedMotionPreference()
  const reduceMotion = reduceMotionOverride ?? systemReduceMotion
  const [visibleMode, setVisibleMode] = useState(displayMode)
  const [targetMode, setTargetMode] = useState(displayMode)
  const [phase, setPhase] = useState<ReaderModeTransitionPhase>('idle')
  const [modeRevision, setModeRevision] = useState(0)

  const visibleModeRef = useRef(visibleMode)
  const targetModeRef = useRef(targetMode)
  const phaseRef = useRef(phase)
  const currentPageRef = useRef(currentPage)
  const blankPositionRef = useRef(blankPosition)
  const tokenRef = useRef(0)
  const pendingTargetRef = useRef<ReaderModeTarget | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const externalModeRef = useRef(displayMode)
  const callbacksRef = useRef({
    setDisplayMode,
    setCurrentPage,
    setBlankPosition,
    prepareTarget,
  })

  // Keep the latest page/blank values available to deferred resolve paths so
  // the exiting→preparing timer cannot commit a target computed from a stale
  // page (e.g. a slider drag that landed during the 150ms exit window).
  useEffect(() => {
    currentPageRef.current = currentPage
    blankPositionRef.current = blankPosition
  }, [currentPage, blankPosition])

  useEffect(() => {
    callbacksRef.current = { setDisplayMode, setCurrentPage, setBlankPosition, prepareTarget }
  }, [prepareTarget, setBlankPosition, setCurrentPage, setDisplayMode])

  const setTransitionPhase = useCallback((next: ReaderModeTransitionPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const finishTransition = useCallback((token: number) => {
    if (!mountedRef.current || token !== tokenRef.current) return
    clearTimer()
    pendingTargetRef.current = null
    setTransitionPhase('idle')
  }, [clearTimer, setTransitionPhase])

  const scheduleFinish = useCallback((token: number) => {
    clearTimer()
    const duration = (reduceMotion ? DURATION.fast : DURATION.slow) * 1000
    timerRef.current = setTimeout(() => finishTransition(token), duration)
  }, [clearTimer, finishTransition, reduceMotion])

  const commitTarget = useCallback((mode: DisplayMode, resolved: ReaderModeTarget) => {
    callbacksRef.current.setCurrentPage(resolved.targetPage)
    callbacksRef.current.setBlankPosition(resolved.targetBlankPosition)
    callbacksRef.current.setDisplayMode(mode)
    visibleModeRef.current = mode
    setVisibleMode(mode)
    setModeRevision((revision) => revision + 1)
  }, [])

  const beginPrepare = useCallback((token: number, mode: DisplayMode) => {
    if (!mountedRef.current || token !== tokenRef.current) return
    // Re-resolve at the exit→prepare boundary using the latest page/blank so a
    // page change during the exit window cannot commit a stale anchor.
    const resolved = resolveReaderModeTarget(
      visibleModeRef.current,
      mode,
      currentPageRef.current,
      totalPages,
      blankPositionRef.current,
    )
    pendingTargetRef.current = resolved
    commitTarget(mode, resolved)
    setTransitionPhase('preparing')
  }, [commitTarget, setTransitionPhase, totalPages])

  const requestDisplayMode = useCallback((mode: DisplayMode) => {
    if (mode === targetModeRef.current && phaseRef.current !== 'idle') return
    if (mode === visibleModeRef.current && phaseRef.current === 'idle') return

    clearTimer()
    const token = ++tokenRef.current
    targetModeRef.current = mode
    setTargetMode(mode)

    const resolved = resolveReaderModeTarget(
      visibleModeRef.current,
      mode,
      currentPage,
      totalPages,
      blankPosition,
    )
    pendingTargetRef.current = resolved

    if (!enabled || totalPages <= 0) {
      commitTarget(mode, resolved)
      finishTransition(token)
      return
    }

    if (mode === visibleModeRef.current) {
      callbacksRef.current.setDisplayMode(mode)
      pendingTargetRef.current = null
      setTransitionPhase('idle')
      return
    }

    if (isPagedMode(visibleModeRef.current) && isPagedMode(mode)) {
      commitTarget(mode, resolved)
      setTransitionPhase('entering')
      scheduleFinish(token)
      return
    }

    setTransitionPhase('exiting')
    timerRef.current = setTimeout(() => {
      if (!mountedRef.current || token !== tokenRef.current) return
      const latestMode = targetModeRef.current
      beginPrepare(token, latestMode)
    }, DURATION.fast * 1000)
  }, [
    beginPrepare,
    blankPosition,
    clearTimer,
    commitTarget,
    currentPage,
    enabled,
    finishTransition,
    scheduleFinish,
    setTransitionPhase,
    totalPages,
  ])

  useEffect(() => {
    if (phase !== 'preparing') return
    const token = tokenRef.current
    let attempt = 0
    let prepareTimer: ReturnType<typeof setTimeout> | null = null

    const prepare = () => {
      if (!mountedRef.current || token !== tokenRef.current || phaseRef.current !== 'preparing') return
      attempt += 1
      const pending = pendingTargetRef.current
      const ready = !pending || callbacksRef.current.prepareTarget?.(visibleModeRef.current, pending.anchorPage) !== false
      if (ready || attempt >= MAX_PREPARE_ATTEMPTS) {
        setTransitionPhase('entering')
        scheduleFinish(token)
        return
      }
      prepareTimer = setTimeout(prepare, PREPARE_RETRY_MS)
    }

    prepareTimer = setTimeout(prepare, 0)
    return () => {
      if (prepareTimer !== null) clearTimeout(prepareTimer)
    }
  }, [phase, scheduleFinish, setTransitionPhase])

  useEffect(() => {
    if (externalModeRef.current === displayMode) return
    externalModeRef.current = displayMode
    if (displayMode === targetModeRef.current) return

    clearTimer()
    tokenRef.current += 1
    visibleModeRef.current = displayMode
    targetModeRef.current = displayMode
    setVisibleMode(displayMode)
    setTargetMode(displayMode)
    setTransitionPhase('idle')
  }, [clearTimer, displayMode, setTransitionPhase])

  useEffect(() => {
    // React.StrictMode intentionally runs effect setup -> cleanup -> setup in
    // development. Restore the mounted flag in setup so the second (real)
    // lifecycle can still commit and finish transitions. Without this reset,
    // the cleanup probe leaves mountedRef=false forever: scroll transitions
    // remain hidden in `exiting`, while paged reflows remain input-locked in
    // `entering`.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      tokenRef.current += 1
      clearTimer()
    }
  }, [clearTimer])

  return {
    visibleMode,
    targetMode,
    phase,
    modeRevision,
    isModeTransitioning: phase !== 'idle',
    reduceMotion,
    requestDisplayMode,
  }
}
