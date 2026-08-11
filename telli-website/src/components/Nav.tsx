import { useEffect, useState } from 'react'
import stil from './Nav.module.css'

const PUNKTE = [
  { id: 'erfassen', label: 'Erfassen', immer: true },
  { id: 'medikamente', label: 'Medikamente', immer: false },
  { id: 'zusammenhaenge', label: 'Zusammenhänge', immer: true },
  { id: 'datenschutz', label: 'Datenschutz', immer: false },
]

/**
 * Schwebende, transluzente Pille — der Inhalt scrollt darunter. Auf schmalen
 * Geraeten sitzt sie unten, dort ist der Daumen.
 */
export function Nav() {
  const [aktiv, setAktiv] = useState<string | null>(null)

  useEffect(() => {
    const abschnitte = PUNKTE.map((punkt) => document.getElementById(punkt.id)).filter(
      (el): el is HTMLElement => el !== null,
    )
    if (abschnitte.length === 0) return

    const beobachter = new IntersectionObserver(
      (eintraege) => {
        const sichtbar = eintraege.filter((e) => e.isIntersecting)
        if (sichtbar.length > 0) setAktiv(sichtbar[0].target.id)
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    abschnitte.forEach((el) => beobachter.observe(el))
    return () => beobachter.disconnect()
  }, [])

  return (
    <>
      <div className={stil.maske} aria-hidden="true" />
      <nav className={stil.leiste} aria-label="Abschnitte">
        <div className={stil.pille}>
          <a className={stil.marke} href="#oben">
            telli.
          </a>
          <ul className={stil.punkte}>
            {PUNKTE.map((punkt) => (
              <li key={punkt.id} className={punkt.immer ? stil.immer : stil.breitOnly}>
                <a
                  className={stil.punkt}
                  href={`#${punkt.id}`}
                  aria-current={aktiv === punkt.id ? 'true' : undefined}
                >
                  {punkt.label}
                </a>
              </li>
            ))}
          </ul>
          <a className={stil.cta} href="#warteliste">
            Warteliste
          </a>
        </div>
      </nav>
    </>
  )
}
