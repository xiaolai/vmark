<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# Genie del workflow

I Genie di VMark sono disponibili in due varianti:

- **Genie markdown** (`.md`) — modelli di prompt a singolo turno. Il formato originale dei Genie. Vedi [AI Genies](/it/guide/ai-genies).
- **Genie del workflow** (`.yml` / `.yaml`) — pipeline multi-passaggio che concatenano i genie markdown con un flusso di dati esplicito.

Entrambi i formati risiedono nella stessa directory globale dei genie e compaiono nello stesso selettore (`Cmd+Y`). Un genie del workflow appare come una normale riga Genie; selezionandolo viene avviato l'esecutore del workflow al posto della singola chiamata IA.

## Quando usare quale

| Esigenza | Formato |
|------|--------|
| Trasformazione singola (riscrittura, traduzione, riassunto) | Markdown |
| Pipeline scaletta → bozza → rifinitura | Workflow |
| Modelli IA diversi per fasi diverse | Workflow |
| Passaggi che richiedono punti di approvazione | Workflow |
| L'output di una fase alimenta la successiva | Workflow |

Se basta un singolo prompt, usa un genie markdown. Se hai bisogno di comporre fasi, di un flusso di dati strutturato o di un'approvazione con intervento umano, usa un workflow.

## Formato del file

Un genie del workflow è un file YAML. Campi di primo livello:

| Campo | Obbligatorio | Scopo |
|-------|----------|---------|
| `name` | Sì | Etichetta leggibile. Il selettore usa il **nome del file** come nome visualizzato; questo campo compare come descrizione se `description:` non è impostato. |
| `description` | No | Riepilogo di una riga mostrato nel selettore. |
| `defaults` | No | Modello / approvazione / limiti predefiniti applicati a ogni passaggio. |
| `env` | No | Variabili d'ambiente disponibili come `${VAR}` o `${{ env.NAME }}`. |
| `steps` | Sì | Elenco ordinato dei passaggi. |

### Forma del passaggio

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

### Tipi di passaggio

| Prefisso `uses:` | Comportamento |
|----------------|----------|
| `genie/<name>` | Carica il genie markdown corrispondente, ne riempie il modello con la mappa `with:` del passaggio e chiama il provider IA attivo. I segnaposto `{{content}}` / `{{input}}` del genie markdown raccolgono `with.input` automaticamente. |
| `action/read-file` | Legge un percorso relativo al workspace. L'output è il contenuto del file. |
| `action/save-file` | Scrive `with.input` in `with.path`. |
| `action/notify` | Registra `with.message`. |
| `action/copy` | Restituisce `with.input` invariato (utile per il concatenamento). |

### Espressioni

All'interno di qualsiasi valore `with:`:

| Sintassi | Si risolve in |
|--------|-------------|
| `${{ steps.ID.outputs.FIELD }}` | Un campo di output specifico di un passaggio precedente. |
| `${{ steps.ID.output }}` | Forma abbreviata di `outputs.text` di un passaggio precedente. |
| `${{ env.NAME }}` | Un valore `env:` del workflow. |
| `${VAR}` | Come sopra, forma legacy. |
| `stepId.output` (intera stringa) | Alias legacy di `${{ steps.stepId.output }}`. |

Riferimenti sconosciuti a passaggi o campi fanno fallire il passaggio al momento della risoluzione dei parametri, prima di qualsiasi chiamata IA.

### Associazione del modello

Quando un passaggio `genie/<name>` viene eseguito, il modello di prompt del suo genie markdown viene riempito secondo queste regole:

- `{{input}}` → `with.input`
- `{{content}}` → `with.content` se presente, altrimenti `with.input` (fatale se nessuno dei due)
- `{{context}}` → `with.context` se presente, altrimenti stringa vuota (mai fatale)
- `{{any-other-key}}` → `with.<key>` (fatale se mancante)

Questo significa che **i genie markdown esistenti funzionano senza modifiche** nei workflow: invocali con `with: { input: "..." }` e il segnaposto `{{content}}` lo raccoglierà tramite la catena di alias.

### Punto di approvazione

Quando un passaggio ha `approval: ask` (oppure il workflow imposta `defaults.approval: ask`), l'esecutore si mette in pausa, apre una finestra di dialogo che mostra l'anteprima del prompt risolto e il modello, e attende il verdetto dell'utente prima di chiamare il provider. Esc rifiuta. Il timeout è il minore tra `limits.timeout` del passaggio e 10 minuti.

## Esempio

VMark include un workflow di esempio in `outline-and-polish.yml` tra i genie distribuiti. Copialo nella tua directory utente dei genie per personalizzarlo:

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

`genie/outline` produce una scaletta strutturata; il passaggio `polish` riscrive poi quell'output per renderlo più chiaro. I due riferimenti `genie/*` si risolvono nei genie markdown distribuiti in `structure/outline.md` e `editing/polish.md`.

## Annullamento, timeout, limiti

- **Annulla** — Fai clic su Stop nel pannello laterale del workflow. L'esecutore termina entro un tick qualsiasi processo figlio del provider CLI in esecuzione e annulla le richieste REST in corso.
- **Timeout per passaggio** — Avvolto in `tokio::time::timeout(step.limits.timeout)`. Allo scadere, il passaggio fallisce con "Timed out after Xs" e i passaggi a valle vengono saltati.
- **Limite di output** — L'output di un singolo passaggio è limitato a 5 MB. Un provider fuori controllo provoca l'annullamento più "Provider output exceeded 5 MB cap".

## Vedi anche

- [AI Genies](/it/guide/ai-genies) — formato e creazione dei genie markdown.
- [Visualizzatore workflow](/it/guide/workflow-viewer) — lo stesso pannello laterale React Flow usato qui, originariamente concepito per i workflow di GitHub Actions.

</div>
