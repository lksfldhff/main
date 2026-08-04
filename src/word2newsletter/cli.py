"""Kommandozeile: word.docx -> newsletter.html"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import Config, find_config, load_config
from .docx_reader import read_docx
from .renderer import render_document


def convert(
    docx_path: str | Path,
    output_path: str | Path | None = None,
    config: Config | None = None,
    write_images: bool = True,
) -> tuple[str, list[str], Path | None]:
    """Wandelt eine Word-Datei um und schreibt optional die HTML-Datei.

    Liefert (html, hinweise, geschriebener_pfad).
    """

    docx_path = Path(docx_path)
    config = config or load_config(find_config(docx_path))
    doc = read_docx(docx_path)

    out = Path(output_path) if output_path else docx_path.with_suffix(".html")
    mode = str(config.get("images.mode", "relative"))
    suffix = str(config.get("images.folder_suffix", "_bilder"))
    image_folder = out.parent / f"{out.stem}{suffix}"
    prefix = f"{image_folder.name}/" if mode == "relative" else ""

    html, notes = render_document(doc, config, image_prefix=prefix)

    if doc.images and mode == "relative" and write_images and output_path is not None:
        image_folder.mkdir(parents=True, exist_ok=True)
        for asset in doc.images.values():
            (image_folder / asset.name).write_bytes(asset.data)
        notes.append(
            f"{len(doc.images)} Bild(er) nach {image_folder.name}/ geschrieben. "
            "Fuer den Versand in den CleverReach-Medienpool hochladen und "
            'images.mode auf "url" stellen.'
        )

    written: Path | None = None
    if output_path is not None:
        out.write_text(html, encoding="utf-8")
        written = out
    return html, notes, written


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="word2newsletter",
        description="Wandelt eine Word-Datei in fertiges CleverReach-HTML um.",
    )
    parser.add_argument("docx", nargs="?", help="Pfad zur .docx-Datei")
    parser.add_argument("-o", "--output", help="Zieldatei (Standard: gleicher Name mit .html)")
    parser.add_argument("-c", "--config", help="Pfad zur config.json")
    parser.add_argument(
        "--images",
        choices=("relative", "url", "inline"),
        help="Wie Bilder aus der Word-Datei verlinkt werden",
    )
    parser.add_argument("--stdout", action="store_true", help="HTML auf die Konsole schreiben")
    parser.add_argument("--open", action="store_true", help="Ergebnis im Browser oeffnen")
    parser.add_argument("--gui", action="store_true", help="Fenster-Version starten")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.gui or not args.docx:
        from .gui import run

        run(args.docx)
        return 0

    config_path = Path(args.config) if args.config else find_config(args.docx)
    try:
        config = load_config(config_path)
    except ValueError as exc:
        print(f"Fehler in der Konfiguration: {exc}", file=sys.stderr)
        return 2
    if args.images:
        config = config.merged_with({"images": {"mode": args.images}})

    output = None if args.stdout else Path(args.output) if args.output else Path(args.docx).with_suffix(".html")
    try:
        html, notes, written = convert(args.docx, output, config)
    except (FileNotFoundError, ValueError) as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1

    if args.stdout:
        sys.stdout.write(html)
    else:
        print(f"HTML geschrieben: {written}")
    for note in notes:
        print(f"  Hinweis: {note}", file=sys.stderr)
    if args.open and written:
        import webbrowser

        webbrowser.open(written.resolve().as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
