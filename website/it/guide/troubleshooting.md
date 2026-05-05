# Risoluzione dei problemi

## Ricerca rapida

Problemi comuni e dove cercare la soluzione:

| Sintomo | Causa probabile | Dove cercare |
|---|---|---|
| Il client MCP non riesce a connettersi | File porta obsoleto o VMark non in esecuzione | [Problemi di connessione del server MCP](#problemi-di-connessione-del-server-mcp) |
| Il file non si apre o mostra testo illeggibile | Codifica non UTF-8 o attributo di quarantena | [Il file non si apre](#il-file-non-si-apre) |
| Il Genie IA si blocca o non restituisce nulla | Provider mal configurato o CLI non nel PATH | [Il Genio IA non risponde](#il-genio-ia-non-risponde) |
| La scorciatoia da tastiera non fa nulla | Riassegnata nelle Impostazioni o sovrascritta dal sistema | [La scorciatoia da tastiera non funziona](#la-scorciatoia-da-tastiera-non-funziona) |
| Editor lento su file di grandi dimensioni | Memoria per scheda + ritardo di input oltre 10K righe | [Prestazioni dell'editor](#prestazioni-dell-editor) |
| Il menu è ancora in inglese dopo il cambio di lingua | Il menu si ricostruisce all'avvio | [La barra dei menu mostra l'inglese](#la-barra-dei-menu-mostra-l-inglese-dopo-il-cambio-di-lingua) |
| Esportazione PDF incompleta | Percorsi delle immagini o permessi di scrittura | [Problemi di esportazione/stampa](#problemi-di-esportazione-stampa) |
| Avvio lento su Windows | Scansione antivirus + WebView2 | [L'applicazione si avvia lentamente su Windows](#l-applicazione-si-avvia-lentamente-su-windows) |

Per qualsiasi cosa non elencata sopra, consulta [Segnalare bug](#segnalare-bug).

## File di log

VMark scrive file di log per aiutare a diagnosticare i problemi. I log includono avvisi ed errori sia dal backend Rust che dal frontend.

### Posizione dei file di log

| Piattaforma | Percorso |
|-------------|----------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%APPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Livelli di log

| Livello | Cosa viene registrato | Produzione | Sviluppo |
|---------|----------------------|------------|----------|
| Error | Guasti, arresti anomali | Sì | Sì |
| Warn | Problemi recuperabili, soluzioni alternative | Sì | Sì |
| Info | Traguardi, cambiamenti di stato | Sì | Sì |
| Debug | Tracciamento dettagliato | No | Sì |

### Rotazione dei log

- Dimensione massima del file: 5 MB
- Rotazione: mantiene un file di log precedente
- I log più vecchi vengono sostituiti automaticamente

## Segnalare bug

Quando segnali un bug, includi:

1. **Versione di VMark** — mostrata nel badge della barra di navigazione o nella finestra Informazioni
2. **Sistema operativo** — versione di macOS, build di Windows o distribuzione Linux
3. **Passaggi per riprodurre** — cosa hai fatto prima che si verificasse il problema
4. **File di log** — allega o incolla le voci di log pertinenti

Le voci di log sono contrassegnate con data e ora e taggate per modulo (ad esempio `[HotExit]`, `[MCP Bridge]`, `[Export]`), facilitando l'individuazione delle sezioni pertinenti.

### Trovare i log pertinenti

1. Apri la directory dei log indicata nella tabella sopra
2. Apri il file `.log` più recente
3. Cerca le voci `ERROR` o `WARN` vicine al momento in cui si è verificato il problema
4. Copia le righe pertinenti e includile nella tua segnalazione di bug

## Problemi comuni

### L'applicazione si avvia lentamente su Windows

VMark è ottimizzato per macOS. Su Windows, l'avvio potrebbe essere più lento a causa dell'inizializzazione di WebView2. Assicurati che:

- WebView2 Runtime sia aggiornato
- Il software antivirus non stia scansionando la directory dei dati dell'applicazione in tempo reale

### La barra dei menu mostra l'inglese dopo il cambio di lingua

Se la barra dei menu rimane in inglese dopo aver cambiato la lingua nelle Impostazioni, riavvia VMark. Il menu viene ricostruito al prossimo avvio con la lingua salvata.

### Il terminale non accetta la punteggiatura CJK

Corretto nella versione v0.6.5+. Aggiorna all'ultima versione.

### Problemi di connessione del server MCP

Il server MCP potrebbe non avviarsi o i client potrebbero non riuscire a connettersi.

- Assicurati che VMark sia in esecuzione — il server MCP si avvia solo quando l'app è aperta.
- Verifica che nessun altro processo stia usando la stessa porta. Il server MCP scrive un file di porta per il rilevamento dei client; file di porta obsoleti di una sessione precedente possono causare conflitti. Riavvia VMark per rigenerarlo.
- Controlla il file di log per le voci `[MCP Bridge]` per identificare gli errori di connessione.

### La scorciatoia da tastiera non funziona

Una scorciatoia potrebbe sembrare non rispondere se è in conflitto con un'altra assegnazione o è stata personalizzata.

- Apri Impostazioni (`Mod + ,`) e vai alla scheda **Scorciatoie** per verificare se la scorciatoia è stata riassegnata.
- Cerca assegnazioni duplicate — se due azioni condividono la stessa combinazione di tasti, solo una si attiverà.
- Su macOS, alcune scorciatoie possono essere in conflitto con le assegnazioni a livello di sistema (ad esempio Mission Control, Spotlight). Controlla **Impostazioni di Sistema > Tastiera > Abbreviazioni da tastiera**.

### Problemi di esportazione/stampa

L'esportazione PDF potrebbe bloccarsi o produrre un output incompleto.

- Se le immagini mancano nell'esportazione, verifica che i percorsi delle immagini siano relativi al documento e che i file esistano su disco. Gli URL assoluti e le immagini remote devono essere accessibili.
- Controlla i permessi dei file nella directory di output — VMark ha bisogno dell'accesso in scrittura per salvare il file esportato.
- Per documenti di grandi dimensioni, l'esportazione potrebbe richiedere più tempo. Controlla il file di log per le voci `[Export]` se sembra bloccato.

### Il file non si apre

VMark potrebbe rifiutarsi di aprire un file o mostrare contenuto illeggibile.

- Verifica che il file abbia i permessi di lettura per il tuo account utente.
- VMark si aspetta Markdown codificato in UTF-8. I file in altre codifiche (ad esempio GB2312, Shift-JIS) potrebbero non essere visualizzati correttamente — convertili prima in UTF-8.
- Se il file è bloccato da un altro processo (ad esempio un client di sincronizzazione o uno strumento di backup), chiudi quel processo e riprova.

### Prestazioni dell'editor

L'editor potrebbe rallentare con file molto grandi o molte schede aperte.

- Chiudi le schede non utilizzate per liberare memoria — ogni scheda aperta mantiene il proprio stato dell'editor.
- Documenti molto grandi (oltre 10.000 righe) possono causare ritardi nell'input. Considera di dividerli in file più piccoli.
- Disabilita la Modalità Focus e la Modalità Macchina da Scrivere se non necessarie, poiché aggiungono un overhead di rendering aggiuntivo.

### Il Genio IA non risponde

I Geni IA richiedono un fornitore di IA configurato per funzionare.

- Apri Impostazioni e verifica che un fornitore di IA (ad esempio Ollama, OpenAI, Anthropic) sia configurato con un nome di modello valido.
- Il CLI del fornitore deve essere disponibile nel tuo PATH. Su macOS, le app con interfaccia grafica hanno un PATH minimo — se il CLI è stato installato tramite Homebrew, assicurati che il tuo profilo shell esporti il percorso corretto.
- Controlla il nome del modello per errori di battitura. Un nome di modello errato fallirà silenziosamente o restituirà un errore.
