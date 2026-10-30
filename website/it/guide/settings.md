# Impostazioni

Il pannello impostazioni di VMark ti consente di personalizzare ogni aspetto dell'editor. Aprilo con `Mod + ,` o tramite **VMark > Impostazioni** nella barra dei menu.

La finestra delle impostazioni ha una barra laterale che elenca le sezioni in ordine alfabetico (secondo i loro nomi inglesi), con Informazioni in fondo e Avanzate sotto di essa quando è visibile. Le modifiche hanno effetto immediato — non c'è nessun pulsante di salvataggio.

Usa la **casella di ricerca** in cima alla barra laterale per filtrare le impostazioni di tutti i pannelli per nome o descrizione — le righe corrispondenti vengono raccolte insieme, così non devi sapere in quale categoria si trova un'impostazione. Per riportare tutto ai valori di fabbrica, usa **Ripristina i valori predefiniti** nella sezione Informazioni.

## Aspetto

Controlla il tema visivo e il comportamento della finestra.

### Tema

Scegli uno dei sei temi di colore. Il tema attivo è indicato da un anello intorno al suo campione.

| Tema | Sfondo | Stile |
|------|--------|-------|
| White | `#FFFFFF` | Bianco pulito, contrasto massimo |
| Paper | `#EEEDED` | Carta di giornale calda, il predefinito |
| Mint | `#CCE6D0` | Verde morbido, riposante per gli occhi |
| Sepia | `#F9F0DB` | Carta da libro, per le letture lunghe |
| Night | `#23262B` | Ardesia scura per la luce scarsa |
| Solarized | `#002B36` | Solarized Dark, la palette classica |

::: info Windows 10 e Linux offrono solo White e Night
Su Windows 10 e Linux è il sistema a disegnare la barra del titolo, che può essere solo chiara o scura. Per questo quelle piattaforme offrono solo **White** e **Night**, e un tema che non può adattarsi all'interfaccia di sistema viene mostrato come il più vicino dei due: Paper, Mint e Sepia appaiono come White, Solarized come Night. La tua scelta salvata non viene modificata — su macOS e Windows 11 è disponibile l'intero catalogo. Su Windows 11 la barra del titolo assume i colori del tema stesso; la barra dei menu resta chiara o scura.
:::

#### Segui l'aspetto del sistema

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Segui l'aspetto del sistema | Passa automaticamente tra il tema chiaro e il tema scuro insieme al sistema | Off |

Quando è attiva, la singola riga del tema viene sostituita da due righe — **Tema chiaro** (usato mentre il sistema è in modalità chiara, predefinito Paper) e **Tema scuro** (usato in modalità scura, predefinito Night). VMark passa dall'uno all'altro nel momento in cui cambia l'aspetto del sistema; la tua scelta manuale del tema viene conservata e ripristinata quando disattivi l'opzione.

### Barra laterale

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Stile della barra laterale | Come vengono incorniciate la barra laterale e la barra delle aree di lavoro. **Altezza piena** le affianca al bordo della finestra con un sottile divisore, come le barre laterali di macOS; **Scheda** le fa fluttuare nella finestra con angoli arrotondati e un'ombra. Vale anche per la finestra delle impostazioni | Altezza piena | Altezza piena, Scheda |

### Finestra

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Mostra nome file nella barra del titolo | Visualizza il nome del file corrente nella barra del titolo della finestra macOS. **Solo macOS** — questa impostazione è nascosta altrove, perché Windows e Linux mostrano sempre il nome del file nella barra del titolo di sistema | Off |

Su macOS, VMark disegna la propria barra del titolo sopra quella di sistema, quindi
il nome del file è un elemento facoltativo di quella striscia. Su Windows e Linux il
sistema disegna una vera barra del titolo sopra la finestra: il nome del file (con
un `•` finché ci sono modifiche non salvate) compare sempre lì, e VMark non
aggiunge alcuna striscia del titolo propria.

### Modalità focus

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Livello di attenuazione | Quanto viene attenuato il contenuto non a fuoco nella Modalità focus. **Standard** mantiene l'attenuazione predefinita basata solo sul colore; **Forte** e **Più forte** aggiungono in sovrapposizione un'opacità progressivamente più bassa | Standard | Standard, Forte, Più forte |

## Editor

Tipografia, display, comportamento di modifica, spazi bianchi e impostazioni per i file di grandi dimensioni.

### Tipografia

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Font Latino | Famiglia di font per il testo latino (inglese) | Predefinito di Sistema | Predefinito di Sistema, Athelas, Palatino, Georgia, Charter, Literata — più qualsiasi font installato |
| Font CJK | Famiglia di font per testo cinese, giapponese, coreano | Predefinito di Sistema | Predefinito di Sistema, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans — più qualsiasi font installato |
| Font Mono | Famiglia di font per codice e testo monospaziato — usata anche dal terminale integrato | Predefinito di Sistema | Predefinito di Sistema, SF Mono, Monaco, Menlo, Consolas, DejaVu Sans Mono, Liberation Mono, Ubuntu Mono, Noto Sans Mono, Noto Sans Mono CJK SC, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata — più qualsiasi font installato |
| Dimensione Font | Dimensione base del font per il contenuto dell'editor | 18px | 14px, 16px, 18px, 20px, 22px |
| Interlinea | Spaziatura verticale tra le righe | 1.8 (Rilassata) | 1.4 (Compatta), 1.6 (Normale), 1.8 (Rilassata), 2.0 (Spaziosa), 2.2 (Extra) |
| Spaziatura Blocchi | Spazio visivo tra gli elementi a blocco (intestazioni, paragrafi, elenchi) misurato in multipli dell'interlinea | 1x (Normale) | 0.5x (Stretta), 1x (Normale), 1.5x (Rilassata), 2x (Spaziosa) |
| Spaziatura tra Lettere CJK | Spaziatura extra tra i caratteri CJK, in unità em | Off | Off, 0.02em (Sottile), 0.03em (Leggera), 0.05em (Normale), 0.08em (Ampia), 0.10em (Più Ampia), 0.12em (Extra) |

#### Usare un font installato da te

I nomi elencati sopra sono una selezione, non un limite. Ciascuno dei tre selettori
di font contiene anche una sezione **Font installati** che elenca ogni famiglia di
font presente sulla macchina, così un carattere che hai installato — LXGW WenKai,
Iosevka, Source Han Serif — si sceglie allo stesso modo di quelli predefiniti.

Scegli **Personalizzato…** in fondo all'elenco per digitare invece il nome di una
famiglia. Usa il nome esattamente come lo riporta il sistema (macOS: Libro
Font; Windows: Impostazioni → Personalizzazione → Tipi di carattere) — per LXGW
WenKai / 霞鹜文楷 è `LXGW WenKai`. Il font viene applicato non appena il nome è
completo; se non cambia nulla, il nome non corrisponde a una famiglia installata.
Un nome che contiene virgolette, virgole, punti e virgola o parentesi viene
rifiutato, e la riga lo segnala.

::: tip Font installati è solo per macOS
macOS elenca per te ogni famiglia installata. Su Windows e Linux la sezione è vuota
e **Personalizzato…** è la via d'accesso — digitare il nome della famiglia funziona
in modo identico su tutte e tre le piattaforme.
:::

La scelta si estende all'esportazione PDF, che esegue il rendering con lo stesso
motore e gli stessi font. L'esportazione HTML non può includere un font dalla tua
macchina, quindi una pagina esportata ripiega sui font del lettore, a meno che
questi non abbia installata la stessa famiglia.

### Display

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Larghezza Editor | Larghezza massima del contenuto. Valori più ampi si addicono ai monitor grandi; valori più stretti migliorano la leggibilità | 50em (Medio) | 36em (Compatto), 42em (Stretto), 50em (Medio), 60em (Ampio), 80em (Extra Ampio), Illimitato |

::: tip La stessa larghezza si legge diversamente in latino e in CJK
La Larghezza Editor si misura in `em`, quindi la lunghezza della riga in *caratteri* dipende dalla scrittura: a 50em una riga latina contiene circa 90–100 caratteri (circa il doppio della misura tipografica di 45–75 caratteri, adatta a un editor a due riquadri), mentre una riga CJK contiene circa 50 caratteri a larghezza intera — esattamente nell'intervallo tradizionale di 40–60 per il testo cinese. Se scrivi soprattutto prosa latina e vuoi una misura da libro, scegli 36–42em; per documenti prevalentemente CJK il valore predefinito è già la misura classica.
:::

::: tip
50em con dimensione font di 18px è circa 900px — una larghezza di lettura comoda per la maggior parte dei display.
:::

### Comportamento

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Dimensione Tab | Numero di spazi inseriti quando si preme Tab | 2 spazi | 2 spazi, 4 spazi |
| Apri i file in una nuova scheda | Apre i file esistenti in una nuova scheda invece di riutilizzare la scheda vuota corrente | Off | Attivo / Off |
| Abilita auto-accoppiamento | Inserisce automaticamente la parentesi/virgoletta di chiusura corrispondente quando ne digiti una di apertura | Attivo | Attivo / Off |
| Parentesi CJK | Auto-accoppiamento di parentesi specifiche CJK come `「」` `【】` `《》`. Disponibile solo quando l'auto-accoppiamento è abilitato | Auto | Off, Auto |
| Includi virgolette curve | Auto-accoppiamento di `“”` e `‘’`, e trasformazione di un `"` o `'` dritto digitato in una coppia curva. Potrebbe entrare in conflitto con alcune funzionalità di virgolette intelligenti degli IME. Appare quando le parentesi CJK sono impostate su Auto | Attivo | Attivo / Off |
| Accoppia anche `"` | Digitare la virgoletta doppia destra `"` inserisce anche una coppia `""`. Utile quando il tuo IME alterna tra virgolette aperte e chiuse. Appare quando le virgolette curve sono abilitate | Off | Attivo / Off |
| Formato copia | Il formato da usare per il segnaposto degli appunti di testo normale quando si copia dalla modalità WYSIWYG | Testo normale | Testo normale, Markdown |
| Copia alla selezione | Copia automaticamente il testo negli appunti ogni volta che lo selezioni | Off | Attivo / Off |

### Spazi Bianchi

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Fine riga al salvataggio | Controlla come vengono gestite le terminazioni di riga quando si salvano i file | Preserva esistente | Preserva esistente, LF (`\n`), CRLF (`\r\n`) |
| Le interruzioni di riga diventano interruzioni rigide | Tratta i singoli ritorni a capo all'interno di un paragrafo come interruzioni rigide (non influisce sulle righe vuote tra i blocchi) | Off | Attivo / Off |
| Preserva interruzioni di riga consecutive | Mantieni più righe vuote così come sono invece di comprimerle | Attivo | Attivo / Off |
| Stile interruzione rigida al salvataggio | Come vengono rappresentate le interruzioni di riga rigide nel file Markdown salvato | Preserva esistente | Due spazi (Consigliato), Preserva esistente, Barra rovesciata (`\`) |
| Mostra tag `<br>` | Visualizza i tag di interruzione di riga HTML visibilmente nell'editor | Off | Attivo / Off |
| Mostra invisibili | Visualizza gli spazi bianchi: spazi come `·`, tabulazioni come `→` (solo Sorgente), interruzioni morbide come `↓` (solo Sorgente), interruzioni rigide come `⏎`. Nascosti in stampa. Attiva/disattiva: `F3` oppure Vista → Mostra invisibili. | Off | Attivo / Off |

::: tip
Due spazi è lo stile di interruzione rigida più compatibile — funziona su GitHub, GitLab e tutti i principali renderer Markdown. Lo stile con barra rovesciata potrebbe non funzionare su Reddit, Jekyll e alcuni parser più vecchi.
:::

### File di grandi dimensioni

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Modalità Sorgente automatica | Apri i file di grandi dimensioni in modalità Sorgente — file oltre 1 MB o Markdown con 1.200+ blocchi stimati (salta WYSIWYG per mantenere prestazioni fluide). Puoi passare a WYSIWYG dalla barra di stato in qualsiasi momento | Attivo | Attivo / Off |
| Avvisa sopra la dimensione | Mostra una richiesta di conferma prima di aprire file oltre 5 MB. I file di 50 MB o più vengono sempre rifiutati | Attivo | Attivo / Off |

Vedi [File di grandi dimensioni](/it/guide/large-files) per la suddivisione completa di come vengono gestiti i file di grandi dimensioni.

## Markdown

Comportamento dell'incolla, layout e impostazioni di rendering HTML.

### Incolla e Input

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Abilita regex nella ricerca | Mostra un pulsante toggle regex nella barra Trova e Sostituisci | Attivo | Attivo / Off |
| Modalità di incolla | Come viene elaborato il contenuto degli appunti quando si incolla. **Smart** converte l'HTML in Markdown e rileva la sintassi Markdown; **Plain** incolla sempre testo normale; **Rich** mantiene la formattazione HTML originale | Smart | Smart, Plain, Rich |
| Incolla Markdown in WYSIWYG | Quando si incolla testo che sembra Markdown nell'editor WYSIWYG, convertilo automaticamente in contenuto formattato | Auto | Auto, Off |

### Layout

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Dividi sorgente/anteprima per impostazione predefinita | Apre i file Markdown con la vista divisa sorgente + anteprima dal vivo affiancate (altrimenti WYSIWYG). Si attiva/disattiva per sessione con `Shift + F6` o **Vista → Vista divisa Markdown** | Off | Attivo / Off |
| Dimensione font elementi a blocco | Dimensione relativa del font per elenchi, citazioni, tabelle, avvisi e blocchi dettagli | 100% | 100%, 95%, 90%, 85% |
| Allineamento intestazioni | Allineamento del testo per le intestazioni. Solo nell'editor — non applicato a esportazione o stampa | Sinistra | Sinistra, Centro |
| Bordi immagini e diagrammi | Se mostrare un bordo attorno alle immagini, ai diagrammi Mermaid e ai blocchi matematici. Solo nell'editor — non applicato a esportazione o stampa | Nessuno | Nessuno, Sempre, Al passaggio |
| Allineamento immagini e tabelle | Allineamento orizzontale per le immagini a blocco e le tabelle. Solo nell'editor — non applicato a esportazione o stampa | Centro | Centro, Sinistra |
| Adatta tabelle alla larghezza | Limita tutte le tabelle alla larghezza dell'editor invece di consentire lo scorrimento orizzontale | Off | Attivo / Off |
| Numeri di riga nei blocchi di codice | Mostra i numeri di riga all'interno dei blocchi di codice nell'editor WYSIWYG. Indipendente da **Numeri riga** del menu Vista, che controlla il margine dell'editor Sorgente/Diviso | Off | Attivo / Off |

### Lint

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Abilita markdown lint | Controlla problemi markdown comuni (link non funzionanti, testo alt mancante, incrementi intestazioni, blocchi di codice non chiusi, ecc.) | Attivo | Attivo / Off |

Vedi [Lint markdown](/it/guide/lint) per l'elenco completo delle regole e i livelli di gravità.

### Rendering HTML

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| HTML grezzo nel testo formattato | Controlla se i blocchi HTML grezzi vengono renderizzati in modalità WYSIWYG | Sanitizzato | Nascosto, Sanitizzato, Sanitizzato + stili |
| Tag HTML consentiti | Quanto è ampio l'insieme di tag renderizzati | Rigoroso | Rigoroso, Esteso |
| Consenti anche questi tag | Nomi di tag aggiuntivi da consentire, separati da virgole | _(vuoto)_ | es. `kbd, samp, var` |

::: tip
**Nascosto** comprime l'HTML grezzo e non renderizza nulla. **Sanitizzato** renderizza HTML con tag pericolosi rimossi. **Sanitizzato + stili** preserva inoltre un sottoinsieme sicuro degli attributi `style` inline.

**Rigoroso** consente un insieme di tag ridotto e prudente. **Esteso** renderizza inoltre `<svg>` (e i suoi elementi figli sicuri), `<figure>`/`<figcaption>`, `<details>`/`<summary>` e altri tag semantici/strutturali — sempre sanitizzati. Usa **Consenti anche questi tag** per aggiungere specifici tag extra (ad es. `kbd, samp, var`).
:::

::: warning
Indipendentemente da queste impostazioni, i tag pericolosi (`<script>`, `<style>`, `<iframe>`, `<form>`, gestori di eventi, …) vengono **sempre** rimossi — il campo dei tag personalizzati non può riabilitarli. L'ampiezza dell'elenco consentito influisce solo sull'anteprima WYSIWYG; l'HTML grezzo nel tuo file non viene mai modificato.
:::

## File e Immagini

Browser file, salvataggio, cronologia documenti, gestione immagini e strumenti documento.

### Area di lavoro

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Barra delle aree di lavoro | Mostra la barra degli spazi di lavoro a sinistra e tiene più workspace e file sparsi in un'unica finestra | Off |

Vedi [Barra degli spazi di lavoro](/it/guide/workspace-rail) per ciò che la barra aggiunge.

### Browser File

Le prime due impostazioni si applicano solo quando un workspace (cartella) è aperto, e
vengono salvate per ogni workspace.

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Mostra file nascosti | Includi dotfile e elementi di sistema nascosti nella barra laterale dell'esplora file | Off |
| Mostra tutti i file | Mostra i file non-markdown nell'esplora file. I file non-markdown si aprono con l'applicazione predefinita del sistema | Off |
| Mostra le estensioni dei file | Mostra il nome completo del file — `notes.md`, non `notes` — nella barra laterale, nella barra delle schede e nella barra del titolo. Vale ovunque, con o senza workspace | Attivo |

Disattivare **Mostra le estensioni dei file** nasconde solo le estensioni che VMark
riconosce. Un file che non può aprire mantiene comunque il suo suffisso, così il nome
che vedi esiste sempre su disco.

### Comportamento all'Uscita

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Conferma uscita | Richiedere di premere `Cmd+Q` (o `Ctrl+Q`) due volte per uscire, prevenendo uscite accidentali | Attivo |
| Riduci nell’area di notifica alla chiusura | **Solo Windows.** Chiudere l'ultima finestra mantiene VMark in esecuzione nell'area di notifica invece di uscire | Off |

**Riduci nell’area di notifica alla chiusura** cambia solo l'*ultima* finestra. Con più finestre aperte, chiuderne una la chiude comunque; è la chiusura finale — quella che prima faceva uscire da VMark — che ora lo parcheggia nell'area di notifica. Non viene chiuso nulla, quindi il lavoro non salvato resta esattamente dove l'hai lasciato.

- **Clic sinistro** sull'icona nell'area di notifica per riportare in primo piano VMark.
- **Clic destro** per **Mostra VMark** ed **Esci da VMark**. Uscire dall'area di notifica riporta prima in primo piano la finestra, così qualsiasi richiesta sulle modifiche non salvate compare dove puoi rispondere.
- `Ctrl+Q` esce comunque come di consueto.
- Disattivare l'impostazione mentre VMark è nell'area di notifica riporta in primo piano la finestra prima che l'icona scompaia, così VMark non può mai restare in esecuzione senza finestra né icona.

L'impostazione non compare su macOS né su Linux.

### Salvataggio

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Abilita salvataggio automatico | Salva automaticamente i file dopo la modifica | Attivo | Attivo / Off |
| Inserisci il blocco identità al salvataggio | Consente a VMark di inserire un blocco identità `vmark:` nel frontmatter di un file e di creare una cartella `.vmark` nello spazio di lavoro, così che il livello di coerenza possa seguire il documento. Vale per ogni scrittura: salvataggi, modifiche di IA e MCP, ripristini di versioni precedenti e nuovi file. Se disattivata, non viene inserito nulla né creata alcuna cartella `.vmark`; uno spazio di lavoro che ne ha già una continua a registrare le modifiche ai documenti che segue — un documento che ha già registrato in precedenza, o uno che porta già una propria identità `vmark:`, come un file già seguito che hai spostato o recuperato con un checkout. Vedi [Coerenza](/it/guide/coherence) | Off | Attivo / Off |
| Intervallo di salvataggio | Tempo tra i salvataggi automatici. Disponibile solo quando il salvataggio automatico è abilitato | 30 secondi | 10s, 30s, 1 min, 2 min, 5 min |
| Mantieni cronologia documenti | Traccia le versioni dei documenti per annullamento e recupero | Attivo | Attivo / Off |
| Versioni massime | Numero di snapshot di cronologia da mantenere per documento | 50 versioni | 10, 25, 50, 100 |
| Mantieni versioni per | Età massima degli snapshot di cronologia prima di essere eliminati | 7 giorni | 1 giorno, 7 giorni, 14 giorni, 30 giorni |
| Finestra di unione | I salvataggi automatici consecutivi all'interno di questa finestra si consolidano in un unico snapshot, riducendo il rumore dello storage | 30 secondi | Off, 10s, 30s, 1 min, 2 min |
| Dimensione massima file per la cronologia | Salta gli snapshot di cronologia del salvataggio automatico per i file più grandi di questa soglia. I salvataggi manuali, i salvataggi MCP e la copia di sicurezza fatta prima di ripristinare una versione vengono sempre conservati | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Illimitato |

### Immagini

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Ridimensiona automaticamente all'incolla | Ridimensiona automaticamente le immagini grandi prima di salvarle nella cartella assets. Il valore è la dimensione massima in pixel | Off | Off, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copia nella cartella assets | Copia le immagini incollate o trascinate nella cartella assets del documento invece di incorporarle | Attivo | Attivo / Off |
| Pulisci immagini inutilizzate alla chiusura | Elimina automaticamente le immagini dalla cartella assets che il documento non referenzia più. Viene eseguita alla chiusura del documento, della finestra o dell'applicazione. Le immagini ancora referenziate da un altro documento nella stessa cartella vengono conservate, e quelle rimosse finiscono nel cestino di sistema | Off | Attivo / Off |

::: tip
Abilita **Ridimensiona automaticamente all'incolla** se incolla frequentemente screenshot o foto — mantiene leggera la cartella assets senza ridimensionamento manuale.
:::

### Strumenti Documento

VMark rileva [Pandoc](https://pandoc.org) per abilitare l'esportazione in formati aggiuntivi (DOCX, EPUB, LaTeX e altro). Fai clic su **Rileva** per cercare Pandoc nel sistema. Se trovato, vengono visualizzati la sua versione e il percorso.

Vedi [Esportazione e Stampa](/it/guide/export) per i dettagli su tutte le opzioni di esportazione.

## Integrazioni

Configurazione del server MCP e del provider IA.

### Server MCP

Il server MCP (Model Context Protocol) consente agli assistenti IA esterni come Claude Code e Cursor di controllare VMark in modo programmatico.

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Abilita Server MCP | Avvia o ferma il server MCP. Quando è in esecuzione, un badge di stato mostra la porta e i client connessi | Attivo (toggle) |
| Avvia all'avvio | Avvia automaticamente il server MCP all'apertura di VMark | Attivo |
| Approva automaticamente i salvataggi in una nuova posizione e i risultati dei geni | Consente a un client MCP di salvare un documento in una nuova posizione senza chiedere, e a un genio di applicare direttamente il suo risultato invece di mostrare un'anteprima. Se disattivata, una richiesta MCP di salvare in un nuovo percorso viene rifiutata e un toast te lo notifica. Le scritture di documenti via MCP non dipendono mai da questa impostazione — ognuna viene registrata nella cronologia delle modifiche degli agenti e può essere ripristinata dalla cronologia scritture MCP nella barra di stato | Off |

Quando il server è in esecuzione, il pannello mostra anche:
- **Porta** — assegnata automaticamente; i client IA la scoprono tramite il file di configurazione
- **Versione** — versione del sidecar del server MCP
- **Strumenti / Risorse** — numero di strumenti e risorse MCP disponibili
- **Client Connessi** — numero di client IA attualmente connessi

Sotto la sezione Server MCP, puoi installare la configurazione MCP di VMark nei client IA supportati (Claude Desktop, Claude Code, Codex CLI, Gemini CLI) con un singolo clic.

Vedi [Configurazione MCP](/it/guide/mcp-setup) e [Riferimento Strumenti MCP](/it/guide/mcp-tools) per i dettagli completi.

### Provider IA

Configura quale provider IA alimenta i [Genies IA](/it/guide/ai-genies). È attivo un solo provider alla volta.

**Provider CLI** — Usa strumenti CLI IA installati localmente (Claude, Codex, Gemini). Fai clic su **Rileva** per cercare i CLI disponibili nel tuo `$PATH`. I provider CLI usano il tuo piano di abbonamento e non richiedono una chiave API.

**Provider API REST** — Connettiti direttamente a un'API: Anthropic, OpenAI, un servizio **compatibile con OpenAI** (DeepSeek, Groq, OpenRouter, …), Google AI o un server Ollama locale (Ollama API). Ognuno richiede il nome del modello e una chiave API — tranne Ollama, per cui la chiave è facoltativa. Tutti tranne Google AI accettano anche un endpoint, precompilato quando il provider ne ha uno standard (lo slot compatibile con OpenAI non ne ha, quindi lo inserisci tu).

Vedi [Provider IA](/it/guide/ai-providers) per le istruzioni di configurazione dettagliate per ogni provider.

## Formati

Toggle di attivazione per gli adattatori di formato non predefiniti, più il comando esplicito per l'editor esterno usato come via d'uscita dalle schede di codice in sola lettura.

Markdown, testo normale e YAML/YML sono **sempre** registrati — le impostazioni predefinite. Tutti gli altri adattatori sono **disattivati per impostazione predefinita** in modo che gli utenti esistenti non siano sorpresi dall'aggiornamento. Attiva un toggle e il registro si ricostruisce in loco; le schede aperte si rimontano con l'adattatore appropriato, senza necessità di riavvio.

Per l'elenco completo dei formati e delle loro anteprime, vedi [Formati Supportati](/it/guide/formats).

### Supporto dei formati

| Toggle | Predefinito | Abilita |
|---|---|---|
| **Formati dati** | Off | `.json`, `.jsonl`, `.toml` — riquadro sorgente + albero navigabile. Anteprime contestuali per `Cargo.toml`, `package.json`, `pyproject.toml`. |
| **Diagrammi e SVG** | Off | `.mmd` (Mermaid) e `.svg` — riquadro sorgente + rendering live sanitizzato. |
| **Anteprima HTML** | Off | `.html` e `.htm` — anteprima iframe in sandbox (`sandbox=""` lista autorizzazioni vuota, DOMPurify, CSP `<meta>`). La sua approvazione di sicurezza è ancora in sospeso, e l'anteprima lo indica — vedi [Modello di sicurezza per HTML](/it/guide/formats#modello-di-sicurezza-per-html). |
| **Visualizzatori di codice** | Off | 12 visualizzatori in sola lettura (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Si apre in un visualizzatore con evidenziazione della sintassi con i pulsanti **Abilita modifica** e **Apri nell'editor esterno**. |

Quando una categoria è disattivata, le estensioni corrispondenti ricadono sul fallback in testo normale — il file si apre comunque, ma senza la vista schema.

### Modalità di visualizzazione predefinita

I file con anteprima (HTML, SVG, Mermaid, JSON, YAML, TOML) si aprono in una di tre
[modalità di visualizzazione](/it/guide/formats#modalita-di-visualizzazione-sorgente-diviso-anteprima):

| Opzione | Risultato |
|---|---|
| **Sorgente** | Riquadro sorgente modificabile, a larghezza piena. |
| **Diviso** (predefinito) | Sorgente e anteprima affiancate. |
| **Anteprima** | Rendering in sola lettura, a larghezza piena. |

È il valore predefinito per le schede appena aperte; ogni scheda ricorda la propria
scelta, e puoi cambiare qualsiasi scheda con l'interruttore a schermo oppure con
`F6` / `Shift + F6`.

### Editor esterno

Per il pulsante **Apri in un editor esterno** nelle schede di codice in sola lettura, scegli l'editor che deve essere avviato: il nome di un editor noto (`code`, `zed`, `subl`, `vim`, …) oppure il percorso completo di un bundle app (es. `/Applications/Visual Studio Code.app`) o di un eseguibile. Shell, interpreti ed emulatori di terminale vengono rifiutati, così come un percorso che non esiste.

L'impostazione GUI sostituisce qualsiasi variabile d'ambiente — l'esplicito supera l'implicito. Lasciala vuota per usare la catena di fallback `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → predefinito di piattaforma`. Vedi [Apri nell'editor esterno](/it/guide/formats#apri-nell-editor-esterno) per l'ordine di risoluzione completo e il controllo di sicurezza.

### Notifica di aggiornamento una tantum

Al primo avvio dopo l'aggiornamento al supporto multi-formato, VMark mostra un toast non bloccante che punta a **Impostazioni → Formati**. La notifica appare una sola volta per installazione — una volta mostrata (o ignorata), non riappare mai più.

### Sostituzioni per tipo di file

Oltre ai toggle per categoria, puoi sostituire il modo in cui si apre una singola famiglia di file tramite la palette dei comandi — **Imposta tipo di file: Testo semplice / Markdown / Ripristina predefinito**. Le sostituzioni sono memorizzate per famiglia di file (per estensione, oppure per radice del dotfile per file come `.env`) e persistono tra le sessioni. Vedi [Come VMark determina il tipo di un file](/it/guide/formats#come-vmark-determina-il-tipo-di-un-file).

Il pannello **Formati** elenca ogni sostituzione che hai impostato, ciascuna come `key → format`. Rimuovi una singola voce con il suo pulsante `×`, oppure usa **Cancella tutto** per eliminarle tutte in una volta — le voci rimosse tornano alla regola integrata.

## Lingua

La lingua dell'interfaccia e le regole di formattazione CJK (cinese, giapponese, coreano).

### Lingua dell'interfaccia

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Lingua dell'interfaccia | Cambia la lingua dell'interfaccia per menu, etichette e messaggi. Ha effetto immediato | Lingua di sistema | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

Al primo avvio VMark sceglie la prima lingua dell'elenco delle lingue preferite del sistema tra quelle che include, e ripiega sull'inglese se nessuna corrisponde. Una volta scelta una lingua qui, la tua scelta viene mantenuta.

### Formattazione CJK

Le regole seguenti vengono applicate quando esegui **Formato → CJK → Formatta selezione** (`Cmd+Shift+F`) su una selezione, o **Formato → CJK → Formatta intero file** (`Alt+Cmd+Shift+F`) sull'intero file.

::: tip
La sezione Lingua contiene oltre 20 toggle di formattazione granulari. Per una spiegazione completa di ogni regola con esempi, vedi [Formattazione CJK](/it/guide/cjk-formatting).
:::

### Normalizzazione a Larghezza Intera

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Converti lettere/numeri a larghezza intera | Converti i caratteri alfanumerici a larghezza intera in mezza larghezza (es. `ＡＢＣ` in `ABC`) | Attivo |
| Normalizza larghezza punteggiatura | Converti virgole e punti a larghezza intera in mezza larghezza tra caratteri CJK | Attivo |
| Converti parentesi | Converti le parentesi a larghezza intera in mezza larghezza quando il contenuto è CJK | Attivo |
| Converti parentesi quadre | Converti le parentesi quadre a mezza larghezza in `【】` a larghezza intera quando il contenuto è CJK | Off |

### Spaziatura

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Aggiungi spaziatura CJK-inglese | Inserisci uno spazio tra caratteri CJK e latini | Attivo |
| Aggiungi spaziatura CJK-parentesi | Inserisci uno spazio tra caratteri CJK e parentesi | Attivo |
| Rimuovi spaziatura valute | Rimuovi lo spazio extra dopo i simboli di valuta (es. `$ 100` diventa `$100`) | Attivo |
| Rimuovi spaziatura barre | Rimuovi gli spazi intorno alle barre (es. `A / B` diventa `A/B`), preservando gli URL | Attivo |
| Comprimi spazi multipli | Riduci più spazi consecutivi a un singolo spazio | Attivo |

### Trattini e Virgolette

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Converti trattini | Converti i doppi trattini (`--`) in em-dash (`——`) tra caratteri CJK | Attivo |
| Correggi spaziatura em-dash | Assicura la spaziatura corretta intorno agli em-dash | Attivo |
| Converti virgolette dritte | Converti le virgolette dritte `"` e `'` in virgolette tipografiche (curve) | Attivo |
| Stile virgolette | Stile target per la conversione delle virgolette tipografiche | Curve `""` `''` |
| Virgolette contestuali | Usa virgolette curve attorno al testo CJK ma mantieni le virgolette dritte nel testo puramente latino. Disponibile solo quando Converti virgolette dritte è attivo | Attivo |
| Comportamento del cambio virgolette | Come il comando di cambio stile virgolette scorre tra gli stili — **Semplice** alterna dritte ↔ il tuo stile preferito; **Ciclo completo** passa a rotazione tra tutti gli stili | Semplice |
| Correggi spaziatura virgolette doppie | Normalizza la spaziatura intorno alle virgolette doppie | Attivo |
| Correggi spaziatura virgolette singole | Normalizza la spaziatura intorno alle virgolette singole | Attivo |
| Virgolette a forcella CJK | Converti le virgolette curve in parentesi a forcella `「」` per testo cinese tradizionale e giapponese. Disponibile solo quando lo stile virgolette è Curve | Off |
| Virgolette a forcella annidate | Converti le virgolette singole annidate in `『』` all'interno di `「」` | Off |

### Gestione delle sezioni

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Salta le sezioni di riferimento | Lascia non formattate le sezioni `## References` e `## Further Reading` quando esegui la formattazione CJK — utile per i documenti accademici in cui il testo delle citazioni deve restare alla lettera | Off | Attivo / Off |

### Pulizia

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Limita punteggiatura consecutiva | Limita i segni di punteggiatura ripetuti come `!!!` | Off | Off, Singolo (`!!` diventa `!`), Doppio (`!!!` diventa `!!`) |
| Rimuovi spazi finali | Rimuovi gli spazi alla fine delle righe | Attivo | Attivo / Off |
| Normalizza puntini di sospensione | Converti i punti spaziati (`. . .`) in puntini di sospensione corretti (`...`) | Attivo | Attivo / Off |
| Comprimi newline | Riduci tre o più newline consecutive a due | Off | Attivo / Off |

## Scorciatoie

Visualizza e personalizza tutte le scorciatoie da tastiera. Le scorciatoie sono raggruppate per categoria (File, Modifica, Vista, Formato, ecc.).

- **Cerca** — Filtra le scorciatoie per nome, categoria o combinazione di tasti
- **Fai clic su una scorciatoia** per cambiare la sua combinazione di tasti. Premi la nuova combinazione, poi conferma
- **Ripristina** — Ripristina una singola scorciatoia al suo predefinito, o ripristina tutte in una volta
- **Esporta / Importa** — Salva le tue associazioni personalizzate come file JSON e importale su un'altra macchina

Vedi [Scorciatoie da Tastiera](/it/guide/shortcuts) per il riferimento completo alle scorciatoie predefinite.

## Terminale

Configura il pannello terminale integrato. Apri il terminale con `` Ctrl + ` ``.

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Shell | Quale shell usare. Richiede il riavvio del terminale per avere effetto. Una shell salvata che non è più disponibile viene mostrata come *(non disponibile)* e viene usata quella predefinita | Predefinito di Sistema | Shell rilevate automaticamente nel sistema (es. zsh, bash, fish) |
| Posizione Pannello | Dove posizionare il pannello del terminale | Auto | Auto (basato sul rapporto d'aspetto della finestra), In alto, In basso, A sinistra, A destra |
| Dimensione Pannello | Proporzione dello spazio disponibile occupata dal terminale. Il trascinamento del pannello aggiorna anche questo valore | 40% | dal 10% all'80% |
| Dimensione Font | Dimensione del testo nel terminale | 13px | da 10px a 24px |
| Interlinea | Spaziatura verticale tra le righe del terminale | 1.2 (Compatta) | da 1.0 (Stretta) a 2.0 (Extra) |
| Stile Cursore | Forma del cursore del terminale | Barra | Barra, Blocco, Sottolineato |
| Cursore Lampeggiante | Se il cursore del terminale lampeggia | Attivo | Attivo / Off |
| Copia alla Selezione | Copia automaticamente il testo selezionato nel terminale negli appunti | Off | Attivo / Off |
| Visualizza automaticamente le trascrizioni | Mostra Markdown, tabelle e diagrammi Mermaid di Claude/Codex accanto alla CLI del terminale. Aggiunge un hook SessionStart locale alla configurazione di Claude Code e Codex; riavvia le sessioni CLI attive dopo l'attivazione | Off | Attivo / Off |
| Renderer WebGL | Usa il rendering con accelerazione GPU per il terminale. Disabilita se si verificano problemi di input IME. Richiede il riavvio del terminale. Solo macOS e Windows — Linux usa sempre il renderer DOM | Attivo | Attivo / Off |
| Appunti remoti (OSC 52) | Consente ai programmi in esecuzione nel terminale — via ssh, dentro tmux — di copiare negli appunti di sistema. Il canale è di sola scrittura: la lettura degli appunti è sempre rifiutata, poiché qualsiasi output stampato nel terminale potrebbe richiederla | Attivo | Attivo / Off |
| Cronologia di scorrimento | Numero di righe di output che ogni sessione conserva nella cronologia di scorrimento. Valori più alti usano più memoria | 5.000 | 1.000 / 5.000 / 10.000 / 50.000 |
| Modalità screen reader | Rende l'output del terminale accessibile alle tecnologie assistive (VoiceOver). Disattivata per impostazione predefinita per motivi di prestazioni | Off | Attivo / Off |

Qui compaiono anche due interruttori specifici della piattaforma, entrambi attivi per impostazione predefinita: **Option come tasto Meta** (solo macOS — tratta il tasto Option come Meta, come si aspettano strumenti quali emacs e tmux per le scorciatoie con prefisso `Alt` e la navigazione per parole; disattivalo se ti servono i tasti morti di Option per gli accenti, come `Option + E`) e **Integrazione della shell** (nascosto su Windows — inserisce marcatori di comando in zsh e bash per la navigazione tra i prompt, gli indicatori dello stato di uscita e il tracciamento della cartella corrente; si applica alle nuove sessioni del terminale).

### Accessibilità

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Campanello del terminale | Come viene segnalato un campanello del terminale (BEL). **Visivo** segnala l'attività in background sulla scheda della sessione; **Sonoro** riproduce un leggero segnale acustico e (per una sessione in background) contrassegna anche la scheda così puoi trovarla; **Disattivato** lo ignora. Si applica subito alle sessioni in esecuzione | Visivo | Disattivato, Visivo, Sonoro |
| Notifica quando non a fuoco | Mostra una notifica di sistema (con il nome del documento della finestra) quando un terminale fa suonare il campanello mentre quella finestra di VMark non è a fuoco — ad es. Claude Code che completa un turno. Ti consente di seguire Claude Code in più finestre senza tenerle d'occhio una per una. Richiede di concedere il permesso per le notifiche al primo utilizzo | Attivo | Attivo / Off |
| Contrasto minimo | Porta il testo sbiadito del terminale a un rapporto di contrasto minimo rispetto allo sfondo. Aumentalo per la leggibilità; **Disattivato** disabilita la correzione. Si applica subito alle sessioni in esecuzione | WCAG AA (4,5:1) | Disattivato, WCAG AA (4,5:1), WCAG AAA (7:1), Massimo |

Vedi [Terminale Integrato](/it/guide/terminal) per ulteriori informazioni su sessioni, scorciatoie da tastiera e ambiente shell.

## Informazioni

Visualizza la versione dell'app, i collegamenti al sito web e al repository GitHub e la gestione degli aggiornamenti. Il collegamento **Note di terze parti** apre i testi di licenza del software open source incluso in VMark nell'app predefinita del sistema per i file di testo.

### Aggiornamenti

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Aggiornamenti automatici | Controlla periodicamente la presenza di nuove versioni | Attivo | Attivo / Off |
| Frequenza di controllo | Ogni quanto controllare gli aggiornamenti. Disponibile solo quando gli aggiornamenti automatici sono attivi | All'avvio | All'avvio, Ogni giorno, Ogni settimana, Solo manuale |
| Scarica gli aggiornamenti automaticamente | Scarica le nuove versioni in background quando sono disponibili | Off | Attivo / Off |
| Controlla ora | Attiva manualmente un controllo degli aggiornamenti | — | — |

Quando è disponibile un aggiornamento, appare una scheda che mostra il nuovo numero di versione, la data di rilascio e le note di rilascio. Puoi **Scaricare** l'aggiornamento, **Saltare** questa versione o — una volta scaricato — **Riavvia per aggiornare**.

#### L'aggiornamento corrisponde a come hai installato VMark

Il programma di aggiornamento scarica lo stesso formato di pacchetto che hai installato, non un formato fisso per piattaforma:

| Hai installato | Il programma di aggiornamento scarica |
|---|---|
| `.dmg` per macOS | il bundle dell'app firmato |
| `.exe` per Windows (NSIS) | il programma di installazione `.exe` |
| `.msi` per Windows | il pacchetto `.msi` |
| `.deb` per Linux | il pacchetto `.deb` |
| `.rpm` per Linux | il pacchetto `.rpm` |
| AppImage per Linux | l'AppImage |

Su Linux, aggiornare un'installazione `.deb` o `.rpm` esegue il gestore di pacchetti di sistema, quindi ti viene chiesto di autenticarti — installare un pacchetto di sistema richiede i privilegi di root. Gli aggiornamenti AppImage sostituiscono il file sul posto e non richiedono alcuna conferma.

#### Se un aggiornamento si blocca

Il controllo e il download passano entrambi dalla rete, e una connessione che resta sospesa invece di fallire del tutto potrebbe altrimenti lasciare l'aggiornamento in corso per sempre. Se un controllo non fa progressi per un minuto, o un download o un'installazione per tre minuti, VMark mostra nella finestra del documento una notifica persistente **Aggiornamento bloccato**. Il suo pulsante **Riprova** riporta il programma di aggiornamento allo stato inattivo così puoi riprovare — **Controlla ora** in questa sezione, oppure il successivo controllo automatico, riparte da un controllo nuovo.

L'attività di aggiornamento viene scritta nel file di log, quindi se il problema si ripete vale la pena allegare il log a una segnalazione di bug:

| Piattaforma | Posizione del log |
|---|---|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Ripristino

| Impostazione | Descrizione |
|-------------|-------------|
| Ripristina i valori predefiniti | Riporta le impostazioni di questi pannelli ai valori predefiniti. Compare prima una richiesta di conferma — l'operazione non può essere annullata |

Tre cose sono memorizzate separatamente e **non** vengono ripristinate: le personalizzazioni delle scorciatoie da tastiera (usa **Reimposta tutto** nel pannello [Scorciatoie](#scorciatoie)), la configurazione del provider IA e le impostazioni del browser file per ogni workspace (**Mostra file nascosti**, **Mostra tutti i file**). La lingua dell'interfaccia torna alla lingua di sistema.

## Avanzate

::: tip
La sezione Avanzate è visibile per impostazione predefinita — contiene l'interruttore per disattivare il browser integrato, che è attivo di serie. Premi `Ctrl + Option + Cmd + D` nella finestra Impostazioni per nasconderla, e di nuovo per farla ricomparire.
:::

Configurazione per sviluppatori e a livello di sistema.

### Protocolli Link

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Protocolli link personalizzati | Protocolli URL aggiuntivi che VMark tratta come collegamenti. Inserisci ogni protocollo come tag | `obsidian`, `vscode`, `dict`, `x-dictionary` |

L'elenco ha due effetti. Quando inserisci un collegamento, un URL negli appunti con uno di questi protocolli viene riconosciuto come collegamento, proprio come `https://`. E quando apri un collegamento, VMark lo passa al sistema solo se il suo protocollo è `http`, `https`, `mailto` o uno di questo elenco — così i collegamenti `obsidian://open?vault=...` e `vscode://file/...` si aprono nelle rispettive app, mentre qualsiasi altro protocollo viene rifiutato. Alcuni protocolli non possono mai essere abilitati in questo modo, qualunque cosa dica l'elenco: `javascript:`, `data:`, `file:` e simili.

Un predefinito che rimuovi resta rimosso. Un protocollo predefinito aggiunto in una versione successiva di VMark viene aggiunto al tuo elenco una sola volta, al primo avvio di quella versione.

### Prestazioni

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Mantieni entrambi gli editor attivi | Monta sia l'editor WYSIWYG che quello Sorgente contemporaneamente per un cambio di modalità più veloce. Aumenta l'utilizzo della memoria | Off |

### Coerenza

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Confidenza del controllo semantico | Quanto deve essere sicuro un controllo prima che la sua risposta venga registrata come verdetto. Al di sotto di questa soglia, la risposta viene conservata ma contrassegnata come sconosciuta | 0.9 | 0.7, 0.8, 0.9, 0.95 |

Vedi [Coerenza](/it/guide/coherence) per sapere che cos'è un controllo e come vengono registrati i verdetti.

### File di workflow

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Recupera i metadati delle action | Consente a VMark di recuperare `action.yml` dalle GitHub Actions referenziate per popolare il modulo `with:` dell'editor strutturato. Disattivalo per mantenere l'editor dei workflow completamente offline | Attivo | Attivo / Off |
| Usa actionlint quando disponibile | Se il binario `actionlint` è nel tuo PATH, lo esegue sui file di workflow per una diagnostica più completa. Nessun effetto se il binario non è installato | Attivo | Attivo / Off |

### Workflow

Il visualizzatore di GitHub Actions non ha un interruttore: aprendo un file sotto
`.github/workflows/` compaiono il grafo e l'editor a form, e gli aiuti del riquadro
sorgente (completamento delle espressioni, sincronizzazione tra cursore e canvas, vai
alla definizione per `uses:`) si caricano insieme a essi. Qui restano l'unica preferenza
del visualizzatore e il motore di esecuzione, che è separato.

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Preserva la formattazione YAML | Quando si salvano le modifiche al workflow effettuate tramite il pannello del modulo, preserva i commenti, le ancore, l'ordine delle chiavi e le righe vuote dello YAML originale tramite il pipeline CST round-trip. Quando disattivato, il salvataggio usa un serializzatore compatto (più veloce ma con perdita) | Attivo | Attivo / Off |
| Motore dei workflow | Esegue i file di workflow YAML propri di VMark: un file di workflow si apre con il suo grafo degli step e una barra Esegui / Annulla accanto al sorgente, e i genie del workflow possono essere eseguiti. Gli step possono chiamare i provider di IA e scrivere file, quindi resta disattivato finché non lo richiedi | Off | Attivo / Off |

Il motore non cambia ciò che mostra il visualizzatore: i file di GitHub Actions si aprono
nel visualizzatore in ogni caso, e con il motore disattivato un file di workflow di VMark
viene mostrato come un semplice albero YAML. Con il motore disattivato, VMark inoltre
rifiuta del tutto le richieste di esecuzione dei workflow invece di limitarsi a
nascondere il pulsante — comprese le richieste che arrivano tramite MCP — e segnala «Il
motore dei flussi di lavoro è disattivato nelle impostazioni».

Entrambe le righe si trovano negli **Strumenti sviluppatore** (vedi sotto) — attiva gli
Strumenti sviluppatore per mostrarle. Vedi [Visualizzatore di workflow](/it/guide/workflow-viewer)
per il visualizzatore e [Flussi di lavoro Genie](/it/guide/workflows) per il motore.

### Browser integrato

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Browser integrato | Il browser web interno all'app (solo macOS). Quando è attivo, **Nuova scheda del browser** si trova nel menu File e nella palette dei comandi, e gli strumenti MCP `browser` sono disponibili. Disattivarlo chiude le schede del browser aperte e ritira la superficie di automazione dell'IA | Attivo | Attivo / Off |
| Sessione browser dell'IA | Scegli `Sandbox` (consigliato, cookie dell'IA isolati e non persistenti) oppure `Profilo condiviso` (profilo umano con approvazioni per destinazione) | Sandbox | Sandbox / Profilo condiviso |
| Consenti l'accesso loopback all'IA | Consente la navigazione dell'IA verso localhost e gli indirizzi di loopback. Le reti LAN private, gli indirizzi di metadati e gli intervalli link-local restano bloccati | Off | Attivo / Off |

Queste impostazioni si trovano in **Avanzate → macOS** e compaiono solo su macOS. Le due
righe sulla postura dell'IA compaiono solo mentre l'interruttore del browser è attivo, e
non vengono modificate dalla sua attivazione — restano su Sandbox / loopback bloccato
finché non le cambi. Vedi [Browser integrato](/it/guide/browser) per la superficie
completa delle funzionalità.

### Specifico per piattaforma

| Impostazione | Descrizione | Predefinito | Piattaforme |
|-------------|-------------|-------------|-------------|
| Cancella la quarantena macOS all'apertura | Quando apri uno spazio di lavoro, rimuove l'attributo di quarantena dei download di macOS (`com.apple.quarantine`) dalla cartella dello spazio di lavoro e dai file che VMark può aprire direttamente al suo interno (le sottocartelle non vengono toccate). Senza questa opzione, macOS può ignorare silenziosamente un doppio clic nel Finder su un file scaricato mentre VMark è in esecuzione. Nell'interfaccia appare come **Rimuovi la quarantena dei download all'apertura dello spazio di lavoro**, in **Avanzate → macOS** | Attivo | macOS |

L'impostazione **Option come tasto Meta** del terminale si trova nel pannello [Terminale](#terminale).

### Strumenti per Sviluppatori

**Strumenti sviluppatore** è un interruttore principale persistente per le impostazioni
sperimentali e riservate allo sviluppo. Attivarlo mostra la riga **Preserva la
formattazione YAML**, l'interruttore **Motore dei workflow** e un pannello **Strumenti
sviluppatore Hot Exit** (pulsanti per testare l'acquisizione della sessione, l'ispezione,
il ripristino, la cancellazione e il riavvio). Poiché l'interruttore è persistente, una
funzionalità in sviluppo che abiliti resta raggiungibile tra una sessione e l'altra e
nelle build di rilascio — non devi riattivare gli Strumenti sviluppatore ogni volta che
apri le Impostazioni.

Mostra anche la [Knowledge base](/it/guide/knowledge-base) al di fuori delle
Impostazioni: la voce di menu **Vista → Knowledge base**, il comando della palette e la
scorciatoia `Ctrl + Shift + 4` restano nascosti finché gli Strumenti sviluppatore non
sono attivi, perché nessuna build di rilascio, su nessuna piattaforma, include il
runtime del server di contenuti di cui quella funzionalità ha bisogno.

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Strumenti sviluppatore | Abilita la modalità sviluppatore e mostra le impostazioni sperimentali e riservate allo sviluppo qui sotto | Off |

## Vedi Anche

- [Funzionalità](/it/guide/features) — Panoramica delle capacità di VMark
- [Scorciatoie da Tastiera](/it/guide/shortcuts) — Riferimento completo alle scorciatoie
- [Formattazione CJK](/it/guide/cjk-formatting) — Regole dettagliate di formattazione CJK
- [Terminale Integrato](/it/guide/terminal) — Sessioni e utilizzo del terminale
- [Provider IA](/it/guide/ai-providers) — Guida alla configurazione del provider IA
- [Configurazione MCP](/it/guide/mcp-setup) — Configurazione del server MCP per gli assistenti IA
