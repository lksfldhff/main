import { useId } from 'react'
import { useTheme, type Helligkeit, type Palette } from '../hooks/useTheme'
import stil from './ThemeSwitch.module.css'

/**
 * Jede Palette-Karte zeigt ihre eigenen Farben — fest hinterlegt, damit sie
 * nicht mit dem gerade aktiven Theme mitwandern.
 */
const PALETTEN: {
  schluessel: Palette
  name: string
  beschreibung: string
  farben: [string, string, string]
}[] = [
  {
    schluessel: 'blau',
    name: 'Blau',
    beschreibung: 'Tiefblau, Eisblau, Salbei',
    farben: ['#064789', '#427AA1', '#04724D'],
  },
  {
    schluessel: 'rosa',
    name: 'Rosa',
    beschreibung: 'Violett, Flieder, Petrol',
    farben: ['#49416D', '#BEA2C2', '#508991'],
  },
]

const HELLIGKEITEN: { schluessel: Helligkeit; name: string }[] = [
  { schluessel: 'hell', name: 'Hell' },
  { schluessel: 'dunkel', name: 'Dunkel' },
]

export function ThemeSwitch() {
  const id = useId()
  const { palette, helligkeit, setzePalette, setzeHelligkeit } = useTheme()

  return (
    <div className={stil.block}>
      <fieldset className={stil.gruppe}>
        <legend className={stil.legende}>Farbschema</legend>
        <div className={stil.karten}>
          {PALETTEN.map((eintrag) => (
            <label key={eintrag.schluessel} className={stil.karte}>
              <input
                className={stil.eingabe}
                type="radio"
                name={`${id}-palette`}
                value={eintrag.schluessel}
                checked={palette === eintrag.schluessel}
                onChange={() => setzePalette(eintrag.schluessel)}
              />
              <span className={stil.farben} aria-hidden="true">
                {eintrag.farben.map((farbe) => (
                  <span key={farbe} className={stil.farbe} style={{ background: farbe }} />
                ))}
              </span>
              <span className={stil.kartenName}>{eintrag.name}</span>
              <span className={stil.kartenText}>{eintrag.beschreibung}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={stil.gruppe}>
        <legend className={stil.legende}>Erscheinungsbild</legend>
        <div className={stil.schalter}>
          {HELLIGKEITEN.map((eintrag) => (
            <label key={eintrag.schluessel} className={stil.segment}>
              <input
                className={stil.eingabe}
                type="radio"
                name={`${id}-helligkeit`}
                value={eintrag.schluessel}
                checked={helligkeit === eintrag.schluessel}
                onChange={() => setzeHelligkeit(eintrag.schluessel)}
              />
              <span className={stil.segmentText}>{eintrag.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className={stil.notiz}>
        Der dunkle Modus ist bewusst kontraststark — hilfreich bei Lichtempfindlichkeit während
        einer Attacke. Funktionale Farben bleiben in jedem Schema gleich.
      </p>
    </div>
  )
}
