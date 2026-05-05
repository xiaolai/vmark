# Intelligente Tab-Navigation

VMark's Tab- und Umschalt+Tab-Tasten sind kontextbewusst — sie helfen Ihnen, effizient durch formatierten Text, Klammern und Links zu navigieren, ohne die Pfeiltasten verwenden zu müssen.

## Kurzübersicht

| Kontext | Tab-Aktion | Umschalt+Tab-Aktion |
|---------|------------|---------------------|
| Innerhalb von Klammern `()` `[]` `{}` | Über schließende Klammer springen | Vor öffnende Klammer springen |
| Innerhalb von Anführungszeichen `""` `''` | Über schließendes Anführungszeichen springen | Vor öffnendes Anführungszeichen springen |
| Innerhalb von CJK-Klammern `「」` `『』` | Über schließende Klammer springen | Vor öffnende Klammer springen |
| Innerhalb von **Fett**, *Kursiv*, `Code`, ~~Durchgestrichen~~ | Nach der Formatierung springen | Vor die Formatierung springen |
| Innerhalb eines Links | Nach dem Link springen | Vor den Link springen |
| In einer Tabellenzelle | Zur nächsten Zelle wechseln | Zur vorherigen Zelle wechseln |
| In einem Listenelement | Element einrücken | Element ausrücken |

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
