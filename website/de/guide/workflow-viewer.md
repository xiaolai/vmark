# GitHub Actions Workflow-Viewer

VMark stellt GitHub Actions Workflow-YAML als interaktiven gerichteten azyklischen Graphen (DAG) dar und lässt Sie Jobs, Steps und Trigger über strukturierte Formulare bearbeiten — ohne dabei jemals Kommentare, Anker oder Formatierung in der zugrunde liegenden Datei zu verlieren.

Die Funktion arbeitet auf zwei Oberflächen:

1. **Eigenständige `.yml`-Dateien** unter `.github/workflows/` (oder jede Datei, deren Top-Level-Form einem Workflow entspricht): geteilte Ansicht mit dem Quelltext links und dem interaktiven Canvas + Formular-Editor rechts.
2. **Markdown-Code-Fences**: Wenn ein per Triple-Backtick mit `yaml` oder `yml` gekennzeichneter Block einen erkennbaren Workflow enthält, rendert VMark ihn inline als Mermaid-artigen DAG, genauso wie `mermaid`-Blöcke gerendert werden.

## Eigenständige Workflow-Dateien

Öffnen Sie eine beliebige Datei unter `.github/workflows/*.yml` in VMark. Das rechte Seitenpanel öffnet sich automatisch und zeigt:

- Den vollständigen Workflow als interaktives React-Flow-Canvas (Jobs als Knoten, `needs:`-Abhängigkeiten als Kanten).
- Ein strukturiertes Editor-Panel unter dem Canvas.
- Speichern-/Verwerfen-Bedienelemente in der Editor-Kopfzeile.

Klicken Sie im Canvas auf einen Job, um ihn zu bearbeiten. Klicken Sie auf einen Step innerhalb des Jobs, um diesen Step zu bearbeiten.

### Jobs bearbeiten

Bearbeitbare Felder:

| Feld | Patch-Art |
|------|-----------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Schreibgeschützte Zusammenfassung: Step-Anzahl, `needs:` und `uses:` (für wiederverwendbare Workflow-Jobs).

### Steps bearbeiten

Bearbeitbare Felder:

| Feld | Patch-Art |
|------|-----------|
| `name` | `step.set` |
| `run` (für Run-Steps) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| `with:`-Schlüssel | `with.set` / `with.remove` |

Der `with:`-Block wird als Zeilen zum Hinzufügen, Bearbeiten und Entfernen von Schlüssel-Wert-Paaren dargestellt. Beim Umbenennen eines Schlüssels wird ein `with.remove` für den alten Schlüssel und anschließend ein `with.set` für den neuen ausgegeben.

Bei `uses:`-Steps ist die Action-Referenz selbst schreibgeschützt — ändern Sie sie im Quelltext, wenn Sie eine andere Action benötigen.

### Trigger

Die Trigger-Zusammenfassung (Event, Branches, Tags, Paths, Cron, Types) ist in dieser Version schreibgeschützt. Dichte Trigger-Strukturen über einzeilige Eingabefelder zu bearbeiten, ist zu verlustbehaftet; bearbeiten Sie Trigger im Quelltext, bis ein dedizierter Picker erscheint.

## Bearbeitungen speichern

Bearbeitungen sammeln sich in einer In-Memory-Patch-Liste, während Sie Felder ändern. Die Speichern-Schaltfläche zeigt die aktuelle Anzahl an (z. B. **3 nicht gespeichert**).

Wenn Sie auf Speichern klicken, wird VMark:

1. Das aktuelle YAML aus dem Editor lesen.
2. Jeden eingereihten Patch auf den CST (Concrete Syntax Tree) des YAML anwenden — wobei Kommentare, Anker und vorhandene Formatierung erhalten bleiben.
3. Das Ergebnis zurück in den Editor schreiben, als hätten Sie es selbst getippt.

Die Datei wird im üblichen Sinne geändert markiert; drücken Sie **Cmd+S**, um auf die Festplatte zu schreiben.

### Formatierung bewahren

Der Standard-Speicherpfad führt jeden Patch durch die CST-API des `yaml`-Pakets — Kommentare, Ankerknoten, individuelle Einrückungen und vorhandene Flow-vs-Block-Stilentscheidungen bleiben erhalten.

Deaktivieren Sie **YAML-Formatierung beim Speichern bewahren** in Einstellungen → Erweitert, wenn Sie kanonisch neu formatierte Ausgabe bevorzugen. Der Reformat-Pfad verwirft Kommentare, daher ist dies ein Opt-in.

## Code-Fences in Markdown

Tippen Sie einen Workflow in einen YAML-Code-Fence ein:

````markdown
```yaml
name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```
````

VMark erkennt die Workflow-Form (Top-Level `jobs:` mit `runs-on` pro Job) und rendert das Diagramm inline. Das Diagramm ist schreibgeschützt — bearbeiten Sie den Quelltext, um den Workflow zu ändern.

## Diagnosen

VMark zeigt Parse- und Lint-Diagnosen neben dem Quelltext an:

| Code-Präfix | Bedeutung |
|-------------|-----------|
| `GHA-PARSE-*` | Fehlerhaftes YAML oder fehlende Pflicht-Schlüssel |
| `GHA-JOB-*` | Probleme auf Job-Ebene (doppelte ID, Konflikt zwischen `uses:` und `steps:`) |
| `GHA-NEEDS-*` | Abhängigkeitsprobleme (unbekannte Referenz, Zyklus) |
| `GHA-STEP-*` | Probleme auf Step-Ebene |
| `GHA-EXPR-*` | Unbekannte Kontext-Referenzen |
| `GHA-MATRIX-*` | Probleme bei der Matrix-Expansion |
| `GHA-SEC-*` | Sicherheitswarnungen (z. B. `pull_request_target`-Checkout-Muster) |
| `GHA-ACTIONLINT-*` | Weitergeleitet von `actionlint`, falls installiert |

Installieren Sie `actionlint` und aktivieren Sie **actionlint verwenden, wenn verfügbar** in Einstellungen → Erweitert für reichhaltigere Ausdrucksdiagnosen.

## Action-Metadaten

Für `uses:`-Steps, die öffentliche GitHub Actions referenzieren, kann VMark die `action.yml` jeder Action abrufen, um Eingabebeschreibungen im strukturierten Editor zu füllen. Dies ist Opt-in und wird 24 Stunden auf der Festplatte zwischengespeichert.

Schalten Sie **Action-Metadaten abrufen** in Einstellungen → Erweitert um. Deaktivieren Sie die Option, um alle Action-Referenzen rein als Text zu behandeln — es werden keine Netzwerkanfragen gestellt.

## Exporte

Das Workflow-Seitenpanel enthält drei Exportoptionen, die über sein Header-Menü erreichbar sind:

| Format | Verwendung |
|--------|------------|
| **Mermaid** | Einbetten in READMEs und andere Markdown-Dokumente. Verlustbehaftet: lässt Run-Status, Action-Symbole, individuelle Badges und Details der Matrix-Expansion weg. |
| **SVG** | Einbetten in Dokumente, die Vektorgrafiken benötigen. Verwendet `foreignObject` für HTML-Inhalte. |
| **PNG** | Teilen in Chat oder überall dort, wo SVG nicht unterstützt wird. Wird beim aktuellen Zoom des Canvas gerendert. |

## Was dies nicht ist

VMark führt keine GitHub Actions Workflows aus. Es ist ein Viewer und Editor — die Ausführung bleibt Aufgabe von GitHub. Die Funktion dient ausschließlich dem Lesen, Überprüfen und Verfassen von Workflow-YAML.
