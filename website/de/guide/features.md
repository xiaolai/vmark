# Funktionen

VMark ist ein funktionsreicher Markdown-Editor für moderne Schreib-Workflows. Hier ist, was enthalten ist.

[[toc]]

## Editorenmodi

### Rich-Text-Modus (WYSIWYG)

Der Standard-Bearbeitungsmodus bietet ein echtes „Was Sie sehen, ist was Sie bekommen"-Erlebnis:

- Live-Formatierungsvorschau beim Tippen
- Inline-Syntaxanzeige beim Cursor-Hover
- Intuitive Symbolleiste und Kontextmenüs
- Nahtlose Markdown-Syntaxeingabe

### Quellmodus

Wechseln Sie zur rohen Markdown-Bearbeitung mit vollständiger Syntaxhervorhebung:

- Von CodeMirror 6 betriebener Editor
- Vollständige Syntaxhervorhebung
- Interaktive Popups für Mathematik, Links, Bilder, Wiki-Links und Medien — dieselbe Bearbeitungserfahrung wie im WYSIWYG-Modus
- Intelligentes Einfügen — HTML von Webseiten und Word-Dokumenten wird automatisch in sauberes Markdown umgewandelt
- Bild-Einfügen aus der Zwischenablage — Screenshots und kopierte Bilder werden im Asset-Ordner gespeichert und als `![](pfad)` eingefügt
- Codeblock-bewusster Mehrcursor mit CJK-Wortgrenzenunterstützung
- Perfekt für fortgeschrittene Benutzer

Wechseln Sie mit `F6` zwischen den Modi.

### Quellvorschau

Bearbeiten Sie das rohe Markdown eines einzelnen Blocks, ohne den WYSIWYG-Modus zu verlassen. Drücken Sie `F5`, um die Quellvorschau für den Block an der Cursorposition zu öffnen.

**Layout:**
- Kopfleiste mit Blocktyp-Bezeichnung und Aktionsschaltflächen
- CodeMirror-Editor mit der Markdown-Quelle des Blocks
- Originalblock als abgedunkelter Vorschau (wenn Live-Vorschau EIN ist)

**Steuerelemente:**
| Aktion | Tastenkürzel |
|--------|--------------|
| Änderungen speichern | `Cmd/Strg + Eingabe` |
| Abbrechen (zurücksetzen) | `Escape` |
| Live-Vorschau umschalten | Augensymbol klicken |

**Live-Vorschau:**
- **AUS (Standard):** Frei bearbeiten, Änderungen werden erst beim Speichern angewendet
- **EIN:** Änderungen werden sofort beim Tippen angewendet, Vorschau wird unten angezeigt

**Ausgeschlossene Blöcke:**
Einige Blöcke haben eigene Bearbeitungsmechanismen und überspringen die Quellvorschau:
- Codeblöcke (einschließlich Mermaid, LaTeX) — Doppelklick zum Bearbeiten
- Block-Bilder — Bild-Popup verwenden
- Frontmatter, HTML-Blöcke, horizontale Linien

Die Quellvorschau ist nützlich für präzise Markdown-Bearbeitung (Tabellensyntax korrigieren, Listeneinzug anpassen), während man im visuellen Editor bleibt.

## Mehrcursor-Bearbeitung

Bearbeiten Sie mehrere Positionen gleichzeitig — VMark unterstützt vollständige Mehrcursor-Bearbeitung in WYSIWYG- und Quellmodus.

| Aktion | Tastenkürzel |
|--------|--------------|
| Cursor bei nächster Übereinstimmung hinzufügen | `Mod + D` |
| Übereinstimmung überspringen, zur nächsten springen | `Mod + Umschalt + D` |
| Alle Vorkommen auswählen | `Mod + Umschalt + L` |
| Cursor oben/unten hinzufügen | `Mod + Alt + Auf/Ab` |
| Cursor durch Klicken hinzufügen | `Alt + Klick` |
| Letzten Cursor rückgängig machen | `Alt + Mod + Z` |
| Auf einzelnen Cursor reduzieren | `Escape` |

Alle Standardbearbeitungen (Tippen, Löschen, Zwischenablage, Navigation) funktionieren an jedem Cursor unabhängig. Standardmäßig blockbegrenzt, um unbeabsichtigte Bearbeitungen über Abschnitte hinweg zu verhindern.

[Mehr erfahren →](/de/guide/multi-cursor)

## Auto-Pair & Tab-Escape

Wenn Sie eine öffnende Klammer, ein Anführungszeichen oder einen Backtick eingeben, fügt VMark automatisch das schließende Pendant ein. Drücken Sie **Tab**, um am schließenden Zeichen vorbeizuspringen, anstatt die Pfeiltaste zu verwenden.

- Klammern: `()` `[]` `{}`
- Anführungszeichen: `""` `''` `` ` ` ``
- CJK: `「」` `『』` `（）` `【】` `《》` `〈〉`
- Typografische Anführungszeichen: `""` `''`
- Formatierungszeichen in WYSIWYG: **Fett**, *Kursiv*, `Code`, ~~Durchgestrichen~~, Links

Rücktaste löscht beide Zeichen, wenn das Paar leer ist. Auto-Pair und Tab-Klammer-Sprung sind beide **innerhalb von Codeblöcken und Inline-Code deaktiviert** — Klammern in Code bleiben wörtlich. Konfigurierbar in **Einstellungen → Editor**.

[Mehr erfahren →](/de/guide/tab-navigation)

## Textformatierung

### Grundlegende Stile

- **Fett**, *Kursiv*, <u>Unterstrichen</u>, ~~Durchgestrichen~~
- `Inline-Code`, ==Hervorhebung==
- Tiefgestellt und Hochgestellt
- Links, Wiki-Links und Lesezeichen-Links mit Vorschau-Popups
- Fußnoten mit Inline-Bearbeitung
- HTML-Kommentar-Umschalter (`Mod + /`)
- Formatierung löschen

### Texttransformationen

Textumwandlung schnell über Format → Transformieren:

| Transformation | Tastenkürzel |
|----------------|--------------|
| GROSSBUCHSTABEN | `Strg + Umschalt + U` (macOS) / `Alt + Umschalt + U` (Win/Linux) |
| kleinbuchstaben | `Strg + Umschalt + L` (macOS) / `Alt + Umschalt + L` (Win/Linux) |
| Titel-Schreibweise | `Strg + Umschalt + T` (macOS) / `Alt + Umschalt + T` (Win/Linux) |
| Groß-/Kleinschreibung wechseln | — |

### Blockelemente

- Überschriften 1–6 mit einfachen Tastaturkürzeln (Ebene erhöhen/verringern mit `Mod + Alt + ]`/`[`)
- Blockzitate (verschachtelt unterstützt)
- Codeblöcke mit Syntaxhervorhebung
- Geordnete, ungeordnete und Aufgabenlisten
- Listentyp wechseln: einen Absatz nacheinander in Aufzählung, nummerierte oder Aufgabenliste umwandeln
- Horizontale Linien
- Tabellen mit vollständiger Bearbeitungsunterstützung

### Harte Zeilenumbrüche

Drücken Sie `Umschalt + Eingabe`, um einen harten Zeilenumbruch innerhalb eines Absatzes einzufügen.
VMark verwendet standardmäßig den Zwei-Leerzeichen-Stil für maximale Kompatibilität.
In **Einstellungen > Editor > Leerzeichen** konfigurierbar.

### Zeilenoperationen

Leistungsstarke Zeilenmanipulation über Bearbeiten → Zeilen:

| Aktion | Tastenkürzel |
|--------|--------------|
| Zeile nach oben verschieben | `Alt + Auf` |
| Zeile nach unten verschieben | `Alt + Ab` |
| Zeile duplizieren | `Umschalt + Alt + Ab` |
| Zeile löschen | `Mod + Umschalt + K` |
| Zeilen verbinden | `Mod + J` |
| Leerzeilen entfernen | — |
| Zeilen aufsteigend sortieren | `F4` |
| Zeilen absteigend sortieren | `Umschalt + F4` |

## Tabellen

Vollständige Tabellenbearbeitung:

- Tabellen über Menü oder Tastenkürzel einfügen
- Zeilen und Spalten hinzufügen/löschen
- Zellenausrichtung (links, mitte, rechts)
- Spalten durch Ziehen in der Größe ändern
- Kontext-Symbolleiste für schnelle Aktionen
- Tastaturnavigation (Tab, Pfeiltasten, Eingabe)

## Bilder

Umfassende Bildunterstützung:

- Über Dateidialog einfügen
- Drag & Drop aus dem Dateisystem
- Aus Zwischenablage einfügen
- Automatisch in den Projektasset-Ordner kopieren
- Größe über Kontextmenü ändern
- Doppelklick zum Bearbeiten des Quellpfads, Alt-Texts und der Abmessungen
- Zwischen Inline- und Block-Anzeige wechseln

## Video & Audio

Vollständige Medienunterstützung mit HTML5-Tags:

- Video und Audio über die Dateiauswahl in der Symbolleiste einfügen
- Mediendateien per Drag & Drop in den Editor ziehen
- Automatisch in den `.assets/`-Ordner des Projekts kopieren
- Klicken zum Bearbeiten von Quellpfad, Titel und Poster (Video)
- YouTube-Einbettungsunterstützung mit datenschutzoptimierten iFrames
- Bild-Syntax-Fallback: `![](datei.mp4)` wird automatisch zu Video hochgestuft
- Quellmodus-Dekoration mit typspezifischen farbigen Rändern
- [Mehr erfahren →](/de/guide/media-support)

## Frontmatter-Panel

Bearbeiten Sie YAML-Frontmatter direkt im WYSIWYG-Modus, ohne in den Quellmodus wechseln zu müssen.

- **Standardmäßig eingeklappt** — ein kleines „Frontmatter"-Label erscheint oben im Dokument, wenn Frontmatter vorhanden ist
- **Klicken zum Aufklappen** — öffnet einen Klartext-Editor für den YAML-Inhalt
- **`Mod + Eingabe`** — Änderungen speichern und das Panel einklappen
- **`Escape`** — zum zuletzt gespeicherten Wert zurückkehren und einklappen
- **Automatisches Speichern bei Fokusverlust** — wenn Sie woanders hinklicken, werden Änderungen nach einer kurzen Verzögerung automatisch gespeichert

Das Panel erstellt einen Rückgängig-Punkt in der Editor-Historie, sodass Sie Frontmatter-Änderungen jederzeit mit `Mod + Z` rückgängig machen können.

## Spezielle Inhalte

### Hinweisboxen

GitHub-flavored Markdown-Hinweise:

- NOTE — Allgemeine Informationen
- TIP — Hilfreiche Vorschläge
- IMPORTANT — Wichtige Informationen
- WARNING — Potenzielle Probleme
- CAUTION — Gefährliche Aktionen

### Einklappbare Abschnitte

Erstellen Sie erweiterbare Inhaltsblöcke mit dem HTML-Element `<details>`.

### Mathematische Gleichungen

KaTeX-gestützte LaTeX-Darstellung:

- Inline-Mathematik: `$E = mc^2$`
- Anzeigemathematik: `$$...$$`-Blöcke
- Vollständige LaTeX-Syntaxunterstützung
- Hilfreiche Fehlermeldungen mit Syntaxhinweisen

### Diagramme

Mermaid-Diagrammunterstützung mit Live-Vorschau:

- Flussdiagramme, Sequenzdiagramme, Gantt-Diagramme
- Klassendiagramme, Zustandsdiagramme, ER-Diagramme
- Live-Vorschaufenster im Quellmodus (ziehen, skalieren, zoomen)
- [Mehr erfahren →](/de/guide/mermaid)

### SVG-Grafiken

Rohes SVG inline über ` ```svg `-Codeblöcke rendern:

- Sofortige Darstellung mit Pan, Zoom und PNG-Export
- Live-Vorschau in beiden Modi (WYSIWYG und Quelle)
- Ideal für KI-generierte Diagramme und benutzerdefinierte Illustrationen
- [Mehr erfahren →](/de/guide/svg)

## KI-Genies

Integrierte KI-Schreibassistenz, unterstützt von Ihrem bevorzugten Anbieter:

- 13 Genies in vier Kategorien — Bearbeitung, Kreativität, Struktur und Werkzeuge
- Spotlight-ähnliche Auswahl mit Suche und freien Eingaben (`Mod + Y`)
- Inline-Vorschlagsdarstellung — mit Tastaturkürzeln akzeptieren oder ablehnen
- Unterstützt CLI-Anbieter (Claude, Codex, Gemini) und REST-APIs (Anthropic, OpenAI, Google AI, Ollama)

[Mehr erfahren →](/de/guide/ai-genies) | [Anbieter konfigurieren →](/de/guide/ai-providers)

## Suchen & Ersetzen

Öffnen Sie die Suchleiste mit `Mod + F`. Sie erscheint inline oben im Editorbereich und funktioniert in WYSIWYG- und Quellmodus.

**Navigation:**

| Aktion | Tastenkürzel |
|--------|--------------|
| Nächste Übereinstimmung finden | `Eingabe` oder `Mod + G` |
| Vorherige Übereinstimmung finden | `Umschalt + Eingabe` oder `Mod + Umschalt + G` |
| Auswahl für Suche verwenden | `Mod + E` |
| Suchleiste schließen | `Escape` |

**Suchoptionen** — über Schaltflächen in der Suchleiste umschalten:

- **Groß-/Kleinschreibung beachten** — exakte Buchstabengroßschreibung abgleichen
- **Ganzes Wort** — nur vollständige Wörter abgleichen, keine Teilzeichenfolgen
- **Regulärer Ausdruck** — Regex-Muster verwenden (zuerst in den Einstellungen aktivieren)

**Ersetzen:**

Klicken Sie auf das Erweiterungs-Chevron in der Suchleiste, um die Ersetzen-Zeile anzuzeigen. Geben Sie den Ersatztext ein, dann verwenden Sie **Ersetzen** (einzelne Übereinstimmung) oder **Alle ersetzen** (alle Übereinstimmungen auf einmal). Der Übereinstimmungszähler zeigt die aktuelle Position und Gesamtzahl an (z. B. „3 von 12").

## Markdown-Lint

VMark enthält einen integrierten Markdown-Linter, der Ihr Dokument auf häufige Syntaxfehler und Barrierefreiheitsprobleme prüft. Aktivierbar in **Einstellungen > Markdown > Lint**.

**Verwendung:**

| Aktion | Tastenkürzel |
|--------|--------------|
| Lint-Prüfung ausführen | `Alt + Mod + V` |
| Zum nächsten Problem springen | `F2` |
| Zum vorherigen Problem springen | `Umschalt + F2` |

Wenn Sie eine Lint-Prüfung ausführen, erscheinen Diagnosen als Inline-Hervorhebungen und Randmarkierungen. Falls keine Probleme gefunden werden, bestätigt eine Toast-Benachrichtigung, dass das Dokument fehlerfrei ist. Probleme werden als Fehler oder Warnungen klassifiziert.

**Geprüfte Regeln (13 insgesamt):**

- Undefinierte Referenzlinks
- Nicht übereinstimmende Tabellenspaltenanzahlen
- Vertauschte Link-Syntax `(Text)[URL]` statt `[Text](URL)`
- Fehlendes Leerzeichen nach `#` in Überschriften
- Leerzeichen innerhalb von Betonungszeichen
- Leerer Linktext oder leere Link-URLs
- Doppelte Link-/Bilddefinitionen
- Unbenutzte Link-/Bilddefinitionen
- Überschriftenebenen, die Stufen überspringen (z. B. H1 zu H3)
- Bilder ohne Alt-Text (Barrierefreiheit)
- Nicht geschlossene Fenced-Codeblöcke
- Fehlerhafte Fragment-Links (`#anker` stimmt mit keiner Überschrift überein)

Lint-Ergebnisse sind flüchtig und werden beim Bearbeiten des Dokuments gelöscht. Führen Sie die Prüfung jederzeit mit `Alt + Mod + V` erneut aus.

## Universelle Symbolleiste

Eine Formatierungs-Symbolleiste am unteren Rand des Editors, die in beiden Modi (WYSIWYG und Quellmodus) schnellen Zugriff auf alle Formatierungsaktionen bietet.

- **Umschalten:** `Mod + Umschalt + P` öffnet die Symbolleiste und gibt ihr den Fokus. Erneutes Drücken gibt den Fokus an den Editor zurück, während die Symbolleiste sichtbar bleibt.
- **Tastaturnavigation:** `Links`/`Rechts`-Pfeiltasten zum Wechseln zwischen Gruppen. `Enter` oder `Leertaste` öffnet ein Dropdown-Menü. Pfeiltasten navigieren innerhalb von Menüs.
- **Zweistufiges Escape:** Wenn ein Dropdown-Menü geöffnet ist, schließt `Escape` zuerst das Menü. Nochmaliges Drücken schließt die gesamte Symbolleiste.
- **Sitzungsspeicher:** Die Symbolleiste merkt sich, welcher Button zuletzt fokussiert war — beim erneuten Öffnen wird dort fortgesetzt.
- **KI-Genies-Schnellzugriff:** Die Symbolleiste enthält einen KI-Genies-Button, der den Genie-Picker öffnet (`Mod + Y`).

## Exportoptionen

VMark bietet flexible Exportoptionen zum Teilen Ihrer Dokumente.

### HTML-Export

Export in eigenständiges HTML mit zwei Verpackungsmodi:

- **Ordnermodus** (Standard): Erstellt `Dokument/index.html` mit Assets in einem Unterordner
- **Einzeldatei-Modus**: Erstellt eine eigenständige `.html`-Datei mit eingebetteten Bildern

Exportiertes HTML enthält den [**VMark Reader**](/de/guide/export#vmark-reader) — interaktive Steuerungen für Einstellungen, Inhaltsverzeichnis, Bild-Lightbox und mehr.

[Mehr über den Export →](/de/guide/export)

### PDF-Export

Mit nativem Systemdialog (`Cmd/Strg + P`) als PDF drucken.

### Als HTML kopieren

Formatierten Inhalt zum Einfügen in andere Apps kopieren (`Cmd/Strg + Umschalt + C`).

### Kopierformat

Standardmäßig kopiert das Kopieren aus WYSIWYG reinen Text (ohne Formatierung) in die Zwischenablage. Aktivieren Sie das **Markdown**-Kopierformat in **Einstellungen > Editor > Verhalten**, um stattdessen Markdown-Syntax in `text/plain` zu platzieren — Überschriften behalten ihre `#`, Links behalten ihre URLs usw. Nützlich beim Einfügen in Terminals, Code-Editoren oder Chat-Apps.

## CJK-Formatierung

Integrierte Textformatierungswerkzeuge für Chinesisch/Japanisch/Koreanisch:

- 20+ konfigurierbare Formatierungsregeln
- CJK-Englischer Abstand
- Vollbreite-Zeichenkonvertierung
- Interpunktions-Normalisierung
- Intelligente Anführungszeichen-Paarung mit Apostroph-/Primzahlerkennung
- Schutz technischer Konstrukte (URLs, Versionen, Zeiten, Dezimalzahlen)
- Kontextuelle Anführungszeichen-Konvertierung (gebogen für CJK, gerade für Lateinisch)
- Anführungsstil am Cursor umschalten (`Umschalt + Mod + '`)
- [Mehr erfahren →](/de/guide/cjk-formatting)

## Dokumentverlauf

VMark speichert automatisch Schnappschüsse Ihrer Dokumente, damit Sie frühere Versionen wiederherstellen können.

- **Automatisches Speichern** mit konfigurierbarem Intervall erfasst Schnappschüsse im Hintergrund
- **Dokumentbezogener Verlauf** lokal im JSONL-Format gespeichert
- Öffnen Sie die Verlaufs-Seitenleiste mit `Ctrl + Shift + 3`, um vergangene Versionen zu durchsuchen
- Schnappschüsse sind **nach Tagen gruppiert** mit Zeitstempeln, die den genauen Speicherzeitpunkt anzeigen
- **Wiederherstellen** einer früheren Version durch Klicken auf die Wiederherstellungsschaltfläche neben einem Schnappschuss (ein Bestätigungsdialog verhindert versehentliches Zurücksetzen)
- **Löschen** einzelner Schnappschüsse, die Sie nicht mehr benötigen, mit dem Papierkorb-Symbol
- Der aktuelle Inhalt wird als neuer Schnappschuss gespeichert, bevor eine Wiederherstellung erfolgt, sodass Sie nie Ihre Arbeit verlieren
- Der Verlauf erfordert, dass das Dokument als Datei gespeichert ist (unbenannte Dokumente haben keinen Verlauf)
- Verlaufsverfolgung in **Einstellungen > Allgemein** aktivieren oder deaktivieren

## Sitzungswiederherstellung (Hot Exit)

Wenn Sie VMark beenden oder es unerwartet beendet wird, wird Ihre Sitzung bewahrt und beim nächsten Start wiederhergestellt.

**Was gespeichert wird:**
- Alle offenen Tabs und ihr Inhalt (einschließlich ungespeicherter Änderungen)
- Cursorpositionen und Rückgängig-/Wiederholen-Verlauf
- UI-Layout: Seitenleistenstatus, Gliederungssichtbarkeit, Quell-/Fokus-/Schreibmaschinenmodus, Terminalstatus
- Fensterposition und -größe
- Aktiver Arbeitsbereich und Dateiexplorer-Einstellungen

**Funktionsweise:**
- Beim Beenden erfasst VMark den vollständigen Sitzungsstatus aller Fenster
- Beim Neustart werden Tabs genau so wiederhergestellt, wie Sie sie verlassen haben, wobei geänderte (ungespeicherte) Dokumente entsprechend markiert sind
- Absturzwiederherstellung läuft automatisch nach einem unerwarteten Beenden und stellt Dokumente aus periodischen Wiederherstellungsschnappschüssen wieder her
- Wiederherstellungsschnappschüsse älter als 7 Tage werden automatisch bereinigt

Keine Konfiguration erforderlich. Sitzungswiederherstellung ist immer aktiv.

## Ansicht & Fokus

### Fokusmodus (`F8`)

Der Fokusmodus verdunkelt alle Blöcke außer dem, den Sie gerade bearbeiten, und reduziert visuelle Ablenkungen, damit Sie sich auf einen einzelnen Absatz konzentrieren können. Der aktive Block ist bei voller Deckkraft hervorgehoben, während der umgebende Inhalt verblasst. Mit `F8` umschalten — funktioniert in WYSIWYG- und Quellmodus.

### Schreibmaschinenmodus (`F9`)

Der Schreibmaschinenmodus hält die aktive Zeile vertikal in der Mitte des Ansichtsfensters, sodass Ihre Augen in einer festen Position bleiben, während das Dokument darunter scrollt — genau wie bei einer physischen Schreibmaschine. Mit `F9` umschalten. Funktioniert in beiden Bearbeitungsmodi.

### Fokus + Schreibmaschine kombinieren

Fokusmodus und Schreibmaschinenmodus können gleichzeitig aktiviert werden. Zusammen bieten sie eine vollständig ablenkungsfreie Schreibumgebung: Umgebende Blöcke werden abgedunkelt *und* die aktuelle Zeile bleibt auf dem Bildschirm zentriert.

### Zeilenumbruch (`Alt + Z`)

Weichen Zeilenumbruch mit `Alt + Z` umschalten. Wenn aktiviert, werden lange Zeilen an der Editor-Breite umgebrochen, anstatt horizontal zu scrollen. Die Einstellung bleibt sitzungsübergreifend erhalten.

### Nur-Lese-Modus (`F10`)

Sperren Sie ein Dokument, um versehentliche Bearbeitungen zu verhindern. Mit `F10` umschalten. Wenn aktiv, werden alle Tastatureingaben und Formatierungsbefehle blockiert — Sie können weiterhin scrollen, Text auswählen und kopieren. Nützlich zum Überprüfen fertiger Dokumente oder zum Nachschlagen von Inhalten, während Sie in einem anderen Tab schreiben.

### Gliederungsbereich (`Ctrl + Shift + 1`)

Der Gliederungsbereich zeigt die Überschriftenstruktur Ihres Dokuments als zusammenklappbaren Baum in der Seitenleiste. Öffnen Sie ihn mit `Ctrl + Shift + 1`.

- Klicken Sie auf eine Überschrift, um den Editor zu diesem Abschnitt zu scrollen
- Klappen Sie Überschriftengruppen ein und aus, um sich auf bestimmte Teile Ihres Dokuments zu konzentrieren
- Die aktuell aktive Überschrift wird beim Scrollen oder Tippen hervorgehoben
- Wird in Echtzeit aktualisiert, wenn Sie Überschriften hinzufügen, entfernen oder umbenennen

### Zoom

Passen Sie die Editor-Schriftgröße an, ohne die Einstellungen zu öffnen:

| Aktion | Tastenkürzel |
|--------|--------------|
| Vergrößern | `Mod + =` |
| Verkleinern | `Mod + -` |
| Auf Standard zurücksetzen | `Mod + 0` |

Zoom ändert die Editor-Schriftgröße in 2px-Schritten (Bereich: 12px bis 32px). Es ändert denselben Schriftgrößenwert wie in **Einstellungen > Erscheinungsbild**, sodass Tastatur-Zoom und Einstellungsregler stets synchron bleiben.

## Texthilfsprogramme

VMark enthält Hilfsprogramme zur Textbereinigung und -formatierung, verfügbar im Format-Menü:

### Textbereinigung (Format → Textbereinigung)

- **Abschließende Leerzeichen entfernen**: Leerzeichen am Zeilenende entfernen
- **Leerzeilen reduzieren**: Mehrere Leerzeilen auf eine reduzieren

### CJK-Formatierung (Format → CJK)

Integrierte Textformatierungswerkzeuge für Chinesisch/Japanisch/Koreanisch. [Mehr erfahren →](/de/guide/cjk-formatting)

### Bildbereinigung (Datei → Unbenutzte Bilder bereinigen)

Verwaiste Bilder aus Ihrem Asset-Ordner finden und entfernen.

## Integriertes Terminal

Integriertes Terminal-Panel mit mehreren Sitzungen, Kopieren/Einfügen, Suche, anklickbaren Dateipfaden und URLs, Kontextmenü, Design-Synchronisierung und konfigurierbaren Schrifteinstellungen. Mit `` Strg + ` `` umschalten. [Mehr erfahren →](/de/guide/terminal)

## Automatische Aktualisierungen

VMark sucht automatisch nach Updates und kann diese in der App herunterladen und installieren:

- Automatische Update-Prüfung beim Start
- Ein-Klick-Update-Installation
- Versionshinweise-Vorschau vor der Aktualisierung

## Arbeitsbereich-Unterstützung

- Ordner als Arbeitsbereiche öffnen
- Dateibaum-Navigation in der Seitenleiste
- Schneller Dateiwechsel
- Verfolgen zuletzt verwendeter Dateien
- Fenstergröße und -position sitzungsübergreifend gespeichert

[Mehr erfahren →](/de/guide/workspace-management)

## Anpassung

### Designs

Fünf integrierte Farbdesigns:

- Weiß (sauber, minimal)
- Papier (warmes Cremeweiß)
- Mint (sanfter Grünton)
- Sepia (Vintage-Look)
- Nacht (Dunkelmodus)

### Schriftarten

Separate Schriftarten konfigurieren für:

- Lateinischen Text
- CJK (Chinesisch/Japanisch/Koreanisch) Text
- Monospace (Code)

### Layout

Anpassen:

- Schriftgröße
- Zeilenhöhe
- Block-Abstände (Abstand zwischen Absätzen und Blöcken)
- CJK-Buchstabenabstand (subtiler Abstand für CJK-Lesbarkeit)
- Editor-Breite
- Block-Element-Schriftgröße (Listen, Zitate, Tabellen, Hinweise)
- Überschriften-Ausrichtung (links oder zentriert)
- Bild- und Tabellen-Ausrichtung (links oder zentriert)

### Tastaturkürzel

Alle Tastaturkürzel sind in Einstellungen → Tastaturkürzel anpassbar.

## Technische Details

VMark ist mit moderner Technologie entwickelt:

| Komponente | Technologie |
|------------|-------------|
| Desktop-Framework | Tauri v2 (Rust) |
| Frontend | React 19, TypeScript |
| Zustandsverwaltung | Zustand v5 |
| Rich-Text-Editor | Tiptap (ProseMirror) |
| Quell-Editor | CodeMirror 6 |
| Styling | Tailwind CSS v4 |

Alle Verarbeitungen finden lokal auf Ihrem Computer statt — keine Cloud-Dienste, keine Konten erforderlich.
