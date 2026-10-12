# Terminale Integrato

VMark include un pannello terminale integrato per eseguire comandi senza lasciare l'editor.

Premi `` Ctrl + ` `` per mostrare o nascondere il pannello terminale. Aprirlo porta il cursore nella shell, e chiuderlo restituisce il cursore all'editor — così il pannello si raggiunge e si abbandona senza toccare il mouse.

Per spostarti tra l'editor e un terminale APERTO senza nasconderlo, premi `` Ctrl + Shift + ` `` (**Metti a fuoco terminale o editor**; `` Alt + Shift + ` `` su Windows e Linux). Funziona in entrambe le direzioni e non cambia mai la visibilità del pannello — se il terminale è nascosto, lo apre invece di non fare nulla.

## Sessioni

Il terminale supporta fino a 5 sessioni concorrenti, ognuna con il proprio processo shell. Una barra delle schede verticale sul lato destro mostra le schede delle sessioni numerate.

| Azione | Come |
|--------|------|
| Nuova sessione | Fai clic sul pulsante **+** |
| Cambia sessione | Fai clic su un numero di scheda |
| Chiudi sessione | Fai clic sull'icona cestino |
| Riavvia shell | Fai clic sull'icona riavvia |
| Rinomina sessione | Fai doppio clic su una scheda, digita un nome, premi `Invio` (`Escape` annulla) |
| Scambia lato del pannello | Fai clic sull'icona di scambio (↕ / ↔) per spostare il terminale sul lato opposto del suo asse attuale. In modalità **Automatica** resta attivo il cambio intelligente basato sulle proporzioni (orizzontale → di lato, verticale → in basso/in alto) — sceglie solo l'altra estremità. |
| Ingrandisci il pannello | Fai doppio clic sulla maniglia di ridimensionamento; fai di nuovo doppio clic per ripristinare |

Quando chiudi l'ultima sessione, il pannello si nasconde ma la sessione rimane attiva — riapri con `` Ctrl + ` `` e sei dove hai lasciato. Quando la shell termina in modo pulito (`exit` o `Ctrl + D`), la sua scheda si chiude automaticamente — e il pannello si nasconde se era l'ultima. Se la shell termina con un errore, la scheda rimane aperta mostrando il codice di uscita; premi qualsiasi tasto per riavviarla.

Chiudere una sessione — con l'icona cestino, chiudendo la sua finestra o uscendo da VMark — termina tutto ciò che è stato avviato al suo interno, non solo la shell. VMark invia un segnale di hangup (`SIGHUP`) all'intero gruppo di processi della shell, attende fino a un secondo che termini, poi forza la chiusura (`SIGKILL`) di ciò che rimane. Un job che hai deliberatamente staccato in un proprio gruppo di processi (ad esempio con `nohup` o `setsid`) non viene toccato. Su Windows non c'è la fase di hangup: la shell viene terminata immediatamente.

**Notifiche:** quando un terminale fa suonare il campanello (ad es. Claude Code che completa un turno) mentre quella finestra di VMark non è a fuoco, VMark invia una notifica di sistema con il nome del documento della finestra — così puoi eseguire Claude Code in più finestre e ricevere un avviso da quella che ha bisogno di te, senza tenerle d'occhio una per una. Attivala o disattivala con **Impostazioni → Terminale → Notifica quando non a fuoco** (attiva per impostazione predefinita; al primo utilizzo chiede il permesso per le notifiche). Lo stesso segnale del campanello a finestra non a fuoco contrassegna anche la finestra nel [pannello Stato finestre](/it/guide/workspace-management#pannello-stato-finestre), così puoi vedere quale finestra ha bisogno di te e passarci direttamente.

Ogni scheda riflette il titolo del programma in esecuzione (impostato dagli strumenti che emettono un titolo del terminale, come `vim` o `ssh`), a meno che tu non abbia rinominato manualmente la sessione — una rinomina manuale prevale sempre. Per rinominare, **fai doppio clic sulla scheda**: `Invio` conferma, `Escape` annulla, e fare clic altrove mantiene ciò che hai digitato. Un nome vuoto viene ignorato.

**Ingrandimento:** la dimensione del pannello si ferma all'80 % dello spazio disponibile, così l'editor resta raggiungibile, e un **doppio clic sulla maniglia di ridimensionamento** lo porta a quel limite. Un secondo doppio clic lo riporta alla dimensione salvata. È un'opzione di visualizzazione — non cambia mai la dimensione che hai configurato.

**Apri terminale qui:** fai clic destro su qualsiasi cartella in Esplora file e scegli **Apri terminale qui** per avviare una sessione in quella directory. La nuova sessione si apre lì indipendentemente da dove si trovano le altre sessioni. Con cinque sessioni aperte la voce è disattivata.

## Sessioni del terminale e barra degli spazi di lavoro

Con la [barra degli spazi di lavoro](/it/guide/workspace-rail) attiva, ogni workspace nella barra possiede il **proprio insieme** di sessioni del terminale. Cambiare workspace sostituisce le schede del terminale visibili — le shell del workspace nascosto restano esattamente dov'erano: attive, nella stessa directory di lavoro, senza che nulla venga digitato al loro interno. Tornando indietro ricompaiono le stesse shell, e la sessione che stavi guardando viene ricordata per ogni workspace.

- Le nuove sessioni appartengono al workspace attivo al momento della loro creazione e partono dalla radice di quel workspace.
- Il limite di 5 sessioni e la numerazione `Terminal 1…5` si applicano all'insieme **visibile** — le sessioni dei workspace nascosti non consumano lo spazio disponibile del workspace attivo.
- Aprire il pannello su un workspace senza sessioni ne crea automaticamente una lì; senza un workspace (o un file salvato a cui ancorare una directory) il pannello mostra invece un suggerimento.
- Chiudere un workspace dalla barra, o spostarlo in una finestra propria, chiude con esso le sue sessioni del terminale.
- Con la barra **disattivata**, tutto funziona come prima: un unico insieme di sessioni per l'intera finestra, le cui shell inattive seguono i cambi di workspace con un `cd`.

## Scorciatoie da Tastiera

Queste scorciatoie funzionano quando il pannello terminale è in focus:

| Azione | Scorciatoia |
|--------|-------------|
| Copia | `Mod + C` (con selezione) |
| Incolla | `Mod + V` |
| Cancella | `Mod + K` |
| Cerca | `Mod + F` |
| Inizio / fine riga | `Cmd + ←` / `Cmd + →` (macOS) |
| Elimina riga | `Cmd + ⌫` (macOS) |
| Zoom del font del terminale | `Mod + =` / `Mod + -` / `Mod + 0` |
| Seleziona tutto l'output del terminale | `Mod + A` |
| Passa alla sessione 1 … 5 | `Mod + 1` … `Mod + 5` |
| Attiva/disattiva Terminale | `` Ctrl + ` `` |
| Metti a fuoco terminale o editor | `` Ctrl + Shift + ` `` |
| Prompt del comando precedente | `Mod + ↑` |
| Prompt del comando successivo | `Mod + ↓` |

Quando il terminale è in focus, `Mod + =` / `-` / `0` ingrandiscono o riducono il font del **terminale** (impostato separatamente nelle impostazioni del Terminale), non quello dell'editor, e `Mod + F` apre la ricerca del **terminale** invece della barra di ricerca dell'editor.

La navigazione tra i prompt (`Mod + ↑` / `Mod + ↓`) richiede l'integrazione della shell — vedi [Integrazione della shell](#integrazione-della-shell) più sotto.

**Linux:** `Ctrl` + una lettera va alla shell, quindi i tasti readline come `Ctrl + A`, `Ctrl + E`, `Ctrl + K`, `Ctrl + F`, `Ctrl + U` e `Ctrl + W` funzionano come in qualsiasi terminale Linux. Le scorciatoie a lettera proprie del terminale passano a `Ctrl + Shift`: `Ctrl + Shift + F` cerca, `Ctrl + Shift + K` pulisce, `Ctrl + Shift + A` seleziona tutto, e `Ctrl + Shift + C` / `Ctrl + Shift + V` copiano e incollano. `Ctrl + C` copia ancora una selezione (altrimenti invia SIGINT) e `Ctrl + V` incolla ancora; anche `Ctrl + Insert` / `Shift + Insert` copiano e incollano.

::: tip
`Mod + C` senza una selezione di testo invia SIGINT al processo in esecuzione — uguale a premere Ctrl+C in un terminale normale.
:::

## Leggere la cronologia mentre scrivi

Scorri verso l’alto per leggere l’output precedente e continua a scrivere: la vista resta dove sei e in fondo al terminale compare un **prompt flottante** con una copia in tempo reale delle righe in cui stai scrivendo — il prompt della shell o la casella di input di una TUI come Claude Code. I tasti arrivano sempre alla shell, quindi completamento con Tab, cronologia e metodi di input funzionano come al solito. Fai clic sulla freccia all’estremità destra per tornare al prompt; scompare da solo quando il prompt torna visibile. Anche Invio o Ctrl+C riportano in fondo, così vedi cosa fa il comando — o il prompt inviato a una TUI — subito dopo; qualsiasi altro tasto, Maiusc+Invio compreso, lascia la vista dov’è. I programmi a schermo intero (vim, less) non hanno cronologia, quindi lì non compare mai.

## Ricerca

Premi `Mod + F` per aprire la barra di ricerca. Digita per cercare in modo incrementale nel buffer del terminale.

| Azione | Scorciatoia |
|--------|-------------|
| Corrispondenza successiva | `Invio` |
| Corrispondenza precedente | `Shift + Invio` |
| Chiudi ricerca | `Escape` |

La barra riporta ciò che ha trovato accanto al campo di input:

- **`3 / 17`** — sei sulla terza di diciassette corrispondenze.
- **`5000 corrispondenze`** — troppe corrispondenze perché il terminale possa
  tenere traccia di quale sia attiva, quindi riporta il totale senza una posizione.
- **Nessun risultato** — la query non ha trovato nulla; anche il testo del campo
  diventa rosso.

Tre interruttori si trovano tra il campo di input e le frecce:

| Interruttore | Effetto |
|--------------|---------|
| **Aa** | Distingue maiuscole/minuscole |
| **ab** | Solo parole intere |
| **.\*** | Tratta la query come espressione regolare |

Con la modalità regex attiva, un pattern scritto a metà (`[` mentre stai digitando
`[a-z]`) riporta semplicemente nessun risultato invece di generare un errore —
continua a digitare. Gli interruttori si reimpostano ogni volta che chiudi la
barra o cambi sessione.

## Menu Contestuale

Clic destro all'interno del terminale per accedere a:

- **Copia** — copia il testo selezionato (disabilitato quando niente è selezionato)
- **Copia senza ritorni a capo** — copia la selezione rimuovendo le interruzioni di riga dovute alla larghezza di visualizzazione. Alcuni programmi da riga di comando (codex e altre app TUI) mandano a capo il loro output alla larghezza del terminale inserendo veri caratteri di nuova riga; una copia normale conserva quelle interruzioni. "Copia senza ritorni a capo" ricongiunge le righe spezzate in paragrafi continui (le righe vuote restano come separatori di paragrafo). Tiene conto del CJK — il testo cinese/giapponese viene unito senza inserire spazi. Seleziona il blocco che sai essere un unico flusso logico, perché VMark non può distinguere un a capo dovuto alla larghezza da uno intenzionale.
- **Incolla** — incolla dagli appunti nella shell
- **Seleziona tutto** — seleziona l'intero buffer del terminale
- **Cancella** — cancella l'output visibile
- **Reimposta visualizzazione** — ridisegna il terminale e reimposta la sua cache di rendering. Usala se i caratteri iniziano a sovrapporsi, a mescolare maiuscole e minuscole o ad apparire corrotti dopo una lunga sessione — succede soprattutto eseguendo per ore CLI con molti stili (ad es. Claude Code). I terminali della stessa finestra condividono un'unica cache dei glifi, quindi questa azione ridisegna tutti i terminali della finestra e non solo la scheda attiva.
- **Copia l'output del comando** — copia tutto ciò che un comando ha stampato, senza la sua riga di prompt e senza l'output del comando successivo. Compare solo quando fai clic destro all'interno dell'output di un comando e l'[integrazione della shell](#integrazione-della-shell) è attiva, perché è questa che indica a VMark dove ogni comando è iniziato e finito.

Il menu è completamente navigabile da tastiera: si apre con il focus sulla prima azione disponibile, i tasti freccia si spostano tra le voci (saltando quelle disabilitate), Home/Fine passano alla prima/ultima, Invio o Spazio attivano, ed Escape o Tab lo chiudono.

## Eseguire un blocco di codice

Passa il puntatore su qualsiasi blocco `bash`, `sh`, `zsh` o `shell` — oppure su un
blocco di trascrizione con tag `console`, `shell-session`, `shellsession` o
`terminal` — nel tuo documento e accanto al pulsante di copia compare un pulsante
**▶ Esegui nel terminale**. Incolla il blocco nel terminale — mostrando il pannello
e avviando una sessione se necessario — e si ferma lì.

::: warning Incolla; non esegue
Il comando viene inserito nella riga di input della shell e **non viene mai
eseguito al posto tuo**: non viene aggiunto alcun a capo, quindi non succede nulla
finché non premi *tu* Invio. Leggi prima ciò che è arrivato lì — un documento può
provenire da qualsiasi fonte, e un blocco di codice è solo testo scritto da
qualcuno.
:::

Per un blocco di trascrizione (`console`, `shell-session`, `shellsession`,
`terminal`) — una sessione incollata — i prompt iniziali `$ `, `% ` e `# `
vengono rimossi, così ottieni il comando invece del prompt. In un blocco `bash`
restano invariati, perché lì fanno parte del codice sorgente.

## Collegamenti Cliccabili

Il terminale rileva tre tipi di collegamenti nell'output dei comandi:

- **URL web** — fai clic per aprire nel tuo browser predefinito
- **Collegamenti ipertestuali OSC 8** — collegamenti ipertestuali espliciti del terminale emessi da strumenti come `ls --hyperlink=auto`, `gh` e i compilatori moderni. Il testo visibile e l'URL sottostante possono essere diversi; facendo clic si apre l'URL.
- **Percorsi file** — un percorso che contiene una `/` e termina con un'estensione di file; fai clic per aprire il file nell'editor (supporta suffissi `:line:col`; un percorso relativo viene risolto rispetto alla directory corrente della shell quando l'[integrazione della shell](#integrazione-della-shell) la comunica, altrimenti rispetto alla radice del workspace)

## Ambiente Shell

VMark imposta queste variabili d'ambiente in ogni sessione del terminale:

| Variabile | Valore |
|-----------|--------|
| `TERM` | `xterm-256color` |
| `TERM_PROGRAM` | `WezTerm` |
| `TERM_PROGRAM_VERSION` | `20240203-110809-5046fc22` |
| `VMARK_WORKSPACE` | Percorso radice del workspace (quando una cartella è aperta) |
| `PATH` | PATH completo della shell di login (uguale al terminale di sistema) |
| `COLORTERM` | `truecolor` |
| `LC_CTYPE` | `UTF-8` — **solo macOS** |

`TERM_PROGRAM` riporta `WezTerm`, non `vmark`, ed è una scelta deliberata. Diversi
strumenti CLI — tra cui `/terminal-setup` di Claude Code — abilitano la codifica
dei tasti [CSI u](https://invisible-island.net/xterm/modified-keys.html) solo per i
terminali presenti in una lista di consentiti fissata nel codice, e ricadono su un
percorso degradato da "terminale sconosciuto" per tutti gli altri. VMark parla quel
protocollo, quindi si identifica come il terminale della lista il cui comportamento
corrisponde più da vicino al suo. Cambiare questo valore in `vmark` romperebbe
silenziosamente Shift+Invio e altre sequenze di tasti con modificatori in quegli
strumenti. Vedi
[ADR-006](https://github.com/xiaolai/vmark/blob/main/dev-docs/decisions/ADR-006-terminal-program-identity.md).

`LC_CTYPE=UTF-8` viene impostato **solo su macOS**. Un'app con interfaccia grafica
avviata dal Dock o da Spotlight lì non eredita quasi alcun ambiente, quindi senza
questa variabile la shell ricade sulla locale C e gli strumenti stampano `?` al
posto del testo CJK. Il nome semplice `UTF-8` è una locale su macOS ma *non* lo è su
Linux, quindi impostarlo lì sostituirebbe una locale ereditata perfettamente valida
con una non valida — ogni programma che chiama `setlocale()` protesterebbe. Su Linux
e Windows i `LANG` / `LC_*` della tua sessione desktop vengono ereditati senza
modifiche.

VMark deliberatamente **non** imposta `EDITOR`. Il tuo `$EDITOR` — qualunque cosa
esporti la configurazione della tua shell — è ciò che `git commit`, `crontab -e` e
simili avvieranno. (VMark un tempo forzava `EDITOR=vmark`, ma lo shim da riga di
comando `vmark` è facoltativo e ritorna immediatamente invece di attendere che tu
chiuda la scheda, quindi `git commit` falliva con "command not found" oppure con un
messaggio di commit vuoto. Per farlo funzionare serve un protocollo bloccante
`vmark --wait`, che non è ancora stato realizzato.)

Il terminale integrato eredita il `PATH` della shell di login, quindi gli strumenti CLI come `node`, `claude` e altri binari installati dall'utente sono accessibili — proprio come in una finestra terminale normale.

A meno che tu non scelga una shell nelle impostazioni del terminale, VMark avvia la tua shell di login. Una shell che scegli deve essere una di quelle proposte da VMark — su macOS e Linux, una shell elencata in `/etc/shells` (o la tua shell di login) che esiste ed è eseguibile; su Windows, PowerShell, `pwsh`, `cmd.exe` o `%COMSPEC%` — indicata con un percorso assoluto. Una scelta salvata che non è più disponibile compare come *(non disponibile)* nelle impostazioni, e VMark avvia invece la tua shell predefinita. Su macOS e Linux legge prima la shell di login dalla voce del tuo account utente, poi `$SHELL`, e ricade su `/bin/sh`. Su Windows usa `%COMSPEC%`, ricadendo sul percorso completo di `cmd.exe`. La directory di lavoro inizia alla radice del workspace, o alla directory padre del file attivo, o `$HOME`.

Le scorciatoie shell standard come `Ctrl+R` (ricerca cronologia inversa in zsh/bash) funzionano quando il terminale è in focus — non vengono intercettate dall'editor.

Quando la radice del workspace cambia dopo che il terminale è già in esecuzione, le sessioni inattive eseguono automaticamente `cd` alla nuova radice. Una sessione impegnata in un comando (ad esempio `vim` o `less`) non viene interrotta: cambia directory quando il comando termina, cosa che richiede l'[integrazione della shell](#integrazione-della-shell) per essere rilevata. Con la [barra degli spazi di lavoro](/it/guide/workspace-rail) attiva, le sessioni che appartengono a un workspace mantengono la propria directory.

## Microfono, fotocamera e Apple Events su macOS

I programmi che esegui nel terminale integrato possono richiedere il microfono, la fotocamera o il permesso di controllare altre app (Apple Events, usati da `osascript`). macOS chiede a nome di VMark, perché considera VMark l'app responsabile di tutto ciò che il terminale avvia. Consenti l'accesso quando macOS lo chiede; potrai modificarlo in seguito in **Impostazioni di Sistema → Privacy e sicurezza**, alla voce **Microfono**, **Fotocamera** o **Automazione**. La richiesta avviene quando un programma usa la risorsa per la prima volta, non all'apertura del terminale.

Se un programma registra silenzio, cattura un fotogramma nero o segnala un errore di tipo "non autorizzato" senza che compaia alcuna richiesta, verifica nella pagina delle impostazioni corrispondente che VMark sia elencato e consentito. Quando segnali il problema, allega l'output del programma.

Per gli ingressi audio virtuali come BlackHole, il permesso da solo non instrada l'audio. Seleziona l'ingresso desiderato nello strumento di registrazione, instrada l'audio verso di esso e verifica una breve registrazione prima di una sessione lunga: un file audio che cresce non dimostra da solo che il suono sia stato catturato. VMark non include registratori né strumenti di trascrizione; questi comandi provengono da strumenti che installi separatamente.

## Non ancora implementato

Queste funzioni sono pianificate ma **non** sono disponibili oggi. Sono elencate qui
perché versioni precedenti di questa pagina ne descrivevano alcune come se lo
fossero:

- **Mettere in pausa / riprendere una sessione.** VMark può sospendere internamente
  un processo shell — lo fa automaticamente come controllo di flusso quando l'output
  arriva più velocemente di quanto il terminale riesca a renderizzarlo — ma non
  esiste alcun controllo per l'utente, né un menu contestuale delle schede di
  sessione a cui agganciarlo.
- **Un `vmark --wait` bloccante**, così che `$EDITOR` possa puntare a VMark (vedi
  [Ambiente Shell](#ambiente-shell) sopra).
- **Persistenza della cronologia di scorrimento tra i riavvii** (vedi
  [Persistenza](#persistenza)).
- **Integrazione con la shell fish** (vedi
  [Integrazione della shell](#integrazione-della-shell)).

## Impostazioni

Apri **Impostazioni → Terminale** per configurare:

| Impostazione | Intervallo | Predefinito | Piattaforme |
|-------------|-----------|-------------|-------------|
| Dimensione pannello | 10 % – 80 % dello spazio disponibile, a passi del 5 % | 40 % | Tutte |
| Dimensione carattere | 10 – 24 px | 13 px | Tutte |
| Interlinea | 1.0 – 2.0 | 1.2 | Tutte |
| Copia alla selezione | Attivo / Disattivato | Disattivato | Tutte |
| Visualizza automaticamente le trascrizioni | Attivo / Disattivato | Disattivato | Tutte |
| Option come tasto Meta | Attivo / Disattivato | Attivo | macOS |
| Integrazione della shell | Attivo / Disattivato | Attivo | macOS / Linux (zsh, bash) |
| Appunti remoti (OSC 52) | Attivo / Disattivato | Attivo | Tutte |
| Cronologia di scorrimento | 1.000 / 5.000 / 10.000 / 50.000 righe | 5.000 | Tutte |
| Modalità screen reader | Attivo / Disattivato | Disattivato | Tutte |

### Visualizza automaticamente le trascrizioni

Attiva **Visualizza automaticamente le trascrizioni** per mostrare il Markdown dell'assistente, tabelle selezionabili e diagrammi Mermaid in una sezione di trascrizione formattata all'interno dell'area del terminale. Si trova a destra della CLI quando il terminale è in alto o in basso, e sotto di essa quando il terminale è a sinistra o a destra; la CLI interattiva resta utilizzabile accanto.

La sezione parte compressa. Si apre da sola quando una nuova risposta contiene una tabella o un diagramma Mermaid — le risposte in testo semplice, che il terminale mostra già bene, la lasciano chiusa. Fai clic sul pulsante del grafico nella barra delle schede del terminale (tooltip **Trascrizione formattata**) per mostrarla o nasconderla in qualsiasi momento; il pulsante è evidenziato mentre la trascrizione è visibile e nasconderla restituisce l'intera area alla CLI; dopo averla compressa, resta chiusa fino alla successiva risposta con una tabella o un diagramma. Il contenuto già presente nella trascrizione quando la sessione viene mostrata per la prima volta non la apre. Un terminale nascosto smette di leggere le trascrizioni.

L'attivazione aggiunge un hook `SessionStart` locale al `settings.json` di Claude Code e al `hooks.json` di Codex, preservando gli hook esistenti. Dopo l'attivazione, avvia o riprendi Claude/Codex in un terminale di VMark; riavvia le sessioni già in esecuzione. Codex potrebbe chiederti di considerare attendibile il nuovo hook alla prima esecuzione. Sono richiesti Node e una versione della CLI con gli hook del ciclo di vita. Gli hook disattivati esplicitamente o limitati da criteri, le sessioni SSH remote e le directory di configurazione personalizzate della CLI diverse dall'ambiente di VMark non possono fornire un collegamento.

Ogni terminale segue esattamente la propria sessione anziché la trascrizione modificata più di recente. L'anteprima conserva fino a 100 messaggi dell'assistente dagli ultimi 2 MiB di dati della trascrizione. L'HTML grezzo e le immagini remote restano inerti; i diagrammi non validi restano leggibili come sorgente. La disattivazione rimuove la sezione formattata e disattiva gli hook installati da VMark.

### Accessibilità

| Impostazione | Opzioni | Predefinito |
|--------------|---------|-------------|
| Campanello del terminale | Disattivato / Visivo / Sonoro | Visivo |
| Contrasto minimo | Disattivato / WCAG AA (4,5:1) / WCAG AAA (7:1) / Massimo | WCAG AA (4,5:1) |

La maggior parte delle modifiche si applica subito a ogni sessione aperta — dimensione e posizione del pannello, dimensione del carattere, interlinea, cursore, Copia alla selezione, Option come tasto Meta, Cronologia di scorrimento, Modalità screen reader, Campanello del terminale e Contrasto minimo. **Shell**, il **Renderer WebGL** (non disponibile su Linux), gli **Appunti remoti** e l'**Integrazione della shell** vengono fissati all'avvio di una sessione, quindi si applicano alle sessioni aperte in seguito. **Dimensione pannello** arriva fino all'80 % dello spazio disponibile. L'editor mantiene una dimensione minima in pixel, quindi non scompare mai del tutto per quanto grande diventi il terminale. Fai doppio clic sulla maniglia di ridimensionamento per passare direttamente al massimo e tornare indietro senza cambiare la dimensione memorizzata. **Option come tasto Meta** instrada il tasto Option di macOS come Meta nel terminale integrato, in modo che emacs, tmux e strumenti simili vedano le scorciatoie con prefisso Alt (solo macOS); è attivo per impostazione predefinita, quindi Option+Freccia si sposta di parola in parola invece di inserire caratteri accentati. **Integrazione della shell** è disponibile su macOS e Linux (nascosta su Windows). **Appunti remoti** consente solo la scrittura (le letture sono sempre rifiutate) ed è descritto più sotto. **Cronologia di scorrimento** controlla quante righe di output ogni sessione conserva nella sua cronologia — valori più alti usano più memoria. **Modalità screen reader** rende l'output del terminale accessibile alle tecnologie assistive come VoiceOver; è disattivata per impostazione predefinita per motivi di prestazioni. **Campanello del terminale** sceglie come viene segnalato un campanello (BEL) — un segno visivo di attività in background sulla scheda della sessione, un leggero segnale acustico (che contrassegna anche la scheda di una sessione in background, così puoi trovarla) oppure nulla. **Contrasto minimo** porta il testo sbiadito del terminale a un rapporto di contrasto leggibile rispetto allo sfondo; aumentalo per l'accessibilità oppure impostalo su Disattivato per disabilitare la correzione.

::: tip Famiglia di font del terminale
Il terminale usa il **Font monospazio** di **Impostazioni → Editor**, non un font
proprio, quindi cambiarlo lì modifica insieme i blocchi di codice, la modalità
Sorgente e il terminale. Su Linux l'opzione Predefinita di sistema segue il font
monospazio del tuo desktop, lo stesso usato dal terminale di sistema.
:::

::: tip Dimensione del font e zoom
La dimensione del font del terminale è volutamente indipendente dalla dimensione di
lettura dell'editor: un terminale è una superficie di monitoraggio densa, e il suo
valore predefinito di 13 px corrisponde a quello dei terminali autonomi invece che
ai 18 px predefiniti per la lettura. `Mod + =` / `Mod + -` ingrandiscono o riducono
a passi di 2 px, quindi il font del terminale può arrivare a un valore che il menu a
discesa non elenca (13 → 15 → 17 …). Il menu a discesa mostra la dimensione
effettivamente in uso, aggiungendo il valore ingrandito all'elenco invece di
riportarti a un valore predefinito.
:::

## Appunti remoti (OSC 52)

Copia dentro una sessione `ssh`, dentro `tmux` o in un editor remoto, e il testo
finisce nei **tuoi** appunti — non in quelli della macchina remota. I programmi lo
richiedono stampando una sequenza di escape OSC 52; VMark la inoltra agli appunti di
sistema.

```bash
# Da qualsiasi punto in cui il terminale può stampare — anche via ssh:
printf '\e]52;c;%s\a' "$(printf 'hello' | base64)"
```

::: warning Solo scrittura — le letture sono sempre rifiutate
OSC 52 definisce anche un modo per *leggere* gli appunti, e VMark non risponde
**mai**, nemmeno con questa impostazione attiva. Qualsiasi processo in grado di
stampare byte nel tuo terminale potrebbe chiederlo — incluso `cat` su un file che
non hai scritto tu — e la risposta arriverebbe come se l'avessi digitata. iTerm2 e
VS Code rifiutano per lo stesso motivo. L'impostazione controlla le scritture; le
letture sono rifiutate incondizionatamente.
:::

Disattiva **Impostazioni → Terminale → Appunti remoti (OSC 52)** per chiudere del
tutto il canale. La modifica si applica alle sessioni avviate successivamente.

## Integrazione della shell

Quando l'**Integrazione della shell** è attiva, VMark inserisce nella shell dei
marcatori di comando leggeri, così il terminale capisce dove ogni comando inizia e
finisce. Ciò abilita:

- **Navigazione tra i prompt** — `Cmd + ↑` / `Cmd + ↓` salta al prompt del comando
  precedente / successivo nella cronologia di scorrimento.
- **Decorazioni dello stato di uscita** — una sottile barra nel margine contrassegna
  ogni riga di comando in verde (successo) o in rosso (errore).
- **Tracciamento dal vivo della directory di lavoro** — i percorsi di file relativi
  nell'output vengono risolti rispetto alla directory corrente della shell, e i
  nuovi terminali si aprono lì.

Sono supportati **zsh** e **bash**, su macOS e Linux. In entrambi i casi
l'iniezione non è distruttiva — la tua vera configurazione viene caricata per prima,
e gli hook di VMark vengono aggiunti invece di sostituirla, quindi prompt, tema e
alias restano intatti.

| Shell | Come si aggancia VMark | Cosa preserva |
|---|---|---|
| zsh | `ZDOTDIR` punta a un `.zshrc` generato che carica il tuo, poi registra gli hook con `add-zsh-hook` | Un `$ZDOTDIR` personalizzato viene rispettato: VMark risolve quello reale da una shell di login e carica `.zshenv` e `.zshrc` da lì, non solo da `$HOME` |
| bash | `bash --rcfile <generated>`, che carica prima `~/.bashrc` | Un `PROMPT_COMMAND` esistente e una trap `DEBUG` esistente vengono entrambi **composti**, non sostituiti — così `bash-preexec`, `direnv` e `atuin` continuano a funzionare |

Poiché il terminale esegue una shell interattiva non di login, i file letti solo al
login (`.zprofile`, `.bash_profile`, `.profile`) sono esclusi per entrambe le shell,
proprio come accade in una normale scheda di terminale.

fish non è ancora integrata; funziona normalmente ma senza queste funzionalità.
Disattiva l'impostazione per disabilitare del tutto l'iniezione. Le modifiche si
applicano alle sessioni avviate successivamente (riavvia il terminale per
applicarle).

## Persistenza

Lo stato aperto o chiuso del pannello terminale viene salvato e ripristinato tra i riavvii hot-exit. La sua dimensione è l'impostazione **Dimensione pannello** — una quota della finestra che il trascinamento della maniglia di ridimensionamento aggiorna — quindi viene conservata con le tue impostazioni e sopravvive a ogni riavvio, su qualunque lato si trovi il pannello. I processi shell stessi non possono essere preservati — una shell nuova viene avviata per ogni sessione al riavvio. Nemmeno la cronologia di scorrimento viene preservata: ripristinarla significherebbe scrivere su disco tutto ciò che è passato per il terminale (chiavi API incluse), quindi è deliberatamente rimandata a una soluzione che affronti prima questo problema.
