import { motion } from 'framer-motion'
import {
  getReducedReaderModeVariants,
  readerModeFadeVariants,
} from '../../lib/anim'
import type { ReaderModeTransitionPhase } from '../../hooks/useReaderModeTransition'

interface ReaderModeStageProps {
  phase: ReaderModeTransitionPhase
  reduceMotion: boolean
  children: React.ReactNode
}

export function ReaderModeStage({ phase, reduceMotion, children }: ReaderModeStageProps) {
  const hidden = phase === 'exiting' || phase === 'preparing'
  const transitioning = phase !== 'idle'

  return (
    <motion.div
      data-testid="reader-mode-stage"
      data-phase={phase}
      variants={reduceMotion ? getReducedReaderModeVariants() : readerModeFadeVariants}
      initial={false}
      animate={hidden ? 'hidden' : 'visible'}
      className="flex-1 min-h-0 overflow-hidden flex"
      style={{ pointerEvents: transitioning ? 'none' : undefined }}
    >
      {children}
    </motion.div>
  )
}
