# Export & Drucken

VMark bietet mehrere Möglichkeiten, Ihre Dokumente zu exportieren und zu teilen.

## Exportmodi

### Ordnermodus (Standard)

Erstellt einen eigenständigen Ordner mit übersichtlicher Struktur:

```text
MyDocument/
├── index.html
└── assets/
    ├── image1.png
    ├── image2.jpg
    └── ...
```

**Vorteile:**
- Saubere URLs beim Bereitstellen (`/MyDocument/` statt `/MyDocument.html`)
- Einfach als einzelner Ordner teilbar
- Einfache Asset-Pfade (`assets/image.png`)
- Funktioniert hervorragend mit statischen Website-Hosts

### Einzeldateimodus

Erstellt eine einzelne, eigenständige HTML-Datei:

```text
MyDocument.html
```

Alle Bilder werden als Data-URIs eingebettet, was die Datei vollständig portabel, aber größer macht.

## So exportieren Sie

### HTML exportieren

1. Verwenden Sie **Datei → HTML exportieren**
2. Speicherort auswählen
3. Für den Ordnermodus: Ordnernamen eingeben (z.B. `MyDocument`)
4. Für den Einzelmodus: Dateinamen mit `.html`-Erweiterung eingeben

### Drucken / Als PDF exportieren

1. Drücken Sie `Cmd/Strg + P` oder verwenden Sie **Datei → Drucken**
2. Verwenden Sie den Systemdruckdialog zum Drucken oder Speichern als PDF

### In andere Formate exportieren

VMark integriert [Pandoc](https://pandoc.org/) — einen universellen Dokumentkonverter — um Ihre Markdown-Dateien in weitere Formate zu exportieren. Wählen Sie ein Format direkt aus dem Menü:

**Datei → Exportieren → Andere Formate →**

| Menüeintrag | Erweiterung |
|-------------|-------------|
| Word (.docx) | `.docx` |
| EPUB (.epub) | `.epub` |
| LaTeX (.tex) | `.tex` |
| OpenDocument (.odt) | `.odt` |
| Rich Text (.rtf) | `.rtf` |
| Nur Text (.txt) | `.txt` |

**Einrichtung:**

1. Pandoc von [pandoc.org/installing](https://pandoc.org/installing.html) installieren oder über Ihren Paketmanager:
   - macOS: `brew install pandoc`
   - Windows: `winget install pandoc`
   - Linux: `apt install pandoc`
2. VMark neu starten (oder **Einstellungen → Dateien & Bilder → Dokumenttools** öffnen und auf **Erkennen** klicken)
3. **Datei → Exportieren → Andere Formate → [Format]** zum Exportieren verwenden

Wenn Pandoc nicht installiert ist, zeigt das Menü unten im Untermenü „Andere Formate" einen **„Pandoc erforderlich — pandoc.org"**-Link.

Sie können prüfen, ob Pandoc erkannt wurde, unter **Einstellungen → Dateien & Bilder → Dokumenttools**.

### Als HTML kopieren

Drücken Sie `Cmd/Strg + Umschalt + C`, um das gerenderte HTML in die Zwischenablage zu kopieren und in andere Anwendungen einzufügen.

## VMark Reader

Beim Export nach HTML (gestylter Modus) enthält Ihr Dokument den **VMark Reader** — ein interaktives Leseerlebnis mit leistungsstarken Funktionen.

### Einstellungspanel

Klicken Sie auf das Zahnradsymbol (unten rechts) oder drücken Sie `Esc`, um das Einstellungspanel zu öffnen:

| Einstellung | Beschreibung |
|-------------|--------------|
| Schriftgröße | Textgröße anpassen (12px – 24px) |
| Zeilenhöhe | Zeilenabstand anpassen (1,2 – 2,0) |
| Design | Design wechseln (White, Paper, Mint, Sepia, Night) |
| CJK-Lateinischer Abstand | Abstände zwischen CJK- und lateinischen Zeichen umschalten |

### Inhaltsverzeichnis

Die TOC-Seitenleiste hilft bei der Navigation in langen Dokumenten:

- **Umschalten**: Auf die Panel-Überschrift klicken oder `T` drücken
- **Navigieren**: Auf eine Überschrift klicken, um dorthin zu springen
- **Tastatur**: `↑`/`↓`-Pfeile zum Bewegen, `Eingabe` zum Springen
- **Hervorhebung**: Der aktuelle Abschnitt wird beim Scrollen hervorgehoben

### Lesefortschritt

Ein dezenter Fortschrittsbalken oben auf der Seite zeigt, wie weit Sie im Dokument gelesen haben.

### Zurück nach oben

Eine schwebende Schaltfläche erscheint, wenn Sie nach unten scrollen. Klicken Sie darauf oder drücken Sie `Pos1`, um zum Anfang zurückzukehren.

### Bild-Lightbox

Klicken Sie auf ein Bild, um es im Vollbild-Lightbox zu betrachten:

- **Schließen**: Außerhalb klicken, `Esc` drücken oder auf das X-Symbol klicken
- **Navigieren**: `←`/`→`-Pfeile bei mehreren Bildern
- **Zoom**: Bilder werden in ihrer natürlichen Größe angezeigt

### Code-Blöcke

Jeder Code-Block enthält interaktive Steuerelemente:

| Schaltfläche | Funktion |
|--------------|----------|
| Zeilennummern umschalten | Zeilennummern für diesen Block ein-/ausblenden |
| Kopieren-Schaltfläche | Code in die Zwischenablage kopieren |

Die Kopieren-Schaltfläche zeigt ein Häkchen bei Erfolg.

### Fußnotennavigation

Fußnoten sind vollständig interaktiv:

- Auf eine Fußnotenreferenz `[1]` klicken, um zur Definition zu springen
- Auf den `↩`-Rückverweis klicken, um zur Lesestelle zurückzukehren

### Tastaturkürzel

| Taste | Aktion |
|-------|--------|
| `Esc` | Einstellungspanel umschalten |
| `T` | Inhaltsverzeichnis umschalten |
| `↑` / `↓` | TOC-Einträge navigieren |
| `Eingabe` | Zum ausgewählten TOC-Eintrag springen |
| `←` / `→` | Bilder in der Lightbox navigieren |
| `Pos1` | Nach oben scrollen |

## Exportkürzel

| Aktion | Kürzel |
|--------|--------|
| HTML exportieren | _(nur Menü)_ |
| Drucken | `Mod + P` |
| Als HTML kopieren | `Mod + Umschalt + C` |

## Tipps

### Exportiertes HTML bereitstellen

Die Ordner-Exportstruktur funktioniert gut mit jedem statischen Dateiserver:

```bash
# Python
cd MyDocument && python -m http.server 8000

# Node.js (npx)
npx serve MyDocument

# Direkt öffnen
open MyDocument/index.html
```

### Offline-Ansicht

Beide Exportmodi funktionieren vollständig offline:

- **Ordnermodus**: `index.html` in einem beliebigen Browser öffnen
- **Einzelmodus**: Die `.html`-Datei direkt öffnen

Mathematische Gleichungen (KaTeX) benötigen eine Internetverbindung für das Stylesheet, aber alle anderen Inhalte funktionieren offline.

### Bewährte Praktiken

1. **Ordnermodus verwenden** für Dokumente, die Sie teilen oder hosten möchten
2. **Einzelmodus verwenden** für schnelles Teilen per E-Mail oder Chat
3. **Beschreibenden Bild-Alternativtext** für Barrierefreiheit hinzufügen
4. **Das exportierte HTML** in verschiedenen Browsern testen
