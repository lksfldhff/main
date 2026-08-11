import type { ReactNode } from 'react'
import stil from './PhoneFrame.module.css'

type Props = {
  children: ReactNode
  /**
   * `fest` haelt das Seitenverhaeltnis eines iPhone und schneidet ab,
   * `frei` waechst mit dem Inhalt, `hero` wird auf schmalen Geraeten zum
   * vollbreiten Ausschnitt von hoechstens 22rem Hoehe.
   */
  variante?: 'fest' | 'frei' | 'hero'
  className?: string
}

/**
 * Rahmen in rem, damit das Geraet mit der Textgroesse des Nutzers mitwaechst.
 * Kein Rahmenstrich — der Korpus ist eine gefuellte Flaeche.
 */
export function PhoneFrame({ children, variante = 'frei', className }: Props) {
  return (
    <div className={[stil.korpus, stil[variante], className ?? ''].join(' ')}>
      <div className={stil.schirm}>
        <div className={stil.insel} aria-hidden="true" />
        <div className={stil.inhalt}>{children}</div>
        <div className={stil.griffleiste} aria-hidden="true" />
      </div>
    </div>
  )
}
