# Esportazione e Stampa

VMark offre diversi modi per esportare e condividere i tuoi documenti.

## Modalità di Esportazione

### Modalità Cartella (Predefinita)

Crea una cartella autonoma con struttura pulita:

```text
MyDocument/
├── index.html
└── assets/
    ├── image1.png
    ├── image2.jpg
    └── ...
```

**Vantaggi:**
- URL puliti quando serviti (`/MyDocument/` invece di `/MyDocument.html`)
- Facile da condividere come cartella singola
- Percorsi delle risorse semplici (`assets/image.png`)
- Funziona bene con gli host di siti statici

### Modalità File Singolo

Crea un singolo file HTML autonomo:

```text
MyDocument.html
```

Tutte le immagini sono incorporate come URI dati, rendendolo completamente portabile ma con dimensioni di file maggiori.

## Come Esportare

### Esporta HTML

1. Usa **File → Esporta HTML**
2. Scegli la posizione di esportazione
3. Per la modalità cartella: inserisci il nome della cartella (es. `MyDocument`)
4. Per la modalità file singolo: inserisci il nome del file con estensione `.html`

### Stampa / Esporta PDF

1. Premi `Cmd/Ctrl + P` o usa **File → Stampa**
2. Usa la finestra di stampa del sistema per stampare o salvare come PDF

### Esporta in Altri Formati

VMark si integra con [Pandoc](https://pandoc.org/) — un convertitore di documenti universale — per esportare il tuo markdown in formati aggiuntivi. Scegli un formato direttamente dal menu:

**File → Esporta → Altri Formati →**

| Voce di Menu | Estensione |
|-------------|------------|
| Word (.docx) | `.docx` |
| EPUB (.epub) | `.epub` |
| LaTeX (.tex) | `.tex` |
| OpenDocument (.odt) | `.odt` |
| Rich Text (.rtf) | `.rtf` |
| Testo Normale (.txt) | `.txt` |

**Configurazione:**

1. Installa Pandoc da [pandoc.org/installing](https://pandoc.org/installing.html) o tramite il tuo gestore di pacchetti:
   - macOS: `brew install pandoc`
   - Windows: `winget install pandoc`
   - Linux: `apt install pandoc`
2. Riavvia VMark (o vai in **Impostazioni → File e Immagini → Strumenti Documento** e fai clic su **Rileva**)
3. Usa **File → Esporta → Altri Formati → [formato]** per esportare

Se Pandoc non è installato, il menu mostra un collegamento **"Richiede Pandoc — pandoc.org"** in fondo al sottomenu Altri Formati.

Puoi verificare che Pandoc sia rilevato in **Impostazioni → File e Immagini → Strumenti Documento**.

### Copia come HTML

Premi `Cmd/Ctrl + Shift + C` per copiare l'HTML renderizzato negli appunti per incollarlo in altre applicazioni.

## VMark Reader

Quando esporti in HTML (modalità con stile), il tuo documento include il **VMark Reader** — un'esperienza di lettura interattiva con funzioni potenti.

### Pannello Impostazioni

Fai clic sull'icona ingranaggio (in basso a destra) o premi `Esc` per aprire il pannello impostazioni:

| Impostazione | Descrizione |
|-------------|-------------|
| Dimensione Font | Regola la dimensione del testo (12px – 24px) |
| Interlinea | Regola la spaziatura delle righe (1.2 – 2.0) |
| Tema | Cambiare tema (White, Paper, Mint, Sepia, Night) |
| Spaziatura CJK-Latino | Attiva/disattiva la spaziatura tra caratteri CJK e latini |

### Sommario

La barra laterale del sommario aiuta a navigare in documenti lunghi:

- **Attiva/disattiva**: Fai clic sull'intestazione del pannello o premi `T`
- **Naviga**: Fai clic su qualsiasi intestazione per saltarvi
- **Tastiera**: Usa le frecce `↑`/`↓` per spostarti, `Invio` per saltare
- **Evidenziazione**: La sezione corrente viene evidenziata mentre scorri

### Avanzamento Lettura

Una barra di avanzamento sottile in cima alla pagina mostra quanto hai letto del documento.

### Torna all'Inizio

Un pulsante fluttuante appare quando scorri verso il basso. Fai clic su di esso o premi `Home` per tornare all'inizio.

### Lightbox Immagini

Fai clic su qualsiasi immagine per visualizzarla in un lightbox a schermo intero:

- **Chiudi**: Fai clic fuori, premi `Esc`, o fai clic sul pulsante X
- **Naviga**: Usa le frecce `←`/`→` per più immagini
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
| `Esc` | Attiva/disattiva pannello impostazioni |
| `T` | Attiva/disattiva Sommario |
| `↑` / `↓` | Naviga tra gli elementi del sommario |
| `Invio` | Salta all'elemento del sommario selezionato |
| `←` / `→` | Naviga tra le immagini nel lightbox |
| `Home` | Scorri in cima |

## Scorciatoie di Esportazione

| Azione | Scorciatoia |
|--------|-------------|
| Esporta HTML | _(solo menu)_ |
| Stampa | `Mod + P` |
| Copia come HTML | `Mod + Shift + C` |

## Suggerimenti

### Servire l'HTML Esportato

La struttura di esportazione cartella funziona bene con qualsiasi server di file statici:

```bash
# Python
cd MyDocument && python -m http.server 8000

# Node.js (npx)
npx serve MyDocument

# Apri direttamente
open MyDocument/index.html
```

### Visualizzazione Offline

Entrambe le modalità di esportazione funzionano completamente offline:

- **Modalità cartella**: Apri `index.html` in qualsiasi browser
- **Modalità file singolo**: Apri direttamente il file `.html`

Le equazioni matematiche (KaTeX) richiedono una connessione internet per il foglio di stile, ma tutto il resto funziona offline.

### Best Practice

1. **Usa la modalità cartella** per i documenti che condividerai o pubblicherai
2. **Usa la modalità file singolo** per condivisione rapida via email o chat
3. **Includi testo alt descrittivo per le immagini** per l'accessibilità
4. **Testa l'HTML esportato** in diversi browser
