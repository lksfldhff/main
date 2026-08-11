import { useCallback, useEffect, useState } from 'react'

export type Palette = 'blau' | 'rosa'
export type Helligkeit = 'hell' | 'dunkel'
export type Theme = `${Palette}-${Helligkeit}`

const SPEICHER = 'telli-theme'
const THEMES: Theme[] = ['blau-hell', 'rosa-hell', 'blau-dunkel', 'rosa-dunkel']

function ausDokument(): Theme {
  const gesetzt = document.documentElement.getAttribute('data-telli-theme') as Theme | null
  return gesetzt && THEMES.includes(gesetzt) ? gesetzt : 'blau-hell'
}

/**
 * Setzt `data-telli-theme` auf <html>. Der Wechsel laeuft als kurze
 * Ueberblendung (200 ms, in global.css), nie als harter Sprung.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(ausDokument)

  const [palette, helligkeit] = theme.split('-') as [Palette, Helligkeit]

  const setzeTheme = useCallback((neu: Theme) => {
    const wurzel = document.documentElement
    wurzel.classList.add('themeWechsel')
    wurzel.setAttribute('data-telli-theme', neu)
    setThemeState(neu)
    try {
      localStorage.setItem(SPEICHER, neu)
    } catch {
      /* Privater Modus: dann eben nur fuer diese Sitzung. */
    }
    window.setTimeout(() => wurzel.classList.remove('themeWechsel'), 240)
  }, [])

  const setzePalette = useCallback(
    (neu: Palette) => setzeTheme(`${neu}-${helligkeit}` as Theme),
    [helligkeit, setzeTheme],
  )

  const setzeHelligkeit = useCallback(
    (neu: Helligkeit) => setzeTheme(`${palette}-${neu}` as Theme),
    [palette, setzeTheme],
  )

  // Systemwechsel nur uebernehmen, solange nichts selbst gewaehlt wurde.
  useEffect(() => {
    let gewaehlt = false
    try {
      gewaehlt = localStorage.getItem(SPEICHER) !== null
    } catch {
      gewaehlt = false
    }
    if (gewaehlt) return
    const abfrage = window.matchMedia('(prefers-color-scheme: dark)')
    const beiWechsel = (e: MediaQueryListEvent) => {
      const wurzel = document.documentElement
      const neu = `${palette}-${e.matches ? 'dunkel' : 'hell'}` as Theme
      wurzel.classList.add('themeWechsel')
      wurzel.setAttribute('data-telli-theme', neu)
      setThemeState(neu)
      window.setTimeout(() => wurzel.classList.remove('themeWechsel'), 240)
    }
    abfrage.addEventListener('change', beiWechsel)
    return () => abfrage.removeEventListener('change', beiWechsel)
  }, [palette])

  // Die Browserleiste mitfaerben.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    const farbe = getComputedStyle(document.documentElement).getPropertyValue('--hero').trim()
    if (farbe) meta.setAttribute('content', farbe)
  }, [theme])

  return { theme, palette, helligkeit, setzePalette, setzeHelligkeit }
}
