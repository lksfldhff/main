import stil from './Fusszeile.module.css'

export function Fusszeile() {
  return (
    <footer className={stil.fuss}>
      <div className={stil.innen}>
        <span className={stil.marke}>telli.</span>

        <nav className={stil.links} aria-label="Rechtliches">
          <a className={stil.link} href="#impressum">
            Impressum
          </a>
          <a className={stil.link} href="#datenschutzerklaerung">
            Datenschutz
          </a>
        </nav>

        <p className={stil.notiz}>In Vorbereitung — telli. funktioniert ohne Konto.</p>
      </div>
    </footer>
  )
}
