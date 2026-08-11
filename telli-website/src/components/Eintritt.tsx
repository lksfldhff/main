import { m, type HTMLMotionProps } from 'motion/react'
import { useInViewOnce } from '../hooks/useInViewOnce'
import { useReduziert } from '../hooks/useReduziert'
import { EINTRITT_WEG, eintritt, ueberblendung } from '../lib/motion'

type Props = HTMLMotionProps<'div'> & {
  /** Position in der Staffelung, 50 ms je Schritt. */
  index?: number
}

/**
 * Scroll-Eintritt: hoechstens 12 px Weg, 340 ms, gestaffelt — und genau
 * einmal. Beim Zurueckscrollen bewegt sich nichts erneut.
 */
export function Eintritt({ index = 0, children, ...rest }: Props) {
  const reduziert = useReduziert()
  const { ref, sichtbar } = useInViewOnce<HTMLDivElement>()

  return (
    <m.div
      ref={ref}
      initial={reduziert ? { opacity: 0 } : { opacity: 0, y: EINTRITT_WEG }}
      animate={sichtbar ? { opacity: 1, y: 0 } : undefined}
      transition={reduziert ? ueberblendung : { ...eintritt, delay: index * 0.05 }}
      {...rest}
    >
      {children}
    </m.div>
  )
}
