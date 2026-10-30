# GitHub Actions Workflow-Viewer

VMark stellt GitHub Actions Workflow-YAML als interaktiven gerichteten azyklischen Graphen (DAG) dar und lässt Sie Jobs, Steps, Trigger, Berechtigungen und Parallelität über strukturierte Formulare bearbeiten — ohne dabei jemals Kommentare, Anker oder Formatierung in der zugrunde liegenden Datei zu verlieren.

Die Funktion arbeitet auf zwei Oberflächen:

1. **Eigenständige `.yml`-Dateien** unter `.github/workflows/` (oder jede YAML-Datei mit den Top-Level-Schlüsseln `on:` und `jobs:`): geteilte Ansicht mit dem Quelltext links und dem interaktiven Canvas + Formular-Editor rechts.
2. **Markdown-Code-Fences**: Wenn ein per Triple-Backtick mit `yaml` oder `yml` gekennzeichneter Block einen erkennbaren Workflow enthält, rendert VMark ihn inline als Bild desselben Job-Graphen, so wie `mermaid`-Blöcke gerendert werden.

::: tip Nicht dasselbe wie VMarks eigene Workflows
Eine YAML-Datei, deren Top-Level-`steps:` `genie/…` oder `action/…` verwenden, ist ein [Genie-Workflow](/de/guide/workflows) — VMarks eigenes Pipeline-Format, das VMark ausführen kann. Ein GitHub Actions Workflow wird hier nur angezeigt und bearbeitet; siehe [Was dies nicht ist](#was-dies-nicht-ist).
:::

## Eigenständige Workflow-Dateien

Öffnen Sie eine beliebige Datei unter `.github/workflows/*.yml` in VMark. Die Datei öffnet sich in einer geteilten Ansicht — YAML-Quelltext links, die Workflow-Werkbank rechts (der Umschalter Quelltext / Geteilt / Vorschau wechselt die Anordnung). Die Werkbank zeigt:

- Den vollständigen Workflow als interaktives React-Flow-Canvas (Jobs als Knoten, `needs:`-Abhängigkeiten als Kanten). Seine Steuerleiste zoomt, passt den Graphen in den Bereich ein und schaltet das Layout zwischen „von oben nach unten“ und „von links nach rechts“ um — praktisch für eine lange `needs:`-Kette in einem breiten Bereich.
- Das Export-Bedienelement in der oberen rechten Ecke des Canvas (siehe [Exporte](#exporte)).
- Ein strukturiertes Editor-Panel unter dem Canvas: das [Diagnosen](#diagnosen)-Banner, die Speichern-/Verwerfen-Bedienelemente, die Formulare auf Workflow-Ebene und das Formular für den gerade ausgewählten Job oder Step.

Klicken Sie im Canvas auf einen Job, um ihn zu bearbeiten. Klicken Sie auf einen Step innerhalb des Jobs, um diesen Step zu bearbeiten. Escape hebt die Auswahl auf und gibt den Fokus an den Quelltext zurück.

Während Sie den Quelltext bearbeiten, hält VMark die beiden Bereiche synchron: Bewegen Sie den Cursor in die Zeilen eines Jobs, wird dessen Knoten im Canvas hervorgehoben, `${{ }}`-Ausdrücke werden anhand der Kontexte des geparsten Workflows automatisch vervollständigt, und ein Cmd-Klick auf eine lokale `uses:`-Referenz öffnet die Zieldatei.

### Jobs bearbeiten

Bearbeitbare Felder:

| Feld | Patch-Art |
|------|-----------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Schreibgeschützte Zusammenfassung: Step-Anzahl, `needs:` und `uses:` (für wiederverwendbare Workflow-Jobs).

**Job hinzufügen** (über den Formularen) legt einen Job mit einer von Ihnen eingegebenen ID an; er läuft auf `ubuntu-latest`, bis Sie das ändern. Die ID muss mit einem Buchstaben oder Unterstrich beginnen und darf noch nicht vergeben sein. Die Löschen-Schaltfläche des Job-Formulars entfernt den ausgewählten Job nach Ihrer Bestätigung.

Das Job-Formular listet außerdem die Steps des Jobs auf. Jede Zeile lässt sich nach oben oder unten verschieben oder (nach einer Bestätigung) löschen, und **Add step** hängt einen neuen Step als `run: echo TODO` an, bereit zur Bearbeitung.

### Steps bearbeiten

Bearbeitbare Felder:

| Feld | Patch-Art |
|------|-----------|
| `name` | `step.set` |
| `run` (für Run-Steps) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| `with:`-Schlüssel | `with.set` / `with.remove` |

Der `with:`-Block wird als Zeilen zum Hinzufügen, Bearbeiten und Entfernen von Schlüssel-Wert-Paaren dargestellt. Beim Umbenennen eines Schlüssels wird ein `with.remove` für den alten Schlüssel und anschließend ein `with.set` für den neuen ausgegeben. Ein Schlüssel, den bereits eine andere Zeile verwendet, wird direkt in der Zeile abgelehnt.

Bei `uses:`-Steps ist die Action-Referenz selbst schreibgeschützt — ändern Sie sie im Quelltext, wenn Sie eine andere Action benötigen.

Im Step-Formular wechseln **Alt + Links** / **Alt + Rechts** zum vorherigen / nächsten Step. Das Kürzel funktioniert überall im Fenster, außer in einem Textfeld, einer Auswahlliste oder einem Code-Editor, wo Alt + Pfeil seine übliche Bedeutung der wortweisen Navigation behält.

### Trigger

Ein als Mapping geschriebener Trigger (`on: { push: { branches: [main] } }`) hat bearbeitbare Filterfelder, jeweils als kommagetrennte Liste: branches, branches-ignore, tags, tags-ignore, paths, paths-ignore und types. Ein `schedule`-Cron wird als Satz in der Sprache der Oberfläche angezeigt — Tages- und Monatsnamen bleiben englische Abkürzungen aus drei Buchstaben (`Mon`, `Jan`) —, mit einer Warnung, wenn er häufiger als alle 5 Minuten läuft (GitHub drosselt solche Zeitpläne), und ist schreibgeschützt. Das gilt auch für einen Trigger, der als bloßer Event-Name oder als Liste von Namen geschrieben ist; bearbeiten Sie diese im Quelltext.

### Berechtigungen und Parallelität

Zwei Formulare auf Workflow-Ebene befinden sich über dem Job-Formular:

- **Permissions** — GitHubs Standard (kein `permissions:`-Schlüssel), `read-all`, `write-all`, `none` oder eine Tabelle pro Bereich (`contents`, `pull-requests`, …) mit jeweils read / write / none.
- **Concurrency** — die `group` und ob `cancel-in-progress` gilt. Ein als Ausdruck geschriebenes `cancel-in-progress` wird angezeigt, ist hier aber nicht bearbeitbar.

## Bearbeitungen speichern

Bearbeitungen sammeln sich in einer In-Memory-Patch-Liste, während Sie Felder ändern. Die Speichern-Schaltfläche zeigt die aktuelle Anzahl an (z. B. **3 ungespeichert**), und neue Jobs und Steps erscheinen bereits vor dem Speichern im Canvas und in den Formularen.

Wenn Sie auf Speichern klicken, wird VMark:

1. Das aktuelle YAML aus dem Editor lesen.
2. Jeden eingereihten Patch auf den CST (Concrete Syntax Tree) des YAML anwenden — wobei Kommentare, Anker und vorhandene Formatierung erhalten bleiben.
3. Bei einer Datei auf der Festplatte das Ergebnis in die Datei schreiben und danach den Editor entsprechend aktualisieren — es sei denn, Sie haben inzwischen im Quelltext getippt; dann bleibt Ihre Eingabe erhalten.

Schlägt das Schreiben fehl, geht nichts verloren: Die Bearbeitungen bleiben eingereiht, und Sie können erneut speichern. Ein unbenanntes Dokument hat keine Datei, in die geschrieben werden könnte, daher aktualisiert Speichern nur den Editor; drücken Sie **Cmd+Shift+S**, um es zu speichern. **Verwerfen** löscht die eingereihten Bearbeitungen.

### Formatierung bewahren

Der Standard-Speicherpfad führt jeden Patch durch die CST-API des `yaml`-Pakets — Kommentare, Ankerknoten, individuelle Einrückungen und vorhandene Flow-vs-Block-Stilentscheidungen bleiben erhalten.

Deaktivieren Sie **YAML-Formatierung beim Speichern beibehalten** in Einstellungen → Erweitert, wenn Sie kanonisch neu formatierte Ausgabe bevorzugen. Der Reformat-Pfad verwirft Kommentare, daher ist dies ein Opt-in.

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

VMark erkennt die Workflow-Form (Top-Level-Schlüssel `on:` und `jobs:`) und rendert inline ein Bild seines Job-Graphen — dasselbe Canvas wie in der eigenständigen Ansicht, als Bild festgehalten. Das Bild ist schreibgeschützt; doppelklicken Sie darauf, um den Quelltext zu bearbeiten.

## Diagnosen

VMark zeigt Parse- und Lint-Diagnosen in einem Banner oben im Formular-Panel an. Ein Klick auf eine Zeile springt im Quelltext zur betroffenen Zeile oder wählt den betroffenen Job aus, wenn die Zeile nicht verfügbar ist (zum Beispiel im Vorschau-Modus):

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

Installieren Sie `actionlint` für reichhaltigere Ausdrucksdiagnosen. Die Option **actionlint verwenden, falls verfügbar** finden Sie unter Einstellungen → Erweitert (Workflow-Dateien); sie ist standardmäßig eingeschaltet. Ist sie an, führt VMark die Binärdatei aus dem PATH Ihrer Login-Shell jedes Mal aus, wenn sich der Quelltext einer Workflow-Datei ändert, und hängt ihre Befunde an das Diagnosen-Banner der Werkbank an, gekennzeichnet als `GHA-ACTIONLINT-<rule>`; die oben genannten integrierten Prüfungen warten nie darauf. Ist die Option an, die Binärdatei aber nicht installiert, weist VMark einmal pro Sitzung darauf hin und bleibt ansonsten still; ist die Binärdatei vorhanden, lässt sich aber nicht ausführen, wird der Fehler einmal mit der eigenen Meldung von actionlint gemeldet. Schalten Sie die Option aus, um actionlint ganz zu überspringen. Die MCP-Operation `workflow.validate` führt dieselbe Prüfung auf Anfrage aus.

## Action-Metadaten

Für `uses:`-Steps, die öffentliche GitHub Actions referenzieren, ruft VMark die `action.yml` jeder Action ab, um Eingabebeschreibungen im strukturierten Editor zu füllen. Die Ergebnisse werden 24 Stunden auf der Festplatte zwischengespeichert. Arbeitsbereichslokale Actions (`./…`) werden von der Festplatte gelesen, nie aus dem Netzwerk.

Um den Workflow-Editor vollständig offline zu halten, schalten Sie **Action-Metadaten abrufen** in Einstellungen → Erweitert (Workflow-Dateien) aus — dann werden keine Netzwerkanfragen gestellt, und das `with:`-Formular fällt auf frei eingebbare Schlüssel-Wert-Zeilen zurück.

## Exporte

Das Export-Bedienelement in der oberen rechten Ecke des Canvas bietet drei Formate:

| Format | Verwendung |
|--------|------------|
| **Mermaid** | Einbetten in READMEs und andere Markdown-Dokumente. Wird in die Zwischenablage kopiert. Verlustbehaftet: lässt Run-Status, Action-Symbole, individuelle Badges und Details der Matrix-Expansion weg. |
| **SVG** | Einbetten in Dokumente, die Vektorgrafiken benötigen. Verwendet `foreignObject` für HTML-Inhalte. |
| **PNG** | Teilen in Chat oder überall dort, wo SVG nicht unterstützt wird. Wird beim aktuellen Zoom des Canvas gerendert. |

## Was dies nicht ist

VMark führt keine GitHub Actions Workflows aus. Es ist ein Viewer und Editor — die Ausführung bleibt Aufgabe von GitHub. Die Funktion dient ausschließlich dem Lesen, Überprüfen und Verfassen von Workflow-YAML. VMarks eigene ausführbare Pipelines sind ein anderes Format: siehe [Genie-Workflows](/de/guide/workflows).
