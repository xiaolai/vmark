# Integrazione IA (MCP)

VMark include un server MCP (Model Context Protocol) integrato che consente agli assistenti IA come Claude di interagire direttamente con il tuo editor.

## Cos'è MCP?

Il [Model Context Protocol](https://modelcontextprotocol.io/) è uno standard aperto che consente agli assistenti IA di interagire con strumenti e applicazioni esterne. Il server MCP di VMark espone le sue capacità editor come strumenti che gli assistenti IA possono usare per:

- Leggere e scrivere il contenuto del documento
- Applicare formattazione e creare strutture
- Navigare e gestire documenti
- Inserire contenuti speciali (matematica, diagrammi, wiki link)

## Configurazione Rapida

VMark semplifica la connessione degli assistenti IA con installazione in un clic.

### 1. Abilita il Server MCP

Apri **Impostazioni → Integrazioni** e abilita il Server MCP:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="Impostazioni Server MCP VMark" />
</div>

- **Abilita server MCP** - Attiva per consentire le connessioni IA
- **Avvia all'apertura** - Avvio automatico all'apertura di VMark
- **Approva automaticamente i salvataggi in una nuova posizione e i risultati dei genie** - Disattivato per impostazione predefinita. Consente a un'IA di salvare un documento in un percorso *nuovo* senza chiedere, e consente a un genie di applicare direttamente il proprio risultato invece che come suggerimento. Le normali scritture dell'IA non sono mai subordinate a questa opzione — la loro rete di sicurezza è la [cronologia dei checkpoint delle modifiche](#checkpoint-delle-modifiche) (vedi [Come Funzionano le Modifiche](#come-funzionano-le-modifiche))

### 2. Installa la Configurazione

Fai clic su **Installa** per il tuo assistente IA:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="Installazione Configurazione MCP VMark" />
</div>

Assistenti IA supportati:
- **Claude Desktop** - App desktop di Anthropic
- **Claude Code** - CLI per sviluppatori
- **Codex CLI** - Assistente di codifica OpenAI
- **Antigravity CLI** - `agy` di Google, il successore di Gemini CLI
- **Grok CLI** - L'agente di codifica di xAI
- **opencode** - L'agente da terminale open source e indipendente dal provider

**L'installazione scrive una credenziale per ciascun client.** Oltre al percorso del server MCP di VMark, Installa inserisce un token segreto nel file di configurazione del client stesso, sotto `env.VMARK_MCP_TOKEN` (`environment.VMARK_MCP_TOKEN` per opencode). Ogni client riceve il proprio token, che non viene conservato da nessun'altra parte. Il token indica a VMark quale client si sta connettendo, invece di fidarsi del nome che il client dichiara. Oggi ne hanno bisogno solo le azioni delegate — rispondere a una domanda di coerenza per tuo conto con `coherence_resolve`; tutti gli altri strumenti funzionano senza. Installa e **Ripara** mantengono un token ancora valido; per emetterne uno nuovo, usa Rimuovi e poi di nuovo Installa. Dopo l'una o l'altra operazione, riavvia il client IA. Tratta il token come una password: non incollare il file di configurazione in un issue o in una chat.

::: info Gemini CLI è stato dismesso
Google ha sostituito Gemini CLI con Antigravity. Se una precedente installazione di VMark ha lasciato
una voce `vmark` in `~/.gemini/settings.json`, il pannello Integrazioni mostra per essa una riga
**Dismesso** con un pulsante **Rimuovi**; le nuove installazioni puntano invece
ad Antigravity.
:::

::: info Altri Client Compatibili con MCP
Altri client compatibili con MCP come Cursor, Windsurf e strumenti simili possono anche connettersi al server MCP di VMark. Configurali manualmente puntando al percorso del binario del server MCP (vedi [Configurazione Manuale](#configurazione-manuale) di seguito).
:::

#### CC-Switch

Se gestisci le tue CLI IA con CC-Switch, il programma di installazione mostra anche una riga **CC-Switch**. **Aggiungi a CC-Switch** apre un link `ccswitch://v1/import` che consegna il server MCP di VMark — il percorso del suo binario — a CC-Switch, che poi scrive la voce `vmark` in tutte le CLI che gestisci lì; un pulsante di copia ti fornisce il link stesso, se preferisci incollarlo. La riga resta disattivata finché VMark non ha risolto il proprio binario MCP.

#### Icone di Stato

Ogni provider mostra un indicatore di stato:

| Icona | Stato | Significato |
|-------|-------|-------------|
| ✓ Verde | Valido | La configurazione è corretta e funzionante |
| ⚠ Ambra | Percorso Non Corrispondente | VMark è stato spostato — fai clic su **Ripara** |
| ✗ Rosso | Binario Mancante | Binario MCP non trovato — reinstalla VMark |
| 🗎 Rosso | Configurazione Illeggibile | VMark non riesce a leggere o analizzare il file di configurazione, quindi non si sa se contenga una voce VMark. Il messaggio indica il file e il motivo. Correggilo o spostalo, poi fai clic su **Ricontrolla** — installazione e riparazione restano bloccate finché il file non viene analizzato correttamente, perché scrivere in un file che VMark non riesce a leggere rischierebbe di distruggerne il contenuto |
| ○ Grigio | Non Configurato | Non installato — fai clic su **Installa** |

::: tip VMark Spostato?
Se sposti VMark.app in una posizione diversa, lo stato mostrerà ambra "Percorso Non Corrispondente". Fai semplicemente clic sul pulsante **Ripara** per aggiornare la configurazione con il nuovo percorso.
:::

### 3. Riavvia il Tuo Assistente IA

Dopo l'installazione o la riparazione, **riavvia completamente il tuo assistente IA** (esci e riapri) per caricare la nuova configurazione. VMark mostrerà un promemoria dopo ogni modifica alla configurazione.

### 4. Provalo

Nel tuo assistente IA, prova comandi come:
- *"Cosa c'è nel mio documento VMark?"*
- *"Scrivi un riassunto del calcolo quantistico su VMark"*
- *"Aggiungi un sommario al mio documento"*

## Guardalo in Azione

Fai una domanda a Claude e fallo scrivere la risposta direttamente nel tuo documento VMark:

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop che usa VMark MCP" />
  <p class="screenshot-caption">Claude Desktop chiama <code>document</code> → <code>set_content</code> per scrivere su VMark</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Contenuto renderizzato in VMark" />
  <p class="screenshot-caption">Il contenuto appare istantaneamente in VMark, completamente formattato</p>
</div>

<!-- Styles in style.css -->

## Configurazione Manuale

Se preferisci configurare manualmente, ecco le posizioni dei file di configurazione:

### Claude Desktop

Modifica `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) o `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Claude Code

Modifica `~/.claude.json` o il progetto `.mcp.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Codex CLI

Modifica `~/.codex/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Antigravity CLI

Modifica `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Grok CLI

Modifica `~/.grok/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### opencode

Modifica `~/.config/opencode/opencode.json`. Lo schema di opencode è diverso da quello
`mcpServers`: la chiave è `mcp`, e `command` è un unico array che contiene
il programma e i suoi argomenti:

```json
{
  "mcp": {
    "vmark": {
      "type": "local",
      "command": ["/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"],
      "enabled": true
    }
  }
}
```

Se le tue impostazioni si trovano in `opencode.jsonc`, lasciale lì — opencode
unisce entrambi i file, quindi la voce di VMark in `opencode.json` si aggiunge alle altre. VMark scrive
il file in JSON semplice perché non è in grado di preservare i commenti di un file `.jsonc`.

::: warning Una voce `vmark` esistente in `opencode.jsonc` ha la precedenza
opencode unisce `config.json`, poi `opencode.json`, poi `opencode.jsonc`, e
l'ultimo letto ha la precedenza. Quindi, se in passato hai aggiunto a mano una voce `vmark`
a `opencode.jsonc`, questa sostituisce quella gestita da VMark — VMark
segnalerà il provider come valido mentre opencode continua a usare la tua voce più vecchia (e
il suo percorso del binario non aggiornato). Elimina il blocco `mcp.vmark` scritto a mano da
`opencode.jsonc` e lascia che sia il pannello Integrazioni a gestirlo.
:::

::: tip Trovare il Percorso del Binario
Su macOS, il binario del server MCP è all'interno di VMark.app:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

Su Windows:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

Su Linux:
- `/usr/bin/vmark-mcp-server` (o dove lo hai installato)

La porta viene scoperta automaticamente — nessun argomento `args` necessario.
:::

### Flag CLI (avanzato)

Il binario del server MCP supporta un piccolo set di flag per la diagnostica e le configurazioni legacy:

| Flag | Funzione |
|---|---|
| `--version` (o `-v`) | Stampa la versione (deve corrispondere a VMark in esecuzione) ed esce. |
| `--health-check` | Esegue un autotest del binario ed esce: avvia il server MCP su un bridge simulato integrato, stampa la sua versione e il numero di strumenti in JSON, ed esce con codice diverso da zero se il numero di strumenti non è quello atteso da questa build. **Non** contatta un VMark in esecuzione — usalo per confermare che il binario funziona; usa **Impostazioni → Integrazioni** per verificare il bridge attivo. |
| `--port <numero>` | Override manuale della porta. Salta l'handshake di auto-scoperta e si connette sulla porta indicata. Utile solo per configurazioni legacy in cui la porta del bridge è fissa esternamente; il percorso di auto-scoperta è preferito. |

Esempio:

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # legacy / manuale
```

Qualsiasi altro argomento — un flag scritto male, `--port=9223` o una parola in più — viene rifiutato: il programma stampa un errore di utilizzo ed esce con codice 64 invece di ripiegare sul rilevamento automatico.

## Come Funziona

```text
Assistente IA <--stdio--> Server MCP <--WebSocket--> Editor VMark
```

1. **VMark avvia un bridge WebSocket** su una porta disponibile all'avvio
2. **Il server MCP** legge la porta e il token di autenticazione dalla directory dati dell'app VMark
3. **Il server MCP** si connette e si autentica tramite il bridge WebSocket
4. **L'assistente IA** comunica con il server MCP tramite stdio
5. **I comandi vengono inoltrati** all'editor di VMark attraverso il bridge

## Capacità Disponibili

Quando connesso, il tuo assistente IA dispone di dieci strumenti:

| Strumento | Cosa copre |
|------|----------------|
| `session` | Finestre, schede, il documento attivo e le schede del browser (sola lettura) |
| `workspace` | Nuovo, apri, salva, salva con nome, chiudi, cambia scheda, porta il focus su una finestra, apri un workspace |
| `document` | Leggere e scrivere l'intero documento come Markdown; trasformazioni di formattazione CJK |
| `selection` | Leggere e sostituire il testo selezionato |
| `comments` | Elencare i commenti di revisione del documento, rispondere e segnarli come gestiti (un assistente non può risolverli) |
| `workflow` | Patch sicure per il CST e validazione per lo YAML di GitHub Actions |
| `browser` / `browser_read` | Automazione del browser integrato su macOS — la metà che modifica e quella in sola lettura |
| `coherence` / `coherence_resolve` | Leggere il livello di coerenza; risolvere i collegamenti obsoleti in base a una delega che hai concesso |

La formattazione non è uno strumento separato: l'assistente scrive Markdown, quindi intestazioni, tabelle, formule matematiche e diagrammi sono ciò che scrive.

Vedi il [Riferimento Strumenti MCP](/it/guide/mcp-tools) per la documentazione completa.

## Verifica dello Stato MCP

VMark offre diversi modi per verificare lo stato del server MCP:

### Indicatore nella Barra di Stato

La barra di stato mostra un indicatore **MCP** sul lato destro. Quando qualcosa
richiede la tua attenzione, accanto all'icona del satellite compare una breve parola di stato;
una connessione integra è semplicemente l'icona verde. Passandoci sopra con il mouse vengono elencati i client IA
attualmente connessi, per nome e versione:

| Colore | Parola | Stato |
|--------|--------|-------|
| Verde | — | Connesso e in esecuzione |
| Grigio | `off` | Disconnesso o fermo |
| Pulsante (animato) | `…` | In avvio |
| Rosso | `error` | Il server non è riuscito — passa sopra con il mouse per vederne il motivo |

L'avvio si completa tipicamente entro 1-2 secondi.

Fai clic sull'indicatore per aprire **Impostazioni → Integrazioni**.

### Pannello Impostazioni

**Impostazioni → Integrazioni** è l'altra superficie di stato — non esiste un dialogo di stato separato. Mentre il bridge è in esecuzione, mostra l'indirizzo su cui è in ascolto (`localhost:<port>`, con un pulsante di copia) e quanti client IA sono connessi, aggiornando il dato ogni pochi secondi. Il pulsante **Testa connessione** (chiamato **Controlla sidecar** quando il bridge è fermo) esegue il `--health-check` del sidecar stesso e riporta la versione del sidecar, il suo numero di strumenti e l'orario dell'ultimo controllo — conferma che il binario installato funziona, non che un client sia connesso.

## Risoluzione dei Problemi

### "Connessione rifiutata" o "Nessun editor attivo"

- Assicurati che VMark sia in esecuzione e abbia un documento aperto
- Verifica che il Server MCP sia abilitato in Impostazioni → Integrazioni
- Verifica che il bridge MCP mostri lo stato "In esecuzione"
- Riavvia VMark se la connessione è stata interrotta

### Percorso non corrispondente dopo aver spostato VMark

Se hai spostato VMark.app in una posizione diversa (es. da Download ad Applicazioni), la configurazione punterà al vecchio percorso:

1. Apri **Impostazioni → Integrazioni**
2. Cerca l'icona di avviso ambra ⚠ accanto ai provider interessati
3. Fai clic su **Ripara** per aggiornare il percorso
4. Riavvia il tuo assistente IA

### Strumenti non visualizzati nell'assistente IA

- Riavvia il tuo assistente IA dopo aver installato la configurazione
- Verifica che la configurazione sia stata installata (controlla il segno di spunta verde nelle Impostazioni)
- Controlla i log del tuo assistente IA per errori di connessione MCP

### I comandi falliscono con "Nessun editor attivo"

- Assicurati che una scheda documento sia attiva in VMark
- Fai clic nell'area editor per mettere il focus
- Alcuni comandi richiedono che il testo sia prima selezionato

## Come Funzionano le Modifiche

La superficie MCP ridotta segue lo schema lettura-scrittura: gli assistenti IA chiamano `document.read` per ottenere il contenuto attuale + un token di revisione, ragionano su di esso, poi chiamano `document.write` con il nuovo contenuto completo. Il token di revisione protegge dalle sovrascritture silenziose: se hai digitato in VMark mentre l'IA stava ragionando, la scrittura restituisce `STALE` e l'IA rilegge.

Per i file YAML dei workflow di GitHub Actions, l'IA usa invece `workflow.apply_patch` — i modificatori di VMark consapevoli del CST preservano commenti, ancore e ordine delle chiavi che una riscrittura del testo grezzo perderebbe.

Non c'è un passaggio di anteprima per `document.write`, `selection.set` o `workflow.apply_patch` — la modifica arriva nell'editor non appena il controllo della revisione è superato. La rete di sicurezza è la [cronologia dei checkpoint delle modifiche](#checkpoint-delle-modifiche) descritta sotto; se vuoi rivedere prima che qualcosa venga applicato, tieni il documento sotto git e rivedi il diff. L'unico punto di approvazione è **Approva automaticamente i salvataggi in una nuova posizione e i risultati dei genie**: con l'opzione disattivata (il valore predefinito), un'IA non può salvare un documento in un nuovo percorso — `workspace.save_as` restituisce `APPROVAL_REQUIRED` e VMark mostra una notifica con il nome del file. Anche con l'opzione attiva, `save_as` si rifiuta di sovrascrivere un file diverso già esistente.

## Checkpoint delle Modifiche

Ogni modifica di un documento da parte dell’IA — `document.write`, `document.transform`, `selection.set` e `workflow.apply_patch` — viene registrata nella cronologia delle modifiche di VMark prima di cambiare qualsiasi cosa. Il pulsante **cronologia** nella barra di stato apre un pannello per il documento attivo. Il suo contatore indica le versioni del documento fatte dall’IA, e il pulsante assume un colore di avviso quando le modifiche non vengono registrate. Il pannello si aggiorna in tempo reale, in ogni finestra, man mano che le versioni vengono registrate.

Il pannello elenca le versioni del documento, dalla più recente. Ogni riga mostra quando è avvenuta, che tipo di modifica era, lo strumento e chi l’ha fatta: il fornitore del client IA (per esempio `claude` o `codex`), la sua connessione e la sua etichetta di sessione. Un client senza token appare come **Client non identificato**, un token sconosciuto come **Credenziale non riconosciuta** e un token condiviso da più client come **Credenziale condivisa da più fornitori** — mai come un fornitore, qualunque nome il client si dia. **Ripristina questa versione** rimette il testo di quella versione; **Ripristina lo stato precedente a questa modifica** rimette il testo precedente. Il ripristino incrementa la revisione del documento, così un client IA che detiene ancora la vecchia revisione riceve `STALE` alla scrittura successiva invece di sovrascrivere il ripristino. Anche il ripristino viene registrato: il testo che sostituisce viene conservato prima, e un documento modificato mentre il ripristino era in corso non viene toccato. Quando VMark non riesce a confermare che la voce di un ripristino sia arrivata sul disco, te lo segnala accanto al risultato.

Sopra le versioni, **Rivedi le modifiche dell’IA** elenca le modifiche dell’IA che non hai ancora rivisto, raggruppate per client e sessione; le versioni le cui modifiche sono tutte riviste sono riassunte in un conteggio. Ogni modifica offre **Mantieni** o **Ripristina** (e poi **Annulla mantenimento** o **Annulla ripristino**). Un ripristino che sovrascriverebbe testo che hai modificato nel frattempo non viene applicato: la modifica è segnata come in conflitto e, quando l’hai risolto a mano, **Segna come gestita** lo registra. Una modifica la cui posizione non può più essere certificata ne indica il motivo e non offre il ripristino automatico. **Chiudi riviste** chiude per sempre tutte le modifiche riviste, dopo una conferma, perché non si può annullare. Un documento contiene al massimo 500 modifiche dell’IA non riviste: a quel limite un avviso lo segnala e le modifiche dell’IA vengono rifiutate con `REVIEW_BACKLOG_FULL` finché non rivedi e chiudi. Un salvataggio partito da una versione diversa da quella precedente — il documento è stato modificato in due finestre — viene segnalato come tale, con entrambi i ripristini per annullare l’unione. **Mostra entrambe le modifiche** apre due differenze di quel salvataggio: *Rispetto alla versione da cui è partito questo salvataggio*, e *Rispetto alla versione precedente*, rispetto alla versione che lo precede nella cronologia.

Seguono, in **Commenti**, le discussioni dei commenti del documento. **Commenta la selezione** cita il testo selezionato nell’editor (con il solo cursore, il paragrafo in cui si trova) e aggiunge il tuo commento; il testo non salvato viene registrato prima, così un commento non punta mai a una versione precedente. Ogni discussione mostra il suo stato — aperto, gestito, risolto o riaperto —, chi l’ha scritta, il testo citato e le risposte. I commenti sono mostrati come testo semplice: l’HTML in un commento viene visualizzato, mai eseguito. Quando il testo citato ora compare più volte, la discussione dice quante; quando non c’è più, la discussione lo segnala. Puoi **Rispondere** in qualsiasi stato, **Segnare come gestito** una discussione aperta o riaperta, **Risolverla**, e **Riaprire** o **Eliminare** una discussione risolta; l’eliminazione chiede conferma e non può essere annullata. Mentre un commento o una risposta viene inviato, non può essere modificato né annullato, anche se chiudi e riapri il pannello; se viene rifiutato resta lì, così puoi cambiarlo e inviarlo di nuovo. Solo tu puoi risolvere, riaprire o eliminare una discussione. Una discussione riaperta dopo che la sua revisione originale è stata rimossa dalla cronologia mostra *Revisione di creazione non più conservata* e viene confrontata con il testo attuale.

La parte superiore del pannello indica quando le modifiche non vengono registrate: la cronologia non è riuscita ad avviarsi o è di sola lettura, è in ritardo (voci in coda non ancora su disco), l’ultimo salvataggio di questo documento è stato rifiutato o la cronologia non ha risposto in tempo, le modifiche dell’IA sono state rifiutate in una finestra con troppe pagine aperte, oppure alcune modifiche dell’IA non possono più essere annullate automaticamente. Il pannello conta anche le modifiche dell’IA registrate come modifiche all’intero documento perché non è stato possibile confermare l’intervallo modificato. Una modifica che non può più essere annullata automaticamente si legge **Bloccato: motivo (origine)** sotto l’ultima versione in cui la sua posizione era certificata, che viene evidenziata; se non ce n’è nessuna, il pannello indica che la posizione non è disponibile. Le scritture applicate ma mai registrate sono elencate in **Scritture non registrate**, ciascuna con ripristino e scarto.

Per distinguere più sessioni di uno stesso client, imposta `VMARK_SESSION_LABEL` nella configurazione MCP del client, accanto a `VMARK_MCP_TOKEN`:

```json
"env": { "VMARK_MCP_TOKEN": "…", "VMARK_SESSION_LABEL": "docs refactor" }
```

L’etichetta è lunga al massimo 128 byte UTF-8, senza caratteri di controllo; un’etichetta che viola la regola viene scartata con un avviso e il client si connette senza di essa. È scelta dalla configurazione del client, quindi serve solo alla visualizzazione e non decide nulla.

La cronologia è conservata nella cartella `agent-journal` nella directory dei dati di VMark, quindi sopravvive a un riavvio. La cartella contiene il testo precedente completo di ogni modifica registrata ed è accessibile solo al proprietario (`0700` su macOS e Linux). I checkpoint di una versione precedente di VMark (un `mcp-checkpoints.jsonl`, importato al primo avvio e poi rinominato) sono elencati in **Checkpoint precedenti**, un unico elenco per tutti i documenti e le finestre. Ripristinarne uno apre il suo file; uno senza titolo, o uno il cui file non si può più aprire, viene ripristinato in un nuovo documento. La sezione mostra quanto testo dei checkpoint è conservato e lo cancella tutto — ogni file e ogni finestra — con un’unica azione, eliminando i testi dal disco.

## Note sulla Sicurezza

- Il server MCP accetta solo connessioni locali (localhost)
- Nessun dato viene inviato a server esterni
- Le operazioni sui file dell'IA sono limitate alla radice del workspace aperto e alle cartelle dei documenti aperti — vedi [Privacy](/it/guide/privacy#cosa-puo-raggiungere-un-assistente-ia)
- Tutta l'elaborazione avviene sulla tua macchina
- Il bridge WebSocket è accessibile solo localmente
- Ogni client installato ha il proprio `VMARK_MCP_TOKEN`. Un client senza token, con un token sconosciuto o con uno condiviso con un altro client si connette comunque, ma le sue azioni delegate vengono rifiutate con un messaggio che ti chiede di eseguire Installa per quel client in **Impostazioni → Integrazioni** e di riavviarlo

## Prossimi Passi

- Esplora tutti gli [Strumenti MCP](/it/guide/mcp-tools) disponibili
- Scopri le [scorciatoie da tastiera](/it/guide/shortcuts)
- Dai un'occhiata alle altre [funzionalità](/it/guide/features)
