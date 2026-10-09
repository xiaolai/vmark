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
| `Cmd + R` / `Ctrl + R` non fa nulla | Il ricaricamento è bloccato per scelta progettuale | [Il ricaricamento è bloccato](#il-ricaricamento-e-bloccato) |
| Il doppio clic su un file lo ha aperto nel VMark già in esecuzione | Inoltro a istanza singola su Windows e Linux | [Una sola istanza di VMark alla volta su Windows e Linux](#una-sola-istanza-di-vmark-alla-volta-su-windows-e-linux) |
| Finestra vuota su Linux | Renderer DMABUF di WebKitGTK | [Finestra vuota su Linux](#finestra-vuota-su-linux) |
| Le virgolette dritte e `--` restano letterali su macOS | Le sostituzioni intelligenti di sistema sono disattivate per VMark | [Virgolette e trattini tipografici su macOS](#virgolette-e-trattini-tipografici-su-macos) |
| VMark non va mai "in stop" in Monitoraggio Attività | App Nap è disattivato affinché gli assistenti IA continuino a lavorare | [VMark resta attivo in background](#vmark-resta-attivo-in-background-app-nap) |
| Si apre una finestra di selezione cartelle per uno spazio di lavoro recente, oppure un errore menziona `forbidden path` | La cartella è fuori da ciò che VMark può leggere | [Accesso alle cartelle ed errori `forbidden path`](#accesso-alle-cartelle-ed-errori-forbidden-path) |

Per qualsiasi cosa non elencata sopra, consulta [Segnalare bug](#segnalare-bug).

## File di log

VMark scrive file di log per aiutare a diagnosticare i problemi. I log includono avvisi ed errori sia dal backend Rust che dal frontend.

### Posizione dei file di log

| Piattaforma | Percorso |
|-------------|----------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
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
- **macOS: il doppio clic su un file scaricato non fa nulla mentre VMark è in esecuzione.** I file salvati da alcune app portano l'attributo di quarantena dei download (`com.apple.quarantine`), e macOS può scartare silenziosamente la richiesta di aprire un file del genere in un'app già in esecuzione. Quando apri uno spazio di lavoro, VMark rimuove l'attributo dalla cartella dello spazio di lavoro e dai file direttamente al suo interno che è in grado di aprire (le sottocartelle non vengono toccate) — è l'impostazione **Rimuovi la quarantena dei download all'apertura dello spazio di lavoro** in **Impostazioni → Avanzate → macOS**, attiva per impostazione predefinita. Per qualsiasi altro file, usa **File → Apri file...**, oppure esegui `xattr -d com.apple.quarantine <file>` nel Terminale.

### Accesso alle cartelle ed errori `forbidden path`

Fuori dalla tua cartella home e dai volumi montati — e, su Windows, fuori dalle unità da `C:\` a `F:\` — VMark legge solo ciò a cui gli hai dato accesso; vedi [Cosa Può Leggere VMark sul Disco](/it/guide/privacy#cosa-puo-leggere-vmark-sul-disco).

- **Quando scegli uno spazio di lavoro recente si apre una finestra di selezione cartelle.** VMark non può confermare che tu abbia già scelto quella cartella, e nient'altro gli permette di leggerla. La finestra si apre su quella cartella: fai clic su **Apri** per confermarla e da quel momento VMark la ricorderà. Se annulli, non si apre nulla.
- **La richiesta di un assistente IA di aprire una cartella richiede un passaggio in più.** Dopo che hai approvato la richiesta, VMark mostra la stessa finestra; scegli lì la cartella, poi lascia che l'assistente riprovi.
- **Un errore menziona `forbidden path`, oppure un'immagine non viene mostrata.** Il file si trova fuori da tutti i luoghi che VMark può leggere — spesso un'immagine accanto a un documento aperto da solo. Apri la cartella del documento con **File → Apri spazio di lavoro...** per dare a VMark l'intera cartella.

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

### Il ricaricamento è bloccato

`Cmd + R`, `Ctrl + R` e `Ctrl + Shift + R` non fanno nulla, di proposito. Ricaricare la webview eliminerebbe ogni editor aperto, la sua cronologia di annullamento e qualsiasi stato non salvato, quindi VMark blocca le scorciatoie, il percorso di scaricamento della pagina e il menu contestuale della webview stessa. Due eccezioni: `Ctrl + R` arriva alla shell quando il terminale integrato è in focus (reverse-i-search), e `F5` non viene mai bloccato perché è la scorciatoia dell'Anteprima sorgente. Le build di sviluppo si limitano invece ad avvisare dei documenti non salvati.

### Una sola istanza di VMark alla volta su Windows e Linux

Fare doppio clic su un file, o avviare di nuovo VMark da un launcher, passa il file al VMark già in esecuzione e porta in primo piano una finestra invece di avviare una seconda copia. Un secondo processo condividerebbe i dati applicativi, la sessione e l'archivio delle finestre del primo, e i due si sovrascriverebbero a vicenda lo stato — la perdita di dati alla base di #1330. macOS si è sempre comportato così tramite il sistema operativo. Una build di sviluppo (`tauri dev`) usa un proprio identificatore e quindi conta come un'app diversa.

Su Windows, se il VMark già in esecuzione ha smesso di rispondere e non può più ricevere il passaggio, un nuovo avvio non apre una seconda copia accanto a esso. Mostra invece un messaggio: apri Gestione attività, termina tutti i processi `VMark`, quindi avvia di nuovo VMark (#1527).

Su Linux questo si basa sul bus di sessione D-Bus. In una sessione senza un `DBUS_SESSION_BUS_ADDRESS` utilizzabile, VMark si avvia comunque ma senza questa protezione — avviarlo di nuovo apre una seconda copia, con il rischio descritto sopra — e il log registra che la protezione è disattivata. Avvialo da una sessione desktop, oppure da una shell in cui quella variabile è impostata.

### Finestra vuota su Linux

Su alcune combinazioni AMD / Mesa / WebKitGTK (il caso segnalato era Arch con KDE Plasma 6, #1058) il renderer DMABUF di WebKitGTK fallisce e l'area dei contenuti resta vuota. VMark imposta `WEBKIT_DISABLE_DMABUF_RENDERER=1` prima dell'avvio della webview perché questo non accada. Se vuoi riattivare il renderer DMABUF, avvia con `WEBKIT_DISABLE_DMABUF_RENDERER=0` — VMark imposta la variabile solo se non l'hai già fatto tu.

### Una scorciatoia digita un carattere mentre è attivo un metodo di input cinese

Risolto. Con la punteggiatura cinese attiva, un metodo di input riscrive i tasti di punteggiatura — il tasto dell'apice inverso produce `·`, le parentesi quadre producono `【】` — e conferma quel carattere **prima** che l'app venga informata della pressione del tasto. Così `` Ctrl + ` `` attivava il terminale *e* lasciava un `·` indesiderato nel documento, segnando come modificato un file pulito.

Ora VMark blocca l'inserimento stesso invece della pressione del tasto, quindi una combinazione di comando non digita nulla. La normale digitazione in cinese, i tasti morti (`Option + e`) e i caratteri AltGr delle tastiere europee restano invariati — vengono rifiutati solo gli inserimenti che arrivano mentre `Ctrl` o `Cmd` è premuto, e nessuna combinazione di VMark significa "digita questo carattere".

Se vedi ancora un carattere indesiderato prodotto da una scorciatoia, vale la pena [segnalarlo](https://github.com/xiaolai/vmark/issues) indicando il nome del metodo di input e la combinazione esatta.

### Virgolette e trattini tipografici su macOS

Digitare `--` o `"` in VMark resta letterale anche se sul tuo Mac è attiva l'opzione *Usa virgolette e trattini smart*. Altrimenti il sistema riscriverebbe il testo sotto l'editor — `-->` in un blocco Mermaid diventava `—>` — quindi VMark disattiva le sostituzioni automatiche di trattini, virgolette e punti solo per il proprio processo. Le altre app non sono interessate, e nemmeno i metodi di input e le tue sostituzioni di testo. Per le virgolette tipografiche dentro VMark, usa le [regole per le virgolette tipografiche del formattatore CJK](/it/guide/cjk-formatting#stili-di-virgolette-tipografiche) oppure il comando per cambiare lo stile delle virgolette (`Shift + Mod + '`).

### VMark resta attivo in background (App Nap)

Su macOS, VMark rinuncia ad App Nap per tutto il tempo in cui è in esecuzione, quindi Monitoraggio Attività lo mostra come mai in stop anche quando le sue finestre sono nascoste. App Nap congelerebbe la webview — e con essa ogni richiesta degli assistenti IA (MCP) — finché non porti in primo piano una finestra; restare attivo è ciò che permette a un assistente di continuare a lavorare mentre sei in un'altra app. Il sistema può comunque andare in stop quando è inattivo; VMark chiede solo di non essere messo in pausa da App Nap.
