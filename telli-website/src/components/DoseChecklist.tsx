import { useEffect, useRef, useState } from 'react'
import { m, useAnimationControls } from 'motion/react'
import { useReduziert } from '../hooks/useReduziert'
import { ueberblendung } from '../lib/motion'
import stil from './DoseChecklist.module.css'

type Dosis = {
  id: string
  zeit: string
  name: string
  staerke: string
  hinweis: string
}

const DOSEN: Dosis[] = [
  {
    id: 'metoprolol',
    zeit: '08:00',
    name: 'Metoprolol',
    staerke: '50 mg',
    hinweis: 'Prophylaxe · mit dem Frühstück',
  },
  {
    id: 'sumatriptan',
    zeit: '14:20',
    name: 'Sumatriptan',
    staerke: '50 mg',
    hinweis: 'Akut · bei Beginn genommen',
  },
  {
    id: 'magnesium',
    zeit: '22:00',
    name: 'Magnesium',
    staerke: '300 mg',
    hinweis: 'Nahrungsergänzung',
  },
]

export function DoseChecklist() {
  const reduziert = useReduziert()
  const [erledigt, setErledigt] = useState<string[]>(['metoprolol'])
  const zaehler = useAnimationControls()
  const vorher = useRef(erledigt.length)

  useEffect(() => {
    if (vorher.current === erledigt.length) return
    vorher.current = erledigt.length
    if (reduziert) return
    zaehler.start({ scale: [1, 1.07, 1] }, { duration: 0.3, times: [0, 0.4, 1], ease: 'easeOut' })
  }, [erledigt.length, reduziert, zaehler])

  const umschalten = (id: string) =>
    setErledigt((alt) => (alt.includes(id) ? alt.filter((e) => e !== id) : [...alt, id]))

  return (
    <div className={stil.block}>
      <div className={stil.kopf}>
        <h3 className={stil.titel}>Einnahmeplan heute</h3>
        <m.span className={stil.zaehler} animate={zaehler}>
          {erledigt.length} von {DOSEN.length}
        </m.span>
      </div>

      <ul className={stil.liste}>
        {DOSEN.map((dosis) => {
          const an = erledigt.includes(dosis.id)
          return (
            <li key={dosis.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={an}
                className={stil.zeile}
                onClick={() => umschalten(dosis.id)}
              >
                <span className={stil.kreis} aria-hidden="true">
                  <m.span
                    className={stil.fuellung}
                    initial={false}
                    animate={reduziert ? { opacity: an ? 1 : 0, scale: 1 } : { scale: an ? 1 : 0 }}
                    transition={reduziert ? ueberblendung : { duration: 0.2, ease: 'easeOut' }}
                  />
                  <svg className={stil.haken} viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <m.path
                      d="M3.6 8.4 6.7 11.5 12.4 5"
                      stroke="var(--knob)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={false}
                      animate={
                        reduziert
                          ? { opacity: an ? 1 : 0, pathLength: 1 }
                          : { pathLength: an ? 1 : 0, opacity: an ? 1 : 0 }
                      }
                      transition={
                        reduziert
                          ? ueberblendung
                          : { duration: 0.22, delay: an ? 0.09 : 0, ease: 'easeOut' }
                      }
                    />
                  </svg>
                </span>

                <m.span
                  className={stil.text}
                  initial={false}
                  /* Nur so weit zurueckgenommen, dass die Zeile noch 4,5:1
                     traegt — abgehakt heisst nicht unlesbar. */
                  animate={{ opacity: an ? 0.8 : 1 }}
                  transition={reduziert ? ueberblendung : { duration: 0.24, ease: 'easeOut' }}
                >
                  <span className={stil.nameZeile}>
                    <span className={stil.name}>
                      {dosis.name} {dosis.staerke}
                      <m.span
                        className={stil.strich}
                        aria-hidden="true"
                        initial={false}
                        animate={
                          reduziert
                            ? { opacity: an ? 1 : 0, scaleX: 1 }
                            : { scaleX: an ? 1 : 0, opacity: 1 }
                        }
                        transition={reduziert ? ueberblendung : { duration: 0.18, ease: 'easeOut' }}
                      />
                    </span>
                    <span className={stil.zeit}>{dosis.zeit}</span>
                  </span>
                  <span className={stil.hinweis}>{dosis.hinweis}</span>
                </m.span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
