# Privacy

VMark è un editor local-first: i tuoi documenti sono file sul tuo disco, il rendering avviene sulla tua macchina, e non ci sono account, telemetria né segnalazioni di crash. Questa pagina elenca ogni modo in cui VMark usa la rete, cosa invia ciascuno e come disattivarlo — e cosa VMark può leggere sul tuo disco.

## Ogni Connessione di Rete di VMark

| Quando | Dove va | Cosa viene inviato | Come fermarla |
|------|---------------|--------------|----------------|
| Controllo degli aggiornamenti — all'avvio per impostazione predefinita | `log.vmark.app`, poi GitHub Releases come riserva | Piattaforma, architettura, versione dell'app e un hash anonimo della macchina — [dettagli sotto](#il-controllo-degli-aggiornamenti-in-dettaglio) | **Impostazioni → Informazioni → Frequenza di controllo → Solo manuale**, oppure blocca `log.vmark.app` |
| Esecuzione di un genie IA con un **provider REST** | L'endpoint che hai configurato — Anthropic, OpenAI, un host compatibile con OpenAI, Google AI o il tuo host Ollama | Il prompt compilato: il testo selezionato, il blocco o il documento più l'eventuale contesto circostante richiesto dal genie, e la tua chiave API. Anche i pulsanti **Test** e di aggiornamento dei modelli contattano l'endpoint | Non configurare alcun provider, oppure usa Ollama in locale |
| Esecuzione di un genie IA con un **provider CLI** | Niente da parte di VMark stesso — la CLI `claude`, `codex` o `gemini` che hai installato comunica con il proprio fornitore con il proprio account | VMark passa il prompt alla CLI sulla tua macchina | Come sopra |
| Esportazione HTML | jsDelivr (cdnjs come riserva) e Google Fonts | Niente — solo download: i font matematici di KaTeX quando il documento contiene formule, e qualsiasi web font scelto nelle Impostazioni, così da poterli incorporare | Esporta senza connessione; l'esportazione ripiega sui font di sistema |
| Apertura di un `index.html` esportato | jsDelivr | Niente — scarica il foglio di stile di KaTeX per i documenti con formule | Usa `standalone.html`, che lo incorpora |
| Modifica di un workflow di GitHub Actions | `raw.githubusercontent.com` | L'`owner/repo@ref` di ogni passaggio `uses:`, per scaricarne l'`action.yml` (in cache per 24 h) | **Impostazioni → Avanzate → Recupera i metadati delle action** disattivato |
| Il browser integrato | Qualsiasi sito apra tu — o, con la tua approvazione, un assistente IA | È un browser web; vedi la [guida al browser](/it/guide/browser) per il comportamento dell'IA, le sessioni isolate e la politica sulle destinazioni | **Impostazioni → Avanzate → Browser integrato** disattivato |
| Documenti che fanno riferimento al web | Gli host indicati nel tuo documento | Immagini remote e incorporamenti YouTube / Vimeo / Bilibili vengono caricati dai rispettivi host quando vengono visualizzati nell'editor o nell'HTML esportato | Mantieni le immagini in locale |

Due elementi che sembrano servizi di rete funzionano solo in loopback e non lasciano mai la tua macchina:

- **Il server MCP** — gli assistenti IA si collegano tramite un bridge WebSocket associato a `127.0.0.1`, autenticato con un token che VMark conserva nella sua directory dei dati dell'app. L'assistente stesso (Claude Desktop, Claude Code, Codex CLI…) comunica con il proprio fornitore; VMark risponde solo alle sue chiamate agli strumenti. Vedi [Integrazione IA](/it/guide/mcp-setup).
- **La knowledge base e l'anteprima Slidev** — un server locale associato a `127.0.0.1` con un token per sessione; la [guida alla Knowledge Base](/it/guide/knowledge-base#privacy-e-sicurezza) ne descrive il contenimento.

Il terminale integrato esegue la tua shell — qualsiasi cosa a cui si colleghi è un tuo comando, non di VMark.

## Cosa VMark NON Invia

- I tuoi documenti o i loro contenuti (tranne a un provider IA che hai configurato, quando esegui un genie)
- Nomi di file o percorsi
- Pattern di utilizzo o analisi delle funzionalità
- Informazioni personali di qualsiasi tipo
- Segnalazioni di crash
- Dati di battitura o modifica
- Identificatori hardware reversibili o impronte digitali

## Il Controllo degli Aggiornamenti in Dettaglio

Il **controllo degli aggiornamenti automatici** di VMark contatta il nostro server per verificare se è disponibile una nuova versione. Ogni controllo invia esattamente questi campi — niente di più:

| Dato | Esempio | Scopo |
|------|---------|-------|
| Indirizzo IP | `203.0.113.42` | Inerente a qualsiasi richiesta HTTP — non possiamo non riceverlo |
| OS | `darwin`, `windows`, `linux` | Per fornire il pacchetto di aggiornamento corretto |
| Architettura | `aarch64`, `x86_64` | Per fornire il pacchetto di aggiornamento corretto |
| Versione app | `0.5.10` | Per determinare se è disponibile un aggiornamento |
| Hash macchina | `a3f8c2...` (hex a 64 caratteri) | Contatore dispositivi anonimo — SHA-256 di hostname + OS + arch; non reversibile |

L'URL completo appare così:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Se quel server non è raggiungibile, il programma di aggiornamento prova lo stesso manifest da GitHub Releases (`github.com/xiaolai/vmark/releases/latest/download/latest.json`). Gli aggiornamenti stessi vengono verificati con una firma minisign prima dell'installazione.

Puoi verificarlo tu stesso — gli endpoint sono in [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (cerca `"endpoints"`), e l'hash è in [`app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) (cerca `machine_id_hash`).

### Come Usiamo i Dati

Aggreghiamo i log dei controlli degli aggiornamenti per produrre le statistiche live mostrate sulla nostra [homepage](/it/):

| Metrica | Come viene calcolata |
|---------|---------------------|
| **Dispositivi unici** | Conteggio degli hash macchina distinti per giorno/settimana/mese |
| **IP unici** | Conteggio degli indirizzi IP distinti per giorno/settimana/mese |
| **Ping** | Numero totale di richieste di controllo aggiornamenti |
| **Piattaforme** | Conteggio dei ping per combinazione OS + architettura |
| **Versioni** | Conteggio dei ping per versione dell'app |

Questi numeri sono pubblicati apertamente su [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Niente è nascosto.

**Avvertenze importanti:**
- Gli IP unici sottostimano gli utenti reali — più persone dietro lo stesso router/VPN contano come uno
- I dispositivi unici forniscono conteggi più accurati, ma un cambio di hostname o una nuova installazione dell'OS genera un nuovo hash
- I ping sovrastimano gli utenti reali — una persona può effettuare controlli più volte al giorno

### Conservazione dei Dati

- I log vengono memorizzati sul nostro server nel formato log di accesso standard
- I file di log ruotano a 1 MB e vengono conservati solo i 3 file più recenti
- I log non vengono condivisi con nessuno
- Non esiste nessun sistema di account — VMark non sa chi sei
- L'hash della macchina non è collegato a nessun account, email o indirizzo IP — è solo un contatore di dispositivi pseudonimo
- Non utilizziamo cookie di tracciamento, fingerprinting o SDK di analisi

### Disabilitare i Controlli degli Aggiornamenti

Imposta **Impostazioni → Informazioni → Frequenza di controllo** su **Solo manuale** e VMark non contatterà mai di sua iniziativa il server degli aggiornamenti; **Controlla ora** funziona comunque quando ti serve. Per esserne certo a livello di rete, blocca `log.vmark.app` (firewall, `/etc/hosts` o DNS) — VMark continuerà a funzionare normalmente senza di esso; semplicemente non riceverai notifiche di aggiornamento.

## Dove Sono Conservate le Chiavi API

Le chiavi API dei provider IA REST risiedono nell'archivio delle credenziali del sistema operativo — Portachiavi di macOS, Gestione credenziali di Windows o Secret Service di Linux — sotto il nome di servizio `app.vmark.secrets`. Non vengono mai scritte nei file delle impostazioni di VMark né in `localStorage`, e le impostazioni dei provider salvate dall'app vengono memorizzate senza la chiave. Le chiavi vengono inviate solo all'endpoint del provider che hai configurato, quando esegui un genie o premi **Test**. Dettagli in [Provider IA](/it/guide/ai-providers#dove-risiedono-le-chiavi-api).

## Cosa Può Raggiungere un Assistente IA

Un assistente collegato tramite MCP agisce solo entro ciò che hai già aperto: le sue operazioni sui file sono limitate alla radice dello spazio di lavoro aperto e alle cartelle dei documenti aperti in VMark, e una richiesta al di fuori di quel confine viene rifiutata. Salvare un documento in un **nuovo** percorso richiede l'impostazione **Approva automaticamente i salvataggi in una nuova posizione e i risultati dei geni** (disattivata per impostazione predefinita) — altrimenti la chiamata viene rifiutata e VMark mostra un toast con il nome del file; anche con l'impostazione attiva, un assistente non può mai sovrascrivere in quel modo un altro file esistente. Aprire uno spazio di lavoro indicato dall'assistente richiede prima la tua conferma. Ogni scrittura dell'IA in un documento viene prima registrata nella cronologia delle modifiche, così puoi ripristinare ciò che c'era prima ([checkpoint delle modifiche](/it/guide/mcp-setup#checkpoint-delle-modifiche)). Il browser integrato ha un proprio modello di approvazione, descritto nella [guida al browser](/it/guide/browser).

## Cosa Può Leggere VMark sul Disco

L'accesso di VMark ai file è un ambito di permessi ristretto, non l'intero disco:

- **Ambito statico**: la tua cartella home (`$HOME/**`) più i volumi montati — `/Volumes/**` su macOS, `/mnt/**` e `/media/**` su Linux. Su Windows copre anche le unità da `C:\` a `F:\`, quindi solo `G:\` e le unità successive, e le condivisioni di rete, richiedono un'autorizzazione in fase di esecuzione. Su macOS e Linux, tutto ciò che si trova in una cartella nascosta (il cui nome inizia con `.`) è fuori dall'ambito statico.
- **Autorizzazioni in fase di esecuzione**: un file che apri esplicitamente — dal Finder o da Esplora file, dalla riga di comando `vmark` o da una finestra di dialogo dei file — riceve un'autorizzazione solo per quel file. Una **cartella** viene autorizzata solo quando VMark può stabilire che l'hai scelta tu: l'hai selezionata nella finestra di selezione cartelle di VMark oppure l'hai aperta dal Finder. VMark conserva un elenco di queste cartelle (`workspace-grants.json` nella sua cartella dei dati dell'app) e le autorizza di nuovo a ogni avvio, così la sessione ripristinata e **Apri recenti** continuano a funzionare. Uno spazio di lavoro recente che non è in quell'elenco, e che l'ambito statico non copre, apre la finestra di selezione cartelle su quella cartella — sceglila per confermare. Quando un assistente IA chiede di aprire una cartella del genere, VMark fa lo stesso dopo che hai approvato la richiesta.
- **Immagini e contenuti multimediali**: immagini, video e audio locali vengono mostrati tramite il protocollo delle risorse di VMark, che raggiunge gli stessi luoghi — l'ambito statico più le autorizzazioni in fase di esecuzione descritte sopra. Il visualizzatore multimediale aggiunge un'autorizzazione per l'unico file che mostra, e solo per un file con un'estensione multimediale; una richiesta per qualsiasi altro percorso viene rifiutata invece di ampliare l'ambito. Un'immagine fuori da quei luoghi, come una accanto a un documento aperto da solo dall'esterno dell'ambito statico, non viene mostrata finché non apri la sua cartella come spazio di lavoro.

Niente di tutto questo viene inviato altrove; l'ambito decide cosa può leggere l'app stessa.

## Trasparenza Open Source

VMark è completamente open source. Puoi verificare tutto ciò che è descritto qui:

- Configurazione dell'endpoint di aggiornamento: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Generazione dell'hash macchina: [`src-tauri/src/app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) — cerca `machine_id_hash`
- Ambito del file system e delle risorse: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), la voce `assetProtocol` in [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json), [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) e [`src-tauri/src/workspace/grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace/grants)
- Archiviazione nel portachiavi: [`src-tauri/src/secure_store.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/secure_store.rs)
- Aggregazione delle statistiche lato server: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — lo script esatto che gira sul nostro server per produrre le [statistiche pubbliche](https://log.vmark.app/api/stats)
- I punti del codice che effettuano chiamate di rete sono quelli elencati sopra — cerca `reqwest` (Rust) e `fetch(` (TypeScript) nel repository per verificarlo tu stesso

## Segnalare un problema di sicurezza

Se trovi una vulnerabilità in VMark, ad esempio nel bridge MCP, nel browser integrato, nel programma di aggiornamento o nella gestione dei file, segnalala in privato tramite [la segnalazione privata delle vulnerabilità di GitHub](https://github.com/xiaolai/vmark/security/advisories/new) invece di aprire una issue pubblica. La [politica di sicurezza](https://github.com/xiaolai/vmark/blob/main/SECURITY.md) indica che cosa rientra nell'ambito e che cosa aspettarsi.
