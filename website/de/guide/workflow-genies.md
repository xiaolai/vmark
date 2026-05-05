<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# Workflow-Genies

VMark-Genies gibt es in zwei Varianten:

- **Markdown-Genies** (`.md`) — einmalige Prompt-Vorlagen. Das ursprüngliche Genie-Format. Siehe [AI Genies](/de/guide/ai-genies).
- **Workflow-Genies** (`.yml` / `.yaml`) — mehrstufige Pipelines, die Markdown-Genies mit explizitem Datenfluss miteinander verketten.

Beide Formate liegen im selben globalen Genies-Verzeichnis und erscheinen in derselben Auswahlliste (`Cmd+Y`). Ein Workflow-Genie wird als reguläre Genie-Zeile angezeigt; die Auswahl startet den Workflow-Runner anstelle des einmaligen KI-Aufrufs.

## Wann welches Format

| Bedarf | Format |
|--------|--------|
| Einzelne Transformation (Umschreiben, Übersetzen, Zusammenfassen) | Markdown |
| Pipeline aus Gliederung → Entwurf → Politur | Workflow |
| Verschiedene KI-Modelle für verschiedene Stufen | Workflow |
| Schritte, die Genehmigungsschritte erfordern | Workflow |
| Ausgabe einer Stufe speist die nächste | Workflow |

Wenn ein einzelner Prompt ausreicht, verwende ein Markdown-Genie. Wenn du Stufen komponieren, strukturierten Datenfluss oder Genehmigung durch einen Menschen benötigst, verwende einen Workflow.

## Dateiformat

Ein Workflow-Genie ist eine YAML-Datei. Felder auf oberster Ebene:

| Feld | Erforderlich | Zweck |
|------|--------------|-------|
| `name` | Ja | Menschenlesbare Bezeichnung. Die Auswahlliste verwendet den **Dateinamen** als Anzeigenamen; dieses Feld erscheint als Beschreibung, wenn kein `description:` gesetzt ist. |
| `description` | Nein | Einzeilige Zusammenfassung in der Auswahlliste. |
| `defaults` | Nein | Standardmodell / Genehmigung / Limits, die auf jeden Schritt angewendet werden. |
| `env` | Nein | Umgebungsvariablen, verfügbar als `${VAR}` oder `${{ env.NAME }}`. |
| `steps` | Ja | Geordnete Liste der Schritte. |

### Schritt-Form

```yaml
- id: my-step
  uses: genie/<name>     # or action/<name>
  with:
    input: "text or expression"
  needs: prior-step      # optional; can also be a list
  approval: ask          # optional; "auto" (default) or "ask"
  model: claude-sonnet   # optional; overrides defaults
  limits:
    timeout: 120s        # default 300s
    max_tokens: 4096     # REST providers only
```

### Schritttypen

| `uses:`-Präfix | Verhalten |
|----------------|-----------|
| `genie/<name>` | Lädt das passende Markdown-Genie, füllt seine Vorlage mit der `with:`-Map des Schritts und ruft den aktiven KI-Anbieter auf. Die Platzhalter `{{content}}` / `{{input}}` des Markdown-Genies übernehmen `with.input` automatisch. |
| `action/read-file` | Liest einen arbeitsbereichsrelativen Pfad. Die Ausgabe ist der Dateiinhalt. |
| `action/save-file` | Schreibt `with.input` in `with.path`. |
| `action/notify` | Protokolliert `with.message`. |
| `action/copy` | Gibt `with.input` unverändert zurück (nützlich zum Verketten). |

### Ausdrücke

In jedem `with:`-Wert:

| Syntax | Wird aufgelöst zu |
|--------|-------------------|
| `${{ steps.ID.outputs.FIELD }}` | Ein bestimmtes Ausgabefeld eines vorherigen Schritts. |
| `${{ steps.ID.output }}` | Kurzform für `outputs.text` eines vorherigen Schritts. |
| `${{ env.NAME }}` | Ein Wert aus dem Workflow-`env:`. |
| `${VAR}` | Wie oben, ältere Form. |
| `stepId.output` (gesamter String) | Veralteter Alias für `${{ steps.stepId.output }}`. |

Unbekannte Schritt- oder Feldreferenzen lassen den Schritt zum Zeitpunkt der Parameterauflösung scheitern, noch bevor ein KI-Aufruf erfolgt.

### Vorlagenbindung

Wenn ein `genie/<name>`-Schritt ausgeführt wird, wird die Prompt-Vorlage seines Markdown-Genies nach diesen Regeln gefüllt:

- `{{input}}` → `with.input`
- `{{content}}` → `with.content`, falls vorhanden, sonst `with.input` (fatal, wenn keines vorhanden)
- `{{context}}` → `with.context`, falls vorhanden, sonst leerer String (niemals fatal)
- `{{any-other-key}}` → `with.<key>` (fatal, falls fehlend)

Das bedeutet, dass **bestehende Markdown-Genies in Workflows unverändert funktionieren** — rufe sie mit `with: { input: "..." }` auf, und der Platzhalter `{{content}}` greift sie über die Alias-Kette ab.

### Genehmigungsschritt

Wenn ein Schritt `approval: ask` hat (oder Workflow-`defaults.approval: ask`), pausiert der Runner, öffnet einen Dialog mit der Vorschau des aufgelösten Prompts und dem Modell und wartet auf das Urteil des Nutzers, bevor der Anbieter aufgerufen wird. Esc lehnt ab. Das Zeitlimit ist das kleinere von `limits.timeout` des Schritts und 10 Minuten.

## Beispiel

VMark wird mit einem Beispiel-Workflow `outline-and-polish.yml` in den mitgelieferten Genies ausgeliefert. Kopiere ihn in dein Benutzer-Genies-Verzeichnis, um ihn anzupassen:

```yaml
name: Outline and Polish
description: Generate an outline, then polish the output for clarity.

defaults:
  approval: auto

steps:
  - id: outline
    uses: genie/outline
    with:
      input: "Replace this seed with your topic."

  - id: polish
    uses: genie/polish
    needs: outline
    with:
      input: ${{ steps.outline.outputs.text }}
```

`genie/outline` erzeugt eine strukturierte Gliederung; der Schritt `polish` schreibt diese Ausgabe anschließend zur besseren Verständlichkeit um. Die beiden `genie/*`-Referenzen werden zu den mitgelieferten Markdown-Genies in `structure/outline.md` und `editing/polish.md` aufgelöst.

## Abbruch, Zeitlimits, Limits

- **Abbruch** — Klicke im Workflow-Seitenpanel auf Stopp. Der Runner beendet jeden laufenden CLI-Anbieter-Kindprozess innerhalb eines Ticks und verwirft laufende REST-Anfragen.
- **Zeitlimit pro Schritt** — Eingebettet in `tokio::time::timeout(step.limits.timeout)`. Bei Ablauf scheitert der Schritt mit „Timed out after Xs", und nachgelagerte Schritte werden übersprungen.
- **Ausgabe-Obergrenze** — Die Ausgabe eines einzelnen Schritts ist auf 5 MB begrenzt. Ein außer Kontrolle geratener Anbieter löst Abbruch + „Provider output exceeded 5 MB cap" aus.

## Siehe auch

- [AI Genies](/de/guide/ai-genies) — Format und Erstellung von Markdown-Genies.
- [Workflow-Viewer](/de/guide/workflow-viewer) — dasselbe React-Flow-Seitenpanel, das hier verwendet wird, ursprünglich für GitHub Actions-Workflows.

</div>
