# Popup Inline

VMark fornisce popup contestuali per la modifica di collegamenti, immagini, media, matematica, note a piè di pagina e altro. Questi popup funzionano sia in modalità WYSIWYG che Sorgente con una navigazione da tastiera coerente.

## Scorciatoie da Tastiera Comuni

Tutti i popup condividono questi comportamenti da tastiera:

| Azione | Scorciatoia |
|--------|-------------|
| Chiudi/Annulla | `Escape` |
| Conferma/Salva | `Invio` |
| Naviga tra i campi | `Tab` / `Shift + Tab` |

## Popup dei Collegamenti

Facendo clic su un collegamento si apre il suo popup di modifica. Il cursore resta dove hai fatto clic, quindi puoi continuare a modificare il testo del collegamento — digitazione, `Backspace` e copia/incolla agiscono tutti sul documento. Il popup si chiude non appena modifichi il testo o sposti il cursore fuori dal collegamento.

### Modifica Collegamento Esistente

**Attivazione:** Fai clic su un collegamento, oppure posiziona il cursore nel collegamento + `Mod + K`

Un clic lascia la tastiera nel documento; fai clic sul campo URL per modificare la destinazione. `Mod + K` sposta il focus direttamente nel campo URL.

**Campi:**
- **URL** — Modifica la destinazione del collegamento
- **Apri** — Apri il collegamento nel browser
- **Copia** — Copia l'URL negli appunti
- **Elimina** — Rimuovi il collegamento, mantieni il testo

**Apri senza il popup:** `Cmd + Clic` (`Ctrl + Clic` su Windows/Linux) su un collegamento ne apre direttamente la destinazione.

### Crea Nuovo Collegamento

**Attivazione:** Seleziona testo + `Mod + K`

**Appunti intelligenti:** Se gli appunti contengono un URL, viene compilato automaticamente.

**Campi:**
- **Input URL** — Inserisci la destinazione
- **Conferma** — Premi Invio o fai clic su ✓
- **Annulla** — Premi Escape o fai clic su ✗

### Modalità Sorgente

- **`Cmd + Clic`** (`Ctrl + Clic` su Windows/Linux) su collegamento → gli URL esterni si aprono nel browser, i collegamenti `#segnalibro` saltano all'intestazione e i percorsi di file locali aprono il file in una nuova scheda
- **Clic** sulla sintassi `[testo](url)` → mostra il popup di modifica; il cursore resta nel markdown così puoi continuare a scrivere
- **`Mod + K`** all'interno del collegamento → mostra il popup di modifica con il focus nel campo URL

::: tip Collegamento Segnalibro
I collegamenti che iniziano con `#` vengono trattati come segnalibri (collegamenti interni all'intestazione). L'apertura salta all'intestazione invece di aprire un browser.
:::

::: tip Collegamenti tra File
I collegamenti che puntano a file locali aprono il file di destinazione in una nuova scheda, posizionandosi sull'intestazione quando il collegamento contiene un `#fragment`. I percorsi relativi come `../appendix/cards.md` o `./notes.md` vengono risolti rispetto alla cartella del documento corrente. I percorsi assoluti — `/Users/me/notes/a.md` su macOS/Linux, `C:\notes\a.md` su Windows — aprono esattamente il file indicato. I percorsi di rete (`\\server\share\…`) non vengono aperti dai collegamenti. Se il documento è senza titolo, è possibile aprire solo percorsi assoluti.
:::

## Popup Media (Immagini, Video, Audio)

Un popup unificato per la modifica di tutti i tipi di media — immagini, video e audio.

### Popup di Modifica

**Attivazione:** Doppio clic su qualsiasi elemento media (immagine, video o audio)

**Campi comuni (tutti i tipi di media):**
- **Sorgente** — Percorso del file o URL

**Campi specifici per tipo:**

| Campo | Immagine | Video | Audio |
|-------|----------|-------|-------|
| Testo alt | Sì | — | — |
| Titolo | — | Sì | Sì |
| Poster | — | Sì | — |
| Dimensioni | Sola lettura | — | — |
| Attiva/disattiva Inline/Blocco | Sì (non per immagini collegate) | — | — |

**Pulsanti:**
- **Sfoglia** — Scegli il file dal filesystem
- **Copia** — Copia il percorso sorgente negli appunti
- **Elimina** — Rimuovi l'elemento media

**Scorciatoie:**
- `Mod + Shift + I` — Inserisci nuova immagine
- `Invio` — Salva le modifiche
- `Escape` — Chiudi il popup

### Modalità Sorgente

In modalità Sorgente, facendo clic sulla sintassi dell'immagine `![alt](path)` si apre lo stesso popup media. I file multimediali (estensioni video/audio) mostrano un'anteprima fluttuante con controlli di riproduzione nativi al passaggio del mouse.

## Menu Contestuale Immagine

Cliccando con il tasto destro su un'immagine in modalità WYSIWYG si apre un menu contestuale con azioni rapide (separato dal popup di modifica con doppio clic).

**Attivazione:** Clic destro su qualsiasi immagine

**Azioni:**
| Azione | Descrizione |
|--------|-------------|
| Cambia Immagine | Apri un selettore di file per sostituire l'immagine |
| Elimina Immagine | Rimuovi l'immagine dal documento |
| Copia Percorso | Copia il percorso sorgente dell'immagine negli appunti |
| Mostra nel Finder | Apri la posizione del file immagine nel gestore file (l'etichetta si adatta in base alla piattaforma) |

Premi `Escape` per chiudere il menu contestuale senza eseguire alcuna azione.

## Popup Matematica

Modifica le espressioni matematiche LaTeX con anteprima in tempo reale.

**Attivazione:**
- **WYSIWYG:** Fai clic sulla matematica inline `$...$`
- **Sorgente:** Posiziona il cursore all'interno di `$...$`, `$$...$$` o blocchi ` ```latex `

**Campi:**
- **Input LaTeX** — Modifica l'espressione matematica
- **Anteprima** — Anteprima renderizzata in tempo reale
- **Visualizzazione Errori** — Mostra gli errori LaTeX con suggerimenti utili sulla sintassi

**Scorciatoie:**
- `Mod + Invio` — Salva e chiudi
- `Escape` — Annulla e chiudi
- `Shift + Backspace` — Elimina matematica inline (funziona anche quando non è vuota, solo WYSIWYG)
- `Alt + Mod + M` — Inserisci nuova matematica inline

::: tip Suggerimenti sugli Errori
Quando hai un errore di sintassi LaTeX, il popup mostra suggerimenti utili come parentesi graffe mancanti, comandi sconosciuti o delimitatori non bilanciati.
:::

::: info Modalità Sorgente
La modalità Sorgente fornisce lo stesso popup matematico modificabile della modalità WYSIWYG — un'area di testo per l'input LaTeX con un'anteprima KaTeX in tempo reale sottostante. Il popup si apre automaticamente quando il cursore entra in qualsiasi sintassi matematica (`$...$`, `$$...$$` o ` ```latex `). Premi `Mod + Invio` per salvare o `Escape` per annullare.
:::

## Popup Note a Piè di Pagina

Modifica il contenuto delle note a piè di pagina inline.

**Attivazione:**
- **WYSIWYG:** Passa il mouse sul riferimento della nota `[^1]`

**Campi:**
- **Contenuto** — Testo della nota su più righe (con ridimensionamento automatico)
- **Vai alla Definizione** — Salta alla definizione della nota
- **Elimina** — Rimuovi la nota

**Comportamento:**
- Le nuove note mettono automaticamente il focus sul campo contenuto
- L'area di testo si espande mentre digiti

## Popup Wiki Link

Modifica i collegamenti in stile wiki per le connessioni interne ai documenti.

**Attivazione:**
- **WYSIWYG:** Passa il mouse su `[[destinazione]]` (ritardo di 300ms)
- **Sorgente:** Fai clic sulla sintassi del wiki link

**Campi:**
- **Destinazione** — Percorso relativo al workspace (l'estensione `.md` viene gestita automaticamente)
- **Sfoglia** — Scegli il file dal workspace
- **Apri** — Apri il documento collegato
- **Copia** — Copia il percorso della destinazione
- **Elimina** — Rimuovi il wiki link

## Menu Contestuale Tabella

Azioni rapide per la modifica delle tabelle.

**Attivazione:**
- **WYSIWYG:** Usa la barra degli strumenti o le scorciatoie da tastiera
- **Sorgente:** Clic destro sulla cella della tabella

**Azioni:**
| Azione | Descrizione |
|--------|-------------|
| Inserisci Riga Sopra/Sotto | Aggiungi riga al cursore |
| Inserisci Colonna Sinistra/Destra | Aggiungi colonna al cursore |
| Elimina Riga | Rimuovi la riga corrente |
| Elimina Colonna | Rimuovi la colonna corrente |
| Elimina Tabella | Rimuovi l'intera tabella |
| Allinea Colonna Sinistra/Centro/Destra | Imposta l'allineamento per la colonna corrente |
| Allinea Tutto Sinistra/Centro/Destra | Imposta l'allineamento per tutte le colonne |
| Formatta Tabella | Allinea automaticamente le colonne della tabella (abbellisci markdown) |

## Popup Controllo Ortografico

Correggi gli errori di ortografia con suggerimenti.

**Attivazione:**
- Clic destro sulla parola con errore ortografico (sottolineatura rossa)

**Azioni:**
- **Suggerimenti** — Fai clic per sostituire con il suggerimento
- **Aggiungi al Dizionario** — Smetti di contrassegnare come errore ortografico

## Confronto tra Modalità

| Elemento | Modifica WYSIWYG | Sorgente |
|----------|-----------------|---------|
| Collegamento | Clic / `Mod+K` / `Cmd+Clic` per aprire | Clic / `Mod+K` / `Cmd+Clic` per aprire |
| Immagine | Doppio clic | Clic su `![](path)` |
| Video | Doppio clic | — |
| Audio | Doppio clic | — |
| Matematica | Clic | Cursore nella matematica → popup |
| Nota a piè di pagina | Passaggio del mouse | Modifica diretta |
| Wiki Link | Passaggio del mouse | Clic |
| Tabella | Barra degli strumenti | Menu clic destro |
| Controllo Ortografico | Clic destro | Clic destro |

## Suggerimenti per la Navigazione nei Popup

### Flusso del Focus
1. Il popup si apre con il primo input in focus
2. `Tab` si sposta in avanti attraverso i campi e i pulsanti
3. `Shift + Tab` si sposta all'indietro
4. Il focus si avvolge all'interno del popup

### Modifica Rapida
- Per semplici modifiche URL: modifica e premi `Invio`
- Per annullare: premi `Escape` da qualsiasi campo
- Per contenuto su più righe (note, matematica): usa `Mod + Invio` per salvare

### Comportamento del Mouse
- Fai clic fuori dal popup per chiudere (le modifiche vengono scartate)
- I popup al passaggio del mouse (nota, wiki) hanno un ritardo di 300ms prima di essere mostrati
- Spostare il mouse di nuovo sul popup lo mantiene aperto

<!-- Styles in style.css -->
