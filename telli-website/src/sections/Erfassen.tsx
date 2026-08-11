import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { Eintritt } from '../components/Eintritt'
import { FaceMark } from '../components/FaceMark'
import { Knopf } from '../components/Knopf'
import { PhoneFrame } from '../components/PhoneFrame'
import { SeverityScale } from '../components/SeverityScale'
import { useReduziert } from '../hooks/useReduziert'
import { feder, federSheet, ueberblendung } from '../lib/motion'
import layout from './Layout.module.css'
import stil from './Erfassen.module.css'

const BEGLEITSYMPTOME = ['Lichtempfindlichkeit', 'Übelkeit', 'Nacken']

/** Getrennt gefragt statt zusammengefasst. */
const AUFGESCHLUESSELT = [
  'Schwindel',
  'Schwarzwerden vor den Augen',
  'Schwäche nach dem Aufstehen',
]

export function Erfassen() {
  const reduziert = useReduziert()
  const [wert, setWert] = useState(6)
  const [begleitend, setBegleitend] = useState<string[]>(['Lichtempfindlichkeit'])
  const [gespeichert, setGespeichert] = useState(false)
  const marke = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(marke.current), [])

  const speichern = () => {
    if (gespeichert) return
    setGespeichert(true)
    marke.current = window.setTimeout(() => setGespeichert(false), 1650)
  }

  const umschalten = (name: string) =>
    setBegleitend((alt) => (alt.includes(name) ? alt.filter((e) => e !== name) : [...alt, name]))

  return (
    <section className={layout.abschnitt} id="erfassen" aria-labelledby="erfassen-titel">
      <div className={layout.innen}>
        <div className={layout.zwei}>
          <Eintritt className={layout.text}>
            <div className={layout.kopf}>
              <span className={layout.marke}>Erfassen</span>
              <h2 className="h2" id="erfassen-titel">
                In Sekunden erfasst, in der Praxis brauchbar
              </h2>
              <p className="lead">
                Aufschlüsseln statt zusammenfassen. „Orthostatische Beschwerden“ ist als Begriff
                unbrauchbar — telli. fragt getrennt ab:
              </p>
            </div>

            <ul className={stil.aufschluesselung}>
              {AUFGESCHLUESSELT.map((eintrag) => (
                <li key={eintrag} className={stil.aufschluesselungPunkt}>
                  {eintrag}
                </li>
              ))}
            </ul>

            <p className={stil.nachsatz}>
              Jeweils auf einer Skala von 0 bis 10. Ärzte rechnen in dieser Skala — der Wert lässt
              sich vorlesen, vergleichen und über Wochen verfolgen.
            </p>
          </Eintritt>

          <div className={layout.demo}>
            <div className={layout.klebrig}>
              <PhoneFrame>
                <div className={stil.buehne}>
                  <div className={stil.formular}>
                    <div className={stil.formularKopf}>
                      <span className={stil.formularTitel}>Symptome erfassen</span>
                      <span className={stil.formularZeit}>Heute · 14:20</span>
                    </div>

                    <SeverityScale label="Kopfschmerz" wert={wert} aufWert={setWert} />

                    <div className={stil.chipsBlock}>
                      <span className={stil.chipsLabel} id="begleit-label">
                        Begleitsymptome
                      </span>
                      <div className={stil.chips} role="group" aria-labelledby="begleit-label">
                        {BEGLEITSYMPTOME.map((name) => {
                          const an = begleitend.includes(name)
                          return (
                            <m.button
                              key={name}
                              type="button"
                              className={stil.chip}
                              aria-pressed={an}
                              onClick={() => umschalten(name)}
                              whileTap={reduziert ? undefined : { scale: 0.97 }}
                              transition={feder}
                            >
                              {name}
                            </m.button>
                          )
                        })}
                      </div>
                    </div>

                    <Knopf breit onClick={speichern}>
                      Speichern
                    </Knopf>
                  </div>

                  <AnimatePresence>
                    {gespeichert && (
                      <m.div
                        key="erfolg"
                        className={stil.erfolg}
                        initial={reduziert ? { opacity: 0 } : { opacity: 0, scale: 0.86 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={reduziert ? { opacity: 0 } : { opacity: 0, scale: 0.86 }}
                        transition={reduziert ? ueberblendung : federSheet}
                      >
                        <div className={stil.zeichenBox}>
                          {!reduziert && (
                            <m.span
                              className={stil.ring}
                              aria-hidden="true"
                              initial={{ scale: 0.72, opacity: 0.42 }}
                              animate={{ scale: 1.9, opacity: 0 }}
                              transition={{ duration: 0.7, ease: 'easeOut' }}
                            />
                          )}
                          <FaceMark variante="zeichen" zeichnen={false} className={stil.zeichen} />
                        </div>
                        <p className={stil.erfolgText} role="status">
                          Eintrag gespeichert
                        </p>
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>
              </PhoneFrame>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
