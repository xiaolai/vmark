# Gestione del Workspace

Un workspace in VMark è una cartella aperta come radice del tuo progetto. Quando apri un workspace, la barra laterale mostra un albero dei file, Apertura Rapida indicizza ogni file markdown, il terminale si avvia nella radice del progetto e le schede aperte vengono ricordate per la prossima volta.

Senza un workspace puoi ancora aprire singoli file, ma perdi l'esplora file, la ricerca nel progetto e il ripristino della sessione.

## Apertura di un Workspace

| Metodo | Come |
|--------|------|
| Menu | **File > Apri Workspace** |
| Apertura Rapida | `Mod + O`, poi seleziona **Sfoglia...** in fondo |
| Trascina e rilascia | Trascina un file markdown da Finder nella finestra — VMark rileva la radice del progetto e apre il workspace automaticamente |
| Workspace Recenti | **File > Workspace Recenti** e scegli un progetto precedente |

Quando apri un workspace, VMark mostra la barra laterale con l'esplora file. Se il workspace è stato aperto in precedenza, le schede aperte in precedenza vengono ripristinate.

::: tip
Se la finestra corrente ha modifiche non salvate, VMark offre di aprire il workspace in una nuova finestra invece di sostituire il tuo lavoro.
:::

## Esplora File

L'esplora file appare nella barra laterale ogni volta che un workspace è aperto. Mostra un albero di file markdown con radice nella cartella del workspace.

### Navigazione

- **Clic singolo** su una cartella per espanderla o comprimerla
- **Doppio clic** o **Invio** su un file per aprirlo in una scheda
- I file non-markdown si aprono con l'applicazione predefinita del sistema

### Operazioni sui File

Clic destro su qualsiasi file o cartella per accedere al menu contestuale:

| Azione | Descrizione |
|--------|-------------|
| Apri | Apri il file in una nuova scheda |
| Rinomina | Modifica il nome del file o della cartella inline (anche `F2`) |
| Duplica | Crea una copia del file |
| Sposta in... | Sposta il file in una cartella diversa tramite una finestra di dialogo |
| Elimina | Sposta il file o la cartella nel cestino di sistema |
| Copia Percorso | Copia il percorso assoluto del file negli appunti |
| Mostra in Finder | Mostra il file in Finder (macOS) |
| Nuovo File | Crea un nuovo file markdown in questa posizione |
| Nuova Cartella | Crea una nuova cartella in questa posizione |

Puoi anche **trascinare e rilasciare** i file tra le cartelle direttamente nell'albero.

### Toggle di Visibilità

Per impostazione predefinita l'esplora mostra solo i file markdown e nasconde i dotfile. Due toggle cambiano questo:

| Toggle | Scorciatoia | Cosa fa |
|--------|-------------|---------|
| Mostra File Nascosti | `Mod + Shift + .` (macOS) / `Ctrl + H` (Win/Linux) | Mostra i dotfile e le cartelle nascoste |
| Mostra Tutti i File | *(Impostazioni o menu contestuale)* | Mostra i file non-markdown insieme ai tuoi documenti |

Entrambe le impostazioni vengono salvate per workspace e persistono tra le sessioni.

### Cartelle Escluse

Alcune cartelle sono escluse dall'albero per impostazione predefinita:

- `.git`
- `node_modules`

Queste impostazioni predefinite vengono applicate quando un workspace viene aperto per la prima volta.

## Apertura Rapida

Premi `Mod + O` per aprire l'overlay di Apertura Rapida. Fornisce una ricerca fuzzy su tre sorgenti:

1. **File recenti** che hai aperto in precedenza
2. **Schede aperte** nella finestra corrente (contrassegnate con un indicatore a punto)
3. **Tutti i file markdown** nel workspace

Digita alcuni caratteri per filtrare — la corrispondenza è fuzzy, quindi `rdm` trova `README.md`. Usa i tasti freccia per navigare e **Invio** per aprire. Una riga **Sfoglia...** bloccata in fondo apre una finestra di dialogo file.

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

Quando un workspace è aperto, VMark può cercare nei **contenuti dei file** (non solo nei nomi) corrispondenze nei file markdown e di testo.

| Azione | Scorciatoia |
|---|---|
| Apri il pannello di ricerca nei contenuti | `Mod + Shift + F` |
| Vai al risultato successivo | `Invio` (o tasti freccia per navigare) |
| Apri il risultato in una nuova scheda | Clicca sull'anteprima della corrispondenza |

Ogni risultato mostra il percorso del file, il numero di riga e un frammento con il testo corrispondente evidenziato. Le corrispondenze sono ordinate per:

1. Rilevanza del nome file (file contenente il termine nel nome per primo)
2. Prossimità all'intestazione (corrispondenze all'interno delle intestazioni prima del corpo del testo)
3. Recenza (i file modificati di recente appaiono per primi)

**Esclusi per impostazione predefinita**: `node_modules/`, `.git/`, `dist/`, `target/`, `coverage/`, oltre a tutte le directory che hai aggiunto a **Cartelle escluse** nelle Impostazioni del workspace.

**File nascosti**: saltati a meno che **Mostra file nascosti** non sia abilitato nell'esplora file.

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

### Staccare Schede in Nuove Finestre

Puoi estrarre una scheda dalla sua finestra per crearne una nuova:

- **Trascina una scheda verso il basso** oltre la barra delle schede (circa 40 px) per staccarla in una nuova finestra nella posizione del cursore
- **Trascina una scheda orizzontalmente** nella barra delle schede per riordinarla tra le altre schede
- Le schede bloccate non possono essere trascinate

Il gesto è bloccato per direzione: il movimento orizzontale avvia un riordinamento, mentre il movimento verticale attiva uno stacco. Puoi passare dal riordinamento allo stacco durante il trascinamento spostando il puntatore fuori dalla barra delle schede.

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

Il terminale integrato usa automaticamente la radice del workspace come directory di lavoro. Quando apri o cambi workspace, tutte le sessioni del terminale eseguono `cd` alla nuova radice.

La variabile d'ambiente `VMARK_WORKSPACE` è impostata sul percorso del workspace in ogni sessione del terminale, in modo che i tuoi script possano fare riferimento alla radice del progetto.

[Scopri di più sul terminale →](/it/guide/terminal)

## Comando CLI Shell

VMark può installare un comando shell `vmark` in modo da poter aprire file e cartelle dal terminale.

### Installazione

Vai a **Aiuto > Installa comando 'vmark'**. VMark scrive un piccolo script di avvio in `/usr/local/bin/vmark` e chiede la tua password di amministratore (lo stesso approccio utilizzato da VS Code per il suo comando `code`).

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

### Disinstallazione

Vai a **Aiuto > Disinstalla comando 'vmark'** per rimuovere `/usr/local/bin/vmark`. Se il file in quel percorso non è stato installato da VMark, l'operazione viene bloccata e ti viene chiesto di rimuoverlo manualmente.
