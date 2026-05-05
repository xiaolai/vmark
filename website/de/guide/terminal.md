# Integriertes Terminal

VMark enthält ein integriertes Terminal-Panel, sodass Sie Befehle ausführen können, ohne den Editor zu verlassen.

Drücken Sie `` Strg + ` ``, um das Terminal-Panel umzuschalten.

## Sitzungen

Das Terminal unterstützt bis zu 5 gleichzeitige Sitzungen, jede mit einem eigenen Shell-Prozess. Eine vertikale Tab-Leiste auf der rechten Seite zeigt nummerierte Sitzungs-Tabs.

| Aktion | Wie |
|--------|-----|
| Neue Sitzung | Auf die **+**-Schaltfläche klicken |
| Sitzung wechseln | Auf eine Tab-Nummer klicken |
| Sitzung schließen | Auf das Papierkorb-Symbol klicken |
| Shell neu starten | Auf das Neustart-Symbol klicken |

Wenn Sie die letzte Sitzung schließen, wird das Panel ausgeblendet, aber die Sitzung bleibt aktiv — mit `` Strg + ` `` erneut öffnen und Sie sind wieder wo Sie aufgehört haben. Wenn ein Shell-Prozess beendet wird, drücken Sie eine beliebige Taste, um ihn neu zu starten.

## Tastaturkürzel

Diese Kürzel funktionieren, wenn das Terminal-Panel fokussiert ist:

| Aktion | Kürzel |
|--------|--------|
| Kopieren | `Mod + C` (mit Auswahl) |
| Einfügen | `Mod + V` |
| Löschen | `Mod + K` |
| Suchen | `Mod + F` |
| Terminal umschalten | `` Strg + ` `` |

::: tip
`Mod + C` ohne Textauswahl sendet SIGINT an den laufenden Prozess — dasselbe wie Strg+C in einem regulären Terminal.
:::

## Suche

`Mod + F` drücken, um die Suchleiste zu öffnen. Tippen, um inkrementell im Terminal-Puffer zu suchen.

| Aktion | Kürzel |
|--------|--------|
| Nächste Übereinstimmung | `Eingabe` |
| Vorherige Übereinstimmung | `Umschalt + Eingabe` |
| Suche schließen | `Escape` |

## Kontextmenü

Rechtsklick innerhalb des Terminals für den Zugriff auf:

- **Kopieren** — ausgewählten Text kopieren (deaktiviert, wenn nichts ausgewählt ist)
- **Einfügen** — aus der Zwischenablage in die Shell einfügen
- **Alles auswählen** — den gesamten Terminal-Puffer auswählen
- **Löschen** — sichtbare Ausgabe löschen

## Anklickbare Links

Das Terminal erkennt zwei Arten von Links in der Befehlsausgabe:

- **Web-URLs** — klicken, um im Standardbrowser zu öffnen
- **Dateipfade** — klicken, um die Datei im Editor zu öffnen (unterstützt `:Zeile:Spalte`-Suffixe und relative Pfade, die gegen das Arbeitsbereichsstammverzeichnis aufgelöst werden)

## Shell-Umgebung

VMark setzt diese Umgebungsvariablen in jeder Terminal-Sitzung:

| Variable | Wert |
|----------|------|
| `TERM_PROGRAM` | `vmark` |
| `EDITOR` | `vmark` |
| `VMARK_WORKSPACE` | Arbeitsbereichsstammverzeichnis (wenn ein Ordner geöffnet ist) |
| `PATH` | Vollständiger Login-Shell-PATH (wie in Ihrem System-Terminal) |

Das integrierte Terminal erbt den `PATH` Ihrer Login-Shell, sodass CLI-Tools wie `node`, `claude` und andere vom Benutzer installierte Binärdateien auffindbar sind — genau wie in einem regulären Terminal-Fenster.

Die Shell wird aus `$SHELL` gelesen (fällt auf `/bin/sh` zurück). Das Arbeitsverzeichnis beginnt im Arbeitsbereichsstammverzeichnis, oder im übergeordneten Verzeichnis der aktiven Datei, oder in `$HOME`.

Standard-Shell-Kürzel wie `Strg+R` (Rückwärtshistorie-Suche in zsh/bash) funktionieren, wenn das Terminal fokussiert ist — sie werden nicht vom Editor abgefangen.

Wenn Sie einen Arbeitsbereich oder eine Datei öffnen, nachdem das Terminal bereits läuft, wechseln alle Sitzungen automatisch per `cd` zum neuen Arbeitsbereichsstammverzeichnis.

## Pausieren / Fortsetzen

Bei lang laufenden Prozessen mit umfangreicher Ausgabe können Sie den zugrunde liegenden Shell-Prozess aus VMark heraus aussetzen, um CPU freizugeben, ohne die Sitzung zu beenden. Beim Fortsetzen läuft der Prozess dort weiter, wo er aufgehört hat.

| Aktion | Wie |
|---|---|
| Aktive Sitzung pausieren | Rechtsklick auf den Sitzungs-Tab → **Pausieren** |
| Pausierte Sitzung fortsetzen | Rechtsklick auf den pausierten Tab → **Fortsetzen** |

Während der Pause:

- Der Sitzungs-Tab zeigt einen abgeblendeten Indikator
- Die Shell empfängt `SIGSTOP` (POSIX); das Betriebssystem setzt das Scheduling für den Prozess aus
- Bereits ausgegebene gepufferte Inhalte bleiben am Bildschirm erhalten, aber bis zum Fortsetzen erscheint keine neue Ausgabe
- Die Schaltflächen für Beenden / Löschen / Neustart bleiben verfügbar

Pausieren/Fortsetzen ist ausschließlich eine macOS-/Linux-Funktion — die Windows-Prozesssteuerung kennt kein entsprechendes Suspend-Signal, daher sind die Menüpunkte in Windows-Builds ausgeblendet.

## Einstellungen

Öffnen Sie **Einstellungen → Terminal** zur Konfiguration:

| Einstellung | Bereich | Standard | Plattformen |
|-------------|---------|---------|-------------|
| Schriftgröße | 10 – 24 px | 13 px | Alle |
| Zeilenhöhe | 1,0 – 2,0 | 1,2 | Alle |
| Bei Auswahl kopieren | Ein / Aus | Aus | Alle |
| Mac Option als Meta | Ein / Aus | Aus | macOS |

Änderungen werden sofort auf alle geöffneten Sitzungen angewendet. **Mac Option als Meta** leitet die macOS-Option-Taste im integrierten Terminal als Meta weiter, sodass Werkzeuge wie emacs, tmux und ähnliche Alt-präfigierte Tastenkürzel sehen.

## Persistenz

Sichtbarkeit und Höhe des Terminal-Panels werden gespeichert und bei Hot-Exit-Neustarts wiederhergestellt. Shell-Prozesse selbst können nicht erhalten werden — beim Neustart wird für jede Sitzung eine frische Shell erzeugt, und jede pausierte Sitzung verliert zusammen mit dem Prozess auch ihren `SIGSTOP`-Zustand.
