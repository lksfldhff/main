"""Fenster-Version: Word-Datei waehlen, HTML kopieren -- fertig.

Bewusst nur mit tkinter aus der Python-Standardbibliothek, damit die
gebaute .exe ohne Installation laeuft.
"""

from __future__ import annotations

import tempfile
import threading
import traceback
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .cli import convert
from .config import Config, find_config, load_config

DARK = "#06465E"
TEAL = "#136F8B"
YELLOW = "#FFFC00"
BG = "#f4f7f8"


class App:
    def __init__(self, root: tk.Tk, initial: str | None = None) -> None:
        self.root = root
        self.docx_path: Path | None = None
        self.config_path: Path | None = None
        self.config = Config()
        self.html = ""

        root.title("Word → Newsletter-HTML")
        root.geometry("980x720")
        root.minsize(760, 560)
        root.configure(bg=BG)

        self._build_style()
        self._build_widgets()

        if initial:
            self.load(Path(initial))

    # ------------------------------------------------------------- Aufbau

    def _build_style(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background=BG)
        style.configure("Card.TFrame", background="#ffffff")
        style.configure("TLabel", background=BG, foreground=DARK, font=("Segoe UI", 10))
        style.configure("Head.TLabel", font=("Segoe UI", 16, "bold"), foreground=DARK)
        style.configure("Sub.TLabel", font=("Segoe UI", 9), foreground="#5b7280")
        style.configure("TButton", font=("Segoe UI", 10), padding=(12, 7))
        style.configure(
            "Accent.TButton", font=("Segoe UI", 10, "bold"), foreground="#ffffff",
            background=TEAL, padding=(14, 8),
        )
        style.map("Accent.TButton", background=[("active", DARK), ("disabled", "#9bb3bd")])

    def _build_widgets(self) -> None:
        outer = ttk.Frame(self.root, padding=16)
        outer.pack(fill="both", expand=True)

        ttk.Label(outer, text="Word → Newsletter-HTML", style="Head.TLabel").pack(anchor="w")
        ttk.Label(
            outer,
            text="Word-Datei auswaehlen, HTML kopieren, in CleverReach in den "
                 "Quelltext-Editor einfuegen.",
            style="Sub.TLabel",
        ).pack(anchor="w", pady=(2, 12))

        bar = ttk.Frame(outer)
        bar.pack(fill="x")
        ttk.Button(bar, text="Word-Datei waehlen …", style="Accent.TButton",
                   command=self.choose_file).pack(side="left")
        self.reload_btn = ttk.Button(bar, text="Neu einlesen", command=self.reload,
                                     state="disabled")
        self.reload_btn.pack(side="left", padx=(8, 0))
        self.copy_btn = ttk.Button(bar, text="HTML kopieren", command=self.copy_html,
                                   state="disabled")
        self.copy_btn.pack(side="left", padx=(8, 0))
        self.save_btn = ttk.Button(bar, text="HTML speichern …", command=self.save_html,
                                   state="disabled")
        self.save_btn.pack(side="left", padx=(8, 0))
        self.preview_btn = ttk.Button(bar, text="Vorschau im Browser", command=self.preview,
                                      state="disabled")
        self.preview_btn.pack(side="left", padx=(8, 0))

        self.file_label = ttk.Label(outer, text="Noch keine Datei geladen.", style="Sub.TLabel")
        self.file_label.pack(anchor="w", pady=(12, 6))

        notebook = ttk.Notebook(outer)
        notebook.pack(fill="both", expand=True)

        html_frame = ttk.Frame(notebook, padding=0)
        notebook.add(html_frame, text="HTML")
        self.text = tk.Text(
            html_frame, wrap="none", font=("Consolas", 10), bg="#ffffff", fg="#1f2933",
            insertbackground=DARK, relief="flat", padx=10, pady=10,
        )
        yscroll = ttk.Scrollbar(html_frame, orient="vertical", command=self.text.yview)
        xscroll = ttk.Scrollbar(html_frame, orient="horizontal", command=self.text.xview)
        self.text.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)
        self.text.grid(row=0, column=0, sticky="nsew")
        yscroll.grid(row=0, column=1, sticky="ns")
        xscroll.grid(row=1, column=0, sticky="ew")
        html_frame.rowconfigure(0, weight=1)
        html_frame.columnconfigure(0, weight=1)

        notes_frame = ttk.Frame(notebook, padding=0)
        notebook.add(notes_frame, text="Hinweise")
        self.notes = tk.Text(
            notes_frame, wrap="word", font=("Segoe UI", 10), bg="#ffffff", fg="#1f2933",
            relief="flat", padx=10, pady=10,
        )
        self.notes.pack(fill="both", expand=True)
        self.notebook = notebook

        self.status = ttk.Label(outer, text="Bereit.", style="Sub.TLabel")
        self.status.pack(anchor="w", pady=(8, 0))

    # ------------------------------------------------------------ Aktionen

    def choose_file(self) -> None:
        path = filedialog.askopenfilename(
            title="Word-Datei waehlen",
            filetypes=[("Word-Dokumente", "*.docx"), ("Alle Dateien", "*.*")],
        )
        if path:
            self.load(Path(path))

    def reload(self) -> None:
        if self.docx_path:
            self.load(self.docx_path)

    def load(self, path: Path) -> None:
        self.docx_path = path
        self.set_status(f"Lese {path.name} …")
        threading.Thread(target=self._convert_worker, args=(path,), daemon=True).start()

    def _convert_worker(self, path: Path) -> None:
        try:
            self.config_path = find_config(path)
            config = load_config(self.config_path)
            html, notes, _ = convert(path, None, config, write_images=False)
        except Exception as exc:  # noqa: BLE001 -- Fehler gehoert ins Fenster, nicht in die Konsole
            detail = traceback.format_exc()
            self.root.after(0, lambda: self._show_error(exc, detail))
            return
        self.root.after(0, lambda: self._show_result(path, config, html, notes))

    def _show_result(self, path: Path, config: Config, html: str, notes: list[str]) -> None:
        self.config = config
        self.html = html
        self.text.delete("1.0", "end")
        self.text.insert("1.0", html)

        self.notes.delete("1.0", "end")
        if notes:
            self.notes.insert("1.0", "\n".join(f"• {n}" for n in notes))
        else:
            self.notes.insert("1.0", "Keine Auffaelligkeiten. Alles sauber umgewandelt.")

        config_info = self.config_path.name if self.config_path else "Standardwerte (keine config.json gefunden)"
        self.file_label.configure(text=f"{path}    —    Konfiguration: {config_info}")
        for button in (self.reload_btn, self.copy_btn, self.save_btn, self.preview_btn):
            button.configure(state="normal")
        count = html.count('class="article"')
        sections = html.count('class="section"')
        zeichen = f"{len(html):,}".replace(",", ".")
        self.set_status(
            f"Fertig: {sections} Abschnitt(e), {count} Artikel, {zeichen} Zeichen HTML."
        )
        if notes:
            self.notebook.select(1)

    def _show_error(self, exc: Exception, detail: str) -> None:
        self.set_status("Fehler beim Umwandeln.")
        self.notes.delete("1.0", "end")
        self.notes.insert("1.0", f"{exc}\n\n{detail}")
        self.notebook.select(1)
        messagebox.showerror("Fehler", str(exc))

    def copy_html(self) -> None:
        if not self.html:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(self.html)
        self.root.update()
        self.set_status("HTML in die Zwischenablage kopiert.")

    def save_html(self) -> None:
        if not self.html or not self.docx_path:
            return
        target = filedialog.asksaveasfilename(
            title="HTML speichern",
            defaultextension=".html",
            initialfile=self.docx_path.with_suffix(".html").name,
            initialdir=str(self.docx_path.parent),
            filetypes=[("HTML-Datei", "*.html")],
        )
        if not target:
            return
        try:
            _, notes, written = convert(self.docx_path, Path(target), self.config)
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Fehler", str(exc))
            return
        self.set_status(f"Gespeichert: {written}")
        if notes:
            self.notes.delete("1.0", "end")
            self.notes.insert("1.0", "\n".join(f"• {n}" for n in notes))

    def preview(self) -> None:
        if not self.html:
            return
        folder = Path(tempfile.gettempdir()) / "word2newsletter"
        folder.mkdir(exist_ok=True)
        name = (self.docx_path.stem if self.docx_path else "vorschau") + ".html"
        target = folder / name
        target.write_text(self.html, encoding="utf-8")
        webbrowser.open(target.resolve().as_uri())
        self.set_status("Vorschau im Browser geoeffnet.")

    def set_status(self, text: str) -> None:
        self.status.configure(text=text)


def run(initial: str | None = None) -> None:
    root = tk.Tk()
    App(root, initial)
    root.mainloop()


if __name__ == "__main__":
    run()
