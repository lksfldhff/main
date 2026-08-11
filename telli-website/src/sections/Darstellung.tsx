import { Eintritt } from '../components/Eintritt'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { Warteliste } from '../components/Warteliste'
import layout from './Layout.module.css'
import stil from './Darstellung.module.css'

export function Darstellung() {
  return (
    <>
      <section className={layout.abschnitt} aria-labelledby="darstellung-titel">
        <div className={layout.innen}>
          <Eintritt className={layout.kopf}>
            <span className={layout.marke}>Darstellung</span>
            <h2 className="h2" id="darstellung-titel">
              Such dir aus, wie es aussieht
            </h2>
            <p className="lead">
              Zwei Paletten, hell und dunkel. Der Schalter stellt diese Seite sofort um — genau so
              arbeitet er auch in der App.
            </p>
          </Eintritt>

          <Eintritt index={1} className={stil.schalter}>
            <ThemeSwitch />
          </Eintritt>
        </div>
      </section>

      <section className={stil.warteliste} id="warteliste" aria-labelledby="warteliste-titel">
        <div className={layout.innen}>
          <Eintritt className={layout.kopf}>
            <span className={layout.marke}>Warteliste</span>
            <h2 className="h2" id="warteliste-titel">
              Wir sagen Bescheid, wenn telli. da ist
            </h2>
            <p className="lead">
              Eine Nachricht zum Start, sonst nichts. Keine Newsletter, keine Weitergabe.
            </p>
          </Eintritt>

          <Eintritt index={1} className={stil.formular}>
            <Warteliste />
          </Eintritt>
        </div>
      </section>
    </>
  )
}
