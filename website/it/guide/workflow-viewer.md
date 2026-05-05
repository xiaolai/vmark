# Visualizzatore di workflow GitHub Actions

VMark visualizza i file YAML dei workflow di GitHub Actions come grafo aciclico diretto (DAG) interattivo e ti consente di modificare job, step e trigger tramite form strutturati — senza mai perdere commenti, ancore o formattazione del file sottostante.

La funzionalità opera su due superfici:

1. **File `.yml` autonomi** sotto `.github/workflows/` (o qualsiasi file la cui struttura di primo livello corrisponda a un workflow): vista divisa con il sorgente a sinistra e il canvas interattivo + l'editor a form sulla destra.
2. **Blocchi di codice in Markdown**: quando un blocco recintato con triplo backtick `yaml` o `yml` contiene un workflow riconoscibile, VMark lo visualizza come DAG in stile Mermaid in linea, allo stesso modo dei blocchi `mermaid`.

## File di workflow autonomi

Apri un qualsiasi file `.github/workflows/*.yml` in VMark. Il pannello laterale destro si apre automaticamente e mostra:

- L'intero workflow come canvas React Flow interattivo (i job sono nodi, le dipendenze `needs:` sono archi).
- Un pannello editor strutturato sotto il canvas.
- Comandi Salva / Annulla nell'intestazione dell'editor.

Clicca su un job nel canvas per modificarlo. Clicca su uno step all'interno del job per modificarlo.

### Modifica dei job

Campi modificabili:

| Campo | Tipo di patch |
|-------|---------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Riepilogo in sola lettura: numero di step, `needs:` e `uses:` (per i job di workflow riutilizzabile).

### Modifica degli step

Campi modificabili:

| Campo | Tipo di patch |
|-------|---------------|
| `name` | `step.set` |
| `run` (per gli step run) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| chiavi `with:` | `with.set` / `with.remove` |

Il blocco `with:` viene visualizzato come righe chiave/valore con aggiungi/modifica/rimuovi. Rinominare una chiave emette una `with.remove` per la chiave vecchia seguita da una `with.set` per quella nuova.

Per gli step `uses:`, il riferimento all'azione è in sola lettura — modificalo nel sorgente se ti serve un'azione diversa.

### Trigger

Il riepilogo dei trigger (evento, branch, tag, path, cron, type) è in sola lettura in questa versione. Modificare la struttura densa dei trigger tramite input a riga singola è troppo lossy; modifica i trigger nel sorgente finché non arriverà un selettore dedicato.

## Salvataggio delle modifiche

Le modifiche si accumulano in una lista di patch in memoria mentre cambi i campi. Il pulsante Salva mostra il conteggio attuale (es. **3 non salvate**).

Quando clicchi Salva, VMark:

1. Legge lo YAML attuale dall'editor.
2. Applica ogni patch in coda al CST (concrete syntax tree) dello YAML — preservando commenti, ancore e formattazione esistente.
3. Riscrive il risultato nell'editor come se l'avessi digitato tu.

Il file diventa "sporco" nel senso normale; premi **Cmd+S** per scriverlo su disco.

### Conservazione della formattazione

Il percorso di salvataggio predefinito fa passare ogni patch attraverso l'API CST del pacchetto `yaml` — commenti, nodi ancora, indentazione personalizzata e le scelte di stile flow vs block esistenti vengono preservati.

Disattiva **Conserva la formattazione YAML al salvataggio** in Impostazioni → Avanzate se preferisci un output canonico riformattato. Il percorso di riformattazione perde i commenti, quindi è opt-in.

## Blocchi di codice in Markdown

Scrivi un workflow in un blocco di codice YAML:

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

VMark rileva la forma del workflow (`jobs:` di primo livello con `runs-on` per ogni job) e visualizza il diagramma in linea. Il diagramma è in sola lettura — modifica il sorgente per cambiare il workflow.

## Diagnostica

VMark mostra le diagnostiche di parse + lint accanto al sorgente:

| Prefisso del codice | Significato |
|---------------------|-------------|
| `GHA-PARSE-*` | YAML malformato o chiavi obbligatorie mancanti |
| `GHA-JOB-*` | Problemi a livello di job (id duplicato, conflitto tra `uses:` e `steps:`) |
| `GHA-NEEDS-*` | Problemi di dipendenze (riferimento sconosciuto, ciclo) |
| `GHA-STEP-*` | Problemi a livello di step |
| `GHA-EXPR-*` | Riferimenti a context sconosciuti |
| `GHA-MATRIX-*` | Problemi di espansione delle matrix |
| `GHA-SEC-*` | Avvisi di sicurezza (es. pattern di checkout in `pull_request_target`) |
| `GHA-ACTIONLINT-*` | Inoltrato da `actionlint` se installato |

Installa `actionlint` e attiva **Usa actionlint quando disponibile** in Impostazioni → Avanzate per diagnostiche delle espressioni più ricche.

## Metadati delle azioni

Per gli step `uses:` che fanno riferimento ad azioni GitHub pubbliche, VMark può recuperare il file `action.yml` di ciascuna per popolare le descrizioni degli input nell'editor strutturato. È opt-in e viene messo in cache su disco per 24 ore.

Attiva **Recupera metadati delle azioni** in Impostazioni → Avanzate. Disattivalo per mantenere tutti i riferimenti alle azioni come puro testo — non viene effettuata alcuna richiesta di rete.

## Esportazioni

Il pannello laterale del workflow include tre opzioni di esportazione accessibili dal menu nell'intestazione:

| Formato | Da usare per |
|---------|--------------|
| **Mermaid** | Inserire in README e altri documenti Markdown. Lossy: omette stato di esecuzione, icone delle azioni, badge personalizzati e dettagli dell'espansione delle matrix. |
| **SVG** | Inserire in documenti che richiedono grafica vettoriale. Usa `foreignObject` per i contenuti HTML. |
| **PNG** | Condividere in chat o ovunque l'SVG non sia supportato. Renderizza al livello di zoom corrente del canvas. |

## Cosa non è

VMark non esegue i workflow di GitHub Actions. È un visualizzatore ed editor — l'esecuzione resta compito di GitHub. La funzionalità serve esclusivamente per leggere, revisionare e scrivere YAML dei workflow.
