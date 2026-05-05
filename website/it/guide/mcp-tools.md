# Riferimento Strumenti MCP

VMark espone **quattro strumenti MCP compositi** agli assistenti IA: `session`, `workspace`, `document` e `workflow`. Insieme coprono **14 azioni** — la spina dorsale lettura/scrittura più il ciclo di vita di file/finestre più le modifiche CST-safe per lo YAML di GitHub Actions.

La precedente superficie di 12 strumenti / 76 azioni è stata ridotta perché gli strumenti di formattazione interni al documento (grassetto, intestazioni, tabelle, ecc.) duplicano un lavoro che gli agenti IA fanno già banalmente tramite il round-trip Markdown. Vedi [il piano di riduzione MCP](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md) per la motivazione completa.

::: tip Flusso di Lavoro Consigliato
1. Chiama `session.get_state` una volta per vedere finestre aperte, schede e per ogni scheda `{filePath, dirty, revision, kind}`.
2. Per Markdown: `document.read` → ragionare → `document.write` (passando `expected_revision` per concorrenza sicura).
3. Per YAML di GitHub Actions (`kind: "yaml-workflow"`): `workflow.apply_patch` per modifiche CST-safe che preservano commenti e ancore; `workflow.validate` per la diagnostica actionlint.
4. Le operazioni sui file (apri, salva, chiudi, cambia scheda) si trovano in `workspace`.
:::

::: tip Diagrammi Mermaid
Quando si usa l'IA per generare diagrammi Mermaid tramite MCP, considera l'installazione del [server MCP mermaid-validator](/it/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) — rileva gli errori di sintassi usando gli stessi parser Mermaid v11 prima che i diagrammi raggiungano il tuo documento.
:::

---

## `session`

Orientamento one-shot. Scopri ogni finestra, ogni scheda e le capacità del server in una singola chiamata.

### `get_state`

Nessun argomento.

**Restituisce** `{windows, capabilities}`:

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

Il discriminatore `kind` ti dice se usare `document.write` (per markdown) o `workflow.apply_patch` (per yaml-workflow) su quella scheda.

---

## `workspace`

Ciclo di vita di file e finestre. Niente all'interno del documento.

### `new`

Crea una nuova scheda senza titolo.

| Parametro | Tipo | Richiesto | Descrizione |
|-----------|------|-----------|-------------|
| `kind` | stringa | No | `"markdown"` (predefinito) o `"yaml-workflow"` |
| `windowLabel` | stringa | No | Finestra di destinazione; predefinita su quella in primo piano |

Restituisce `{tabId}`.

### `open`

Apri un file da disco.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `filePath` | stringa | Sì |
| `windowLabel` | stringa | No |

Restituisce `{tabId}`.

### `save`

Salva una scheda nel suo percorso esistente.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No (predefinito su quella in primo piano) |

Restituisce `{filePath, revision}`.

### `save_as`

Salva una scheda in un nuovo percorso.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No |
| `filePath` | stringa | Sì |

Restituisce `{revision}`.

### `close`

Chiude una scheda. Rifiuta di scartare lavoro non salvato senza `force`.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | Sì |
| `force` | booleano | No |

Restituisce `{closed: true}` in caso di successo, `{closed: false, reason: "DIRTY"}` se la scheda è modificata e `force` non è stato fornito.

### `switch_tab`

Attiva una scheda.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | Sì |

### `focus_window`

Porta in primo piano una finestra.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `windowLabel` | stringa | Sì |

---

## `document`

Leggere, scrivere, trasformare. La spina dorsale della superficie.

### `read`

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No (predefinito su quella in primo piano) |

Restituisce `{content, revision, filePath, kind, dirty}`. Leggi sempre prima di scrivere — il token `revision` deve accompagnare il prossimo `write`.

### `write`

Sostituisce il contenuto completo del documento.

| Parametro | Tipo | Richiesto | Descrizione |
|-----------|------|-----------|-------------|
| `tabId` | stringa | No | Scheda di destinazione (predefinito su quella in primo piano) |
| `content` | stringa | Sì | Nuovo contenuto completo |
| `expected_revision` | stringa | No | Token di revisione dalla lettura più recente |

Se viene fornito `expected_revision` e il documento è cambiato dopo quella lettura, la risposta è una busta di errore strutturato `STALE` con la revisione corrente; rileggi e riprova.

```json
// successo
{ "revision": "rev-newAfterWrite" }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

Applica una riscrittura deterministica. Attualmente supporta trasformazioni specifiche CJK (conversione punteggiatura larghezza intera ↔ ASCII, spaziatura CJK ↔ Latino).

| Parametro | Tipo | Richiesto | Descrizione |
|-----------|------|-----------|-------------|
| `tabId` | stringa | No | Scheda di destinazione |
| `kind` | stringa | Sì | `"cjk-format"`, `"cjk-spacing"` o `"cjk-punctuation"` |
| `expected_revision` | stringa | No | Token di concorrenza |

`cjk-format` applica le impostazioni di formattazione CJK dell'utente end-to-end. `cjk-spacing` inserisce singoli spazi tra caratteri CJK e Latini/cifre adiacenti. `cjk-punctuation` converte la punteggiatura ASCII che si trova accanto ai caratteri CJK nella sua forma a larghezza intera.

Restituisce `{revision}`.

---

## `workflow`

Validazione `actionlint` e **modifiche chirurgiche CST-safe** per lo YAML dei workflow GitHub Actions. Disponibile solo per le schede il cui `kind` è `"yaml-workflow"`.

::: info `document.read` / `document.write` funzionano su ogni scheda — incluso lo YAML del workflow
Lo strumento `workflow` **non** è un sostituto della spina dorsale lettura/scrittura. Per una scheda di workflow, puoi:

- `document.read` per ottenere il testo YAML grezzo (con tutti i commenti)
- `document.write` per sostituirlo interamente (qualsiasi stringa invii viene memorizzata letteralmente — i commenti vengono preservati se li includi)
- `workflow.apply_patch` quando vuoi che **il server stesso garantisca** che commenti, ancore e ordine delle chiavi sopravvivano a una modifica parziale

Usa `apply_patch` quando cambi un campo lasciando tutto il resto intatto (il server non può eliminare i commenti che non modifica). Usa `document.write` quando stai riscrivendo interamente o generando un nuovo workflow da zero.
:::

### `apply_patch`

Applica un array di oggetti `IRPatch`. Le patch sono inviate attraverso i mutatori CST-aware di VMark, che preservano commenti, ancore e ordine delle chiavi. Un `document.write` grezzo su un file YAML li perderebbe.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No |
| `patches` | IRPatch[] | Sì |
| `expected_revision` | stringa | No |

`IRPatch` è un'unione discriminata (campo `kind`). Tipi supportati:

| `kind` | Effetto |
|---|---|
| `workflow.set` | Imposta i campi top-level (`{path, value}`) — `name`, `env.X`, ecc. |
| `job.set` | Imposta un campo su un job (`{jobId, path, value}`) |
| `step.set` | Imposta un campo su uno step (`{jobId, stepIndex, path, value}`) |
| `with.set` | Imposta una chiave nel blocco `with:` di uno step (`{jobId, stepIndex, key, value}`) |
| `with.remove` | Rimuove una chiave dal blocco `with:` di uno step |
| `needs.add` / `needs.remove` | Aggiungi o rimuovi un ID job da `needs:` |
| `trigger.setFilters` | Sostituisci un array di filtri trigger — branches, paths, types, ecc. (`{event, filter, value: string[]}`) |

Restituisce `{revision}` in caso di successo o una busta di errore strutturato `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW`.

### `validate`

Esegui `actionlint` sullo YAML del workflow.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No |

Restituisce `{ok, diagnostics, binaryAvailable}`. Ogni diagnostica trasporta `{line, col, message, severity}`. `binaryAvailable: false` significa che `actionlint` non è installato localmente; installa tramite Homebrew o le release upstream.

---

## Errori

Compaiono due forme di errore:

**Errori di dominio** — impostano `success: false` e restituiscono una busta codificata in JSON in `error`:

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**Errori sulla forma degli argomenti** — per argomenti richiesti mancanti/non validi (ad es. `document.write` senza un campo `content`), `error` è una stringa semplice che descrive il problema. La busta strutturata è riservata alle condizioni a livello di dominio.

| Codice | Mostrato come | Significato |
|---|---|---|
| `STALE` | busta | `expected_revision` non corrispondeva; rileggi e riprova |
| `INVALID_PATCH` | busta | `workflow.apply_patch` ha ricevuto un array `patches` malformato |
| `INVALID_TAB` | busta | `tabId` non poteva essere risolto |
| `INVALID_PATH` | busta | `workspace.open` ha ricevuto un `filePath` che non poteva essere letto |
| `NOT_WORKFLOW` | busta | `workflow.*` è stato chiamato su una scheda non YAML-workflow |
| `READ_ONLY` | busta | È stata tentata una mutazione su un documento di sola lettura |
| `INTERNAL` | busta | Errore inaspettato del gestore |
| (stringa semplice) | stringa | Argomento richiesto mancante o tipo errato |
