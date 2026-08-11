import { Eintritt } from '../components/Eintritt'
import layout from './Layout.module.css'
import stil from './Datenschutz.module.css'

const PUNKTE = [
  {
    titel: 'Alles bleibt lokal',
    text: 'Einträge, Notizen und Sprachaufnahmen werden auf dem iPhone gespeichert und verlassen das Gerät nicht.',
  },
  {
    titel: 'Kein Konto',
    text: 'Keine Registrierung, keine E-Mail-Adresse, kein Server, auf dem etwas liegen könnte.',
  },
  {
    titel: 'Wetter ohne Adresse',
    text: 'Wetterdaten werden anonym abgefragt. Der Standort wird für die Abfrage benutzt, nicht gespeichert.',
  },
  {
    titel: 'Export für den Termin',
    text: 'Bericht als PDF oder CSV. Du entscheidest vor dem Export, welcher Zeitraum darin steht.',
  },
]

export function Datenschutz() {
  return (
    <section className={layout.abschnitt} id="datenschutz" aria-labelledby="datenschutz-titel">
      <div className={layout.innen}>
        <Eintritt className={layout.kopf}>
          <span className={layout.marke}>Datenschutz</span>
          <h2 className="h2" id="datenschutz-titel">
            Alles bleibt auf dem Gerät
          </h2>
          <p className="lead">
            Ein Symptomtagebuch ist eine Krankenakte. Deshalb gibt es bei telli. nichts, was
            hochgeladen werden müsste.
          </p>
        </Eintritt>

        <ul className={stil.punkte}>
          {PUNKTE.map((punkt, i) => (
            <li key={punkt.titel}>
              <Eintritt index={i + 1} className={stil.punkt}>
                <h3 className={stil.titel}>{punkt.titel}</h3>
                <p className={stil.text}>{punkt.text}</p>
              </Eintritt>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
