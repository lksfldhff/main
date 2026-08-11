import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, useMotionValue, useTransform, type AnimationPlaybackControls } from 'motion/react'
import {
  begrenze,
  feder,
  federGeste,
  gummiband,
  projiziere,
  raste,
  ueberblendung,
} from '../lib/motion'

/** Grosszuegiger Trefferbereich um den Griff (apple-design.md §10). */
const GRIFF_TREFFER = 22

/**
 * Die Projektion aus apple-design.md §6 ist fuer Scrollflaechen mit tausenden
 * Pixeln Inhalt gedacht: schon bei 500 px/s wirft sie 250 px weit. Auf einer
 * Bahn von rund 300 px waere jede zuegige Geste am Anschlag. Der Wurf wird
 * deshalb auf anderthalb Rastschritte begrenzt — genug, damit ein Schnipser
 * einen Schritt weiter traegt, wenig genug, dass er steuerbar bleibt.
 */
const WURF_GRENZE_IN_SCHRITTEN = 1.5

export type ZiehOptionen = {
  /** Groesster Wert der Skala. */
  max: number
  /** Rasterweite, auf die beim Loslassen eingerastet wird. */
  schritt: number
  /** Startwert. */
  start: number
  reduziert: boolean
  /** Waehrend des Ziehens laufend, immer der gerundete Wert. */
  aufWert: (wert: number) => void
  /** Einmal beim Einrasten oder bei einer Tastatureingabe. */
  aufRast?: (wert: number) => void
}

/**
 * 1:1-Tracking mit Greifpunkt, Gummiband an den Enden, Momentum-Projektion
 * und Velocity-Handoff an die Feder — und jederzeit unterbrechbar, weil die
 * Position eine MotionValue ist und jede Bewegung vom Bildschirmwert startet.
 */
export function useSpringDrag({ max, schritt, start, reduziert, aufWert, aufRast }: ZiehOptionen) {
  const bahnRef = useRef<HTMLDivElement>(null)
  const breiteRef = useRef(0)
  const x = useMotionValue(0)
  const anteil = useTransform(x, (px) => (breiteRef.current > 0 ? px / breiteRef.current : 0))
  const [ziehend, setZiehend] = useState(false)
  const ziehendRef = useRef(false)
  const laufRef = useRef<AnimationPlaybackControls | null>(null)
  const versatzRef = useRef(0)
  const wertRef = useRef(start)

  // Breite messen und die Position wertgetreu nachfuehren, damit ein
  // Fenster- oder Textgroessenwechsel den Regler nicht verschiebt.
  useLayoutEffect(() => {
    const bahn = bahnRef.current
    if (!bahn) return
    const messe = () => {
      const neu = bahn.clientWidth
      if (neu === breiteRef.current) return
      breiteRef.current = neu
      // `jump` statt `set`: eine Groessenaenderung ist keine Geste und darf
      // keine Geschwindigkeit erzeugen.
      if (!ziehendRef.current) x.jump((wertRef.current / max) * neu)
    }
    messe()
    const beobachter = new ResizeObserver(messe)
    beobachter.observe(bahn)
    return () => beobachter.disconnect()
  }, [max, x])

  useEffect(() => () => laufRef.current?.stop(), [])

  const wertAus = (px: number) =>
    raste((begrenze(px, 0, breiteRef.current) / (breiteRef.current || 1)) * max, schritt, 0, max)

  const melde = (wert: number) => {
    if (wert === wertRef.current) return
    wertRef.current = wert
    aufWert(wert)
  }

  const beiZeigerRunter = (e: React.PointerEvent<HTMLDivElement>) => {
    const bahn = bahnRef.current
    if (!bahn || e.button > 0) return

    // Aus der laufenden Bewegung heraus greifen: die Feder anhalten, die
    // MotionValue behaelt den aktuellen Bildschirmwert — kein Sprung.
    laufRef.current?.stop()
    laufRef.current = null

    const kasten = bahn.getBoundingClientRect()
    const zeiger = e.clientX - kasten.left
    const abstand = zeiger - x.get()

    // Am Griff angefasst: Greifpunkt behalten. Auf die Bahn getippt: der
    // Griff springt sofort unter den Finger (Antwort auf pointerdown).
    //
    // Beides per `jump`, damit der Sprung nicht als Geschwindigkeit in die
    // Momentum-Projektion einfliesst — sonst wuerde ein blosses Tippen den
    // Wert noch weiterwerfen.
    versatzRef.current = Math.abs(abstand) <= GRIFF_TREFFER ? abstand : 0
    x.jump(versatzRef.current === 0 ? begrenze(zeiger, 0, kasten.width) : x.get())

    bahn.setPointerCapture(e.pointerId)
    ziehendRef.current = true
    setZiehend(true)
    bahn.focus({ preventScroll: true })
    melde(wertAus(x.get()))
  }

  const beiZeigerBewegung = (e: React.PointerEvent<HTMLDivElement>) => {
    const bahn = bahnRef.current
    if (!ziehendRef.current || !bahn) return
    const kasten = bahn.getBoundingClientRect()
    const roh = e.clientX - kasten.left - versatzRef.current
    const breite = kasten.width

    // Gummiband statt hartem Stopp an den Enden.
    const pos =
      roh < 0 ? gummiband(roh, breite) : roh > breite ? breite + gummiband(roh - breite, breite) : roh

    x.set(pos)
    melde(wertAus(pos))
  }

  const beendeZug = (e: React.PointerEvent<HTMLDivElement>) => {
    const bahn = bahnRef.current
    if (!ziehendRef.current || !bahn) return
    ziehendRef.current = false
    setZiehend(false)
    if (bahn.hasPointerCapture(e.pointerId)) bahn.releasePointerCapture(e.pointerId)

    const breite = breiteRef.current
    const geschwindigkeit = x.getVelocity()

    // Dorthin einrasten, wo die Geste unterwegs war — nicht dorthin, wo der
    // Finger gerade abgehoben hat.
    const schrittBreite = (schritt / max) * breite
    const grenze = schrittBreite * WURF_GRENZE_IN_SCHRITTEN
    const wurf = begrenze(projiziere(geschwindigkeit), -grenze, grenze)
    const projiziert = begrenze(x.get() + wurf, 0, breite)
    const zielWert = raste((projiziert / (breite || 1)) * max, schritt, 0, max)

    melde(zielWert)
    aufRast?.(zielWert)
    laufRef.current = animate(
      x,
      (zielWert / max) * breite,
      reduziert ? ueberblendung : { ...federGeste, velocity: geschwindigkeit },
    )
  }

  const setzeWert = (roher: number) => {
    const wert = raste(roher, schritt, 0, max)
    if (wert === wertRef.current) return
    melde(wert)
    aufRast?.(wert)
    laufRef.current?.stop()
    // Keine Geste vorausgegangen, also kein Ueberschwingen.
    laufRef.current = animate(
      x,
      (wert / max) * breiteRef.current,
      reduziert ? ueberblendung : feder,
    )
  }

  const beiTaste = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const jetzt = wertRef.current
    let ziel: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        ziel = jetzt + schritt
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        ziel = jetzt - schritt
        break
      case 'PageUp':
        ziel = jetzt + schritt * 2
        break
      case 'PageDown':
        ziel = jetzt - schritt * 2
        break
      case 'Home':
        ziel = 0
        break
      case 'End':
        ziel = max
        break
      default:
        return
    }
    e.preventDefault()
    setzeWert(ziel)
  }

  return {
    bahnRef,
    x,
    anteil,
    ziehend,
    setzeWert,
    zeigerHandler: {
      onPointerDown: beiZeigerRunter,
      onPointerMove: beiZeigerBewegung,
      onPointerUp: beendeZug,
      onPointerCancel: beendeZug,
      onKeyDown: beiTaste,
    },
  }
}
