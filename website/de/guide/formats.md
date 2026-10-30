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
| Daten — YAML | `.yaml`, `.yml` | immer aktiv | Quelle + Baum | navigierbarer Baum, schemagestützt (GitHub Actions, VMark-Workflows) |
| Daten — JSON | `.json`, `.jsonl` | erfordert **Datenformate**-Umschalter | Quelle + Baum | navigierbarer JSON-Baum, schemagestützt (`package.json`) |
| Daten — TOML | `.toml` | erfordert **Datenformate**-Umschalter | Quelle + Baum | navigierbarer Baum, schemagestützt (`Cargo.toml`, `pyproject.toml`) |
| Diagramme | `.mmd` | erfordert **Diagramme & SVG**-Umschalter | Quelle + Rendering | Live-Mermaid-Diagramm |
| Vektor | `.svg` | erfordert **Diagramme & SVG**-Umschalter | Quelle + Rendering | bereinigtes Inline-Rendering |
| Web | `.html`, `.htm` | erfordert **HTML-Vorschau**-Umschalter | Quelle + Rendering | sandboxed iframe (leeres `sandbox=""`, DOMPurify, CSP); der [vertrauenswürdige Modus](#vertrauenswurdige-html-vorschau-opt-in) wird pro Datei ausdrücklich aktiviert |
| Code (schreibgeschützt) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | erfordert **Code-Betrachter**-Umschalter | Betrachter (zum Bearbeiten umschalten) | — |
| Medien | Bilder (`.png`, `.jpg`, `.gif`, `.webp`, `.heic`, `.tiff`, …), Video (`.mp4`, `.webm`, `.mov`, …), Audio (`.mp3`, `.wav`, `.flac`, …) | immer aktiv | Betrachter (schreibgeschützt) | natives Bild / `<video>` / `<audio>` |

Code-Dateien sind standardmäßig schreibgeschützt und zeigen ein Banner mit den Optionen **Bearbeitung aktivieren** oder **In externem Editor öffnen**.

## Ansichtsmodi (Quelltext / Geteilt / Vorschau)

Jedes Format mit einer Vorschau — HTML, SVG, Mermaid, JSON, YAML, TOML — öffnet sich
mit einem kleinen Umschalter **Quelltext · Geteilt · Vorschau** in der oberen rechten Ecke:

- **Quelltext** — der bearbeitbare Quellbereich in voller Breite.
- **Geteilt** — Quelltext und Vorschau nebeneinander (Standard).
- **Vorschau** — das gerenderte Ergebnis in voller Breite. Die Vorschau ist eine
  **schreibgeschützte** Darstellung; zum Bearbeiten wechseln Sie zurück zu Quelltext
  oder Geteilt.

Sie können auch per Tastatur wechseln: **`F6`** schaltet zwischen Quelltext ⇄ Geteilt um,
**`Umschalt + F6`** zwischen Vorschau ⇄ Geteilt (Geteilt ist der Grundzustand). Die Wahl
wird pro Tab gespeichert. Den Standard für neu geöffnete Dateien legen Sie unter
**Einstellungen → Formate → Standard-Ansichtsmodus** fest.

Formate ohne Vorschau (Klartext, Code-Betrachter) zeigen immer nur den Quelltext,
daher erscheint dort kein Umschalter.

## Mediendateien (Bilder, Video, Audio)

Öffnen Sie ein Bild, ein Video oder eine Audiodatei, und VMark zeigt sie direkt an —
wie Quick Look im Finder. Es gibt zwei Wege zur Vorschau:

- **Öffnen** (im Datei-Explorer anklicken, **Datei → Datei öffnen…** verwenden oder
  hineinziehen), um die Datei in einem Tab anzuzeigen.
- **Quick Look**: Wählen Sie eine Datei im Explorer aus und drücken Sie die **Leertaste**
  für eine Vorschau-Überlagerung über das ganze Fenster. Drücken Sie **Leertaste** oder
  **Esc** oder klicken Sie auf den Hintergrund, um sie zu schließen.

So funktioniert es und das können Sie erwarten:

- **Nie als Text geladen.** Medien sind binär — VMark streamt die Datei über die native
  Asset-Pipeline direkt an den Betrachter. Sie wird nie als UTF-8 gelesen, nie als
  Dokument im Speicher gehalten und ist nie bearbeitbar oder speicherbar. Selbst
  mehrere Gigabyte große Videos öffnen sich sofort und lassen sich nativ spulen.
- **Änderungen auf der Festplatte werden übernommen.** Exportieren Sie das Bild aus
  Ihrem Programm erneut oder lassen Sie ein Skript es überschreiben, und der geöffnete
  Tab übernimmt die neue Version von selbst — ohne erneutes Öffnen, ohne Schließen und
  Wiederöffnen der Datei.
- **Breite Formatunterstützung.** VMark übergibt die Datei an die Medien-Engine der
  Plattform, sodass die Unterstützung davon abhängt, was die Webview Ihres Systems
  dekodieren kann. Auf macOS ist das umfangreich — HEIC, TIFF, `.mov`/H.264 und FLAC
  werden alle wiedergegeben. Formate, die die Webview nicht dekodieren kann (z. B.
  `.mkv`, `.avi`, `.wmv`), öffnen sich trotzdem und zeigen ein Ersatzfeld mit
  **Mit Standard-App öffnen** und **Im Finder anzeigen** (**Im Explorer anzeigen**
  unter Windows, **Im Dateimanager anzeigen** unter Linux).
- **Schreibgeschützt.** Medien-Tabs werden nie als geändert markiert und schließen
  ohne Speichern-Abfrage.

## Schemagestützte Vorschauen

Wenn Pfad oder Inhalt einem bekannten Schema entsprechen, ersetzt VMark die generische Baumansicht durch die passende Darstellung.

### GitHub Actions Workflow (`.github/workflows/*.yml`)

Öffnet mit der Workflow-Werkbank: dem interaktiven Job-DAG-Canvas und einem strukturierten Formular-Editor mit Speichern / Verwerfen (siehe den [Leitfaden zum Workflow-Viewer](/de/guide/workflow-viewer)). Auch der Quellbereich kennt Workflows — Vervollständigung für `${{ }}`-Ausdrücke, Hervorhebung des Jobs im Canvas passend zur Cursorposition und Cmd-Klick auf lokale `uses:`-Verweise.

- Pfad-Erkennung: Eine `.yml`- / `.yaml`-Datei unter `.github/workflows/` wird an den Workflow-Renderer weitergeleitet — auch bei fehlerhaftem YAML, sodass Sie die degradierte Ansicht mit Diagnose statt eines leeren Baums sehen. (Die Datei muss zuerst den YAML-Adapter erreichen; dafür ist die Erweiterung `.yml`/`.yaml` erforderlich.)
- Inhalts-Erkennung: Schlüssel `on:` und `jobs:` auf der obersten Ebene.

### VMark-Workflow (`steps:` auf oberster Ebene)

Öffnet mit dem Workflow-Ausführungsbereich: einer Symbolleiste mit **Ausführen** / **Abbrechen** und einer Statuszeile, dem Live-Schrittgraphen (oder dem Parse-Fehler) und **Dateien wiederherstellen** nach einem Lauf, der Dateien geschrieben hat. Siehe den [Leitfaden zu Workflows](/de/guide/workflows).

- Pfad-Erkennung: niemals unter `.github/workflows/` — dieser Ordner gehört GitHub.
- Inhalts-Erkennung: Das YAML lässt sich parsen, hat kein `jobs:` auf oberster Ebene und eine `steps:`-Liste auf oberster Ebene, in der das `uses:` mindestens eines Schritts mit `genie/`, `action/` oder `webhook/` beginnt. Fehlerhaftes YAML ist nie ein VMark-Workflow.
- Der Bereich benötigt **Einstellungen → Erweitert → Workflow-Engine**. Ist die Engine aus, zeigt die Datei den einfachen YAML-Baum (es sei denn, ein aus diesem Tab gestarteter Lauf ist noch aktiv, damit sein Abbrechen erreichbar bleibt).

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
- **Datenformate** (JSON, YAML, TOML) werden im Quellbereich mit Parse-Fehler-Markierungen im Seitenrand angezeigt; die Baumvorschau aktualisiert sich beim Tippen. Nur für Markdown relevante Menüaktionen sind deaktiviert (CJK-Formatierung, Block einfügen, Absatzformatierung); modusrelevante Steuerelemente bleiben aktiv. Das Kontextmenü (Rechtsklick) ist auf Zwischenablage-Aktionen reduziert (Ausschneiden/Kopieren/Einfügen/Alles auswählen).
- **Visuelle Formate** (Mermaid, SVG, HTML) werden im Quellbereich angezeigt, mit der gerenderten Ansicht im rechten Bereich. Die Vorschau wird mit niedrigerer Priorität als Ihre Eingabe gerendert, sodass sie bei einem großen Dokument einen Moment hinter dem Cursor nachzieht, statt bei jedem Tastendruck neu zu rendern.
- **Code-Formate** öffnen sich als syntaxhervorgehobene Betrachter; schalten Sie zum Bearbeiten an Ort und Stelle um oder öffnen Sie die Datei in Ihrem externen Editor (siehe unten).

## Markdown-Dialekt

VMark liest und schreibt Markdown mit remark (darunter micromark): CommonMark, dazu GitHub Flavored Markdown (Tabellen, Aufgabenlisten, Durchstreichen mit `~~`, Autolinks, Fußnoten), YAML-Front-Matter, Mathematik mit `$…$` / `$$…$$`, Wiki-Links (`[[target]]`), GitHub-Hinweise (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), `<details>`-Blöcke, `[TOC]` und vier Inline-Auszeichnungen: `==highlight==`, `~subscript~`, `^superscript^` und `++underline++`. Eine einzelne Tilde bedeutet Tiefstellung, nie Durchstreichen.

**Verschachtelungsgrenze.** WYSIWYG unterstützt Zitatblöcke und Listen mit bis zu 1000 Verschachtelungsebenen. Ein tiefer verschachteltes Dokument öffnet sich im **Quelltextmodus** mit einer Meldung, wie tief es ist, und die Statusleiste zeigt *„Im Quelltextmodus geöffnet (in WYSIWYG nicht darstellbar).“* Solange dieser Zustand besteht, ist die Datei davor geschützt, vom Rich-Editor überschrieben zu werden. Verringern Sie die Verschachtelung und verwenden Sie dann **Zu WYSIWYG wechseln**. Eingezäunter Code, thematische Umbrüche und Inline-Hervorhebungen zählen nicht zur Grenze. Siehe auch [Große Dateien](/de/guide/large-files).

## Wie VMark den Dateityp bestimmt

VMark behandelt **Markdown als Positivliste, nicht als Standard**. Die Regel, der Reihe nach:

1. **Eine Erweiterung aus der Markdown-Familie** (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`) öffnet sich im Rich-Markdown-Editor.
2. **Eine registrierte Nicht-Markdown-Erweiterung** (sofern ihre Kategorie aktiviert ist — JSON, YAML, Code-Betrachter usw.) öffnet sich im Quellbereich dieses Formats.
3. **Alles andere** — `.env`, `.env.local`, `Dockerfile`, `Makefile`, `.gitignore`, unbekannte Erweiterungen — öffnet sich im **Klartext-Quellbereich**, niemals im Markdown-Editor.

Eine Konfigurationsdatei wird also nie stillschweigend als Markdown gerendert. Eine `.env.local` öffnet sich als Klartext, mit ihren `KEY=value`-Zeilen, `#`-Kommentaren und Unterstrichen genau so, wie sie eingegeben wurden.

Punktdatei-Familien werden als Gruppe erkannt: Eine Überschreibung für `.env` gilt auch für `.env.local`, `.env.production` und so weiter.

### Dateien aus Ihrem System öffnen

Das Installationsprogramm registriert VMark bei Ihrem Betriebssystem als Editor für diese Dateitypen, sodass sie unter **Öffnen mit** erscheinen und per Doppelklick in VMark geöffnet werden können:

| Erweiterungen | Registriert als |
|---|---|
| `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | Markdown-Dokument |
| `.txt` | Klartextdokument |
| `.json`, `.jsonl` | JSON-Dokument |
| `.yaml`, `.yml` | YAML-Dokument |
| `.toml` | TOML-Dokument |
| `.mmd` | Mermaid-Diagramm |
| `.svg` | SVG-Bild |
| `.html`, `.htm` | HTML-Dokument |

Unter **Windows** übernimmt das Installationsprogramm keinen Dateityp, den bereits etwas anderes verarbeitet: Für jede Erweiterung, die schon ein Standardprogramm hat, fügt sich VMark zu **Öffnen mit** hinzu und lässt diesen Standard bestehen. Standard wird es nur dort, wo nichts registriert war — in der Praxis bei den Markdown-Erweiterungen, nicht bei `.txt`, `.html`, `.htm` oder `.svg`. Ein Standard, den Sie selbst in den Windows-Einstellungen wählen, hat immer Vorrang. Die Deinstallation stellt den Windows-Menüeintrag **Neu → Textdokument** und das vorherige Programm wieder her.

Eine registrierte Datei öffnet sich nur dann in VMark, wenn ihr Format aktiviert ist (siehe [Formate aktivieren](#formate-aktivieren)); andernfalls öffnet sie sich als Klartext.

Unter Windows und Linux öffnet sich ein auf der Befehlszeile übergebener Ordner (`vmark C:\notes` oder `vmark ~/notes`) als Arbeitsbereich in einem eigenen Fenster, so wie das Ablegen eines Ordners auf dem Dock-Symbol unter macOS. Das funktioniert auch, wenn VMark bereits läuft.

### Syntaxhervorhebung für Klartextdateien

Auch wenn eine Datei als Klartext geöffnet wird, färbt VMark sie ein, sobald es den Typ erkennt — `.env`/`.ini`/`.conf` (Properties), `.sh`/`.bash` (Shell), `Dockerfile`, `.toml`, `.sql`, `.diff` und die üblichen Sprachen. Das ist rein kosmetisch; es ändert nie, in welchem Editor die Datei geöffnet wurde, und es funktioniert unabhängig davon, ob die Kategorie Code-Betrachter aktiviert ist.

### Überschreiben: „Dateityp festlegen“ {#uberschreiben-dateityp-festlegen}

Die Erkennung ist der Standard, kein Käfig. Öffnen Sie die Befehlspalette und führen Sie aus:

- **Dateityp festlegen: Nur-Text** — erzwingt, dass die aktuelle Dateifamilie als Klartext geöffnet wird (z. B. damit eine `.txt`, die Sie als rohe Notizen führen, nicht gerendert wird).
- **Dateityp festlegen: Markdown** — rendert eine Nicht-`.md`-Datei mit dem Markdown-Editor (z. B. eine `.txt`, in der Sie tatsächlich Markdown schreiben).
- **Dateityp festlegen: Auf Standard zurücksetzen** — entfernt die Überschreibung.

Überschreibungen werden pro Dateifamilie gespeichert (nach Erweiterung oder, bei Dateien wie `.env`, nach dem Namen der Punktdatei) und bleiben über Sitzungen hinweg erhalten. Sie haben Vorrang vor den oben beschriebenen integrierten Regeln.

## Suchen, Speichern, Inhaltssuche

- **Datei → Datei öffnen…** bietet zwei Filter: **Alle unterstützten Formate** (jedes registrierte Format) und **Markdown**. Der Eintrag hat kein Standard-Tastenkürzel — `Mod + O` ist **Schnell öffnen** —, Sie können ihm aber unter **Einstellungen → Tastenkürzel** eines zuweisen. Speichern-unter-Filter und die Standard-Speichererweiterung werden vom Format-Adapter des aktiven Tabs abgeleitet, sodass beim Speichern einer `.toml`-Datei `.toml` als Erweiterung vorgeschlagen wird.
- **Drag & Drop** akzeptiert jede registrierte Erweiterung.
- **Speichern unter** Filter und die Standard-Erweiterung beim Speichern werden vom Format-Adapter des aktiven Tabs abgeleitet.
- **Cmd+Shift+H** Inhaltssuche („In Dateien suchen“) indiziert jedes textbasierte Format (Markdown, txt, json, yaml, toml, html, svg, Mermaid). Code-Dateien sind standardmäßig ausgeschlossen — sie befinden sich im Code-Betrachter-Modus.

## Sicherheitsmodell für HTML {#sicherheitsmodell-fur-html}

Gemäß ADR-4 im Mehrformat-Plan basiert die HTML-Vorschau auf drei unabhängigen Schutzschichten:

1. **`<iframe sandbox="">`** mit leerem Erlaubnissatz — keine Skripte, kein Same-Origin, keine Formulare, keine Popups. Das Sandboxing wird allein durch das iframe-Attribut erzwungen (CSP via `<meta>` ist laut MDN kein Sandbox-Mechanismus).
2. **DOMPurify-Bereinigung** läuft zuerst — entfernt `<script>`, `javascript:`-URLs, Inline-Ereignishandler und base-href-Tricks.
3. **CSP `<meta>`-Injektion** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — schränkt das Laden von Ressourcen innerhalb des iframes ein.

Der Validator zeigt Script-Tags, `javascript:`-URLs und Inline-Ereignishandler als Warnungen an, damit Sie sehen können, was blockiert wird. Sobald Sie [der Datei vertrauen](#vertrauenswurdige-html-vorschau-opt-in), werden sie stattdessen als Information angezeigt, damit nichts dem Vertrauens-Banner widerspricht. Zwei Meldungen nennen, was die Vorschau nie erlaubt, ob vertrauenswürdig oder nicht: Ein externes Skript (`<script src="…">`) wird nie geladen, da kein Skript aus einer Datei oder URL stammt, und ein `javascript:`-Link, der auf ein anderes Fenster oder die oberste Seite zielt (`target="_top"`, `_blank` oder ein `<base target>`), navigiert nie, da die Vorschau sich selbst nicht verlassen kann. Die Erkennung liest die Tags der Seite nur näherungsweise; sie kennzeichnet Befunde und entscheidet nie, was ausgeführt wird — das tut die Sandbox.

Die formale Sicherheitsfreigabe für diese Vorschau steht noch aus, und die Vorschau weist in einem Hinweis über der gerenderten Seite darauf hin: **Die HTML-Vorschau ist isoliert. Ihre Sicherheitsprüfung ist noch nicht abgeschlossen.** Die drei oben genannten Schichten sind vorhanden; der noch offene Schritt ist, sie in der Webview der laufenden App gegen die OWASP-XSS-Payloads zu bestätigen.

### Vertrauenswürdige HTML-Vorschau (Opt-in)

Die oben beschriebene sichere Vorschau ist der Standard und ändert sich nie. Für ein
Dokument, das Sie selbst geschrieben haben — ein interaktives Labor, ein lokales
Dashboard, eine eigenständige Demo —, können Sie die Skriptausführung für **genau diese
eine Datei und für diese Sitzung** erlauben.

Verwenden Sie **Vertrauenswürdige Vorschau aktivieren…** in der Leiste über der Vorschau.
Zuerst erhalten Sie eine Warnung; nichts wird ausgeführt, bevor Sie bestätigen. Solange
der Modus aktiv ist, bleibt die Leiste sichtbar und zeigt **Vertrauenswürdig — Skripte
aktiviert**, und **Vertrauen widerrufen** ist nur einen Klick entfernt.

Was der vertrauenswürdige Modus gewährt und was nicht:

| | Vertrauenswürdige Vorschau |
|---|---|
| JavaScript, DOM, Zeigerereignisse, `requestAnimationFrame`, Web Audio | ✅ läuft |
| Netzwerk (`fetch`, `XMLHttpRequest`, WebSocket, entfernte Bilder/Skripte) | ❌ blockiert durch `default-src 'none'` |
| VMarks eigene Seite, Tauri-Befehle, Ihr Dateisystem | ❌ unerreichbar — das Dokument läuft in einem eigenen opaken Origin |
| Navigation auf oberster Ebene, Popups, Formularübermittlung, Downloads, Modale | ❌ nicht gewährt (`sandbox="allow-scripts"` und sonst nichts) |
| Kamera, Mikrofon, Standort, Zwischenablage | ❌ keine Funktion wird an den Frame delegiert |
| `localStorage` / `sessionStorage` | ❌ nicht verfügbar — ein opaker Origin hat keinen Same-Origin-Speicher |
| `eval` / `new Function` | ❌ nicht erlaubt |

Drei Eigenschaften, die man kennen sollte:

- **Vertrauen wird nie abgeleitet.** Nicht aus der Erweiterung `.html`, nicht aus der
  Herkunft der Datei, nicht aus einer Nachbardatei, der Sie bereits vertraut haben. Nur
  die Bestätigung gewährt es.
- **Vertrauen wird nie gespeichert.** Wenn Sie VMark schließen, ist jede Freigabe weg.
  Für ein ungespeichertes Dokument ist es außerdem nicht verfügbar, da es keine
  Identität hat, an die eine Freigabe gebunden werden könnte — speichern Sie die Datei
  zuerst.
- **Eine vertrauenswürdige Vorschau startet sich nie selbst neu.** Wenn Sie den
  Quelltext bearbeiten, wird sie als *Stimmt möglicherweise nicht mit dem aktuellen
  Quelltext überein* markiert und wartet auf **Neu laden**, damit eine laufende
  Simulation nicht bei jedem Tastendruck zurückgesetzt wird. Dieselbe Markierung
  erscheint, wenn VMark nicht wissen kann, was der Frame gerade ausführt — nachdem Sie
  den Tab verlassen und wieder zurückkehren oder ihn schließen und wieder öffnen, führt
  die Vorschau weiter aus, was zuletzt für diese Datei veröffentlicht wurde, und sagt
  das, statt zu behaupten, sie sei aktuell. **Neu laden** veröffentlicht die Datei
  erneut in ihrem jetzigen Zustand.

::: info Windows liefert sie über einen lokalen http-Origin aus
WebView2 kennt keine benutzerdefinierten URL-Schemata, daher wird das vertrauenswürdige
Dokument unter Windows von `http://vmark-trusted.localhost` statt von `vmark-trusted://`
ausgeliefert — dieselbe Freigabe, dieselbe Sandbox und dieselbe CSP, unter der URL-Form,
die Tauri dort für jedes benutzerdefinierte Protokoll verwendet. Die sichere Vorschau
funktioniert auf jeder Plattform.
:::

Vertrauenswürdige Inhalte werden von einem `vmark-trusted://`-Origin
(`http://vmark-trusted.localhost` unter Windows) mit einer eigenen restriktiven CSP
ausgeliefert. Dieser Umweg ist notwendig, nicht dekorativ: Ein `srcdoc`-, `blob:`- oder
`data:`-Frame erbt VMarks eigene Richtlinie `script-src 'self'`, und eine CSP innerhalb
des Frames kann eine geerbte Richtlinie nur verschärfen, nie lockern — daher kann kein
iframe-Attribut allein ein Inline-Skript zum Laufen bringen.

## In externem Editor öffnen

Für Code-Dateien startet die Schaltfläche **In externem Editor öffnen** im schreibgeschützten Banner Ihren bevorzugten Editor. Auflösungsreihenfolge:

1. **Einstellungen → Formate → Externer Editor** (das GUI-Feld — siehe [Einstellungen](/de/guide/settings#formate)). Geben Sie entweder den **Namen eines bekannten Editors** (`code`, `cursor`, `zed`, `subl`, `bbedit`, `idea`, `vim`, `nvim`, `emacs`, `notepad++`, …) oder den **vollständigen Pfad** eines Editors ein — ein `.app`-Bundle auf macOS, eine ausführbare Datei auf Linux/Windows. Das Feld enthält genau ein Programm, nie Argumente; um Argumente zu übergeben, verwenden Sie `$VMARK_EXTERNAL_EDITOR`.
2. `$VMARK_EXTERNAL_EDITOR` (projektweite Umgebungsvariable als Überschreibung)
3. `$VISUAL`
4. `$EDITOR`
5. Plattformstandard (`open -t` auf macOS, `notepad.exe` auf Windows, `xdg-open` auf Linux)

Die GUI-Einstellung hat Vorrang vor Umgebungsvariablen — explizit schlägt implizit. Lassen Sie das Feld leer, um die Fallback-Kette der Umgebungsvariablen zu nutzen.

VMark leitet über einen Login-Shell-PATH weiter, sodass VS Code / Cursor / JetBrains-Wrapper korrekt aufgelöst werden, wenn sie von einer macOS-GUI-App aus gestartet werden.

### Sicherheitsüberprüfung

Die Einstellung **Externer Editor** selbst wird geprüft, bevor irgendetwas gestartet wird. VMark lehnt ab:

- Shell-Zeichen (`;`, `|`, `&`, `` ` ``, `$`, `<`, `>`, Anführungszeichen, Zeilenumbrüche) und ein führendes `-`
- einen bloßen Namen, der kein VMark bekannter Editor ist — *„X“ ist kein Editor, den VMark dem Namen nach kennt – geben Sie stattdessen den vollständigen Pfad zum Editor an*
- einen relativen Pfad, einen Pfad mit einem `..`-Segment oder einem abschließenden Schrägstrich oder einen Pfad, der nicht existiert
- ein Programm, das die übergebenen Dateien ausführt, statt sie zu öffnen — eine Shell (`sh`, `bash`, `zsh`, `pwsh`, `cmd`, …), einen Interpreter (`python`, `node`, `ruby`, `perl`, `osascript`, …), einen Starter (`env`, `sudo`, `open`, `xdg-open`, …) oder einen Terminal-Emulator — geprüft sowohl unter dem eingegebenen Namen als auch unter dem Namen, auf den ein Link verweist

Die Umgebungsvariablen der Fallback-Kette sind nicht eingeschränkt: Sie werden außerhalb von VMark gesetzt, von Ihnen.

Der Tauri-Befehl `open_in_external_editor` lehnt außerdem ab:

- nicht existierende Pfade
- Verzeichnisse und andere Nicht-Regulär-Dateien (Sockets, Geräte)
- Pfade, deren kanonisierte Erweiterung nicht in VMark's registriertem Formatsatz enthalten ist
- Symlinks, deren kanonisches Ziel eine der obigen Prüfungen nicht besteht

Ein kompromittiertes Webview kann die Schaltfläche nicht verwenden, um den externen Editor für beliebige Systemdateien (Passwörter, Schlüssel usw.) zu starten — nur für Pfade, die VMark selbst öffnen würde.

## Was nicht unterstützt wird

Gemäß den Nicht-Zielen des Plans:

- **Kein Code-Editor.** Kein LSP, keine Autovervollständigung, kein Refactoring, kein Debugger, keine Git-Gutter.
- **Nicht „jedes Klartextformat“.** Begrenzter Umfang — siehe die Tabelle oben.
- **Standardmäßig keine HTML-Skriptausführung.** Nur sandboxed Rendering, es sei denn,
  Sie erlauben ausdrücklich eine einzelne Datei über die [vertrauenswürdige HTML-Vorschau](#vertrauenswurdige-html-vorschau-opt-in).
- **Kein Drucken / Export / Kopieren als HTML für Nicht-Markdown-Formate** in v1.
- **Noch nicht als Code-Betrachter unterstützt**: Zig, Swift, Kotlin, Java, Elixir, OCaml und andere Sprachen außerhalb des 12-Erweiterungen-Sets. Die Entscheidungsregel lautet „Sprachen, die wir selbst verwenden“ — öffnen Sie ein Issue, wenn Sie eine hinzufügen möchten.

Wenn ein gewünschtes Format nicht aufgeführt ist und nicht bewusst ausgeschlossen wurde, öffnen Sie ein Issue.
