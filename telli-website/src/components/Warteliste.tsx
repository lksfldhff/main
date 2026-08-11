import { useId, useRef, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { useReduziert } from '../hooks/useReduziert'
import { EINTRITT_WEG, eintritt, ueberblendung } from '../lib/motion'
import { Knopf } from './Knopf'
import stil from './Warteliste.module.css'

/**
 * Ohne Backend. Ist ein Endpunkt hinterlegt (z. B. Formspree), geht die
 * Adresse dorthin — sonst oeffnet sich das Mailprogramm.
 *
 * PLATZHALTER: hier den echten Endpunkt eintragen.
 */
const WARTELISTE_ENDPUNKT = ''
const WARTELISTE_MAIL = 'warteliste@telli.app'

const MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type Status = 'bereit' | 'sendet' | 'fertig'

export function Warteliste() {
  const id = useId()
  const reduziert = useReduziert()
  const feldRef = useRef<HTMLInputElement>(null)
  const [adresse, setAdresse] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('bereit')

  const pruefe = (wert: string): string | null => {
    if (wert.trim() === '') return 'Bitte trag deine E-Mail-Adresse ein.'
    if (!MUSTER.test(wert.trim())) return 'Diese Adresse sieht noch nicht vollständig aus.'
    return null
  }

  // Inline pruefen beim Verlassen des Feldes — nicht beim Tippen.
  const beiVerlassen = () => {
    if (adresse.trim() === '') {
      setFehler(null)
      return
    }
    setFehler(pruefe(adresse))
  }

  const beiAbsenden = async (e: React.FormEvent) => {
    e.preventDefault()
    const gefunden = pruefe(adresse)
    if (gefunden) {
      setFehler(gefunden)
      feldRef.current?.focus()
      return
    }

    setStatus('sendet')
    try {
      if (WARTELISTE_ENDPUNKT) {
        await fetch(WARTELISTE_ENDPUNKT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email: adresse.trim() }),
        })
      } else {
        window.location.href = `mailto:${WARTELISTE_MAIL}?subject=${encodeURIComponent(
          'Warteliste telli.',
        )}&body=${encodeURIComponent(`Bitte setzt ${adresse.trim()} auf die Warteliste.`)}`
      }
    } catch {
      /* Ohne Backend gibt es nichts zu wiederholen. */
    }
    setStatus('fertig')
  }

  const bewegung = reduziert ? ueberblendung : eintritt
  const versatz = reduziert ? 0 : EINTRITT_WEG

  return (
    <div className={stil.block}>
      <AnimatePresence mode="wait" initial={false}>
        {status === 'fertig' ? (
          <m.p
            key="fertig"
            className={stil.erfolg}
            initial={{ opacity: 0, y: versatz }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: versatz }}
            transition={bewegung}
            role="status"
          >
            <span className={stil.erfolgTitel}>Notiert.</span> Wir melden uns unter{' '}
            {adresse.trim()}, sobald telli. im App Store steht. Sonst schreiben wir dir nicht.
          </m.p>
        ) : (
          <m.form
            key="formular"
            className={stil.formular}
            initial={{ opacity: 0, y: versatz }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: versatz }}
            transition={bewegung}
            onSubmit={beiAbsenden}
            noValidate
          >
            <div className={stil.feldZeile}>
              <label className={stil.label} htmlFor={`${id}-mail`}>
                E-Mail-Adresse
              </label>
              <input
                ref={feldRef}
                id={`${id}-mail`}
                className={stil.feld}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="du@beispiel.de"
                value={adresse}
                aria-invalid={fehler ? true : undefined}
                aria-describedby={fehler ? `${id}-fehler` : undefined}
                onChange={(e) => {
                  setAdresse(e.target.value)
                  if (fehler) setFehler(null)
                }}
                onBlur={beiVerlassen}
              />
            </div>

            <Knopf type="submit" art="primaer" disabled={status === 'sendet'}>
              {status === 'sendet' ? 'Einen Moment …' : 'Auf die Warteliste'}
            </Knopf>
          </m.form>
        )}
      </AnimatePresence>

      <p className={stil.fehler} id={`${id}-fehler`} role="alert">
        {fehler}
      </p>
    </div>
  )
}
