# Einstellungen

VMark's Einstellungsbereich ermöglicht die Anpassung aller Aspekte des Editors. Öffnen Sie ihn mit `Mod + ,` oder über **VMark > Einstellungen** in der Menüleiste.

Das Einstellungsfenster hat eine Seitenleiste, die die Abschnitte alphabetisch (nach ihren englischen Namen) auflistet, mit „Über“ am Ende und „Erweitert“ darunter, wenn es eingeblendet ist. Änderungen werden sofort wirksam — es gibt keine Speichern-Schaltfläche.

Mit dem **Suchfeld** oben in der Seitenleiste filtern Sie Einstellungen über alle Bereiche hinweg nach Name oder Beschreibung — passende Zeilen werden zusammen aufgelistet, sodass Sie nicht wissen müssen, in welcher Kategorie eine Einstellung liegt. Um alles auf die Werkseinstellungen zurückzusetzen, verwenden Sie **Auf Standardwerte zurücksetzen** im Abschnitt „Über“.

## Erscheinungsbild

Steuert das visuelle Design und das Fensterverhalten.

### Design

Wählen Sie eines von sechs Farbdesigns. Das aktive Design wird durch einen Ring um sein Farbfeld angezeigt.

| Design | Hintergrund | Stil |
|--------|------------|------|
| Weiß | `#FFFFFF` | Sauberes Weiß, höchster Kontrast |
| Papier | `#EEEDED` | Warmes Zeitungspapier, der Standard |
| Mint | `#CCE6D0` | Sanftes Grün, augenfreundlich |
| Sepia | `#F9F0DB` | Buchpapier, für langes Lesen |
| Nacht | `#23262B` | Dunkles Schiefergrau für wenig Licht |
| Solarized | `#002B36` | Solarized Dark, die klassische Palette |

::: info Windows 10 und Linux bieten nur Weiß und Nacht
Unter Windows 10 und Linux zeichnet das System die Titelleiste, und diese kann nur hell oder dunkel sein. Diese Plattformen bieten daher nur **Weiß** und **Nacht** an, und ein Design, das nicht zum System-Fensterrahmen passen kann, wird als das nächstliegende der beiden angezeigt: Papier, Mint und Sepia erscheinen als Weiß, Solarized als Nacht. Ihre gespeicherte Auswahl wird dabei nicht geändert — unter macOS und Windows 11 steht der vollständige Katalog zur Verfügung. Unter Windows 11 übernimmt die Titelleiste die Farben des Designs; die Menüleiste wird weiterhin hell oder dunkel gezeichnet.
:::

#### Systemdarstellung folgen

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Systemdarstellung folgen | Automatisch mit dem System zwischen Ihrem hellen und dunklen Design wechseln | Aus |

Ist die Option aktiviert, wird die einzelne Design-Zeile durch zwei Zeilen ersetzt — **Helles Design** (verwendet, solange das System im hellen Modus ist, Standard Papier) und **Dunkles Design** (verwendet im dunklen Modus, Standard Nacht). VMark wechselt in dem Moment zwischen ihnen, in dem sich die Systemdarstellung ändert; Ihre manuelle Designauswahl bleibt erhalten und wird wiederhergestellt, wenn Sie die Option ausschalten.

### Seitenleiste

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Stil der Seitenleiste | Wie Seitenleiste und Arbeitsbereichsleiste gerahmt werden. **Volle Höhe** führt sie mit einer feinen Trennlinie am Fensterrand entlang, wie die Seitenleisten von macOS selbst; **Karte** lässt sie mit abgerundeten Ecken und Schatten im Fenster schweben. Gilt auch für das Einstellungsfenster | Volle Höhe | Volle Höhe, Karte |

### Fenster

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Dateiname in Titelleiste anzeigen | Aktuellen Dateinamen in der macOS-Fenstertitelleiste anzeigen. **Nur macOS** — anderswo ist diese Einstellung ausgeblendet, weil Windows und Linux den Dateinamen immer in der Titelleiste des Systems anzeigen | Aus |

Unter macOS zeichnet VMark seine eigene Titelleiste über die des Systems, daher ist
der Dateiname ein optionales Element dieser Leiste. Unter Windows und Linux zeichnet
das System eine echte Titelleiste über dem Fenster: Der Dateiname (mit einem `•`,
solange ungespeicherte Änderungen vorliegen) erscheint immer dort, und VMark fügt
keine eigene Titelleiste hinzu.

### Fokusmodus

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Abdunklungsgrad | Wie stark nicht fokussierte Inhalte im Fokusmodus abgedunkelt werden. **Standard** behält die standardmäßige, rein farbliche Abdunklung bei; **Stark** und **Stärker** fügen zusätzlich eine zunehmend geringere Deckkraft hinzu | Standard | Standard, Stark, Stärker |

## Editor

Typografie, Anzeige, Bearbeitungsverhalten, Leerzeichen und große Dateien.

### Typografie

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Lateinische Schriftart | Schriftfamilie für lateinischen (englischen) Text | Systemstandard | Systemstandard, Athelas, Palatino, Georgia, Charter, Literata — sowie jede installierte Schrift |
| CJK-Schriftart | Schriftfamilie für chinesischen, japanischen, koreanischen Text | Systemstandard | Systemstandard, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans — sowie jede installierte Schrift |
| Mono-Schriftart | Schriftfamilie für Code und monospace Text — wird auch vom integrierten Terminal verwendet | Systemstandard | Systemstandard, SF Mono, Monaco, Menlo, Consolas, DejaVu Sans Mono, Liberation Mono, Ubuntu Mono, Noto Sans Mono, Noto Sans Mono CJK SC, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata — sowie jede installierte Schrift |
| Schriftgröße | Basis-Schriftgröße für Editor-Inhalt | 18px | 14px, 16px, 18px, 20px, 22px |
| Zeilenhöhe | Vertikaler Abstand zwischen Zeilen | 1,8 (Entspannt) | 1,4 (Kompakt), 1,6 (Normal), 1,8 (Entspannt), 2,0 (Geräumig), 2,2 (Extra) |
| Block-Abstand | Visueller Abstand zwischen Blockelementen (Überschriften, Absätzen, Listen) gemessen in Vielfachen der Zeilenhöhe | 1x (Normal) | 0,5x (Eng), 1x (Normal), 1,5x (Entspannt), 2x (Geräumig) |
| CJK-Buchstabenabstand | Zusätzlicher Abstand zwischen CJK-Zeichen in em-Einheiten | Aus | Aus, 0,02em (Subtil), 0,03em (Leicht), 0,05em (Normal), 0,08em (Weit), 0,10em (Weiter), 0,12em (Extra) |

#### Eine selbst installierte Schrift verwenden

Die oben genannten Namen sind eine Vorauswahl, keine Grenze. Jede der drei
Schriftauswahlen enthält außerdem einen Abschnitt **Installierte Schriften**, der
jede Schriftfamilie auf dem Rechner auflistet; eine von Ihnen installierte Schrift
— LXGW WenKai, Iosevka, Source Han Serif — wählen Sie also genauso aus wie die
eingebauten.

Wählen Sie am Ende der Liste **Benutzerdefiniert…**, um stattdessen einen
Familiennamen einzugeben. Verwenden Sie den Namen genau so, wie das System ihn
meldet (macOS: Schriftsammlung; Windows: Einstellungen → Personalisierung →
Schriftarten) — für LXGW WenKai / 霞鹜文楷 ist das `LXGW WenKai`. Die Schrift wird
angewendet, sobald der Name vollständig ist; ändert sich nichts, passt der Name
zu keiner installierten Familie. Ein Name mit Anführungszeichen, Kommas,
Semikolons oder Klammern wird abgewiesen, und die Zeile weist darauf hin.

::: tip Installierte Schriften nur unter macOS
macOS listet jede installierte Familie für Sie auf. Unter Windows und Linux ist
der Abschnitt leer, und **Benutzerdefiniert…** ist der Weg — die Eingabe des
Familiennamens funktioniert auf allen drei Plattformen identisch.
:::

Die Auswahl gilt auch für den PDF-Export, der über dieselbe Engine mit denselben
Schriften rendert. Der HTML-Export kann keine Schrift von Ihrem Rechner
mitliefern; eine exportierte Seite fällt daher auf die eigenen Schriften des
Lesers zurück, sofern dieser nicht dieselbe Familie installiert hat.

### Anzeige

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Editor-Breite | Maximale Inhaltsbreite. Breitere Werte eignen sich für große Monitore; schmalere verbessern die Lesbarkeit | 50em (Mittel) | 36em (Kompakt), 42em (Schmal), 50em (Mittel), 60em (Weit), 80em (Extra Weit), Unbegrenzt |

::: tip Dieselbe Breite liest sich in lateinischer Schrift und CJK unterschiedlich
Die Editor-Breite wird in `em` gemessen, daher hängt die Zeilenlänge in *Zeichen* von der Schrift ab: Bei 50em fasst eine lateinische Zeile etwa 90–100 Zeichen (rund das Doppelte des typografischen Maßes von 45–75 Zeichen, was zu einem zweispaltigen Editor passt), während eine CJK-Zeile etwa 50 Vollbreitenzeichen fasst — genau im traditionellen Bereich von 40–60 für chinesischen Text. Wenn Sie überwiegend lateinische Prosa schreiben und ein buchähnliches Maß wünschen, wählen Sie 36–42em; für überwiegend CJK-Dokumente ist der Standard bereits das klassische Maß.
:::

::: tip
50em bei 18px Schriftgröße entspricht etwa 900px — eine angenehme Lesebreite für die meisten Displays.
:::

### Verhalten

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Tab-Größe | Anzahl der Leerzeichen beim Drücken von Tab | 2 Leerzeichen | 2 Leerzeichen, 4 Leerzeichen |
| Dateien in neuem Tab öffnen | Vorhandene Dateien in einem neuen Tab öffnen, statt den aktuellen leeren Tab wiederzuverwenden | Aus | Ein / Aus |
| Auto-Pairing aktivieren | Automatisch passende schließende Klammern und Anführungszeichen einfügen, wenn Sie ein öffnendes Zeichen eingeben | Ein | Ein / Aus |
| CJK-Klammern | CJK-spezifische Klammern wie `「」` `【】` `《》` automatisch pairen. Nur verfügbar, wenn Auto-Pairing aktiviert ist | Auto | Aus, Auto |
| Typografische Anführungszeichen einschließen | `“”` und `‘’` automatisch pairen und ein getipptes gerades `"` oder `'` in ein typografisches Paar umwandeln. Kann mit einigen IME-Smartquote-Funktionen in Konflikt geraten. Erscheint, wenn CJK-Klammern auf Auto steht | Ein | Ein / Aus |
| Auch `"` pairen | Das Eingeben des rechten doppelten Anführungszeichens `"` fügt ebenfalls ein `""`-Paar ein. Nützlich, wenn Ihr IME zwischen öffnenden und schließenden Anführungszeichen wechselt. Erscheint, wenn typografische Anführungszeichen aktiviert sind | Aus | Ein / Aus |
| Kopierformat | Welches Format für den reinen Text-Zwischenablageplatz beim Kopieren aus dem WYSIWYG-Modus verwendet wird | Reiner Text | Reiner Text, Markdown |
| Bei Auswahl kopieren | Text automatisch in die Zwischenablage kopieren, wenn Sie ihn auswählen | Aus | Ein / Aus |

### Leerzeichen

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Zeilenenden beim Speichern | Steuert, wie Zeilenenden beim Speichern von Dateien behandelt werden | Bestehende erhalten | Bestehende erhalten, LF (`\n`), CRLF (`\r\n`) |
| Zeilenumbrüche werden zu harten Umbrüchen | Einzelne Zeilenumbrüche innerhalb eines Absatzes als harte Umbrüche behandeln (wirkt sich nicht auf Leerzeilen zwischen Blöcken aus) | Aus | Ein / Aus |
| Aufeinanderfolgende Zeilenumbrüche erhalten | Mehrere Leerzeilen so lassen, anstatt sie zu reduzieren | Ein | Ein / Aus |
| Harter Zeilenumbruch-Stil beim Speichern | Wie harte Zeilenumbrüche in der gespeicherten Markdown-Datei dargestellt werden | Bestehende erhalten | Zwei Leerzeichen (Empfohlen), Bestehende erhalten, Backslash (`\`) |
| `<br>`-Tags anzeigen | HTML-Zeilenumbruch-Tags sichtbar im Editor anzeigen | Aus | Ein / Aus |
| Unsichtbare anzeigen | Leerraum sichtbar machen: Leerzeichen als `·`, Tabs als `→` (nur Quelltext), weiche Zeilenumbrüche als `↓` (nur Quelltext), harte Zeilenumbrüche als `⏎`. Beim Drucken ausgeblendet. Umschalten: `F3` oder Ansicht → Unsichtbare Zeichen anzeigen. | Aus | Ein / Aus |

::: tip
Zwei Leerzeichen ist der kompatabelste Stil für harte Zeilenumbrüche — er funktioniert auf GitHub, GitLab und allen wichtigen Markdown-Renderern. Der Backslash-Stil kann auf Reddit, Jekyll und einigen älteren Parsern fehlschlagen.
:::

### Große Dateien

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Auto-Quellmodus | Große Dateien im Quellmodus öffnen — Dateien über 1 MB oder Markdown mit 1.200+ geschätzten Blöcken (überspringt WYSIWYG für flüssige Performance). Über die Statusleiste können Sie jederzeit zu WYSIWYG wechseln | Ein | Ein / Aus |
| Warnen ab Größe | Vor dem Öffnen von Dateien über 5 MB einen Bestätigungsdialog anzeigen. Dateien ab 50 MB werden immer abgelehnt | Ein | Ein / Aus |

Siehe [Große Dateien](/de/guide/large-files) für die vollständige Aufschlüsselung des Umgangs mit großen Dateien.

## Markdown

Einfüge-Verhalten, Layout und HTML-Rendering-Einstellungen.

### Einfügen & Eingabe

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Regex in Suche aktivieren | Zeigt eine Regex-Umschalter-Schaltfläche in der Suchen & Ersetzen-Leiste | Ein | Ein / Aus |
| Einfügemodus | Wie Inhalte aus der Zwischenablage beim Einfügen verarbeitet werden. **Smart** konvertiert HTML in Markdown und erkennt Markdown-Syntax; **Klartext** fügt immer reinen Text ein; **Rich** behält die ursprüngliche HTML-Formatierung bei | Smart | Smart, Klartext, Rich |
| Markdown-Einfügen in WYSIWYG | Wenn Text, der wie Markdown aussieht, in den WYSIWYG-Editor eingefügt wird, automatisch in Rich-Content konvertieren | Auto | Auto, Aus |

### Layout

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Quelle/Vorschau standardmäßig teilen | Markdown-Dateien in der geteilten Ansicht mit Quelltext und Live-Vorschau nebeneinander öffnen (sonst WYSIWYG). Pro Sitzung umschalten mit `Umschalt + F6` oder **Ansicht → Markdown-Splitansicht** | Aus | Ein / Aus |
| Block-Element-Schriftgröße | Relative Schriftgröße für Listen, Blockzitate, Tabellen, Hinweise und Details-Blöcke | 100% | 100%, 95%, 90%, 85% |
| Überschriften-Ausrichtung | Textausrichtung für Überschriften. Nur im Editor — gilt nicht für Export oder Druck | Links | Links, Zentriert |
| Bild- und Diagramm-Ränder | Ob ein Rand um Bilder, Mermaid-Diagramme und Mathematik-Blöcke angezeigt wird. Nur im Editor — gilt nicht für Export oder Druck | Keiner | Keiner, Immer, Beim Hover |
| Bild- und Tabellen-Ausrichtung | Horizontale Ausrichtung für Block-Bilder und Tabellen. Nur im Editor — gilt nicht für Export oder Druck | Zentriert | Zentriert, Links |
| Tabellen an Breite anpassen | Alle Tabellen auf die Editorbreite beschränken, statt horizontales Scrollen zu erlauben | Aus | Ein / Aus |
| Zeilennummern in Codeblöcken | Zeilennummern in Codeblöcken im WYSIWYG-Editor anzeigen. Unabhängig von **Zeilennummern** im Menü Ansicht, das den Rand des Quelltext-/Split-Editors steuert | Aus | Ein / Aus |

### Lint

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Markdown-Lint aktivieren | Auf häufige Markdown-Probleme prüfen (defekte Links, fehlender Alt-Text, Überschriftenhierarchie, nicht geschlossene Umzäunungen usw.) | Ein | Ein / Aus |

Siehe [Markdown-Lint](/de/guide/lint) für die vollständige Regelliste und Schweregrade.

### HTML-Rendering

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Rohes HTML im Rich-Text | Steuert, ob rohe HTML-Blöcke im WYSIWYG-Modus gerendert werden | Bereinigt | Versteckt, Bereinigt, Bereinigt + Stile |
| Erlaubte HTML-Tags | Wie umfangreich der Satz gerenderter Tags ist | Streng | Streng, Erweitert |
| Diese Tags zusätzlich erlauben | Zusätzlich erlaubte Tag-Namen, kommagetrennt | _(leer)_ | z. B. `kbd, samp, var` |

::: tip
**Versteckt** klappt rohes HTML ein und rendert nichts. **Bereinigt** rendert HTML mit entfernten gefährlichen Tags. **Bereinigt + Stile** behält zusätzlich eine sichere Teilmenge von Inline-`style`-Attributen bei.

**Streng** erlaubt einen kleinen, konservativen Satz von Tags. **Erweitert** rendert zusätzlich `<svg>` (und seine sicheren Kindelemente), `<figure>`/`<figcaption>`, `<details>`/`<summary>` und weitere semantische/strukturelle Tags — alle weiterhin bereinigt. Mit **Diese Tags zusätzlich erlauben** fügen Sie gezielt weitere hinzu (z. B. `kbd, samp, var`).
:::

::: warning
Unabhängig von diesen Einstellungen werden gefährliche Tags (`<script>`, `<style>`, `<iframe>`, `<form>`, Event-Handler, …) **immer** entfernt — das Feld für zusätzliche Tags kann sie nicht wieder aktivieren. Der Umfang der Erlaubnisliste wirkt sich nur auf die WYSIWYG-Vorschau aus; das rohe HTML in Ihrer Datei wird nie verändert.
:::

## Dateien & Bilder

Dateibrowser, Speichern, Dokumentverlauf, Bildbehandlung und Dokumentwerkzeuge.

### Arbeitsbereich

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Arbeitsbereichsleiste | Die linke Arbeitsbereichsleiste anzeigen und mehrere Arbeitsbereiche und lose Dateien in einem Fenster halten | Aus |

Was die Leiste hinzufügt, erfahren Sie unter [Workspace-Leiste](/de/guide/workspace-rail).

### Dateibrowser

Die ersten beiden Einstellungen gelten nur, wenn ein Arbeitsbereich (Ordner) geöffnet ist, und werden pro Arbeitsbereich gespeichert.

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Versteckte Dateien anzeigen | Dotfiles und versteckte Systemelemente in der Datei-Explorer-Seitenleiste einschließen | Aus |
| Alle Dateien anzeigen | Nicht-Markdown-Dateien im Datei-Explorer anzeigen. Nicht-Markdown-Dateien werden mit der Standardanwendung Ihres Systems geöffnet | Aus |
| Dateiendungen anzeigen | Den vollständigen Dateinamen — `notes.md`, nicht `notes` — in der Seitenleiste, der Tableiste und der Titelleiste anzeigen. Gilt überall, mit oder ohne Arbeitsbereich | Ein |

Das Ausschalten von **Dateiendungen anzeigen** blendet nur Endungen aus, die VMark
erkennt. Eine Datei, die es nicht öffnen kann, behält ihre Endung in jedem Fall,
sodass der angezeigte Name immer auf der Festplatte existiert.

### Beenden-Verhalten

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Beenden bestätigen | Erfordert zweimaliges Drücken von `Cmd+Q` (oder `Strg+Q`) zum Beenden, um versehentliche Beendigungen zu verhindern | Ein |
| Beim Schließen in den Infobereich minimieren | **Nur Windows.** Das Schließen des letzten Fensters lässt VMark im Infobereich weiterlaufen, statt es zu beenden | Aus |

**Beim Schließen in den Infobereich minimieren** betrifft nur das *letzte* Fenster. Sind mehrere Fenster geöffnet, wird ein Fenster beim Schließen weiterhin geschlossen; erst das letzte Schließen — dasjenige, das VMark bisher beendet hat — parkt es nun stattdessen im Infobereich. Es wird nichts geschlossen, ungespeicherte Arbeit bleibt also genau dort, wo Sie sie gelassen haben.

- **Linksklick** auf das Symbol im Infobereich holt VMark zurück.
- **Rechtsklick** darauf bietet **VMark anzeigen** und **VMark beenden**. Beim Beenden aus dem Infobereich wird zuerst das Fenster zurückgeholt, sodass eine Rückfrage zu ungespeicherten Änderungen dort erscheint, wo Sie sie beantworten können.
- `Strg+Q` beendet weiterhin wie gewohnt.
- Wird die Einstellung ausgeschaltet, während VMark im Infobereich liegt, wird das Fenster zurückgeholt, bevor das Symbol verschwindet; VMark kann also nie ohne Fenster und ohne Symbol weiterlaufen.

Unter macOS und Linux erscheint die Einstellung nicht.

### Speichern

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Autospeichern aktivieren | Dateien nach der Bearbeitung automatisch speichern | Ein | Ein / Aus |
| Identitätsblock beim Speichern einfügen | Erlaubt VMark, einen `vmark:`-Identitätsblock in das Frontmatter einer Datei einzufügen und einen `.vmark`-Ordner im Arbeitsbereich anzulegen, damit die Kohärenz-Ebene das Dokument verfolgen kann. Das gilt für jeden Schreibvorgang — Speichern, KI- und MCP-Bearbeitungen, das Zurücksetzen auf frühere Versionen und neue Dateien. Wenn aus, wird nichts eingefügt und kein `.vmark`-Ordner angelegt; ein Arbeitsbereich, der bereits einen hat, zeichnet weiterhin Änderungen an den Dokumenten auf, die er verfolgt — an einem Dokument, das er bereits aufgezeichnet hat, oder an einem, das schon eine eigene `vmark:`-Identität trägt, etwa einer verfolgten Datei, die Sie verschoben oder ausgecheckt haben. Siehe [Kohärenz](/de/guide/coherence#so-funktioniert-es-30-sekunden) | Aus | Ein / Aus |
| Speicherintervall | Zeit zwischen automatischen Speicherungen. Nur verfügbar, wenn Autospeichern aktiviert ist | 30 Sekunden | 10s, 30s, 1 Min., 2 Min., 5 Min. |
| Dokumentverlauf speichern | Dokumentversionen für Rückgängig und Wiederherstellung verfolgen | Ein | Ein / Aus |
| Maximale Versionen | Anzahl der Verlaufs-Snapshots pro Dokument | 50 Versionen | 10, 25, 50, 100 |
| Versionen behalten für | Maximales Alter von Verlaufs-Snapshots, bevor sie bereinigt werden | 7 Tage | 1 Tag, 7 Tage, 14 Tage, 30 Tage |
| Zusammenführungsfenster | Aufeinanderfolgende Autospeicherungen innerhalb dieses Fensters werden in einem einzigen Snapshot zusammengefasst | 30 Sekunden | Aus, 10s, 30s, 1 Min., 2 Min. |
| Maximale Dateigröße für Verlauf | Verlaufs-Snapshots der automatischen Speicherung für Dateien überspringen, die größer als dieser Schwellenwert sind. Manuelle Speicherungen, MCP-Speicherungen und die Sicherheitskopie vor dem Wiederherstellen einer Version werden immer behalten | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Unbegrenzt |

### Bilder

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Beim Einfügen automatisch skalieren | Große Bilder vor dem Speichern im Asset-Ordner automatisch skalieren. Der Wert ist die maximale Dimension in Pixeln | Aus | Aus, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| In Asset-Ordner kopieren | Eingefügte oder gezogene Bilder in den Asset-Ordner des Dokuments kopieren, anstatt sie einzubetten | Ein | Ein / Aus |
| Unbenutzte Bilder beim Schließen bereinigen | Bilder aus dem Asset-Ordner automatisch löschen, die das Dokument nicht mehr referenziert. Läuft beim Schließen des Dokuments, des Fensters oder der App. Bilder, die noch von einem anderen Dokument im selben Ordner referenziert werden, bleiben erhalten; entfernte Bilder wandern in den System-Papierkorb | Aus | Ein / Aus |

::: tip
Aktivieren Sie **Beim Einfügen automatisch skalieren**, wenn Sie häufig Screenshots oder Fotos einfügen — es hält Ihren Asset-Ordner ohne manuelles Skalieren leichtgewichtig.
:::

### Dokumentwerkzeuge

VMark erkennt [Pandoc](https://pandoc.org), um den Export in zusätzliche Formate zu ermöglichen (DOCX, EPUB, LaTeX und mehr). Klicken Sie auf **Erkennen**, um Pandoc auf Ihrem System zu suchen. Wenn gefunden, werden Version und Pfad angezeigt.

Unter [Export & Drucken](/de/guide/export) finden Sie Details zu allen Exportoptionen.

## Integrationen

MCP-Server- und KI-Anbieter-Konfiguration.

### MCP-Server

Der MCP-Server (Model Context Protocol) ermöglicht externen KI-Assistenten wie Claude Code und Cursor, VMark programmatisch zu steuern.

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| MCP-Server aktivieren | MCP-Server starten oder stoppen. Wenn er läuft, zeigt ein Status-Badge den Port und verbundene Clients | Ein (Umschalter) |
| Beim Start beginnen | Den MCP-Server beim Öffnen von VMark automatisch starten | Ein |
| Speichern an neuem Ort und Genie-Ergebnisse automatisch genehmigen | Einem MCP-Client erlauben, ein Dokument ohne Rückfrage an einem neuen Ort zu speichern, und ein Genie sein Ergebnis direkt anwenden lassen, statt eine Vorschau anzuzeigen. Wenn aus, wird eine MCP-Anfrage zum Speichern unter einem neuen Pfad abgelehnt, und eine Toast-Meldung informiert Sie. MCP-Schreibvorgänge in Dokumente werden hiervon nie blockiert — jeder wird im Agenten-Bearbeitungsverlauf festgehalten und lässt sich über den MCP-Schreibverlauf in der Statusleiste wiederherstellen | Aus |

Wenn der Server läuft, zeigt der Bereich auch:
- **Port** — automatisch zugewiesen; KI-Clients erkennen ihn über die Konfigurationsdatei
- **Version** — MCP-Server-Sidecar-Version
- **Werkzeuge / Ressourcen** — Anzahl der verfügbaren MCP-Werkzeuge und Ressourcen
- **Verbundene Clients** — Anzahl der aktuell verbundenen KI-Clients

Unterhalb des MCP-Server-Abschnitts können Sie VMark's MCP-Konfiguration mit einem einzigen Klick in unterstützte KI-Clients (Claude Desktop, Claude Code, Codex CLI, Gemini CLI) installieren.

Unter [MCP-Setup](/de/guide/mcp-setup) und [MCP-Werkzeuge Referenz](/de/guide/mcp-tools) finden Sie vollständige Details.

### KI-Anbieter

Konfigurieren Sie, welcher KI-Anbieter [KI-Genies](/de/guide/ai-genies) betreibt. Es kann jeweils nur ein Anbieter aktiv sein.

**CLI-Anbieter** — Verwenden Sie lokal installierte KI-CLI-Werkzeuge (Claude, Codex, Gemini). Klicken Sie auf **Erkennen**, um Ihren `$PATH` nach verfügbaren CLIs zu durchsuchen. CLI-Anbieter verwenden Ihren Abonnement-Plan und benötigen keinen API-Schlüssel.

**REST-API-Anbieter** — Verbinden Sie sich direkt mit einer API: Anthropic, OpenAI, einem **OpenAI-kompatiblen** Dienst (DeepSeek, Groq, OpenRouter, …), Google AI oder einem lokalen Ollama-Server (Ollama API). Jeder benötigt einen Modellnamen und einen API-Schlüssel — außer Ollama, wo der Schlüssel optional ist. Alle außer Google AI verwenden außerdem einen Endpunkt, der vorausgefüllt ist, wo der Anbieter einen Standard hat (der OpenAI-kompatible Eintrag hat keinen, daher geben Sie ihn selbst ein).

Unter [KI-Anbieter](/de/guide/ai-providers) finden Sie detaillierte Setup-Anweisungen für jeden Anbieter.

## Formate

Opt-in-Umschalter für nicht standardmäßige Format-Adapter sowie der explizite Befehl für den externen Editor als Ausstiegsmöglichkeit aus dem schreibgeschützten Code-Tab.

Markdown, Klartext und YAML/YML sind **immer** registriert — die ruhigen Standardwerte. Alle anderen Adapter sind **standardmäßig deaktiviert**, damit bestehende Benutzer beim Upgrade nicht überrascht werden. Schalten Sie einen Umschalter um, und die Registry wird sofort neu aufgebaut; geöffnete Tabs werden mit dem passenden Adapter neu gemountet — kein Neustart erforderlich.

Die vollständige Liste der Formate und ihrer Vorschauen finden Sie unter [Unterstützte Formate](/de/guide/formats).

### Formatunterstützung

| Umschalter | Standard | Aktiviert |
|---|---|---|
| **Datenformate** | Aus | `.json`, `.jsonl`, `.toml` — geteilter Bereich: Quelle + navigierbarer Baum. Schemagestützte Vorschauen für `Cargo.toml`, `package.json`, `pyproject.toml`. |
| **Diagramme & SVG** | Aus | `.mmd` (Mermaid) und `.svg` — geteilter Bereich: Quelle + bereinigtes Live-Rendering. |
| **HTML-Vorschau** | Aus | `.html` und `.htm` — sandboxed iframe-Vorschau (leeres `sandbox=""`, DOMPurify, CSP `<meta>`). Die Sicherheitsfreigabe steht noch aus, und die Vorschau weist darauf hin — siehe [Sicherheitsmodell für HTML](/de/guide/formats#sicherheitsmodell-fur-html). |
| **Code-Betrachter** | Aus | 12 schreibgeschützte Betrachter (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Öffnet in einem syntaxhervorgehobenen Betrachter mit den Schaltflächen **Bearbeitung aktivieren** und **In externem Editor öffnen**. |

Wenn eine Kategorie deaktiviert ist, fallen die zugehörigen Erweiterungen auf den Klartext-Fallback zurück, sodass die Datei trotzdem geöffnet wird — nur ohne Schemaansicht.

### Standard-Ansichtsmodus

Dateien mit Vorschau (HTML, SVG, Mermaid, JSON, YAML, TOML) öffnen sich in einem von drei
[Ansichtsmodi](/de/guide/formats#ansichtsmodi-quelltext-geteilt-vorschau):

| Option | Ergebnis |
|---|---|
| **Quelltext** | Bearbeitbarer Quelltextbereich, volle Breite. |
| **Geteilt** (Standard) | Quelltext und Vorschau nebeneinander. |
| **Vorschau** | Schreibgeschützte Darstellung, volle Breite. |

Das ist der Standard für neu geöffnete Tabs; jeder Tab merkt sich seine eigene Wahl,
und Sie können jeden Tab über den Umschalter auf dem Bildschirm oder mit `F6` / `Umschalt + F6` wechseln.

### Externer Editor

Für die Schaltfläche **In externem Editor öffnen** auf schreibgeschützten Code-Tabs wählen Sie den Editor, der gestartet werden soll: den Namen eines bekannten Editors (`code`, `zed`, `subl`, `vim`, …) oder den vollständigen Pfad eines App-Bundles (z. B. `/Applications/Visual Studio Code.app`) oder einer ausführbaren Datei. Shells, Interpreter und Terminal-Emulatoren werden abgelehnt, ebenso ein Pfad, der nicht existiert.

Die GUI-Einstellung überschreibt alle Umgebungsvariablen — explizit schlägt implizit. Lassen Sie das Feld leer, um die Fallback-Kette `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → Plattformstandard` zu nutzen. Unter [In externem Editor öffnen](/de/guide/formats#in-externem-editor-offnen) finden Sie die vollständige Auflösungsreihenfolge und Sicherheitsüberprüfung.

### Einmaliger Upgrade-Hinweis

Beim ersten Start nach dem Upgrade auf die Mehrformat-Unterstützung zeigt VMark einen nicht blockierenden Toast, der auf **Einstellungen → Formate** hinweist. Der Hinweis erscheint einmal pro Installation — nach dem Anzeigen (oder Verwerfen) erscheint er nie wieder.

### Dateityp-Überschreibungen

Über die Kategorie-Umschalter hinaus können Sie über die Befehlspalette festlegen, wie eine einzelne Dateifamilie geöffnet wird — **Dateityp festlegen: Nur-Text / Markdown / Auf Standard zurücksetzen**. Überschreibungen werden pro Dateifamilie gespeichert (nach Endung oder, bei Dateien wie `.env`, nach dem Namen der Punktdatei) und bleiben über Sitzungen hinweg erhalten. Siehe [Wie VMark den Dateityp bestimmt](/de/guide/formats#wie-vmark-den-dateityp-bestimmt).

Der Bereich **Formate** listet jede von Ihnen festgelegte Überschreibung als `key → format` auf. Entfernen Sie einen einzelnen Eintrag mit seiner `×`-Schaltfläche, oder verwerfen Sie mit **Alle löschen** alle auf einmal — entfernte Einträge fallen auf die integrierte Regel zurück.

## Sprache

Die Oberflächensprache sowie die Formatierungsregeln für CJK (Chinesisch, Japanisch, Koreanisch).

### Oberflächensprache

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Oberflächensprache | Ändert die UI-Sprache für Menüs, Beschriftungen und Meldungen. Wird sofort wirksam | Systemsprache | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

Beim ersten Start wählt VMark die erste Sprache aus der bevorzugten Sprachliste Ihres Systems, die VMark mitliefert, und greift auf Englisch zurück, wenn keine passt. Sobald Sie hier eine Sprache wählen, bleibt Ihre Wahl erhalten.

### CJK-Formatierung

Die folgenden Regeln werden angewendet, wenn Sie **Format → CJK → Auswahl formatieren** (`Cmd+Shift+F`) auf einer Auswahl oder **Format → CJK → Gesamte Datei formatieren** (`Alt+Cmd+Shift+F`) auf der gesamten Datei ausführen.

::: tip
Der Sprach-Abschnitt enthält 20+ feinkörnige Formatierungs-Umschalter. Eine vollständige Erklärung jeder Regel mit Beispielen finden Sie unter [CJK-Formatierung](/de/guide/cjk-formatting).
:::

### Vollbreite-Normalisierung

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Vollbreite Buchstaben/Zahlen konvertieren | Vollbreite alphanumerische Zeichen in Halbbreite konvertieren (z. B. `ＡＢＣ` zu `ABC`) | Ein |
| Interpunktionsbreite normalisieren | Vollbreite Kommas und Punkte in Halbbreite konvertieren, wenn sie zwischen CJK-Zeichen stehen | Ein |
| Klammern konvertieren | Vollbreite Klammern in Halbbreite konvertieren, wenn der Inhalt CJK ist | Ein |
| Eckige Klammern konvertieren | Halbbreite eckige Klammern in Vollbreite `【】` konvertieren, wenn der Inhalt CJK ist | Aus |

### Abstände

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| CJK-Englisch-Abstände hinzufügen | Ein Leerzeichen zwischen CJK- und lateinischen Zeichen einfügen | Ein |
| CJK-Klammern-Abstände hinzufügen | Ein Leerzeichen zwischen CJK-Zeichen und Klammern einfügen | Ein |
| Währungsabstände entfernen | Zusätzlichen Abstand nach Währungssymbolen entfernen (z. B. `$ 100` wird zu `$100`) | Ein |
| Schrägstrich-Abstände entfernen | Leerzeichen um Schrägstriche entfernen (z. B. `A / B` wird zu `A/B`), URLs erhalten bleiben | Ein |
| Mehrere Leerzeichen reduzieren | Mehrere aufeinanderfolgende Leerzeichen auf ein einzelnes reduzieren | Ein |

### Gedankenstriche & Anführungszeichen

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Bindestriche konvertieren | Doppelte Bindestriche (`--`) zwischen CJK-Zeichen in Gedankenstriche (`——`) konvertieren | Ein |
| Gedankenstrich-Abstände korrigieren | Korrekte Abstände um Gedankenstriche sicherstellen | Ein |
| Gerade Anführungszeichen konvertieren | Gerade `"` und `'` in typografische (gebogene) Anführungszeichen konvertieren | Ein |
| Anführungsstil | Zielstil für die Konvertierung typografischer Anführungszeichen | Gebogen `""` `''` |
| Kontextbezogene Anführungszeichen | Typografische Anführungszeichen um CJK-Text verwenden, in reinem lateinischem Text aber gerade Anführungszeichen beibehalten. Nur verfügbar, wenn „Gerade Anführungszeichen konvertieren“ aktiviert ist | Ein |
| Verhalten beim Umschalten von Anführungszeichen | Wie der Umschaltbefehl für den Anführungszeichen-Stil zwischen den Stilen wechselt — **Einfach** tauscht gerade ↔ Ihren bevorzugten Stil; **Vollständiger Zyklus** durchläuft alle Stile | Einfach |
| Doppelte Anführungszeichen-Abstände korrigieren | Abstände um doppelte Anführungszeichen normalisieren | Ein |
| Einfache Anführungszeichen-Abstände korrigieren | Abstände um einfache Anführungszeichen normalisieren | Ein |
| CJK-Eckanführungszeichen | Gebogene Anführungszeichen für traditionellen chinesischen und japanischen Text in eckige Klammern `「」` konvertieren. Nur verfügbar, wenn Anführungsstil Gebogen ist | Aus |
| Verschachtelte Eckanführungszeichen | Verschachtelte einfache Anführungszeichen in `『』` innerhalb von `「」` konvertieren | Aus |

### Abschnittsbehandlung

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Referenzabschnitte überspringen | Abschnitte `## References` und `## Further Reading` bei der CJK-Formatierung unformatiert lassen — nützlich für wissenschaftliche Dokumente, in denen Zitattext wörtlich erhalten bleiben soll | Aus | Ein / Aus |

### Bereinigung

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Aufeinanderfolgende Interpunktion begrenzen | Wiederholte Satzzeichen wie `!!!` begrenzen | Aus | Aus, Einfach (`!!` zu `!`), Doppelt (`!!!` zu `!!`) |
| Abschließende Leerzeichen entfernen | Leerzeichen am Zeilenende entfernen | Ein | Ein / Aus |
| Auslassungspunkte normalisieren | Punkte mit Abstand (`. . .`) in korrekte Auslassungspunkte (`...`) konvertieren | Ein | Ein / Aus |
| Neue Zeilen reduzieren | Drei oder mehr aufeinanderfolgende neue Zeilen auf zwei reduzieren | Aus | Ein / Aus |

## Tastaturkürzel

Alle Tastaturkürzel anzeigen und anpassen. Tastaturkürzel sind nach Kategorien gruppiert (Datei, Bearbeiten, Ansicht, Format usw.).

- **Suche** — Tastaturkürzel nach Name, Kategorie oder Tastenkombination filtern
- **Auf ein Tastaturkürzel klicken**, um seine Tastenbindung zu ändern. Neue Kombination drücken, dann bestätigen
- **Zurücksetzen** — Ein einzelnes Tastaturkürzel auf seinen Standard zurücksetzen oder alle auf einmal zurücksetzen
- **Exportieren / Importieren** — Benutzerdefinierte Bindungen als JSON-Datei speichern und auf einem anderen Computer importieren

Unter [Tastaturkürzel](/de/guide/shortcuts) finden Sie die vollständige Standard-Tastaturkürzel-Referenz.

## Terminal

Konfigurieren Sie das integrierte Terminal-Panel. Öffnen Sie das Terminal mit `` Strg + ` ``.

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Shell | Welche Shell verwendet werden soll. Erfordert einen Terminal-Neustart, um wirksam zu werden. Eine gespeicherte Shell, die nicht mehr verfügbar ist, erscheint als *(nicht verfügbar)*, und der Standard wird verwendet | Systemstandard | Automatisch erkannte Shells auf Ihrem System (z. B. zsh, bash, fish) |
| Panel-Position | Wo das Terminal-Panel platziert werden soll | Auto | Auto (basierend auf Fenster-Seitenverhältnis), Oben, Unten, Links, Rechts |
| Panel-Größe | Anteil des verfügbaren Platzes, den das Terminal einnimmt. Das Panel durch Ziehen zu ändern aktualisiert diesen Wert ebenfalls | 40% | 10% bis 80% |
| Schriftgröße | Textgröße im Terminal | 13px | 10px bis 24px |
| Zeilenhöhe | Vertikaler Abstand zwischen Terminalzeilen | 1,2 (Kompakt) | 1,0 (Eng) bis 2,0 (Extra) |
| Cursor-Stil | Form des Terminal-Cursors | Balken | Balken, Block, Unterstrichen |
| Cursor blinken | Ob der Terminal-Cursor blinkt | Ein | Ein / Aus |
| Bei Auswahl kopieren | Ausgewählten Terminaltext automatisch in die Zwischenablage kopieren | Aus | Ein / Aus |
| Gesprächsprotokolle automatisch darstellen | Claude/Codex-Markdown, Tabellen und Mermaid-Diagramme neben der Terminal-CLI darstellen. Fügt der Konfiguration von Claude Code und Codex einen lokalen SessionStart-Hook hinzu; laufende CLI-Sitzungen nach dem Aktivieren neu starten | Aus | Ein / Aus |
| WebGL-Renderer | GPU-beschleunigtes Rendering für das Terminal verwenden. Deaktivieren bei IME-Eingabeproblemen. Erfordert Terminal-Neustart. Nur macOS und Windows — Linux verwendet immer den DOM-Renderer | Ein | Ein / Aus |
| Zwischenablage aus der Ferne (OSC 52) | Programmen im Terminal — über ssh, in tmux — erlauben, in Ihre Systemzwischenablage zu kopieren. Der Kanal ist nur schreibend: Das Lesen der Zwischenablage wird immer verweigert, da jede im Terminal ausgegebene Ausgabe es anfordern könnte | Ein | Ein / Aus |
| Scrollback-Puffer | Anzahl der Ausgabezeilen, die jede Sitzung in ihrem Scrollverlauf behält. Höhere Werte benötigen mehr Speicher | 5.000 | 1.000 / 5.000 / 10.000 / 50.000 |
| Screenreader-Modus | Terminalausgabe für assistive Technologien (VoiceOver) zugänglich machen. Aus Leistungsgründen standardmäßig deaktiviert | Aus | Ein / Aus |

Zwei plattformspezifische Umschalter erscheinen hier ebenfalls, beide standardmäßig aktiviert: **Option als Meta-Taste** (nur macOS — behandelt die Option-Taste als Meta, wie es Werkzeuge wie emacs und tmux für `Alt`-präfigierte Tastenkürzel und die Wortnavigation erwarten; deaktivieren Sie sie, wenn Sie Option-Tottasten für Akzente wie `Option + E` benötigen) und **Shell-Integration** (unter Windows ausgeblendet — fügt zsh und bash Befehlsmarkierungen hinzu für Prompt-Navigation, Exit-Status-Markierungen und die Verfolgung des aktuellen Verzeichnisses; wirkt in neuen Terminal-Sitzungen).

### Barrierefreiheit

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Terminal-Glocke | Wie eine Terminal-Glocke (BEL) signalisiert wird. **Visuell** markiert Hintergrundaktivität auf dem Sitzungs-Tab; **Hörbar** spielt einen leisen Piepton ab und markiert (bei einer Hintergrundsitzung) zusätzlich den Tab, damit Sie ihn finden; **Aus** ignoriert sie. Gilt sofort für laufende Sitzungen | Visuell | Aus, Visuell, Hörbar |
| Benachrichtigen, wenn nicht fokussiert | Eine Systembenachrichtigung (mit dem Dokument des Fensters) anzeigen, wenn ein Terminal die Glocke auslöst, während das betreffende VMark-Fenster nicht fokussiert ist — z. B. wenn Claude Code eine Runde beendet. So behalten Sie Claude Code in mehreren Fenstern im Blick, ohne jedes einzelne zu beobachten. Erfordert bei der ersten Verwendung die Erlaubnis für Benachrichtigungen | Ein | Ein / Aus |
| Mindestkontrast | Blassen Terminaltext auf ein Mindestkontrastverhältnis zu seinem Hintergrund anheben. Erhöhen Sie den Wert für bessere Lesbarkeit; **Aus** deaktiviert die Anhebung. Gilt sofort für laufende Sitzungen | WCAG AA (4,5:1) | Aus, WCAG AA (4,5:1), WCAG AAA (7:1), Maximal |

Unter [Integriertes Terminal](/de/guide/terminal) finden Sie mehr über Sitzungen, Tastaturkürzel und Shell-Umgebung.

## Über

Zeigt App-Version, Links zur Website und zum GitHub-Repository sowie Update-Verwaltung. Der Link **Hinweise zu Drittanbietern** öffnet die Lizenztexte der mit VMark gebündelten Open-Source-Software in der Standard-App Ihres Systems für Textdateien.

### Updates

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Automatische Updates | Regelmäßig nach neuen Versionen suchen | Ein | Ein / Aus |
| Prüfhäufigkeit | Wie oft nach Updates gesucht wird. Nur verfügbar, wenn automatische Updates aktiviert sind | Beim Start | Beim Start, Täglich, Wöchentlich, Nur manuell |
| Updates automatisch herunterladen | Neue Versionen im Hintergrund herunterladen, sobald sie verfügbar sind | Aus | Ein / Aus |
| Jetzt prüfen | Manuell eine Update-Prüfung auslösen | — | — |

Wenn ein Update verfügbar ist, erscheint eine Karte mit der neuen Versionsnummer, dem Release-Datum und den Versionshinweisen. Sie können das Update **Herunterladen**, diese Version **Überspringen** oder — nach dem Download — **Zum Aktualisieren neu starten**.

#### Das Update entspricht der Art, wie Sie VMark installiert haben

Der Updater lädt dasselbe Paketformat herunter, das Sie installiert haben, und kein festes Format pro Plattform:

| Sie haben installiert | Der Updater lädt |
|---|---|
| macOS `.dmg` | das signierte App-Bundle |
| Windows `.exe` (NSIS) | das `.exe`-Installationsprogramm |
| Windows `.msi` | das `.msi`-Paket |
| Linux `.deb` | das `.deb`-Paket |
| Linux `.rpm` | das `.rpm`-Paket |
| Linux AppImage | das AppImage |

Unter Linux führt das Aktualisieren einer `.deb`- oder `.rpm`-Installation den Paketmanager des Systems aus, daher werden Sie zur Authentifizierung aufgefordert — die Installation eines Systempakets erfordert Root-Rechte. AppImage-Updates ersetzen die Datei an Ort und Stelle und benötigen keine Rückfrage.

#### Wenn ein Update hängen bleibt

Sowohl die Prüfung als auch der Download laufen über das Netzwerk, und eine Verbindung, die hängt, statt klar fehlzuschlagen, könnte das Update sonst endlos in Bearbeitung halten. Macht eine Prüfung eine Minute lang keinen Fortschritt, oder ein Download bzw. eine Installation drei Minuten lang, zeigt VMark im Dokumentfenster eine dauerhafte Benachrichtigung **Update hängt** an. Ihre Schaltfläche **Erneut versuchen** setzt den Updater in den Ruhezustand zurück, damit Sie es erneut versuchen können — **Jetzt prüfen** in diesem Abschnitt oder die nächste automatische Prüfung beginnt dann mit einer frischen Prüfung.

Update-Aktivitäten werden in die Protokolldatei geschrieben; tritt das Problem wiederholt auf, lohnt es sich daher, das Protokoll einem Fehlerbericht beizufügen:

| Plattform | Speicherort des Protokolls |
|---|---|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Zurücksetzen

| Einstellung | Beschreibung |
|-------------|-------------|
| Auf Standardwerte zurücksetzen | Die Einstellungen in diesen Bereichen auf ihre Standardwerte zurücksetzen. Zuvor erscheint eine Bestätigungsabfrage — dies kann nicht rückgängig gemacht werden |

Drei Dinge werden separat gespeichert und **nicht** zurückgesetzt: angepasste Tastaturkürzel (verwenden Sie **Alle zurücksetzen** im Bereich [Tastaturkürzel](#tastaturkurzel)), Ihre KI-Anbieter-Konfiguration und die Dateibrowser-Einstellungen pro Arbeitsbereich (**Versteckte Dateien anzeigen**, **Alle Dateien anzeigen**). Die Oberflächensprache kehrt zu Ihrer Systemsprache zurück.

## Erweitert

::: tip
Der Erweitert-Abschnitt ist standardmäßig sichtbar — er enthält den Ausschalter für den eingebetteten Browser, der aktiviert ausgeliefert wird. Drücken Sie `Strg + Option + Cmd + D` im Einstellungsfenster, um ihn auszublenden, und erneut, um ihn wieder anzuzeigen.
:::

Entwickler- und systemebene Konfiguration.

### Link-Protokolle

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Benutzerdefinierte Link-Protokolle | Zusätzliche URL-Protokolle, die VMark als Links behandelt. Jedes Protokoll als Tag eingeben | `obsidian`, `vscode`, `dict`, `x-dictionary` |

Die Liste bewirkt zweierlei. Beim Einfügen eines Links wird eine URL in der Zwischenablage mit einem dieser Protokolle als Link erkannt, genau wie `https://`. Und beim Öffnen eines Links übergibt VMark ihn nur dann an Ihr System, wenn sein Protokoll `http`, `https`, `mailto` ist oder in dieser Liste steht — so öffnen sich Links wie `obsidian://open?vault=...` und `vscode://file/...` in ihren Apps, während jedes andere Protokoll abgelehnt wird. Einige Protokolle lassen sich auf diesem Weg nie freischalten, egal was die Liste enthält: `javascript:`, `data:`, `file:` und ähnliche.

Ein entfernter Standardwert bleibt entfernt. Ein Standardprotokoll, das in einer späteren VMark-Version hinzukommt, wird beim ersten Start dieser Version einmalig zu Ihrer Liste hinzugefügt.

### Leistung

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Beide Editoren aktiv halten | Sowohl den WYSIWYG- als auch den Quellmodus-Editor gleichzeitig mounten, für schnelleres Moduswechseln. Erhöht den Speicherverbrauch | Aus |

### Kohärenz

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Konfidenz der semantischen Prüfung | Wie sicher eine Prüfung sein muss, bevor ihre Antwort als Urteil aufgezeichnet wird. Darunter wird die Antwort behalten, aber als unbekannt markiert | 0,9 | 0,7, 0,8, 0,9, 0,95 |

Was eine Prüfung ist und wie Urteile aufgezeichnet werden, erfahren Sie unter [Kohärenz](/de/guide/coherence).

### Workflow-Dateien

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Action-Metadaten abrufen | VMark erlauben, `action.yml` von referenzierten GitHub Actions abzurufen, um das `with:`-Formular des strukturierten Editors zu befüllen. Ausschalten, um den Workflow-Editor vollständig offline zu halten | Ein | Ein / Aus |
| actionlint verwenden, falls verfügbar | Liegt die Binärdatei `actionlint` in Ihrem PATH, wird sie für ausführlichere Diagnosen auf Workflow-Dateien ausgeführt. Ohne Wirkung, wenn die Binärdatei nicht installiert ist | Ein | Ein / Aus |

### Workflow

Der GitHub-Actions-Viewer hat keinen Schalter: Das Öffnen einer Datei unter
`.github/workflows/` zeigt den Graphen und den Formular-Editor, und die Hilfen im
Quellbereich (Ausdrucksvervollständigung, Cursor-Canvas-Synchronisierung,
Sprung zur Definition bei `uses:`) werden mit geladen. Was hier bleibt, ist die eine
Einstellung des Viewers und die separate Ausführungs-Engine.

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| YAML-Formatierung erhalten | Beim Speichern von Workflow-Bearbeitungen aus dem Formular-Panel die ursprünglichen YAML-Kommentare, Anker, Schlüsselreihenfolge und Leerzeilen über die CST-Roundtrip-Pipeline erhalten. Wenn aus, verwendet das Speichern einen kompakten Serialisierer (schneller, aber verlustbehaftet) | Ein | Ein / Aus |
| Workflow-Engine | VMarks eigene YAML-Workflow-Dateien ausführen: Eine Workflow-Datei öffnet sich mit ihrem Schritt-Graphen und einer Ausführen-/Abbrechen-Symbolleiste neben dem Quelltext, und Workflow-Genies können ausgeführt werden. Schritte können KI-Anbieter aufrufen und Dateien schreiben, daher bleibt die Engine aus, bis Sie sie ausdrücklich einschalten | Aus | Ein / Aus |

Die Engine ändert nichts an dem, was der Viewer anzeigt: GitHub-Actions-Dateien
öffnen sich in jedem Fall im Viewer, und bei ausgeschalteter Engine erscheint eine
VMark-Workflow-Datei als einfacher YAML-Baum. Bei ausgeschalteter Engine lehnt VMark
außerdem Anfragen zur Workflow-Ausführung grundsätzlich ab, statt nur die Schaltfläche
auszublenden — auch Anfragen, die über MCP eintreffen — und meldet „Die Workflow-Engine
ist in den Einstellungen deaktiviert“.

Beide Zeilen befinden sich unter **Entwickler-Tools** (siehe unten) — schalten Sie die
Entwickler-Tools ein, um sie anzuzeigen. Siehe [Workflow-Viewer](/de/guide/workflow-viewer)
für den Viewer und [Genie-Workflows](/de/guide/workflows) für die Engine.

### Eingebetteter Browser

| Einstellung | Beschreibung | Standard | Optionen |
|-------------|-------------|---------|---------|
| Eingebetteter Browser | Der Webbrowser in der App (nur macOS). Solange er aktiviert ist, steht **Neuer Browser-Tab** im Menü Datei und in der Befehlspalette, und die MCP-Werkzeuge `browser` sind verfügbar. Das Ausschalten schließt geöffnete Browser-Tabs und zieht die KI-Automatisierungsschnittstelle zurück | Ein | Ein / Aus |
| KI-Browsersitzung | Wählen Sie `Sandbox` (empfohlen, isolierte, nicht dauerhafte KI-Cookies) oder `Geteiltes Profil` (menschliches Profil mit Genehmigung von Zielen) | Sandbox | Sandbox / Geteilt |
| KI-Loopback-Zugriff erlauben | Erlaubt der KI die Navigation zu localhost und Loopback-Adressen. Private LAN-, Metadaten- und Link-Local-Bereiche bleiben blockiert | Aus | Ein / Aus |

Diese Einstellungen befinden sich unter **Erweitert → macOS** und erscheinen nur unter
macOS. Die beiden Zeilen zur KI-Haltung erscheinen nur, solange der Browser-Schalter
aktiviert ist, und werden davon nicht beeinflusst — sie bleiben auf Sandbox /
Loopback blockiert, bis Sie sie ändern. Den vollständigen Funktionsumfang finden Sie
unter [Eingebetteter Browser](/de/guide/browser).

### Plattformspezifisch

| Einstellung | Beschreibung | Standard | Plattformen |
|-------------|-------------|---------|-------------|
| macOS-Quarantäne beim Öffnen entfernen | Beim Öffnen eines Arbeitsbereichs das macOS-Download-Quarantäne-Attribut (`com.apple.quarantine`) vom Arbeitsbereichsordner und von den direkt darin liegenden Dateien entfernen, die VMark öffnen kann (Unterordner bleiben unberührt). Ohne dies kann macOS einen Finder-Doppelklick auf eine heruntergeladene Datei stillschweigend verwerfen, während VMark läuft. In der Oberfläche als **Download-Quarantäne beim Öffnen des Arbeitsbereichs entfernen** unter **Erweitert → macOS** | Ein | macOS |

Die Terminal-Einstellung **Option als Meta-Taste** befindet sich im Bereich [Terminal](#terminal).

### Entwicklerwerkzeuge

**Entwickler-Tools** ist ein dauerhaft gespeicherter Hauptschalter für experimentelle
und nur für die Entwicklung gedachte Einstellungen. Wenn Sie ihn einschalten, erscheinen
die Zeile **YAML-Formatierung erhalten**, der Schalter **Workflow-Engine** und ein Panel
**Hot-Exit-Entwicklerwerkzeuge** (Schaltflächen zum Testen von Sitzungserfassung,
Inspektion, Wiederherstellung, Löschen und Neustart). Da der Schalter gespeichert wird,
bleibt eine in Arbeit befindliche Funktion, die Sie aktivieren, über Sitzungen hinweg
und auch in Release-Builds erreichbar — Sie müssen die Entwickler-Tools nicht bei jedem
Öffnen der Einstellungen erneut aktivieren.

Außerdem macht er die [Wissensdatenbank](/de/guide/knowledge-base) außerhalb der
Einstellungen sichtbar: Der Menüpunkt **Ansicht → Wissensdatenbank**, der Befehl in der
Befehlspalette und das Tastenkürzel `Strg + Umschalt + 4` sind ausgeblendet, bis die
Entwickler-Tools aktiviert sind, denn kein Release-Build auf irgendeiner Plattform
liefert die Content-Server-Laufzeit mit, die diese Funktion benötigt.

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Entwickler-Tools | Entwicklermodus aktivieren und die experimentellen und nur für die Entwicklung gedachten Einstellungen unten anzeigen | Aus |

## Siehe auch

- [Funktionen](/de/guide/features) — Überblick über VMark's Fähigkeiten
- [Tastaturkürzel](/de/guide/shortcuts) — Vollständige Tastaturkürzel-Referenz
- [CJK-Formatierung](/de/guide/cjk-formatting) — Detaillierte CJK-Formatierungsregeln
- [Integriertes Terminal](/de/guide/terminal) — Terminal-Sitzungen und Verwendung
- [KI-Anbieter](/de/guide/ai-providers) — KI-Anbieter-Setup-Leitfaden
- [MCP-Setup](/de/guide/mcp-setup) — MCP-Server-Konfiguration für KI-Assistenten
