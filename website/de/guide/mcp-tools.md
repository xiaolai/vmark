# MCP-Tools-Referenz

VMark stellt KI-Assistenten **zehn zusammengesetzte MCP-Tools** zur Verfügung: `session`, `workspace`, `document`, `workflow`, `selection`, `comments`, `browser`, `browser_read`, `coherence` und `coherence_resolve`. Zusammen decken sie das Editor-Rückgrat, den Datei- und Fenster-Lebenszyklus, CST-sichere Workflow-Bearbeitungen, gezielte Bearbeitungen der Auswahl, begrenzte Browser-Navigation und eine Sicht auf die Kohärenzschicht des Arbeitsbereichs ab.

Drei der zehn — `session`, `browser_read` und `coherence` — deklarieren `readOnlyHint: true`, sodass ein MCP-Client sie automatisch genehmigen kann. Genau deshalb sind `browser`/`browser_read` und `coherence`/`coherence_resolve` überhaupt getrennte Tools: Annotationen gelten **pro Tool**, nicht pro Aktion, sodass ein Tool, das einen ARIA-Snapshot mit `execute_js` bündelt, die Gefahr von `execute_js` ausweisen müsste. Die Aufteilung entlang der Frage „Verändert dies etwas?“ lässt jede Hälfte die Wahrheit sagen und hält die wirklich destruktiven Aktionen der Oberfläche in der Tool-Liste auffällig.

Die frühere Oberfläche mit 12 Tools und 76 Aktionen wurde reduziert, weil dokumentinterne Formatierungs-Tools (Fettdruck, Überschriften, Tabellen usw.) Arbeit duplizieren, die KI-Agenten ohnehin trivial über einen Markdown-Roundtrip erledigen. `selection` wurde beibehalten (gemäß ADR-7 des Pruning-Plans), weil der Roundtrip über das gesamte Dokument bei großen Dateien unwirtschaftlich ist — jede Bearbeitung bezahlt das ganze Dokument an Eingabe-Tokens, das ganze Dokument an Ausgabe-Tokens (~5× Eingabepreis) und ein längeres Schreibfenster, das die Wiederholungsschleife bei veralteten Revisionen vergrößert. Die vollständige Begründung steht im [MCP-Pruning-Plan](https://github.com/xiaolai/vmark/blob/main/.claude/adr/plans/20260504-mcp-pruning.md).

::: tip Empfohlener Arbeitsablauf
1. Rufen Sie `session.get_state` einmal auf, um offene Fenster, Tabs und pro Tab `{filePath, dirty, revision, kind}` zu sehen.
2. Für kleine Markdown-Änderungen oder vollständige Neufassungen: `document.read` → überlegen → `document.write` (mit `expected_revision` für sichere Nebenläufigkeit).
3. Für gezielte Bearbeitungen einer großen Markdown-Datei, wenn der Benutzer den zu ändernden Bereich ausgewählt hat: `selection.get` → überlegen → `selection.set` (senkt sowohl die Eingabe- als auch die Ausgabe-Token-Kosten auf die Auswahl).
4. Für GitHub Actions YAML (`kind: "yaml-workflow"`): `workflow.apply_patch` für CST-sichere Bearbeitungen, die Kommentare und Anker bewahren; `workflow.validate` für actionlint-Diagnosen.
5. Dateioperationen (Öffnen, Speichern, Schließen, Tabs wechseln) liegen auf `workspace`.
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
      "activeWorkspaceInstanceId": "wsi-a1b2c3",
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown",
          "active": true,
          "visible": true
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow",
          "active": false,
          "visible": false
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.2.0"
  }
}
```

#### Wissen, was tatsächlich auf dem Bildschirm ist

Ein Tab kann existieren, adressierbar sein und trotzdem nicht angezeigt werden. Drei Felder sagen das aus:

| Feld | Bedeutung |
|---|---|
| `tab.active` | Dieser Tab ist der aktuelle Tab seines Fensters. |
| `tab.visible` | Dieser Tab wird gerade jetzt gerendert. Er ist `false`, wenn der Tab zu einer Arbeitsbereichs-Instanz gehört, die das Fenster aktuell nicht anzeigt. |
| `window.activeWorkspaceInstanceId` | Die Arbeitsbereichs-Instanz, die das Fenster anzeigt, oder `null`, wenn die Workspace-Leiste aus ist (dann ist jeder Tab sichtbar). |

`window.focused` ist das Fenster, auf das der **Benutzer** blickt, ausgelesen aus dem Betriebssystem. Es ist nicht „das Fenster, das diese Anfrage beantwortet hat“ — VMark leitet eine Anfrage an dasjenige Fenster, dem der betreffende Arbeitsbereich gehört, was in einer Sitzung mit mehreren Fenstern oft ein anderes ist.

`windows` listet jedes Dokumentfenster auf — `main` und jedes aus dem Finder oder über die Befehlszeile geöffnete Fenster —, denn VMark fragt sie alle ab. Während Sie in Ihrem KI-Client tippen, hat kein VMark-Fenster den Fokus, und jedes `focused` ist `false`; eine Anfrage ohne `tabId` und ohne Arbeitsbereichspfad geht dann an das zuletzt verwendete Dokumentfenster, nicht an `main`.

Behandeln Sie diese als Bestätigungsschritt: Nach `workspace.switch_tab` sagt Ihnen ein anschließendes `get_state`, ob der Tab wirklich vor dem Benutzer ist. `switch_tab` selbst liest die Stores erneut, bevor es antwortet, sodass es `activated: false` meldet, wenn eine Aktivierung nicht angekommen ist, statt die Anfrage einfach zurückzuspiegeln.

Der `kind`-Diskriminator zeigt Ihnen, ob für diesen Tab `document.write` (für Markdown) oder `workflow.apply_patch` (für yaml-workflow) zu verwenden ist.

---

## `workspace`

Datei- und Fenster-Lebenszyklus. Nichts dokumentintern.

> **Pfad-Geltungsbereich.** Dateioperationen (`open`, `save`, `save_as`) sind auf
> das Wurzelverzeichnis des offenen Arbeitsbereichs und die Verzeichnisse bereits
> geöffneter Dokumente beschränkt. Eine Anfrage nach einem Pfad außerhalb dieses
> Geltungsbereichs wird mit `INVALID_PATH` abgelehnt. Ohne Arbeitsbereich und ohne
> geöffnetes Dokument gibt es keinen Geltungsbereich, sodass Dateioperationen
> abgelehnt werden. So bleibt ein automatisierter Client innerhalb dessen, was Sie
> geöffnet haben.

### `new`

Einen neuen unbenannten Tab anlegen.

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `kind` | string | Nein | `"markdown"` (Standard) oder `"yaml-workflow"` |
| `windowLabel` | string | Nein | Zielfenster; Standard ist das fokussierte |

Gibt `{tabId}` zurück.

### `open`

Eine **Datei** von der Festplatte in einen **Hintergrund**-Tab öffnen — der sichtbare Tab und Arbeitsbereich des Benutzers ändern sich nicht. Verketten Sie die zurückgegebene `tabId` in `document`- / `selection`-Aufrufe; verwenden Sie `switch_tab` nur, wenn der Benutzer den Tab *sehen* soll.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `filePath` | string | Ja |
| `windowLabel` | string | Nein |

Gibt `{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}` zurück.

### `open_workspace`

Einen **Ordner** als aktiven Arbeitsbereich öffnen. Anders als `open` (eine einzelne Datei innerhalb eines bereits freigegebenen Baums) gewährt dies dem Assistenten Zugriff auf einen ganz neuen Dateibaum, weshalb es **durch eine einmalige Benutzerfreigabe abgesichert** ist und nicht vom obigen Pfad-Geltungsbereich abgedeckt wird.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `folderPath` | string | Ja |

`windowLabel` wird hier **nicht** akzeptiert, anders als bei `new` und `open`. Der Ordner wird immer in dem Fenster geöffnet, in dem die Anfrage eintrifft. Das ist Absicht: Der Freigabedialog und das Öffnen müssen im selben Fenster landen, und ein vom Client gelieferter Label könnte die Abfrage vor ein Fenster stellen, während ein anderes verändert wird — man genehmigt das eine und bekommt das andere. Eine Mehrfenster-Zielsteuerung benötigt ein Anfrage-Routing, das es noch nicht gibt.

**Freigabeablauf.** Der erste Aufruf gibt `{needsApproval: true}` zurück und blendet einen Zustimmungsdialog ein, der den *kanonischen* Ordnerpfad nennt (Symlinks aufgelöst). Der Assistent sollte den Benutzer fragen und dann **denselben Aufruf wiederholen**; sobald der Benutzer zustimmt, öffnet die Wiederholung den Ordner. Eine abgelehnte Anfrage schlägt weiter fehl, bis sie erneut freigegeben wird. Es gibt keine „Merken“-Option — jedes Öffnen wird einzeln freigegeben.

**Ordnerzugriff.** Die Bestätigung im Dialog allein erlaubt VMark nicht, einen Ordner außerhalb der immer lesbaren Orte (Ihr Benutzerordner und eingebundene Laufwerke) zu lesen. Für einen solchen Ordner öffnet der bestätigte erneute Aufruf die Ordnerauswahl von VMark bei diesem Ordner und antwortet mit `APPROVAL_REQUIRED` — der Benutzer muss ihn dort auswählen; danach öffnet der nächste Aufruf ihn. Ist bereits ein anderer Ordnerdialog offen, wird nichts angezeigt und die Antwort lautet `BUSY` — die Bestätigung bleibt erhalten, also erneut versuchen, sobald der Benutzer diesen Dialog geschlossen hat. `BUSY` kommt auch, solange in diesem Fenster bereits ein Arbeitsbereichswechsel läuft.

### `save`

Einen Tab unter seinem bestehenden Pfad speichern.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein (Standard ist der fokussierte) |

Gibt `{filePath, revision, journaled}` zurück.

### `save_as`

Einen Tab unter einem neuen Pfad speichern.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |
| `filePath` | string | Ja |

Gibt `{revision, journaled}` zurück.

Das Speichern unter einem anderen Pfad als der aktuellen Datei des Tabs wird als neuer Schreibvorgang behandelt. Wenn **Speichern an neuem Ort und Genie-Ergebnisse automatisch genehmigen** (Einstellungen → Integrationen) aus ist (Standard), wird eine solche Anfrage mit `APPROVAL_REQUIRED` abgelehnt, und eine Benachrichtigung teilt Ihnen mit, was blockiert wurde. Das Zurückspeichern unter dem eigenen Pfad des Tabs ist immer erlaubt.

Die Pfadprüfung läuft erneut, wenn das Speichern in der Warteschlange der Speichervorgänge für diese Datei an der Reihe ist. Ein Pfad, der bis dahin den zulässigen Bereich verlassen hat (etwa weil der Arbeitsbereich geschlossen wurde, während das Speichern wartete), wird mit `INVALID_PATH` abgelehnt, und es wird nichts geschrieben.

`save_as` ersetzt nie eine Datei, die nicht die eigene Datei des Tabs ist. Ein Ziel, an dem bereits eine Datei liegt, wird mit `APPROVAL_REQUIRED` abgelehnt — auch eine Datei, die erst nach der Prüfung der Anfrage entstanden ist, während das Speichern lief: Die Datei wird nur geschrieben, wenn in dem Moment, in dem sie an ihren Platz kommt, nichts unter diesem Pfad liegt, und die dort gefundene Datei behält ihren Inhalt. Kann das Laufwerk so nicht schreiben, wird das Speichern abgelehnt, statt zu überschreiben.

Ein `save` oder `save_as` wird mit `STALE` abgelehnt, wenn bereits ein nach diesem vorgenommenes Speichern — aus einem beliebigen Dokument oder Fenster — diese Datei erreicht hat (zum Beispiel über einen Symlink und die Datei, auf die er zeigt), sodass dieses ältere nichts geschrieben hat. Das Dokument vor einem erneuten Schreiben lesen. `document.write` meldet denselben Fall als `saved: false` mit einem `save_error`.

### `close`

Einen Dokument-Tab schließen. Verwirft ungespeicherte Arbeit nicht ohne `force` und schließt nie einen angehefteten Tab.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Ja |
| `force` | boolean | Nein |

Gibt bei Erfolg `{closed: true}` zurück. Andernfalls `{closed: false, reason}`:

| `reason` | Bedeutung |
|----------|-----------|
| `DIRTY` | Der Tab hat ungespeicherte Änderungen und `force` wurde nicht angegeben |
| `DIVERGENT` | Die Datei hat sich auf dem Datenträger geändert und der Benutzer hat die Version des Tabs behalten; ohne `force` würde das Schließen sie verlieren |
| `PINNED` | Der Tab ist angeheftet — wird selbst mit `force` abgelehnt; der Benutzer muss ihn lösen |

Tastenanschläge, die der Editor noch nicht weitergegeben hat, zählen vor der Prüfung als ungespeichert. Ein Browser-Tab wird mit einem `INVALID_TAB`-Fehler abgelehnt — schließen Sie ihn mit der Aktion `close` des Tools `browser`.

### `switch_tab`

Einen Tab aktivieren und **sichtbar** machen. Bei aktivierter [Workspace-Leiste](/de/guide/workspace-rail) kann dies den aktiven Arbeitsbereichs-Kontext des Benutzers wechseln — die Antwort meldet dann `workspaceSwitched: true`, sodass der Assistent den Benutzer informieren sollte.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Ja |

Gibt `{activated, workspaceSwitched, workspaceInstanceId, activeTabId}` zurück.

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
| `addresses` | string[] | Nein | Kommentar-IDs aus `comments.list`, die diese Bearbeitung beantwortet (höchstens 64) |
| `save` | boolean | Nein | Auch auf dem Datenträger speichern (Standard `true`); `false` ändert nur den Tab |

Standardmäßig wird der Schreibvorgang gespeichert: Die Antwort trägt `saved: true` oder `saved: false` mit `save_skipped` (`"untitled"` — der Tab hat noch keine Datei, verwenden Sie `save_as`; `"opt_out"` — Sie haben `save: false` übergeben) oder `save_error` (das Schreiben auf den Datenträger ist fehlgeschlagen). Ist das Ziel der aktive WYSIWYG-Tab eines Markdown-Dokuments, wird der Text in den laufenden Editor geladen (als ein rückgängig machbarer Schritt), und gespeichert wird dessen Serialisierung durch den Editor — dasselbe Markdown, möglicherweise normalisiert, nicht unbedingt genau die gesendeten Zeichen. Andere Tabs speichern den Text wie gesendet, mit normalisierten Zeilenenden.

Wird der Tab geschlossen, nachdem der Schreibvorgang ihn geändert hat, aber bevor gespeichert wurde, lautet die Antwort `saved: false` mit einem `save_error`, der meldet, dass der Tab geschlossen wurde. In den Pfad, den der Tab hatte, wird nichts geschrieben.

Jede Speicherung durch einen KI-Client — über `write`, `workspace.save` oder `workspace.save_as` — wird im Verlauf des Dokuments als `mcp`-Snapshot abgelegt (in der Verlaufs-Seitenleiste mit *(mcp)* beschriftet), sodass sich die von einer KI geschriebenen Versionen von Ihren abheben. Wie eine manuelle Speicherung wird sie nie mit einer benachbarten automatischen Speicherung zusammengeführt oder wegen ihrer Größe übersprungen.

Jede Antwort auf eine Speicherung enthält außerdem `journaled` — bei `write` nur, wenn gespeichert wurde. `"yes"`: VMarks Agent-Bearbeitungsjournal hat den gespeicherten Text aufgezeichnet. `"pending"`: er ist aufgezeichnet und erhält seinen Platz in der Dokumentgeschichte, sobald ein noch laufender Schreibvorgang aufgezeichnet ist. `"no"`: die Datei ist gespeichert, das Journal hat sie aber nicht aufgezeichnet. Wegen des Journals ist eine Speicherung nie ein Fehler.

Wird `expected_revision` übergeben und das Dokument hat sich seit diesem Lesevorgang geändert, ist die Antwort eine strukturierte Fehlerhülle `STALE` mit der aktuellen Revision; erneut lesen und wiederholen.

```json
// success
{ "revision": "rev-newAfterWrite", "applied": true, "durable": true, "saved": true }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

Während der Benutzer im WYSIWYG-Editor, der den Tab anzeigt, mit einer Eingabemethode (IME) Text komponiert, wird der Schreibvorgang mit `BUSY` abgelehnt und nichts ändert sich: Der Text in Komposition gehört der Eingabemethode, bis er bestätigt ist. Kurz darauf erneut versuchen. Im Quellmodus wird der Schreibvorgang angenommen, und der Editor zeigt ihn, sobald die Komposition endet.

Jeder Schreibvorgang wird im Agenten-Bearbeitungsjournal von VMark festgehalten, bevor sich etwas ändert. Die Erfolgsantwort enthält `applied: true` und `durable`: `durable: false` bedeutet, dass der Inhalt geschrieben wurde, sein Journaleintrag aber noch nicht gespeichert werden konnte — VMark wiederholt das im Hintergrund, und bis dahin wird der nächste Schreibvorgang in dieses Dokument mit `JOURNAL_DEGRADED` abgelehnt. Lehnt das Journal den Eintrag ganz ab, bleibt der Schreibvorgang angewendet, wird als nicht erfasst protokolliert, und der nächste Schreibvorgang läuft normal. Ein Schreibvorgang wird ohne Änderung abgelehnt: mit `JOURNAL_BUSY`, solange ein anderer Schreibvorgang in dasselbe Dokument festgehalten wird (zwei Fenster mit derselben Datei teilen sich ein Dokument), mit `STALE_PARENT`, wenn ein anderes Fenster das Dokument nach dem letzten Schreibvorgang dieses Tabs geschrieben hat (neu lesen und erneut versuchen), mit `JOURNAL_UNAVAILABLE`, wenn das Journal nicht läuft oder nicht rechtzeitig antwortet, und mit `INVALID_TEXT`, wenn `content` ein einzelnes UTF-16-Surrogat enthält. Bearbeitet der Benutzer das Dokument, schließt den Tab, beginnt mit einer Eingabemethode zu komponieren oder verschiebt die Auswahl (oder wechselt den Tab, wenn kein `tabId` angegeben wurde), während der Schreibvorgang festgehalten wird, wird er mit `ABORTED` und einem `reason` (`edited`, `closed`, `composing`, `selection`) abgelehnt, und nichts ändert sich; neu lesen und erneut versuchen. Ein `INTERNAL`-Fehler mit `applied: true` ist etwas anderes: Der Editor ist ausgefallen, nachdem der Schreibvorgang das Dokument bereits geändert hatte, und der Text, den es dann enthielt, wurde festgehalten (`durable` wie oben, `current_revision` ist die Revision des Dokuments) – vor dem nächsten Schreiben neu lesen. Ein `INTERNAL`-Fehler ohne `applied` nach einem fehlgeschlagenen Schreibvorgang bedeutet, dass das Dokument teilweise geändert sein kann; auch dann neu lesen.

### `transform`

Eine deterministische Umschreibung anwenden. Aktuell werden CJK-spezifische Transformationen unterstützt (Konvertierung Vollbreite ↔ ASCII-Interpunktion, CJK ↔ Latein-Abstand).

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `tabId` | string | Nein | Ziel-Tab |
| `kind` | string | Ja | `"cjk-format"`, `"cjk-spacing"` oder `"cjk-punctuation"` |
| `expected_revision` | string | Nein | Nebenläufigkeits-Token |
| `addresses` | string[] | Nein | Kommentar-IDs aus `comments.list`, die diese Bearbeitung beantwortet (höchstens 64) |

`cjk-format` wendet die CJK-Formatierungseinstellungen des Benutzers durchgehend an. `cjk-spacing` fügt einzelne Leerzeichen zwischen CJK-Zeichen und benachbarten lateinischen Zeichen oder Ziffern ein. `cjk-punctuation` konvertiert ASCII-Interpunktion, die neben CJK-Zeichen steht, in ihre Vollbreitenform.

Gibt `{revision, applied, durable}` zurück. Wie `write` wird es mit `BUSY` abgelehnt, ohne etwas zu ändern, während der Benutzer im WYSIWYG-Editor, der den Tab anzeigt, mit einer Eingabemethode komponiert. Wie `write` wird der Aufruf im Agenten-Bearbeitungsjournal von VMark festgehalten, bevor sich etwas ändert: `applied`, `durable` und die Journal-Ablehnungen (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) bedeuten dasselbe; ein Aufruf, der nichts ändert, wird nicht festgehalten.

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
| `addresses` | string[] | Nein |

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

Gibt bei Erfolg `{revision, applied, durable}` zurück oder eine strukturierte Fehlerhülle `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW`. Wie `write` wird der Aufruf im Agenten-Bearbeitungsjournal von VMark festgehalten, bevor sich etwas ändert: `applied`, `durable` und die Journal-Ablehnungen (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) bedeuten dasselbe; ein Aufruf, der nichts ändert, wird nicht festgehalten.

### `validate`

`actionlint` über das Workflow-YAML laufen lassen.

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |

Gibt `{ok, diagnostics, binaryAvailable}` zurück. Jede Diagnose trägt `{line, col, message, severity}`. `binaryAvailable: false` bedeutet, dass `actionlint` lokal nicht installiert ist; Installation über Homebrew oder die Upstream-Releases.

---

## `selection`

Die aktuelle Editor-Auswahl des Benutzers lesen oder ersetzen. Verwenden Sie dies statt `document.read`/`document.write`, wenn der Benutzer den zu ändernden Bereich markiert hat — `selection.get` gibt nur den ausgewählten Ausschnitt zurück, und `selection.set` schreibt nur diesen Bereich neu, sodass die Token-Kosten mit der Bearbeitung skalieren, nicht mit dem Dokument.

::: warning Auswahl ist Ansichtszustand — nur der fokussierte Tab
Die Auswahl existiert nur im aktuell gerenderten Editor. Wird `tabId` übergeben, muss es zum fokussierten Tab passen; bei Nichtübereinstimmung wird `INVALID_TAB` zurückgegeben. Hat der fokussierte Tab keinen aktiven Editor (z. B. schreibgeschützter Viewer), ist die Antwort `NO_EDITOR`.
:::

### `get`

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |

Gibt zurück:

| Feld | Typ | Hinweise |
|---|---|---|
| `text` | string | Markdown-Serialisierung des ausgewählten Ausschnitts (WYSIWYG-Modus) oder roher ausgewählter Text (Quelltext-Modus). Leerer String, wenn kollabiert. |
| `isEmpty` | boolean | `true`, wenn die Auswahl kollabiert ist (nur Cursor). |
| `range` | `{from, to}` | ProseMirror-Positionen im WYSIWYG-Modus; Zeichen-Offsets im Quelltext-Modus. |
| `mode` | `"wysiwyg"` \| `"source"` | Macht den Positionsraum von `range` eindeutig. |
| `kind` | `"markdown"` \| `"yaml-workflow"` | Diskriminator für die Dokumentart. |
| `tabId` | string | Zur Bestätigung zurückgespiegelt. |
| `revision` | string | An `set` zurückgeben für optimistische Nebenläufigkeit. |

### `set`

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |
| `content` | string | Ja |
| `expected_revision` | string | Nein (empfohlen) |
| `addresses` | string[] | Nein |

Ersetzt, was auch immer der Editor als aktuelle Auswahl meldet. **Im WYSIWYG-Modus** wird einfacher Inline-Text als literaler Textknoten eingefügt, sodass führende/nachfolgende Leerzeichen exakt erhalten bleiben; Inhalt mit Markdown-Markierungen (`**bold**`, `*italic*`, `` `code` ``, umzäunter Code, Blockzitate, Listen usw.) wird als Markdown geparst und als die entsprechenden Knoten eingefügt. **Im Quelltext-Modus** wird `content` immer als roher Text eingespleißt — die Quelltext-Oberfläche besteht bereits aus Markdown-Bytes. Leerer `content` löscht die Auswahl. Ist die Auswahl kollabiert, wird `content` an der Cursorposition eingefügt.

Gibt bei Erfolg `{revision, replaced_chars, applied, durable}` zurück. `replaced_chars` ist die Länge des Textes, der vor dem Aufruf ausgewählt war — nützlich für die KI, um zu bestätigen, dass sie das Erwartete bearbeitet hat. Wie `write` wird der Aufruf im Agenten-Bearbeitungsjournal von VMark festgehalten, bevor sich etwas ändert: `applied`, `durable` und die Journal-Ablehnungen (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) bedeuten dasselbe; ein Aufruf, der nichts ändert, wird nicht festgehalten.

`STALE` gibt `{error: "STALE", message, current_revision}` zurück, genau wie `document.write`. Die Revision auf Dokumentebene erfasst Tastenanschläge zwischen `get` und `set`. Reine Cursorbewegung (ohne Tastenanschlag) wird vom Server nicht arbitriert — wenn der Benutzer den Cursor zwischen `get` und `set` bewegt hat, landet die Bearbeitung an der neuen Position.

`set` gibt `BUSY` zurück und ändert nichts, während der Benutzer im fokussierten Editor mit einer Eingabemethode Text komponiert, im WYSIWYG- wie im Quellmodus; kurz darauf erneut versuchen. `get` wird deswegen nie abgelehnt.

---

## `comments`

Liest die Review-Kommentare des Nutzers zu einem Dokument und beantwortet sie. Einen Kommentar aufzulösen, wieder zu öffnen oder zu löschen, entscheidet der Nutzer: Das Tool hat keine solche Aktion, und ein Aufruf, der eine verlangt, wird abgewiesen, bevor er VMark erreicht.

### `list`

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |
| `cursor` | string | Nein |

Gibt `{doc, generation, threads, nextCursor?}` zurück, den ältesten Thread zuerst. Jeder Thread enthält seine `comment`-ID, seinen `state` (`open`, `addressed`, `resolved` oder `reopened`), seine `commentGen`, den zitierten Text, an dem er verankert ist, und seine Antworten.

Eine lange Liste wird seitenweise geliefert, jede Seite klein genug, um vollständig anzukommen. Solange `nextCursor` vorhanden ist, rufen Sie `list` erneut auf und setzen Sie `cursor` auf diesen Wert. Ein über mehrere Seiten geteilter Thread trägt `repliesFrom` und `repliesTotal`; seine späteren Teile tragen nur `comment`, `state`, `commentGen`, `continued: true` und die nächsten Antworten. Ein Text, der als JSON-Text auf keine Seite passt (nur stark maskierter Text), kommt als `bodyBase64`, seine UTF-8-Bytes in Base64, anstelle von `body`. Ein Cursor, dessen Thread gelöscht wurde oder der für ein anderes Dokument ausgegeben wurde, wird mit `STALE_COMMENT` abgelehnt: Listen Sie ohne Cursor erneut auf.

### `reply`

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |
| `commentId` | string | Ja |
| `body` | string | Ja |
| `expectedCommentGen` | string | Ja |

Fügt dem Thread eine Antwort hinzu. VMark vergibt die Antwort-ID selbst, daher erhält ein wiederholter Aufruf das erste Ergebnis und fügt nie eine zweite Antwort hinzu.

### `mark_addressed`

| Parameter | Typ | Erforderlich |
|-----------|-----|--------------|
| `tabId` | string | Nein |
| `commentId` | string | Ja |
| `expectedCommentGen` | string | Ja |

Markiert den Thread als bearbeitet. Ob er aufgelöst wird, bleibt dem Nutzer überlassen.

`comments.reply` und `comments.mark_addressed` nennen beide die `commentGen` des Threads, wie `list` sie geliefert hat. Sie werden abgewiesen, ohne etwas zu ändern: mit `STALE_COMMENT`, wenn sich der Thread seitdem geändert hat oder gelöscht wurde (erneut auflisten), mit `INVALID_COMMENT`, wenn die Kommentar-ID fehlerhaft ist oder keinen Kommentar dieses Dokuments bezeichnet, mit `COMMENT_NOT_ALLOWED`, wenn der Thread aufgelöst ist, mit `COMMENT_LIMIT`, wenn der Thread zu viele Antworten hat, der Text zu lang ist oder der Thread sich nicht mehr ändern kann, sowie mit den Journal-Abweisungen `JOURNAL_BUSY`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE` und `INVALID_TEXT`.

Um anzugeben, dass eine Bearbeitung Kommentare beantwortet, übergib ihre IDs als `addresses` an `document.write`, `document.transform`, `workflow.apply_patch` oder `selection.set`. Die Verknüpfung wird mit der Revision gespeichert und im Verlauf des Dokuments angezeigt (ein später gelöschter Kommentar erscheint als gelöschter Kommentar); sie verändert keinen Thread. Mehr als 64 IDs, eine doppelte ID oder eine unbekannte, gelöschte, aufgelöste oder zu einem anderen Dokument gehörende ID wird mit `INVALID_ADDRESSES` abgewiesen, und nichts ändert sich.

---

## `browser`

Die **verändernde** Hälfte der eingebetteten Browser-Oberfläche — alles, was die Seite, den Tab oder eine gespeicherte Anmeldung ändert. Lesen Sie die Seite zuerst mit [`browser_read`](#browser-read): Jeder Zielmodus hier bezieht sich auf das, was ein Lesen zurückgegeben hat.

Die Browser-Tools richten sich nach **Einstellungen → Erweitert → macOS → Eingebetteter Browser**, der auf macOS **standardmäßig aktiviert** ist — diese Tools stehen einem verbundenen KI-Client also zur Verfügung, sofern Sie ihn nicht ausschalten. Jede Aktion schlägt mit `BROWSER_DISABLED` fehl, solange er aus ist. An MCP zurückgegebene URLs werden über dieselbe Sicherheitsschranke bereinigt, die auch der Browser-Sitzungszustand der App verwendet.

Annotiert mit `readOnlyHint: false, destructiveHint: true` — akkurat statt nur konservativ, weil jede Aktion hier etwas verändert.

**Fehler sind typisiert.** Eine Ablehnung kommt als `TOKEN: message` an (`STALE_COMMAND`, `NOT_GRANTED`, `EVAL_TIMEOUT`, `TAB_LIMIT`, …), mit demselben Token — und allen strukturierten Daten, die die App angehängt hat (ein Navigations-Ticket, der `reason` eines act, das Verb für den erneuten Versuch) — in `structuredContent`. Prüfen Sie auf das Token, nicht auf den Text.

Ein `EVAL_TIMEOUT` ist **unbestimmt**, kein sauberer Fehlschlag: Das übermittelte Skript kann noch zu Ende gelaufen sein, nachdem der Treiber aufgehört hat zu warten. Es trägt daher `data.detail.indeterminate: true` und darf nicht so wiederholt werden, als wäre nichts geschehen — lesen Sie die Seite (`browser_read`), um ihren Zustand zu erfahren, bevor Sie erneut handeln.

### `act`

Argumente: `tabId?`, `operation: "click" | "type" | "scroll" | "key"` und operationsspezifische Ziele:

- **click / type** — ein Ziel, entweder `ref` (aus einem vorherigen Lesen) **oder** `role` + `name`, sowie `text?` zum Tippen. Eine `ref` ist präzise und reihenfolgeunabhängig, wird aber nur für eine **bereits gewährte** Operation akzeptiert; falls die Aktion eine Freigabe erfordern könnte, verwenden Sie `role` + `name`, damit der Dialog dem Benutzer ein lesbares Element anzeigt.
- **scroll** — `ref` (in den sichtbaren Bereich scrollen) **oder** `dy` (ein vertikales Pixel-Delta).
- **key** — `key` (z. B. `"Enter"`, `"Escape"`, `"Tab"`), optionale `ref` als Ziel und optionale `modifiers: {ctrl, shift, alt, meta}`.

`scroll` und `key` sind Aktionsklasse (freigabepflichtig) und lösen **synthetische** DOM-Ereignisse aus, sodass eine Website, die auf `event.isTrusted` prüft, sie ignorieren kann. Verändernde Operationen erfordern eine ursprungsbezogene Freigabe; von der KI gewählte Uploads sind nie erlaubt.

**Ein Klick überprüft seine Wirkung, bevor er Erfolg meldet, und lehnt ab, statt zu raten.** Das Ziel wird in den sichtbaren Bereich gescrollt, muss sichtbar gerendert sein (berechnete Stile sowie eingeklappte oder transparente Vorfahren werden geprüft, sodass eine doppelte Schaltfläche in einem geschlossenen Akkordeon-Schritt übersprungen und nicht angeklickt wird), und der Klickpunkt wird per Treffertest geprüft — ein von einer Überlagerung verdecktes Ziel wird unter Nennung des Verdeckers abgelehnt (`covered by div.cmp-overlay`, Seitendaten), statt durchgeklickt zu werden. Teilen sich mehrere sichtbare Elemente Rolle und Name, wird der act als `ambiguous` abgelehnt, und `candidates` listet ihre refs auf — er wählt nie eines nach Dokumentreihenfolge. Weitere Ablehnungsgründe: `hidden`, `offscreen` (lässt sich nicht in den Viewport scrollen), `disabled` (einschließlich `pointer-events: none` und inerter Teilbäume), `upload` (Dateieingaben werden nie automatisiert) und `rejected-value` (das Feld hat den Text bereinigt). Offene Shadow Roots werden durchlaufen; die Antwort enthält die Zähler `matchedTotal` / `matchedVisible`, bei Erfolg **und** Fehlschlag die aktuelle `url` und `generation` des Tabs sowie `popup: {url}`, wenn die Seite während des act ein Fenster öffnen wollte (VMark blockiert Popups; die URL ist, was sie wollte). `type` verarbeitet Textfelder, `<select>`-Steuerelemente (übergeben Sie das Label oder den Wert der Option; eine fehlende Option wird als `no-such-option` abgelehnt) und `contenteditable`-Bereiche. `key` emuliert die Standardaktionen, die synthetischen Ereignissen fehlen — Enter in einem Formular sendet es ab, Tab verschiebt den Fokus — und meldet `defaultAction`.

**Was eine Freigabe bindet.** Eine `click`-Freigabe bindet das Element (Rolle + Name). Eine `type`-, `key`- oder `scroll`-Freigabe bindet außerdem genau den Text, die Taste (mit Modifikatoren) oder das Delta, das Sie angefordert haben — der Dialog zeigt es an —, sodass ein erneuter Versuch mit anderem Inhalt erneut fragt.

### `workflow_run` / `workflow_cancel`

`workflow_run` führt einen Workflow aus, den Sie als `source`-Text auf einem KI-eigenen Tab übergeben. Argumente: `tabId?`, `source` (der Workflow-Text — eine kleine zeilenorientierte Grammatik; Sie schreiben ihn, die KI tut es, oder [`workflow_record`](#workflow-record) erfasst ihn aus Ihren eigenen Aktionen), `inputs?` (eine `{name: value}`-Zuordnung, die in `{name}`-Referenzen eingesetzt wird; jede deklarierte Eingabe muss angegeben werden, und nicht deklarierte werden abgelehnt), `allowRepeat?` und `resumeRunId?` (siehe unten). Es gibt **sofort** `{runId, steps, firstStep}` zurück — der Lauf wird **asynchron** ausgeführt, weil ein mehrstufiger Lauf eine einzelne Anfrage überdauern kann. Fragen Sie `workflow_status` von [`browser_read`](#browser-read) für den Fortschritt ab; solange der Lauf auf Sie wartet, meldet es `pendingApproval`.

Deterministische Schritte — `click` / `type` / `navigate` in dieser Grammatik sowie `extract` — laufen innerhalb von VMark und sind **einzeln freigabepflichtig**, genau wie ein von Hand ausgelöstes `act`: Der Lauf autorisiert jeden Schritt einzeln, sodass ein Workflow kein Weg an den Freigabedialogen vorbei ist. `goal`, `confirm`, `api` und jeder Freitext-Schritt **pausieren** den Lauf, damit die KI ihn von Hand erledigt. **Fortsetzen nach einer Pause:** Erledigen Sie den pausierten Schritt (oder lassen Sie sich von der KI helfen) und starten Sie dann einen neuen Lauf mit `resumeRunId`, gesetzt auf den pausierten Lauf — er übernimmt die abgeschlossenen Schritte und behandelt den pausierten Schritt als erledigt, sodass nichts doppelt abgesendet wird. Ein erneuter Lauf mit **derselben Quelle und denselben Eingaben** überspringt außerdem Schreibschritte, die in dieser Sitzung bereits erfolgreich waren (das Verzeichnis abgeschlossener Schreibvorgänge; übersprungene Schritte werden als `skipped` gemeldet), sofern `allowRepeat` nicht gesetzt ist. Andere Eingaben sind ein anderer Auftrag und laufen vollständig.

`workflow_cancel {tabId?, runId}` stoppt einen Lauf. Es ist **nie freigabepflichtig** — Stoppen ist immer erlaubt —, und es zieht die ausstehenden Dialoge des Laufs zurück, bricht einen Schritt ab, der auf Ihre Freigabe wartet, und gibt Ihnen den Tab zurück. Ein beendeter Lauf meldet `already-terminal` und bleibt, wie er ist; eine unbekannte `runId` ergibt `RUN_NOT_FOUND`. Der Lauf stoppt außerdem in dem Moment, in dem Sie den Browser übernehmen (jede Interaktion mit der Seite oder ihrer Chrome-Leiste holt die Kontrolle zurück) — auch während er auf einen Dialog wartet.

Läufe sind begrenzt (≤ 25 Schritte, Quelle ≤ 64 KiB und 120 s **Laufzeit** — Zeit, in der auf Sie gewartet wird, zählt nicht) und laufen pro Tab einzeln nacheinander.

### `workflow_record`

Zeichnet **Ihre eigenen Aktionen** auf einem KI-eigenen Tab in einen abspielbaren Workflow auf. Argumente: `tabId?`, `recordOp` (`"start"` oder `"stop"`) und `site?` (die Site-ID im Front-Matter des aufgezeichneten Workflows; Standardwert ist `recording`).

`start` ist durch die `record`-Berechtigung **einwilligungspflichtig**, die — wie `execute_js` und `session` — **nie ein dauerhaftes Recht** ist: Jede Aufzeichnung fragt Sie erneut, sodass die KI Sie niemals heimlich aufzeichnen kann. Bis Sie es erlauben, gibt `start` `needsApproval` zurück; sobald Sie es tun, aktiviert VMark einen ruhenden Erfassungs-Shim in der Seiten-World und beginnt, die **Klicks und Feldeingaben** aufzuzeichnen, die Sie ausführen. `stop` gibt `{source, inputs, eventCount}` zurück — die `source` ist Workflow-Text, den Sie speichern oder direkt an [`workflow_run`](#workflow-run-workflow-cancel) übergeben können.

Die Aufzeichnung ist **von Grund auf wertfrei**, und dies ist kein Filter, der der Seite vertraut: Nichts, was Sie eingeben, wird jemals erfasst. Jedes Textfeld wird zu einer benannten `{input}`-Variablen (der Wert wird beim Abspielen bereitgestellt, nie aufgezeichnet); ein **Passwort- oder Einmalcode-Feld** wird zu einem `confirm:`-Schritt — einem menschlichen Gate, das Sie beim Abspielen von Hand abschließen —, sodass ein Geheimnis nicht einmal parametrisiert wird; und jede URL wird auf Origin + Pfad reduziert, sodass ein Token in einer Query-Zeichenkette nicht überleben kann. Aufgezeichnet werden die **Locators**, die Sie berührt haben (ARIA-Rolle + zugänglicher Name), nie deren Daten. Die Aufzeichnung folgt Ihnen über Seitennavigationen hinweg und ist begrenzt (200 Ereignisse pro Seite, 1.000 pro Sitzung).

### `open`

Argumente: `url`, optionales `timeoutMs` (1–9.000 ms) und optionales `profile` (`[A-Za-z0-9._-]`, macOS 14+, Sandbox-Haltung): ein **benannter persistenter Kontext**, damit eine Anmeldung über ihren Namen wiederverwendet werden kann — das Öffnen eines solchen Kontexts erfordert jedes Mal eine neue Freigabe, und die KI sieht die Anmeldedaten nie. Erstellt einen KI-eigenen Tab unter der aktuellen Haltung — Sandbox oder Gemeinsames Profil —, bringt ihn in den Vordergrund und gibt nach abgeschlossenem Laden dessen `tabId`, `navigationId`, URL, Titel und Generation zurück. Höchstens **8 KI-eigene Tabs** dürfen geöffnet sein (`TAB_LIMIT`); die KI schließt, womit sie fertig ist. In der Haltung „Gemeinsames Profil“ behält ein `open`, das Ihre Zielfreigabe benötigt, seinen Tab und weist die KI an, es mit `navigate` auf dieser `tabId` erneut zu versuchen (`data.retry`) — ein neues `open` würde einen Tab erzeugen, den die Freigabe nicht abdecken kann.

### `navigate`

Argumente: `tabId?`, `url` und optionales `timeoutMs`. Navigiert einen KI-eigenen Tab (und bringt ihn in den Vordergrund) und gibt das Ergebnis des Navigations-Tickets zurück. Ein `TIMEOUT` trägt das Ticket dennoch, sodass ein späteres `wait` das endgültige Ergebnis abrufen kann.

### `close`

Argumente: `tabId`. Schließt einen KI-eigenen Tab, den die KI geöffnet hat. **Nie freigabepflichtig** — Stoppen ist immer erlaubt. Ein menschlicher Tab wird abgelehnt (`TAB_NOT_AI_OWNED`). Das Ergebnis ist `{tabId, closed: true, destroyed: true}`, sobald bestätigt ist, dass die native Ansicht entfernt wurde; ein Abbau, den der Treiber nach seinen Wiederholungen nicht bestätigen konnte, wird als `TAB_TEARDOWN_FAILED` mit `data.destroyed: false` gemeldet — der Tab-Eintrag ist bereits entfernt, wiederholen Sie das Schließen also nicht; teilen Sie dem Benutzer mit, dass möglicherweise noch eine native Ansicht läuft.

**Sperren-Erkennung.** Ein geladenes `open`- / `navigate`- / `wait`-Ergebnis kann `gate: {kind, hint}` tragen, wenn die erreichte Seite sich als **Login-Wand**, **Einwilligungs-Interstitial**, **Mensch-Verifizierungs-Challenge** oder **Ratenbegrenzung** liest — sodass die KI in dem Moment, in dem sie das Ergebnis liest, erfährt, dass sie nicht auf den angeforderten Inhalt blickt. Die Erkennung ist auf Präzision ausgelegt (ein gerendertes Challenge-Widget oder mindestens zwei unabhängige Signale auf einer knappen Seite — ein Preis von `$429`, eine Fußzeile „Protected by Cloudflare“ oder ein Artikel *über* CAPTCHAs klassifizieren nie) und rein beratend: Sie ändert, was der KI mitgeteilt wird, nie das, was autorisiert ist, und jeder Hinweis zielt darauf ab, Sie einzubeziehen, statt die Sperre zu umgehen.

### `style`

Argumente: `tabId?`, ein Ziel (`ref` **oder** `selector`) und eines von `set: {prop: value}`, `addClasses`, `removeClasses` oder `injectCss`. Eine blockierende Überlagerung schließen, ein Ziel hervorheben usw. **Aktionsklasse** (freigabepflichtig, Operation `style`). Isolierte Content-World.

### `execute_js`

Argumente: `tabId?`, `script` — ein asynchroner Funktionsrumpf, der einen JSON-serialisierbaren Wert `return`t (oder abwartet). Der Notausgang für das, was die strukturierten Verben nicht ausdrücken können. Es läuft in der **isolierten Content-World** — es teilt sich das DOM (sodass `querySelector`, `element.style` funktionieren), kann aber den eigenen JS-Heap/die Globals der Seite **nicht** sehen. Der Wert kommt als `result` zurück (`undefined` wird zu `null`); ein Throw oder ein Wert, den JSON nicht kodieren kann, ist ein **Fehlschlag, der den Fehler benennt**, nie ein Ergebnis. Es wird **nur pro Aufruf** freigegeben (nie eine dauerhafte Berechtigung, im Rust-Treiber durchgesetzt), die Freigabe zeigt das Skript, und der Rückgabewert wird als **nicht vertrauenswürdig** markiert und nie automatisch in ein späteres `act` eingespeist. Bevorzugen Sie zuerst `query`/`style`.

### `session_save` / `session_load`

Argumente: `tabId?`, `handle` (`[A-Za-z0-9._-]`, 1–128 Zeichen). `session_save` erstellt einen Snapshot der Sitzung des Tabs in einem nach `handle` benannten **OS-Keychain**-Eintrag und gibt eine wertfreie Zusammenfassung (Anzahlen) zurück; `session_load` stellt sie wieder her und gibt `{loaded: true, handle}` zurück — eine Bestätigung plus den von der KI gelieferten Handle, nie irgendwelche Werte. Ein `session_load` gilt nur für eine Seite mit **demselben Ursprung**, aus dem die Sitzung gespeichert wurde. Dies sind Anmeldedaten **per Verweis** (ADR-A7): Die KI benennt eine gespeicherte Sitzung und erhält nie Cookie-/Token-Werte, die auch nie protokolliert werden. Beide gehören zur Berechtigung `session` — **nie eine dauerhafte Berechtigung** (pro Aufruf freigegeben), und eine Freigabe für einen Handle kann nicht für einen anderen eingelöst werden. Eine gespeicherte Sitzung umfasst `localStorage` **und Cookies**, beide auf den Ursprung beschränkt, auf den die Seite beim Speichern festgelegt war.

### `console_clear`

Argumente: `tabId?`. Gibt `{entries: [{level, text}], url}` zurück, genau wie das `console` von [`browser_read`](#browser-read), **und leert den Puffer**, sodass der nächste Lesevorgang nur neue Ausgabe sieht. Es liegt hier statt beim anderen Konsolen-Lesevorgang, weil das Leeren `element.textContent = "[]"` in der Seite auswertet — ein DOM-Schreibvorgang.

Die Haltung „Gemeinsames Profil“ fragt für jeden neuen Ursprung nach einer Zielfreigabe, sofern keine passende `navigate`-Berechtigung besteht. Ein von Menschen erstellter Tab erfordert vor KI-Lesen/-Handeln eine flüchtige Anhängungs-Freigabe. Sandbox-Tabs verwenden einen separaten, nicht persistenten KI-Cookie-Speicher.

---

## `browser_read`

Die **schreibgeschützte** Hälfte: den Tab beobachten, ohne ihn zu ändern. Annotiert mit `readOnlyHint: true`, sodass ein MCP-Client sie automatisch genehmigen kann — was der Sinn der Aufteilung ist. Diese Aktionen lagen früher auf `browser`, wo eine einzige Annotation auf Tool-Ebene auch `execute_js` beschreiben musste, sodass das Erstellen eines ARIA-Snapshots eine menschliche Freigabe kostete.

`openWorldHint` bleibt `true`: Schreibgeschützt beschreibt, was das Tool *ändert*, nicht, ob den Bytes vertraut werden kann. Alles Zurückgegebene ist seitengesteuert und **nicht vertrauenswürdig** — geben Sie ein Ergebnis nie direkt als act-Ziel an `browser` zurück.

### `read`

Gibt `{url, snapshot, truncated?, unreachable?}` für den fokussierten Browser-Tab oder den von `tabId` benannten Tab zurück. `snapshot` ist eine ARIA-orientierte Liste von `{role, name, ref}`-Knoten — plus `level` bei Überschriften, `checked`, `disabled` und `upload: true` für eine Dateieingabe, die die KI nie bedienen kann —, wobei jede `ref` (z. B. `"e5"`) ein stabiler Handle für dieses Element ist, gültig für die Lebensdauer der aktuellen Ansicht. Der Durchlauf betritt offene Shadow Roots; `unreachable` zählt die geschlossenen Shadow Roots und Frames, die er nicht betreten konnte, und `truncated: true` bedeutet, dass die Knotengrenze (2.000) oder die Namensgrenze (200 Zeichen) gegriffen hat.

### `screenshot`

Argumente: `tabId?`. Gibt einen **Bild-Inhaltsblock** (base64-JPEG, qualitätsbegrenzt) der aktuellen Darstellung des Tabs zurück, plus eine Textzeile, die die Seite benennt — ein visueller Kanal auf Layout und gerenderten Zustand, den der ARIA-Snapshot nicht beschreiben kann. Es wird nativ erfasst (`takeSnapshot`) und liest kein Seiten-DOM und kein JavaScript. Leseklasse: autorisiert genau wie `read` (erlaubt auf einem KI-eigenen Tab; ein menschlicher Tab benötigt eine Anhängung, die bei der Erfassung verbraucht wird). Ein Tab, der nicht die sichtbare Seite ist, kann leer dargestellt werden — `open` und `navigate` bringen einen Tab in den Vordergrund.

### `query`

Argumente: `tabId?`, `selector` (CSS) und optionale `fields: {attributes, box, styles:[...]}`. Gibt `{count, elements: [{ref, tag, text, …}], truncated?}` zurück — strukturierte DOM-Daten, die der ARIA-Snapshot nicht benennen kann (Tabellen, berechnete Werte) —, begrenzt auf 50 Elemente und je 500 Zeichen Text (`truncated: true`, wenn der Selektor mehr getroffen hat). **Leseklasse.** Läuft in der isolierten Content-World.

### `extract`

Argumente: `tabId?`. Gibt `{title, byline, url, markdown, textLength, truncated}` zurück — die Seite als **Markdown im Lesemodus**, für Seiten, die die KI *lesen* statt bedienen möchte. Eine begrenzte Erfassung exportiert das HTML der Seite; die Extraktion selbst läuft in VMark, nie in der Seite: Ein für den Ursprung registriertes **Website-Plugin** hat den ersten Anspruch (das eingebaute Wikipedia-Plugin entfernt die Wiki-Umrandung gezielt — Infoboxen, Navigationsleisten, Hinweisnotizen, Bearbeiten-Links), und ein generischer Reader nach Dichte-Heuristik ist die Rückfalloption für jede andere Website. `truncated: true` bedeutet, dass die Seite die Erfassungsgrenze überschritten hat und der Rest ungelesen blieb. **Leseklasse.** Alles Zurückgegebene ist seitenabgeleitet und nicht vertrauenswürdig.

### `workflow_status`

Argumente: `tabId?`, `runId` (aus `workflow_run`). Gibt `{status, completedSteps, skippedSteps, stepCount, firstStep, pausedAt?, pendingApproval?, reasonCode?, reason?, resumedFrom?, stepResults}` zurück, wobei `status` einer von `running` / `paused` / `completed` / `failed` / `cancelled` / `superseded` ist, `stepResults` einen Eintrag pro Schritt enthält (`{index, status, attempts, reason?, data?}`) und `pendingApproval` vorhanden ist, solange der Lauf auf Ihre Entscheidung wartet. Ein Status `paused` benennt in `pausedAt` den Schritt, der Sie benötigt. **Leseklasse** — fragen Sie es beliebig oft ab.

### `console`

Argumente: `tabId?`. Gibt `{entries: [{level, text}], url}` zurück — die erfasste `console.*`-Ausgabe der Seite, plus **nicht abgefangene Fehler und unbehandelte Promise-Rejections** (aufgezeichnet als `level: "error"`-Einträge mit dem Präfix `Uncaught` / `Unhandled rejection:` — das Signal, das reines Patchen von `console.*` nie sieht). Nur KI-eigene Tabs (in Sandbox- wie in Gemeinsames-Profil-Haltung; ein menschlicher Tab hat keinen Erfassungs-Shim), nur der Hauptframe. Die Erfassung funktioniert über einen Shim in der Seiten-World, der in einen versteckten DOM-Puffer schreibt, den der Treiber aus der isolierten World liest — sodass **kein Nachrichtenkanal** zurück in VMark geöffnet wird (die No-Bridge-Garantie hält). Die Ausgabe ist seitengesteuert und **nicht vertrauenswürdig** — behandeln Sie sie wie ein `read`, nie als act-Ziel.

Der Puffer ist ein begrenzter Ring, sodass aufeinanderfolgende Lesevorgänge sich überlappen. Um ihn beim Lesen zu leeren, verwenden Sie das `console_clear` von [`browser`](#browser) — das Leeren schreibt `[]` in das Pufferelement der Seite, was ein DOM-Schreibvorgang ist und daher nicht unter `readOnlyHint: true` liegen kann.

### `wait`

Argumente: `tabId?`, optionales `navigationId` (weglassen für das neueste Ticket des Tabs) und optionales `timeoutMs` (1–9.000 ms). Es startet nie eine Navigation, ändert nie den Fokus oder den aktiven Tab und erzeugt nie eine Ansicht — es beobachtet nur, was ihm erlaubt, im schreibgeschützten Tool zu liegen. Nur KI-eigene Tabs. Es gibt ein gepuffertes Lade-/Fehlerergebnis, `NAVIGATION_SUPERSEDED` oder `TIMEOUT` zurück, wenn das Ticket nicht innerhalb der Grenze fertig wird.

### `wait_for`

Argumente: `tabId?`, genau eines von `ref` (aus einem Lesen), `role` (+ optionales `name`), `text` (ein Teilstring des sichtbaren Textes) oder `urlContains` (ein Teilstring, den die URL des Tabs enthalten muss — bestätigt, dass eine durch einen Klick ausgelöste Navigation angekommen ist, beantwortet aus dem Tab-Zustand ohne Seiten-Roundtrip) sowie optionales `timeoutMs` (1–9.000 ms). Fragt so lange ab, bis die Bedingung erfüllt ist oder das Timeout abläuft, und gibt `{matched: true|false}` zurück (plus die `ref` des passenden Elements bei einer ref-/role-Bedingung) — sodass Sie „gefunden“ von „Zeitüberschreitung“ unterscheiden können. Leseklasse. Verwenden Sie es, um einen Ablauf deterministisch zu machen: handeln, mit `wait_for` auf das Ergebnis warten, dann lesen.

Aus dem, was es sehen darf, folgen zwei Regeln. `urlContains` vergleicht mit der **bereinigten** URL — Query-String und Fragment werden entfernt, weil ein Token, das eine Weiterleitung dort platziert hat, nicht abfragbar sein darf —, daher wird ein Suchbegriff mit `?` oder `#` von vornherein abgelehnt. Und auf einem menschlichen Tab, der mit **Einmal zulassen** angehängt wurde, wird es abgelehnt (`ATTACHMENT_ONCE_INSUFFICIENT`): Abfragen sind viele Lesevorgänge, und eine Anhängung für einen einzigen Lesevorgang kann sie nicht abdecken — fordern Sie **Bis zur nächsten Navigation erlauben** an.

---

## `coherence`

Eine **schreibgeschützte** Sicht auf die Kohärenzschicht des Arbeitsbereichs — welche abgeleiteten Dokumente gegenüber den Upstreams, aus denen sie erzeugt wurden, veraltet sind. Keine Aktion verändert Dokumente oder den Editor-Zustand. `status` ist schreibgeschützt; `edges` gleicht zuerst ab und kann Herkunftsnachweise an das Ledger des Arbeitsbereichs anhängen, ändert aber nie den Dokumentinhalt. Alle werden vollständig vom Rust-Backend aus dem Kernel des jeweiligen Arbeitsbereichs beantwortet und funktionieren daher auch, wenn kein Editor-Fenster im Vordergrund ist.

Zwei weitere schreibgeschützte Aktionen legen die semantische Schicht offen:

- `claims` — die aktuellen Kanon-Aussagen: `{claim, entryId, statement, maturity, invalidAt, visible}`. Nur `established`-Aussagen schränken semantische Prüfungen ein; `visible` spiegelt den Default-Kontext wider.
- `contexts` — die Kontextmenge (der implizite `default` ist immer vorhanden): `{id, name, parent, enforcement, visibleClaims, errors}`.

Annotiert mit `readOnlyHint: true`. Die eine verändernde Aktion, `resolve`, liegt in ihrem eigenen Tool — siehe [`coherence_resolve`](#coherence-resolve) —, was es erlaubt, dieses hier automatisch genehmigbar zu machen. Aussagen- und Kontextmutationen werden überhaupt nie offengelegt: Der Kanon bleibt menschengesteuert.

Alle Aktionen erfordern `workspace_root`: den absoluten Pfad des abzufragenden Arbeitsbereichs. Sie erfahren ihn über `session.get_state` (das `filePath` der offenen Tabs) oder das workspace-Tool. Ein Pfad, der fehlt, nicht absolut ist oder kein Verzeichnis ist, wird mit einem einfachen String-Fehler abgelehnt.

### `status`

Kernel-Statuszähler für einen Arbeitsbereich.

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `workspace_root` | string | Ja | Absoluter Pfad des abzufragenden Arbeitsbereichs |

**Rückgabe:**

```json
{
  "initialized": true,
  "objects": 12,
  "open_items": 2,
  "quarantined": 0,
  "writer": "0198c0de-0000-7000-8000-000000000001"
}
```

| Feld | Bedeutung |
|---|---|
| `initialized` | `false`, wenn der Arbeitsbereich noch kein Kohärenz-Ledger hat (kein `.vmark/`-Verzeichnis). Alle Zähler außer `objects` sind dann 0. |
| `objects` | Verfolgte Objekte (Dateien mit einer Kohärenz-Identität). |
| `open_items` | Aktive, nicht mehr frische Kanten — die aktuelle Größe der Aufschlüsselung. |
| `quarantined` | Beim letzten Lesen unter Quarantäne gestellte fehlerhafte Ledger-Zeilen. |
| `writer` | Die Writer-ID (UUID) dieser Installation. |

### `edges`

Die Aufschlüsselung: jede aktive Abhängigkeitskante, deren Upstream sich bewegt hat. Führt zuerst einen Scan-Abgleich aus, sodass die Antwort die Dateien auf der Festplatte zum Aufrufzeitpunkt widerspiegelt.

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `workspace_root` | string | Ja | Absoluter Pfad des abzufragenden Arbeitsbereichs |

**Rückgabe** — ein Array, leer, wenn alles kohärent ist:

```json
[
  {
    "txf": "0198c0de-0000-7000-8000-00000000000a",
    "input": 0,
    "upstream": "0198c0de-0000-7000-8000-00000000000b",
    "upstream_path": "characters/elena.md",
    "pinned": "rev-a1b2c3",
    "downstream": "0198c0de-0000-7000-8000-00000000000c",
    "downstream_path": "scenes/chapter-3.md",
    "downstream_rev": "rev-d4e5f6",
    "state": "version-stale"
  }
]
```

| Feld | Bedeutung |
|---|---|
| `txf` / `input` | Der Transformationseintrag und der Eingabe-Slot, die diese Kante identifizieren (an die Auflösungsaktionen in der App übergeben). |
| `upstream` / `upstream_path` | Das Objekt, von dem der Downstream abhängt, und sein zuletzt bekannter Pfad. |
| `pinned` | Die Upstream-Revision, aus der der Downstream erzeugt wurde. |
| `downstream` / `downstream_path` / `downstream_rev` | Das abgeleitete Objekt, sein Pfad und seine aktuelle Revision. |
| `state` | `"version-stale"`, `"stale-valid"`, `"stale-contradicted"`, `"stale-unknown"`, `"waived"`, `"diverged"`, `"diverged-multi-head"` oder `"unpinnable"`. |

Das Auflösen einer Kante (Neuere übernehmen / Aussetzen) ist normalerweise eine menschliche Aktion in VMarks Aufschlüsselungsansicht. Eine KI kann es nur über [`coherence_resolve`](#coherence-resolve) tun, und nur, wenn der Eigentümer des Arbeitsbereichs dies ausdrücklich an sie delegiert hat.

---

## `coherence_resolve`

Die **eine verändernde Aktion** auf der Kohärenzschicht, in ihrem eigenen Tool, damit [`coherence`](#coherence) automatisch genehmigbar bleiben kann — und damit etwas Nicht-Rückgängigmachbares in der Tool-Liste auffällig ist, statt als ein Enum-Wert unter fünf vergraben zu sein. Annotiert mit `readOnlyHint: false, destructiveHint: true`.

### `resolve`

Argumente: `{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`.
`txf` und `input` stammen aus einer `coherence` → `edges`-Zeile.

Eine aktive veraltete Kante als ausdrücklich delegierter Agent auflösen. Die Autorisierung ist **fail-closed**: Der Eigentümer des Arbeitsbereichs muss **Ihrer authentifizierten Bridge-Identität** eine aktive, nicht abgelaufene Delegation erteilt haben, die die Art der Auflösung abdeckt (in der App erteilt, aus der Aufschlüsselung), und die Kante muss noch aktiv sein. Jede delegierte Auflösung wird im Audit-Log der Erteilung zugeordnet, und der Eintrag kann nicht rückgängig gemacht werden.

Eine Ablehnung bedeutet, dass die Erteilung fehlt oder abgelaufen ist — bitten Sie den Benutzer, sie zu erteilen, statt es erneut zu versuchen. Diese Auslagerung aus `coherence` hat keine Sicherheitseigenschaft verändert: Die Autorisierung hat sich immer am authentifizierten Bridge-Prinzipal orientiert, nie an etwas, das der Client behauptet.

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
| `STALE` | Hülle | `expected_revision` stimmte nicht; erneut lesen und wiederholen. Oder `save` / `save_as`: ein nach diesem vorgenommenes Speichern hat diese Datei bereits erreicht, also hat dieses nichts geschrieben — vor erneutem Schreiben lesen |
| `INVALID_PATCH` | Hülle | `workflow.apply_patch` hat ein fehlerhaftes `patches`-Array erhalten |
| `INVALID_TAB` | Hülle | `tabId` konnte nicht aufgelöst werden |
| `INVALID_PATH` | Hülle | Ein `filePath` konnte nicht gelesen werden oder liegt außerhalb des Geltungsbereichs des offenen Arbeitsbereichs / Dokuments |
| `APPROVAL_REQUIRED` | Hülle | `save_as` an einen neuen Ort, während **Speichern an neuem Ort und Genie-Ergebnisse automatisch genehmigen** aus ist; `save_as` an einen Pfad, an dem bereits eine andere Datei als die des Tabs liegt; oder `open_workspace` wartet auf die Bestätigung des Benutzers oder darauf, dass er den Ordner im Ordnerdialog von VMark auswählt |
| `BUSY` | Hülle | `open_workspace` konnte nicht fortfahren: Ein anderer Ordnerdialog ist offen oder in diesem Fenster läuft ein Arbeitsbereichswechsel; die Bestätigung bleibt erhalten — erneut versuchen. Oder `document.write`, `document.transform` bzw. `selection.set` kam an, während der Benutzer mit einer Eingabemethode Text komponierte; nichts wurde geändert — kurz darauf erneut versuchen |
| `JOURNAL_BUSY` | Hülle | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch` kam an, während ein anderer Schreibvorgang in dasselbe Dokument festgehalten wurde; nichts wurde geändert — kurz darauf erneut versuchen |
| `WRITE_BUSY` | Zeichenkette | Ein schreibender Aufruf (`document.write` / `document.transform`, `selection.set`, `workflow.apply_patch`, `comments.reply` / `mark_addressed`, `coherence_resolve`, …) wartete 3 s hinter einem anderen Schreibvorgang, ohne an die Reihe zu kommen; er wurde nicht ausgeführt — erneut versuchen |
| `TIMEOUT` | Zeichenkette | Ein Aufruf von `coherence` oder `coherence_resolve` wurde nicht innerhalb von 20 s fertig. Bei einem Schreibvorgang (`edges`, `resolve`) läuft er noch, und sein Ergebnis ist unbekannt — lesen Sie den aktuellen Stand, bevor Sie es erneut versuchen |
| `STALE_PARENT` | Hülle | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: Ein anderes Fenster hat das Dokument nach dem letzten Schreibvorgang dieses Tabs geschrieben; nichts wurde geändert — neu lesen und erneut versuchen |
| `JOURNAL_DEGRADED` | Hülle | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: Ein früherer Journaleintrag für dieses Dokument wartet noch auf das Speichern; nichts wurde geändert — in ein paar Sekunden erneut versuchen |
| `JOURNAL_UNAVAILABLE` | Hülle | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: Das Agenten-Bearbeitungsjournal läuft nicht oder kann nichts festhalten; nichts wurde geändert |
| `INVALID_TEXT` | Hülle | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: `content` enthält ein einzelnes UTF-16-Surrogat; nichts wurde geändert |
| `REVIEW_BACKLOG_FULL` | Hülle | `document.write`: Das Dokument hat zu viele nicht geprüfte KI-Änderungen; nichts wurde geändert |
| `ABORTED` | Hülle | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: Der Benutzer hat das Dokument bearbeitet, geschlossen, darin komponiert oder die Auswahl verschoben, während der Schreibvorgang festgehalten wurde; `reason` sagt, was davon; nichts wurde geändert — neu lesen und erneut versuchen |
| `NOT_WORKFLOW` | Hülle | `workflow.*` wurde auf einem Tab aufgerufen, der kein YAML-Workflow ist |
| `READ_ONLY` | Hülle | Eine Mutation wurde auf einem schreibgeschützten Dokument versucht |
| `NO_EDITOR` | Hülle | `selection.*` wurde aufgerufen, aber der fokussierte Tab hat keinen aktiven Editor |
| `INTERNAL` | Hülle | Unerwarteter Handler-Fehler |
| (einfache Zeichenkette) | string | Pflichtargument fehlt oder hat falschen Typ |
