# Gestione del Workspace

Un workspace in VMark è una cartella aperta come radice del tuo progetto. Quando apri un workspace, la barra laterale mostra un albero dei file, Apertura Rapida può trovare ogni file mostrato dall'albero dei file, il terminale si avvia nella radice del progetto e le schede aperte vengono ricordate per la prossima volta.

Senza un workspace puoi ancora aprire singoli file, ma perdi l'esplora file, la ricerca nel progetto e il ripristino della sessione.

::: tip Più workspace in una sola finestra
La [barra degli spazi di lavoro](/it/guide/workspace-rail) sperimentale consente a una singola finestra di contenere più workspace e di passare dall'uno all'altro — ciascuno con le proprie schede, il proprio albero dei file e il proprio layout.
:::

## Apertura di un Workspace

| Metodo | Come |
|--------|------|
| Menu | **File > Apri Workspace** |
| Apertura Rapida | `Mod + O`, poi seleziona **Sfoglia...** in fondo |
| Trascina e rilascia | Trascina un file markdown da Finder nella finestra — VMark rileva la radice del progetto e apre il workspace automaticamente |
| Workspace Recenti | **File > Workspace Recenti** e scegli un progetto precedente |

Quando apri un workspace, VMark mostra la barra laterale con l'esplora file. Se il workspace è stato aperto in precedenza, le schede aperte in precedenza vengono ripristinate.

Su Windows e Linux, una cartella passata dalla riga di comando (`vmark C:\notes` o `vmark ~/notes`) si apre come workspace nella propria finestra, come accade su macOS trascinando una cartella sull'icona del Dock. Funziona anche quando VMark è già in esecuzione.

::: tip
Se la finestra corrente ha modifiche non salvate, VMark offre di aprire il workspace in una nuova finestra invece di sostituire il tuo lavoro.
:::

## Esplora File

L'esplora file appare nella barra laterale ogni volta che un workspace è aperto. Mostra un albero di file markdown con radice nella cartella del workspace.

### Navigazione

- **Clic singolo** su una cartella per espanderla o comprimerla
- **Clic singolo** su un file per aprirlo in una scheda
- **Invio** (o `F2`) su un elemento selezionato avvia la rinomina inline
- I file che VMark non modifica direttamente (visibili con **Mostra tutti i file**) si aprono con l'applicazione predefinita del sistema
- Le cartelle sono compresse quando un workspace viene aperto per la prima volta; il loro stato di apertura viene mantenuto mentre passi tra le viste File, Struttura e Cronologia

### Quick Look

Seleziona un file nell'albero e premi `Spazio` per visualizzarlo in anteprima in un overlay a tutta finestra senza aprire una scheda — immagini, video e audio vengono mostrati con i loro controlli nativi; qualsiasi altro file mostra un pannello "impossibile visualizzare l'anteprima" con un pulsante per aprirlo esternamente. `←`/`↑` e `→`/`↓` scorrono in ordine i file visibili dell'albero (senza ricominciare dall'inizio), e `Spazio`, `Escape` o un clic sullo sfondo chiudono l'anteprima. Digitare uno spazio nel campo di rinomina inline non la attiva mai.

### Pulsanti dell'intestazione

L'intestazione della vista File contiene i controlli che agiscono sull'intero albero:

- **Espandi tutte le cartelle** — apre ogni cartella dell'albero
- **Comprimi tutte le cartelle** — chiude ogni cartella fino alla radice
- **Mostra tutti i file** — un interruttore; quando è attivo (evidenziato), l'albero elenca
  tutti i file invece dei soli file che VMark può aprire
- **Nuovo file** / **Nuova cartella** — creano l'elemento all'interno della cartella selezionata, o nella
  radice del workspace quando non è selezionato nulla

### Operazioni sui File

Clic destro su un file, una cartella o lo spazio vuoto sotto l'albero per accedere al menu contestuale:

| Azione | Mostrata per | Descrizione |
|--------|--------------|-------------|
| Apri | File | Apri il file in una nuova scheda |
| Rinomina | File, cartelle | Modifica il nome del file o della cartella inline (anche `F2`) |
| Duplica | File | Crea una copia del file |
| Sposta in... | File | Sposta il file in una cartella diversa tramite una finestra di dialogo |
| Elimina | File, cartelle | Sposta il file o la cartella nel cestino di sistema |
| Copia percorso | File, cartelle | Copia il percorso assoluto negli appunti |
| Mostra nel Finder | File, cartelle | Mostra l'elemento nel tuo gestore file — con l'etichetta **Mostra in Esplora risorse** su Windows e **Mostra nel gestore file** su Linux |
| Nuovo File | Cartelle, spazio vuoto | Crea un nuovo file markdown in questa posizione |
| Nuova Cartella | Cartelle, spazio vuoto | Crea una nuova cartella in questa posizione |
| Apri terminale qui | Cartelle | Avvia una nuova sessione del terminale in questa cartella (disattivata una volta aperte 5 sessioni) — vedi [Terminale](/it/guide/terminal) |

Puoi anche **trascinare e rilasciare** i file tra le cartelle direttamente nell'albero.

### Toggle di Visibilità

Per impostazione predefinita l'esplora mostra solo i tipi di file che VMark può aprire e nasconde i dotfile.
**Le cartelle vengono elencate che contengano o meno qualcosa di visibile**, quindi un progetto di
tipi di file non supportati appare come un albero di cartelle vuote — è il filtro all'opera,
non un errore nella lettura della cartella. Due toggle cambiano questo comportamento:

| Toggle | Scorciatoia | Cosa fa |
|--------|-------------|---------|
| Mostra File Nascosti | `Mod + Shift + .` (macOS) / `Ctrl + H` (Win/Linux) | Mostra i dotfile e le cartelle nascoste |
| Mostra Tutti i File | `Mod + Shift + A` | Mostra i file non-markdown insieme ai tuoi documenti |

Entrambe le impostazioni vengono salvate per workspace e persistono tra le sessioni.

### Cartelle Escluse

Alcune cartelle non vengono mai esplorate, qualunque cosa dicano le impostazioni del workspace — lo
stesso limite minimo applicato dalla ricerca nel workspace: `.git`, `node_modules`, `.obsidian`,
`.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`,
`dist`, `.superpowers`. Compaiono comunque come cartelle, così sai che esistono; il loro
contenuto non viene letto. Aggiungi i tuoi nomi in **Cartelle escluse** nelle
impostazioni del workspace (un nuovo workspace parte con `.git` e `node_modules` in quell'elenco).

L'albero viene elencato in un solo passaggio e aggiornato quando i file cambiano. Una raffica di
modifiche lo aggiorna una sola volta, poco dopo la fine della raffica; una cartella che non
smette mai di cambiare (un download in corso, una build, una sincronizzazione) viene aggiornata a
intervalli via via più ampi invece che di continuo, così l'esplora file non satura mai un core della CPU
rileggendo un workspace molto attivo.

## Apertura Rapida

Premi `Mod + O` per aprire l'overlay di Apertura Rapida. Fornisce una ricerca fuzzy su tre sorgenti, elencate in questo ordine:

1. **Schede aperte** nella finestra corrente (contrassegnate con un indicatore a punto), a partire dalla più usata di recente
2. **File recenti** che hai aperto in precedenza
3. **Tutti i file attualmente mostrati dall'esplora file** nel workspace

Prima che tu digiti, l'elenco mostra solo le schede aperte e i file recenti. Quando digiti, appaiono i risultati di tutte e tre le sorgenti, raggruppati in quell'ordine e ordinati per qualità della corrispondenza all'interno di ciascun gruppo.

Digita alcuni caratteri per filtrare — la corrispondenza è fuzzy, quindi `rme` trova `README.md`. Usa i tasti freccia per navigare e **Invio** per aprire. Una riga **Sfoglia...** bloccata in fondo apre una finestra di dialogo file.

La terza sorgente segue esattamente l'esplora file, quindi i due non sono mai in disaccordo
su ciò che esiste. Attiva **Mostra file nascosti** e Apertura Rapida trova i documenti
in `.claude/`, `.github/workflows/` e in qualsiasi altra cartella che inizia con un punto; attiva
**Mostra tutti i file** e trova anche quelli non-markdown, aprendo ciascuno nello stesso
modo in cui lo aprirebbe un clic nella barra laterale — i formati di VMark in una scheda, tutto il resto
con l'applicazione predefinita del sistema. Le cartelle dell'elenco sempre escluso
(`.git`, `node_modules`, `.vscode` e le altre) restano fuori da entrambi.

| Azione | Scorciatoia |
|--------|-------------|
| Apri Apertura Rapida | `Mod + O` |
| Naviga i risultati | `Su / Giù` |
| Apri il file selezionato | `Invio` |
| Chiudi | `Escape` |

::: tip
Senza un workspace, Apertura Rapida funziona ancora — mostra i file recenti e le schede aperte ma non può cercare nell'albero dei file.
:::

## Ricerca nei contenuti del workspace

Quando un workspace è aperto, VMark può cercare nei **contenuti dei file** (non solo nei nomi). Per impostazione predefinita cerca nei tipi di file che VMark apre (Markdown, testo normale, YAML e JSON/TOML/Mermaid/SVG/HTML quando il loro supporto di formato è attivo). Disattiva l'interruttore **.md** (**Solo tipi di file supportati**) per cercare in tutti i file di testo (i file binari vengono sempre saltati).

| Azione | Scorciatoia |
|---|---|
| Apri il pannello di ricerca nei contenuti | `Mod + Shift + H` (anche **Modifica → Trova → Trova nei file...**) |
| Vai al risultato successivo | `Invio` (o tasti freccia per navigare) |
| Apri il risultato in una nuova scheda | Clicca sull'anteprima della corrispondenza |

Ogni risultato mostra il percorso del file, il numero di riga e un frammento con il testo corrispondente evidenziato. I risultati non sono ordinati: i file vengono elencati nell'ordine in cui la ricerca li raggiunge mentre percorre le cartelle del workspace. Una ricerca si ferma dopo 50 file corrispondenti, 1.000 corrispondenze o 5 secondi, e mostra ciò che ha trovato fino a quel momento.

**Esclusi per impostazione predefinita**: le cartelle in cui VMark non entra mai — `.git`, `node_modules`, `.obsidian`, `.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`, `dist`, `.superpowers` — oltre a tutti i nomi presenti in **Cartelle escluse** nelle Impostazioni del workspace (un nuovo workspace parte con `.git` e `node_modules` in quell'elenco).

**File nascosti**: i dotfile vengono sempre saltati dalla ricerca nei contenuti, qualunque cosa indichi il toggle **Mostra file nascosti** dell'esplora file.

Questa è distinta da [Apertura Rapida](#apertura-rapida) che cerca solo i *nomi dei file* — la ricerca nei contenuti apre il file corrispondente con il cursore posizionato sulla riga della corrispondenza.

## Workspace Recenti

VMark ricorda fino a 10 workspace aperti di recente. Accedili da **File > Workspace Recenti** nella barra dei menu.

- I workspace sono ordinati per ora dell'ultima apertura (il più recente per primo)
- L'elenco si sincronizza con il menu nativo ad ogni modifica
- Scegli **Cancella Workspace Recenti** per azzerare l'elenco

## Impostazioni del Workspace

Ogni workspace ha la propria configurazione che persiste tra le sessioni. Le impostazioni vengono memorizzate nella directory dei dati dell'applicazione VMark — non all'interno della cartella del progetto — in modo che il tuo workspace rimanga pulito.

Le seguenti impostazioni vengono salvate per workspace:

| Impostazione | Descrizione |
|-------------|-------------|
| Cartelle escluse | Cartelle nascoste dall'esplora file |
| Mostra file nascosti | Se i dotfile sono visibili |
| Mostra tutti i file | Se i file non-markdown sono visibili |
| Ultime schede aperte | Percorsi dei file per il ripristino della sessione alla prossima apertura |

::: tip
La configurazione del workspace è legata al percorso della cartella. Aprire la stessa cartella sulla stessa macchina ripristina sempre le tue impostazioni, anche da una finestra diversa.
:::

## Finestra del workspace vuota

Chiudere l'ultimo documento aperto non chiude più la finestra. Al contrario, la finestra resta aperta su una **schermata di Benvenuto** e — se hai un workspace aperto — la sua barra laterale e l'albero dei file restano visibili. Funziona allo stesso modo su macOS, Windows e Linux.

La schermata di Benvenuto offre azioni rapide per tornare al lavoro:

- I pulsanti **Nuovo file**, **Apri file** e **Apri spazio di lavoro…**
- Un elenco **File recenti** e un elenco **Spazi di lavoro recenti** — fai clic su una voce per
  riaprirla. Ciascun elenco compare solo quando contiene delle voci.

**Apri file** e gli elenchi dei recenti riutilizzano la finestra in cui ti trovi già. Una
finestra con la schermata di Benvenuto non ha schede da sostituire, quindi nulla si apre in una seconda
finestra — a meno che la finestra non abbia ancora un workspace aperto, nel qual caso un file
esterno a quel workspace ottiene una finestra tutta sua invece di sostituire l'albero dei file
che vedi ancora nella barra laterale.

La barra del titolo di una finestra con la schermata di Benvenuto riporta **VMark**: non c'è alcun documento
aperto, quindi non c'è alcun nome di file da mostrare.

Per chiudere la finestra stessa, usa il pulsante rosso del semaforo, `Cmd/Ctrl + Q` (esci), oppure premi di nuovo `Cmd/Ctrl + W` mentre è visualizzata la schermata di Benvenuto.

## Documenti Affiancati

Apri due documenti **diversi** contemporaneamente — dividi l'editor in due riquadri, ciascuno
con il proprio documento. Utile per la lettura/traduzione bilingue (originale da un
lato, traduzione dall'altro) o per tenere aperto un riferimento mentre scrivi.
È una cosa distinta dalla **Vista divisa Markdown** (`Shift + F6`), che mostra
sorgente + anteprima dello *stesso* file.

- Attiva/disattiva la divisione con **`Alt + Mod + \`** o dalla palette dei comandi
  (**Dividi editor — due documenti**). Il documento corrente resta in un riquadro
  e il documento che hai usato più di recente prima di esso (o, se non ce n'è, un altro documento aperto) si apre nell'altro — lo
  stesso documento non viene mai mostrato due volte, quindi la divisione richiede due documenti aperti.
  Fai clic su una scheda mentre un riquadro ha il focus per cambiare il documento di quel riquadro, oppure
  fai clic destro su una scheda e scegli **Apri di lato**.
- Trascina il divisore (oppure dagli il focus e usa i tasti freccia) per ridimensionare i riquadri.
- Il riquadro che stai modificando è il riquadro **attivo** — la barra degli strumenti, la barra di ricerca e
  i comandi di menu agiscono su di esso.
- Attiva **Sincronizza lo scorrimento tra i riquadri** (palette dei comandi) per far scorrere entrambi
  i lati insieme in modo proporzionale — comodo per allineare una traduzione.

## Ripristino della Sessione

Quando chiudi una finestra che ha un workspace aperto, VMark salva l'elenco delle schede aperte nella configurazione del workspace. La prossima volta che apri lo stesso workspace, quelle schede vengono ripristinate automaticamente.

- Vengono ripristinate solo le schede con un percorso file salvato (le schede senza titolo non vengono persistite)
- Se un file è stato spostato o eliminato dall'ultima sessione, viene saltato silenziosamente
- I dati della sessione vengono salvati alla chiusura della finestra e alla chiusura del workspace (**File > Chiudi Workspace**)

## Multi-Finestra

Ogni finestra VMark può avere il proprio workspace indipendente. Questo ti consente di lavorare su più progetti contemporaneamente.

- **File > Nuova Finestra** apre una finestra nuova
- L'apertura di un workspace in una nuova finestra non influisce sulle altre finestre
- Le dimensioni e la posizione della finestra vengono ricordate per finestra

Quando trascini un file markdown da Finder e la finestra corrente ha già lavoro non salvato, VMark apre il progetto del file in una nuova finestra automaticamente.

### Aprire un file esterno al workspace corrente

Una finestra con un workspace aperto mantiene quel workspace. Aprire un file che si trova
altrove — da Finder o da Esplora risorse, da **File > Apri** o da File
recenti — lo apre in una **nuova finestra** con radice nella sua cartella, così l'albero dei file
su cui stavi lavorando resta dov'è. Solo una finestra senza un proprio workspace
accoglie il file al proprio posto.

Su Windows e Linux, un doppio clic su un file il cui tipo è associato a
VMark ora lo passa al VMark già in esecuzione invece di avviarne una
seconda copia. Su macOS ha sempre funzionato così.

### Staccare Schede in Nuove Finestre

Puoi estrarre una scheda dalla sua finestra per crearne una nuova:

- **Trascina una scheda fuori dalla barra delle schede** — più di circa 40 px sopra o sotto di essa — per staccarla. Rilasciala sopra un'altra finestra di VMark per spostare la scheda in quella finestra; rilasciala altrove per aprirla in una nuova finestra nella posizione del puntatore
- **Trascina una scheda orizzontalmente** nella barra delle schede per riordinarla tra le altre schede
- Le schede bloccate non possono essere trascinate

Una notifica toast conferma lo spostamento e offre **Annulla**, che riporta indietro la scheda. Le schede del browser e l'ultima scheda della finestra principale non possono essere trascinate fuori; tornano invece al loro posto.

Il gesto è bloccato per direzione: il movimento orizzontale avvia un riordinamento, mentre il movimento verticale attiva uno stacco. Puoi passare dal riordinamento allo stacco durante il trascinamento spostando il puntatore fuori dalla barra delle schede.

### Pannello Stato finestre

Quando esegui Claude Code in più finestre, **Vista > Mostra/Nascondi stato finestre** (disponibile anche nella palette dei comandi, oppure premi `Ctrl + Shift + 5`) apre un pannello che elenca tutte le altre finestre aperte con il loro stato in tempo reale e ti consente di passare direttamente a ciascuna.

Ogni riga mostra il nome del documento della finestra e il suo stato attuale:

| Stato | Significato |
|-------|-------------|
| **Richiede attenzione** | Un terminale in quella finestra (non a fuoco) ha fatto suonare il campanello — Claude Code lo fa suonare quando termina un turno o quando è in attesa di te |
| **In esecuzione** | Un genio IA di VMark è attualmente in esecuzione in quella finestra |
| **Errore** | L'ultima esecuzione del genio IA non è riuscita |
| **Inattiva** | Nulla in esecuzione |

Le righe sono ordinate mettendo per prima l'attenzione, così la finestra che ha bisogno di te sta in cima. Fai clic su una riga per dare il focus a quella finestra e portarla in primo piano; dare il focus a una finestra ne cancella l'indicatore "richiede attenzione". Lo stato proviene da due segnali affidabili — lo stato di invocazione dei geni IA di VMark stesso e il campanello del terminale — non dall'analisi dell'output del terminale.

**Fissa il pannello** per usarlo come "centro di controllo" permanente: mentre è fissato, fare clic su una riga dà il focus alla finestra di destinazione ma lascia aperto il pannello, così puoi spostarti tra più finestre senza riaprirlo. Il pulsante di fissaggio nell'intestazione apre un piccolo menu con due ambiti:

- **Fissa questa finestra** — fissa il pannello solo nella finestra corrente. Il suo stato di apertura e di fissaggio viene ricordato per ogni finestra anche dopo il riavvio, così una finestra che hai configurato come dashboard resta tale.
- **Fissa tutte le finestre** — un fissaggio globale: ogni finestra apre automaticamente il pannello e si comporta come fissata, *comprese le finestre che aprirai in seguito*, così scegli il layout da centro di controllo una sola volta invece di configurare ogni finestra a mano. Disattivandolo, ogni finestra torna al proprio stato di fissaggio per singola finestra.

## Modifiche Esterne

VMark monitora il tuo workspace per le modifiche effettuate da altri programmi (Git, editor esterni, strumenti di build, ecc.) e mantiene i documenti aperti sincronizzati.

- **I file non modificati** vengono ricaricati automaticamente quando il loro contenuto cambia su disco. Una breve notifica toast conferma il ricaricamento.
- **I file con modifiche non salvate** attivano un dialogo con tre opzioni: **Salva con nome** (salva la tua versione in una nuova posizione), **Ricarica** (scarta le tue modifiche e carica da disco) o **Mantieni** (preserva le tue modifiche e segna il file come divergente).
- **I file eliminati** vengono segnati come mancanti nella loro scheda ma non vengono chiusi — puoi comunque salvare il contenuto in una nuova posizione.
- Quando più file modificati cambiano contemporaneamente (ad esempio dopo un `git checkout`), VMark li raggruppa in un unico dialogo in modo che tu possa ricaricare tutto, mantenere tutto o esaminare ogni file individualmente.
- Se il contenuto su disco di un file divergente corrisponde successivamente a ciò che hai nell'editor (ad esempio un `git checkout` ripristina lo stesso testo), VMark cancella automaticamente lo stato divergente in modo che il salvataggio automatico riprenda normalmente.

VMark filtra i propri salvataggi in modo che non ti venga mai chiesto per modifiche che hai effettuato all'interno dell'app.

## Documenti Recenti del Dock macOS

I documenti che apri in VMark vengono registrati con macOS, quindi appaiono nel sottomenu **Apri recenti** quando fai clic destro sull'icona VMark nel Dock.

## Integrazione con il Terminale

Il terminale integrato usa automaticamente la radice del workspace come directory di lavoro. Quando apri o cambi workspace, le sessioni del terminale inattive eseguono `cd` alla nuova radice. Una sessione impegnata nell'esecuzione di un comando non viene toccata e cambia directory quando il comando termina (serve l'integrazione della shell per capire quando è occupata). Con la [barra degli spazi di lavoro](/it/guide/workspace-rail) attiva, una sessione che appartiene a un workspace mantiene la propria directory.

La variabile d'ambiente `VMARK_WORKSPACE` è impostata sul percorso del workspace in ogni sessione del terminale, in modo che i tuoi script possano fare riferimento alla radice del progetto.

[Scopri di più sul terminale →](/it/guide/terminal)

## Comando CLI Shell

VMark può installare un comando shell `vmark` in modo da poter aprire file e cartelle dal terminale.

### Installazione e rimozione

**Aiuto → Comando shell: installa 'vmark' nel PATH...** è un'unica voce che funziona da interruttore. Quando non è installato alcun comando `vmark`, scrive un piccolo script di avvio in `/usr/local/bin/vmark` e chiede la tua password di amministratore (lo stesso approccio utilizzato da VS Code per il suo comando `code`). Quando lo script di VMark è già presente, la stessa voce lo rimuove. In entrambi i casi una finestra di dialogo riporta l'esito. Solo macOS.

### Utilizzo

```bash
# Apri un file
vmark README.md

# Apri una cartella come workspace
vmark ~/projects/my-blog

# Apri più file
vmark chapter1.md chapter2.md
```

Il comando delega a `open -b app.vmark`, quindi macOS gestisce il comportamento di singola istanza — i file si aprono nella finestra VMark esistente anziché avviare un nuovo processo.

Se il file in `/usr/local/bin/vmark` non è stato scritto da VMark, la voce non tocca nulla e ti chiede di rimuoverlo manualmente.
