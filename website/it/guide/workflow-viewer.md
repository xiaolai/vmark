# Visualizzatore di workflow GitHub Actions

VMark visualizza i file YAML dei workflow di GitHub Actions come grafo aciclico diretto (DAG) interattivo e ti consente di modificare job, step, trigger, permessi e concorrenza tramite form strutturati — senza mai perdere commenti, ancore o formattazione del file sottostante.

La funzionalità opera su due superfici:

1. **File `.yml` autonomi** sotto `.github/workflows/` (o qualsiasi file YAML con le chiavi di primo livello `on:` e `jobs:`): vista divisa con il sorgente a sinistra e il canvas interattivo + l'editor a form sulla destra.
2. **Blocchi di codice in Markdown**: quando un blocco recintato con triplo backtick `yaml` o `yml` contiene un workflow riconoscibile, VMark lo visualizza in linea come immagine dello stesso grafo dei job, allo stesso modo dei blocchi `mermaid`.

::: tip Da non confondere con i workflow di VMark
Un file YAML i cui `steps:` di primo livello usano `genie/…` o `action/…` è un [flusso di lavoro Genie](/it/guide/workflows) — il formato di pipeline proprio di VMark, che VMark è in grado di eseguire. Un workflow di GitHub Actions qui viene solo visualizzato e modificato; vedi [Cosa non è](#cosa-non-e).
:::

## File di workflow autonomi

Apri un qualsiasi file `.github/workflows/*.yml` in VMark. Il file si apre in vista divisa — sorgente YAML a sinistra, il banco di lavoro del workflow a destra (il selettore Sorgente / Diviso / Anteprima cambia il layout). Il banco di lavoro mostra:

- L'intero workflow come canvas React Flow interattivo (i job sono nodi, le dipendenze `needs:` sono archi). La sua barra dei controlli regola lo zoom, adatta il grafo al riquadro e alterna il layout tra dall'alto in basso e da sinistra a destra — comodo per una lunga catena di `needs:` in un riquadro largo.
- Il comando di esportazione nell'angolo in alto a destra del canvas (vedi [Esportazioni](#esportazioni)).
- Un pannello editor strutturato sotto il canvas: il banner della [Diagnostica](#diagnostica), i comandi Salva / Scarta, i form a livello di workflow e il form del job o dello step selezionato.

Clicca su un job nel canvas per modificarlo. Clicca su uno step all'interno del job per modificarlo. Il tasto Esc annulla la selezione e riporta il focus al sorgente.

Mentre modifichi il sorgente, VMark mantiene sincronizzati i due riquadri: spostare il cursore sulle righe di un job evidenzia il suo nodo nel canvas, le espressioni `${{ }}` vengono completate automaticamente in base ai context del workflow analizzato e il Cmd-clic su un riferimento `uses:` locale apre il file di destinazione.

### Modifica dei job

Campi modificabili:

| Campo | Tipo di patch |
|-------|---------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Riepilogo in sola lettura: numero di step, `needs:` e `uses:` (per i job di workflow riutilizzabile).

**Aggiungi job** (sopra i form) crea un job a partire da un ID che digiti — deve iniziare con una lettera o un trattino basso e non deve esistere già — eseguito su `ubuntu-latest` finché non lo cambi. Il pulsante di eliminazione del form del job rimuove il job selezionato dopo la tua conferma.

Il form del job elenca anche gli step del job. Ogni riga può essere spostata su o giù oppure eliminata (dopo una conferma), e **Aggiungi step** accoda un nuovo step come `run: echo TODO`, pronto da modificare.

### Modifica degli step

Campi modificabili:

| Campo | Tipo di patch |
|-------|---------------|
| `name` | `step.set` |
| `run` (per gli step run) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| chiavi `with:` | `with.set` / `with.remove` |

Il blocco `with:` viene visualizzato come righe chiave/valore con aggiungi/modifica/rimuovi. Rinominare una chiave emette una `with.remove` per la chiave vecchia seguita da una `with.set` per quella nuova. Una chiave già usata in un'altra riga viene rifiutata in linea.

Per gli step `uses:`, il riferimento all'azione è in sola lettura — modificalo nel sorgente se ti serve un'azione diversa.

Nel modulo dello step, **Alt + Sinistra** / **Alt + Destra** passano allo step precedente / successivo. La scorciatoia funziona ovunque nella finestra, tranne dentro un campo di testo, un menu a discesa o un editor di codice, dove Alt + Freccia mantiene il suo normale significato di spostamento per parole.

### Trigger

Un trigger scritto come mappa (`on: { push: { branches: [main] } }`) ha campi filtro modificabili — branches, branches-ignore, tags, tags-ignore, paths, paths-ignore e types — ciascuno come elenco separato da virgole. Un cron di `schedule` viene mostrato come frase nella lingua dell'interfaccia — i nomi di giorni e mesi restano abbreviazioni inglesi di tre lettere (`Mon`, `Jan`) —, con un avviso quando viene eseguito più spesso di ogni 5 minuti (GitHub limita quelle pianificazioni), ed è in sola lettura. Lo stesso vale per un trigger scritto come semplice nome di evento o come elenco di nomi; modificali nel sorgente.

### Permessi e concorrenza

Due form a livello di workflow si trovano sopra il form del job:

- **Permessi** — il valore predefinito di GitHub (nessuna chiave `permissions:`), `read-all`, `write-all`, `none`, oppure una tabella per ambito (`contents`, `pull-requests`, …) con read / write / none per ciascuno.
- **Concorrenza** — il `group` e se applicare `cancel-in-progress`. Un `cancel-in-progress` scritto come espressione viene mostrato ma qui non è modificabile.

## Salvataggio delle modifiche

Le modifiche si accumulano in una lista di patch in memoria mentre cambi i campi. Il pulsante Salva mostra il conteggio attuale (es. **3 non salvate**), e i nuovi job e step compaiono già nel canvas e nei form prima del salvataggio.

Quando clicchi Salva, VMark:

1. Legge lo YAML attuale dall'editor.
2. Applica ogni patch in coda al CST (concrete syntax tree) dello YAML — preservando commenti, ancore e formattazione esistente.
3. Per un file su disco, scrive il risultato nel file, poi aggiorna l'editor di conseguenza — a meno che nel frattempo tu non abbia digitato nel sorgente, nel qual caso ciò che hai digitato viene mantenuto.

Se la scrittura non riesce, non si perde nulla: le modifiche restano in coda e puoi salvare di nuovo. Un documento senza titolo non ha un file in cui scrivere, quindi Salva aggiorna solo l'editor; premi **Cmd+Shift+S** per salvarlo. **Scarta** elimina le modifiche in coda.

### Conservazione della formattazione

Il percorso di salvataggio predefinito fa passare ogni patch attraverso l'API CST del pacchetto `yaml` — commenti, nodi ancora, indentazione personalizzata e le scelte di stile flow vs block esistenti vengono preservati.

Disattiva **Mantieni la formattazione YAML al salvataggio** in Impostazioni → Avanzate se preferisci un output canonico riformattato. Il percorso di riformattazione perde i commenti, quindi è opt-in.

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

VMark rileva la forma del workflow (chiavi di primo livello `on:` e `jobs:`) e visualizza in linea un'immagine del suo grafo dei job — lo stesso canvas della vista autonoma, catturato come immagine. L'immagine è in sola lettura; fai doppio clic su di essa per modificare il sorgente.

## Diagnostica

VMark mostra le diagnostiche di parse + lint in un banner in cima al pannello dei form. Cliccando su una riga il sorgente salta alla riga incriminata, oppure viene selezionato il job incriminato quando la riga non è disponibile (ad esempio in modalità Anteprima):

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

Installa `actionlint` per diagnostiche delle espressioni più ricche. Con **Usa actionlint quando disponibile** attivo — in Impostazioni → Avanzate (File di workflow), attivo per impostazione predefinita — VMark esegue il binario dal PATH della shell di login ogni volta che il sorgente di un file di workflow cambia e aggiunge i risultati al banner della Diagnostica del banco di lavoro, contrassegnati come `GHA-ACTIONLINT-<rule>`; i controlli integrati elencati sopra non lo attendono mai. Se l'interruttore è attivo ma il binario non è installato, VMark te lo segnala una volta per sessione e per il resto non dice nulla; se il binario è presente ma non riesce a essere eseguito, l'errore viene segnalato una volta con il messaggio di actionlint stesso. Disattiva l'interruttore per saltare del tutto actionlint. L'operazione MCP `workflow.validate` esegue lo stesso controllo su richiesta.

## Metadati delle azioni

Per gli step `uses:` che fanno riferimento ad azioni GitHub pubbliche, VMark recupera il file `action.yml` di ciascuna per popolare le descrizioni degli input nell'editor strutturato. I risultati vengono messi in cache su disco per 24 ore. Le azioni locali dello spazio di lavoro (`./…`) vengono lette dal disco, mai dalla rete.

Per mantenere l'editor di workflow completamente offline, disattiva **Recupera i metadati delle action** in Impostazioni → Avanzate (File di workflow) — quando è disattivato non viene effettuata alcuna richiesta di rete e il form `with:` ripiega su righe chiave/valore libere.

## Esportazioni

Il comando di esportazione nell'angolo in alto a destra del canvas offre tre formati:

| Formato | Da usare per |
|---------|--------------|
| **Mermaid** | Inserire in README e altri documenti Markdown. Copiato negli appunti. Lossy: omette stato di esecuzione, icone delle azioni, badge personalizzati e dettagli dell'espansione delle matrix. |
| **SVG** | Inserire in documenti che richiedono grafica vettoriale. Usa `foreignObject` per i contenuti HTML. |
| **PNG** | Condividere in chat o ovunque l'SVG non sia supportato. Renderizza al livello di zoom corrente del canvas. |

## Cosa non è

VMark non esegue i workflow di GitHub Actions. È un visualizzatore ed editor — l'esecuzione resta compito di GitHub. La funzionalità serve esclusivamente per leggere, revisionare e scrivere YAML dei workflow. Le pipeline eseguibili proprie di VMark sono un formato diverso: vedi [Flussi di lavoro Genie](/it/guide/workflows).
