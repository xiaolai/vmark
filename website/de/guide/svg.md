# SVG-Grafiken

VMark bietet erstklassige Unterstützung für SVG — Skalierbare Vektorgrafiken. Es gibt zwei Möglichkeiten, SVG in Ihren Dokumenten zu verwenden, jede für einen anderen Arbeitsablauf geeignet.

| Methode | Am besten für | Bearbeitbarer Quellcode? |
|---------|--------------|--------------------------|
| [Bild einbetten](#svg-als-bild-einbetten) (`![](datei.svg)`) | Statische SVG-Dateien auf dem Datenträger | Nein |
| [Code-Block](#svg-code-blocke) (` ```svg `) | Inline-SVG, KI-generierte Grafiken | Ja |

## SVG als Bild einbetten

Standard-Markdown-Bildsyntax verwenden, um eine SVG-Datei einzubetten:

```markdown
![Architekturdiagramm](./assets/architecture.svg)
```

Dies funktioniert genau wie PNG- oder JPEG-Bilder — Drag-and-Drop, Einfügen oder über die Symbolleiste einfügen. SVG-Dateien werden als Bilder erkannt und inline gerendert.

**Wann dies zu verwenden ist:** Sie haben eine `.svg`-Datei (aus Figma, Illustrator, Inkscape oder einem Design-Tool) und möchten sie in Ihrem Dokument anzeigen.

**Einschränkungen:** Das SVG wird als statisches Bild gerendert. Sie können den SVG-Quellcode nicht inline bearbeiten, und es erscheinen keine Schwenk-/Zoom- oder Export-Steuerelemente.

## SVG-Code-Blöcke

Rohe SVG-Markierung in einem umzäunten Code-Block mit der `svg`-Sprachkennung einwickeln:

````markdown
```svg
<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="100" rx="10" fill="#4a6fa5"/>
  <text x="100" y="55" text-anchor="middle" fill="white"
        font-size="18" font-family="system-ui">Hello SVG</text>
</svg>
```text
````

Das SVG wird inline gerendert — genau wie Mermaid-Diagramme — mit interaktiven Steuerelementen.

::: tip VMark-exklusiv
Weder Typora noch Obsidian unterstützen ` ```svg `-Code-Blöcke. Dies ist eine VMark-exklusive Funktion, entwickelt für KI-Arbeitsabläufe, bei denen Tools SVG-Visualisierungen (Diagramme, Illustrationen, Symbole) generieren, die nicht in Mermaids Grammatik passen.
:::

### Wann Code-Blöcke zu verwenden sind

- **KI-generierte Grafiken** — Claude, ChatGPT und andere KI-Tools können SVG-Diagramme, Visualisierungen und Illustrationen direkt generieren. Fügen Sie das SVG in einen Code-Block ein, um es inline zu rendern.
- **Inline-SVG-Erstellung** — SVG-Quellcode direkt in Ihrem Dokument bearbeiten und Live-Ergebnisse sehen.
- **Eigenständige Dokumente** — Das SVG lebt innerhalb der Markdown-Datei ohne externe Dateiabhängigkeit.

## Bearbeitung im WYSIWYG-Modus

Im Rich-Text-Modus werden SVG-Code-Blöcke automatisch inline gerendert.

### Bearbeitungsmodus öffnen

Doppelklicken Sie auf ein gerendertes SVG, um den Quelleditor zu öffnen. Eine Bearbeitungskopfzeile erscheint mit:

| Schaltfläche | Aktion |
|--------------|--------|
| **Kopieren** | SVG-Quellcode in die Zwischenablage kopieren |
| **Abbrechen** (X) | Änderungen zurücksetzen und beenden (auch `Esc`) |
| **Speichern** (Häkchen) | Änderungen anwenden und beenden |

Eine **Live-Vorschau** unterhalb des Editors aktualisiert sich beim Tippen, sodass Sie Ihre Änderungen in Echtzeit sehen können.

### Schwenken und Zoomen

Fahren Sie über ein gerendertes SVG, um interaktive Steuerelemente zu enthüllen:

| Aktion | Wie |
|--------|-----|
| **Zoomen** | `Cmd` (macOS) oder `Strg` (Windows/Linux) gedrückt halten und scrollen |
| **Schwenken** | SVG klicken und ziehen |
| **Zurücksetzen** | Auf die Zurücksetzen-Schaltfläche klicken (obere rechte Ecke) |

Dies sind dieselben Schwenk-/Zoom-Steuerelemente, die für Mermaid-Diagramme verwendet werden.

### Als PNG exportieren

Fahren Sie über ein gerendertes SVG, um die **Export**-Schaltfläche zu enthüllen (oben rechts, neben der Zurücksetzen-Schaltfläche). Klicken Sie darauf, um ein Hintergrunddesign zu wählen:

| Design | Hintergrund |
|--------|-------------|
| **Hell** | Weiß (`#ffffff`) |
| **Dunkel** | Dunkel (`#1e1e1e`) |

Das SVG wird als PNG mit 2-facher Auflösung über den System-Speicherdialog exportiert.

## Quellmodus-Vorschau

Im Quellmodus erscheint ein schwebendes Vorschau-Panel, wenn sich Ihr Cursor innerhalb eines ` ```svg `-Code-Blocks befindet — dasselbe Panel, das für Mermaid-Diagramme verwendet wird.

| Funktion | Beschreibung |
|----------|--------------|
| **Live-Vorschau** | Aktualisiert sich sofort beim Tippen (kein Entprellen — SVG-Rendering ist instant) |
| **Ziehen zum Verschieben** | Kopfzeile ziehen zum Neu-Positionieren |
| **Größe ändern** | Beliebige Kante oder Ecke ziehen |
| **Zoom** | `−`- und `+`-Schaltflächen oder `Cmd/Strg` + Scrollen (10% bis 300%) |

::: info
Die Diagrammvorschau im Quellmodus muss aktiviert sein. Mit der **Diagrammvorschau**-Schaltfläche in der Statusleiste umschalten.
:::

## SVG-Validierung

VMark validiert SVG-Inhalt vor dem Rendering:

- Der Inhalt muss mit `<svg` oder `<?xml` beginnen
- Das XML muss wohlgeformt sein (keine Parse-Fehler)
- Das Stammelement muss `<svg>` sein

Wenn die Validierung fehlschlägt, wird statt der gerenderten Grafik eine **Ungültiges SVG**-Fehlermeldung angezeigt. Doppelklicken Sie auf den Fehler, um den Quellcode zu bearbeiten und zu korrigieren.

## KI-Arbeitsablauf

KI-Coding-Assistenten können SVG direkt in Ihre VMark-Dokumente über MCP-Tools generieren. Die KI sendet einen Code-Block mit `language: "svg"` und dem SVG-Inhalt, der automatisch inline gerendert wird.

**Beispiel-Prompt:**

> Erstelle ein Balkendiagramm mit vierteljährlichem Umsatz: Q1 2,1 Mio. €, Q2 2,8 Mio. €, Q3 3,2 Mio. €, Q4 3,9 Mio. €

Die KI generiert ein SVG-Balkendiagramm, das inline in Ihrem Dokument gerendert wird, mit sofort verfügbaren Schwenk-/Zoom- und PNG-Export-Funktionen.

## Vergleich: SVG-Code-Block vs. Mermaid

| Funktion | ` ```svg ` | ` ```mermaid ` |
|----------|-----------|----------------|
| Eingabe | Rohes SVG-Markup | Mermaid DSL |
| Rendering | Sofort (synchron) | Async (200ms Entprellung) |
| Schwenken + Zoomen | Ja | Ja |
| PNG-Export | Ja | Ja |
| Live-Vorschau | Ja | Ja |
| Design-Anpassung | Nein (verwendet eigene SVG-Farben) | Ja (passt sich allen Designs an) |
| Am besten für | Benutzerdefinierte Grafiken, KI-generierte Visualisierungen | Flussdiagramme, Sequenzdiagramme, strukturierte Diagramme |

## Tipps

### Sicherheit

VMark bereinigt SVG-Inhalt vor dem Rendering. Script-Tags und Event-Handler-Attribute (`onclick`, `onerror` usw.) werden entfernt. Dies schützt vor XSS beim Einfügen von SVG aus nicht vertrauenswürdigen Quellen.

### Größenanpassung

Wenn Ihr SVG keine expliziten `width`/`height`-Attribute enthält, fügen Sie ein `viewBox` hinzu, um das Seitenverhältnis zu steuern:

```xml
<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
  <!-- Inhalt -->
</svg>
```

### Exportqualität

Der PNG-Export verwendet 2-fache Auflösung für gestochen scharfe Anzeige auf Retina-Bildschirmen. Eine einfarbige Hintergrundfarbe wird automatisch hinzugefügt (das SVG selbst kann einen transparenten Hintergrund haben).
