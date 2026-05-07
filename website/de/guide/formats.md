# Unterstützte Formate

VMark öffnet jedes der unten aufgeführten Dateiformate direkt. Das Besondere sind **schemagestützte Vorschauen**: Wenn eine Datei ein bekanntes Artefakt ist, rendert VMark die *richtige* Ansicht — keinen generischen JSON-Baum.

[[toc]]

## Formate aktivieren

Markdown, Klartext und YAML/YML öffnen sich immer in ihren vollständigen Editoren — das sind die ruhigen Standardwerte. Alle anderen Formate sind **standardmäßig deaktiviert** und werden durch einen Kategorie-Umschalter unter **Einstellungen → Formate** freigeschaltet:

| Umschalter | Aktiviert |
|---|---|
| **Datenformate** | `.json`, `.jsonl`, `.toml` (geteilter Bereich: Quelle + Baum, mit Schema-Renderern für Cargo / package.json / pyproject) |
| **Diagramme & SVG** | `.mmd`, `.svg` (geteilter Bereich: Quelle + bereinigtes Live-Rendering) |
| **HTML-Vorschau** | `.html`, `.htm` (sandboxed iframe — siehe [Sicherheitsmodell für HTML](#sicherheitsmodell-fur-html)) |
| **Code-Betrachter** | 12 schreibgeschützte Code-Betrachter (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`) |

Wenn eine Kategorie deaktiviert ist, fallen die zugehörigen Erweiterungen auf den Klartext-Fallback zurück, sodass die Datei trotzdem geöffnet wird — nur ohne Vorschau oder Schemaansicht. Schalten Sie einen Umschalter um, und die Registry wird sofort neu aufgebaut; geöffnete Tabs werden mit dem passenden Adapter neu gemountet.

Beim ersten Start nach dem Upgrade auf die Mehrformat-Unterstützung zeigt VMark einmalig einen Toast, der Sie auf **Einstellungen → Formate** hinweist. Wenn Sie ihn verworfen haben oder VMark frisch installiert haben, finden Sie den Bereich jederzeit unter **Einstellungen → Formate**.

## Auf einen Blick

| Familie | Erweiterungen | Standard | Editor | Vorschau |
|---|---|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | immer aktiv | WYSIWYG + Quellmodus | gerenderter Text |
| Klartext | `.txt` | immer aktiv | Quelle | — |
| Daten — YAML | `.yaml`, `.yml` | immer aktiv | Quelle + Baum | navigierbarer Baum, schemagestützt (GitHub Actions) |
| Daten — JSON | `.json`, `.jsonl` | erfordert **Datenformate**-Umschalter | Quelle + Baum | navigierbarer JSON-Baum, schemagestützt (`package.json`) |
| Daten — TOML | `.toml` | erfordert **Datenformate**-Umschalter | Quelle + Baum | navigierbarer Baum, schemagestützt (`Cargo.toml`, `pyproject.toml`) |
| Diagramme | `.mmd` | erfordert **Diagramme & SVG**-Umschalter | Quelle + Rendering | Live-Mermaid-Diagramm |
| Vektor | `.svg` | erfordert **Diagramme & SVG**-Umschalter | Quelle + Rendering | bereinigtes Inline-Rendering |
| Web | `.html`, `.htm` | erfordert **HTML-Vorschau**-Umschalter | Quelle + Rendering | sandboxed iframe (leeres `sandbox=""`, DOMPurify, CSP) |
| Code (schreibgeschützt) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | erfordert **Code-Betrachter**-Umschalter | Betrachter (zum Bearbeiten umschalten) | — |

Code-Dateien sind standardmäßig schreibgeschützt und zeigen ein Banner mit den Optionen **Bearbeitung aktivieren** oder **In externem Editor öffnen**.

## Schemagestützte Vorschauen

Wenn Pfad oder Inhalt einem bekannten Schema entsprechen, ersetzt VMark die generische Baumansicht durch die passende Darstellung.

### GitHub Actions Workflow (`.github/workflows/*.yml`)

Öffnet mit der Workflow-Visualisierung (Job-DAG, Trigger, Berechtigungen).

- Pfad-Erkennung: Eine `.yml`- / `.yaml`-Datei unter `.github/workflows/` wird an den Workflow-Renderer weitergeleitet — auch bei fehlerhaftem YAML, sodass Sie die degradierte Ansicht mit Diagnose statt eines leeren Baums sehen. (Die Datei muss zuerst den YAML-Adapter erreichen; dafür ist die Erweiterung `.yml`/`.yaml` erforderlich.)
- Inhalts-Erkennung: Schlüssel `on:` und `jobs:` auf der obersten Ebene.

### `Cargo.toml`

Öffnet mit einem Rust-Abhängigkeitsbaum — Laufzeit-, Entwicklungs- und Build-Abhängigkeiten mit Versionsspezifikationen und Feature-Flags.

- Pfad-Erkennung: Dateiname `Cargo.toml` (Groß-/Kleinschreibung ignoriert) auf POSIX- oder Windows-Pfaden.
- Inhalts-Erkennung: `[package]`- oder `[workspace]`-Header.
- Keine Netzwerkanfragen — VMark löst crates.io niemals auf.

### `package.json`

Öffnet mit einem npm-Abhängigkeitsbaum — `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`.

- Pfad-Erkennung: Dateiname `package.json`.
- Inhalts-Erkennung: Schlüssel `name` auf der obersten Ebene sowie mindestens einer aus `dependencies` / `devDependencies` / `peerDependencies`.

### `pyproject.toml`

Öffnet mit einem Python-Abhängigkeitsbaum — sowohl PEP 621 (`[project]` + `[project.optional-dependencies]`) als auch Poetry (`[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]`, `[tool.poetry.group.<name>.dependencies]`).

- Pfad-Erkennung: Dateiname `pyproject.toml`.
- Inhalts-Erkennung: `[project]`- oder `[tool.poetry]`-Header (abhängig von einem erfolgreichen TOML-Parse).

## Bearbeitungsregeln

- **Markdown** enthält die vollständige Symbolleiste, Absatzformatierung, CJK-Regeln, Mathematik, Mermaid, Fußnoten — alle vorhandenen Markdown-Funktionen.
- **Datenformate** (JSON, YAML, TOML) werden im Quellbereich mit Parse-Fehler-Markierungen im Seitenrand angezeigt; die Baumvorschau aktualisiert sich beim Tippen. Nur für Markdown relevante Menüaktionen sind deaktiviert (CJK-Formatierung, Block einfügen, Absatzformatierung); modusrelevante Steuerelemente bleiben aktiv.
- **Visuelle Formate** (Mermaid, SVG, HTML) werden im Quellbereich angezeigt, mit der gerenderten Ansicht im rechten Bereich (mit Entprellung).
- **Code-Formate** öffnen sich als syntaxhervorgehobene Betrachter; schalten Sie zum Bearbeiten an Ort und Stelle um oder öffnen Sie die Datei in Ihrem externen Editor (siehe unten).

## Suchen, Speichern, Inhaltssuche

- **Cmd+O** Filter: ein einzelner Eintrag „Alle unterstützten Formate", der jedes registrierte Format umfasst. Speichern-unter-Filter und die Standard-Speichererweiterung werden vom Format-Adapter des aktiven Tabs abgeleitet, sodass beim Speichern einer `.toml`-Datei `.toml` als Erweiterung vorgeschlagen wird.
- **Drag & Drop** akzeptiert jede registrierte Erweiterung.
- **Speichern unter** Filter und die Standard-Erweiterung beim Speichern werden vom Format-Adapter des aktiven Tabs abgeleitet.
- **Cmd+Shift+H** Inhaltssuche („In Dateien suchen") indiziert jedes textbasierte Format (Markdown, txt, json, yaml, toml, html, svg, Mermaid). Code-Dateien sind standardmäßig ausgeschlossen — sie befinden sich im Code-Betrachter-Modus.

## Sicherheitsmodell für HTML {#sicherheitsmodell-fur-html}

Gemäß ADR-4 im Mehrformat-Plan basiert die HTML-Vorschau auf drei unabhängigen Schutzschichten:

1. **`<iframe sandbox="">`** mit leerem Erlaubnissatz — keine Skripte, kein Same-Origin, keine Formulare, keine Popups. Das Sandboxing wird allein durch das iframe-Attribut erzwungen (CSP via `<meta>` ist laut MDN kein Sandbox-Mechanismus).
2. **DOMPurify-Bereinigung** läuft zuerst — entfernt `<script>`, `javascript:`-URLs, Inline-Ereignishandler und base-href-Tricks.
3. **CSP `<meta>`-Injektion** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — schränkt das Laden von Ressourcen innerhalb des iframes ein.

Der Validator zeigt Script-Tags, `javascript:`-URLs und Inline-Ereignishandler als Warnungen an, damit Sie sehen können, was blockiert wird.

## In externem Editor öffnen

Für Code-Dateien startet die Schaltfläche **In externem Editor öffnen** im schreibgeschützten Banner Ihren bevorzugten Editor. Auflösungsreihenfolge:

1. **Einstellungen → Formate → Externer Editor** (das GUI-Feld — siehe [Einstellungen](/de/guide/settings#formate)). Wählen Sie ein `.app`-Bundle auf macOS, eine ausführbare Datei auf Linux/Windows oder alles, was Ihre Shell auflösen würde.
2. `$VMARK_EXTERNAL_EDITOR` (projektweite Umgebungsvariable als Überschreibung)
3. `$VISUAL`
4. `$EDITOR`
5. Plattformstandard (`open -t` auf macOS, `notepad.exe` auf Windows, `xdg-open` auf Linux)

Die GUI-Einstellung hat Vorrang vor Umgebungsvariablen — explizit schlägt implizit. Lassen Sie das Feld leer, um die Fallback-Kette der Umgebungsvariablen zu nutzen.

VMark leitet über einen Login-Shell-PATH weiter, sodass VS Code / Cursor / JetBrains-Wrapper korrekt aufgelöst werden, wenn sie von einer macOS-GUI-App aus gestartet werden.

### Sicherheitsüberprüfung

Der Tauri-Befehl `open_in_external_editor` lehnt ab:

- nicht existierende Pfade
- Verzeichnisse und andere Nicht-Regulär-Dateien (Sockets, Geräte)
- Pfade, deren kanonisierte Erweiterung nicht in VMark's registriertem Formatsatz enthalten ist
- Symlinks, deren kanonisches Ziel eine der obigen Prüfungen nicht besteht

Ein kompromittiertes Webview kann die Schaltfläche nicht verwenden, um den externen Editor für beliebige Systemdateien (Passwörter, Schlüssel usw.) zu starten — nur für Pfade, die VMark selbst öffnen würde.

## Was nicht unterstützt wird

Gemäß den Nicht-Zielen des Plans:

- **Kein Code-Editor.** Kein LSP, keine Autovervollständigung, kein Refactoring, kein Debugger, keine Git-Gutter.
- **Nicht „jedes Klartextformat".** Begrenzter Umfang — siehe die Tabelle oben.
- **Keine HTML-Skriptausführung.** Nur sandboxed Rendering.
- **Kein Drucken / Export / Kopieren als HTML für Nicht-Markdown-Formate** in v1.
- **Noch nicht als Code-Betrachter unterstützt**: Zig, Swift, Kotlin, Java, Elixir, OCaml und andere Sprachen außerhalb des 12-Erweiterungen-Sets. Die Entscheidungsregel lautet „Sprachen, die wir selbst verwenden" — öffnen Sie ein Issue, wenn Sie eine hinzufügen möchten.

Wenn ein gewünschtes Format nicht aufgeführt ist und nicht bewusst ausgeschlossen wurde, öffnen Sie ein Issue.
