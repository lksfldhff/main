import { FaceMark } from '../components/FaceMark'
import { Knopf } from '../components/Knopf'
import { PhoneFrame } from '../components/PhoneFrame'
import { useReduziert } from '../hooks/useReduziert'
import stil from './Hero.module.css'

export function Hero() {
  const reduziert = useReduziert()

  const springeZu = (id: string) => {
    const ziel = document.getElementById(id)
    if (!ziel) return
    ziel.scrollIntoView({ behavior: reduziert ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <header className={stil.hero} id="oben">
      <div className={stil.innen}>
        <div className={stil.text}>
          <span className={stil.marke}>telli.</span>
          <h1 className={stil.headline}>Dein Tagebuch für Tage, an denen nichts geht.</h1>
          <p className={stil.unterzeile}>
            telli. erfasst Migräne, ME/CFS und Magen-Darm-Beschwerden in wenigen Sekunden — und
            zeigt dir, was damit zusammentraf.
          </p>
          <div className={stil.knoepfe}>
            <Knopf art="hell" onClick={() => springeZu('warteliste')}>
              Auf die Warteliste
            </Knopf>
            <Knopf art="leise" onClick={() => springeZu('erfassen')}>
              So funktioniert es
            </Knopf>
          </div>
        </div>

        <div className={stil.geraet}>
          <PhoneFrame variante="hero">
            <div className={stil.startscreen}>
              <div className={stil.kopfbereich}>
                <FaceMark variante="szene" blick className={stil.gesicht} />
                <div className={stil.kopfText}>
                  <span className={stil.appMarke}>telli.</span>
                  <span className={stil.claim}>
                    Deine Gesundheit.
                    <br />
                    Dein Überblick.
                  </span>
                </div>
              </div>

              <div className={stil.unterer}>
                <p className={stil.appText}>
                  Erfasse Migräne, Begleitsymptome und deinen Alltag in wenigen Sekunden. telli.
                  zeigt dir mögliche Zusammenhänge – zum Beispiel mit Wetter, Schlaf oder Zyklus.
                </p>
                <span className={stil.appCta}>Loslegen</span>
                <span className={stil.appZweit}>Ich habe bereits ein Konto</span>
                <span className={stil.appNotiz}>
                  In Vorbereitung – telli. funktioniert ohne Konto
                </span>
              </div>
            </div>
          </PhoneFrame>
        </div>
      </div>
    </header>
  )
}
