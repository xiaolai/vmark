# Bearbeitungsverlauf nach Git exportieren

VMark führt für jedes Dokument einen Bearbeitungsverlauf: Jedes Speichern und jede Änderung, die ein KI-Client über MCP vornimmt, wird mit ihrem Urheber festgehalten. **Datei → Dokumentverlauf → Bearbeitungsverlauf nach Git exportieren…** kopiert diesen Verlauf in ein Git-Repository, damit Sie ihn mit `git log` durchsehen, vergleichen oder zusammen mit Ihrem Projekt aufbewahren können.

## So exportieren Sie

1. Öffnen Sie das Dokument, dessen Verlauf Sie möchten.
2. Wählen Sie **Datei → Dokumentverlauf → Bearbeitungsverlauf nach Git exportieren…** (oder führen Sie *Bearbeitungsverlauf nach Git exportieren* in der Befehlspalette aus).
3. Wählen Sie einen Ordner innerhalb des Git-Repositorys. Die Auswahl öffnet sich im Ordner des Dokuments.

VMark meldet, wie viele Commits hinzugekommen sind oder dass der Branch bereits aktuell war.

## Was der Branch enthält

Der Verlauf landet in einem eigenen Branch, `vmark-journal/<document-uuid>`. VMark verändert weder Ihren Arbeitsbaum noch den Index, `HEAD` oder einen anderen Branch und wechselt keine Branches. Der Branch enthält eine Datei, benannt nach dem Dokument.

- **Ein Commit pro Revision.** Autor ist, wer die Änderung vorgenommen hat (Sie oder der KI-Client), das Datum ist der Zeitpunkt der Änderung.
- **Ein Sammel-Commit pro Abschnitt bereinigten Verlaufs.** VMark bereinigt alte Revisionen, damit der Verlauf klein bleibt. Eine Folge bereinigter Revisionen wird zu einem einzigen Commit namens *Collected history*, der alle Bearbeiter dieses Abschnitts nennt.

Jede Commit-Nachricht endet mit Trailern, die sie mit VMark verknüpfen:

| Trailer | Bedeutung |
|---------|-----------|
| `VMark-Document` | Die Identität des Dokuments, in jedem Commit gleich |
| `VMark-Revision` | Die Revision, die dieser Commit festhält |
| `VMark-Parent` | Die Revision davor |
| `VMark-Actor` | Wer die Änderung vorgenommen hat |
| `VMark-Kind` | Wie sie erfasst wurde: `controlled` (eine KI-Änderung über VMark), `observed` (ein Speichern), `gap` (eine Änderung außerhalb von VMark) und weitere |
| `VMark-Tool` | Das MCP-Tool hinter einer KI-Änderung |
| `VMark-Session`, `VMark-Client` | Sitzungsbezeichnung und Name des KI-Clients, sofern angegeben |
| `VMark-Collected` | Bei einem Sammel-Commit: der Bereich bereinigter Revisionen, den er abdeckt |
| `VMark-Actors` | Bei einem Sammel-Commit: alle Bearbeiter in diesem Bereich, sortiert |

## Erneut exportieren

Exportieren Sie so oft Sie möchten. Ein weiterer Export fügt nur die Revisionen seit dem letzten hinzu; gibt es nichts Neues, ändert er nichts. Derselbe Verlauf ergibt immer dieselben Commits.

VMark verweigert den Export, statt zu überschreiben, wenn der Branch nicht mehr so ist, wie VMark ihn hinterlassen hat:

- **Der Branch hat sich seit dem letzten Export geändert** (jemand hat darauf committet, ihn zurückgesetzt oder umgeschrieben). Verschieben oder löschen Sie den Branch und exportieren Sie dann erneut.
- **Ein Branch mit diesem Namen existiert, ist aber kein VMark-Export dieses Dokuments.**
- **Der Branch ist ausgecheckt** in einem Worktree.

## Voraussetzungen und Grenzen

- Git muss installiert sein. VMark sucht es im `PATH` Ihrer Login-Shell; fehlt es, sagt der Export das.
- Exportiert wird nur gespeicherter Verlauf. Noch nicht gespeicherte Änderungen gehören nicht dazu.
- VMark erstellt Commits mit den Low-Level-Befehlen von Git, daher laufen keine Commit-Hooks. Hooks, die Branch-Aktualisierungen beobachten, laufen.
- Ein großer Verlauf dauert eine Weile: Jeder Commit kostet einige Git-Prozesse.
- In einem flachen Klon (shallow clone) setzt VMark nur einen Branch fort, den es selbst von diesem Computer aus exportiert hat.
- Checken Sie den Export-Branch nicht aus, während der Export läuft. Ein Checkout nach der letzten Worktree-Prüfung kann Index und Dateien dieses Worktrees in einem Zustand hinterlassen, der nicht zum verschobenen Branch passt.
