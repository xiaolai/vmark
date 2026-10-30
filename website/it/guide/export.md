# Esportazione e Stampa

VMark offre diversi modi per esportare e condividere i tuoi documenti.

## Cosa Produce un'Esportazione

**File → Esporta → HTML** scrive una cartella, con il nome del tuo documento, che contiene sempre **entrambi** questi file — non c'è alcuna modalità da scegliere:

```text
MyDocument/
├── index.html          ← rimanda ai file in assets/
├── standalone.html     ← tutto incorporato come URI dati (CSS, JS, immagini, font)
└── assets/
    ├── vmark-reader.css
    ├── vmark-reader.js
    ├── images/
    │   ├── image1.png
    │   └── ...
    └── fonts/          ← solo se il documento contiene formule o usi un web font
```

Usa il file più adatto al momento:

| File | Ideale per | Compromesso |
|------|------------|-------------|
| `index.html` | Pubblicare su un sito statico (URL puliti `/MyDocument/`), modificare con un altro strumento, contenere le dimensioni | Richiede la cartella `assets/` accanto |
| `standalone.html` | Inviare per email o messaggio un singolo file che non può perdere le immagini | Più grande — ogni risorsa è incorporata |

Entrambi i file sono resi dallo stesso renderer WYSIWYG e dallo stesso foglio di stile usati dall'editor, ed entrambi includono il [VMark Reader](#vmark-reader).

## Come Esportare

### Esporta HTML

1. Usa **File → Esporta → HTML**
2. Scegli dove salvare e inserisci un nome — diventa il nome della cartella (un `.html` finale viene rimosso)
3. Apri `index.html` o `standalone.html` dalla nuova cartella

#### Riesportare in una cartella già usata

Un'esportazione HTML è tutto-o-niente. Ogni file viene prima scritto in una
cartella temporanea `.vmark-export-…` all'interno della destinazione scelta, e
spostato al suo posto solo quando tutti i file esistono — così un'esportazione che
fallisce a metà lascia l'esportazione precedente esattamente com'era, invece di
sovrascriverla solo in parte.

Due cose che potresti vedere:

- **"Un'altra esportazione sta già scrivendo in questa cartella."** Solo
  un'esportazione alla volta può scrivere in una cartella, anche tra finestre
  diverse. Attendi che l'altra finisca oppure — se non c'è nient'altro in corso —
  elimina il file `.vmark-export.lock` indicato nel messaggio e riprova.
- **Una cartella `.vmark-export-…` rimasta.** VMark la rimuove quando ha finito.
  Resta solo se anche il ripristino dei tuoi file precedenti è fallito: in quel
  caso contiene quei file e il messaggio di errore indica esattamente dove si
  trovano. Nulla viene eliminato finché quella è l'unica copia.

### Stampa / Esporta PDF

Disponibile su macOS, Windows e Linux.

**Esporta PDF** (**File → Esporta → PDF**) scrive direttamente un PDF, usando la
dimensione della pagina, l'orientamento, i margini e la tipografia che scegli nella
finestra di esportazione.

**Stampa** (`Cmd/Ctrl + P`, oppure **File → Stampa**) apre invece la finestra di
stampa del sistema, così puoi inviare il documento a una stampante oppure usare il
"salva come PDF" del sistema operativo. Su macOS e Linux, VMark conferma un lavoro
di stampa completato con un breve avviso e non mostra nulla se annulli la finestra;
l'interfaccia di stampa di Windows non restituisce alcun esito, quindi lì non viene
mostrato alcun avviso.

La finestra di esportazione mostra le stesse fasi di avanzamento — caricamento,
generazione, completamento, fatto — su tutte e tre le piattaforme.

::: info Dimensione della pagina su macOS
La Dimensione e l'Orientamento scelti nella finestra determinano la pagina
esportata su ogni piattaforma. Su macOS hanno la precedenza sul formato carta
impostato nel sistema — se il tuo Mac usa Letter come predefinito e scegli A4, il
PDF è in A4.
:::

**Struttura nella barra laterale.** I PDF esportati contengono una struttura dei
titoli — il sommario cliccabile che il visualizzatore PDF mostra nella barra
laterale — su tutte e tre le piattaforme.

#### Numeri di pagina

La sezione **Numeri di pagina** della finestra aggiunge un numero a ogni pagina. È
attiva per impostazione predefinita, centrata in basso.

| Impostazione | Opzioni |
|--------------|---------|
| Posizione | In basso al centro, in basso a destra, oppure nessuno |
| Formato | `7`, `7 / 12` oppure `Pagina 7 di 12` |
| Salta la prima pagina | Lascia la pagina 1 senza numero, il trattamento abituale per un frontespizio |

Il numero si trova all'interno del margine inferiore scelto e si ridimensiona in
base alla dimensione del font del corpo. La numerazione riflette sempre la pagina
reale, quindi saltare la prima pagina produce 2, 3, 4… nelle pagine successive
invece di rinumerarle.

::: info I numeri di pagina usano l'alfabeto latino
Il numero è disegnato con un font PDF standard che nessun visualizzatore deve
scaricare, ed è questo che mantiene le esportazioni veloci e autonome — ma quel
font non può rendere cinese, giapponese, coreano o cirillico. I due formati numerici
funzionano in ogni lingua. Se la lingua dell'interfaccia scrive `Page 7 of 12` in
una scrittura che quel font non può disegnare, VMark stampa invece la forma
numerica `7 / 12`, anziché spazi vuoti o caratteri errati.
:::

### Esporta tramite Pandoc

VMark si integra con [Pandoc](https://pandoc.org/) — un convertitore di documenti universale — per esportare il tuo markdown in formati aggiuntivi. Scegli un formato direttamente dal menu:

**File → Esporta → Tramite Pandoc →**

| Voce di Menu | Estensione |
|-------------|------------|
| Word (.docx) | `.docx` |
| EPUB (.epub) | `.epub` |
| LaTeX (.tex) | `.tex` |
| OpenDocument (.odt) | `.odt` |
| Testo formattato (.rtf) | `.rtf` |
| Testo normale (.txt) | `.txt` |

**Configurazione:**

1. Installa Pandoc da [pandoc.org/installing](https://pandoc.org/installing.html) o tramite il tuo gestore di pacchetti:
   - macOS: `brew install pandoc`
   - Windows: `winget install pandoc`
   - Linux: `apt install pandoc`
2. Riavvia VMark (o vai in **Impostazioni → File e immagini → Strumenti documento** e fai clic su **Rileva**)
3. Usa **File → Esporta → Tramite Pandoc → [formato]** per esportare

Se Pandoc non è installato, il sottomenu **Tramite Pandoc** mostra una sola voce — **"Installa Pandoc per esportare in Word, EPUB, LaTeX…"** — che, se cliccata, apre la guida all'installazione di Pandoc.

Puoi verificare che Pandoc sia rilevato in **Impostazioni → File e immagini → Strumenti documento**.

### Copia come HTML

Premi `Cmd/Ctrl + Shift + C` per copiare il documento renderizzato come **sorgente** HTML. Il markup finisce negli appunti come testo semplice e senza stili, quindi incollalo dove ci si aspetta codice HTML — la vista HTML di un CMS, un template, un editor di codice; un editor di testo formattato come Word o Mail mostra i tag alla lettera. Le immagini locali vengono incorporate come URI dati, così restano visibili anche fuori da VMark.

## VMark Reader

Ogni esportazione HTML include il **VMark Reader** — un'esperienza di lettura interattiva con impostazioni, navigazione e lightbox propri.

### Pannello Impostazioni

Fai clic sull'icona ingranaggio (in basso a destra) per aprire il pannello impostazioni; `Esc` lo richiude. Le tue scelte vengono ricordate dal browser (`localStorage`), quindi si applicano la volta successiva che apri il file.

| Impostazione | Opzioni |
|-------------|---------|
| Dimensione Font | 12px – 28px |
| Interlinea | 1.2 – 2.4 |
| Larghezza Contenuto | 30em – 80em |
| Font Latino | System, Athelas, Palatino, Georgia, Charter, Literata |
| Font CJK | System, PingFang, Songti, Kaiti, Noto Serif, Source Han |
| Tema | White, Paper (predefinito), Mint, Sepia, Night |
| Spaziatura Lettere CJK | 0.02em – 0.12em |
| Spaziatura CJK-Latino | Attiva/disattiva la spaziatura automatica tra caratteri CJK e latini |
| Sommario | Attiva/disattiva la barra laterale del sommario (come premere `T`) |
| Espandi Tutte le Sezioni | Apre ogni blocco comprimibile `<details>` |
| Ripristina Predefiniti | Riporta ogni impostazione al valore iniziale |

### Sommario

La barra laterale del sommario aiuta a navigare in documenti lunghi:

- **Attiva/disattiva**: Fai clic sulla linguetta al bordo della pagina o premi `T`
- **Naviga**: Fai clic su qualsiasi intestazione per saltarvi
- **Evidenziazione**: La sezione corrente viene evidenziata mentre scorri

### Avanzamento Lettura

Una barra di avanzamento sottile in cima alla pagina mostra quanto hai letto del documento.

### Torna all'Inizio

Un pulsante fluttuante appare quando scorri verso il basso. Fai clic su di esso per tornare all'inizio.

### Lightbox Immagini

Fai clic su qualsiasi immagine per visualizzarla in un lightbox a schermo intero:

- **Chiudi**: Fai clic fuori, premi `Esc`, o fai clic sul pulsante X
- **Zoom**: Le immagini vengono visualizzate nelle loro dimensioni naturali

### Blocchi di Codice

Ogni blocco di codice include controlli interattivi:

| Pulsante | Funzione |
|---------|----------|
| Attiva/disattiva numeri di riga | Mostra/nascondi i numeri di riga per questo blocco |
| Pulsante copia | Copia il codice negli appunti |

Il pulsante copia mostra un segno di spunta quando l'operazione ha successo.

### Navigazione Note a Piè di Pagina

Le note a piè di pagina sono completamente interattive:

- Fai clic su un riferimento di nota `[1]` per saltare alla sua definizione
- Fai clic sul `↩` di ritorno per tornare al punto in cui stavi leggendo

### Scorciatoie da Tastiera

| Tasto | Azione |
|-------|--------|
| `Esc` | Chiude il pannello impostazioni o il lightbox |
| `T` | Attiva/disattiva Sommario |
| `+` / `=` | Aumenta la dimensione del font |
| `-` | Riduce la dimensione del font |

## Scorciatoie di Esportazione

| Azione | Scorciatoia |
|--------|-------------|
| Esporta HTML | _(solo menu)_ |
| Esporta PDF | _(solo menu)_ |
| Stampa | `Mod + P` |
| Copia come HTML | `Mod + Shift + C` |

## Suggerimenti

### Servire l'HTML Esportato

La struttura di esportazione a cartella funziona bene con qualsiasi server di file statici:

```bash
# Python
cd MyDocument && python -m http.server 8000

# Node.js (npx)
npx serve MyDocument

# Apri direttamente
open MyDocument/index.html
```

### Visualizzazione Offline

Entrambi i file si aprono offline, con una differenza per i documenti che contengono formule matematiche:

- **`standalone.html`** è completamente autonomo — il foglio di stile e i font di KaTeX vengono incorporati al momento dell'esportazione, quindi le formule vengono rese senza connessione.
- **`index.html`** carica il foglio di stile di KaTeX da una CDN (jsDelivr), quindi le sue formule richiedono una connessione internet quando la pagina viene aperta; il reader, le immagini e i font in `assets/` sono locali.

I font vengono scaricati durante l'esportazione: i font di KaTeX quando il documento contiene formule, e i tuoi font latino e monospazio quando sono web font che VMark conosce (Literata, JetBrains Mono, Fira Code, IBM Plex Mono). L'impostazione del font CJK non viene mai incorporata, e nemmeno un font di sistema o una famiglia di font personalizzata — per questi la pagina esportata usa lo stack di font di sistema del lettore. Esporta su una macchina con accesso a internet se vuoi incorporare i font — un'esportazione offline ripiega sui font di sistema.

### Quali Immagini Vengono Incorporate

Un file esportato contiene i byte reali delle immagini, e le esportazioni vengono
condivise — per questo VMark limita la provenienza di quei byte:

| Il tuo documento è… | Le immagini possono provenire da |
|---|---|
| dentro uno spazio di lavoro aperto | qualsiasi punto di quello spazio di lavoro |
| aperto da solo | la cartella del documento e le sue sottocartelle |
| non salvato (mai salvato su disco) | da nessuna parte — nessuna immagine locale viene incorporata, nemmeno con un workspace aperto; le immagini remote non sono interessate |

Per un documento non salvato, salvalo prima, poi esporta di nuovo. Vale per HTML, stampa, PDF e Copia come HTML.

I percorsi relativi si risolvono a partire dalla cartella del documento,
esattamente come nell'editor — quindi `../images/photo.png` funziona ogni volta che
la destinazione resta entro il confine indicato sopra. Tutto ciò che sta al di
fuori (`~/.ssh/id_rsa`, `/etc/passwd`, un percorso assoluto altrove sul disco)
viene rifiutato ed esportato come segnaposto "Image not found", conteggiato
nell'avviso dell'esportazione.

Se un'immagine `../` viene esportata come segnaposto, apri la sua cartella come
spazio di lavoro ed esporta di nuovo.

### Best Practice

1. **Pubblica `index.html`** per i documenti che renderai pubblici — tieni la cartella `assets/` accanto
2. **Invia `standalone.html`** per una condivisione rapida via email o chat
3. **Includi testo alt descrittivo per le immagini** per l'accessibilità
4. **Testa l'HTML esportato** in diversi browser
