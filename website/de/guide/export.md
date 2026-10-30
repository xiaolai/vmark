# Export & Drucken

VMark bietet mehrere Möglichkeiten, Ihre Dokumente zu exportieren und zu teilen.

## Was ein Export erzeugt

**Datei → Exportieren → HTML** schreibt einen Ordner, benannt nach Ihrem Dokument, der immer **beide** dieser Dateien enthält — es gibt keinen Modus zur Auswahl:

```text
MyDocument/
├── index.html          ← links to the files under assets/
├── standalone.html     ← everything embedded as data URIs (CSS, JS, images, fonts)
└── assets/
    ├── vmark-reader.css
    ├── vmark-reader.js
    ├── images/
    │   ├── image1.png
    │   └── ...
    └── fonts/          ← only when the document has math or you use a web font
```

Verwenden Sie die Datei, die gerade passt:

| Datei | Am besten für | Nachteil |
|-------|---------------|----------|
| `index.html` | Hosting auf einer statischen Website (saubere `/MyDocument/`-URLs), Bearbeitung in einem anderen Werkzeug, geringe Größe | Benötigt den Ordner `assets/` daneben |
| `standalone.html` | Versand einer einzelnen Datei per E-Mail oder Messenger, die ihre Bilder nicht verlieren darf | Größer — jedes Asset ist eingebettet |

Beide Dateien werden vom selben WYSIWYG-Renderer und Stylesheet gerendert, die auch der Editor verwendet, und beide enthalten den [VMark Reader](#vmark-reader).

## So exportieren Sie

### HTML exportieren

1. Verwenden Sie **Datei → Exportieren → HTML**
2. Speicherort auswählen und einen Namen eingeben — er wird zum Ordnernamen (ein angehängtes `.html` wird entfernt)
3. `index.html` oder `standalone.html` aus dem neuen Ordner öffnen

#### Erneuter Export in einen bereits verwendeten Ordner

Ein HTML-Export geschieht ganz oder gar nicht. Alles wird zunächst in einen
temporären Ordner `.vmark-export-…` innerhalb des gewählten Ziels geschrieben und
erst an seinen Platz verschoben, wenn jede Datei existiert — ein Export, der
mittendrin fehlschlägt, lässt den vorherigen Export also genau so, wie er war,
statt ihn halb zu überschreiben.

Zwei Dinge können Ihnen begegnen:

- **„Ein anderer Export schreibt bereits in diesen Ordner.“** Es kann immer nur
  ein Export gleichzeitig in einen Ordner schreiben, fensterübergreifend. Warten
  Sie auf den anderen, oder — wenn sonst nichts läuft — löschen Sie die in der
  Meldung genannte Datei `.vmark-export.lock` und versuchen Sie es erneut.
- **Ein zurückgebliebener Ordner `.vmark-export-…`.** VMark entfernt ihn, wenn es
  fertig ist. Er bleibt nur bestehen, wenn auch das Zurücklegen Ihrer vorherigen
  Dateien fehlgeschlagen ist; in diesem Fall enthält er diese Dateien, und die
  Fehlermeldung nennt genau, wo sie liegen. Solange das die einzige Kopie ist,
  wird nichts gelöscht.

### Drucken / Als PDF exportieren

Verfügbar unter macOS, Windows und Linux.

**PDF exportieren** (**Datei → Exportieren → PDF**) schreibt direkt eine PDF-Datei
mit der Seitengröße, Ausrichtung, den Rändern und der Typografie, die Sie im
Exportdialog wählen.

**Drucken** (`Cmd/Strg + P` oder **Datei → Drucken**) öffnet stattdessen den
Druckdialog des Systems, sodass Sie das Dokument an einen Drucker senden oder die
Funktion „Als PDF sichern“ Ihres Betriebssystems verwenden können. Unter macOS
und Linux bestätigt VMark einen abgeschlossenen Druckauftrag mit einem kurzen
Hinweis und bleibt still, wenn Sie den Dialog abbrechen; die Druckoberfläche von
Windows meldet nichts zurück, daher wird dort kein Hinweis angezeigt.

Der Exportdialog zeigt auf allen drei Plattformen dieselben Fortschrittsstufen —
Laden, Erstellen, Abschließen, Fertig.

::: info Seitengröße unter macOS
Die im Dialog gewählte Seitengröße und Ausrichtung bestimmen auf jeder Plattform
die exportierte Seite. Unter macOS überschreiben sie die im System eingestellte
Papiergröße — ist Ihr Mac standardmäßig auf Letter eingestellt und Sie wählen
A4, wird die PDF-Datei A4.
:::

**Gliederung in der Seitenleiste.** Exportierte PDF-Dateien enthalten auf allen
drei Plattformen eine Überschriftengliederung — das anklickbare
Inhaltsverzeichnis, das Ihr PDF-Betrachter in seiner Seitenleiste anzeigt.

#### Seitenzahlen

Der Abschnitt **Seitenzahlen** des Dialogs versieht jede Seite mit einer Nummer.
Er ist standardmäßig aktiviert, unten mittig.

| Einstellung | Optionen |
|-------------|----------|
| Position | Unten mittig, unten rechts oder keine |
| Format | `7`, `7 / 12` oder `Seite 7 von 12` |
| Erste Seite überspringen | Lässt Seite 1 ohne Nummer, wie bei einer Titelseite üblich |

Die Nummer steht innerhalb des gewählten unteren Rands und skaliert mit der
Schriftgröße des Fließtexts. Die Nummerierung entspricht immer der tatsächlichen
Seite; wenn Sie die erste Seite überspringen, erhalten die folgenden Seiten also
2, 3, 4… statt einer Neunummerierung.

::: info Seitenzahlen verwenden ein lateinisches Alphabet
Die Nummer wird mit einer Standard-PDF-Schrift gezeichnet, die kein Betrachter
herunterladen muss — das hält Exporte schnell und in sich geschlossen —, doch
diese Schrift kann weder Chinesisch, Japanisch, Koreanisch noch Kyrillisch
darstellen. Die beiden numerischen Formate funktionieren in jeder Sprache. Wenn
Ihre Oberflächensprache `Page 7 of 12` in einer Schrift schreibt, die diese
Schriftart nicht zeichnen kann, druckt VMark stattdessen die numerische Form
`7 / 12`, statt Leerstellen oder falsche Zeichen.
:::

### In andere Formate exportieren

VMark integriert [Pandoc](https://pandoc.org/) — einen universellen Dokumentkonverter — um Ihre Markdown-Dateien in weitere Formate zu exportieren. Wählen Sie ein Format direkt aus dem Menü:

**Datei → Exportieren → Über Pandoc →**

| Menüeintrag | Erweiterung |
|-------------|-------------|
| Word (.docx) | `.docx` |
| EPUB (.epub) | `.epub` |
| LaTeX (.tex) | `.tex` |
| OpenDocument (.odt) | `.odt` |
| Formatierter Text (.rtf) | `.rtf` |
| Nur Text (.txt) | `.txt` |

**Einrichtung:**

1. Pandoc von [pandoc.org/installing](https://pandoc.org/installing.html) installieren oder über Ihren Paketmanager:
   - macOS: `brew install pandoc`
   - Windows: `winget install pandoc`
   - Linux: `apt install pandoc`
2. VMark neu starten (oder **Einstellungen → Dateien & Bilder → Dokumentwerkzeuge** öffnen und auf **Erkennen** klicken)
3. **Datei → Exportieren → Über Pandoc → [Format]** zum Exportieren verwenden

Wenn Pandoc nicht installiert ist, zeigt das Untermenü **Über Pandoc** einen einzigen Eintrag — **„Pandoc installieren, um Word, EPUB, LaTeX… zu exportieren“** —, der beim Anklicken die Pandoc-Installationsanleitung öffnet.

Sie können prüfen, ob Pandoc erkannt wurde, unter **Einstellungen → Dateien & Bilder → Dokumentwerkzeuge**.

### Als HTML kopieren

Drücken Sie `Cmd/Strg + Umschalt + C`, um das gerenderte Dokument als HTML-**Quelltext** zu kopieren. Das Markup landet als reiner Text und ohne Styles in der Zwischenablage. Fügen Sie es also dort ein, wo HTML-Code erwartet wird — in der HTML-Ansicht eines CMS, in einer Vorlage, in einem Code-Editor; ein Rich-Text-Editor wie Word oder Mail zeigt die Tags wörtlich an. Lokale Bilder werden als Data-URIs eingebettet, sodass sie auch außerhalb von VMark angezeigt werden.

## VMark Reader

Jeder HTML-Export enthält den **VMark Reader** — ein interaktives Leseerlebnis mit eigenen Einstellungen, eigener Navigation und Lightbox.

### Einstellungspanel

Klicken Sie auf das Zahnradsymbol (unten rechts), um das Einstellungspanel zu öffnen; `Esc` schließt es wieder. Ihre Auswahl merkt sich der Browser (`localStorage`), sodass sie beim nächsten Öffnen der Datei gilt.

| Einstellung | Optionen |
|-------------|----------|
| Schriftgröße | 12px – 28px |
| Zeilenhöhe | 1,2 – 2,4 |
| Inhaltsbreite | 30em – 80em |
| Lateinische Schrift | System, Athelas, Palatino, Georgia, Charter, Literata |
| CJK-Schrift | System, PingFang, Songti, Kaiti, Noto Serif, Source Han |
| Design | White, Paper (Standard), Mint, Sepia, Night |
| CJK-Zeichenabstand | 0,02em – 0,12em |
| CJK-Lateinischer Abstand | Automatische Abstände zwischen CJK- und lateinischen Zeichen umschalten |
| Inhaltsverzeichnis | Die TOC-Seitenleiste umschalten (wie das Drücken von `T`) |
| Alle Abschnitte aufklappen | Jeden zusammenklappbaren `<details>`-Block öffnen |
| Auf Standard zurücksetzen | Alle Einstellungen zurücksetzen |

### Inhaltsverzeichnis

Die TOC-Seitenleiste hilft bei der Navigation in langen Dokumenten:

- **Umschalten**: Auf den Reiter am Seitenrand klicken oder `T` drücken
- **Navigieren**: Auf eine Überschrift klicken, um dorthin zu springen
- **Hervorhebung**: Der aktuelle Abschnitt wird beim Scrollen hervorgehoben

### Lesefortschritt

Ein dezenter Fortschrittsbalken oben auf der Seite zeigt, wie weit Sie im Dokument gelesen haben.

### Zurück nach oben

Eine schwebende Schaltfläche erscheint, wenn Sie nach unten scrollen. Klicken Sie darauf, um zum Anfang zurückzukehren.

### Bild-Lightbox

Klicken Sie auf ein Bild, um es im Vollbild-Lightbox zu betrachten:

- **Schließen**: Außerhalb klicken, `Esc` drücken oder auf das X-Symbol klicken
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
| `Esc` | Einstellungspanel oder Lightbox schließen |
| `T` | Inhaltsverzeichnis umschalten |
| `+` / `=` | Schriftgröße erhöhen |
| `-` | Schriftgröße verringern |

## Exportkürzel

| Aktion | Kürzel |
|--------|--------|
| HTML exportieren | _(nur Menü)_ |
| PDF exportieren | _(nur Menü)_ |
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

Beide Dateien lassen sich offline öffnen, mit einem Unterschied bei Dokumenten, die Mathematik enthalten:

- **`standalone.html`** ist vollständig in sich geschlossen — das KaTeX-Stylesheet und die Schriften werden beim Export eingebettet, sodass Mathematik ohne Verbindung dargestellt wird.
- **`index.html`** lädt das KaTeX-Stylesheet von einem CDN (jsDelivr), sodass die Mathematik beim Öffnen der Seite eine Internetverbindung benötigt; der Reader, die Bilder und die Schriften unter `assets/` sind lokal.

Schriften werden während des Exports heruntergeladen: KaTeX-Schriften, wenn das Dokument Mathematik enthält, und Ihre lateinische und Ihre Monospace-Schrift, wenn es Webschriften sind, die VMark kennt (Literata, JetBrains Mono, Fira Code, IBM Plex Mono). Die CJK-Schrifteinstellung wird nie eingebettet, ebenso wenig eine Systemschrift oder eine benutzerdefinierte Schriftfamilie — die exportierte Seite verwendet dafür den System-Schriftstapel des Lesers. Exportieren Sie auf einem Rechner mit Internetzugang, wenn Sie Schriften eingebettet haben möchten — ein Offline-Export fällt auf Systemschriften zurück.

### Welche Bilder eingebettet werden

Eine exportierte Datei enthält echte Bild-Bytes, und Exporte werden geteilt —
daher begrenzt VMark, woher diese Bytes stammen dürfen:

| Ihr Dokument liegt… | Bilder dürfen stammen aus |
|---|---|
| in einem geöffneten Arbeitsbereich | beliebigen Orten in diesem Arbeitsbereich |
| für sich allein geöffnet | dem Ordner des Dokuments und seinen Unterordnern |
| ungespeichert (nie auf die Festplatte gespeichert) | nirgendwoher — kein lokales Bild wird eingebettet, auch nicht bei geöffnetem Arbeitsbereich; entfernte Bilder sind nicht betroffen |

Speichern Sie ein ungespeichertes Dokument zuerst und exportieren Sie es dann erneut. Das gilt für HTML, Drucken, PDF und Als HTML kopieren.

Relative Pfade werden vom Ordner des Dokuments aus aufgelöst, genau wie im
Editor — `../images/photo.png` funktioniert also, solange das Ziel innerhalb der
obigen Grenze bleibt. Alles außerhalb davon (`~/.ssh/id_rsa`, `/etc/passwd`, ein
absoluter Pfad an anderer Stelle auf der Festplatte) wird abgewiesen und als
Platzhalter „Image not found“ exportiert, der in der Warnung des Exports
mitgezählt wird.

Wenn ein `../`-Bild als Platzhalter exportiert wird, öffnen Sie seinen Ordner als
Arbeitsbereich und exportieren Sie erneut.

### Bewährte Praktiken

1. **`index.html` hosten** für Dokumente, die Sie veröffentlichen — den Ordner `assets/` daneben behalten
2. **`standalone.html` senden** für schnelles Teilen per E-Mail oder Chat
3. **Beschreibenden Bild-Alternativtext** für Barrierefreiheit hinzufügen
4. **Das exportierte HTML** in verschiedenen Browsern testen
