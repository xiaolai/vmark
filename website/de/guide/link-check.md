# Link-Prüfung

VMark verifiziert, dass lokale Link- und Bildziele in Ihrem Markdown tatsächlich auf der Festplatte existieren. Läuft zusammen mit der [Markdown-Lint-Engine](/de/guide/lint) bei `Cmd-Shift-L` oder **Werkzeuge → Markdown prüfen**.

## Was geprüft wird

Für jeden lokalen Link und jedes Bild im Dokument:

- `[text](./other.md)` — die Datei `./other.md` lässt sich auflösen und existiert
- `![alt](./image.png)` — die Bilddatei existiert
- `[text](./other.md#section)` — die Datei existiert (Anker-Prüfung erfolgt durch die [`linkFragments`-Regel](/de/guide/lint#regelreferenz))

Wenn ein Ziel fehlt, wird der Linktext mit einer roten Wellenlinie unterstrichen und ein Eintrag erscheint im Lint-Badge / in der F2-Navigation.

## Was übersprungen wird

- **Reine Fragment-Links** (`#anchor`) — werden von der `linkFragments`-Regel behandelt, die gegen die Überschriften des aktuellen Dokuments prüft
- **Externe URLs** — `http://`, `https://`, `ftp://`, `mailto:`, `tel:`, `data:`, `file:`
- **Unbenannte Dokumente** — ohne gespeicherten Dateipfad lassen sich relative URLs gegen kein Verzeichnis auflösen

## Wie die Auflösung funktioniert

Link-Prüfung löst Pfade relativ zum Verzeichnis der Quelldatei auf:

| Link in `/repo/docs/intro.md` | Wird aufgelöst zu |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/repo/docs/docs/intro.md` (relativ innerhalb des Datei-Verzeichnisses verwurzelt) |

Fragmente werden vor der Datei-Suche entfernt — `[a](./other.md#section)` prüft nur `./other.md`.

## Performance

- **Asynchron** — läuft parallel zu den synchronen Regeln; Ergebnisse werden eingemischt, sobald sie bereit sind
- **Dedupliziert** — jeder eindeutige aufgelöste Pfad wird pro Lauf nur einmal geprüft, auch bei Mehrfachverlinkung
- **Kein Trigger pro Tastendruck** — `fs.exists` bei jedem Tastenanschlag würde das System überlasten; läuft nur bei explizitem Lint-Trigger
- **Toleranz gegenüber operationalen Fehlern** — wenn `fs.exists` eine Ausnahme wirft (Berechtigung verweigert, Capability-Scope-Problem), ist das Ergebnis `error` (übersprungen), nicht `missing`. Lieber stumm als falsch.

## Diagnosecodes

| Code | Schweregrad | Auslöser |
|---|---|---|
| **M001** | Fehler | Bilddatei am aufgelösten lokalen Pfad nicht gefunden |
| **M002** | Fehler | Verlinkte Datei am aufgelösten lokalen Pfad nicht gefunden |

## Siehe auch

- [Markdown-Lint](/de/guide/lint) — vollständige Regelreferenz
- [Einstellungen → Markdown → Lint](/de/guide/settings#lint)
