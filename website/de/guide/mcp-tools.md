# MCP-Tools-Referenz

VMark stellt KI-Assistenten **vier zusammengesetzte MCP-Tools** zur Verfügung: `session`, `workspace`, `document` und `workflow`. Zusammen decken sie **14 Aktionen** ab — das Lese-/Schreibgerüst, den Datei- und Fenster-Lebenszyklus sowie CST-sichere Bearbeitungen für GitHub Actions YAML.

Die frühere Oberfläche mit 12 Tools und 76 Aktionen wurde reduziert, weil dokumentinterne Formatierungs-Tools (Fettdruck, Überschriften, Tabellen usw.) Arbeit duplizieren, die KI-Agenten ohnehin trivial über einen Markdown-Roundtrip erledigen. Die vollständige Begründung steht im [MCP-Pruning-Plan](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md).

::: tip Empfohlener Arbeitsablauf
1. Rufen Sie `session.get_state` einmal auf, um offene Fenster, Tabs und pro Tab `{filePath, dirty, revision, kind}` zu sehen.
2. Für Markdown: `document.read` → überlegen → `document.write` (mit `expected_revision` für sichere Nebenläufigkeit).
3. Für GitHub Actions YAML (`kind: "yaml-workflow"`): `workflow.apply_patch` für CST-sichere Bearbeitungen, die Kommentare und Anker bewahren; `workflow.validate` für actionlint-Diagnosen.
4. Dateioperationen (Öffnen, Speichern, Schließen, Tabs wechseln) liegen auf `workspace`.
:::

::: tip Mermaid-Diagramme
Wenn Sie Mermaid via MCP per KI generieren, sollten Sie den [mermaid-validator MCP-Server](/de/guide/mermaid#mermaid-validator-mcp-server-syntaxprufung) installieren — er erkennt Syntaxfehler mit denselben Mermaid-v11-Parsern, bevor die Diagramme Ihr Dokument erreichen.
:::

---

## `session`

Einmalige Orientierung. Entdecken Sie jedes Fenster, jeden Tab und die Fähigkeiten des Servers in einem einzigen Aufruf.

### `get_state`

Keine Argumente.

**Rückgabe** `{windows, capabilities}`:

```json
{
  "windows": [
    {
      "label": "main",
      "focused": true,
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown"
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow"
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.1.0"
  }
}
```

Der `kind`-Diskriminator zeigt Ihnen, ob für diesen Tab `document.write` (für Markdown) oder `workflow.apply_patch` (für yaml-workflow) zu verwenden ist.

---

## `workspace`

Datei- und Fenster-Lebenszyklus. Nichts dokumentintern.

### `new`

Einen neuen unbenannten Tab anlegen.

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `kind` | string | Nein | `"markdown"` (Standard) oder `"yaml-workflow"` |
| `windowLabel` | string | Nein | Zielfenster; Standard ist das fokussierte |

Gibt `{tabId}` zurück.

### `open`

Eine Datei von der Festplatte öffnen.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `filePath` | string | Ja |
| `windowLabel` | string | Nein |

Gibt `{tabId}` zurück.

### `save`

Einen Tab unter seinem bestehenden Pfad speichern.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein (Standard ist der fokussierte) |

Gibt `{filePath, revision}` zurück.

### `save_as`

Einen Tab unter einem neuen Pfad speichern.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |
| `filePath` | string | Ja |

Gibt `{revision}` zurück.

### `close`

Einen Tab schließen. Verwirft ungespeicherte Arbeit nicht ohne `force`.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Ja |
| `force` | boolean | Nein |

Gibt bei Erfolg `{closed: true}` zurück, bzw. `{closed: false, reason: "DIRTY"}`, wenn der Tab ungespeicherte Änderungen hat und `force` nicht angegeben wurde.

### `switch_tab`

Einen Tab aktivieren.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Ja |

### `focus_window`

Ein Fenster fokussieren.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `windowLabel` | string | Ja |

---

## `document`

Lesen, schreiben, transformieren. Das Rückgrat der Oberfläche.

### `read`

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein (Standard ist der fokussierte) |

Gibt `{content, revision, filePath, kind, dirty}` zurück. Lesen Sie immer vor dem Schreiben — der `revision`-Token muss den nächsten `write` begleiten.

### `write`

Den vollständigen Dokumentinhalt ersetzen.

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `tabId` | string | Nein | Ziel-Tab (Standard ist der fokussierte) |
| `content` | string | Ja | Neuer Gesamtinhalt |
| `expected_revision` | string | Nein | Revisions-Token aus dem letzten read |

Wird `expected_revision` übergeben und das Dokument hat sich seit diesem Lesevorgang geändert, ist die Antwort eine strukturierte Fehlerhülle `STALE` mit der aktuellen Revision; erneut lesen und wiederholen.

```json
// success
{ "revision": "rev-newAfterWrite" }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

Eine deterministische Umschreibung anwenden. Aktuell werden CJK-spezifische Transformationen unterstützt (Konvertierung Vollbreite ↔ ASCII-Interpunktion, CJK ↔ Latein-Abstand).

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `tabId` | string | Nein | Ziel-Tab |
| `kind` | string | Ja | `"cjk-format"`, `"cjk-spacing"` oder `"cjk-punctuation"` |
| `expected_revision` | string | Nein | Nebenläufigkeits-Token |

`cjk-format` wendet die CJK-Formatierungseinstellungen des Benutzers durchgehend an. `cjk-spacing` fügt einzelne Leerzeichen zwischen CJK-Zeichen und benachbarten lateinischen Zeichen oder Ziffern ein. `cjk-punctuation` konvertiert ASCII-Interpunktion, die neben CJK-Zeichen steht, in ihre Vollbreitenform.

Gibt `{revision}` zurück.

---

## `workflow`

`actionlint`-Validierung und **CST-sichere chirurgische Bearbeitungen** für GitHub Actions Workflow-YAML. Nur für Tabs mit `kind` gleich `"yaml-workflow"` verfügbar.

::: info `document.read` / `document.write` funktionieren auf jedem Tab — auch bei Workflow-YAML
Das `workflow`-Tool ist **kein** Ersatz für das Lese-/Schreibgerüst. Bei einem Workflow-Tab können Sie:

- `document.read` aufrufen, um den rohen YAML-Text (mit allen Kommentaren) zu erhalten
- `document.write` verwenden, um ihn vollständig zu ersetzen (was Sie senden, wird wortgetreu gespeichert — Kommentare bleiben erhalten, wenn Sie sie mitschicken)
- `workflow.apply_patch` einsetzen, wenn der Server selbst **garantieren** soll, dass Kommentare, Anker und Schlüsselreihenfolge eine Teilbearbeitung überleben

Verwenden Sie `apply_patch`, wenn Sie ein einzelnes Feld ändern und alles andere unangetastet lassen wollen (der Server kann keine Kommentare verlieren, die er nicht ändert). Verwenden Sie `document.write`, wenn Sie pauschal umschreiben oder einen neuen Workflow von Grund auf erzeugen.
:::

### `apply_patch`

Ein Array von `IRPatch`-Objekten anwenden. Patches werden über die CST-bewussten Mutatoren von VMark abgewickelt, die Kommentare, Anker und Schlüsselreihenfolge bewahren. Ein einfacher `document.write` auf eine YAML-Datei würde sie verlieren.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |
| `patches` | IRPatch[] | Ja |
| `expected_revision` | string | Nein |

`IRPatch` ist eine diskriminierte Vereinigung (`kind`-Feld). Unterstützte Arten:

| `kind` | Wirkung |
|---|---|
| `workflow.set` | Top-Level-Felder setzen (`{path, value}`) — `name`, `env.X` usw. |
| `job.set` | Ein Feld eines Jobs setzen (`{jobId, path, value}`) |
| `step.set` | Ein Feld eines Steps setzen (`{jobId, stepIndex, path, value}`) |
| `with.set` | Einen Schlüssel im `with:`-Block eines Steps setzen (`{jobId, stepIndex, key, value}`) |
| `with.remove` | Einen Schlüssel aus dem `with:`-Block eines Steps entfernen |
| `needs.add` / `needs.remove` | Eine Job-ID zu `needs:` hinzufügen oder daraus entfernen |
| `trigger.setFilters` | Ein Trigger-Filter-Array ersetzen — Branches, Pfade, Typen usw. (`{event, filter, value: string[]}`) |

Gibt bei Erfolg `{revision}` zurück oder eine strukturierte Fehlerhülle `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW`.

### `validate`

`actionlint` über das Workflow-YAML laufen lassen.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |

Gibt `{ok, diagnostics, binaryAvailable}` zurück. Jede Diagnose trägt `{line, col, message, severity}`. `binaryAvailable: false` bedeutet, dass `actionlint` lokal nicht installiert ist; Installation über Homebrew oder die Upstream-Releases.

---

## Fehler

Es treten zwei Fehlerformen auf:

**Domänenfehler** — setzen `success: false` und liefern eine JSON-codierte Hülle in `error`:

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**Argument-Form-Fehler** — bei fehlenden oder ungültigen Pflichtargumenten (z. B. `document.write` ohne `content`-Feld) ist `error` eine einfache Zeichenkette, die das Problem beschreibt. Die strukturierte Hülle bleibt domänenspezifischen Bedingungen vorbehalten.

| Code | Form | Bedeutung |
|---|---|---|
| `STALE` | Hülle | `expected_revision` stimmte nicht; erneut lesen und wiederholen |
| `INVALID_PATCH` | Hülle | `workflow.apply_patch` hat ein fehlerhaftes `patches`-Array erhalten |
| `INVALID_TAB` | Hülle | `tabId` konnte nicht aufgelöst werden |
| `INVALID_PATH` | Hülle | `workspace.open` hat einen `filePath` erhalten, der nicht gelesen werden konnte |
| `NOT_WORKFLOW` | Hülle | `workflow.*` wurde auf einem Tab aufgerufen, der kein YAML-Workflow ist |
| `READ_ONLY` | Hülle | Eine Mutation wurde auf einem schreibgeschützten Dokument versucht |
| `INTERNAL` | Hülle | Unerwarteter Handler-Fehler |
| (einfache Zeichenkette) | string | Pflichtargument fehlt oder hat falschen Typ |
