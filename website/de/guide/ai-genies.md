# KI-Genies

KI-Genies sind Prompt-Vorlagen, die Ihren Text mithilfe von KI transformieren. Wählen Sie Text aus, rufen Sie einen Genie auf und überprüfen Sie die vorgeschlagenen Änderungen — alles ohne den Editor zu verlassen.

## Schnellstart

1. Konfigurieren Sie einen KI-Anbieter unter **Einstellungen > Integrationen** (siehe [KI-Anbieter](/de/guide/ai-providers))
2. Wählen Sie Text im Editor aus
3. Drücken Sie `Mod + Y`, um die Genie-Auswahl zu öffnen
4. Wählen Sie einen Genie oder geben Sie einen freien Prompt ein
5. Überprüfen Sie den Inline-Vorschlag — annehmen oder ablehnen

## Die Genie-Auswahl

Drücken Sie `Mod + Y` (oder Menü **Werkzeuge > KI-Genies**), um ein Spotlight-ähnliches Overlay mit einer einzigen einheitlichen Eingabe zu öffnen.

**Suche und freie Eingabe** — Beginnen Sie zu tippen, um Genies nach Name, Beschreibung oder Kategorie zu filtern. Wenn keine Genies übereinstimmen, wird die Eingabe zu einem freien Promptfeld.

**Schnellschaltflächen** — Wenn der Bereich "Auswahl" ist und die Eingabe leer ist, werden Ein-Klick-Schaltflächen für häufige Aktionen angezeigt (Polieren, Kürzen, Grammatik, Umformulieren).

**Zweistufige freie Eingabe** — Wenn keine Genies übereinstimmen, drücken Sie einmal `Enter`, um einen Bestätigungshinweis zu sehen, dann erneut `Enter`, um als KI-Prompt zu senden. Dies verhindert versehentliche Übermittlungen.

**Bereichsauswahl** — Drücken Sie `Tab`, um zwischen Bereichen zu wechseln: Auswahl → Block → Dokument → Alles.

**Prompt-Verlauf** — Im freien Modus (keine übereinstimmenden Genies) drücken Sie `Pfeil oben` / `Pfeil unten`, um frühere Prompts zu durchblättern. Drücken Sie `Strg + R`, um ein durchsuchbares Verlaufs-Dropdown zu öffnen. Ghost-Text zeigt den zuletzt übereinstimmenden Prompt als grauen Hinweis an — drücken Sie `Tab`, um ihn zu übernehmen.

### Verarbeitungsrückmeldung

Nach der Auswahl eines Genie oder dem Absenden eines freien Prompts zeigt die Auswahl Inline-Rückmeldungen:

- **Verarbeitung** — Ein Denk-Indikator mit Zeitzähler. Drücken Sie `Escape` zum Abbrechen.
- **Vorschau** — Die KI-Antwort wird in Echtzeit gestreamt. Verwenden Sie `Annehmen`, um anzuwenden, oder `Ablehnen`, um zu verwerfen.
- **Fehler** — Falls etwas schiefgeht, wird die Fehlermeldung mit einer Schaltfläche `Erneut versuchen` angezeigt.

Die Statusleiste zeigt ebenfalls den KI-Fortschritt an — ein drehendes Symbol mit Zeitzähler während der Ausführung, ein kurzes "Fertig"-Symbol bei Erfolg oder ein Fehlerindikator mit den Schaltflächen "Erneut versuchen"/"Schließen". Die Statusleiste wird automatisch eingeblendet, wenn die KI aktiv ist, selbst wenn Sie sie zuvor mit `F7` ausgeblendet haben.

## Integrierte Genies

VMark wird mit 13 Genies in vier Kategorien geliefert:

### Bearbeiten

| Genie | Beschreibung | Bereich |
|-------|-------------|---------|
| Polieren | Klarheit und Fluss verbessern | Auswahl |
| Kürzen | Text prägnanter machen | Auswahl |
| Grammatik korrigieren | Grammatik und Rechtschreibung korrigieren | Auswahl |
| Vereinfachen | Einfachere Sprache verwenden | Auswahl |

### Kreativ

| Genie | Beschreibung | Bereich |
|-------|-------------|---------|
| Erweitern | Idee zu vollständigem Text ausarbeiten | Auswahl |
| Umformulieren | Dasselbe anders ausdrücken | Auswahl |
| Lebendig | Sensorische Details und Bilder hinzufügen | Auswahl |
| Fortsetzen | Schreiben von hier aus fortsetzen | Block |

### Struktur

| Genie | Beschreibung | Bereich |
|-------|-------------|---------|
| Zusammenfassen | Dokument zusammenfassen | Dokument |
| Gliederung | Gliederung erstellen | Dokument |
| Überschrift | Titeloptionen vorschlagen | Dokument |

### Werkzeuge

| Genie | Beschreibung | Bereich |
|-------|-------------|---------|
| Übersetzen | Ins Englische übersetzen | Auswahl |
| Auf Englisch umschreiben | Text auf Englisch umschreiben | Auswahl |

## Bereich

Jeder Genie arbeitet mit einem von drei Bereichen:

- **Auswahl** — Der hervorgehobene Text. Wenn nichts ausgewählt ist, wird der aktuelle Block verwendet.
- **Block** — Der Absatz oder das Blockelement an der Cursorposition.
- **Dokument** — Der gesamte Dokumentinhalt.

Der Bereich bestimmt, welcher Text extrahiert und als `{{content}}` an die KI übergeben wird.

::: tip
Wenn der Bereich **Auswahl** ist, aber nichts ausgewählt ist, arbeitet der Genie am aktuellen Absatz.
:::

## Vorschläge überprüfen

Nachdem ein Genie ausgeführt wurde, erscheint der Vorschlag inline:

- **Ersetzen** — Originaltext mit Durchstreichung, neuer Text in Grün
- **Einfügen** — Neuer Text in Grün nach dem Quellblock
- **Löschen** — Originaltext mit Durchstreichung

Jeder Vorschlag hat Annehmen- (Häkchen) und Ablehnen- (X) Schaltflächen.

### Tastaturkürzel

| Aktion | Tastenkürzel |
|--------|-------------|
| Vorschlag annehmen | `Eingabe` |
| Vorschlag ablehnen | `Escape` |
| Nächster Vorschlag | `Tab` |
| Vorheriger Vorschlag | `Umschalt + Tab` |
| Alle annehmen | `Mod + Umschalt + Eingabe` |
| Alle ablehnen | `Mod + Umschalt + Escape` |

## Statusleisten-Anzeige

Während die KI generiert, zeigt die Statusleiste ein drehendes Funken-Symbol mit einem Zeitzähler ("Denkt... 3s"). Eine Abbrechen-Schaltfläche (×) ermöglicht das Stoppen der Anfrage.

Nach Abschluss wird kurz ein "Fertig"-Häkchen für 3 Sekunden angezeigt. Bei einem Fehler zeigt die Statusleiste die Fehlermeldung mit den Schaltflächen "Erneut versuchen" und "Schließen".

Die Statusleiste wird automatisch eingeblendet, wenn die KI aktiv ist (läuft, Fehler oder Erfolg), auch wenn sie mit `F7` ausgeblendet wurde.

---

## Eigene Genies erstellen

Sie können Ihre eigenen Genies erstellen. Jeder Genie ist eine einzelne Markdown-Datei mit YAML-Frontmatter und einer Prompt-Vorlage.

### Wo Genies gespeichert werden

Genies werden im Anwendungsdatenverzeichnis gespeichert:

| Plattform | Pfad |
|-----------|------|
| macOS | `~/Library/Application Support/app.vmark/genies/` |
| Windows | `%APPDATA%\app.vmark\genies\` |
| Linux | `~/.local/share/app.vmark/genies/` |

Öffnen Sie diesen Ordner über das Menü **Werkzeuge > Genies-Ordner öffnen**.

### Verzeichnisstruktur

Unterverzeichnisse werden zu **Kategorien** in der Auswahl. Sie können Genies beliebig organisieren:

```
genies/
├── editing/
│   ├── polish.md
│   ├── condense.md
│   └── fix-grammar.md
├── creative/
│   ├── expand.md
│   └── rephrase.md
├── academic/          ← Ihre eigene Kategorie
│   ├── cite.md
│   └── abstract.md
└── my-workflows/      ← Eine weitere eigene Kategorie
    └── blog-intro.md
```

### Dateiformat

Jede Genie-Datei hat zwei Teile: **Frontmatter** (Metadaten) und **Vorlage** (der Prompt).

```markdown
---
description: Klarheit und Fluss verbessern
scope: selection
category: editing
---

Sie sind ein Expertenredakteur. Verbessern Sie die Klarheit, den Fluss und die Prägnanz
des folgenden Textes unter Beibehaltung der Stimme und Absicht des Autors.

Geben Sie nur den verbesserten Text zurück — keine Erklärungen.

{{content}}
```

Der Dateiname `polish.md` wird in der Auswahl als Anzeigename "Polish" verwendet.

### Frontmatter-Felder

| Feld | Erforderlich | Werte | Standard |
|------|-------------|-------|---------|
| `description` | Nein | Kurze Beschreibung in der Auswahl | Leer |
| `scope` | Nein | `selection`, `block`, `document` | `selection` |
| `category` | Nein | Kategoriename für Gruppierung | Unterverzeichnisname |
| `action` | Nein | `replace`, `insert` | `replace` |
| `context` | Nein | `1`, `2` | `0` (keiner) |
| `model` | Nein | Modell-Bezeichner, der den Anbieterstandard überschreibt | Anbieterstandard |

**Genie-Name** — Der Anzeigename wird immer aus dem **Dateinamen** (ohne `.md`) abgeleitet. Zum Beispiel erscheint `fix-grammar.md` als "Fix Grammar" in der Auswahl. Benennen Sie die Datei um, um den Anzeigenamen zu ändern.

### Der `{{content}}`-Platzhalter

Der `{{content}}`-Platzhalter ist das Kernstück jedes Genie. Wenn ein Genie ausgeführt wird, führt VMark folgende Schritte durch:

1. **Text extrahieren** basierend auf dem Bereich (ausgewählter Text, aktueller Block oder gesamtes Dokument)
2. **Ersetzen** jedes `{{content}}` in Ihrer Vorlage durch den extrahierten Text
3. **Senden** des ausgefüllten Prompts an den aktiven KI-Anbieter
4. **Streamen** der Antwort zurück als Inline-Vorschlag

Mit dieser Vorlage zum Beispiel:

```markdown
Übersetzen Sie den folgenden Text ins Französische.

{{content}}
```

Wenn der Benutzer "Hello, how are you?" auswählt, erhält die KI:

```
Übersetzen Sie den folgenden Text ins Französische.

Hello, how are you?
```

Die KI antwortet mit "Bonjour, comment allez-vous ?" und es erscheint als Inline-Vorschlag, der den ausgewählten Text ersetzt.

### Der `{{context}}`-Platzhalter

Der `{{context}}`-Platzhalter gibt der KI schreibgeschützten Umgebungstext — damit sie Ton, Stil und Struktur der benachbarten Blöcke nachahmen kann, ohne sie zu ändern.

**Funktionsweise:**

1. Setzen Sie `context: 1` oder `context: 2` im Frontmatter, um ±1 oder ±2 benachbarte Blöcke einzuschließen
2. Verwenden Sie `{{context}}` in Ihrer Vorlage, wo der Umgebungstext eingefügt werden soll
3. Die KI sieht den Kontext, aber der Vorschlag ersetzt nur `{{content}}`

**Zusammengesetzte Blöcke sind atomar** — wenn ein Nachbar eine Liste, Tabelle, Blockzitat oder Details-Block ist, zählt die gesamte Struktur als ein Block.

**Bereichseinschränkungen** — Kontext funktioniert nur mit den Bereichen `selection` und `block`. Beim `document`-Bereich ist der Inhalt bereits das gesamte Dokument.

**Freie Prompts** — Wenn Sie eine freie Anweisung in der Auswahl eingeben, bezieht VMark automatisch ±1 benachbarten Block als Kontext für den `selection`- und `block`-Bereich ein. Keine Konfiguration erforderlich.

**Rückwärtskompatibel** — Genies ohne `{{context}}` funktionieren genau wie zuvor. Wenn die Vorlage kein `{{context}}` enthält, wird kein Umgebungstext extrahiert.

**Beispiel — was die KI erhält:**

Mit `context: 1` und dem Cursor im zweiten Absatz eines dreiseitigen Dokuments:

```
[Before]
Inhalt des ersten Absatzes.

[After]
Inhalt des dritten Absatzes.
```

Die Abschnitte `[Before]` und `[After]` werden weggelassen, wenn es keine Nachbarn in dieser Richtung gibt (z.B. der Inhalt am Anfang oder Ende des Dokuments ist).

### Das `action`-Feld

Standardmäßig **ersetzen** Genies den Quelltext durch die KI-Ausgabe. Setzen Sie `action: insert`, um die Ausgabe **hinter** den Quellblock **anzufügen**.

Verwenden Sie `replace` für: Bearbeitung, Umformulierung, Übersetzung, Grammatikkorrekturen — alles, was den Originaltext transformiert.

Verwenden Sie `insert` für: Weiterschreiben, Zusammenfassungen unter Inhalten erstellen, Kommentare hinzufügen — alles, was neuen Text hinzufügt, ohne das Original zu entfernen.

**Beispiel — insert-Aktion:**

```markdown
---
description: Von hier aus weiterschreiben
scope: block
action: insert
---

Schreiben Sie natürlich weiter, wo der folgende Text aufhört.
Passen Sie die Stimme, den Stil und den Ton des Autors an. Schreiben Sie 2-3 Absätze.

Wiederholen oder fassen Sie den vorhandenen Text nicht zusammen — setzen Sie ihn einfach fort.

{{content}}
```

### Das `model`-Feld

Überschreiben Sie das Standardmodell für einen bestimmten Genie. Nützlich, wenn Sie ein günstigeres Modell für einfache Aufgaben oder ein leistungsfähigeres für komplexe Aufgaben möchten.

```markdown
---
description: Schnelle Grammatikkorrektur (verwendet schnelles Modell)
scope: selection
model: claude-haiku-4-5-20251001
---

Korrigieren Sie Grammatik- und Rechtschreibfehler. Geben Sie nur den korrigierten Text zurück.

{{content}}
```

Der Modell-Bezeichner muss mit dem übereinstimmen, was Ihr aktiver Anbieter akzeptiert.

## Effektive Prompts schreiben

### Ausgabeformat genau angeben

Sagen Sie der KI genau, was sie zurückgeben soll. Ohne dies neigen Modelle dazu, Erklärungen, Überschriften oder Kommentare hinzuzufügen.

```markdown
<!-- Gut -->
Geben Sie nur den verbesserten Text zurück — keine Erklärungen.

<!-- Schlecht — KI kann Ausgabe in Anführungszeichen einschließen, "Hier ist die verbesserte Version:" hinzufügen usw. -->
Verbessern Sie diesen Text.
```

### Eine Rolle festlegen

Geben Sie der KI eine Persona, um ihr Verhalten zu verankern.

```markdown
<!-- Gut -->
Sie sind ein erfahrener technischer Redakteur, der auf API-Dokumentation spezialisiert ist.

<!-- Okay, aber weniger fokussiert -->
Bearbeiten Sie den folgenden Text.
```

### Den Bereich einschränken

Sagen Sie der KI, was sie NICHT ändern soll. Dies verhindert übermäßiges Bearbeiten.

```markdown
<!-- Gut -->
Korrigieren Sie nur Grammatik- und Rechtschreibfehler.
Ändern Sie nicht die Bedeutung, den Stil oder den Ton.
Strukturieren Sie keine Sätze um.

<!-- Schlecht — gibt der KI zu viel Freiheit -->
Korrigieren Sie diesen Text.
```

### Markdown in Prompts verwenden

Sie können Markdown-Formatierung in Ihren Prompt-Vorlagen verwenden. Dies ist hilfreich, wenn die KI strukturierte Ausgaben erzeugen soll.

```markdown
---
description: Eine Pro/Kontra-Analyse erstellen
scope: selection
action: insert
---

Analysieren Sie den folgenden Text und erstellen Sie eine kurze Pro/Kontra-Liste.

Format:

**Pro:**
- Punkt 1
- Punkt 2

**Kontra:**
- Punkt 1
- Punkt 2

{{content}}
```

### Prompts fokussiert halten

Ein Genie, eine Aufgabe. Kombinieren Sie keine mehreren Aufgaben in einem einzigen Genie — erstellen Sie stattdessen separate Genies.

```markdown
<!-- Gut — eine klare Aufgabe -->
---
description: In Aktiv umwandeln
scope: selection
---

Schreiben Sie den folgenden Text in der Aktivform.
Ändern Sie nicht die Bedeutung.
Geben Sie nur den umgeschriebenen Text zurück.

{{content}}
```

## Beispiele für eigene Genies

### Akademisch — Abstract schreiben

```markdown
---
description: Einen akademischen Abstract erstellen
scope: document
action: insert
---

Lesen Sie das folgende Paper und schreiben Sie einen prägnanten akademischen Abstract
(150-250 Wörter). Folgen Sie der Standardstruktur: Hintergrund, Methoden,
Ergebnisse, Schlussfolgerung.

{{content}}
```

### Blog — Hook erstellen

```markdown
---
description: Einen ansprechenden Eröffnungsabsatz schreiben
scope: document
action: insert
---

Lesen Sie den folgenden Entwurf und schreiben Sie einen überzeugenden Eröffnungsabsatz,
der den Leser fesselt. Verwenden Sie eine Frage, eine überraschende Tatsache oder eine lebendige
Szene. Halten Sie es unter 3 Sätzen.

{{content}}
```

### Code — Code-Block erklären

```markdown
---
description: Eine einfachsprachige Erklärung über Code hinzufügen
scope: selection
action: insert
---

Lesen Sie den folgenden Code und schreiben Sie eine kurze einfachsprachige Erklärung
was er tut. Verwenden Sie 1-2 Sätze. Nehmen Sie den Code selbst nicht in Ihre Antwort auf.

{{content}}
```

### E-Mail — Professionell gestalten

```markdown
---
description: In professionellem Ton umschreiben
scope: selection
---

Schreiben Sie den folgenden Text in einem professionellen, geschäftsgerechten Ton um.
Behalten Sie dieselbe Bedeutung und die wichtigsten Punkte bei. Entfernen Sie umgangssprachliche Ausdrücke,
Slang und Füllwörter.

Geben Sie nur den umgeschriebenen Text zurück — keine Erklärungen.

{{content}}
```

### Übersetzung — Ins vereinfachte Chinesisch

```markdown
---
description: Ins vereinfachte Chinesisch übersetzen
scope: selection
---

Übersetzen Sie den folgenden Text ins vereinfachte Chinesisch.
Bewahren Sie die ursprüngliche Bedeutung, den Ton und die Formatierung.
Verwenden Sie natürliches, idiomatisches Chinesisch — keine wörtliche Übersetzung.

Geben Sie nur den übersetzten Text zurück — keine Erklärungen.

{{content}}
```

### Kontextbewusst — Zur Umgebung passen

```markdown
---
description: Umschreiben, um Ton und Stil der Umgebung anzupassen
scope: selection
context: 1
---

Schreiben Sie den folgenden Inhalt um, damit er natürlich zu seinem Umgebungskontext passt.
Passen Sie Ton, Stil und Detailtiefe an.

Geben Sie nur den umgeschriebenen Text zurück — keine Erklärungen.

## Umgebungskontext (nicht in der Ausgabe einschließen):
{{context}}

## Umzuschreibender Inhalt:
{{content}}
```

### Überprüfung — Faktencheck

```markdown
---
description: Aussagen markieren, die überprüft werden müssen
scope: selection
action: insert
---

Lesen Sie den folgenden Text und listen Sie alle faktischen Behauptungen auf, die
überprüft werden sollten. Notieren Sie für jede Behauptung, warum sie überprüft werden muss (z.B.
spezifische Zahlen, Daten, Statistiken oder starke Aussagen).

Formatieren Sie als Aufzählungsliste. Wenn alles solide aussieht, sagen Sie
"Keine Behauptungen zur Überprüfung markiert."

{{content}}
```

## KI-Vorschläge

Wenn ein Genie Text zurückgibt, der als Ersatz für die Auswahl gedacht ist (statt einer freien Chat-Antwort), zeigt VMark ihn als **Vorschlag** mit einem Inline-Diff an: roter durchgestrichener Text für das Original, grüne Unterstreichung für den vorgeschlagenen Text. Sie prüfen und bestätigen, bevor irgendeine Änderung dauerhaft wird.

| Aktion | Kürzel |
|---|---|
| Fokussierten Vorschlag annehmen | `Tab` |
| Fokussierten Vorschlag ablehnen | `Esc` |
| Alle Vorschläge im Dokument annehmen | `Mod + Shift + Eingabe` _(kontextabhängig — innerhalb einer Tabelle bedeutet es zugleich „Zeile darüber hinzufügen")_ |
| Zum nächsten Vorschlag wechseln | `Tab` von einer nicht fokussierten Position aus |

Wenn ein Genie mehrere Absätze umschreibt, ist jede Ersetzung ein eigenständig navigierbarer Vorschlag. Das Annehmen eines Vorschlags akzeptiert die anderen nicht automatisch.

Die Vorschlags-Oberfläche hat außerdem eine MCP-Schnittstelle — externe KI-Agenten, die über den [MCP-Server](/de/guide/mcp-tools) verbunden sind, können `suggestion.accept`-/`suggestion.reject`-Aktionen ausgeben, um denselben Zustand zu manipulieren.

## Einschränkungen

- Genies funktionieren nur im **WYSIWYG-Modus**. Im Quellmodus erklärt eine Toast-Benachrichtigung dies.
- Es kann immer nur ein Genie gleichzeitig ausgeführt werden. Wenn die KI bereits generiert, startet die Auswahl keinen weiteren.
- Der `{{content}}`-Platzhalter wird wörtlich ersetzt — er unterstützt keine Bedingungen oder Schleifen.
- Sehr große Dokumente können bei Verwendung von `scope: document` die Token-Grenzen des Anbieters überschreiten.

## Fehlerbehebung

**"Kein KI-Anbieter verfügbar"** — Öffnen Sie Einstellungen > Integrationen und konfigurieren Sie einen Anbieter. Siehe [KI-Anbieter](/de/guide/ai-providers).

**Genie erscheint nicht in der Auswahl** — Überprüfen Sie, ob die Datei eine `.md`-Erweiterung hat, gültiges Frontmatter mit `---`-Begrenzern und im Genies-Verzeichnis (nicht in einem tiefer liegenden Unterverzeichnis) gespeichert ist.

**KI gibt Unsinn oder Fehler zurück** — Überprüfen Sie, ob Ihr API-Schlüssel korrekt ist und der Modellname für Ihren Anbieter gültig ist. Überprüfen Sie das Terminal/die Konsole auf Fehlerdetails.

**Vorschlag entspricht nicht den Erwartungen** — Verfeinern Sie Ihren Prompt. Fügen Sie Einschränkungen hinzu ("nur den Text zurückgeben", "nicht erklären"), legen Sie eine Rolle fest oder schränken Sie den Bereich ein.

## Siehe auch

- [KI-Anbieter](/de/guide/ai-providers) — CLI- oder REST-API-Anbieter konfigurieren
- [Tastaturkürzel](/de/guide/shortcuts) — Vollständige Tastaturkürzel-Referenz
- [MCP-Werkzeuge](/de/guide/mcp-tools) — Externe KI-Integration über MCP
