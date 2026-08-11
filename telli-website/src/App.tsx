import { LazyMotion } from 'motion/react'
import { Nav } from './components/Nav'
import { Hero } from './sections/Hero'
import { Problem } from './sections/Problem'
import { Erfassen } from './sections/Erfassen'
import { Medikamente } from './sections/Medikamente'
import { Zusammenhaenge } from './sections/Zusammenhaenge'
import { Datenschutz } from './sections/Datenschutz'
import { Darstellung } from './sections/Darstellung'
import { Fusszeile } from './sections/Fusszeile'
import stil from './App.module.css'

/**
 * Die Animationsfunktionen werden erst nach dem ersten Rendern nachgeladen —
 * das haelt das Startbundle klein. `strict` verbietet `motion.*`, damit nicht
 * versehentlich doch die volle Bibliothek mitwandert.
 */
const merkmale = () => import('./lib/motionFeatures').then((modul) => modul.default)

export function App() {
  return (
    <LazyMotion features={merkmale} strict>
      <a className="sprungmarke" href="#inhalt">
        Zum Inhalt springen
      </a>

      <Nav />

      <main id="inhalt">
        <Hero />

        {/* Leitmotiv der App: helles Sheet, über den dunklen Hero geschoben. */}
        <div className={stil.sheet}>
          <Problem />
          <Erfassen />
          <Medikamente />
          <Zusammenhaenge />
          <Datenschutz />
          <Darstellung />
        </div>
      </main>

      <Fusszeile />
    </LazyMotion>
  )
}
