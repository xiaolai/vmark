# Funzionalità

VMark è lo spazio di lavoro in testo semplice in cui persone e IA collaborano. Il Markdown è il fulcro (con le modalità WYSIWYG, Anteprima Sorgente e Sorgente), ma lo spazio di lavoro apre anche YAML, JSON, TOML, Mermaid, SVG, HTML e 9 formati di visualizzatore di codice — vedi [Formati Supportati](/it/guide/formats) per l'elenco completo.

[[toc]]

## Modalità di Editor

### Modalità Rich Text (WYSIWYG)

La modalità di modifica predefinita offre una vera esperienza "quello che vedi è quello che ottieni":

- Anteprima della formattazione in tempo reale durante la digitazione
- Visualizzazione della sintassi inline al passaggio del cursore
- Barra degli strumenti intuitiva e menu contestuali
- Input della sintassi Markdown senza interruzioni

### Modalità Sorgente

Passa alla modifica Markdown grezzo con evidenziazione completa della sintassi:

- Editor basato su CodeMirror 6
- Evidenziazione completa della sintassi
- Popup interattivi per matematica, collegamenti, immagini, wiki link e media — stessa esperienza di modifica di WYSIWYG
- Incolla intelligente — HTML da pagine web e documenti Word viene convertito automaticamente in Markdown pulito
- Incolla immagini dagli appunti — screenshot e immagini copiate vengono salvati nella cartella delle risorse e inseriti come `![](percorso)`
- Multi-cursore con riconoscimento dei blocchi di codice e supporto per i confini di parola CJK
- Perfetta per gli utenti avanzati

Passa da una modalità all'altra con `F6`.

### Vista Divisa (Sorgente + Anteprima)

Modifica il sorgente Markdown grezzo a sinistra mentre un'**anteprima WYSIWYG dal vivo
in sola lettura** si aggiorna a destra — l'anteprima *è* il renderer WYSIWYG, quindi
non si discosta mai da ciò che vedresti nella Modalità Rich Text. I comandi di formattazione e la
barra degli strumenti agiscono sul riquadro sorgente; trascina il divisore (o usa i tasti freccia su di esso) per
ridimensionare.

- Attivala per la sessione con `Shift + F6`, **Vista → Vista divisa Markdown** o la
  palette dei comandi ("Attiva/disattiva vista divisa Markdown")
- Rendila predefinita per i file Markdown in **Impostazioni → Markdown → Layout →
  Dividi sorgente/anteprima per impostazione predefinita**

Il WYSIWYG resta la modalità predefinita; la divisione è opzionale. Le tre viste si escludono
a vicenda — `F6` attiva/disattiva Sorgente e `Shift + F6` attiva/disattiva Divisa, e ciascuna torna
al WYSIWYG — quindi passare dall'una all'altra richiede sempre un solo tasto.

Il menu **Vista** mostra le tre modalità — **Modalità WYSIWYG**, **Modalità codice
sorgente**, **Vista divisa Markdown** — come un gruppo con segno di spunta, così la modalità attiva è
sempre visibile e l'esclusione reciproca è esplicita. **A capo automatico** e
**Numeri riga** si applicano solo all'editor sorgente, quindi sono disattivati mentre
sei in modalità WYSIWYG.

### Posizione di Lettura

Il punto in cui eri in un documento sopravvive quando lo lasci. Passare a un'altra scheda e tornare,
attivare la modalità Sorgente o la Vista divisa, o far ricaricare il file dal disco ti
riportano tutti dove stavi leggendo — non all'inizio.

Ogni superficie ricorda la propria posizione, quindi Rich Text e Sorgente mantengono punti
separati nello stesso file. Tornare alla stessa superficie — cambiando scheda o quando il file
viene ricaricato — ti riporta dove avevi fatto scorrere la vista, anche se il cursore è altrove;
il cursore resta dove l'hai lasciato. Passando da Rich Text a Sorgente e viceversa, invece, la
vista segue il cursore, se c'è, perché è questo che mantiene in vista lo stesso paragrafo in entrambe.

Le posizioni sono per documento e per sessione — chiudere una scheda le dimentica.

### Annullamento tra le Modalità

Annulla e ripristina attraversano il confine WYSIWYG ⇄ Sorgente. Ogni cambio di modalità registra un checkpoint e, una volta esaurita la cronologia dell'editor corrente, `Mod + Z` continua attraverso quei checkpoint — ripristinando il contenuto precedente senza cambiare la vista in cui ti trovi. Ripristina percorre la stessa catena in avanti; un ripristino il cui ramo hai abbandonato facendo una nuova modifica viene rifiutato invece di essere applicato sopra il tuo lavoro. La catena è conservata per scheda e cancellata quando la scheda si chiude.

### File di Grandi Dimensioni

VMark apre automaticamente in modalità Sorgente i file di grandi dimensioni per un'apertura in meno di un secondo — file oltre 1 MB o Markdown denso di blocchi con 1.200+ blocchi stimati —, avvisa prima di toccare file oltre 5 MB e rifiuta i file oltre 50 MB. Vedi la guida ai [File di grandi dimensioni](./large-files.md) per soglie e impostazioni.

### Anteprima Sorgente

Modifica il Markdown grezzo di un singolo blocco senza uscire dalla modalità WYSIWYG. Premi `F5` per aprire l'Anteprima Sorgente per il blocco alla posizione del cursore.

**Layout:**
- Barra dell'intestazione con etichetta del tipo di blocco e pulsanti di azione
- Editor CodeMirror che mostra il sorgente Markdown del blocco
- Blocco originale mostrato come anteprima attenuata (quando l'anteprima live è ATTIVA)

**Controlli:**
| Azione | Scorciatoia |
|--------|-------------|
| Salva modifiche | `Cmd/Ctrl + Enter` |
| Annulla (ripristina) | `Escape` |
| Attiva/disattiva anteprima live | Fai clic sull'icona occhio |

**Anteprima Live:**
- **DISATTIVA (predefinita):** Modifica liberamente, le modifiche vengono applicate solo al salvataggio
- **ATTIVA:** Le modifiche vengono applicate immediatamente durante la digitazione, l'anteprima viene mostrata sotto

**Blocchi esclusi:**
Alcuni blocchi hanno i propri meccanismi di modifica e saltano l'Anteprima Sorgente:
- Blocchi di codice (inclusi Mermaid, LaTeX) — usa il doppio clic per modificare
- Immagini a blocco — usa il popup immagine
- Frontmatter, blocchi HTML, regole orizzontali

L'Anteprima Sorgente è utile per la modifica precisa del Markdown (correzione della sintassi delle tabelle, regolazione dell'indentazione degli elenchi) rimanendo nell'editor visuale.

## Modifica Multi-Cursore

Modifica più posizioni contemporaneamente — VMark supporta il multi-cursore completo sia in modalità WYSIWYG che Sorgente.

| Azione | Scorciatoia |
|--------|-------------|
| Aggiungi cursore alla corrispondenza successiva | `Mod + D` |
| Salta corrispondenza, vai alla successiva | `Mod + Shift + D` |
| Seleziona tutte le occorrenze | `Mod + Shift + L` |
| Aggiungi cursore sopra/sotto | `Mod + Alt + Su/Giù` |
| Aggiungi cursore al clic | `Alt + Clic` |
| Annulla ultimo cursore | `Alt + Mod + Z` |
| Comprimi a singolo cursore | `Escape` |

Tutte le modifiche standard (digitazione, eliminazione, appunti, navigazione) funzionano su ogni cursore in modo indipendente. Nel testo normale, `Mod + D` e `Mod + Shift + L` cercano in tutto il documento; all'interno di un blocco di codice restano entro quel blocco. `Alt + Mod + Shift + L` seleziona ogni corrispondenza solo nel blocco corrente.

[Scopri di più →](/it/guide/multi-cursor)

## Selezione Intelligente di Tutto

In modalità WYSIWYG, `Mod + A` amplia la selezione un contenitore alla volta invece di passare direttamente all'intero documento: all'interno di una tabella seleziona la cella, poi la riga, poi la tabella, poi il documento. `Mod + Z` annulla un passo di espansione ed `Escape` riduce la selezione a un cursore.

In modalità Sorgente, `Mod + A` seleziona prima il blocco che la contiene — un blocco di codice delimitato, una tabella, una citazione o un elenco — e poi l'intero documento; anche qui `Mod + Z` annulla un passo di espansione.

La combinazione appartiene all'editor e non è personalizzabile.

## Coppia Automatica e Tab Escape

Quando digiti una parentesi aperta, una virgoletta o un apice inverso, VMark inserisce automaticamente la coppia di chiusura. Premi **Tab** per saltare oltre il carattere di chiusura invece di raggiungere il tasto freccia.

- Parentesi: `()` `[]` `{}`
- Virgolette: `""` `''` `` ` ` ``
- CJK: `「」` `『』` `（）` `【】` `《》` `〈〉`
- Virgolette curve: `""` `''`
- Indicatori di formattazione in WYSIWYG: **grassetto**, *corsivo*, `codice`, ~~barrato~~, collegamenti

Backspace elimina entrambi i caratteri quando la coppia è vuota. La coppia automatica e il salto con Tab alle parentesi sono entrambi **disabilitati all'interno di blocchi di codice e codice inline** — le parentesi nel codice rimangono letterali. Configurabile in **Impostazioni → Editor**.

[Scopri di più →](/it/guide/tab-navigation)

## Formattazione del Testo

### Stili di Base

- **Grassetto**, *Corsivo*, <u>Sottolineato</u>, ~~Barrato~~
- `Codice inline`, ==Evidenziato==
- Pedice e Apice
- Collegamenti, Wiki Link e Segnalibri con popup di anteprima
- Note a piè di pagina con modifica inline
- Attivazione/disattivazione commento HTML (`Mod + /`)
- Comando per cancellare la formattazione

### Trasformazioni del Testo

Cambia rapidamente le maiuscole/minuscole tramite Formato → Trasforma:

| Trasformazione | Scorciatoia |
|----------------|-------------|
| MAIUSCOLO | `Ctrl + Shift + U` (macOS) / `Alt + Shift + U` (Win/Linux) |
| minuscolo | `Ctrl + Shift + L` (macOS) / `Alt + Shift + L` (Win/Linux) |
| Prima Lettera Maiuscola | `Ctrl + Shift + T` (macOS) / `Alt + Shift + T` (Win/Linux) |
| Inverti Maiuscole | — |

### Elementi a Blocco

- Intestazioni da 1 a 6 con scorciatoie facili (aumenta/diminuisci il livello con `Mod + Alt + ]`/`[`)
- Citazioni (nidificazione supportata)
- Blocchi di codice con evidenziazione della sintassi
- Elenchi ordinati, non ordinati e di attività
- Cicla il tipo di elenco: converte un paragrafo in elenco puntato, numerato o di attività in sequenza
- Disattiva un elenco: fare di nuovo clic sul tipo di elenco attivo rimuove la formattazione dell'elenco
- Converti in codice: l'azione Blocco di codice trasforma l'intero elenco al cursore — o qualsiasi selezione di più blocchi (paragrafi, intestazioni, elenchi) — in un unico blocco di codice, una riga per blocco o elemento dell'elenco
- Regole orizzontali
- Tabelle con supporto completo alla modifica

### Interruzioni di Riga Forzate

Premi `Shift + Enter` per inserire un'interruzione di riga forzata all'interno di un paragrafo.
VMark usa lo stile a due spazi per impostazione predefinita per la massima compatibilità.
Configurabile in **Impostazioni > Editor > Spazi bianchi**.

### Operazioni sulle Righe

Potente manipolazione delle righe tramite Modifica → Righe:

| Azione | Scorciatoia |
|--------|-------------|
| Sposta riga su | `Alt + Su` |
| Sposta riga giù | `Alt + Giù` |
| Duplica riga | `Shift + Alt + Giù` |
| Elimina riga | `Mod + Shift + K` |
| Unisci righe | `Mod + J` |
| Rimuovi righe vuote | — |
| Ordina righe in modo crescente | `F4` _(solo modalità Sorgente)_ |
| Ordina righe in modo decrescente | `Shift + F4` _(solo modalità Sorgente)_ |

L'ordinamento opera su righe di testo semplice, quindi è disponibile solo in modalità Sorgente.

## Tabelle

Modifica completa delle tabelle:

- Inserisci tabelle tramite menu o scorciatoia
- Aggiungi/elimina righe e colonne
- Allineamento delle celle (sinistra, centro, destra)
- Le colonne si dimensionano automaticamente in base al contenuto; le tabelle larghe scorrono orizzontalmente
- Adatta alla larghezza — fissa una tabella alla larghezza dell'editor con colonne proporzionali al contenuto (Impostazioni → Markdown, o per singola tabella tramite clic destro)
- Barra degli strumenti contestuale per azioni rapide
- Navigazione da tastiera — `Tab` / `Shift + Tab` si spostano tra le celle, i tasti freccia escono dalla tabella ai suoi bordi, e `Mod + Enter` / `Mod + Shift + Enter` aggiungono una riga sotto / sopra

## Immagini

Supporto completo per le immagini:

- Inserisci tramite finestra di dialogo file
- Trascina e rilascia dal file system
- Incolla dagli appunti
- Copia automatica nella cartella delle risorse del progetto
- Doppio clic per modificare il percorso sorgente e il testo alternativo — le dimensioni dell'immagine sono mostrate in sola lettura
- Clic destro per Cambia immagine, Elimina immagine, Copia percorso e Mostra nel Finder (Mostra in Esplora risorse su Windows, Mostra nel gestore file su Linux)
- Alterna tra visualizzazione inline e a blocco

## Video e Audio

Supporto completo per i media con tag HTML5:

- Inserisci video e audio tramite il selettore file della barra degli strumenti
- Trascina e rilascia i file multimediali nell'editor
- Copia automatica nella cartella `.assets/` del progetto
- Fai clic per modificare il percorso sorgente, il titolo e il poster (video)
- Supporto per embed YouTube con iframe rispettosi della privacy
- Fallback per la sintassi delle immagini: `![](file.mp4)` viene promosso automaticamente a video
- Decorazione in modalità sorgente con bordi colorati specifici per tipo
- [Scopri di più →](/it/guide/media-support)

## Pannello Frontmatter

Modifica il frontmatter YAML direttamente in modalità WYSIWYG senza passare alla modalità Sorgente.

- **Compresso per impostazione predefinita** — una piccola etichetta "Frontmatter" appare nella parte superiore del documento quando è presente il frontmatter
- **Fai clic per espandere** — apre un editor di testo semplice per il contenuto YAML
- **`Mod + Invio`** — salva le modifiche e comprimi il pannello
- **`Escape`** — ripristina l'ultimo valore salvato e comprimi
- **Salvataggio automatico alla perdita del focus** — se fai clic altrove, le modifiche vengono salvate automaticamente dopo un breve ritardo

Il pannello crea un punto di annullamento nella cronologia dell'editor, quindi puoi sempre usare `Mod + Z` per ripristinare le modifiche al frontmatter.

## Contenuto Speciale

### Riquadri Informativi

Avvisi in stile GitHub Flavored Markdown:

- NOTE - Informazioni generali
- TIP - Suggerimenti utili
- IMPORTANT - Informazioni chiave
- WARNING - Problemi potenziali
- CAUTION - Azioni pericolose

### Sezioni Comprimibili

Crea blocchi di contenuto espandibili usando l'elemento HTML `<details>`.

### Equazioni Matematiche

Rendering LaTeX basato su KaTeX:

- Matematica inline: `$E = mc^2$`
- Matematica a display: blocchi `$$...$$`
- I delimitatori in stile ChatGPT vengono riconosciuti all'apertura/incolla e normalizzati nella
  forma con `$`: `\( ... \)` diventa matematica inline, e un `\[ ... \]` a sé stante
  diventa un blocco a display
- Un blocco `$$` deve chiudersi prima di una riga vuota (la regola di pandoc) — un
  `$$` non chiuso viene mostrato come testo letterale invece di inghiottire i paragrafi successivi.
  Le righe vuote finali subito prima della chiusura vanno bene (un blocco
  `$$` … `$$` vuoto resta un blocco matematico)
- Supporto completo della sintassi LaTeX
- Messaggi di errore utili con suggerimenti sulla sintassi

### Diagrammi

Supporto per diagrammi Mermaid con anteprima live:

- Diagrammi di flusso, diagrammi di sequenza, diagrammi di Gantt
- Diagrammi di classi, diagrammi di stato, diagrammi ER
- Pannello di anteprima live in modalità Sorgente (trascina, ridimensiona, zoom)
- [Scopri di più →](/it/guide/mermaid)

Supporto Graphviz DOT con le stesse superfici di anteprima:

- I blocchi delimitati ` ```dot ` e ` ```graphviz ` vengono renderizzati localmente (WASM)
- Pan, zoom ed esportazione PNG come per i diagrammi Mermaid
- [Scopri di più →](/it/guide/graphviz)

### Grafica SVG

Renderizza SVG grezzo inline tramite blocchi di codice ` ```svg `:

- Rendering istantaneo con panoramica, zoom ed esportazione PNG
- Anteprima live sia in modalità WYSIWYG che Sorgente
- Ideale per grafici generati dall'IA e illustrazioni personalizzate
- [Scopri di più →](/it/guide/svg)

### Indice Inline

Scegli **Inserisci → Indice** per inserire subito un indice dinamico in entrambe le modalità (la voce di menu non ha una scorciatoia predefinita; assegnane una in Impostazioni → Scorciatoie). Puoi anche scrivere `[TOC]` su una riga a sé: in modalità Sorgente quella riga è l'indice, mentre in WYSIWYG un `[TOC]` digitato resta testo normale finché il documento non viene analizzato di nuovo — per esempio dopo il passaggio alla modalità Sorgente e ritorno, o dopo aver riaperto il file. Un `[TOC]` all'interno di altro testo non viene mai convertito:

- Generato automaticamente dalle intestazioni del documento con la corretta nidificazione
- Fai clic su un'intestazione per scorrere direttamente fino a essa
- Si aggiorna in tempo reale mentre scrivi
- Viene renderizzato in WYSIWYG e nell'esportazione (HTML/PDF), e in modalità Sorgente il round-trip resta pulito

## Genies IA

Assistenza alla scrittura IA integrata basata sul provider di tua scelta:

- 13 genies in quattro categorie — modifica, creativo, struttura e strumenti
- Selettore in stile Spotlight con ricerca e prompt liberi (`Mod + Y`)
- Rendering inline dei suggerimenti — accetta o rifiuta con scorciatoie da tastiera
- Supporta provider CLI (Claude, Codex, Gemini) e API REST (Anthropic, OpenAI, Google AI, Ollama)

[Scopri di più →](/it/guide/ai-genies) | [Configura i provider →](/it/guide/ai-providers)

## Cerca e Sostituisci

Apri la barra di ricerca con `Mod + F`. Si apre nella barra in fondo alla finestra e funziona sia in modalità WYSIWYG che Sorgente.

**Navigazione:**

| Azione | Scorciatoia |
|--------|-------------|
| Trova corrispondenza successiva | `Enter` o `Mod + G` |
| Trova corrispondenza precedente | `Shift + Enter` o `Mod + Shift + G` |
| Usa la selezione per la ricerca | `Mod + E` |
| Chiudi la barra di ricerca | `Escape` |

**Opzioni di ricerca** — attiva/disattiva tramite pulsanti nella barra di ricerca:

- **Distingui maiuscole/minuscole** — corrispondenza esatta delle lettere
- **Parola intera** — corrispondenza solo con parole complete, non sottosequenze
- **Espressione regolare** — usa pattern regex (abilita prima nelle Impostazioni)

**Sostituisci:**

Il campo di sostituzione si trova accanto al campo di ricerca — entrambi sono sempre visibili, e `Tab` passa dall'uno all'altro. Digita il testo sostitutivo, poi usa **Sostituisci** (singola corrispondenza) o **Sostituisci tutto** (ogni corrispondenza in una volta). Il contatore di corrispondenze mostra la posizione corrente e il totale (es. "3 di 12") così sai sempre dove ti trovi.

## Lint Markdown

VMark include un linter Markdown integrato che verifica il documento alla ricerca di errori di sintassi comuni e problemi di accessibilità. Abilitalo in **Impostazioni > Markdown > Lint**.

**Come utilizzarlo:**

| Azione | Scorciatoia |
|--------|-------------|
| Esegui controllo lint | `Alt + Mod + V` |
| Vai al problema successivo | `F2` |
| Vai al problema precedente | `Shift + F2` |

Quando esegui un controllo lint, le diagnostiche appaiono come evidenziazioni inline e marcatori nel margine. Se non vengono trovati problemi, una notifica conferma che il documento è pulito. I problemi sono classificati come errori o avvisi.

**Regole verificate (13 in totale):**

- Link di riferimento non definiti
- Conteggio colonne tabella non corrispondente
- Sintassi link invertita `(testo)[url]` invece di `[testo](url)`
- Spazio mancante dopo `#` nelle intestazioni
- Spazi all'interno dei marcatori di enfasi
- Testo del link vuoto o URL del link vuoti
- Definizioni di link/immagine duplicate
- Definizioni di link/immagine non utilizzate
- Incrementi di livello intestazione che saltano livelli (es. H1 a H3)
- Immagini senza testo alternativo (accessibilità)
- Blocchi di codice delimitati non chiusi
- Link a frammento rotti (`#ancora` che non corrisponde a nessuna intestazione)

I risultati del lint non si aggiornano mentre scrivi. In modalità Sorgente, una modifica li cancella. In modalità WYSIWYG, una modifica rimuove le evidenziazioni, ma il conteggio dei problemi nella barra di stato e le destinazioni di `F2` / `Shift + F2` restano quelli dell'ultima esecuzione finché non esegui di nuovo il controllo o chiudi la scheda. Riesegui il controllo in qualsiasi momento con `Alt + Mod + V`.

## Barra degli Strumenti Universale

Una barra degli strumenti di formattazione ancorata nella parte inferiore dell'editor, che fornisce accesso rapido a tutte le azioni di formattazione sia in modalità WYSIWYG che Sorgente.

- **Attiva/disattiva:** `Mod + Shift + B` apre la barra degli strumenti e le assegna il focus. Premilo di nuovo per restituire il focus all'editor mantenendo la barra visibile.
- **Navigazione da tastiera:** Usa le frecce `Sinistra`/`Destra` per spostarti tra i gruppi. `Enter` o `Spazio` apre un menu a discesa. Le frecce navigano all'interno dei menu.
- **Escape a due fasi:** Se un menu a discesa è aperto, `Escape` chiude prima il menu. Premi `Escape` di nuovo per chiudere l'intera barra degli strumenti.
- **Memoria di sessione:** La barra ricorda quale pulsante era focalizzato per ultimo durante la sessione corrente, quindi la rifocalizzazione riprende da dove eri rimasto.
- **Scorciatoia Genies IA:** La barra include un pulsante Genies IA che apre il selettore genie (`Mod + Y`).

## Menu Contestuale dell'Editor

Fai clic destro in un punto qualsiasi dell'editor (modalità WYSIWYG o Sorgente) per aprire un menu contestuale con le azioni comuni.

- **Appunti:** Taglia, Copia, Incolla e Seleziona tutto. Su macOS usano la pipeline nativa degli appunti, quindi incollare contenuti formattati (ad es. HTML copiato da un browser) ne mantiene la formattazione — esattamente come `Mod + V`.
- **Formattazione inline:** Grassetto, Corsivo, Barrato e Codice inline, con segni di spunta che mostrano i marcatori attivi al cursore.
- **Operazioni sui blocchi:** sottomenu Livello intestazione e Tipo di elenco, Citazione e Blocco di codice — i segni di spunta riflettono il blocco corrente.
- **Collegamenti:** Inserisci link sul testo semplice; su un collegamento esistente la sezione diventa Modifica link, Copia link e Rimuovi link.
- **Sensibile al contesto:** all'interno delle tabelle compare invece il menu dedicato alle tabelle; il clic destro su un'immagine apre il menu dell'immagine; all'interno dei blocchi di codice sono offerte solo le azioni degli appunti. I file non Markdown (JSON, YAML, …) ricevono un menu ridotto con le sole azioni degli appunti.
- **Gestione della selezione:** il clic destro all'interno di una selezione la mantiene; il clic destro altrove sposta prima lì il cursore (convenzione di macOS).
- **Tastiera:** i tasti freccia navigano (le voci disattivate vengono saltate), `Destra`/`Sinistra` entrano nei sottomenu e ne escono, `Escape` chiude prima il sottomenu e poi il menu. I suggerimenti delle scorciatoie riflettono le tue combinazioni di tasti personalizzate.

## Palette dei Comandi

Premi `Mod + Shift + P` per aprire la palette dei comandi. Con una ricerca vuota elenca tutti i comandi disponibili raggruppati per categoria — file, workspace, vista, esportazione, formattazione, intestazioni, elenchi, tabelle, righe, selezione, trasformazione, CJK, lint, cronologia, IA e altro; digita per filtrare e ordinare per corrispondenza. `↑`/`↓` si spostano, `Enter` esegue il comando, `Escape` (o un clic sullo sfondo) chiude. Vengono mostrati solo i comandi applicabili in quel momento — un comando dell'editor scompare quando non è aperto alcun documento, un comando del workspace quando non è aperto alcun workspace — e il comando viene eseguito nella finestra da cui hai aperto la palette. Le pagine di questa guida citano i comandi della palette tra virgolette ("Attiva/disattiva vista divisa Markdown", "Dettaglio coerenza", "Stato finestre"). La palette non ha una voce di menu; la sua scorciatoia è personalizzabile in **Impostazioni → Scorciatoie**.

## Opzioni di Esportazione

VMark offre opzioni di esportazione flessibili per condividere i tuoi documenti.

### Esportazione HTML

**File → Esporta → HTML** scrive una cartella che contiene sia `index.html` (con una cartella `assets/` collegata) sia `standalone.html` (tutto incorporato) — non c'è una modalità da scegliere; usa il file più adatto.

L'HTML esportato include il [**VMark Reader**](/it/guide/export#vmark-reader) — controlli interattivi per impostazioni, sommario, lightbox delle immagini e altro.

[Scopri di più sull'esportazione →](/it/guide/export)

### Esportazione PDF

**File → Esporta → PDF** apre la finestra di esportazione di VMark — formato della pagina (A4, Letter, A3, Legal) e orientamento, margini predefiniti o un riquadro dei margini personalizzato trascinabile, dimensione del font, interlinea, font latini e CJK, stili predefiniti e numeri di pagina — poi scrive il PDF su macOS, Windows e Linux, con una struttura delle intestazioni cliccabile nella barra laterale del visualizzatore. **Stampa** (`Cmd/Ctrl + P`) è il percorso separato attraverso la finestra di stampa di sistema. [Scopri di più →](/it/guide/export#stampa-esporta-pdf)

### Copia come HTML

Copia il contenuto formattato per incollarlo in altre app (`Cmd/Ctrl + Shift + C`).

### Formato di Copia

Per impostazione predefinita, la copia da WYSIWYG inserisce testo normale (senza formattazione) negli appunti. Abilita il formato di copia **Markdown** in **Impostazioni > Editor > Comportamento** per inserire la sintassi Markdown in `text/plain` — le intestazioni mantengono i loro `#`, i collegamenti mantengono i loro URL, ecc. Utile quando si incolla in terminali, editor di codice o app di chat.

## Formattazione CJK

Strumenti integrati per la formattazione di testo cinese/giapponese/coreano:

- Oltre 20 regole di formattazione configurabili
- Spaziatura CJK-inglese
- Conversione dei caratteri a larghezza piena
- Normalizzazione della punteggiatura
- Abbinamento intelligente delle virgolette con rilevamento di apostrofi/apici
- Protezione dei costrutti tecnici (URL, versioni, orari, decimali)
- Conversione contestuale delle virgolette (curve per CJK, diritte per Latino)
- Alterna lo stile delle virgolette al cursore (`Shift + Mod + '`)
- [Scopri di più →](/it/guide/cjk-formatting)

## Cronologia Documenti

VMark salva automaticamente istantanee dei tuoi documenti così puoi recuperare versioni precedenti.

- **Salvataggio automatico** con intervallo configurabile cattura istantanee in background
- **Cronologia per documento** archiviata localmente nella cartella dei dati dell'applicazione di VMark — un file di indice più un file Markdown per ogni istantanea
- Apri la barra laterale Cronologia con `Ctrl + Shift + 3` per sfogliare le versioni passate
- Le istantanee sono **raggruppate per giorno** con timestamp che mostrano l'ora esatta di ogni versione salvata
- **Ripristina** una versione precedente facendo clic sul pulsante di ripristino accanto a qualsiasi istantanea (un dialogo di conferma previene ripristini accidentali)
- **Elimina** le singole istantanee di cui non hai più bisogno con il pulsante cestino
- Il contenuto attuale viene salvato come nuova istantanea prima di qualsiasi ripristino, così non perdi mai il tuo lavoro
- La cronologia richiede che il documento sia salvato su file (i documenti senza titolo non hanno cronologia)
- Abilita o disabilita il tracciamento della cronologia in **Impostazioni → File e immagini → Salvataggio** (**Mantieni cronologia documento**)

## Recupero Sessione (Hot Exit)

Quando VMark si riavvia per installare un aggiornamento, o si chiude inaspettatamente, il tuo lavoro viene preservato e ripristinato al prossimo avvio.

**Cosa salva un riavvio per aggiornamento:**
- Tutte le schede aperte e il loro contenuto (incluse le modifiche non salvate)
- Posizioni del cursore e cronologia annulla/ripristina
- Layout dell'interfaccia: stato della barra laterale, visibilità del sommario, modalità sorgente/focus/macchina da scrivere, stato del terminale
- Posizione e dimensione della finestra
- Workspace attivo e impostazioni dell'esploratore file

**Come funziona:**
- Quando scegli di riavviare e installare un aggiornamento, VMark cattura prima lo stato completo della sessione di tutte le finestre
- Al riavvio, le schede vengono ripristinate esattamente come le avevi lasciate, con i documenti modificati (non salvati) contrassegnati di conseguenza
- Le modifiche non salvate vengono anche scritte in istantanee di recupero ogni 10 secondi. Dopo una chiusura inaspettata, VMark le ripristina al prossimo avvio come schede non salvate
- Le istantanee di recupero più vecchie di 7 giorni vengono eliminate automaticamente
- Una normale chiusura non cattura la sessione: VMark ti chiede prima di salvare i documenti non salvati (vedi [Chiudere schede e finestre](/it/guide/tab-navigation#chiudere-schede-e-finestre)). Le schede aperte di un workspace tornano comunque la prossima volta che lo apri (vedi [Ripristino della Sessione](/it/guide/workspace-management#ripristino-della-sessione))

Nessuna configurazione necessaria. Il recupero sessione è sempre attivo.

## Barra di Stato

La barra di stato corre lungo il fondo della finestra (`F7` la nasconde). Il lato sinistro contiene la barra delle schede — vedi [Passare da una scheda aperta all'altra](/it/guide/tab-navigation#passare-da-una-scheda-aperta-all-altra) — e brevi avvisi come *"Aperto in modalità Sorgente (file di grandi dimensioni)."* Il lato destro, da sinistra a destra:

| Indicatore | Cosa mostra | Clic |
|---|---|---|
| Salvataggio automatico | Un'icona di salvataggio e quanto tempo fa il documento è stato salvato automaticamente; sfuma dopo qualche secondo | — |
| Conteggi | Parole e caratteri (spazi esclusi); con una selezione, *selezionati / totale* | Apre un popover **Conteggio parole**: parole, caratteri, caratteri senza spazi, caratteri CJK, caratteri senza punteggiatura |
| Lint | ⊗ errori o ⚠ avvisi trovati dall'ultima esecuzione del [lint](#lint-markdown); nascosto quando non ce ne sono | Salta al problema successivo |
| IA | Mentre un genie è in esecuzione, *In elaborazione...* con i secondi trascorsi e una × per annullare; poi *Fatto*, oppure l'errore con **Riprova**, che esegue di nuovo la richiesta fallita, e **Ignora**; Riprova non compare quando non c'è nulla da ripetere, per esempio senza provider | — |
| MCP | Un'icona a forma di satellite, colorata quando un client IA è connesso; la parola *off*, *…* o *error* quando non è in esecuzione normalmente. Il tooltip indica i client connessi | Apre **Impostazioni → Integrazioni** |
| Listener MCP | Un avviso, *MCP non disponibile in questa finestra*, quando il listener delle richieste di questa finestra non è riuscito ad avviarsi dopo tutti i tentativi: i client di IA non raggiungono questa finestra, anche se il server MCP è in esecuzione. Riavvia VMark per riprovare | — |
| Cronologia MCP | Un'icona della cronologia con il numero di versioni IA del documento attivo, in colore di avviso quando le sue modifiche non vengono registrate; il pannello mostra chi ha fatto ogni versione, con **Ripristina questa versione** e **Ripristina lo stato precedente a questa modifica**, oltre ai [Checkpoint precedenti](/it/guide/mcp-setup#checkpoint-delle-modifiche) | Apre il pannello |
| Terminale | — | Mostra o nasconde il terminale |
| Modalità | La modalità corrente — Sorgente o WYSIWYG (nascosta per i file di workflow di GitHub Actions) | Cambia modalità |
| Lucchetto | Se il documento è in sola lettura | Attiva/disattiva la sola lettura |

Il lato destro è nascosto mentre è attiva una scheda del browser. Una barra di stato nascosta ricompare da sola mentre un genie IA riporta l'avanzamento o è attiva una scheda del browser.

## Dettagli di Modifica

Alcuni comportamenti che funzionano senza alcuna impostazione:

- **La selezione resta visibile quando l'editor perde il focus.** Fai clic nel terminale, nella barra laterale o in un popup e il testo selezionato mantiene un'evidenziazione più tenue, così puoi vedere su cosa agirà un comando o uno strumento IA. La modalità Sorgente mostra ogni intervallo di una selezione multi-cursore.
- **Digitare sul bordo sinistro del codice inline scrive al suo interno.** Con il cursore subito prima di un frammento di codice inline in modalità WYSIWYG — in qualunque modo ci sia arrivato — il carattere successivo entra nel codice invece di finire fuori.
- **I metodi di input (IME) sono sicuri.** Mentre componi con un metodo di input cinese, giapponese o coreano, e per 50 ms dopo la fine della composizione, le scorciatoie dell'editor e le conversioni automatiche non scattano, quindi premere Invio per accettare un candidato non divide anche il paragrafo. Annulla e ripristina continuano a funzionare. Una sillaba coreana confermata con Invio inizia anche la nuova riga. La romanizzazione residua davanti al testo confermato viene rimossa, e un carattere confermato in una cella di tabella vuota resta come è stato digitato. Le notifiche informative attendono la fine della composizione; errori e avvisi compaiono subito. Una modifica di un client IA tramite MCP viene rifiutata (il client riprova) o trattenuta fino alla fine della composizione, e anche una modifica del file su disco attende, così nessuna delle due sovrascrive il testo che stai ancora componendo.
- **La riduzione del movimento viene rispettata.** Quando l'impostazione di accessibilità *riduci movimento* del sistema operativo è attiva, VMark disattiva animazioni e transizioni e scorre istantaneamente invece che in modo fluido (modalità macchina da scrivere inclusa). Non esiste un'impostazione separata in VMark. Allo stesso modo, l'impostazione di sistema *riduci trasparenza* disattiva la sfocatura dello sfondo.

## Visualizzazione e Focus

### Modalità Focus (`F8`)

La Modalità Focus attenua tutti i blocchi tranne quello che stai attualmente modificando, riducendo il rumore visivo così puoi concentrarti su un singolo paragrafo. Il blocco attivo è evidenziato a piena opacità mentre il contenuto circostante sfuma in un colore attenuato. Attivala con `F8` — funziona sia in modalità WYSIWYG che Sorgente e persiste finché non la disattivi.

### Modalità Macchina da Scrivere (`F9`)

La Modalità Macchina da Scrivere mantiene la riga attiva verticalmente centrata nel viewport, così i tuoi occhi rimangono in una posizione fissa mentre il documento scorre sotto — proprio come scrivere su una macchina da scrivere fisica. Attivala con `F9`. Funziona in entrambe le modalità di modifica e usa scorrimento fluido con una piccola soglia per evitare regolazioni instabili ai piccoli movimenti del cursore.

### Combinare Focus + Macchina da Scrivere

La Modalità Focus e la Modalità Macchina da Scrivere possono essere abilitate contemporaneamente. Insieme forniscono un ambiente di scrittura completamente privo di distrazioni: i blocchi circostanti sono attenuati *e* la riga corrente rimane centrata sullo schermo.

### Testo a Capo (`Alt + Z`)

Attiva/disattiva il ritorno a capo automatico con `Alt + Z`. Quando abilitato, le righe lunghe vanno a capo alla larghezza dell'editor invece di scorrere orizzontalmente. L'impostazione persiste tra le sessioni.

### Modalità Sola Lettura (`F10`)

Blocca un documento per prevenire modifiche accidentali. Attiva/disattiva con `F10`. Quando attiva, tutti gli input da tastiera e i comandi di formattazione sono bloccati — puoi comunque scorrere, selezionare testo e copiare. Utile per revisionare documenti finiti o consultare contenuti mentre scrivi in un'altra scheda.

### Pannello Sommario (`Ctrl + Shift + 1`)

Il pannello Sommario mostra la struttura delle intestazioni del documento come un albero comprimibile nella barra laterale. Aprilo con `Ctrl + Shift + 1`.

- Fai clic su qualsiasi intestazione per scorrere l'editor fino a quella sezione
- Comprimi ed espandi i gruppi di intestazioni per concentrarti su parti specifiche del documento
- L'intestazione attualmente attiva è evidenziata mentre scorri o digiti
- Si aggiorna in tempo reale quando aggiungi, rimuovi o rinomini intestazioni
- I titoli lunghi vanno a capo su due righe e si mostrano per intero al passaggio del mouse
- Un campo di filtro in cima al pannello restringe l'albero alle intestazioni il cui testo corrisponde alla ricerca (senza distinzione tra maiuscole e minuscole; gli antenati vengono mantenuti, così il percorso resta visibile). Premi `Esc` per cancellarlo.

### Zoom

Regola la dimensione del font dell'editor senza aprire le Impostazioni:

| Azione | Scorciatoia |
|--------|-------------|
| Ingrandisci | `Mod + =` |
| Riduci | `Mod + -` |
| Ripristina il valore predefinito | `Mod + 0` |

Lo zoom cambia la dimensione del font dell'editor con incrementi di 2px (intervallo: 12px a 32px). Modifica lo stesso valore di dimensione del font presente in **Impostazioni > Aspetto**, quindi lo zoom da tastiera e il cursore delle impostazioni restano sempre sincronizzati.

## Utilità di Testo

VMark include utilità per la pulizia e la formattazione del testo, disponibili nel menu Formato:

### Pulizia del Testo (Formato → Pulizia Testo)

- **Rimuovi spazi finali**: Elimina gli spazi bianchi alla fine delle righe
- **Comprimi righe vuote**: Riduci le righe vuote multiple a una singola

**Rimuovi spazi finali** e **Comprimi righe vuote** lasciano intatti i blocchi di codice delimitati, compreso un blocco non chiuso, che arriva fino alla fine del documento. I blocchi di codice indentati non sono protetti.

### Formattazione CJK (Formato → CJK)

Strumenti integrati per la formattazione del testo cinese/giapponese/coreano. [Scopri di più →](/it/guide/cjk-formatting)

### Pulizia Immagini (Formato → Pulizia testo → Rimuovi immagini non utilizzate...)

Trova e rimuovi le immagini orfane dalla tua cartella delle risorse (disponibile anche dalla palette dei comandi). VMark mostra cosa ha trovato e chiede conferma prima di eliminare, e le immagini eliminate finiscono nel cestino di sistema. Un'immagine ancora usata da un documento aperto — incluse le modifiche non salvate in un'altra finestra di VMark — viene mantenuta. Se VMark non riesce a confermare che un'immagine è inutilizzata (per esempio, un'altra finestra non risponde in tempo), non elimina nulla.

## Terminale Integrato

Pannello terminale integrato con sessioni multiple, copia/incolla, ricerca, percorsi file e URL cliccabili, menu contestuale, sincronizzazione del tema e impostazioni font configurabili. Attiva/disattiva con `` Ctrl + ` ``. [Scopri di più →](/it/guide/terminal)

## Aggiornamento Automatico

VMark controlla automaticamente gli aggiornamenti e può scaricarli e installarli nell'app:

- Controllo automatico degli aggiornamenti all'avvio
- Installazione degli aggiornamenti con un clic
- Anteprima delle note di rilascio prima dell'aggiornamento

## Supporto Workspace

- Apri cartelle come workspace
- Navigazione ad albero dei file nella barra laterale
- Cambio rapido dei file
- Tracciamento dei file recenti
- Dimensione e posizione della finestra memorizzate tra le sessioni
- Pannello Stato finestre — vedi lo stato in tempo reale di Claude Code / IA di ogni finestra aperta e salta direttamente a quella che richiede la tua attenzione; fissalo in questa finestra o in tutte le finestre (incluse quelle che aprirai in seguito) per tenerlo aperto mentre passi da una finestra all'altra

[Scopri di più →](/it/guide/workspace-management)

## Coerenza, base di conoscenza e Slidev

- **Coerenza e il pannello Dettaglio coerenza** — il tracciamento opzionale della provenienza registra quali documenti ha letto ogni generazione IA, segnala i documenti a valle quando uno a monte cambia, e vi aggiunge controlli semantici, affermazioni canoniche e contesti. Aprila da **Finestra → Dettaglio coerenza**. [Scopri di più →](/it/guide/coherence)
- **Base di conoscenza** — pubblica un workspace aperto come sito con collegamenti incrociati (wiki link, backlink, grafo delle relazioni, ricerca full-text) su `127.0.0.1`, in un pannello (`Ctrl + Shift + 4`) o nel tuo browser, e mostra in anteprima ed esporta presentazioni Slidev. Nessuna build di rilascio include ancora il runtime del content server di cui ha bisogno, quindi il pannello, la sua voce di menu, il comando della palette e la scorciatoia sono nascosti a meno che **Impostazioni → Avanzate → Strumenti sviluppatore** non sia attivo. [Scopri di più →](/it/guide/knowledge-base)

## Personalizzazione

### Temi

Sei temi di colore integrati:

- White (pulito, minimalista)
- Paper (bianco caldo)
- Mint (tinta verde morbida)
- Sepia (stile vintage)
- Night (modalità scura)
- Solarized (scuro, palette Solarized)

### Font

Configura font separati per:

- Testo Latino
- Testo CJK (cinese/giapponese/coreano)
- Monospace (codice)

Ogni selettore offre un breve elenco di font consigliati, i font installati sul tuo computer e una voce **Personalizzato…** in cui digitare il nome di qualsiasi famiglia di font. [Dettagli →](/it/guide/settings#tipografia)

Il font monospace viene verificato prima di essere usato, in modalità Sorgente, nel codice e nel terminale: se il font scelto non è installato, o si rivela non monospaziato, VMark ripiega lungo la pila sul successivo che lo è. Questo conta soprattutto su Linux con una lingua CJK, dove un nome di font mancante potrebbe altrimenti risolversi in un font CJK proporzionale e rompere la griglia del terminale.

### Layout

Regola:

- Dimensione del font
- Interlinea
- Spaziatura dei blocchi (spazio tra paragrafi e blocchi)
- Spaziatura delle lettere CJK (spaziatura sottile per la leggibilità CJK)
- Larghezza dell'editor
- Dimensione del font degli elementi a blocco (elenchi, citazioni, tabelle, avvisi)
- Allineamento delle intestazioni (sinistra o centro)
- Allineamento immagini e tabelle (sinistra o centro)

### Scorciatoie da Tastiera

Tutte le scorciatoie sono personalizzabili in Impostazioni → Scorciatoie.

## Dettagli Tecnici

VMark è costruito con tecnologia moderna:

| Componente | Tecnologia |
|-----------|------------|
| Framework Desktop | Tauri v2 (Rust) |
| Frontend | React 19, TypeScript |
| Gestione dello Stato | Zustand v5 |
| Editor Rich Text | Tiptap (ProseMirror) |
| Editor Sorgente | CodeMirror 6 |
| Stili | Tailwind CSS v4 |

Tutta l'elaborazione avviene localmente sul tuo computer — nessun servizio cloud, nessun account richiesto.
