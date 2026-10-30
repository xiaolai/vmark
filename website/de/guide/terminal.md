# Integriertes Terminal

VMark enthält ein integriertes Terminal-Panel, sodass Sie Befehle ausführen können, ohne den Editor zu verlassen.

Drücken Sie `` Strg + ` ``, um das Terminal-Panel ein- oder auszublenden. Beim Öffnen landet die Einfügemarke in der Shell, beim Schließen kehrt sie in den Editor zurück — so ist das Panel erreichbar und wieder verlassbar, ohne die Maus zu berühren.

Um zwischen dem Editor und einem GEÖFFNETEN Terminal zu wechseln, ohne es auszublenden, drücken Sie `` Strg + Umschalt + ` `` (**Terminal oder Editor fokussieren**; `` Alt + Umschalt + ` `` unter Windows und Linux). Das Kürzel wechselt in beide Richtungen und ändert nie die Sichtbarkeit des Panels — ist das Terminal gerade ausgeblendet, wird es geöffnet, statt dass nichts passiert.

## Sitzungen

Das Terminal unterstützt bis zu 5 gleichzeitige Sitzungen, jede mit einem eigenen Shell-Prozess. Eine vertikale Tab-Leiste auf der rechten Seite zeigt nummerierte Sitzungs-Tabs.

| Aktion | Wie |
|--------|-----|
| Neue Sitzung | Auf die **+**-Schaltfläche klicken |
| Sitzung wechseln | Auf eine Tab-Nummer klicken |
| Sitzung schließen | Auf das Papierkorb-Symbol klicken |
| Shell neu starten | Auf das Neustart-Symbol klicken |
| Sitzung umbenennen | Doppelklick auf einen Tab, Namen eingeben, `Eingabe` drücken (`Escape` bricht ab) |
| Panel-Seite tauschen | Auf das Tauschen-Symbol (↕ / ↔) klicken, um das Terminal auf die gegenüberliegende Seite seiner aktuellen Achse zu verlegen. Im Modus **Auto** bleibt der intelligente, am Seitenverhältnis orientierte Wechsel erhalten (Querformat → seitlich, Hochformat → unten/oben) — es wird nur das andere Ende gewählt. |
| Panel maximieren | Doppelklick auf den Größengriff; erneuter Doppelklick stellt die Größe wieder her |

Wenn Sie die letzte Sitzung schließen, wird das Panel ausgeblendet, aber die Sitzung bleibt aktiv — mit `` Strg + ` `` erneut öffnen und Sie sind wieder wo Sie aufgehört haben. Wenn die Shell sauber beendet wird (`exit` oder `Strg + D`), schließt sich ihr Tab automatisch — und das Panel wird ausgeblendet, wenn es der letzte war. Endet die Shell mit einem Fehler, bleibt der Tab geöffnet und zeigt den Exit-Code; drücken Sie eine beliebige Taste, um sie neu zu starten.

Das Schließen einer Sitzung — über das Papierkorb-Symbol, durch Schließen ihres Fensters oder durch Beenden von VMark — beendet alles, was darin gestartet wurde, nicht nur die Shell. VMark sendet ein Hangup-Signal (`SIGHUP`) an die gesamte Prozessgruppe der Shell, wartet bis zu einer Sekunde, bis sie sich beendet, und beendet dann zwangsweise (`SIGKILL`), was übrig ist. Ein Job, den Sie bewusst in eine eigene Prozessgruppe abgekoppelt haben (zum Beispiel mit `nohup` oder `setsid`), ist nicht betroffen. Unter Windows gibt es keinen Hangup-Schritt: Die Shell wird sofort beendet.

**Benachrichtigungen:** Wenn ein Terminal die Glocke auslöst (z. B. wenn Claude Code eine Runde beendet), während das betreffende VMark-Fenster nicht fokussiert ist, zeigt VMark eine Systembenachrichtigung mit dem Dokument des Fensters an — so können Sie Claude Code in mehreren Fenstern laufen lassen und werden von demjenigen benachrichtigt, das Sie gerade braucht, ohne jedes einzelne im Blick zu behalten. Schalten Sie dies unter **Einstellungen → Terminal → Benachrichtigen, wenn nicht fokussiert** um (standardmäßig aktiviert; fragt bei der ersten Verwendung nach der Berechtigung für Benachrichtigungen). Dasselbe Glockensignal eines unfokussierten Fensters markiert das Fenster auch im [Fensterstatus-Panel](/de/guide/workspace-management#fensterstatus-panel), sodass Sie sehen, welches Fenster Sie braucht, und direkt dorthin springen können.

Jeder Tab zeigt den Titel des laufenden Programms (gesetzt von Werkzeugen, die einen Terminaltitel ausgeben, etwa `vim` oder `ssh`), sofern Sie die Sitzung nicht manuell umbenannt haben — eine manuelle Umbenennung hat immer Vorrang. Zum Umbenennen **doppelklicken Sie auf den Tab**: `Eingabe` übernimmt, `Escape` verwirft, und ein Klick daneben behält, was Sie eingegeben haben. Ein leerer Name wird ignoriert.

**Maximieren:** Die Größe des Panels ist auf 80 % des verfügbaren Platzes begrenzt, damit der Editor erreichbar bleibt, und ein **Doppelklick auf den Größengriff** lässt es auf diese Obergrenze springen. Ein zweiter Doppelklick bringt es auf Ihre gespeicherte Größe zurück. Das ist ein Ansichtsumschalter — die von Ihnen eingestellte Größe ändert sich dadurch nie.

**Terminal hier öffnen:** Klicken Sie im Datei-Explorer mit der rechten Maustaste auf einen beliebigen Ordner und wählen Sie **Terminal hier öffnen**, um eine Sitzung in diesem Verzeichnis zu starten. Die neue Sitzung öffnet sich dort, unabhängig davon, wo sich Ihre anderen Sitzungen gerade befinden. Bei fünf Sitzungen ist der Eintrag ausgegraut.

## Terminalsitzungen und die Workspace-Leiste

Wenn die [Workspace-Leiste](/de/guide/workspace-rail) aktiviert ist, besitzt jeder Arbeitsbereich in der Leiste seinen **eigenen Satz** an Terminalsitzungen. Ein Wechsel des Arbeitsbereichs tauscht die sichtbaren Terminal-Tabs aus — die Shells des ausgeblendeten Arbeitsbereichs bleiben genau so, wie sie waren: aktiv, im selben Arbeitsverzeichnis, ohne dass etwas in sie eingegeben wird. Beim Zurückwechseln erscheinen wieder dieselben Shells, und die Sitzung, die Sie zuletzt angesehen haben, wird pro Arbeitsbereich gemerkt.

- Neue Sitzungen gehören zu dem Arbeitsbereich, der bei ihrer Erstellung aktiv war, und starten in dessen Stammverzeichnis.
- Die Obergrenze von 5 Sitzungen und die Nummerierung `Terminal 1…5` gelten für den **sichtbaren** Satz — Sitzungen ausgeblendeter Arbeitsbereiche verbrauchen keinen Spielraum des aktiven Arbeitsbereichs.
- Wird das Panel über einem Arbeitsbereich ohne Sitzungen geöffnet, wird dort automatisch eine erstellt; ohne Arbeitsbereich (oder eine gespeicherte Datei, die ein Verzeichnis vorgibt) zeigt das Panel stattdessen einen Hinweis.
- Wird ein Arbeitsbereich in der Leiste geschlossen oder in ein eigenes Fenster verschoben, werden seine Terminalsitzungen mit ihm geschlossen.
- Ist die Leiste **ausgeschaltet**, verhält sich alles wie zuvor: ein fensterweiter Sitzungssatz, dessen untätige Shells einem Arbeitsbereichswechsel per `cd` folgen.

## Tastaturkürzel

Diese Kürzel funktionieren, wenn das Terminal-Panel fokussiert ist:

| Aktion | Kürzel |
|--------|--------|
| Kopieren | `Mod + C` (mit Auswahl) |
| Einfügen | `Mod + V` |
| Löschen | `Mod + K` |
| Suchen | `Mod + F` |
| Zeilenanfang / -ende | `Cmd + ←` / `Cmd + →` (macOS) |
| Zeile löschen | `Cmd + ⌫` (macOS) |
| Terminalschrift zoomen | `Mod + =` / `Mod + -` / `Mod + 0` |
| Gesamte Terminalausgabe auswählen | `Mod + A` |
| Zu Sitzung 1 … 5 wechseln | `Mod + 1` … `Mod + 5` |
| Terminal umschalten | `` Strg + ` `` |
| Terminal oder Editor fokussieren | `` Strg + Umschalt + ` `` |
| Vorheriger Befehlsprompt | `Mod + ↑` |
| Nächster Befehlsprompt | `Mod + ↓` |

Wenn das Terminal fokussiert ist, zoomen `Mod + =` / `-` / `0` die **Terminal**-Schrift (separat in den Terminal-Einstellungen festgelegt), nicht die Editorschrift, und `Mod + F` öffnet die **Terminal**-Suche statt der Suchleiste des Editors.

Die Prompt-Navigation (`Mod + ↑` / `Mod + ↓`) erfordert Shell-Integration — siehe [Shell-Integration](#shell-integration) weiter unten.

**Linux:** `Ctrl` + Buchstabe geht an die Shell, sodass Readline-Tasten wie `Ctrl + A`, `Ctrl + E`, `Ctrl + K`, `Ctrl + F`, `Ctrl + U` und `Ctrl + W` wie in jedem Linux-Terminal funktionieren. Die eigenen Buchstaben-Kürzel des Terminals wandern auf `Ctrl + Shift`: `Ctrl + Shift + F` sucht, `Ctrl + Shift + K` leert, `Ctrl + Shift + A` wählt alles aus, und `Ctrl + Shift + C` / `Ctrl + Shift + V` kopieren und fügen ein. `Ctrl + C` kopiert weiterhin eine Auswahl (sonst sendet es SIGINT) und `Ctrl + V` fügt weiterhin ein; `Ctrl + Insert` / `Shift + Insert` kopieren und fügen ebenfalls ein.

**Gedrückt halten für Akzente (macOS).** Wenn Sie eine Buchstabentaste gedrückt halten, öffnet sich die Akzentauswahl von macOS. Der einfache Buchstabe wurde zu diesem Zeitpunkt bereits an die Shell gesendet; wählen Sie einen Akzent, sendet VMark daher eine Rücktaste (DEL) und danach das Zeichen mit Akzent. In einem Programm, das DEL nicht als Löschen des vorherigen Zeichens behandelt, bleibt der ursprüngliche Buchstabe unter Umständen stehen.

::: tip
`Mod + C` ohne Textauswahl sendet SIGINT an den laufenden Prozess — dasselbe wie Strg+C in einem regulären Terminal.
:::

## Verlauf lesen und dabei tippen

Scrolle nach oben, um frühere Ausgaben zu lesen, und tippe einfach weiter: Die Ansicht bleibt, wo sie ist, und am unteren Rand des Terminals erscheint eine **schwebende Eingabezeile** mit einer Live-Kopie der Zeilen, in die du tippst — der Shell-Prompt oder das Eingabefeld eines TUI wie Claude Code. Tasten gehen weiterhin an die Shell, daher funktionieren Tab-Vervollständigung, Verlauf und Eingabemethoden wie gewohnt. Ein Klick auf den Pfeil am rechten Ende springt zurück zum Prompt; sobald der Prompt wieder sichtbar ist, verschwindet sie von selbst. Auch Enter oder Strg+C springen zurück, damit du siehst, was der Befehl — oder die an ein TUI gesendete Eingabe — als Nächstes tut; jede andere Taste, auch Umschalt+Enter, lässt die Ansicht stehen. Vollbildprogramme (vim, less) haben keinen Verlauf, dort erscheint sie nie.

## Suche

`Mod + F` drücken, um die Suchleiste zu öffnen. Tippen, um inkrementell im Terminal-Puffer zu suchen.

| Aktion | Kürzel |
|--------|--------|
| Nächste Übereinstimmung | `Eingabe` |
| Vorherige Übereinstimmung | `Umschalt + Eingabe` |
| Suche schließen | `Escape` |

Die Leiste meldet neben dem Eingabefeld, was sie gefunden hat:

- **`3 / 17`** — Sie befinden sich beim dritten von siebzehn Treffern.
- **`5000 Treffer`** — zu viele Treffer, als dass das Terminal verfolgen könnte,
  welcher aktiv ist; daher wird die Gesamtzahl ohne Position gemeldet.
- **Keine Treffer** — die Suche hat nichts gefunden; zusätzlich wird der
  eingegebene Text rot.

Zwischen dem Eingabefeld und den Pfeilen befinden sich drei Umschalter:

| Umschalter | Wirkung |
|------------|---------|
| **Aa** | Groß-/Kleinschreibung beachten |
| **ab** | Nur ganze Wörter |
| **.\*** | Suche als regulären Ausdruck behandeln |

Im Regex-Modus meldet ein halb eingegebenes Muster (`[` auf dem Weg zu `[a-z]`)
einfach keine Treffer, statt einen Fehler auszulösen — tippen Sie einfach weiter.
Die Umschalter werden zurückgesetzt, sobald Sie die Leiste schließen oder die
Sitzung wechseln.

## Kontextmenü

Rechtsklick innerhalb des Terminals für den Zugriff auf:

- **Kopieren** — ausgewählten Text kopieren (deaktiviert, wenn nichts ausgewählt ist)
- **Ohne Umbruch kopieren** — die Auswahl ohne die durch die Anzeigebreite bedingten Zeilenumbrüche kopieren. Manche Kommandozeilenprogramme (codex und andere TUI-Apps) brechen ihre Ausgabe fest auf die Terminalbreite um, indem sie echte Zeilenumbrüche einfügen; ein normales Kopieren behält diese Umbrüche bei. „Ohne Umbruch kopieren“ fügt umbrochene Zeilen wieder zu zusammenhängenden Absätzen zusammen (Leerzeilen bleiben als Absatzgrenzen erhalten). Es berücksichtigt CJK — chinesischer/japanischer Text wird ohne eingefügte Leerzeichen zusammengefügt. Wählen Sie einen Block aus, von dem Sie wissen, dass er ein zusammenhängender Fluss ist, denn VMark kann einen Umbruch-Zeilenwechsel nicht von einem beabsichtigten unterscheiden.
- **Einfügen** — aus der Zwischenablage in die Shell einfügen
- **Alles auswählen** — den gesamten Terminal-Puffer auswählen
- **Löschen** — sichtbare Ausgabe löschen
- **Anzeige zurücksetzen** — das Terminal neu zeichnen und seinen Rendering-Cache zurücksetzen. Verwenden Sie dies, wenn sich Zeichen nach einer langen Sitzung überlappen, Groß- und Kleinschreibung durcheinandergerät oder die Darstellung verstümmelt ist — am häufigsten bei stundenlanger Nutzung stark gestylter CLIs (z. B. Claude Code). Terminals im selben Fenster teilen sich einen Glyphen-Cache, daher werden alle Terminals des Fensters neu gezeichnet, nicht nur der aktive Tab.
- **Befehlsausgabe kopieren** — alles kopieren, was ein Befehl ausgegeben hat, ohne seine Prompt-Zeile und ohne die Ausgabe des nächsten Befehls. Erscheint nur, wenn Sie mit der rechten Maustaste in die Ausgabe eines Befehls klicken und die [Shell-Integration](#shell-integration) aktiv ist, denn nur sie teilt VMark mit, wo jeder Befehl begann und endete.

Das Menü ist vollständig per Tastatur bedienbar: Es öffnet sich mit der ersten verfügbaren Aktion im Fokus, die Pfeiltasten wechseln zwischen den Einträgen (deaktivierte werden übersprungen), Pos1/Ende springen zum ersten/letzten Eintrag, Eingabe oder Leertaste aktivieren, und Escape oder Tab schließen es.

## Einen Codeblock ausführen

Fahren Sie in Ihrem Dokument mit der Maus über einen `bash`-, `sh`-, `zsh`- oder
`shell`-Codeblock — oder einen Transkript-Codeblock mit der Kennung `console`,
`shell-session`, `shellsession` oder `terminal` —, und neben der
Kopieren-Schaltfläche erscheint die Schaltfläche **▶ Im Terminal ausführen**.
Sie fügt den Block in das Terminal ein — blendet das Panel dabei ein und startet
bei Bedarf eine Sitzung — und hört dann auf.

::: warning Einfügen, nicht ausführen
Der Befehl wird in die Eingabezeile der Shell gesetzt und **niemals für Sie
ausgeführt**: Es wird kein Zeilenumbruch angehängt, daher passiert nichts, bis
*Sie* die Eingabetaste drücken. Lesen Sie zuerst, was dort gelandet ist — ein
Dokument kann von überall stammen, und ein Codeblock ist nur Text, den jemand
geschrieben hat.
:::

Bei einem Transkript-Codeblock (`console`, `shell-session`, `shellsession`,
`terminal`) — einer eingefügten Sitzung — werden führende Prompts `$ `, `% `
und `# ` entfernt, sodass Sie den Befehl erhalten und nicht den Prompt. In einem
`bash`-Codeblock bleiben sie unangetastet, da sie dort Quellcode sind.

## Anklickbare Links

Das Terminal erkennt drei Arten von Links in der Befehlsausgabe:

- **Web-URLs** — klicken, um im Standardbrowser zu öffnen
- **OSC-8-Hyperlinks** — explizite Terminal-Hyperlinks, die von Tools wie `ls --hyperlink=auto`, `gh` und modernen Compilern ausgegeben werden. Der sichtbare Text und die zugrunde liegende URL können sich unterscheiden; ein Klick öffnet die URL.
- **Dateipfade** — ein Pfad, der ein `/` enthält und auf eine Dateiendung endet; klicken, um die Datei im Editor zu öffnen (unterstützt `:Zeile:Spalte`-Suffixe; ein relativer Pfad wird gegen das aktuelle Verzeichnis der Shell aufgelöst, sofern die [Shell-Integration](#shell-integration) es meldet, andernfalls gegen das Arbeitsbereichsstammverzeichnis)

## Shell-Umgebung

VMark setzt diese Umgebungsvariablen in jeder Terminal-Sitzung:

| Variable | Wert |
|----------|------|
| `TERM` | `xterm-256color` |
| `TERM_PROGRAM` | `WezTerm` |
| `TERM_PROGRAM_VERSION` | `20240203-110809-5046fc22` |
| `VMARK_WORKSPACE` | Arbeitsbereichsstammverzeichnis (wenn ein Ordner geöffnet ist) |
| `PATH` | Vollständiger Login-Shell-PATH (wie in Ihrem System-Terminal) |
| `COLORTERM` | `truecolor` |
| `LC_CTYPE` | `UTF-8` — **nur macOS** |

`TERM_PROGRAM` meldet `WezTerm` und nicht `vmark`, und das ist Absicht. Mehrere
CLI-Werkzeuge — darunter `/terminal-setup` von Claude Code — aktivieren die
[CSI u](https://invisible-island.net/xterm/modified-keys.html)-Tastenkodierung
nur für Terminals auf einer fest eingebauten Positivliste und fallen für alle
anderen auf einen eingeschränkten Pfad für „unbekannte Terminals“ zurück. VMark
beherrscht dieses Protokoll und gibt sich daher als das Terminal der
Positivliste aus, dessen Verhalten es am ehesten entspricht. Würde man diesen
Wert auf `vmark` ändern, gingen Umschalt+Eingabe und andere Tastenfolgen mit
Modifikatoren in diesen Werkzeugen stillschweigend kaputt. Siehe
[ADR-006](https://github.com/xiaolai/vmark/blob/main/dev-docs/decisions/ADR-006-terminal-program-identity.md).

`LC_CTYPE=UTF-8` wird **nur unter macOS** gesetzt. Eine GUI-App, die aus dem Dock
oder über Spotlight gestartet wird, erbt dort nahezu keine Umgebung; ohne diese
Variable fällt die Shell auf die C-Locale zurück, und Werkzeuge geben für
CJK-Text `?` aus. Der bloße Name `UTF-8` ist unter macOS eine Locale, unter Linux
jedoch *nicht*; dort würde das Setzen eine völlig funktionierende geerbte Locale
durch eine ungültige ersetzen — jedes Programm, das `setlocale()` aufruft, würde
sich beschweren. Unter Linux und Windows werden `LANG` / `LC_*` Ihrer
Desktop-Sitzung unverändert geerbt.

VMark setzt bewusst **kein** `EDITOR`. Ihr eigenes `$EDITOR` — was auch immer Ihre
Shell-Konfiguration exportiert — ist das, was `git commit`, `crontab -e` und
ähnliche Befehle starten. (VMark hat früher `EDITOR=vmark` erzwungen, aber der
Kommandozeilen-Shim `vmark` ist optional und kehrt sofort zurück, statt zu
warten, bis Sie den Tab schließen; `git commit` schlug daher entweder mit
„command not found“ oder mit einer leeren Commit-Nachricht fehl. Damit das
funktioniert, braucht es ein blockierendes `vmark --wait`-Protokoll, das noch
nicht gebaut ist.)

Das integrierte Terminal erbt den `PATH` Ihrer Login-Shell, sodass CLI-Tools wie `node`, `claude` und andere vom Benutzer installierte Binärdateien auffindbar sind — genau wie in einem regulären Terminal-Fenster.

Sofern Sie in den Terminal-Einstellungen keine Shell auswählen, startet VMark Ihre Login-Shell. Eine von Ihnen gewählte Shell muss eine sein, die VMark anbietet — unter macOS und Linux eine in `/etc/shells` aufgeführte Shell (oder Ihre Login-Shell), die existiert und ausführbar ist; unter Windows PowerShell, `pwsh`, `cmd.exe` oder `%COMSPEC%` —, angegeben als absoluter Pfad. Eine gespeicherte Auswahl, die nicht mehr verfügbar ist, erscheint in den Einstellungen als *(nicht verfügbar)*, und VMark startet stattdessen Ihre Standard-Shell. Unter macOS und Linux liest es die Login-Shell zuerst aus dem Eintrag Ihres Benutzerkontos, dann aus `$SHELL`, und fällt auf `/bin/sh` zurück. Unter Windows verwendet es `%COMSPEC%` und fällt auf den vollständigen Pfad von `cmd.exe` zurück. Das Arbeitsverzeichnis beginnt im Arbeitsbereichsstammverzeichnis, oder im übergeordneten Verzeichnis der aktiven Datei, oder in `$HOME`.

Standard-Shell-Kürzel wie `Strg+R` (Rückwärtshistorie-Suche in zsh/bash) funktionieren, wenn das Terminal fokussiert ist — sie werden nicht vom Editor abgefangen.

Wenn sich das Arbeitsbereichsstammverzeichnis ändert, nachdem das Terminal bereits läuft, wechseln untätige Sitzungen automatisch per `cd` zum neuen Stammverzeichnis. Eine Sitzung, die mit einem Befehl beschäftigt ist (etwa `vim` oder `less`), wird nicht unterbrochen: Sie wechselt das Verzeichnis, sobald der Befehl beendet ist, was [Shell-Integration](#shell-integration) zur Erkennung voraussetzt. Mit eingeschalteter [Workspace-Leiste](/de/guide/workspace-rail) behalten Sitzungen, die zu einem Arbeitsbereich gehören, ihr eigenes Verzeichnis. Ohne Shell-Integration — unter Windows, mit fish oder bei ausgeschalteter Einstellung — kann VMark nicht erkennen, dass eine Sitzung beschäftigt ist; das `cd` wird dann in das eingegeben, was gerade im Vordergrund läuft.

## KI-CLI-Tools und ihr eigener Browserzugriff

Ein KI-CLI-Tool wie Claude Code oder Codex CLI läuft als gewöhnliches Programm im Terminal. VMark gibt ihm drei getrennte Dinge, deren Unterscheidung ein fehlerhaftes Setup deutlich leichter diagnostizierbar macht:

| Was | Wer es bereitstellt | Was es der CLI erlaubt |
|---|---|---|
| Das Terminal | VMark | Befehle mit Ihrer Login-Shell und Ihrem `PATH` ausführen, wie in jedem Terminalfenster |
| VMark MCP | VMark, nachdem Sie seine Konfiguration unter **Einstellungen → Integrationen** installiert haben | Das in VMark geöffnete Dokument über VMarks eigene MCP-Tools lesen und schreiben |
| Browser-Tools | Der KI-Client, nicht VMark | Über die eigene Integration des Clients auf einen Browser zugreifen, etwa eine Chrome-Erweiterung oder einen Browser-Automatisierungsdienst |

VMark konfiguriert, vermittelt und verbürgt die Browser-Tools nicht. Eine Browser-Verbindung gilt als bestätigt, wenn ein echter Seitentitel aus der Sitzung gelesen wird — ein Exit-Code 0 und ein Toolname im Katalog beweisen keines von beidem. Erweiterungsinstallation, Konnektivität der Desktop-App, Tool-Erkennung und tatsächlicher Seitenzugriff sind vier getrennte Prüfungen.

Neustartgrenzen sind wichtig. Ein frisch gestarteter CLI-Prozess kann weiterhin mit einem gemeinsam genutzten Hintergrund-App-Server sprechen, der früher gestartet wurde; Client- und Serverversion können daher abweichen. Halten Sie beide bei der Fehlersuche fest. VMarks Terminal startet diese Prozesse weder neu noch isoliert es sie für Sie.

Aktivieren Sie kein Remote-Debugging, kopieren Sie keine Trust-Overrides und lockern Sie keine Native-Bridge-Prüfungen, um eine Browser-Verbindung zum Laufen zu bringen. Das erweitert das Berechtigungsmodell für jede Seite, die der Browser erreichen kann, und ein so erzieltes Ergebnis ist kein Setup-Rezept.

## Mikrofon, Kamera und Apple Events unter macOS

Programme, die Sie im integrierten Terminal ausführen, können das Mikrofon, die Kamera oder die Erlaubnis anfordern, andere Apps zu steuern (Apple Events, die `osascript` verwendet). macOS fragt im Namen von VMark, weil es VMark als verantwortliche App für alles behandelt, was das Terminal startet. Erlauben Sie den Zugriff, wenn macOS fragt; ändern können Sie ihn später unter **Systemeinstellungen → Datenschutz & Sicherheit** bei **Mikrofon**, **Kamera** oder **Automation**. Die Anfrage erfolgt, wenn ein Programm die Ressource zum ersten Mal nutzt, nicht beim Öffnen des Terminals.

Wenn ein Programm nur Stille aufnimmt, ein schwarzes Bild liefert oder einen „nicht autorisiert“-Fehler meldet, ohne dass eine Anfrage erscheint, prüfen Sie auf der jeweiligen Einstellungsseite, ob VMark aufgeführt und erlaubt ist. Fügen Sie einer Fehlermeldung die Ausgabe des Programms bei.

Bei virtuellen Audioeingängen wie BlackHole leitet die Berechtigung allein noch kein Audio weiter. Wählen Sie im Aufnahmeprogramm den gewünschten Eingang, leiten Sie das Audio dorthin und prüfen Sie vor einer längeren Sitzung eine kurze Aufnahme: Eine wachsende Audiodatei allein beweist nicht, dass Ton aufgezeichnet wurde. VMark enthält weder Rekorder noch Transkription; diese Befehle stammen aus Werkzeugen, die Sie separat installieren.

## Noch nicht implementiert

Diese Punkte sind vorgemerkt, werden aber heute **nicht** ausgeliefert. Sie sind
hier aufgeführt, weil frühere Versionen dieser Seite einige davon so beschrieben
haben, als gäbe es sie bereits:

- **Eine Sitzung pausieren / fortsetzen.** VMark kann einen Shell-Prozess intern
  anhalten — das geschieht automatisch als Flusssteuerung, wenn Ausgabe schneller
  eintrifft, als das Terminal sie darstellen kann —, aber es gibt dafür kein
  Bedienelement für Benutzer und auch kein Kontextmenü am Sitzungs-Tab, an dem
  man eines anbringen könnte.
- **Ein blockierendes `vmark --wait`**, damit `$EDITOR` auf VMark zeigen kann
  (siehe [Shell-Umgebung](#shell-umgebung) oben).
- **Erhalt des Scrollback-Verlaufs über Neustarts hinweg** (siehe
  [Persistenz](#persistenz)).
- **Shell-Integration für fish** (siehe [Shell-Integration](#shell-integration)).

## Einstellungen

Öffnen Sie **Einstellungen → Terminal** zur Konfiguration:

| Einstellung | Bereich | Standard | Plattformen |
|-------------|---------|---------|-------------|
| Panel-Größe | 10 % – 80 % des verfügbaren Platzes, in Schritten von 5 % | 40 % | Alle |
| Schriftgröße | 10 – 24 px | 13 px | Alle |
| Zeilenhöhe | 1,0 – 2,0 | 1,2 | Alle |
| Bei Auswahl kopieren | Ein / Aus | Aus | Alle |
| Gesprächsprotokolle automatisch darstellen | Ein / Aus | Aus | Alle |
| Mac Option als Meta | Ein / Aus | Ein | macOS |
| Shell-Integration | Ein / Aus | Ein | macOS / Linux (zsh, bash) |
| Zwischenablage aus der Ferne (OSC 52) | Ein / Aus | Ein | Alle |
| Scrollback-Puffer | 1.000 / 5.000 / 10.000 / 50.000 Zeilen | 5.000 | Alle |
| Screenreader-Modus | Ein / Aus | Aus | Alle |

### Gesprächsprotokolle automatisch darstellen

Aktivieren Sie **Gesprächsprotokolle automatisch darstellen**, um Markdown, auswählbare Tabellen und Mermaid-Diagramme des Assistenten in einem Bereich für das formatierte Gesprächsprotokoll innerhalb des Terminalbereichs anzuzeigen. Er befindet sich rechts neben der CLI, wenn das Terminal oben oder unten angeordnet ist, und darunter, wenn das Terminal links oder rechts angeordnet ist; die interaktive CLI bleibt daneben nutzbar.

Der Bereich ist anfangs eingeklappt. Er öffnet sich von selbst, wenn eine neue Antwort eine Tabelle oder ein Mermaid-Diagramm enthält — reine Textantworten, die das Terminal ohnehin gut darstellt, lassen ihn geschlossen. Klicken Sie jederzeit auf die Diagramm-Schaltfläche in der Tab-Leiste des Terminals (Tooltip **Formatiertes Gesprächsprotokoll**), um ihn ein- oder auszublenden; die Schaltfläche ist hervorgehoben, solange das Protokoll angezeigt wird, und beim Ausblenden erhält die CLI den gesamten Bereich zurück; nachdem Sie ihn eingeklappt haben, bleibt er bis zur nächsten Antwort mit einer Tabelle oder einem Diagramm geschlossen. Inhalte, die sich beim ersten Anzeigen der Sitzung bereits im Protokoll befinden, öffnen ihn nicht. Ein ausgeblendetes Terminal liest keine Protokolle mehr.

Beim Aktivieren wird ein lokaler `SessionStart`-Hook zur `settings.json` von Claude Code und zur `hooks.json` von Codex hinzugefügt, wobei vorhandene Hooks erhalten bleiben. Starten Sie Claude/Codex nach dem Aktivieren in einem VMark-Terminal oder setzen Sie eine Sitzung dort fort; bereits laufende Sitzungen müssen neu gestartet werden. Codex fordert Sie beim ersten Start möglicherweise auf, dem neuen Hook zu vertrauen. Erforderlich sind Node und eine CLI-Version mit Lifecycle-Hooks. Ausdrücklich deaktivierte oder durch Richtlinien eingeschränkte Hooks, entfernte SSH-Sitzungen sowie benutzerdefinierte CLI-Konfigurationsverzeichnisse, die von der Umgebung von VMark abweichen, können keine Bindung herstellen.

Jedes Terminal folgt genau seiner eigenen Sitzung statt dem zuletzt geänderten Protokoll. Die Vorschau behält bis zu 100 Assistentennachrichten aus den letzten 2 MiB der Protokolldaten. Rohes HTML und entfernte Bilder bleiben wirkungslos; ungültige Diagramme bleiben als Quelltext lesbar. Beim Deaktivieren wird der formatierte Bereich entfernt, und die Hooks von VMark werden abgeschaltet: Die SessionStart-Hook-Einträge bleiben in Ihrer Claude-Code-`settings.json` und Ihrer Codex-`hooks.json` (VMark schreibt Ihre CLI-Konfiguration nicht um, um sie zu entfernen), aber das Hook-Skript beendet sich sofort, solange die Einstellung aus ist, und VMark vergisst alle bestehenden Protokoll-Zuordnungen. Jede neue Shell erhält weiterhin eine Variable `VMARK_TRANSCRIPT_TOKEN`, sodass das Wiedereinschalten der Einstellung auch für bereits geöffnete Sitzungen funktioniert.

### Barrierefreiheit

| Einstellung | Optionen | Standard |
|-------------|----------|----------|
| Terminal-Glocke | Aus / Visuell / Hörbar | Visuell |
| Mindestkontrast | Aus / WCAG AA (4,5:1) / WCAG AAA (7:1) / Maximal | WCAG AA (4,5:1) |

Die meisten Änderungen werden sofort auf alle geöffneten Sitzungen angewendet — Panel-Größe und -Position, Schriftgröße, Zeilenhöhe, Cursor, Bei Auswahl kopieren, Mac Option als Meta, Scrollback-Puffer, Screenreader-Modus, Terminal-Glocke und Mindestkontrast. **Shell**, der **WebGL-Renderer** (unter Linux nicht verfügbar), die **Zwischenablage aus der Ferne** und die **Shell-Integration** werden beim Start einer Sitzung festgelegt und gelten daher erst für danach geöffnete Sitzungen. Die **Panel-Größe** reicht bis zu 80 % des verfügbaren Platzes. Der Editor behält eine Mindestgröße in Pixeln, sodass er nie ganz verschwindet, egal wie groß das Terminal wird. Ein Doppelklick auf den Größengriff springt direkt zum Maximum und wieder zurück, ohne die gespeicherte Größe zu ändern. **Mac Option als Meta** leitet die macOS-Option-Taste im integrierten Terminal als Meta weiter, sodass Werkzeuge wie emacs, tmux und ähnliche Alt-präfigierte Tastenkürzel sehen (nur macOS); die Einstellung ist standardmäßig aktiviert, sodass Option+Pfeil wortweise springt, statt Zeichen mit Akzent einzufügen. Die **Shell-Integration** ist unter macOS und Linux verfügbar (unter Windows ausgeblendet). Die **Zwischenablage aus der Ferne** ist nur schreibend (Lesezugriffe werden immer verweigert) und wird unten beschrieben. **Scrollback-Puffer** legt fest, wie viele Ausgabezeilen jede Sitzung in ihrem Scrollverlauf behält — höhere Werte benötigen mehr Speicher. Der **Screenreader-Modus** macht die Terminalausgabe für assistive Technologien wie VoiceOver zugänglich; er ist aus Leistungsgründen standardmäßig deaktiviert. **Terminal-Glocke** bestimmt, wie eine Glocke (BEL) signalisiert wird — als visuelle Markierung für Hintergrundaktivität auf dem Sitzungs-Tab, als leiser hörbarer Piepton (der zusätzlich den Tab einer Hintergrundsitzung markiert, damit Sie ihn finden) oder gar nicht. **Mindestkontrast** hebt blassen Terminaltext auf ein lesbares Kontrastverhältnis zu seinem Hintergrund an; erhöhen Sie den Wert für bessere Barrierefreiheit oder stellen Sie ihn auf Aus, um die Anhebung abzuschalten.

::: tip Schriftfamilie des Terminals
Das Terminal verwendet die **Monospace-Schrift** aus **Einstellungen → Editor**
und keine eigene Schrift; eine Änderung dort gestaltet daher Codeblöcke, den
Quellcode-Modus und das Terminal gemeinsam um. Unter Linux folgt die Option
Systemstandard der Monospace-Schrift Ihres Desktops, die auch Ihr
System-Terminal verwendet.
:::

::: tip Schriftgröße und Zoom
Die Schriftgröße des Terminals ist bewusst unabhängig von der Lesegröße des
Editors: Ein Terminal ist eine dichte Überwachungsfläche, und sein Standardwert
von 13 px entspricht dem, was eigenständige Terminals mitbringen, nicht dem
Lese-Standard von 18 px. `Mod + =` / `Mod + -` zoomen in Schritten von 2 px,
sodass die Terminalschrift auf einem Wert landen kann, den die Auswahlliste nicht
enthält (13 → 15 → 17 …). Die Auswahlliste zeigt die tatsächlich wirksame Größe
an und nimmt den gezoomten Wert in die Liste auf, statt Sie auf eine Vorgabe
zurückzusetzen.
:::

## Zwischenablage aus der Ferne (OSC 52)

Kopieren Sie innerhalb einer `ssh`-Sitzung, innerhalb von `tmux` oder in einem
entfernten Editor, und der Text landet in **Ihrer** Zwischenablage — nicht in der
des entfernten Rechners. Programme fordern das an, indem sie eine
OSC-52-Escape-Sequenz ausgeben; VMark leitet sie an die Systemzwischenablage
weiter.

```bash
# From anywhere the terminal can print — including over ssh:
printf '\e]52;c;%s\a' "$(printf 'hello' | base64)"
```

::: warning Nur Schreiben — Lesezugriffe werden immer verweigert
OSC 52 definiert auch eine Möglichkeit, die Zwischenablage zu *lesen*, und VMark
beantwortet diese **niemals**, auch nicht bei eingeschalteter Einstellung. Jeder
Prozess, der Bytes an Ihr Terminal ausgeben kann, könnte danach fragen — auch
`cat` auf eine Datei, die Sie nicht selbst geschrieben haben —, und die Antwort
käme an, als hätten Sie sie getippt. iTerm2 und VS Code verweigern das aus
demselben Grund. Die Einstellung steuert Schreibzugriffe; Lesezugriffe werden
bedingungslos verweigert.
:::

Schalten Sie **Einstellungen → Terminal → Zwischenablage aus der Ferne** aus, um
den Kanal vollständig zu schließen. Die Änderung gilt für neu gestartete
Sitzungen.

## Shell-Integration

Wenn die **Shell-Integration** aktiviert ist, fügt VMark leichtgewichtige
Befehlsmarkierungen in die Shell ein, damit das Terminal versteht, wo jeder
Befehl beginnt und endet. Das ermöglicht:

- **Prompt-Navigation** — `Cmd + ↑` / `Cmd + ↓` springt zum vorherigen /
  nächsten Befehlsprompt im Scrollback.
- **Exit-Status-Markierungen** — ein schmaler Randbalken markiert jede
  Befehlszeile grün (Erfolg) oder rot (Fehler).
- **Live-Verfolgung des Arbeitsverzeichnisses** — relative Dateipfade in der
  Ausgabe werden gegen das aktuelle Verzeichnis der Shell aufgelöst, und neue
  Terminals öffnen sich dort.

**zsh** und **bash** werden unter macOS und Linux unterstützt. In beiden Fällen
ist das Einfügen nicht destruktiv — Ihre echte Konfiguration wird zuerst
eingelesen, und die Hooks von VMark werden angehängt statt ersetzt, sodass Ihr
Prompt, Ihr Theme und Ihre Aliase unberührt bleiben.

| Shell | Wie VMark sich einhängt | Was erhalten bleibt |
|---|---|---|
| zsh | `ZDOTDIR` zeigt auf eine generierte `.zshrc`, die Ihre einliest und dann Hooks mit `add-zsh-hook` registriert | Ein benutzerdefiniertes `$ZDOTDIR` wird berücksichtigt: VMark ermittelt Ihr echtes über eine Login-Shell und liest `.zshenv` und `.zshrc` von dort ein, nicht nur aus `$HOME` |
| bash | `bash --rcfile <generated>`, das zuerst `~/.bashrc` einliest | Ein vorhandenes `PROMPT_COMMAND` und ein vorhandener `DEBUG`-Trap werden beide **ergänzt**, nicht ersetzt — daher funktionieren `bash-preexec`, `direnv` und `atuin` weiterhin |

Da das Terminal eine interaktive Nicht-Login-Shell ausführt, liegen reine
Login-Dateien (`.zprofile`, `.bash_profile`, `.profile`) für beide Shells
außerhalb des Geltungsbereichs — genau wie bei einem normalen Terminal-Tab.

fish ist noch nicht integriert; es läuft normal, jedoch ohne diese Funktionen.
Schalten Sie die Einstellung aus, um das Einfügen vollständig zu deaktivieren.
Änderungen gelten für neu gestartete Sitzungen (starten Sie das Terminal neu, um
sie anzuwenden).

## Persistenz

Ob das Terminal-Panel geöffnet ist, wird gespeichert und bei Hot-Exit-Neustarts wiederhergestellt. Seine Größe ist die Einstellung **Panel-Größe** — ein Anteil am Fenster, den das Ziehen des Größengriffs aktualisiert — und wird daher mit Ihren Einstellungen gespeichert und übersteht jeden Neustart, egal auf welcher Seite das Panel liegt. Shell-Prozesse selbst können nicht erhalten werden — beim Neustart wird für jede Sitzung eine frische Shell erzeugt. Auch der Scrollback-Verlauf wird nicht erhalten: Ihn wiederherzustellen hieße, alles, was durch Ihr Terminal gelaufen ist (API-Schlüssel eingeschlossen), auf die Festplatte zu schreiben; das bleibt daher bewusst einem Entwurf vorbehalten, der dieses Problem zuerst löst.
