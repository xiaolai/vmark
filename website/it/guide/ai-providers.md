# Provider IA

I [Genies IA](/it/guide/ai-genies) di VMark necessitano di un provider IA per generare suggerimenti. Puoi usare uno strumento CLI installato localmente o connetterti direttamente a un'API REST.

## Configurazione Rapida

Il modo più veloce per iniziare:

1. Apri **Impostazioni > Integrazioni**
2. Fai clic su **Rileva** per cercare gli strumenti CLI installati
3. Se viene trovato un CLI (es. Claude, Gemini), selezionalo — hai finito
4. Se non è disponibile alcun CLI, scegli un provider REST, inserisci la tua chiave API e seleziona un modello

È attivo un solo provider alla volta.

## Provider CLI

I provider CLI utilizzano strumenti IA installati localmente. VMark li esegue come sottoprocessi e trasmette il loro output all'editor.

| Provider | Comando CLI | Installazione |
|----------|-------------|---------------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |

### Come Funziona il Rilevamento CLI

Fai clic su **Rileva** in Impostazioni > Integrazioni. VMark cerca ogni comando CLI nel tuo `$PATH` e ne riporta la disponibilità. Se un CLI viene trovato, il suo pulsante di selezione diventa attivabile. **Rileva** ripete la ricerca a ogni clic; il rilevamento automatico (all'avvio dell'app, all'apertura delle Impostazioni e nel selettore del provider del selettore genie) riutilizza l'ultima ricerca. La ricerca usa il `$PATH` che VMark ha letto dalla tua shell di login all'avvio, quindi un CLI installato in una directory appena aggiunta al `$PATH` richiede un riavvio di VMark prima che **Rileva** possa trovarlo.

### Vantaggi

- **Nessuna chiave API necessaria** — il CLI gestisce l'autenticazione usando il tuo login esistente
- **Molto più economico** — gli strumenti CLI usano il tuo piano in abbonamento (es. Claude Max, ChatGPT Plus/Pro, Google One AI Premium), che costa un importo fisso mensile. I provider API REST addebitano per token e possono costare 10–30 volte di più per un utilizzo intenso
- **Usa la tua configurazione CLI** — le preferenze del modello, i prompt di sistema e la fatturazione sono gestiti dal CLI stesso

::: tip Abbonamento vs API per Sviluppatori
Se stai usando questi strumenti anche per il vibe-coding (Claude Code, Codex CLI, Gemini CLI), lo stesso abbonamento copre sia i Genies IA di VMark che le tue sessioni di codifica — senza costi aggiuntivi.
:::

### Configurazione: Claude CLI

1. Installa Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Esegui `claude` una volta nel tuo terminale per autenticarti
3. In VMark, fai clic su **Rileva**, poi seleziona **Claude**

### Configurazione: Gemini CLI

1. Installa Gemini CLI: `npm install -g @google/gemini-cli` (o tramite il [repository ufficiale](https://github.com/google-gemini/gemini-cli))
2. Esegui `gemini` una volta per autenticarti con il tuo account Google
3. In VMark, fai clic su **Rileva**, poi seleziona **Gemini**

## Provider API REST

I provider REST si connettono direttamente alle API cloud (o locali). Ognuno richiede un endpoint, una chiave API e il nome del modello. Le risposte arrivano in un unico blocco quando la richiesta è completata — i provider REST non trasmettono i token in streaming; i provider CLI sì.

| Provider | Endpoint Predefinito | Variabile d'Ambiente |
|----------|---------------------|---------------------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| Compatibile con OpenAI | *(lo imposti tu)* | — |
| Google AI | *(integrato)* | `GOOGLE_API_KEY` o `GEMINI_API_KEY` |
| Ollama (API) | `http://localhost:11434` | — |

### Campi di Configurazione

Quando selezioni un provider REST, appaiono tre campi:

- **Endpoint API** — L'URL base (nascosto per Google AI, che usa un endpoint fisso). Un `/v1` finale va bene — VMark lo normalizza in modo che il percorso non venga duplicato (es. `https://host/v1` e `https://host` funzionano entrambi)
- **Chiave API** — La tua chiave segreta. Viene conservata nell'archivio delle credenziali del sistema operativo, mai in `localStorage` o in un file di impostazioni in chiaro — vedi [Dove risiedono le chiavi API](#dove-risiedono-le-chiavi-api)
- **Modello** — L'identificatore del modello (es. `claude-sonnet-4-5-20250929`, `gpt-4o`, `gemini-2.0-flash`)

### Compilazione Automatica tramite Variabili d'Ambiente

VMark legge le variabili d'ambiente standard dall'ambiente del proprio processo. Se `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` o `GOOGLE_API_KEY` / `GEMINI_API_KEY` (controllate in quest'ordine) è impostata, il campo della chiave API si compila automaticamente quando selezioni quel provider.

Le variabili che VMark vede dipendono da come è stato avviato. Una chiave esportata in un profilo shell come `~/.zshrc` o `~/.bashrc`:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

raggiunge VMark solo quando avvii l'app da quella shell. Se viene avviato dal Dock, dal Finder, da Spotlight o da un launcher del desktop, VMark non legge il tuo profilo shell, quindi il campo resta vuoto — incolla invece la chiave. Su Windows, una variabile d'ambiente utente o di sistema funziona comunque venga avviato VMark.

### Configurazione: Anthropic (REST)

1. Ottieni una chiave API da [console.anthropic.com](https://console.anthropic.com)
2. In Impostazioni VMark > Integrazioni, seleziona **Anthropic**
3. Incolla la tua chiave API
4. Scegli un modello (predefinito: `claude-sonnet-4-5-20250929`)

### Configurazione: OpenAI (REST)

1. Ottieni una chiave API da [platform.openai.com](https://platform.openai.com)
2. In Impostazioni VMark > Integrazioni, seleziona **OpenAI**
3. Incolla la tua chiave API
4. Scegli un modello (predefinito: `gpt-4o`)

### Configurazione: Compatibile con OpenAI (DeepSeek, Groq, OpenRouter, …)

Molti provider parlano lo stesso protocollo di OpenAI (`/v1/chat/completions`, autenticazione `Bearer`). Lo slot **Compatibile con OpenAI** si collega a uno qualsiasi di essi — DeepSeek, Groq, OpenRouter, Together, Moonshot, un gateway self-hosted e così via — senza una voce dedicata per ciascun fornitore.

Rispetto agli altri provider REST aggiunge un campo in più: un **Nome del provider** modificabile, così la riga mostra "DeepSeek" (o qualunque nome tu imposti) invece dell'etichetta generica.

Esempio — DeepSeek:

1. Ottieni una chiave API da [platform.deepseek.com](https://platform.deepseek.com)
2. In Impostazioni VMark > Integrazioni, seleziona **Compatibile con OpenAI**
3. Imposta **Nome del provider** su `DeepSeek` (facoltativo, solo estetico)
4. Imposta **Endpoint API** su `https://api.deepseek.com` (un `/v1` finale va bene — VMark lo normalizza)
5. Incolla la tua chiave API
6. Imposta **Modello** su `deepseek-chat` (o `deepseek-reasoner`). Digitalo direttamente, oppure fai clic su aggiorna per scaricare l'elenco dei modelli dell'endpoint

L'endpoint è obbligatorio — non esiste un host predefinito per questo slot. Usa i pulsanti **Test** (⚡) e **Testa modello** (🧪) per verificare la connessione prima di eseguire un genie.

### Configurazione: Google AI (REST)

1. Ottieni una chiave API da [aistudio.google.com](https://aistudio.google.com)
2. In Impostazioni VMark > Integrazioni, seleziona **Google AI**
3. Incolla la tua chiave API
4. Scegli un modello (predefinito: `gemini-2.0-flash`)

### Configurazione: Ollama API (REST)

Usa questo quando vuoi accesso in stile REST a un'istanza Ollama locale, o quando Ollama è in esecuzione su un altro computer della tua rete.

1. Assicurati che Ollama sia in esecuzione: `ollama serve`
2. In Impostazioni VMark > Integrazioni, seleziona **Ollama (API)**
3. Imposta l'endpoint su `http://localhost:11434` (o il tuo host Ollama)
4. Lascia vuota la chiave API
5. Imposta il modello con il nome del tuo modello scaricato (es. `llama3.2`)

## Scegliere un Provider

| Situazione | Raccomandazione |
|------------|-----------------|
| Hai già Claude Code installato | **Claude (CLI)** — configurazione zero, usa il tuo abbonamento |
| Hai già Codex o Gemini installato | **Codex / Gemini (CLI)** — usa il tuo abbonamento |
| Necessiti di privacy / offline | Installa Ollama → **Ollama (API)** su `http://localhost:11434` |
| Modello personalizzato o self-hosted | **Ollama (API)** con il tuo endpoint |
| DeepSeek / Groq / OpenRouter / qualsiasi API compatibile con OpenAI | **Compatibile con OpenAI** — imposta endpoint, chiave e modello |
| Vuoi l'opzione cloud più economica | **Qualsiasi provider CLI** — l'abbonamento è molto più economico dell'API |
| Nessun abbonamento, uso leggero | Imposta la chiave API come variabile d'ambiente → **Provider REST** (paga per token) |
| Hai bisogno dell'output di qualità più alta | **Claude (CLI)** o **Anthropic (REST)** con `claude-sonnet-4-5-20250929` |

## Override del Modello per Genie

I singoli genies possono sovrascrivere il modello predefinito del provider usando il campo `model` nel frontmatter:

```markdown
---
name: quick-fix
description: Quick grammar fix
scope: selection
model: claude-haiku-4-5-20251001
---
```

Questo è utile per indirizzare i compiti semplici verso modelli più veloci/economici mantenendo un modello predefinito potente.

## Affidabilità e timeout

VMark protegge ogni chiamata al provider in modo che un CLI bloccato o una risposta API non valida non possano mai bloccare l'editor:

- **Timeout del sottoprocesso CLI**: ogni invocazione di un provider CLI viene eseguita con un timeout di esecuzione. Se il CLI non risponde, VMark annulla la chiamata, restituisce l'errore al genie e libera il worker — il pool di thread non può essere bloccato da un sottoprocesso impazzito.
- **Sicurezza nell'analisi JSON REST**: se un provider REST restituisce una risposta con forma inaspettata (pagina di errore HTML, JSON troncato, deriva dello schema dopo una modifica upstream), VMark segnala un errore tipizzato al frontend invece di lasciare il listener IA in attesa per sempre. Vedrai l'errore nel banner di stato del genie con la possibilità di riprovare.
- **Token di cancellazione**: i passaggi di genie o workflow di lunga durata possono essere cancellati in qualsiasi momento — Annulla nel selettore genie o chiudi il pannello e la richiesta in corso si interrompe in modo pulito.
- **Client HTTP condiviso**: i provider REST condividono un singolo client `reqwest` con pool di connessioni, quindi le esecuzioni consecutive di genie non pagano il costo di handshake TCP/TLS ogni volta.
- **Scoperta del PATH su Windows**: su Windows, VMark legge il `PATH` completo dell'utente (incluse le voci solo PowerShell) quando rileva i CLI, in modo che gli strumenti installati dall'utente che funzionano in un terminale funzionino anche dentro VMark.

## Dove Risiedono le Chiavi API

Le chiavi API sono custodite nell'archivio delle credenziali del sistema operativo — Portachiavi di macOS, Gestione credenziali di Windows o Secret Service di Linux — sotto il nome di servizio `app.vmark.secrets`, una voce per provider. VMark ne tiene una copia in memoria solo per la sessione in corso; le impostazioni dei provider salvate non contengono mai una chiave, e nulla viene scritto in `localStorage`. Una chiave salvata da una versione precedente di VMark in un file di impostazioni in chiaro viene spostata nel portachiavi la prima volta che la versione più recente la carica, e la copia in chiaro viene eliminata solo dopo che la scrittura nel portachiavi è stata riletta con successo.

Se il portachiavi rifiuta una scrittura, VMark mostra un toast di errore invece di tenere silenziosamente la chiave in memoria. Su macOS, una build di sviluppo con firma ad hoc può richiedere di nuovo l'accesso al portachiavi dopo ogni nuova firma; una build di rilascio lo chiede una sola volta.

## Note sulla Sicurezza

- **Le chiavi API risiedono nel portachiavi del sistema operativo** — vedi sopra; non vengono mai scritte nei file delle impostazioni di VMark né in `localStorage`
- **Le variabili d'ambiente** vengono lette quando selezioni un provider e compilano solo un campo della chiave vuoto
- **I provider CLI** usano la tua autenticazione CLI esistente — VMark non vede mai le tue credenziali
- **Tutte le richieste vanno direttamente** dalla tua macchina al provider — nessun server VMark intermedio

## Risoluzione dei Problemi

**"Nessun provider IA disponibile"** — Fai clic su **Rileva** per cercare i CLI, o configura un provider REST con una chiave API.

**Il CLI mostra "Non trovato"** — Il CLI non è nel tuo `$PATH`. Installalo o controlla il tuo profilo shell. Su macOS, le app GUI potrebbero non ereditare il `$PATH` del terminale — prova ad aggiungere il percorso a `/etc/paths.d/`.

**Il CLI si blocca / nessuna risposta** — Il timeout di esecuzione di VMark annullerà la chiamata automaticamente; vedrai un errore nel banner di stato del genie. Se un particolare CLI raggiunge sistematicamente il timeout, eseguilo una volta dal terminale per confermare che funzioni lì, poi verifica se richiede un'autenticazione interattiva.

**Il provider REST restituisce 401** — La tua chiave API non è valida o è scaduta. Genera una nuova dalla console del provider.

**Il provider REST restituisce 429** — Hai raggiunto un limite di frequenza. Attendi un momento e riprova, o passa a un provider diverso.

**Il provider REST restituisce JSON alterato / inaspettato** — VMark segnala un errore di analisi tipizzato (es. "list_models ha restituito una forma di risposta inaspettata"). Controlla l'URL dell'endpoint e verifica che il contratto API corrisponda al tipo di provider selezionato; alcuni gateway self-hosted pubblicizzano URL compatibili con OpenAI ma hanno uno schema diverso.

**Risposte lente** — I provider CLI aggiungono un overhead da sottoprocesso. Per risposte più veloci, usa i provider REST che si connettono direttamente. Per l'opzione locale più veloce, usa Ollama con un modello piccolo.

**Errore modello non trovato** — L'identificatore del modello non corrisponde a quello offerto dal provider. Controlla la documentazione del provider per i nomi di modello validi.

## Vedi Anche

- [Genies IA](/it/guide/ai-genies) — Come usare l'assistenza alla scrittura con IA
- [Configurazione MCP](/it/guide/mcp-setup) — Integrazione IA esterna tramite Model Context Protocol
