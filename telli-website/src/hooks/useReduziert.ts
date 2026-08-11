import { useReducedMotion } from 'motion/react'

/**
 * `prefers-reduced-motion: reduce`. Kein Zusatzzustand — das ist der Modus,
 * in dem die Zielgruppe an schlechten Tagen surft.
 */
export function useReduziert(): boolean {
  return useReducedMotion() ?? false
}
