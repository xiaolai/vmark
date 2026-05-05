# Markmap-Mindmaps

VMark unterstützt [Markmap](https://markmap.js.org/) für die Erstellung interaktiver Mindmap-Bäume direkt in Ihren Markdown-Dokumenten. Im Gegensatz zu Mermaids statischem Mindmap-Diagrammtyp verwendet Markmap gewöhnliche Markdown-Überschriften als Eingabe und bietet interaktives Schwenken/Zoomen/Einklappen.

## Eine Mindmap einfügen

### Über das Menü

**Menü:** Einfügen > Mindmap

**Tastaturkürzel:** `Alt + Umschalt + Cmd + K` (macOS) / `Alt + Umschalt + Strg + K` (Windows/Linux)

### Über einen Code-Block

Geben Sie einen umzäunten Code-Block mit der `markmap`-Sprachkennung ein:

````markdown
```markmap
# Mindmap

## Zweig A
### Thema 1
### Thema 2

## Zweig B
### Thema 3
### Thema 4
```text
````

### Über das MCP-Tool

Das `media`-MCP-Tool mit `action: "markmap"` und dem `code`-Parameter mit Markdown-Überschriften verwenden.

## Bearbeitungsmodi

### Rich-Text-Modus (WYSIWYG)

Im WYSIWYG-Modus werden Markmap-Mindmaps als interaktive SVG-Bäume gerendert. Sie können:

- **Schwenken** durch Scrollen oder Klicken und Ziehen
- **Zoomen** durch Gedrückthalten von `Cmd`/`Strg` und Scrollen
- **Knoten ein-/ausklappen** durch Klicken auf den Kreis an jedem Zweig
- **Ansicht anpassen** mit der Anpassen-Schaltfläche (oben rechts beim Hovern)
- **Doppelklicken** auf die Mindmap zum Bearbeiten des Quellcodes

### Quellmodus mit Live-Vorschau

Im Quellmodus erscheint ein schwebendes Vorschau-Panel, wenn sich Ihr Cursor innerhalb eines Markmap-Code-Blocks befindet, das sich beim Tippen aktualisiert.

## Eingabeformat

Markmap verwendet Standard-Markdown als Eingabe. Überschriften definieren die Baumhierarchie:

| Markdown | Rolle |
|----------|-------|
| `# Überschrift 1` | Wurzelknoten |
| `## Überschrift 2` | Erster Zweig |
| `### Überschrift 3` | Zweiter Zweig |
| `#### Überschrift 4+` | Tiefere Zweige |

### Reichhaltige Inhalte in Knoten

Knoten können Inline-Markdown enthalten:

````markdown
```markmap
# Projektplan

## Forschung
### **Wichtige** Artikel lesen
### [Bestehende Tools](https://example.com) überprüfen

## Implementierung
### `Kern`-Modul schreiben
### Tests hinzufügen
- Unit-Tests
- Integrationstests

## Dokumentation
### API-Referenz
### Benutzerhandbuch
```text
````

Listenelemente unter einer Überschrift werden zu Kindknoten dieser Überschrift.

### Live-Demo

Hier ist eine interaktive Markmap, die direkt auf dieser Seite gerendert wird — probieren Sie Schwenken, Zoomen und das Auf-/Zuklappen von Knoten aus:

```markmap
# VMark Features

## Editor
### WYSIWYG Mode
### Source Mode
### Focus Mode
### Typewriter Mode

## AI Integration
### MCP Server
### AI Genies
### Smart Paste

## Markdown
### Mermaid Diagrams
### Markmap Mindmaps
### LaTeX Math
### Code Blocks
- Syntax highlighting
- Line numbers

## Platform
### macOS
### Windows
### Linux
```

## Interaktive Funktionen

| Aktion | Wie |
|--------|-----|
| **Schwenken** | Scrollen oder klicken und ziehen |
| **Zoomen** | `Cmd`/`Strg` + Scrollen |
| **Knoten einklappen** | Auf den Kreis an einem Zweigpunkt klicken |
| **Knoten ausklappen** | Erneut auf den Kreis klicken |
| **An Ansicht anpassen** | Auf die Anpassen-Schaltfläche klicken (oben rechts beim Hovern) |

## Design-Integration

Markmap-Mindmaps passen sich automatisch an das aktuelle VMark-Design an (White, Paper, Mint, Sepia oder Night). Branchfarben werden für die Lesbarkeit in jedem Design angepasst.

## Als PNG exportieren

Fahren Sie über eine gerenderte Mindmap im WYSIWYG-Modus, um eine **Export**-Schaltfläche zu enthüllen. Klicken Sie darauf, um ein Design zu wählen:

| Design | Hintergrund |
|--------|-------------|
| **Hell** | Weißer Hintergrund |
| **Dunkel** | Dunkler Hintergrund |

Die Mindmap wird als PNG mit 2-facher Auflösung über den System-Speicherdialog exportiert.

## Tipps

### Markmap vs. Mermaid Mindmap

VMark unterstützt sowohl Markmap als auch Mermaids `mindmap`-Diagrammtyp:

| Funktion | Markmap | Mermaid Mindmap |
|----------|---------|-----------------|
| Eingabeformat | Standard-Markdown | Mermaid DSL |
| Interaktivität | Schwenken, Zoomen, Einklappen | Statisches Bild |
| Reichhaltige Inhalte | Links, Fett, Code, Listen | Nur Text |
| Am besten für | Große, interaktive Bäume | Einfache statische Diagramme |

Verwenden Sie **Markmap**, wenn Sie Interaktivität wünschen oder bereits Markdown-Inhalte haben. Verwenden Sie **Mermaid Mindmap**, wenn Sie es neben anderen Mermaid-Diagrammen benötigen.

### Mehr erfahren

- **[Markmap-Dokumentation](https://markmap.js.org/)** — Offizielle Referenz
- **[Markmap Playground](https://markmap.js.org/repl)** — Interaktive Spielwiese zum Testen von Mindmaps
