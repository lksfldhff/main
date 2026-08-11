import { Eintritt } from '../components/Eintritt'
import layout from './Layout.module.css'
import stil from './Problem.module.css'

const KACHELN = [
  {
    titel: 'Notizen im Handy',
    text: 'Verteilt über Chats, Fotos und Notizzettel. Beim Termin ist die Hälfte nicht auffindbar.',
  },
  {
    titel: 'Papierkalender',
    text: 'Ein Kreuz pro Tag. Wie stark, wie lange und was dazu kam, steht nicht darin.',
  },
  {
    titel: 'Erinnerung',
    text: 'Nach zwölf Wochen bleibt ein Eindruck. Die Praxis rechnet mit Tagen und Zahlen.',
  },
]

export function Problem() {
  return (
    <section className={layout.abschnitt} aria-labelledby="problem-titel">
      <div className={layout.innen}>
        <Eintritt className={layout.kopf}>
          <h2 className="h2" id="problem-titel">
            Was beim Termin fehlt
          </h2>
          <p className="lead">
            Zwanzig Minuten Sprechzeit, zwölf Wochen Verlauf. Was nicht aufgeschrieben ist, ist
            nicht besprechbar.
          </p>
        </Eintritt>

        <ul className={stil.kacheln}>
          {KACHELN.map((kachel, i) => (
            <li key={kachel.titel}>
              <Eintritt index={i + 1} className={stil.kachel}>
                <h3 className={stil.titel}>{kachel.titel}</h3>
                <p className={stil.text}>{kachel.text}</p>
              </Eintritt>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
