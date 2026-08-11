import { DoseChecklist } from '../components/DoseChecklist'
import { Eintritt } from '../components/Eintritt'
import { PhoneFrame } from '../components/PhoneFrame'
import layout from './Layout.module.css'
import stil from './Medikamente.module.css'

const WEGE = [
  {
    titel: 'Packung fotografieren',
    text: 'Name, Wirkstoff, Dosis und Einnahmeschema werden aus der Packung vorgeschlagen.',
  },
  {
    titel: 'Aus der Datenbank wählen',
    text: 'Manuell angelegt, mit Wirkstoff und den bekannten Nebenwirkungen zum Nachlesen.',
  },
  {
    titel: 'Einmal erfasst, immer vorgeschlagen',
    text: 'Dosis und Zeitpunkt stehen bei jedem weiteren Eintrag schon da.',
  },
]

export function Medikamente() {
  return (
    <section className={layout.abschnitt} id="medikamente" aria-labelledby="medikamente-titel">
      <div className={layout.innen}>
        <div className={layout.zwei}>
          <Eintritt className={layout.text}>
            <div className={layout.kopf}>
              <span className={layout.marke}>Medikamente</span>
              <h2 className="h2" id="medikamente-titel">
                Abhaken, was genommen wurde
              </h2>
              <p className="lead">
                Der Einnahmeplan steht auf der Übersicht. Ein Tippen genügt — die Zeit steht schon
                dabei, nichts muss noch einmal eingegeben werden.
              </p>
            </div>

            <ul className={layout.punkte}>
              {WEGE.map((weg) => (
                <li key={weg.titel} className={layout.punkt}>
                  <h3 className={layout.punktTitel}>{weg.titel}</h3>
                  <p className={layout.punktText}>{weg.text}</p>
                </li>
              ))}
            </ul>
          </Eintritt>

          <div className={layout.demo}>
            <div className={layout.klebrig}>
              <PhoneFrame>
                <div className={stil.inhalt}>
                  <DoseChecklist />
                </div>
              </PhoneFrame>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
