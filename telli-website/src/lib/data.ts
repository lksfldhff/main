/**
 * Beispieldaten der Auswertung. Alle Nenner leiten sich aus den
 * Kopfschmerztagen des jeweiligen Zeitraums ab; die Wochenbalken summieren
 * sich exakt auf die Kopfschmerztage.
 */

export type ZeitraumSchluessel = '30' | '90' | 'eigen'

export type Faktor = {
  name: string
  prozent: number
  /** Bezugsgroesse des Nenners. */
  bezug: 'kopfschmerztage' | 'zyklustage'
}

export type Zeitraum = {
  schluessel: ZeitraumSchluessel
  /** Beschriftung im Umschalter. */
  kurz: string
  /** Laenge des Zeitraums in Tagen. */
  tage: number
  kopfschmerztage: number
  /** Mittlere Intensitaet, deutsche Schreibweise. */
  intensitaet: string
  dauer: string
  /** Laengste Pause in Tagen. */
  pause: number
  /** Tage mit mindestens einem Eintrag. */
  erfasst: number
  /** Tage 1–2 der Menstruation im Zeitraum. */
  zyklustage: number
  wochen: { label: string; wert: number }[]
  zusammenhaenge: Faktor[]
  begleitsymptome: Faktor[]
}

const kw = (von: number, bis: number) =>
  Array.from({ length: bis - von + 1 }, (_, i) => `KW ${von + i}`)

function wochen(von: number, werte: number[]) {
  return kw(von, von + werte.length - 1).map((label, i) => ({ label, wert: werte[i] }))
}

export const ZEITRAEUME: Record<ZeitraumSchluessel, Zeitraum> = {
  '30': {
    schluessel: '30',
    kurz: '30 Tage',
    tage: 30,
    kopfschmerztage: 7,
    intensitaet: '6,1',
    dauer: '5,8 h',
    pause: 9,
    erfasst: 26,
    zyklustage: 4,
    wochen: wochen(19, [1, 2, 1, 3, 0]),
    zusammenhaenge: [
      { name: 'Luftdruckabfall', prozent: 73, bezug: 'kopfschmerztage' },
      { name: 'Schlaf unter 6 Stunden', prozent: 64, bezug: 'kopfschmerztage' },
      { name: 'Tage 1–2 der Menstruation', prozent: 58, bezug: 'zyklustage' },
      { name: 'Stress am Vortag', prozent: 45, bezug: 'kopfschmerztage' },
      { name: 'Alkohol', prozent: 18, bezug: 'kopfschmerztage' },
    ],
    begleitsymptome: [
      { name: 'Lichtempfindlichkeit', prozent: 86, bezug: 'kopfschmerztage' },
      { name: 'Übelkeit', prozent: 67, bezug: 'kopfschmerztage' },
      { name: 'Geräuschempfindlichkeit', prozent: 52, bezug: 'kopfschmerztage' },
      { name: 'Nackenbeschwerden', prozent: 43, bezug: 'kopfschmerztage' },
      { name: 'Aura', prozent: 19, bezug: 'kopfschmerztage' },
    ],
  },
  '90': {
    schluessel: '90',
    kurz: '90 Tage',
    tage: 90,
    kopfschmerztage: 21,
    intensitaet: '5,8',
    dauer: '6,2 h',
    pause: 12,
    erfasst: 84,
    zyklustage: 12,
    wochen: wochen(11, [1, 2, 1, 3, 0, 2, 1, 2, 1, 3, 2, 1, 2]),
    zusammenhaenge: [
      { name: 'Luftdruckabfall', prozent: 68, bezug: 'kopfschmerztage' },
      { name: 'Schlaf unter 6 Stunden', prozent: 61, bezug: 'kopfschmerztage' },
      { name: 'Tage 1–2 der Menstruation', prozent: 55, bezug: 'zyklustage' },
      { name: 'Stress am Vortag', prozent: 41, bezug: 'kopfschmerztage' },
      { name: 'Alkohol', prozent: 21, bezug: 'kopfschmerztage' },
    ],
    begleitsymptome: [
      { name: 'Lichtempfindlichkeit', prozent: 81, bezug: 'kopfschmerztage' },
      { name: 'Übelkeit', prozent: 71, bezug: 'kopfschmerztage' },
      { name: 'Geräuschempfindlichkeit', prozent: 48, bezug: 'kopfschmerztage' },
      { name: 'Nackenbeschwerden', prozent: 38, bezug: 'kopfschmerztage' },
      { name: 'Aura', prozent: 24, bezug: 'kopfschmerztage' },
    ],
  },
  eigen: {
    schluessel: 'eigen',
    kurz: 'Eigener',
    tage: 52,
    kopfschmerztage: 12,
    intensitaet: '5,4',
    dauer: '6,0 h',
    pause: 11,
    erfasst: 48,
    zyklustage: 6,
    wochen: wochen(16, [1, 2, 0, 2, 1, 3, 2, 1]),
    zusammenhaenge: [
      { name: 'Luftdruckabfall', prozent: 75, bezug: 'kopfschmerztage' },
      { name: 'Schlaf unter 6 Stunden', prozent: 58, bezug: 'kopfschmerztage' },
      { name: 'Tage 1–2 der Menstruation', prozent: 50, bezug: 'zyklustage' },
      { name: 'Stress am Vortag', prozent: 42, bezug: 'kopfschmerztage' },
      { name: 'Alkohol', prozent: 17, bezug: 'kopfschmerztage' },
    ],
    begleitsymptome: [
      { name: 'Lichtempfindlichkeit', prozent: 83, bezug: 'kopfschmerztage' },
      { name: 'Übelkeit', prozent: 67, bezug: 'kopfschmerztage' },
      { name: 'Geräuschempfindlichkeit', prozent: 50, bezug: 'kopfschmerztage' },
      { name: 'Nackenbeschwerden', prozent: 42, bezug: 'kopfschmerztage' },
      { name: 'Aura', prozent: 17, bezug: 'kopfschmerztage' },
    ],
  },
}

export const ZEITRAUM_REIHENFOLGE: ZeitraumSchluessel[] = ['30', '90', 'eigen']

/** Nenner eines Faktors im Zeitraum. */
export function nenner(faktor: Faktor, zeitraum: Zeitraum): number {
  return faktor.bezug === 'zyklustage' ? zeitraum.zyklustage : zeitraum.kopfschmerztage
}

/** Anzahl der Tage hinter einem Prozentwert. */
export function anzahl(faktor: Faktor, zeitraum: Zeitraum): number {
  return Math.round((faktor.prozent / 100) * nenner(faktor, zeitraum))
}

/**
 * Wie belastbar der Wert ist. Beschreibend, nie kausal — und ohne Farbe, die
 * eine Wertung transportiert.
 */
export function guete(faktor: Faktor): 'beobachtet' | 'schwach' | 'zu wenig Daten' {
  if (faktor.prozent >= 50) return 'beobachtet'
  if (faktor.prozent >= 25) return 'schwach'
  return 'zu wenig Daten'
}

/** Balkenfarbe: ≥ 60 % kraeftig, ≥ 40 % Datenfarbe, darunter zurueckgenommen. */
export function balkenFarbe(prozent: number): string {
  if (prozent >= 60) return 'var(--primary)'
  if (prozent >= 40) return 'var(--data)'
  return 'var(--track)'
}

export function bezugsText(faktor: Faktor, zeitraum: Zeitraum): string {
  const n = anzahl(faktor, zeitraum)
  const gesamt = nenner(faktor, zeitraum)
  const einheit = faktor.bezug === 'zyklustage' ? 'Zyklustagen' : 'Kopfschmerztagen'
  return `an ${n} von ${gesamt} ${einheit}`
}
