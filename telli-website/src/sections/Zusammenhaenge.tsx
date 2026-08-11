import { Eintritt } from '../components/Eintritt'
import { InsightChart } from '../components/InsightChart'
import layout from './Layout.module.css'
import stil from './Zusammenhaenge.module.css'

export function Zusammenhaenge() {
  return (
    <section className={layout.abschnitt} id="zusammenhaenge" aria-labelledby="zusammenhaenge-titel">
      <div className={layout.innen}>
        <Eintritt className={layout.kopf}>
          <span className={layout.marke}>Zusammenhänge</span>
          <h2 className="h2" id="zusammenhaenge-titel">
            Was an deinen schlechten Tagen häufiger dabei war
          </h2>
          <p className="lead">
            telli. legt Wetter, Schlaf, Zyklus und Alltag über die erfassten Tage und zählt aus,
            was zusammentraf. Der Zeitraum lässt sich wechseln — die Nenner wandern mit.
          </p>
        </Eintritt>

        <Eintritt index={1} className={stil.karte}>
          <InsightChart />
        </Eintritt>
      </div>
    </section>
  )
}
