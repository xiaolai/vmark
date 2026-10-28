# Funktionen

VMark ist der Klartext-Arbeitsbereich, in dem Menschen und KI zusammenarbeiten. Markdown steht im Mittelpunkt (mit WYSIWYG-, Quellvorschau- und Quellmodus), doch der Arbeitsbereich öffnet auch YAML, JSON, TOML, Mermaid, SVG, HTML und 9 Code-Betrachter-Formate — die vollständige Liste finden Sie unter [Unterstützte Formate](/de/guide/formats).

[[toc]]

## Editorenmodi

### Rich-Text-Modus (WYSIWYG)

Der Standard-Bearbeitungsmodus bietet ein echtes „Was Sie sehen, ist was Sie bekommen“-Erlebnis:

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

### Geteilte Ansicht (Quelle + Vorschau)

Bearbeiten Sie links die rohe Markdown-Quelle, während rechts eine **live aktualisierte,
schreibgeschützte WYSIWYG-Vorschau** mitläuft — die Vorschau *ist* der WYSIWYG-Renderer,
weicht also nie von dem ab, was Sie im Rich-Text-Modus sehen würden. Formatierungsbefehle
und die Symbolleiste wirken auf den Quellbereich; ziehen Sie den Teiler (oder verwenden Sie
die Pfeiltasten darauf), um die Größe zu ändern.

- Pro Sitzung umschalten mit `Umschalt + F6`, **Ansicht → Markdown-Splitansicht** oder der
  Befehlspalette („Markdown-Splitansicht umschalten“)
- Als Standard für Markdown-Dateien festlegen unter **Einstellungen → Markdown → Layout →
  Quelle/Vorschau standardmäßig teilen**

WYSIWYG bleibt der Standard; die Teilung ist optional. Die drei Ansichten schließen sich
gegenseitig aus — `F6` schaltet den Quellmodus und `Umschalt + F6` die Splitansicht um,
jeweils zurück zu WYSIWYG —, sodass der Wechsel zwischen ihnen immer ein einziger Tastendruck ist.

Das Menü **Ansicht** zeigt die drei Modi — **WYSIWYG-Modus**, **Quellcode-Modus**,
**Markdown-Splitansicht** — als Gruppe mit Häkchen, sodass der aktive Modus immer sichtbar
und der gegenseitige Ausschluss ausdrücklich ist. **Zeilenumbruch** und **Zeilennummern**
gelten nur für den Quelltext-Editor und sind daher im WYSIWYG-Modus ausgegraut.

### Leseposition

Ihre Stelle in einem Dokument bleibt erhalten, wenn Sie es verlassen. Der Wechsel zu einem
anderen Tab und zurück, das Umschalten des Quellmodus oder der Splitansicht oder das Neuladen
der Datei vom Datenträger bringen Sie dorthin zurück, wo Sie gelesen haben — nicht an den Anfang.

Jede Oberfläche merkt sich ihre eigene Position, sodass Rich Text und Quelle in derselben
Datei getrennte Stellen behalten. Kehren Sie zur selben Oberfläche zurück — per Tab-Wechsel
oder weil die Datei neu geladen wird —, landen Sie dort, wohin Sie gescrollt hatten, auch wenn
der Cursor woanders steht; der Cursor bleibt, wo Sie ihn gelassen haben. Beim Wechsel zwischen
Rich Text und Quelle folgt die Ansicht dagegen dem Cursor, sofern es einen gibt, denn er sorgt
dafür, dass derselbe Absatz in beiden sichtbar bleibt.

Positionen gelten pro Dokument und pro Sitzung — das Schließen eines Tabs vergisst sie.

### Rückgängig über Modi hinweg

Rückgängig und Wiederholen überschreiten die Grenze zwischen WYSIWYG ⇄ Quelle. Jeder Moduswechsel zeichnet einen Prüfpunkt auf, und sobald der eigene Verlauf des aktuellen Editors erschöpft ist, geht `Mod + Z` durch diese Prüfpunkte weiter — es stellt den früheren Inhalt wieder her, ohne die Ansicht zu wechseln, in der Sie sind. Wiederholen durchläuft dieselbe Kette vorwärts; ein Wiederholen, dessen Zweig Sie durch eine neue Bearbeitung verlassen haben, wird abgelehnt, statt über Ihre Arbeit angewendet zu werden. Die Kette wird pro Tab geführt und beim Schließen des Tabs gelöscht.

### Große Dateien

VMark öffnet große Dateien automatisch im Quellmodus, damit sie in unter einer Sekunde geöffnet sind — Dateien über 1 MB oder blockintensives Markdown mit 1.200+ geschätzten Blöcken —, warnt vor dem Öffnen von Dateien über 5 MB und lehnt Dateien über 50 MB ab. Schwellenwerte und Einstellungen finden Sie im Leitfaden [Große Dateien](./large-files.md).

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

Alle Standardbearbeitungen (Tippen, Löschen, Zwischenablage, Navigation) funktionieren an jedem Cursor unabhängig. Im Fließtext durchsuchen `Mod + D` und `Mod + Umschalt + L` das gesamte Dokument; innerhalb eines Codeblocks bleiben sie in diesem Block. `Alt + Mod + Umschalt + L` wählt nur alle Treffer im aktuellen Block aus.

[Mehr erfahren →](/de/guide/multi-cursor)

## Intelligentes Alles-Auswählen

Im WYSIWYG-Modus erweitert `Mod + A` die Auswahl Container für Container, statt sofort das ganze Dokument auszuwählen: In einer Tabelle wählt es zuerst die Zelle, dann die Zeile, dann die Tabelle und schließlich das Dokument aus. `Mod + Z` nimmt einen Erweiterungsschritt zurück, und `Escape` reduziert die Auswahl auf einen Cursor.

Im Quellmodus wählt `Mod + A` zuerst den umschließenden Block aus — einen Code-Fence, eine Tabelle, ein Blockzitat oder eine Liste — und dann das ganze Dokument; auch dort nimmt `Mod + Z` einen Erweiterungsschritt zurück.

Die Tastenbelegung gehört zum Editor und ist nicht anpassbar.

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
- Liste ausschalten: Ein erneuter Klick auf den aktiven Listentyp entfernt die Listenformatierung
- In Code umwandeln: Die Aktion Codeblock verwandelt die ganze Liste am Cursor — oder jede Auswahl über mehrere Blöcke (Absätze, Überschriften, Listen) — in einen einzigen Codeblock, eine Zeile pro Block oder Listenelement
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
| Zeilen aufsteigend sortieren | `F4` _(nur im Quellmodus)_ |
| Zeilen absteigend sortieren | `Umschalt + F4` _(nur im Quellmodus)_ |

Das Sortieren arbeitet mit reinen Textzeilen und ist daher nur im Quellmodus verfügbar.

## Tabellen

Vollständige Tabellenbearbeitung:

- Tabellen über Menü oder Tastenkürzel einfügen
- Zeilen und Spalten hinzufügen/löschen
- Zellenausrichtung (links, mitte, rechts)
- Spalten passen sich automatisch an den Inhalt an; breite Tabellen scrollen horizontal
- An Breite anpassen — eine Tabelle mit inhaltsproportionalen Spalten an die Editorbreite binden (Einstellungen → Markdown oder pro Tabelle per Rechtsklick)
- Kontext-Symbolleiste für schnelle Aktionen
- Tastaturnavigation — `Tab` / `Umschalt + Tab` wechseln zwischen Zellen, die Pfeiltasten verlassen die Tabelle an ihren Rändern, und `Mod + Eingabe` / `Mod + Umschalt + Eingabe` fügen eine Zeile darunter / darüber ein

## Bilder

Umfassende Bildunterstützung:

- Über Dateidialog einfügen
- Drag & Drop aus dem Dateisystem
- Aus Zwischenablage einfügen
- Automatisch in den Projektasset-Ordner kopieren
- Doppelklick zum Bearbeiten des Quellpfads und Alt-Texts — die Abmessungen des Bildes werden schreibgeschützt angezeigt
- Rechtsklick für Bild ändern, Bild löschen, Pfad kopieren und Im Finder anzeigen (Im Explorer anzeigen unter Windows, Im Dateimanager anzeigen unter Linux)
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

- **Standardmäßig eingeklappt** — ein kleines „Frontmatter“-Label erscheint oben im Dokument, wenn Frontmatter vorhanden ist
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
- Trennzeichen im ChatGPT-Stil werden beim Öffnen/Einfügen erkannt und in die
  `$`-Form normalisiert: `\( ... \)` wird zu Inline-Mathematik, und ein alleinstehendes
  `\[ ... \]` wird zu einem Anzeigeblock
- Ein `$$`-Block muss vor einer Leerzeile geschlossen werden (die Regel von pandoc) — ein nicht
  geschlossenes `$$` wird als wörtlicher Text dargestellt, statt die nachfolgenden Absätze zu
  verschlucken. Leerzeilen direkt vor dem schließenden Zeichen sind in Ordnung (ein leerer
  `$$` … `$$`-Block bleibt ein Mathematikblock)
- Vollständige LaTeX-Syntaxunterstützung
- Hilfreiche Fehlermeldungen mit Syntaxhinweisen

### Diagramme

Mermaid-Diagrammunterstützung mit Live-Vorschau:

- Flussdiagramme, Sequenzdiagramme, Gantt-Diagramme
- Klassendiagramme, Zustandsdiagramme, ER-Diagramme
- Live-Vorschaufenster im Quellmodus (ziehen, skalieren, zoomen)
- [Mehr erfahren →](/de/guide/mermaid)

Graphviz-DOT-Unterstützung mit denselben Vorschauflächen:

- ` ```dot `- und ` ```graphviz `-Code-Blöcke werden lokal gerendert (WASM)
- Schwenken, Zoomen und PNG-Export wie bei Mermaid-Diagrammen
- [Mehr erfahren →](/de/guide/graphviz)

### SVG-Grafiken

Rohes SVG inline über ` ```svg `-Codeblöcke rendern:

- Sofortige Darstellung mit Pan, Zoom und PNG-Export
- Live-Vorschau in beiden Modi (WYSIWYG und Quelle)
- Ideal für KI-generierte Diagramme und benutzerdefinierte Illustrationen
- [Mehr erfahren →](/de/guide/svg)

### Inline-Inhaltsverzeichnis

Geben Sie `[TOC]` in einer eigenen Zeile ein oder wählen Sie **Einfügen → Inhaltsverzeichnis**, um ein live aktualisiertes Inhaltsverzeichnis einzufügen (der Menüpunkt hat kein Standard-Tastenkürzel; weisen Sie ihm eines unter Einstellungen → Tastenkürzel zu):

- Automatisch aus den Überschriften des Dokuments erzeugt, korrekt verschachtelt
- Klicken Sie auf eine Überschrift, um direkt dorthin zu scrollen
- Aktualisiert sich in Echtzeit beim Bearbeiten
- Wird in WYSIWYG und im Export (HTML/PDF) gerendert und übersteht den Wechsel in den Quellmodus unverändert

## KI-Genies

Integrierte KI-Schreibassistenz, unterstützt von Ihrem bevorzugten Anbieter:

- 13 Genies in vier Kategorien — Bearbeitung, Kreativität, Struktur und Werkzeuge
- Spotlight-ähnliche Auswahl mit Suche und freien Eingaben (`Mod + Y`)
- Inline-Vorschlagsdarstellung — mit Tastaturkürzeln akzeptieren oder ablehnen
- Unterstützt CLI-Anbieter (Claude, Codex, Gemini) und REST-APIs (Anthropic, OpenAI, Google AI, Ollama)

[Mehr erfahren →](/de/guide/ai-genies) | [Anbieter konfigurieren →](/de/guide/ai-providers)

## Suchen & Ersetzen

Öffnen Sie die Suchleiste mit `Mod + F`. Sie öffnet sich in der Leiste am unteren Fensterrand und funktioniert in WYSIWYG- und Quellmodus.

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

Das Ersetzen-Feld steht neben dem Suchfeld — beide sind immer sichtbar, und `Tab` wechselt vom einen zum anderen. Geben Sie den Ersatztext ein, dann verwenden Sie **Ersetzen** (einzelne Übereinstimmung) oder **Alle ersetzen** (alle Übereinstimmungen auf einmal). Der Übereinstimmungszähler zeigt die aktuelle Position und Gesamtzahl an (z. B. „3 von 12“), sodass Sie immer wissen, wo Sie sind.

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

Lint-Ergebnisse werden beim Tippen nicht aktualisiert. Im Quellmodus löscht eine Bearbeitung sie. Im WYSIWYG-Modus entfernt eine Bearbeitung die Hervorhebungen, aber die Anzahl der Probleme in der Statusleiste und die Sprungziele von `F2` / `Umschalt + F2` bleiben vom letzten Durchlauf erhalten, bis Sie die Prüfung erneut ausführen oder den Tab schließen. Führen Sie die Prüfung jederzeit mit `Alt + Mod + V` erneut aus.

## Universelle Symbolleiste

Eine Formatierungs-Symbolleiste am unteren Rand des Editors, die in beiden Modi (WYSIWYG und Quellmodus) schnellen Zugriff auf alle Formatierungsaktionen bietet.

- **Umschalten:** `Mod + Umschalt + B` öffnet die Symbolleiste und gibt ihr den Fokus. Erneutes Drücken gibt den Fokus an den Editor zurück, während die Symbolleiste sichtbar bleibt.
- **Tastaturnavigation:** `Links`/`Rechts`-Pfeiltasten zum Wechseln zwischen Gruppen. `Enter` oder `Leertaste` öffnet ein Dropdown-Menü. Pfeiltasten navigieren innerhalb von Menüs.
- **Zweistufiges Escape:** Wenn ein Dropdown-Menü geöffnet ist, schließt `Escape` zuerst das Menü. Nochmaliges Drücken schließt die gesamte Symbolleiste.
- **Sitzungsspeicher:** Die Symbolleiste merkt sich, welcher Button während der aktuellen Sitzung zuletzt fokussiert war — beim erneuten Fokussieren wird dort fortgesetzt.
- **KI-Genies-Schnellzugriff:** Die Symbolleiste enthält einen KI-Genies-Button, der den Genie-Picker öffnet (`Mod + Y`).

## Editor-Kontextmenü

Klicken Sie mit der rechten Maustaste an einer beliebigen Stelle im Editor (WYSIWYG- oder Quellmodus), um ein Kontextmenü mit gängigen Aktionen zu öffnen.

- **Zwischenablage:** Ausschneiden, Kopieren, Einfügen und Alles auswählen. Unter macOS verwenden diese die native Zwischenablage-Pipeline, sodass beim Einfügen von Rich Content (z. B. aus einem Browser kopiertes HTML) die Formatierung erhalten bleibt — genau wie bei `Mod + V`.
- **Inline-Formatierung:** Fett, Kursiv, Durchgestrichen und Inline-Code, mit Häkchen für die am Cursor aktiven Auszeichnungen.
- **Block-Operationen:** Untermenüs für Überschriftenebene und Listentyp, Blockzitat und Codeblock — Häkchen zeigen den aktuellen Block.
- **Links:** Link einfügen bei normalem Text; bei einem vorhandenen Link wechselt der Abschnitt zu Link bearbeiten, Link kopieren und Link entfernen.
- **Kontextabhängig:** In Tabellen erscheint stattdessen das eigene Tabellenmenü; ein Rechtsklick auf ein Bild öffnet das Bildmenü; in Codeblöcken werden nur Zwischenablage-Aktionen angeboten. Nicht-Markdown-Dateien (JSON, YAML, …) erhalten ein reduziertes Menü nur mit Zwischenablage-Aktionen.
- **Umgang mit der Auswahl:** Ein Rechtsklick innerhalb einer Auswahl behält sie bei; ein Rechtsklick anderswo setzt zuerst den Cursor dorthin (macOS-Konvention).
- **Tastatur:** Pfeiltasten navigieren (deaktivierte Einträge werden übersprungen), `Rechts`/`Links` öffnen und verlassen Untermenüs, `Escape` schließt zuerst das Untermenü und dann das Menü. Die Tastenkürzel-Hinweise berücksichtigen Ihre eigenen Tastenbelegungen.

## Befehlspalette

Drücken Sie `Mod + Umschalt + P`, um die Befehlspalette zu öffnen. Bei leerer Eingabe listet sie jeden verfügbaren Befehl nach Kategorie gruppiert auf — Datei, Arbeitsbereich, Ansicht, Export, Formatierung, Überschriften, Listen, Tabellen, Zeilen, Auswahl, Transformieren, CJK, Lint, Verlauf, KI und mehr; tippen Sie zum Filtern und Sortieren nach Übereinstimmung. `↑`/`↓` bewegen, `Eingabe` führt den Befehl aus, `Escape` (oder ein Klick auf den Hintergrund) schließt. Es werden nur Befehle angezeigt, die gerade anwendbar sind — ein Editor-Befehl verschwindet, wenn kein Dokument geöffnet ist, ein Arbeitsbereichsbefehl, wenn kein Arbeitsbereich geöffnet ist —, und der Befehl läuft in dem Fenster, aus dem Sie die Palette geöffnet haben. Die Seiten dieses Leitfadens nennen ihre Palettenbefehle in Anführungszeichen („Markdown-Splitansicht umschalten“, „Kohärenz-Aufschlüsselung“, „Fensterstatus“). Die Palette hat keinen Menüeintrag; ihr Tastenkürzel lässt sich unter **Einstellungen → Tastenkürzel** anpassen.

## Exportoptionen

VMark bietet flexible Exportoptionen zum Teilen Ihrer Dokumente.

### HTML-Export

**Datei → Exportieren → HTML** schreibt einen Ordner, der sowohl `index.html` (mit einem verknüpften `assets/`-Ordner) als auch `standalone.html` (alles eingebettet) enthält — es gibt keinen Modus zu wählen; verwenden Sie die Datei, die passt.

Exportiertes HTML enthält den [**VMark Reader**](/de/guide/export#vmark-reader) — interaktive Steuerungen für Einstellungen, Inhaltsverzeichnis, Bild-Lightbox und mehr.

[Mehr über den Export →](/de/guide/export)

### PDF-Export

**Datei → Exportieren → PDF** öffnet VMarks eigenen Exportdialog — Seitengröße (A4, Letter, A3, Legal) und Ausrichtung, Randvorgaben oder ein ziehbarer benutzerdefinierter Randrahmen, Schriftgröße, Zeilenhöhe, lateinische und CJK-Schriftarten, Stilvorgaben und Seitenzahlen — und schreibt dann das PDF unter macOS, Windows und Linux, mit einer anklickbaren Überschriftengliederung in der Seitenleiste des Betrachters. **Drucken** (`Cmd/Strg + P`) ist der separate Weg über den Druckdialog des Systems. [Mehr erfahren →](/de/guide/export#drucken-als-pdf-exportieren)

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
- **Dokumentbezogener Verlauf** lokal im Anwendungsdatenordner von VMark gespeichert — eine Indexdatei plus eine Markdown-Datei pro Schnappschuss
- Öffnen Sie die Verlaufs-Seitenleiste mit `Ctrl + Shift + 3`, um vergangene Versionen zu durchsuchen
- Schnappschüsse sind **nach Tagen gruppiert** mit Zeitstempeln, die den genauen Speicherzeitpunkt anzeigen
- **Wiederherstellen** einer früheren Version durch Klicken auf die Wiederherstellungsschaltfläche neben einem Schnappschuss (ein Bestätigungsdialog verhindert versehentliches Zurücksetzen)
- **Löschen** einzelner Schnappschüsse, die Sie nicht mehr benötigen, mit dem Papierkorb-Symbol
- Der aktuelle Inhalt wird als neuer Schnappschuss gespeichert, bevor eine Wiederherstellung erfolgt, sodass Sie nie Ihre Arbeit verlieren
- Der Verlauf erfordert, dass das Dokument als Datei gespeichert ist (unbenannte Dokumente haben keinen Verlauf)
- Verlaufsverfolgung in **Einstellungen > Allgemein** aktivieren oder deaktivieren

## Sitzungswiederherstellung (Hot Exit)

Wenn VMark neu startet, um ein Update zu installieren, oder unerwartet beendet wird, bleibt Ihre Arbeit erhalten und wird beim nächsten Start wiederhergestellt.

**Was ein Update-Neustart speichert:**
- Alle offenen Tabs und ihr Inhalt (einschließlich ungespeicherter Änderungen)
- Cursorpositionen und Rückgängig-/Wiederholen-Verlauf
- UI-Layout: Seitenleistenstatus, Gliederungssichtbarkeit, Quell-/Fokus-/Schreibmaschinenmodus, Terminalstatus
- Fensterposition und -größe
- Aktiver Arbeitsbereich und Dateiexplorer-Einstellungen

**Funktionsweise:**
- Wenn Sie wählen, neu zu starten und ein Update zu installieren, erfasst VMark zuvor den vollständigen Sitzungsstatus aller Fenster
- Beim Neustart werden Tabs genau so wiederhergestellt, wie Sie sie verlassen haben, wobei geänderte (ungespeicherte) Dokumente entsprechend markiert sind
- Ungespeicherte Änderungen werden außerdem alle 10 Sekunden in Wiederherstellungsschnappschüsse geschrieben. Nach einem unerwarteten Beenden stellt VMark sie beim nächsten Start als ungespeicherte Tabs wieder her
- Wiederherstellungsschnappschüsse älter als 7 Tage werden automatisch bereinigt
- Ein gewöhnliches Beenden erfasst die Sitzung nicht: VMark fordert Sie zuvor auf, ungespeicherte Dokumente zu speichern (siehe [Tabs und Fenster schließen](/de/guide/tab-navigation#tabs-und-fenster-schließen)). Die offenen Tabs eines Arbeitsbereichs kehren dennoch zurück, wenn Sie ihn das nächste Mal öffnen (siehe [Sitzungswiederherstellung](/de/guide/workspace-management#sitzungswiederherstellung))

Keine Konfiguration erforderlich. Sitzungswiederherstellung ist immer aktiv.

## Statusleiste

Die Statusleiste verläuft am unteren Rand des Fensters (`F7` blendet sie aus). Die linke Seite enthält die Tab-Leiste — siehe [Zwischen geöffneten Tabs wechseln](/de/guide/tab-navigation#zwischen-geoffneten-tabs-wechseln) — und kurze Hinweise wie *„Im Quelltextmodus geöffnet (große Datei).“* Die rechte Seite, von links nach rechts:

| Anzeige | Was sie zeigt | Klick |
|---|---|---|
| Automatisches Speichern | Ein Speichersymbol und wie lange das automatische Speichern des Dokuments her ist; verblasst nach einigen Sekunden | — |
| Zählungen | Wörter und Zeichen (Leerzeichen nicht mitgezählt); bei einer Auswahl *ausgewählt / gesamt* | Öffnet ein Popover **Wortzähler**: Wörter, Zeichen, Zeichen ohne Leerzeichen, CJK-Zeichen, Zeichen ohne Satzzeichen |
| Lint | ⊗ Fehler oder ⚠ Warnungen aus dem letzten [Lint](#markdown-lint)-Durchlauf; ausgeblendet, wenn es keine gibt | Springt zum nächsten Problem |
| KI | Während ein Genie läuft, *Denkt nach...* mit den verstrichenen Sekunden und einem × zum Abbrechen; danach *Fertig* oder der Fehler mit **Erneut versuchen**, das die fehlgeschlagene Anfrage erneut ausführt, und **Schließen**; Erneut versuchen fehlt, wenn es nichts zu wiederholen gibt, etwa ohne Anbieter | — |
| MCP | Ein Satellitensymbol, eingefärbt, wenn ein KI-Client verbunden ist; das Wort *aus*, *…* oder *Fehler*, wenn er nicht normal läuft. Der Tooltip nennt die verbundenen Clients | Öffnet **Einstellungen → Integrationen** |
| MCP-Listener | Eine Warnung, *MCP in diesem Fenster nicht verfügbar*, wenn der Anfrage-Listener dieses Fensters auch nach allen Wiederholungen nicht starten konnte: KI-Clients erreichen dieses Fenster nicht, selbst wenn der MCP-Server läuft. Starten Sie VMark neu, um es erneut zu versuchen | — |
| MCP-Verlauf | Ein Verlaufssymbol mit der Zahl der KI-Versionen des fokussierten Dokuments, in Warnfarbe, wenn seine Änderungen nicht aufgezeichnet werden; das Panel zeigt, wer jede Version erstellt hat, mit **Diese Version wiederherstellen** und **Stand vor dieser Änderung wiederherstellen**, dazu [Frühere Prüfpunkte](/de/guide/mcp-setup#bearbeitungs-prufpunkte) | Öffnet das Panel |
| Terminal | — | Zeigt das Terminal an oder blendet es aus |
| Modus | Der aktuelle Modus — Quelle oder WYSIWYG (bei GitHub-Actions-Workflow-Dateien ausgeblendet) | Wechselt den Modus |
| Sperre | Ob das Dokument schreibgeschützt ist | Schaltet den Schreibschutz um |

Die rechte Seite ist ausgeblendet, solange ein Browser-Tab aktiv ist. Eine ausgeblendete Statusleiste erscheint von selbst wieder, solange ein KI-Genie Fortschritt meldet oder ein Browser-Tab aktiv ist.

## Bearbeitungsdetails

Einige Verhaltensweisen, die ohne jede Einstellung funktionieren:

- **Die Auswahl bleibt sichtbar, wenn der Editor den Fokus verliert.** Klicken Sie ins Terminal, in die Seitenleiste oder in ein Popup, und der ausgewählte Text behält eine schwächere Hervorhebung, sodass Sie sehen, worauf ein Befehl oder ein KI-Tool wirken wird. Der Quellmodus zeigt jeden Bereich einer Mehrcursor-Auswahl.
- **Tippen am linken Rand von Inline-Code landet darin.** Steht der Cursor im WYSIWYG-Modus direkt vor einem Inline-Code-Abschnitt — egal, wie Sie dorthin gelangt sind —, wird das nächste Zeichen Teil des Codes, statt außerhalb zu landen.
- **Eingabemethoden (IME) sind sicher.** Während Sie mit einer chinesischen, japanischen oder koreanischen Eingabemethode komponieren, und für 50 ms nach dem Ende der Komposition, lösen Editor-Tastenkürzel und automatische Umwandlungen nicht aus, sodass das Drücken der Eingabetaste zum Übernehmen eines Kandidaten nicht zugleich den Absatz teilt. Rückgängig und Wiederholen funktionieren weiterhin. Eine mit der Eingabetaste bestätigte koreanische Silbe beginnt zugleich die neue Zeile. Übrig gebliebene Romanisierung vor übernommenem Text wird entfernt, und ein in eine leere Tabellenzelle übernommenes Zeichen bleibt so, wie es eingegeben wurde. Informations-Toasts warten, bis die Komposition endet; Fehler und Warnungen erscheinen sofort. Eine Bearbeitung eines KI-Clients über MCP wird abgelehnt (der Client versucht es erneut) oder bis zum Ende der Komposition zurückgehalten, und eine Änderung der Datei auf dem Datenträger wartet ebenfalls — so überschreibt keine von beiden Text, den Sie noch komponieren.
- **Reduzierte Bewegung wird beachtet.** Ist die Bedienungshilfen-Einstellung *Bewegung reduzieren* Ihres Betriebssystems eingeschaltet, schaltet VMark seine Animationen und Übergänge aus und scrollt sofort statt weich (auch im Schreibmaschinenmodus). Eine eigene Einstellung in VMark gibt es nicht. Die Systemeinstellung *Transparenz reduzieren* schaltet ebenso die Hintergrundunschärfe aus.

## Ansicht & Fokus

### Fokusmodus (`F8`)

Der Fokusmodus verdunkelt alle Blöcke außer dem, den Sie gerade bearbeiten, und reduziert visuelle Ablenkungen, damit Sie sich auf einen einzelnen Absatz konzentrieren können. Der aktive Block ist bei voller Deckkraft hervorgehoben, während der umgebende Inhalt verblasst. Mit `F8` umschalten — funktioniert in WYSIWYG- und Quellmodus und bleibt aktiv, bis Sie ihn wieder ausschalten.

### Schreibmaschinenmodus (`F9`)

Der Schreibmaschinenmodus hält die aktive Zeile vertikal in der Mitte des Ansichtsfensters, sodass Ihre Augen in einer festen Position bleiben, während das Dokument darunter scrollt — genau wie bei einer physischen Schreibmaschine. Mit `F9` umschalten. Funktioniert in beiden Bearbeitungsmodi und verwendet weiches Scrollen mit einem kleinen Schwellenwert, um ruckartige Anpassungen bei kleinen Cursorbewegungen zu vermeiden.

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
- Lange Titel werden auf zwei Zeilen umbrochen und beim Darüberfahren vollständig angezeigt
- Ein Filterfeld oben im Bereich grenzt den Baum auf Überschriften ein, deren Text Ihrer Eingabe entspricht (ohne Beachtung der Groß-/Kleinschreibung; übergeordnete Überschriften bleiben erhalten, damit der Pfad sichtbar bleibt). Drücken Sie `Esc`, um ihn zu leeren.

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

### Bildbereinigung (Format → Textbereinigung → Nicht verwendete Bilder bereinigen…)

Verwaiste Bilder aus Ihrem Asset-Ordner finden und entfernen (auch über die Befehlspalette verfügbar). VMark zeigt, was es gefunden hat, und fragt vor dem Löschen nach; gelöschte Bilder landen im Papierkorb des Systems. Ein Bild, das noch von einem geöffneten Dokument verwendet wird — einschließlich ungespeicherter Änderungen in einem anderen VMark-Fenster —, bleibt erhalten. Kann VMark nicht bestätigen, dass ein Bild unbenutzt ist (etwa weil ein anderes Fenster nicht rechtzeitig antwortet), löscht es nichts.

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
- Fensterstatus-Panel — sehen Sie den Live-Status von Claude Code / KI in jedem geöffneten Fenster und springen Sie direkt zu dem, das Sie braucht; heften Sie es in diesem Fenster oder in allen Fenstern an (auch in später geöffneten), damit es geöffnet bleibt, während Sie zwischen Fenstern wechseln

[Mehr erfahren →](/de/guide/workspace-management)

## Kohärenz, Wissensdatenbank & Slidev

- **Kohärenz- & Aufschlüsselungsansicht** — die optionale Herkunftsverfolgung zeichnet auf, welche Dokumente jede KI-Generierung gelesen hat, markiert nachgelagerte Dokumente, wenn sich ein vorgelagertes ändert, und ergänzt semantische Prüfungen, Kanon-Aussagen und Kontexte. Öffnen Sie sie über **Fenster → Kohärenz-Aufschlüsselung**. [Mehr erfahren →](/de/guide/coherence)
- **Wissensdatenbank** — stellt einen geöffneten Arbeitsbereich als verlinkte Website bereit (Wiki-Links, Rückverweise, Beziehungsgraph, Volltextsuche) auf `127.0.0.1`, in einem Panel (`Ctrl + Shift + 4`) oder in Ihrem Browser, und zeigt Slidev-Präsentationen in der Vorschau an und exportiert sie. Noch kein Release-Build enthält die dafür nötige Content-Server-Laufzeit, daher sind das Panel, sein Menüpunkt, der Paletten-Befehl und das Tastenkürzel ausgeblendet, solange **Einstellungen → Erweitert → Entwickler-Tools** nicht eingeschaltet ist. [Mehr erfahren →](/de/guide/knowledge-base)

## Anpassung

### Designs

Sechs integrierte Farbdesigns:

- Weiß (sauber, minimal)
- Papier (warmes Cremeweiß)
- Mint (sanfter Grünton)
- Sepia (Vintage-Look)
- Nacht (Dunkelmodus)
- Solarized (dunkel, Solarized-Palette)

### Schriftarten

Separate Schriftarten konfigurieren für:

- Lateinischen Text
- CJK (Chinesisch/Japanisch/Koreanisch) Text
- Monospace (Code)

Jede Auswahl bietet eine kurze Liste empfohlener Schriftarten, die auf Ihrem Computer installierten Schriftarten und einen Eintrag **Benutzerdefiniert…**, in den Sie einen beliebigen Schriftfamiliennamen eingeben. [Details →](/de/guide/settings#typografie)

Die Monospace-Schriftart wird geprüft, bevor sie im Quellmodus, in Code und im Terminal verwendet wird: Ist die gewählte Schriftart nicht installiert oder stellt sich heraus, dass sie nicht dicktengleich ist, weicht VMark entlang der Schriftliste auf die nächste aus, die es ist. Das ist vor allem unter Linux mit einer CJK-Sprachumgebung wichtig, wo ein fehlender Schriftname sonst zu einer proportionalen CJK-Schriftart aufgelöst werden und das Raster des Terminals zerstören kann.

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
