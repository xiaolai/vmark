# Tastaturkürzel

VMark ist für tastaturorientierte Workflows konzipiert. Die meisten Tastaturkürzel können in den Einstellungen angepasst werden. Eine kleine Anzahl von Primitiven ist fest belegt: die Mehrcursor-Selektoren `Mod+D` (Nächstes Vorkommen auswählen) und `Mod+Shift+L` (Alle Vorkommen auswählen) sowie die globalen Rückgängig-/Wiederholen-Tastaturkürzel. Die übrigen Mehrcursor-Tastaturkürzel (Vorkommen überspringen, Cursor-Rückgängig sanft, Cursor oben/unten hinzufügen) sind anpassbar. Mit _(kontextabhängig)_ markierte Tastaturkürzel werden im Editor für bestimmte Strukturen (z. B. Aufgaben-Checkbox-Umschalter) behandelt und sind nicht in der Anpassungs-Registratur sichtbar.

## Notation

- **Mod** = Cmd auf macOS, Strg auf Windows/Linux
- **Alt** = Option auf macOS

## Funktionstasten auf macOS

VMark verwendet Funktionstasten (F2–F10) für schnelle Moduswechsel. Auf macOS sind diese Tasten standardmäßig Systemfunktionen zugeordnet (Helligkeit, Lautstärke usw.).

**Um F-Tasten direkt ohne Fn zu verwenden:**

1. **Systemeinstellungen** → **Tastatur** öffnen
2. **„F1, F2 usw. als Standard-Funktionstasten verwenden“** aktivieren

Alternativ halten Sie die **Fn**-Taste beim Drücken von F2–F10, um VMark-Tastaturkürzel auszulösen.

::: tip
Wenn Sie die Systemfunktionen auf F-Tasten bevorzugen, können Sie VMark-Tastaturkürzel in den Einstellungen (`Mod + ,`) für andere Tastenkombinationen anpassen.
:::

### F-Taste Schnellübersicht

| Taste | Aktion |
|-------|--------|
| `F2` | Nächstes Problem |
| `Umschalt + F2` | Vorheriges Problem |
| `F3` | Unsichtbare Zeichen umschalten |
| `F4` | Zeilen aufsteigend sortieren _(nur im Quellmodus; im WYSIWYG-Modus ohne Wirkung)_ |
| `Umschalt + F4` | Zeilen absteigend sortieren _(nur im Quellmodus; im WYSIWYG-Modus ohne Wirkung)_ |
| `F5` | Quellvorschau |
| `F6` | Quellansicht (Markdown: WYSIWYG ⇄ Quelle; andere Formate: Quelle ⇄ Geteilt) |
| `Umschalt + F6` | Geteilt / Vorschau (Markdown: geteilte Ansicht; andere Formate: Vorschau ⇄ Geteilt) |
| `F7` | Statusleiste umschalten |
| `F8` | Fokusmodus |
| `F9` | Schreibmaschinenmodus |
| `F10` | Nur-Lese-Modus |

## Bearbeiten

| Aktion | Tastenkürzel |
|--------|--------------|
| Rückgängig | `Mod + Z` |
| Wiederholen | `Mod + Umschalt + Z` |

## Textformatierung

| Aktion | Tastenkürzel |
|--------|--------------|
| Fett | `Mod + B` |
| Kursiv | `Mod + I` |
| Unterstrichen | `Mod + U` |
| Durchgestrichen | `Mod + Umschalt + X` |
| Inline-Code | Mod + Umschalt + `` ` `` |
| Hervorhebung | `Mod + Umschalt + M` |
| Tiefgestellt | `Alt + Mod + =` |
| Hochgestellt | `Alt + Mod + Umschalt + =` |
| Link | `Mod + K` |
| Link öffnen (Quellmodus) | `Cmd + Klick` |
| Link entfernen | `Alt + Umschalt + K` |
| Wiki-Link | `Alt + Mod + K` |
| Lesezeichen-Link | `Alt + Mod + B` |
| Formatierung löschen | `Mod + \` |

## Blockformatierung

| Aktion | Tastenkürzel |
|--------|--------------|
| Überschrift 1–6 | `Mod + 1` bis `Mod + 6` |
| Absatz | `Mod + Umschalt + 0` |
| Überschriften-Ebene erhöhen | `Alt + Mod + ]` |
| Überschriften-Ebene verringern | `Alt + Mod + [` |
| Blockzitat | `Alt + Mod + Q` |
| Codeblock | `Alt + Mod + C` |
| Aufzählungsliste | `Alt + Mod + U` |
| Geordnete Liste | `Alt + Mod + O` |
| Aufgabenliste | `Alt + Mod + X` |
| Aufgaben-Checkbox umschalten | `Mod + Umschalt + Eingabe` _(kontextabhängig; nicht anpassbar)_ |
| Einzug erhöhen | `Mod + ]` |
| Einzug verringern | `Mod + [` |
| Horizontale Linie | `Alt + Mod + -` |

## Zeilenoperationen

| Aktion | Tastenkürzel |
|--------|--------------|
| Zeile nach oben verschieben | `Alt + Auf` |
| Zeile nach unten verschieben | `Alt + Ab` |
| Zeile duplizieren | `Umschalt + Alt + Ab` |
| Zeile löschen | `Mod + Umschalt + K` |
| Zeilen verbinden | `Mod + J` |
| Zeilen aufsteigend sortieren | `F4` _(nur im Quellmodus)_ |
| Zeilen absteigend sortieren | `Umschalt + F4` _(nur im Quellmodus)_ |

## Texttransformationen

| Aktion | macOS | Windows/Linux |
|--------|-------|---------------|
| GROSSBUCHSTABEN | `Strg + Umschalt + U` | `Alt + Umschalt + U` |
| kleinbuchstaben | `Strg + Umschalt + L` | `Alt + Umschalt + L` |
| Titel-Schreibweise | `Strg + Umschalt + T` | `Alt + Umschalt + T` |
| Groß-/Kleinschreibung wechseln | _(anpassbar)_ | _(anpassbar)_ |
| Leerzeilen entfernen | _(anpassbar)_ | _(anpassbar)_ |
| Anführungsstil wechseln | `Umschalt + Mod + '` | `Umschalt + Mod + '` |

## Einfügen

| Aktion | Tastenkürzel |
|--------|--------------|
| Bild einfügen | `Mod + Umschalt + I` |
| Video einfügen | — |
| Audio einfügen | — |
| Tabelle einfügen | `Mod + Umschalt + T` |
| Inhaltsverzeichnis | _(anpassbar)_ |
| Inline-Mathematik | `Alt + Mod + M` |
| Mathematik-Block | `Alt + Mod + Umschalt + M` |
| Hinweis einfügen | `Alt + Mod + N` |
| Tipp einfügen | `Alt + Mod + Umschalt + T` |
| Warnung einfügen | `Mod + Umschalt + W` |
| Wichtig einfügen | `Alt + Mod + Umschalt + I` |
| Vorsicht einfügen | `Mod + Umschalt + U` |
| Einklappbar einfügen | `Alt + Mod + D` |
| Diagramm einfügen | `Alt + Mod + Umschalt + D` |
| Graphviz-Diagramm einfügen | _(anpassbar)_ |
| Mindmap einfügen | `Alt + Mod + Umschalt + K` |
| Kommentar umschalten | `Mod + /` |

## Auswahl & Mehrcursor

| Aktion | Tastenkürzel |
|--------|--------------|
| Zeile auswählen | `Mod + L` |
| Alle Vorkommen im Block auswählen | `Alt + Mod + Umschalt + L` |
| Auswahl erweitern | `Strg + Umschalt + Auf` |
| Nächstes Vorkommen auswählen | `Mod + D` |
| Vorkommen überspringen | `Mod + Umschalt + D` |
| Alle Vorkommen auswählen | `Mod + Umschalt + L` |
| Cursor-Rückgängig (sanft) | `Alt + Mod + Z` |
| Cursor oben hinzufügen | `Mod + Alt + Auf` |
| Cursor unten hinzufügen | `Mod + Alt + Ab` |
| Mehrcursor reduzieren | `Escape` |

## Suchen & Ersetzen

| Aktion | Tastenkürzel |
|--------|--------------|
| Suchen & Ersetzen | `Mod + F` |
| Nächste finden | `Mod + G` |
| Vorherige finden | `Mod + Umschalt + G` |
| Auswahl für Suche verwenden | `Mod + E` |
| In Dateien suchen | `Mod + Umschalt + H` |

## Ansicht & Modus

| Aktion | Tastenkürzel |
|--------|--------------|
| Quellansicht (Markdown ⇄ Quelle; andere Formate Quelle ⇄ Geteilt) | `F6` |
| Geteilt / Vorschau (Markdown geteilt; andere Formate Vorschau ⇄ Geteilt) | `Umschalt + F6` |
| Editor teilen — zwei Dokumente | `Alt + Mod + \` |
| Statusleiste umschalten | `F7` |
| Fokusmodus | `F8` |
| Schreibmaschinenmodus | `F9` |
| Nur-Lese-Modus | `F10` |
| Tatsächliche Größe | `Mod + 0` |
| Vergrößern | `Mod + =` |
| Verkleinern | `Mod + -` |
| Zeilenumbruch | `Alt + Z` |
| Zuletzt verwendeter Tab | `Strg + Tab` |
| Editor teilen — zwei Dokumente | `Alt + Mod + \` |
| Bereich schließen | `Alt + Mod + Umschalt + \` |
| Anderen Bereich fokussieren | `Alt + Mod + Umschalt + O` |
| Seitenleiste umschalten | `Strg + Umschalt + 0` |
| Gliederung umschalten | `Strg + Umschalt + 1` |
| Datei-Explorer umschalten | `Strg + Umschalt + 2` |
| Verlauf umschalten | `Strg + Umschalt + 3` |
| Wissensdatenbank umschalten | `Strg + Umschalt + 4` |
| Fensterstatus umschalten | `Strg + Umschalt + 5` |
| Zeilennummern umschalten (Rand im Quell-/Split-Editor) | `Alt + Mod + L` |
| Terminal umschalten | Strg + `` ` `` |
| Terminal oder Editor fokussieren | Strg + Umschalt + `` ` `` (Alt + Umschalt + `` ` `` unter Windows/Linux) |
| Diagramm-Vorschau umschalten | `Alt + Mod + P` |
| Tabellen an Breite anpassen | _(anpassbar)_ |
| Universelle Symbolleiste öffnen | `Mod + Umschalt + B` |
| Quellvorschau | `F5` |
| Markdown prüfen | `Alt + Mod + V` |
| Nächstes Problem | `F2` |
| Vorheriges Problem | `Umschalt + F2` |

::: tip Wissensdatenbank umschalten
`Strg + Umschalt + 4` ist standardmäßig ausgeblendet, ebenso der Menüeintrag **Ansicht → Wissensdatenbank**
und der Palettenbefehl. Kein Release-Build auf irgendeiner Plattform liefert die
Content-Server-Laufzeit mit, die die Funktion benötigt, daher erscheinen die Einstiegspunkte
nur, wenn **Einstellungen → Erweitert → Entwickler-Tools** eingeschaltet ist — siehe
[Wissensdatenbank & Slidev](/de/guide/knowledge-base#voraussetzungen). Das Tastaturkürzel
bleibt in jedem Fall unter **Einstellungen → Tastenkürzel** aufgeführt und anpassbar.
:::

## Dateioperationen

| Aktion | Tastenkürzel |
|--------|--------------|
| Neue Datei | `Mod + N` |
| Schnell öffnen | `Mod + O` _(Fuzzy-Dateibrowser)_ |
| Befehlspalette öffnen | `Mod + Umschalt + P` |
| Datei öffnen... | Nur Menü _(nativer Dateidialog)_ |
| Arbeitsbereich öffnen | `Mod + Umschalt + O` |
| Speichern | `Mod + S` |
| Speichern unter | `Mod + Umschalt + S` |
| Alles speichern und beenden | `Alt + Mod + Umschalt + Q` |
| Verschieben nach | Nur Menü |
| Schließen | `Mod + W` |
| HTML exportieren | Nur Menü |
| Drucken | `Mod + P` |
| PDF exportieren | — |
| Einstellungen | `Mod + ,` |

## Zwischenablage

| Aktion | Tastenkürzel |
|--------|--------------|
| Als HTML kopieren | `Mod + Umschalt + C` |
| Als reinen Text einfügen | `Mod + Umschalt + V` |

## KI-Genies

| Aktion | Tastenkürzel |
|--------|--------------|
| KI-Genies öffnen | `Mod + Y` |
| Vorschlag annehmen | `Eingabe` |
| Vorschlag ablehnen | `Escape` |
| Nächster Vorschlag | `Tab` |
| Vorheriger Vorschlag | `Umschalt + Tab` |
| Alle Vorschläge annehmen | `Mod + Umschalt + Eingabe` |
| Alle Vorschläge ablehnen | `Mod + Umschalt + Escape` |

## CJK-Formatierung

| Aktion | Tastenkürzel |
|--------|--------------|
| Auswahl formatieren | `Mod + Umschalt + F` |
| Dokument formatieren | `Alt + Mod + Umschalt + F` |

## Fenster & Tabs

| Aktion | Tastenkürzel |
|--------|--------------|
| Neues Fenster | `Mod + Umschalt + N` |
| Neuer Tab | `Mod + T` |
| Neuer Browser-Tab | `Alt + Mod + Umschalt + B` |
| Nächster Tab | `Mod + Umschalt + ]` |
| Vorheriger Tab | `Mod + Umschalt + [` |
| Tab schließen | `Mod + W` |
| Geschlossenen Tab wieder öffnen | _(anpassbar)_ |
| Versteckte Dateien umschalten | `Mod + Umschalt + .` |
| Alle Dateien umschalten | `Mod + Umschalt + A` |

::: tip Windows/Linux-Hinweis
Versteckte Dateien umschalten verwendet `Strg + H` unter Windows und Linux.

Seitenleiste umschalten verwendet `Alt + Umschalt + 0` unter Windows und Linux, weil `Mod` dort
Strg ist — die macOS-Kombination `Strg + Umschalt + 0` würde also mit
`Mod + Umschalt + 0` für Absatz kollidieren.
:::

::: tip Neuer Browser-Tab
`Alt + Mod + Umschalt + B` öffnet einen Tab des eingebetteten Browsers und erscheint auch im
Menü **Datei**. Der eingebettete Browser ist auf macOS standardmäßig eingeschaltet; wenn Sie ihn
unter **Einstellungen → Erweitert → Eingebetteter Browser** ausschalten, wird der Menüeintrag ausgeblendet
(nicht ausgegraut), bis Sie ihn wieder einschalten. Den Browser gibt es nur auf macOS, daher
erscheint der Eintrag unter Windows oder Linux nie.

Es ist ein echter Menüeintrag und nicht nur eine Tastenbelegung, und das ist wichtig: Sobald
eine Webseite den Tastaturfokus hat, verbraucht die Browser-Engine Tastendrücke, bevor VMark
sie sieht, sodass ein App-internes Tastaturkürzel nicht auslösen kann. Ein Menübeschleuniger wird
von macOS selbst ausgelöst und funktioniert daher auch beim Surfen.
:::

## Hilfe (nur macOS)

| Aktion | Tastenkürzel |
|--------|--------------|
| Menüs durchsuchen | `Cmd + Umschalt + /` |

::: tip
Dies ist ein natives macOS-Systemtastenkürzel, das alle Menüelemente durchsucht. Geben Sie ein Schlüsselwort ein, um eine Menüaktion zu finden und auszuführen.
:::

## Intelligente Tab-Navigation

Tab und Umschalt+Tab sind kontextabhängig — sie springen über Klammern, Anführungszeichen, Formatierungszeichen und Links hinaus.

| Kontext | Tab-Aktion |
|---------|------------|
| Vor `)`, `]`, `}`, Anführungszeichen | Über schließendes Zeichen springen |
| Vor CJK-Klammern `」`, `』` usw. | Über schließende Klammer springen |
| Innerhalb von **Fett**, *Kursiv*, `Code` | Nach der Formatierung springen |
| Innerhalb eines Links | Nach dem Link springen |

| Kontext | Umschalt+Tab-Aktion |
|---------|---------------------|
| Nach `(`, `[`, `{`, Anführungszeichen | Vor öffnendem Zeichen springen |
| Nach CJK-Klammern `「`, `『` usw. | Vor öffnender Klammer springen |
| Innerhalb von **Fett**, *Kursiv*, `Code` | Vor die Formatierung springen |
| Innerhalb eines Links | Vor den Link springen |

::: tip
Unter [Intelligente Tab-Navigation](/de/guide/tab-navigation) finden Sie den vollständigen Leitfaden, einschließlich CJK-Klammern, typografischer Anführungszeichen und Einstellungen.
:::

## Tabellenbearbeitung

Wenn der Cursor sich in einer Tabelle befindet:

| Aktion | Tastenkürzel |
|--------|--------------|
| Nächste Zelle | `Tab` |
| Vorherige Zelle | `Umschalt + Tab` |
| Zeile darunter hinzufügen | `Mod + Eingabe` |
| Zeile darüber hinzufügen | `Mod + Umschalt + Eingabe` |
| Zeile löschen | `Mod + Rücktaste` |
| Tabelle formatieren | `Alt + Mod + T` |
| Tabelle verlassen | Pfeiltasten am Tabellenrand |

## Popup-Navigation

Wenn ein Popup geöffnet ist (Link, Bild, Mathematik usw.):

| Aktion | Tastenkürzel |
|--------|--------------|
| Popup schließen | `Escape` |
| Bestätigen/Speichern | `Eingabe` |
| Felder navigieren | `Tab` / `Umschalt + Tab` |

## Mathematik-Block-Bearbeitung

Beim Bearbeiten eines Mathematik-Blocks:

| Aktion | Tastenkürzel |
|--------|--------------|
| Bestätigen & Verlassen | `Mod + Eingabe` |
| Abbrechen & Verlassen | `Escape` |

## Terminal

Wenn das integrierte Terminal fokussiert ist:

| Aktion | Tastenkürzel |
|--------|--------------|
| Terminal umschalten | `` Strg + ` `` |
| Terminal oder Editor fokussieren | `` Strg + Umschalt + ` `` (`` Alt + Umschalt + ` `` unter Windows/Linux) |
| Kopieren | `Mod + C` (mit Auswahl); unter Linux auch `Strg + Umschalt + C` oder `Strg + Einfg` |
| Einfügen | `Mod + V`; unter Linux auch `Strg + Umschalt + V` oder `Umschalt + Einfg` |
| Alles auswählen (nur Terminalausgabe) | `Mod + A` (`Strg + Umschalt + A` unter Linux) |
| Löschen | `Mod + K` (`Strg + Umschalt + K` unter Linux) |
| Suchen | `Mod + F` (`Strg + Umschalt + F` unter Linux) |
| Zu Sitzung 1–5 wechseln | `Mod + 1` bis `Mod + 5` |
| Terminal-Schrift vergrößern | `Mod + =` |
| Terminal-Schrift verkleinern | `Mod + -` |
| Terminal-Schrift auf Standardgröße | `Mod + 0` |
| Vorherige Eingabeaufforderung | `Mod + ↑` |
| Nächste Eingabeaufforderung | `Mod + ↓` |
| Zeilenumbruch in der Eingabezeile (Claude Code und ähnliche Tools) | `Umschalt + Eingabe` |

Solange das Terminal fokussiert ist, ändern `Mod + =`, `Mod + -` und `Mod + 0` die Schriftgröße des Terminals statt der des Editors.

Die Navigation zwischen Eingabeaufforderungen springt im Scrollback von Befehlszeile zu Befehlszeile und erfordert Shell-Integration (zsh oder bash).

Unter macOS übersetzt das Terminal außerdem die üblichen Textbearbeitungs-Tastenkombinationen für die Shell:

| Aktion | Tastenkürzel |
|--------|--------------|
| Ein Wort nach links / rechts | `Option + ←` / `Option + →` |
| Zum Zeilenanfang / -ende | `Cmd + ←` / `Cmd + →` |
| Eingabezeile löschen (sendet `Strg + U`) | `Cmd + Rücktaste` |

`Strg`-Kombinationen wie `Strg + A`, `Strg + R` und `Strg + W` gehen unter macOS direkt an die Shell.

Unter Linux folgt das Terminal der dort üblichen Terminal-Konvention: Einfache `Strg`-Buchstaben-Kombinationen gehen an die Shell, sodass Readline-Tasten wie `Strg + A`, `Strg + E`, `Strg + K`, `Strg + F`, `Strg + U` und `Strg + W` wie in jedem anderen Linux-Terminal funktionieren. Die eigenen Aktionen des Terminals liegen auf `Strg + Umschalt`: `Strg + Umschalt + A` wählt alles aus, `Strg + Umschalt + K` leert, `Strg + Umschalt + F` sucht, und `Strg + Umschalt + C` / `Strg + Umschalt + V` kopieren und fügen ein. Auch `Strg + Einfg` und `Umschalt + Einfg` kopieren und fügen ein. Zwei einfache `Strg`-Kombinationen behält das Terminal: `Strg + C` kopiert eine Auswahl (ohne Auswahl sendet es SIGINT), und `Strg + V` fügt ein. `Strg + 1` bis `Strg + 5` wechseln weiterhin die Sitzung.

Wenn die Terminal-Suchleiste geöffnet ist:

| Aktion | Tastenkürzel |
|--------|--------------|
| Nächste Übereinstimmung | `Eingabe` |
| Vorherige Übereinstimmung | `Umschalt + Eingabe` |
| Suche schließen | `Escape` |

::: tip
`Mod + C` ohne Auswahl sendet SIGINT an den laufenden Prozess. Unter [Integriertes Terminal](/de/guide/terminal) finden Sie den vollständigen Leitfaden.
:::

## Tastaturkürzel anpassen

1. Einstellungen mit `Mod + ,` öffnen
2. Zur Registerkarte **Tastenkürzel** navigieren (in das Suchfeld tippen, um nach Name, Kategorie, Beschreibung oder Taste zu filtern)
3. Auf die Taste neben einem Tastaturkürzel klicken — oder auf **Nicht zugewiesen** bei einem, das noch keine Taste hat
4. Die gewünschte Tastenkombination drücken, dann auf **Zuweisen** klicken (`Escape` bricht ab)

Der Dialog warnt Sie, bevor Sie eine Kombination zuweisen:

- **Konflikt** — die Kombination wird bereits von einem anderen Tastaturkürzel verwendet, das genannt wird. Sie können trotzdem **Trotzdem zuweisen** wählen.
- **Nicht unterstützt** — VMark kann diese Kombination nicht verwenden, daher lässt sie sich nicht zuweisen. Versuchen Sie eine andere.

Ein angepasstes Tastaturkürzel wird hervorgehoben und erhält eine Schaltfläche **Auf Standard zurücksetzen**. **Alle zurücksetzen** stellt nach einer Rückfrage alle Standardwerte wieder her. **Exportieren** speichert Ihre Tastaturkürzel als JSON-Datei (`vmark-shortcuts.json`), und **Importieren** lädt eine solche; ist ein Eintrag in der Datei ungültig, wird nichts importiert und die Probleme werden aufgelistet.

::: tip
Tastaturkürzel werden mit Menübeschleunigern synchronisiert, wenn zutreffend, sodass Menüelemente Ihre angepassten Tastaturkürzel anzeigen.
:::
