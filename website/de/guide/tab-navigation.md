# Intelligente Tab-Navigation

VMark's Tab- und Umschalt+Tab-Tasten sind kontextbewusst — sie helfen Ihnen, effizient durch formatierten Text, Klammern und Links zu navigieren, ohne die Pfeiltasten verwenden zu müssen.

> Mit der experimentellen [Arbeitsbereichsleiste](/de/guide/workspace-rail) umfassen das Durchschalten der Tabs und die Tab-Leiste nur die Tabs des aktiven Arbeitsbereichs.

## Kurzübersicht

| Kontext | Tab-Aktion | Umschalt+Tab-Aktion |
|---------|------------|---------------------|
| Innerhalb von Klammern `()` `[]` `{}` | Über schließende Klammer springen | Vor öffnende Klammer springen |
| Innerhalb von Anführungszeichen `""` `''` | Über schließendes Anführungszeichen springen | Vor öffnendes Anführungszeichen springen |
| Innerhalb von CJK-Klammern `「」` `『』` | Über schließende Klammer springen | Vor öffnende Klammer springen |
| Innerhalb von **Fett**, *Kursiv*, `Code`, ~~Durchgestrichen~~ | Nach der Formatierung springen | Vor die Formatierung springen |
| Innerhalb eines Links | Nach dem Link springen | Vor den Link springen |
| In einer Tabellenzelle | Zur nächsten Zelle wechseln | Zur vorherigen Zelle wechseln |
| In einem Listenelement | Element einrücken | Element ausrücken (hält auf der äußersten Ebene an) |

## Klammern- & Anführungszeichen-Escape

Wenn sich Ihr Cursor direkt vor einer schließenden Klammer oder einem Anführungszeichen befindet, springt Tab darüber. Wenn sich Ihr Cursor direkt nach einer öffnenden Klammer oder einem Anführungszeichen befindet, springt Umschalt+Tab davor zurück.

### Unterstützte Zeichen

**Standard-Klammern und Anführungszeichen:**
- Runde Klammern: `( )`
- Eckige Klammern: `[ ]`
- Geschweifte Klammern: `{ }`
- Doppelte Anführungszeichen: `" "`
- Einfache Anführungszeichen: `' '`
- Backticks: `` ` ``

**CJK-Klammern:**
- Vollbreite Klammern: `（ ）`
- Linsenförmige Klammern: `【 】`
- Eckige Klammern: `「 」`
- Weiße Eckklammern: `『 』`
- Doppelte Winkelklammern: `《 》`
- Winkelklammern: `〈 〉`

**Typografische Anführungszeichen:**
- Doppelte geschwungene Anführungszeichen: `" "`
- Einfache geschwungene Anführungszeichen: `' '`

### Funktionsweise

```text
function hello(world|)
                    ↑ Cursor vor )
```

**Tab** drücken:

```text
function hello(world)|
                     ↑ Cursor nach )
```

Dies funktioniert auch mit verschachtelten Klammern — Tab springt über das unmittelbar benachbarte schließende Zeichen.

**Umschalt+Tab** kehrt die Aktion um — wenn sich der Cursor direkt nach einem öffnenden Zeichen befindet:

```text
function hello(|world)
               ↑ Cursor nach (
```

**Umschalt+Tab** drücken:

```text
function hello|(world)
              ↑ Cursor vor (
```

### CJK-Beispiel

```text
这是「测试|」文字
         ↑ Cursor vor 」
```

**Tab** drücken:

```text
这是「测试」|文字
          ↑ Cursor nach 」
```

## Formatierungs-Escape (WYSIWYG-Modus)

Im WYSIWYG-Modus können Tab und Umschalt+Tab aus Inline-Formatierungszeichen herausspringen.

### Unterstützte Formate

- **Fett** Text
- *Kursiv* Text
- `Inline-Code`
- ~~Durchgestrichen~~
- Links

### Funktionsweise

Wenn sich Ihr Cursor irgendwo innerhalb von formatiertem Text befindet:

```text
This is **bold te|xt** here
                 ↑ Cursor innerhalb von Fett
```

**Tab** drücken:

```text
This is **bold text**| here
                     ↑ Cursor nach Fett
```

Umschalt+Tab funktioniert umgekehrt — es springt an den Anfang der Formatierung:

```text
This is **bold te|xt** here
                 ↑ Cursor innerhalb von Fett
```

**Umschalt+Tab** drücken:

```text
This is |**bold text** here
        ↑ Cursor vor Fett
```

### Link-Escape

Tab und Umschalt+Tab verlassen auch Links:

```text
Check out [VMark|](https://vmark.app)
               ↑ Cursor im Link-Text
```

**Tab** drücken:

```text
Check out [VMark](https://vmark.app)| and...
                                    ↑ Cursor nach Link
```

**Umschalt+Tab** innerhalb eines Links springt zum Anfang:

```text
Check out |[VMark](https://vmark.app) and...
          ↑ Cursor vor Link
```

## Link-Navigation (Quellmodus)

Im Quellmodus bietet Tab eine intelligente Navigation innerhalb der Markdown-Link-Syntax.

### Verschachtelte und maskierte Klammern

VMark verarbeitet komplexe Link-Syntax korrekt:

```markdown
[text [with nested] brackets](url)     ✓ Funktioniert
[text \[escaped\] brackets](url)       ✓ Funktioniert
[link](https://example.com/page(1))    ✓ Funktioniert
```

Die Tab-Navigation identifiziert Link-Grenzen korrekt, auch bei verschachtelten oder maskierten Klammern.

### Standardlinks

```markdown
[link text|](url)
          ↑ Cursor im Text
```

**Tab** drücken → Cursor bewegt sich zur URL:

```markdown
[link text](|url)
            ↑ Cursor in URL
```

**Tab** erneut drücken → Cursor verlässt den Link:

```markdown
[link text](url)|
                ↑ Cursor nach Link
```

### Wiki-Links

```markdown
[[page name|]]
           ↑ Cursor im Link
```

**Tab** drücken:

```markdown
[[page name]]|
             ↑ Cursor nach Link
```

## Quellmodus: Markdown-Zeichen-Escape

Im Quellmodus springt Tab auch über Markdown-Formatierungszeichen:

| Zeichen | Verwendung |
|---------|-----------|
| `*` | Fett/Kursiv |
| `_` | Fett/Kursiv |
| `^` | Hochgestellt |
| `~~` | Durchgestrichen (als Einheit gesprungen) |
| `==` | Hervorhebung (als Einheit gesprungen) |

### Beispiel

```markdown
This is **bold|** text
              ↑ Cursor vor **
```

**Tab** drücken:

```markdown
This is **bold**| text
                ↑ Cursor nach **
```

::: info
Im Quellmodus gibt es kein Umschalt+Tab-Escape für Markdown-Zeichen — Umschalt+Tab rückt nur aus (entfernt führende Leerzeichen).
:::

## Quellmodus: Auto-Paarung

Im Quellmodus wird beim Eingeben eines Formatierungszeichens automatisch sein schließendes Gegenstück eingefügt:

| Zeichen | Paarung | Verhalten |
|---------|---------|----------|
| `*` | `*\|*` oder `**\|**` | Verzögerungsbasiert — wartet 150ms, um einfach vs. doppelt zu erkennen |
| `~` | `~\|~` oder `~~\|~~` | Verzögerungsbasiert |
| `_` | `_\|_` oder `__\|__` | Verzögerungsbasiert |
| `=` | `==\|==` | Wird immer als doppelt gepaart |
| `` ` `` | `` `\|` `` | Einfacher Backtick wird nach Verzögerung gepaart |
| ` ``` ` | Code-Zaun | Dreifacher Backtick am Zeilenanfang erstellt einen umzäunten Code-Block |

Die Auto-Paarung ist **innerhalb von umzäunten Code-Blöcken deaktiviert** — das Eingeben von `*` in einem Code-Block fügt ein wörtliches `*` ohne Paarung ein.

Rücktaste zwischen einem Paar löscht beide Hälften: `*\|*` → Rücktaste → leer.

## Tabellennavigation

Wenn sich der Cursor innerhalb einer Tabelle befindet:

| Aktion | Taste |
|--------|-------|
| Nächste Zelle | Tab |
| Vorherige Zelle | Umschalt + Tab |
| Zeile hinzufügen (bei letzter Zelle) | Tab |

Tab bei der letzten Zelle der letzten Zeile fügt automatisch eine neue Zeile hinzu.

## Listeneinrückung

Wenn sich der Cursor in einem Listenelement befindet:

| Aktion | Taste |
|--------|-------|
| Element einrücken | Tab |
| Element ausrücken | Umschalt + Tab |

Ausrücken entfernt eine Verschachtelungsebene und **hält auf der äußersten Ebene an** — es
hebt ein Element nicht aus der Liste heraus. Um eine Liste ganz zu verlassen, verwenden Sie
**Liste entfernen** oder drücken Sie die Listen-Schaltfläche erneut, um sie auszuschalten.

## Einstellungen

Das Tab-Escape-Verhalten kann in **Einstellungen → Editor** angepasst werden:

| Einstellung | Auswirkung |
|-------------|-----------|
| **Klammern auto-paaren** | Klammern-Paarung und Tab-Escape aktivieren/deaktivieren |
| **CJK-Klammern** | CJK-Klammerpaare einschließen |
| **Geschwungene Anführungszeichen** | Geschwungene Anführungszeichen-Paare einschließen (`""` `''`) |

::: tip
Wenn Tab-Escape Ihrem Arbeitsablauf widerspricht, können Sie die automatische Klammern-Paarung vollständig deaktivieren. Tab fügt dann wie gewohnt Leerzeichen ein (oder rückt in Listen/Tabellen ein).
:::

## Vergleich: WYSIWYG vs. Quellmodus

| Funktion | Tab (WYSIWYG) | Umschalt+Tab (WYSIWYG) | Tab (Quelle) | Umschalt+Tab (Quelle) |
|----------|---------------|------------------------|--------------|----------------------|
| Klammern-Escape | ✓ | ✓ | ✓ | — |
| CJK-Klammern-Escape | ✓ | ✓ | ✓ | — |
| Geschwungene Anführungszeichen-Escape | ✓ | ✓ | ✓ | — |
| Zeichen-Escape (Fett usw.) | ✓ | ✓ | Nicht verfügbar | Nicht verfügbar |
| Link-Escape | ✓ | ✓ | ✓ (Feldnavigation) | — |
| Markdown-Zeichen-Escape (`*`, `_`, `~~`, `==`) | Nicht verfügbar | Nicht verfügbar | ✓ | — |
| Markdown-Auto-Paarung (`*`, `~`, `_`, `=`) | Nicht verfügbar | Nicht verfügbar | ✓ (verzögerungsbasiert) | Nicht verfügbar |
| Tabellennavigation | Nächste Zelle | Vorherige Zelle | Nicht verfügbar | Nicht verfügbar |
| Listeneinrückung | Einrücken | Ausrücken | Einrücken | Ausrücken |
| Mehrcursor-Unterstützung | ✓ | ✓ | ✓ | — |
| Innerhalb von Code-Blöcken übersprungen | ✓ | ✓ | ✓ | Nicht verfügbar |

## Mehrcursor-Unterstützung

Tab-Escape funktioniert mit mehreren Cursorn — jeder Cursor wird unabhängig verarbeitet.

### Funktionsweise

Wenn Sie mehrere Cursor haben und Tab oder Umschalt+Tab drücken:
- **Tab**: Cursor innerhalb von Formatierungen springen ans Ende; Cursor vor schließenden Klammern springen darüber
- **Umschalt+Tab**: Cursor innerhalb von Formatierungen springen zum Anfang; Cursor nach öffnenden Klammern springen davor
- Cursor im Klartext bleiben an ihrer Position

### Beispiel

```text
**bold|** and [link|](url) and plain|
     ^1          ^2            ^3
```

**Tab** drücken:

```text
**bold**| and [link](url)| and plain|
        ^1               ^2         ^3
```

Jeder Cursor springt unabhängig basierend auf seinem Kontext heraus.

::: tip
Dies ist besonders leistungsstark für Massenbearbeitungen — wählen Sie mehrere Vorkommen mit `Mod + D` aus und verwenden Sie dann Tab, um gleichzeitig aus allen herauszuspringen.
:::

## Priorität & Code-Block-Verhalten

### Escape-Priorität

Wenn mehrere Escape-Ziele überlappen, verarbeitet Tab diese **von innen nach außen**:

```text
**bold text(|)** here
               ↑ Tab springt ) zuerst (Klammer ist am tiefsten)
```

**Tab** erneut drücken:

```text
**bold text()**| here
               ↑ Tab verlässt Fett-Formatierung
```

Das bedeutet, dass der Klammer-Sprung immer vor dem Formatierungs-Escape ausgeführt wird — Sie können sich darauf verlassen, dass Tab zuerst Klammern verlässt, dann die Formatierung.

### Code-Block-Schutz

Tab- und Umschalt+Tab-Klammernsprünge sind **innerhalb von Code-Blöcken deaktiviert** — sowohl `code_block`-Knoten als auch Inline-Code-Spans. Dies verhindert, dass Tab in Code über Klammern springt, wo Klammern wörtliche Syntax sind:

```text
`array[index|]`
              ↑ Tab springt ] im Inline-Code NICHT — fügt stattdessen Leerzeichen ein
```

Die Auto-Paar-Einfügung ist auch innerhalb von Code-Blöcken für WYSIWYG- und Quellmodus deaktiviert.

## Tipps

1. **Muskelgedächtnis** — Sobald Sie sich an Tab-Escape gewöhnt haben, werden Sie viel schneller navigieren, ohne Pfeiltasten zu verwenden.

2. **Funktioniert mit Auto-Paarung** — Wenn Sie `(` eingeben, fügt VMark `)` automatisch ein. Nachdem Sie darin getippt haben, springt Tab einfach heraus.

3. **Verschachtelte Strukturen** — Tab springt eine Ebene nach der anderen heraus. Bei `((verschachtelt))` benötigen Sie zwei Tabs, um vollständig herauszuspringen.

4. **Umschalt + Tab** — Der Spiegel von Tab. Springt rückwärts aus Formatierungen, Links und öffnenden Klammern heraus. In Tabellen zur vorherigen Zelle. In Listen rückt es aus.

5. **Mehrcursor** — Tab-Escape funktioniert mit allen Ihren Cursorn gleichzeitig und macht Massenbearbeitungen noch schneller.

## Zwischen geöffneten Tabs wechseln

Tabs befinden sich in der Statusleiste am unteren Rand des Fensters. Es gibt drei Wege,
zwischen ihnen zu wechseln:

| Aktion | Tastenkürzel | Hinweise |
|---|---|---|
| Zuletzt verwendeter Tab | `Ctrl + Tab` | Springt zu dem Tab, in dem Sie vor diesem waren. Drücken Sie es erneut, um direkt zurückzukehren. |
| Nächster / vorheriger Tab | `Mod + Shift + ]` / `Mod + Shift + [` | Bewegt sich der Reihe nach entlang der Leiste, unabhängig davon, was Sie zuletzt verwendet haben. |
| Schnell öffnen | `Mod + O` | Tippen zum Filtern. Geöffnete Tabs stehen zuerst, der zuletzt verwendete ganz oben. |

**Zuletzt verwendeter Tab ist ein Umschalter, kein Durchlauf.** Er bringt Sie zu dem
Dokument, in dem Sie zuletzt waren, und ein zweites Drücken bringt Sie dorthin zurück, wo
Sie begonnen haben — der schnelle Weg, zwischen zwei Dateien zu arbeiten. Nächster und
vorheriger Tab durchlaufen die Leiste dagegen nach Position, was Sie wollen, wenn Sie etwas
suchen, statt dorthin zurückzukehren.

Er ist sowohl ein Menüeintrag als auch ein Tastenkürzel (**Ansicht → Zuletzt verwendeter
Tab**), weshalb er auch dann funktioniert, wenn der eingebettete Browser den Tastaturfokus hat.

### Wenn mehr Tabs geöffnet sind, als Platz haben

Die Tab-Leiste scrollt. Liegen Tabs jenseits eines Randes, wird die Leiste an diesem Rand
ausgeblendet und ein kleiner Pfeil erscheint — klicken Sie darauf, um eine Bildschirmbreite
weiterzuscrollen. Ein Tabwechsel auf beliebigem Weg scrollt den neuen Tab ebenfalls in den
sichtbaren Bereich, sodass der hervorgehobene Tab nie außerhalb des Bildschirms verborgen ist.

Die Leiste selbst ist per Tastatur erreichbar: Springen Sie mit Tab zu ihr und verwenden Sie
die Pfeiltasten.

## Zwei Dokumente nebeneinander

**Ansicht → Editor teilen — zwei Dokumente** (`Alt + Mod + \`) stellt ein zweites
Dokument neben das aktuelle. Um auszuwählen, welches Dokument, klicken Sie mit der rechten
Maustaste auf einen beliebigen Tab und wählen Sie **Seitlich öffnen**.

| Aktion | Tastenkürzel |
|---|---|
| Editor teilen — zwei Dokumente | `Alt + Mod + \` |
| Bereich schließen | `Alt + Mod + Shift + \` |
| Anderen Bereich fokussieren | `Alt + Mod + Shift + O` |
| Bildlauf synchronisieren | *(kein Standard)* |

Hinweise zum Verhalten:

- Der Tab, der im **anderen** Bereich angezeigt wird, ist in der Tab-Leiste mit einer
  dezenten Unterstreichung markiert, sodass Sie immer erkennen, welche zwei Dokumente auf dem
  Bildschirm sind und in welches Ihre Eingabe geht.
- **Wird eines der beiden geschlossen, fällt die Ansicht auf das andere zurück**, statt Sie
  zu einem unbeteiligten Tab springen zu lassen. Ihr verbleibendes Dokument bleibt, wo es ist.
- **Bildlauf synchronisieren** koppelt das Scrollen der beiden Bereiche proportional.
  Es ist standardmäßig aus und gilt pro Teilung.
- **Beide Bereiche teilen sich einen Ansichtsmodus.** Der Quelltextmodus (`F6`)
  schaltet beide Bereiche zugleich um, und der Wechsel zwischen den Bereichen behält den Modus bei.
- Zum Teilen müssen zwei Dokumente geöffnet sein. Browser-Tabs sind keine Dokumente, daher
  gilt die Teilung nicht für sie.

## Das Tab-Kontextmenü

Klicken Sie mit der rechten Maustaste auf einen Tab, um sein Menü zu öffnen. Pfeiltasten, Pos1 und Ende bewegen sich darin; Eingabe oder Leertaste führt einen Eintrag aus; Escape schließt es.

| Eintrag | Was er tut | Verfügbar, wenn |
|---|---|---|
| In neues Fenster verschieben | Verschiebt den Tab in ein neues Fenster, mit einem **Rückgängig** in der Bestätigung. Ein sekundäres Fenster, das leer zurückbleibt, wird geschlossen. | Das Dokument ist geladen und nicht der einzige Tab des Hauptfensters |
| Anheften / Lösen | Heftet den Tab an oder löst ihn — siehe [Angeheftete Tabs](#angeheftete-tabs). | Immer |
| Seitlich öffnen | Zeigt den Tab im anderen geteilten Bereich — siehe [Zwei Dokumente nebeneinander](#zwei-dokumente-nebeneinander). | Dieser und der aktive Tab sind beide Dokumente, und dieser ist nicht der aktive Tab (bei Browser-Tabs nicht angezeigt) |
| Umbenennen | Benennt die Datei direkt im Tab um — siehe [Eine Datei umbenennen](#eine-datei-umbenennen). | Das Dokument wurde gespeichert |
| Pfad kopieren | Kopiert den absoluten Pfad der Datei. | Das Dokument wurde gespeichert |
| Relativen Pfad kopieren | Kopiert den Pfad relativ zum Arbeitsbereichsordner. | Ein Arbeitsbereich ist geöffnet und die Datei liegt darin |
| Im Finder anzeigen | Zeigt die Datei im Finder (**Im Explorer anzeigen** unter Windows, **Im Dateimanager anzeigen** unter Linux). | Das Dokument wurde gespeichert |
| Auf Datenträger wiederherstellen | Schreibt den Inhalt des Tabs zurück an seinen Pfad. | Die Datei wurde vom Datenträger gelöscht, während sie geöffnet war |
| Auf Gespeichertes zurücksetzen | Verwirft nach einer Bestätigung Ihre Änderungen und lädt die Datei neu vom Datenträger. | Der Tab hat nicht gespeicherte Änderungen und seine Datei existiert noch |
| Schließen | Schließt den Tab (fragt vorher nach dem Speichern, wenn er nicht gespeicherte Änderungen hat). | Der Tab ist nicht angeheftet |
| Andere schließen | Schließt jeden anderen nicht angehefteten Tab. | Ein weiterer nicht angehefteter Tab existiert |
| Tabs rechts schließen | Schließt die nicht angehefteten Tabs rechts davon. | Einer existiert |
| Alle nicht angehefteten Tabs schließen | Schließt jeden nicht angehefteten Tab, diesen eingeschlossen. | Ein nicht angehefteter Tab existiert |
| Alle schließen | Schließt jeden Tab, auch die angehefteten. Würde ein angehefteter Tab geschlossen, fragt es zuerst nach und nennt deren Anzahl; beim Abbrechen wird nichts geschlossen. | Immer |

Sammelschließungen wirken auf die Tabs des aktuellen Arbeitsbereichs und schließen sie nacheinander. Jeder Tab mit nicht gespeicherten Änderungen fragt vorher nach, und das Abbrechen einer dieser Abfragen stoppt den Rest.

## Angeheftete Tabs

Heften Sie einen Tab über sein Kontextmenü an, um ihn griffbereit zu halten:

- Er wandert in die angeheftete Gruppe am linken Rand der Leiste, zeigt ein Stecknadelsymbol und verliert seine Schließen-Schaltfläche. Tabs lassen sich nicht über die Grenze zwischen angehefteten und nicht angehefteten Tabs ziehen (*„Angeheftete Tabs bleiben links. Drop blockiert.“*), und ein angehefteter Tab lässt sich nicht aus seinem Fenster herausziehen.
- Er lässt sich auf keinem Weg schließen — `Mod + W`, Mittelklick, **Schließen** oder eine Sammelschließung —, bis Sie ihn lösen; ein Versuch zeigt *„Vor dem Schließen lösen“*. Zwei bewusste Schließvorgänge sind die Ausnahme: **Alle schließen** schließt nach Ihrer Bestätigung auch angeheftete Tabs, und das Schließen eines Arbeitsbereichs in der Leiste schließt seine angehefteten Tabs mit den übrigen.
- Das Schließen eines Fensters mit angehefteten Tabs verlangt eine Bestätigung — *„Dieses Fenster hat N angepinnte Tabs. Trotzdem schließen?“* —, sofern nicht bereits ein Speicherdialog angezeigt wurde.
- Das Anheften übersteht das Verschieben des Tabs in ein anderes Fenster oder einen anderen Arbeitsbereich sowie einen Update-Neustart, aber nicht das Beenden von VMark: Beim nächsten Start wieder geöffnete Tabs sind nicht angeheftet.

Für das Anheften gibt es kein Tastenkürzel.

## Eine Datei umbenennen

Wählen Sie **Umbenennen** im Kontextmenü eines Tabs. Der Name wird im Tab bearbeitbar, wobei der Teil vor der Erweiterung ausgewählt ist. Eingabe oder ein Klick daneben übernimmt; Escape bricht ab. Die Datei wird auf dem Datenträger umbenannt, und jeder geöffnete Tab, der auf sie verweist, folgt. VMark überschreibt nie: Ist der Name vergeben, meldet ein Dialog *Eine Datei mit dem Namen „X“ existiert bereits.* Ein Name, der leer oder unverändert ist, `.` oder `..` lautet oder `/` oder `\` enthält, wird abgelehnt oder ignoriert. Was Sie eingeben, ist der vollständige Name — löschen Sie die Erweiterung, verliert die Datei sie.

Unter **macOS** können Sie bei eingeschaltetem **Einstellungen → Erscheinungsbild → Dateiname in Titelleiste anzeigen** auch auf den Dateinamen in der Titelleiste doppelklicken, um die Datei umzubenennen. Es gelten dieselben Regeln und Meldungen; nach einer Namenskollision oder einem Fehler bleibt der Name bearbeitbar, sodass Sie einen anderen versuchen können. Bei ausgeschaltetem **Dateiendungen anzeigen** bleibt die ursprüngliche Erweiterung erhalten, wenn Sie einen Namen ohne Erweiterung eingeben. Ein Doppelklick auf den Titel eines ungespeicherten Dokuments öffnet stattdessen **Speichern**.

## Tabs und Fenster schließen

Nichts mit nicht gespeicherten Änderungen wird ohne Nachfrage geschlossen.

- **Das Schließen eines Tabs** mit nicht gespeicherten Änderungen (`Mod + W`, das × des Tabs oder **Schließen**) fragt *„Möchten Sie die Änderungen an „…“ speichern?“* mit **Speichern**, **Nicht speichern** und **Abbrechen**. **Speichern** bei einem nie gespeicherten Dokument öffnet einen Speicherdialog in Ihrem Standard-Speicherordner, mit dem Titel des Tabs als vorgeschlagenem Namen. Wird dieser Dialog abgebrochen oder schlägt das Speichern fehl, bleibt der Tab geöffnet.
- **Das Schließen eines Fensters** mit einem nicht gespeicherten Dokument stellt dieselbe Frage. Bei zwei oder mehr listet ein einziger Dialog alle auf — nie gespeicherte Dokumente sind mit *(neu)* markiert — mit **Alle speichern**, **Nicht speichern** und **Abbrechen**.
- **Alle speichern** speichert jedes Dokument, das eine Datei hat. Für nie gespeicherte Dokumente fragt es nach einem Speicherort: ein Speicherdialog, wenn es eines ist, oder **eine Ordnerauswahl** für mehrere (*„Ordner für N neue Dokumente auswählen“*). Jedes wird dann in diesem Ordner unter seinem Titel gespeichert, und ein bereits vergebener Name erhält eine Nummer (`Untitled 2.md`), sodass nichts überschrieben wird.
- **Beenden** (`Mod + Q`) führt dieselbe Prüfung in jedem Fenster durch, ein Fenster nach dem anderen; ein Abbruch in irgendeinem Fenster bricht das Beenden ab. Bei eingeschaltetem **Einstellungen → Dateien & Bilder → Beenden bestätigen** (Standard) zeigt der erste Druck nur *„⌘Q erneut drücken zum Beenden“* — drücken Sie es innerhalb von zwei Sekunden erneut. Ein Beenden durch das Betriebssystem (etwa beim Herunterfahren) überspringt das doppelte Drücken.
- **Alle speichern und beenden** speichert die ungesicherten Dokumente in jedem Fenster ohne den Dialog — für nie gespeicherte fragt es weiterhin nach dem Speicherort (ein Speicherdialog oder, bei mehreren, eine Ordnerauswahl in dem Fenster, das sie enthält) — und beendet dann. Lässt sich ein Dokument nicht speichern oder brechen Sie diesen Dialog ab, wird das Beenden abgebrochen: Dieses Fenster bleibt offen, und ein fehlgeschlagenes Speichern nennt den Grund.

Unter macOS läuft VMark weiter, nachdem sein letztes Fenster geschlossen wurde; unter Windows und Linux beendet das Schließen des letzten Fensters die App — es sei denn, unter Windows ist **Einstellungen → Dateien & Bilder → Beim Schließen in den Infobereich minimieren** eingeschaltet: Dann wird das letzte Fenster stattdessen im Infobereich ausgeblendet, ohne dass etwas geschlossen wird und ohne Speicherabfrage (siehe [Einstellungen](/de/guide/settings)).
