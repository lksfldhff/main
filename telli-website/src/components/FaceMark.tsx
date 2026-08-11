import { useEffect, useRef, useState } from 'react'
import { m, useMotionValue, useSpring } from 'motion/react'
import { useReduziert } from '../hooks/useReduziert'

type Props = {
  /** `szene` = Startbild mit Flaechen und Punkten, `zeichen` = nur das Gesicht. */
  variante?: 'szene' | 'zeichen'
  /** Linien beim Erscheinen zeichnen. */
  zeichnen?: boolean
  /** Blick folgt dem Zeiger (nur bei feinem Zeiger, nie bei `reduce`). */
  blick?: boolean
  className?: string
}

/** Reihenfolge des Zeichnens: Braue → Augen → Nase → Mund, 60 ms Versatz. */
const LINIEN = [
  { id: 'face-brow', d: 'M146 230c22-30 80-34 106-6' },
  { id: 'face-eye-left', d: 'M170 266c7-8 17-8 24 0' },
  { id: 'face-eye-right', d: 'M220 266c7-8 17-8 24 0' },
  { id: 'face-nose', d: 'M199 264v28c0 6-5 9-11 8' },
  { id: 'face-mouth', d: 'M176 314c12 12 34 13 48 1' },
]

const PUNKTE = [
  { id: 'dot-1', cx: 120, cy: 330, r: 5 },
  { id: 'dot-2', cx: 300, cy: 300, r: 7 },
  { id: 'dot-3', cx: 60, cy: 238, r: 4 },
]

function useFeinerZeiger() {
  const [fein, setFein] = useState(false)
  useEffect(() => {
    const abfrage = window.matchMedia('(hover: hover) and (pointer: fine)')
    setFein(abfrage.matches)
    const beiWechsel = (e: MediaQueryListEvent) => setFein(e.matches)
    abfrage.addEventListener('change', beiWechsel)
    return () => abfrage.removeEventListener('change', beiWechsel)
  }, [])
  return fein
}

export function FaceMark({ variante = 'szene', zeichnen = true, blick = false, className }: Props) {
  const reduziert = useReduziert()
  const feinerZeiger = useFeinerZeiger()
  const svgRef = useRef<SVGSVGElement>(null)

  const blickAktiv = blick && feinerZeiger && !reduziert

  const rohX = useMotionValue(0)
  const rohY = useMotionValue(0)
  // Gefedert, kritisch gedaempft — kein Nachwippen im Blick.
  const blickX = useSpring(rohX, { bounce: 0, duration: 0.4 })
  const blickY = useSpring(rohY, { bounce: 0, duration: 0.4 })

  useEffect(() => {
    if (!blickAktiv) {
      rohX.set(0)
      rohY.set(0)
      return
    }
    const beiBewegung = (e: PointerEvent) => {
      const svg = svgRef.current
      if (!svg) return
      const kasten = svg.getBoundingClientRect()
      const dx = e.clientX - (kasten.left + kasten.width / 2)
      const dy = e.clientY - (kasten.top + kasten.height / 2)
      const laenge = Math.hypot(dx, dy) || 1
      const staerke = Math.min(1, laenge / 420)
      rohX.set((dx / laenge) * 3 * staerke)
      rohY.set((dy / laenge) * 3 * staerke)
    }
    window.addEventListener('pointermove', beiBewegung, { passive: true })
    return () => window.removeEventListener('pointermove', beiBewegung)
  }, [blickAktiv, rohX, rohY])

  // Bei `reduce` steht das Gesicht sofort fertig da.
  const zeichnend = zeichnen && !reduziert
  const szene = variante === 'szene'

  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox={szene ? '0 0 393 392' : '119 182 160 160'}
      preserveAspectRatio={szene ? 'xMidYMid slice' : 'xMidYMid meet'}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {szene && (
        <g>
          <circle id="shape-large" cx="206" cy="266" r="122" fill="var(--lilac)" />
          <circle
            id="shape-medium"
            cx="72"
            cy="316"
            r="46"
            fill="var(--data-light)"
            fillOpacity="0.85"
          />
          <circle id="shape-small" cx="334" cy="150" r="26" fill="var(--page)" />
        </g>
      )}

      <m.g
        id="face"
        stroke="var(--primary-text)"
        strokeWidth={szene ? 3.4 : 5}
        strokeLinecap="round"
        fill="none"
        style={blickAktiv ? { x: blickX, y: blickY } : undefined}
      >
        {LINIEN.map((linie, i) => (
          <m.path
            key={linie.id}
            id={linie.id}
            d={linie.d}
            initial={zeichnend ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={
              zeichnend
                ? { duration: 0.5, ease: [0.22, 0.61, 0.36, 1], delay: 0.15 + i * 0.06 }
                : { duration: 0 }
            }
          />
        ))}
      </m.g>

      {szene && (
        <g id="dots" fill="var(--primary-text)" fillOpacity="0.9">
          {PUNKTE.map((punkt, i) => (
            <m.circle
              key={punkt.id}
              id={punkt.id}
              cx={punkt.cx}
              cy={punkt.cy}
              r={punkt.r}
              initial={zeichnend ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={zeichnend ? { duration: 0.3, delay: 0.5 + i * 0.09 } : { duration: 0 }}
            />
          ))}
        </g>
      )}
    </svg>
  )
}
