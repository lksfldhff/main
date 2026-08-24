# Hier liegt das eigene Textmaterial

Dieser Ordner ist **absichtlich nicht im Repository** (siehe `.gitignore`).
Echte LinkedIn-Beiträge und dienstliche E-Mails enthalten Namen realer
Personen, Adressen und interne Absprachen. Das gehört nicht auf GitHub.

## Material ablegen

Alles hier hinein, was der Stil-Übersetzer lernen soll:

```
korpus/
    posts.docx          Beiträge aus Word
    Shares.csv          aus dem LinkedIn-Datenexport
    profil-seite.html   im Browser gespeicherte Profilseite
```

Gelesen werden `.docx`, `.txt`, `.md`, `.csv`, `.html`, `.json` und `.jsonl`.
Beiträge werden an Leerzeilen oder an einer Trennzeile `---` geteilt.

## Profil lernen

```bash
python bernie.py lernen korpus/ --name "Vorname Nachname" --pruefen
```

Das Ergebnis landet als `korpus/stilprofil.json` — ebenfalls nicht im
Repository. Alle Befehle nehmen es von dort automatisch; ohne eigenes Profil
greift das mitgelieferte Demo-Profil aus `beispiel/demokorpus.jsonl`.

## Warum nicht einfach mitliefern?

Weil aus dem Profil Formulierungen und Beispieltexte wieder herauslesbar sind.
Die Namenserkennung entfernt erkannte Personennamen, ist aber eine Heuristik
und kein Ersatz für eine Durchsicht.
