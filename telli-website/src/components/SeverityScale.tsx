import { useId } from 'react'
import { m, useAnimationControls, useTransform } from 'motion/react'
import { useReduziert } from '../hooks/useReduziert'
import { useSpringDrag } from '../hooks/useSpringDrag'
import { begrenze } from '../lib/motion'
import stil from './SeverityScale.module.css'

type Props = {
  label: string
  wert: number
  aufWert: (wert: number) => void
  max?: number
}

/** Beschreibung des Wertes — beschreibend, nicht dramatisierend. */
function stufenText(wert: number): string {
  if (wert === 0) return 'heute keine Beschwerden'
  if (wert <= 3) return 'leicht'
  if (wert <= 6) return 'mittel'
  if (wert <= 8) return 'stark'
  return 'sehr stark'
}

/**
 * Schwere ueber Saettigung und Fuellgrad, nie ueber Signalfarbe: der Griff
 * mischt von zurueckgenommen nach kraeftig.
 */
function intensitaetsFarbe(wert: number, max: number): string {
  const anteil = max > 0 ? wert / max : 0
  return `color-mix(in oklab, var(--primary) ${Math.round(22 + anteil * 78)}%, var(--track))`
}

export function SeverityScale({ label, wert, aufWert, max = 10 }: Props) {
  const reduziert = useReduziert()
  const id = useId()
  const chip = useAnimationControls()

  const { bahnRef, x, anteil, ziehend, zeigerHandler } = useSpringDrag({
    max,
    schritt: 1,
    start: wert,
    reduziert,
    aufWert,
    aufRast: () => {
      if (reduziert) return
      chip.start({ scale: [1, 1.07, 1] }, { duration: 0.3, times: [0, 0.4, 1], ease: 'easeOut' })
    },
  })

  // Fuellung als reine Verschiebung — keine Breitenanimation.
  const fuellungX = useTransform(anteil, (p) => `${(begrenze(p, 0, 1) - 1) * 100}%`)

  return (
    <div className={stil.block}>
      <div className={stil.kopf}>
        <div className={stil.beschriftung}>
          <span className={stil.name} id={`${id}-label`}>
            {label}
          </span>
          <span className={stil.stufe}>
            {wert} · {stufenText(wert)}
          </span>
        </div>
        {/* Der Wert steht schon in `aria-valuetext` — hier nur die Optik. */}
        <m.span className={stil.chip} animate={chip} aria-hidden="true">
          {wert}
        </m.span>
      </div>

      <div
        id={`${id}-regler`}
        ref={bahnRef}
        className={stil.bahn}
        role="slider"
        tabIndex={0}
        aria-labelledby={`${id}-label`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={wert}
        aria-valuetext={`${wert} von ${max} — ${stufenText(wert)}`}
        aria-orientation="horizontal"
        data-ziehend={ziehend || undefined}
        {...zeigerHandler}
      >
        <div className={stil.gleis}>
          <m.div className={stil.fuellung} style={{ x: fuellungX }} />
        </div>
        <m.div
          className={stil.griff}
          style={{ x, backgroundColor: intensitaetsFarbe(wert, max) }}
        >
          <span className={stil.kern} />
        </m.div>
      </div>

      <div className={stil.marken} aria-hidden="true">
        <span>0 · keine</span>
        <span>5 · mittel</span>
        <span>{max} · maximal</span>
      </div>
    </div>
  )
}
