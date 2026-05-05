# Erste Schritte mit VMark

VMark ist ein lokal-erster Markdown-Editor mit zwei Bearbeitungsmodi, umfangreichen Formatierungswerkzeugen und hervorragender CJK-Unterstützung (Chinesisch/Japanisch/Koreanisch).

## Schnellstart

1. **VMark herunterladen und installieren** von der [Download-Seite](/de/download)
2. **Die App starten** und sofort mit dem Schreiben beginnen
3. **Eine Datei öffnen** mit `Cmd/Strg + O` oder eine `.md`-Datei per Drag & Drop
4. **Einen Ordner öffnen** mit `Cmd/Strg + Umschalt + O` für den Arbeitsbereichsmodus

## Überblick über die Benutzeroberfläche

### Hauptbereiche

- **Editor**: Der Hauptbereich zum Verfassen Ihrer Dokumente
- **Seitenleiste**: Dateibaum-Navigation (umschalten mit `Strg + Umschalt + 2`)
- **Gliederung**: Dokumentstrukturansicht (umschalten mit `Strg + Umschalt + 1`)
- **Statusleiste**: Wortanzahl, Zeichenanzahl und Autospeicher-Status (umschalten mit `F7`)
- **Terminal**: Integriertes Shell-Panel (umschalten mit `` Strg + ` ``)

### Menüleiste

- **Datei**: Neue Dateien, öffnen, speichern, exportieren
- **Bearbeiten**: Rückgängig/Wiederholen, Zwischenablage, Suchen/Ersetzen, Dokumentverlauf
- **Block**: Überschriften, Listen, Zitate, Zeilenoperationen
- **Format**: Textstile, Links, Texttransformationen
- **Ansicht**: Editorenmodi, Seitenleiste, Fokus-/Schreibmaschinenmodi
- **Werkzeuge**: Textbereinigung, CJK-Formatierung, Bildverwaltung

### Bearbeitungsmodi

VMark unterstützt zwei Bearbeitungsmodi, zwischen denen Sie wechseln können:

| Modus | Beschreibung | Tastenkürzel |
|-------|-------------|--------------|
| Rich-Text | WYSIWYG-Bearbeitung mit Live-Formatierung | Standard |
| Quelle | Rohes Markdown mit Syntaxhervorhebung | `F6` |

### Ansichtsmodi

Verbessern Sie Ihren Schreibfokus mit diesen Ansichtsmodi:

| Modus | Beschreibung | Tastenkürzel |
|-------|-------------|--------------|
| Fokus | Aktuellen Absatz hervorheben | `F8` |
| Schreibmaschine | Cursor zentriert halten | `F9` |
| Zeilenumbruch | Zeilenumbruch ein-/ausschalten | `Alt + Z` |

## Grundlegende Formatierung

### Textstile

| Stil | Syntax | Tastenkürzel |
|------|--------|--------------|
| **Fett** | `**Text**` | `Cmd/Strg + B` |
| *Kursiv* | `*Text*` | `Cmd/Strg + I` |
| ~~Durchgestrichen~~ | `~~Text~~` | `Cmd/Strg + Umschalt + X` |
| `Code` | `` `code` `` | `Cmd/Strg + Umschalt + `` ` `` |

### Blockelemente

- **Überschriften**: `#`-Symbole verwenden oder `Cmd/Strg + 1-6`
- **Listen**: Zeilen mit `-`, `*`, `1.` oder `- [ ]` für Aufgabenlisten beginnen
- **Zitate**: Mit `>` beginnen oder `Alt/Option + Cmd + Q` verwenden
- **Codeblöcke**: Dreifache Backticks mit optionaler Sprache verwenden
- **Tabellen**: Über das Format-Menü oder `Cmd/Strg + Umschalt + T`

## Mit Dateien arbeiten

### Erstellen und Öffnen

- **Neue Datei**: `Cmd/Strg + N`
- **Datei öffnen**: `Cmd/Strg + O`
- **Ordner öffnen**: `Cmd/Strg + Umschalt + O` (Arbeitsbereichsmodus)

### Speichern

- **Speichern**: `Cmd/Strg + S`
- **Speichern unter**: `Cmd/Strg + Umschalt + S`
- **Autospeichern**: Standardmäßig aktiviert, in den Einstellungen konfigurierbar

### Exportieren

- **HTML exportieren**: Verwenden Sie **Datei → HTML exportieren** — enthält interaktiven VMark Reader
- **PDF exportieren**: Drucken (`Cmd/Strg + P`) und als PDF speichern
- **Als HTML kopieren**: `Cmd/Strg + Umschalt + C`

Exportiertes HTML enthält den VMark Reader mit Inhaltsverzeichnis, Einstellungsbereich und mehr. [Mehr erfahren →](/de/guide/export)

## Einstellungen

Öffnen Sie die Einstellungen mit `Cmd/Strg + ,`, um Folgendes anzupassen:

- **Erscheinungsbild**: Design, Schriftarten, Schriftgröße, Zeilenhöhe
- **Editor**: Autospeicher-Intervall, Standardverhalten
- **Dateien & Bilder**: Asset-Verwaltung, Dokumentwerkzeuge
- **Integrationen**: KI-Anbieter, MCP-Server
- **Sprache**: CJK-Formatierungsregeln
- **Markdown**: Exportoptionen, Formatierungseinstellungen
- **Tastaturkürzel**: Tastaturkürzel anpassen
- **Terminal**: Terminalschriftgröße und Zeilenhöhe

## KI-Schreibassistenz

VMark enthält integrierte KI-Genies — wählen Sie Text aus und drücken Sie `Mod + Y`, um mit KI zu verfeinern, zu erweitern, zu übersetzen oder Ihren Text zu transformieren. Konfigurieren Sie Ihren bevorzugten Anbieter unter **Einstellungen > Integrationen**.

[Mehr über KI-Genies →](/de/guide/ai-genies) | [Anbieter konfigurieren →](/de/guide/ai-providers)

## Tipps für den Einstieg

1. **Mit der Gliederung navigieren**: Klicken Sie auf Gliederungselemente, um zu Abschnitten zu springen
2. **Fokusmodus ausprobieren**: `F8` hebt nur den aktuellen Absatz hervor
3. **Während des Schreibens validieren**: `Cmd + Shift + L` führt die Markdown-Lint-Engine und die Prüfung auf defekte Links aus
4. **Tastaturkürzel lernen**: Die vollständige Referenz finden Sie im [Tastaturkürzel-Leitfaden](/de/guide/shortcuts)

## Nächste Schritte

- Lernen Sie alle [Funktionen](/de/guide/features) kennen
- Meistern Sie [Tastaturkürzel](/de/guide/shortcuts)
- Erkunden Sie [CJK-Formatierung](/de/guide/cjk-formatting) Werkzeuge
