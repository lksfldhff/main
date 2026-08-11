import { useEffect, useId, useRef, useState } from 'react'
import { m } from 'motion/react'
import { useInViewOnce } from '../hooks/useInViewOnce'
import { useReduziert } from '../hooks/useReduziert'
import { feder, ueberblendung } from '../lib/motion'
import {
  ZEITRAEUME,
  ZEITRAUM_REIHENFOLGE,
  balkenFarbe,
  bezugsText,
  guete,
  type Faktor,
  type Zeitraum,
  type ZeitraumSchluessel,
} from '../lib/data'
import stil from './InsightChart.module.css'

const KURVE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

/**
 * Merkt sich, ob der erste Eintritt schon gelaufen ist. Danach werden
 * Balkenhoehen nur noch gemorpht — ohne Staffelung, ohne Neuaufbau.
 */
function useErsterEintritt(sichtbar: boolean) {
  const erste = useRef(true)
  useEffect(() => {
    if (!sichtbar) return
    const marke = window.setTimeout(() => {
      erste.current = false
    }, 1200)
    return () => window.clearTimeout(marke)
  }, [sichtbar])
  return erste
}

function ZeitraumSchalter({
  aktiv,
  aufWechsel,
  id,
}: {
  aktiv: ZeitraumSchluessel
  aufWechsel: (s: ZeitraumSchluessel) => void
  id: string
}) {
  const reduziert = useReduziert()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const beiTaste = (e: React.KeyboardEvent, i: number) => {
    const anzahl = ZEITRAUM_REIHENFOLGE.length
    let neu: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        neu = (i + 1) % anzahl
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        neu = (i - 1 + anzahl) % anzahl
        break
      case 'Home':
        neu = 0
        break
      case 'End':
        neu = anzahl - 1
        break
      default:
        return
    }
    e.preventDefault()
    aufWechsel(ZEITRAUM_REIHENFOLGE[neu])
    refs.current[neu]?.focus()
  }

  return (
    <div className={stil.pille} role="tablist" aria-label="Zeitraum der Auswertung">
      {ZEITRAUM_REIHENFOLGE.map((schluessel, i) => {
        const an = schluessel === aktiv
        return (
          <button
            key={schluessel}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${schluessel}`}
            aria-selected={an}
            aria-controls={`${id}-panel`}
            tabIndex={an ? 0 : -1}
            className={stil.tab}
            onClick={() => aufWechsel(schluessel)}
            onKeyDown={(e) => beiTaste(e, i)}
          >
            {an && (
              <m.span
                layoutId={`${id}-aktiv`}
                className={stil.tabAktiv}
                transition={reduziert ? ueberblendung : feder}
              />
            )}
            <span className={stil.tabText}>{ZEITRAEUME[schluessel].kurz}</span>
          </button>
        )
      })}
    </div>
  )
}

function Kennzahlen({ zeitraum }: { zeitraum: Zeitraum }) {
  const zahlen = [
    { wert: String(zeitraum.kopfschmerztage), label: 'Kopfschmerztage' },
    { wert: zeitraum.intensitaet, label: '⌀ Intensität' },
    { wert: zeitraum.dauer, label: '⌀ Dauer' },
    { wert: `${zeitraum.pause} Tage`, label: 'längste Pause' },
  ]
  return (
    <ul className={stil.kennzahlen}>
      {zahlen.map((zahl) => (
        <li key={zahl.label} className={stil.kachel}>
          <span className={stil.kachelWert}>{zahl.wert}</span>
          <span className={stil.kachelLabel}>{zahl.label}</span>
        </li>
      ))}
    </ul>
  )
}

function WochenVerlauf({ zeitraum }: { zeitraum: Zeitraum }) {
  const reduziert = useReduziert()
  const { ref, sichtbar } = useInViewOnce<HTMLDivElement>()
  const erste = useErsterEintritt(sichtbar)
  const hoechster = Math.max(...zeitraum.wochen.map((w) => w.wert), 1)
  const dicht = zeitraum.wochen.length > 8

  return (
    <section className={stil.chart} ref={ref}>
      <h4 className={stil.chartTitel}>Kopfschmerztage je Woche</h4>
      <p className={stil.chartHinweis}>
        {zeitraum.wochen.length} Wochen · zusammen {zeitraum.kopfschmerztage} Tage
      </p>

      <div className={stil.wochen} aria-hidden="true">
        {zeitraum.wochen.map((woche, i) => (
          <div key={woche.label} className={stil.wochenSpalte}>
            <div className={stil.wochenGleis}>
              <m.div
                className={stil.wochenBalken}
                style={{
                  background: woche.wert === hoechster ? 'var(--primary)' : 'var(--data-light)',
                }}
                initial={reduziert ? false : { scaleY: 0 }}
                animate={{
                  scaleY: sichtbar || reduziert ? Math.max(woche.wert / hoechster, 0.04) : 0,
                }}
                transition={
                  reduziert
                    ? ueberblendung
                    : { duration: 0.38, ease: KURVE, delay: erste.current ? i * 0.035 : 0 }
                }
              />
            </div>
            <span className={stil.wochenLabel}>
              {!dicht || i === 0 || i === zeitraum.wochen.length - 1
                ? woche.label.replace('KW ', '')
                : ''}
            </span>
          </div>
        ))}
      </div>

      {/* Fuer Screenreader dieselbe Information als Text. */}
      <ul className="nurLesbarFuerScreenreader">
        {zeitraum.wochen.map((woche) => (
          <li key={woche.label}>
            {woche.label}: {woche.wert} {woche.wert === 1 ? 'Kopfschmerztag' : 'Kopfschmerztage'}
          </li>
        ))}
      </ul>
    </section>
  )
}

function FaktorListe({
  titel,
  hinweis,
  faktoren,
  zeitraum,
  mitGuete = false,
}: {
  titel: string
  hinweis: string
  faktoren: Faktor[]
  zeitraum: Zeitraum
  /** Belastbarkeit hinter den Bezug schreiben. */
  mitGuete?: boolean
}) {
  const reduziert = useReduziert()
  const { ref, sichtbar } = useInViewOnce<HTMLDivElement>()
  const erste = useErsterEintritt(sichtbar)

  return (
    <section className={stil.chart} ref={ref}>
      <h4 className={stil.chartTitel}>{titel}</h4>
      <p className={stil.chartHinweis}>{hinweis}</p>

      <ul className={stil.faktoren}>
        {faktoren.map((faktor, i) => (
          <li key={faktor.name} className={stil.faktor}>
            <div className={stil.faktorKopf}>
              <span className={stil.faktorName}>{faktor.name}</span>
              <span className={stil.faktorWert}>{faktor.prozent}&nbsp;%</span>
            </div>
            <div className={stil.faktorGleis} aria-hidden="true">
              <m.div
                className={stil.faktorBalken}
                style={{ background: balkenFarbe(faktor.prozent) }}
                initial={reduziert ? false : { scaleX: 0 }}
                animate={{ scaleX: sichtbar || reduziert ? faktor.prozent / 100 : 0 }}
                transition={
                  reduziert
                    ? ueberblendung
                    : { duration: 0.5, ease: KURVE, delay: erste.current ? i * 0.05 : 0 }
                }
              />
            </div>
            <p className={stil.faktorBezug}>
              {bezugsText(faktor, zeitraum)}
              {mitGuete ? ` · ${guete(faktor)}` : ''}
            </p>
          </li>
        ))}
      </ul>

      <p className={stil.einordnung}>Zusammentreffen ist keine Ursache.</p>
    </section>
  )
}

export function InsightChart() {
  const id = useId()
  const [schluessel, setSchluessel] = useState<ZeitraumSchluessel>('30')
  const zeitraum = ZEITRAEUME[schluessel]

  return (
    <div className={stil.karte}>
      <div className={stil.karteKopf}>
        <h3 className={stil.karteTitel}>Auswertungen</h3>
        <ZeitraumSchalter aktiv={schluessel} aufWechsel={setSchluessel} id={id} />
      </div>

      <div
        className={stil.panel}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${schluessel}`}
        tabIndex={0}
      >
        <Kennzahlen zeitraum={zeitraum} />

        <div className={stil.spalten}>
          <WochenVerlauf zeitraum={zeitraum} />
          <FaktorListe
            titel="Zusammenhänge"
            hinweis="Was an Kopfschmerztagen häufiger zusammentraf."
            faktoren={zeitraum.zusammenhaenge}
            zeitraum={zeitraum}
            mitGuete
          />
          <FaktorListe
            titel="Begleitsymptome"
            hinweis="Anteil der Kopfschmerztage, an denen das Symptom erfasst wurde."
            faktoren={zeitraum.begleitsymptome}
            zeitraum={zeitraum}
          />
        </div>

        <p className={stil.datenbasis}>
          <strong className={stil.datenbasisWert}>
            {zeitraum.erfasst} von {zeitraum.tage} Tagen
          </strong>{' '}
          im Zeitraum erfasst. telli. stellt keine Diagnose — alle Zahlen stammen ausschließlich
          aus deinen eigenen Einträgen.
        </p>
      </div>
    </div>
  )
}
