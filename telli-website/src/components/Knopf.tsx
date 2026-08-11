import { m, type HTMLMotionProps } from 'motion/react'
import { useReduziert } from '../hooks/useReduziert'
import { feder } from '../lib/motion'
import stil from './Knopf.module.css'

type Art = 'primaer' | 'sekundaer' | 'hell' | 'leise'

type Props = Omit<HTMLMotionProps<'button'>, 'ref'> & {
  art?: Art
  /** Ueber die volle Breite des Elternelements. */
  breit?: boolean
}

/**
 * Antwort auf `pointerdown`, nicht auf `click` — `whileTap` greift beim
 * Druck, nicht beim Loslassen.
 */
export function Knopf({ art = 'primaer', breit = false, className, ...rest }: Props) {
  const reduziert = useReduziert()
  return (
    <m.button
      type="button"
      className={[stil.knopf, stil[art], breit ? stil.breit : '', className ?? ''].join(' ')}
      whileTap={reduziert ? undefined : { scale: 0.97 }}
      transition={feder}
      {...rest}
    />
  )
}
