import { useRef } from 'react'
import { useInView } from 'motion/react'

/**
 * Sichtbarkeit genau einmal melden. Kein Element erscheint zweimal, kein
 * Abschnitt bewegt sich beim Zurueckscrollen erneut.
 */
export function useInViewOnce<T extends Element = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const sichtbar = useInView(ref, { once: true, margin: '0px 0px -12% 0px' })
  return { ref, sichtbar }
}
