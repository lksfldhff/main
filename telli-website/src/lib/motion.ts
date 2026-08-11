import type { Transition } from 'motion/react'

/* Federn statt Dauern (apple-design.md §4).
   `bounce` entspricht Apples Daempfung, `duration` der Response.
   Ueberschwingen gibt es nur, wenn eine Geste vorausging. */

/** Standard: kritisch gedaempft, kein Ueberschwingen. Daempfung 1.0 / Response 0.35. */
export const feder: Transition = { type: 'spring', bounce: 0, duration: 0.35 }

/** Nach einer Wurf- oder Ziehgeste. Daempfung 0.8 / Response 0.4. */
export const federGeste: Transition = { type: 'spring', bounce: 0.2, duration: 0.4 }

/** Sheet-artig, nach einer Geste ausgeloest. Daempfung 0.8 / Response 0.3. */
export const federSheet: Transition = { type: 'spring', bounce: 0.2, duration: 0.3 }

/** `prefers-reduced-motion: reduce` — alles wird zur Ueberblendung in 120 ms. */
export const ueberblendung: Transition = { duration: 0.12, ease: 'linear' }

/** Scroll-Eintritte: 340 ms, weiche Verzoegerung, hoechstens 12 px Weg. */
export const eintritt: Transition = { duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }

/** Weg eines Scroll-Eintritts in px. */
export const EINTRITT_WEG = 12

/**
 * Momentum-Projektion (apple-design.md §6): wohin die Geste unterwegs war,
 * nicht wo der Finger losgelassen hat.
 *
 *   ziel = position + (v / 1000) * d / (1 - d)
 */
export function projiziere(geschwindigkeit: number, verzoegerung = 0.998): number {
  return ((geschwindigkeit / 1000) * verzoegerung) / (1 - verzoegerung)
}

/**
 * Gummiband an den Enden (apple-design.md §9): je weiter darueber hinaus,
 * desto weniger folgt das Element.
 */
export function gummiband(ueberschuss: number, dimension: number, konstante = 0.55): number {
  if (dimension <= 0) return 0
  return (ueberschuss * dimension * konstante) / (dimension + konstante * Math.abs(ueberschuss))
}

export function begrenze(wert: number, min: number, max: number): number {
  return wert < min ? min : wert > max ? max : wert
}

/** Auf den naechsten Rastwert runden. */
export function raste(wert: number, schritt: number, min: number, max: number): number {
  return begrenze(Math.round(wert / schritt) * schritt, min, max)
}
