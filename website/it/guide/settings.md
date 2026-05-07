# Impostazioni

Il pannello impostazioni di VMark ti consente di personalizzare ogni aspetto dell'editor. Aprilo con `Mod + ,` o tramite **VMark > Impostazioni** nella barra dei menu.

La finestra delle impostazioni ha una barra laterale con le sezioni raggruppate per argomento — le sezioni più usate appaiono per prime, con Informazioni e Avanzate in fondo. Le modifiche hanno effetto immediato — non c'è nessun pulsante di salvataggio.

## Aspetto

Controlla il tema visivo e il comportamento della finestra.

### Tema

Scegli uno dei cinque temi di colore. Il tema attivo è indicato da un anello intorno al suo campione.

| Tema | Sfondo | Stile |
|------|--------|-------|
| White | `#FFFFFF` | Pulito, alto contrasto |
| Paper | `#EEEDED` | Neutro caldo (predefinito) |
| Mint | `#CCE6D0` | Verde morbido, riposante per gli occhi |
| Sepia | `#F9F0DB` | Giallastro caldo, simile a un libro |
| Night | `#23262B` | Modalità scura |

### Lingua

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Lingua | Cambia la lingua dell'interfaccia per menu, etichette e messaggi. Ha effetto immediato | English | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

### Finestra

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Mostra nome file nella barra del titolo | Visualizza il nome del file corrente nella barra del titolo della finestra macOS | Off |
| Nascondi automaticamente la barra di stato | Nascondi automaticamente la barra di stato quando non interagisci con essa | Off |

## Editor

Tipografia, display, comportamento di modifica e impostazioni degli spazi bianchi.

### Tipografia

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Font Latino | Famiglia di font per il testo latino (inglese) | Predefinito di Sistema | Predefinito di Sistema, Athelas, Palatino, Georgia, Charter, Literata |
| Font CJK | Famiglia di font per testo cinese, giapponese, coreano | Predefinito di Sistema | Predefinito di Sistema, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans |
| Font Mono | Famiglia di font per codice e testo monopaziato | Predefinito di Sistema | Predefinito di Sistema, SF Mono, Monaco, Menlo, Consolas, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata |
| Dimensione Font | Dimensione base del font per il contenuto dell'editor | 18px | 14px, 16px, 18px, 20px, 22px |
| Interlinea | Spaziatura verticale tra le righe | 1.8 (Rilassata) | 1.4 (Compatta), 1.6 (Normale), 1.8 (Rilassata), 2.0 (Spaziosa), 2.2 (Extra) |
| Spaziatura Blocchi | Spazio visivo tra gli elementi a blocco (intestazioni, paragrafi, elenchi) misurato in multipli dell'interlinea | 1x (Normale) | 0.5x (Stretta), 1x (Normale), 1.5x (Rilassata), 2x (Spaziosa) |
| Spaziatura tra Lettere CJK | Spaziatura extra tra i caratteri CJK, in unità em | Off | Off, 0.02em (Sottile), 0.03em (Leggera), 0.05em (Normale), 0.08em (Ampia), 0.10em (Più Ampia), 0.12em (Extra) |

### Display

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Larghezza Editor | Larghezza massima del contenuto. Valori più ampi si addicono ai monitor grandi; valori più stretti migliorano la leggibilità | 50em (Medio) | 36em (Compatto), 42em (Stretto), 50em (Medio), 60em (Ampio), 80em (Extra Ampio), Illimitato |

::: tip
50em con dimensione font di 18px è circa 900px — una larghezza di lettura comoda per la maggior parte dei display.
:::

### Comportamento

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Dimensione Tab | Numero di spazi inseriti quando si preme Tab | 2 spazi | 2 spazi, 4 spazi |
| Abilita auto-accoppiamento | Inserisce automaticamente la parentesi/virgoletta di chiusura corrispondente quando ne digiti una di apertura | Attivo | Attivo / Off |
| Parentesi CJK | Auto-accoppiamento di parentesi specifiche CJK come `「」` `【】` `《》`. Disponibile solo quando l'auto-accoppiamento è abilitato | Auto | Off, Auto |
| Includi virgolette curve | Auto-accoppiamento dei caratteri `""` e `''`. Potrebbe entrare in conflitto con alcune funzionalità di virgolette intelligenti degli IME. Appare quando le parentesi CJK sono impostate su Auto | Attivo | Attivo / Off |
| Accoppia anche `"` | Digitare la virgoletta doppia destra `"` inserisce anche una coppia `""`. Utile quando il tuo IME alterna tra virgolette aperte e chiuse. Appare quando le virgolette curve sono abilitate | Off | Attivo / Off |
| Formato copia | Il formato da usare per il segnaposto degli appunti di testo normale quando si copia dalla modalità WYSIWYG | Testo normale | Testo normale, Markdown |
| Copia alla selezione | Copia automaticamente il testo negli appunti ogni volta che lo selezioni | Off | Attivo / Off |

### Spazi Bianchi

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Fine riga al salvataggio | Controlla come vengono gestite le terminazioni di riga quando si salvano i file | Preserva esistente | Preserva esistente, LF (`\n`), CRLF (`\r\n`) |
| Preserva interruzioni di riga consecutive | Mantieni più righe vuote così come sono invece di comprimerle | Off | Attivo / Off |
| Stile interruzione rigida al salvataggio | Come vengono rappresentate le interruzioni di riga rigide nel file Markdown salvato | Preserva esistente | Due spazi (Consigliato), Preserva esistente, Barra rovesciata (`\`) |
| Mostra tag `<br>` | Visualizza i tag di interruzione di riga HTML visibilmente nell'editor | Off | Attivo / Off |

::: tip
Due spazi è lo stile di interruzione rigida più compatibile — funziona su GitHub, GitLab e tutti i principali renderer Markdown. Lo stile con barra rovesciata potrebbe non funzionare su Reddit, Jekyll e alcuni parser più vecchi.
:::

## Markdown

Comportamento dell'incolla, layout e impostazioni di rendering HTML.

### Incolla e Input

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Abilita regex nella ricerca | Mostra un pulsante toggle regex nella barra Trova e Sostituisci | Attivo | Attivo / Off |
| Modalità di incolla | Come VMark instrada il contenuto dagli appunti | Smart | Smart, Plain |
| Incolla Markdown in WYSIWYG | Quando si incolla testo che sembra Markdown nell'editor WYSIWYG, convertilo automaticamente in contenuto formattato | Auto | Auto, Off |

### Layout

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Dimensione font elementi a blocco | Dimensione relativa del font per elenchi, citazioni, tabelle, avvisi e blocchi dettagli | 100% | 100%, 95%, 90%, 85% |
| Allineamento intestazioni | Allineamento del testo per le intestazioni | Sinistra | Sinistra, Centro |
| Bordi immagini e diagrammi | Se mostrare un bordo attorno alle immagini, ai diagrammi Mermaid e ai blocchi matematici | Nessuno | Nessuno, Sempre, Al passaggio |
| Allineamento immagini e tabelle | Allineamento orizzontale per le immagini a blocco e le tabelle | Centro | Centro, Sinistra |

### Lint

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Abilita markdown lint | Controlla problemi markdown comuni (link non funzionanti, testo alt mancante, incrementi intestazioni, blocchi di codice non chiusi, ecc.) | Attivo | Attivo / Off |

Vedi [Lint markdown](/it/guide/lint) per l'elenco completo delle regole e i livelli di gravità.

### Rendering HTML

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| HTML grezzo nel testo formattato | Controlla se i blocchi HTML grezzi vengono renderizzati in modalità WYSIWYG | Nascosto | Nascosto, Sanitizzato, Sanitizzato + stili |

::: tip
**Nascosto** è l'opzione più sicura — i blocchi HTML grezzi vengono compressi e non renderizzati. **Sanitizzato** renderizza HTML con tag pericolosi rimossi. **Sanitizzato + stili** preserva inoltre gli attributi `style` inline.
:::

## File e Immagini

Browser file, salvataggio, cronologia documenti, gestione immagini e strumenti documento.

### Browser File

Queste impostazioni si applicano solo quando un workspace (cartella) è aperto.

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Mostra file nascosti | Includi dotfile e elementi di sistema nascosti nella barra laterale dell'esplora file | Off |
| Mostra tutti i file | Mostra i file non-markdown nell'esplora file. I file non-markdown si aprono con l'applicazione predefinita del sistema | Off |

### Comportamento all'Uscita

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Conferma uscita | Richiedere di premere `Cmd+Q` (o `Ctrl+Q`) due volte per uscire, prevenendo uscite accidentali | Attivo |

### Salvataggio

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Abilita salvataggio automatico | Salva automaticamente i file dopo la modifica | Attivo | Attivo / Off |
| Intervallo di salvataggio | Tempo tra i salvataggi automatici. Disponibile solo quando il salvataggio automatico è abilitato | 30 secondi | 10s, 30s, 1 min, 2 min, 5 min |
| Mantieni cronologia documenti | Traccia le versioni dei documenti per annullamento e recupero | Attivo | Attivo / Off |
| Versioni massime | Numero di snapshot di cronologia da mantenere per documento | 50 versioni | 10, 25, 50, 100 |
| Mantieni versioni per | Età massima degli snapshot di cronologia prima di essere eliminati | 7 giorni | 1 giorno, 7 giorni, 14 giorni, 30 giorni |
| Finestra di unione | I salvataggi automatici consecutivi all'interno di questa finestra si consolidano in un unico snapshot, riducendo il rumore dello storage | 30 secondi | Off, 10s, 30s, 1 min, 2 min |
| Dimensione massima file per la cronologia | Salta la creazione di snapshot di cronologia per i file più grandi di questa soglia | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Illimitato |

### Immagini

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Ridimensiona automaticamente all'incolla | Ridimensiona automaticamente le immagini grandi prima di salvarle nella cartella assets. Il valore è la dimensione massima in pixel | Off | Off, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copia nella cartella assets | Copia le immagini incollate o trascinate nella cartella assets del documento invece di incorporarle | Attivo | Attivo / Off |
| Pulisci immagini inutilizzate alla chiusura | Elimina automaticamente le immagini dalla cartella assets che non sono più referenziate nel documento quando lo chiudi | Off | Attivo / Off |
| Soglia immagini incorporate | Dimensione massima (MB) per incorporare le immagini come URL di dati base64 nell'esportazione HTML/PDF. I file più grandi vengono collegati invece | 1.0 MB | 0.1 – 10 MB |

### File di grandi dimensioni

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Avvisa sopra la dimensione | Mostra una richiesta di conferma quando si aprono file sopra questa dimensione | 5 MB | Attivo / Off |
| Modalità Sorgente automatica | Apri automaticamente i file sopra la soglia in modalità Sorgente (salta WYSIWYG per mantenere prestazioni fluide) | Attivo | Attivo / Off |

Vedi [File di grandi dimensioni](/guide/large-files) per la suddivisione completa di come vengono gestiti i file di grandi dimensioni.

### Aggiornamenti

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Frequenza di controllo | Quando controllare nuove versioni di VMark | All'avvio | All'avvio, Quotidianamente, Settimanalmente, Manuale |
| Scarica automaticamente gli aggiornamenti | Scarica gli artefatti di rilascio in background una volta rilevato un aggiornamento | Off | Attivo / Off |
| Salta una versione | Sopprime la richiesta di aggiornamento per una versione specifica (impostata per aggiornamento dalla richiesta stessa) | Nessuna | — |

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
| Approva automaticamente le modifiche | Applica le modifiche al documento avviate dall'IA senza mostrare un'anteprima per l'approvazione. Usa con cautela | Off |

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

**Provider API REST** — Connettiti direttamente alle API cloud (Anthropic, OpenAI, Google AI, Ollama API). Ognuno richiede un endpoint, una chiave API e il nome del modello.

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
| **Anteprima HTML** | Off | `.html` e `.htm` — anteprima iframe in sandbox (`sandbox=""` lista autorizzazioni vuota, DOMPurify, CSP `<meta>`). Verificato OWASP top-20 — vedi [Modello di sicurezza per HTML](/it/guide/formats#modello-di-sicurezza-per-html). |
| **Visualizzatori di codice** | Off | 12 visualizzatori in sola lettura (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Si apre in un visualizzatore con evidenziazione della sintassi con i pulsanti **Abilita modifica** e **Apri nell'editor esterno**. |

Quando una categoria è disattivata, le estensioni corrispondenti ricadono sul fallback in testo normale — il file si apre comunque, ma senza la vista schema.

### Editor esterno

Per il pulsante **Apri nell'editor esterno** nelle schede di codice in sola lettura, scegli l'editor che deve essere avviato. Un bundle app (es. `/Applications/Visual Studio Code.app`) o un eseguibile.

L'impostazione GUI sostituisce qualsiasi variabile d'ambiente — l'esplicito supera l'implicito. Lasciala vuota per usare la catena di fallback `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → predefinito di piattaforma`. Vedi [Apri nell'editor esterno](/it/guide/formats#apri-nelleditor-esterno) per l'ordine di risoluzione completo e il controllo di sicurezza.

### Notifica di aggiornamento una tantum

Al primo avvio dopo l'aggiornamento al supporto multi-formato, VMark mostra un toast non bloccante che punta a **Impostazioni → Formati**. La notifica appare una sola volta per installazione — una volta mostrata (o ignorata), non riappare mai più.

## Lingua

Regole di formattazione CJK (cinese, giapponese, coreano). Queste regole vengono applicate quando esegui **Formato → Formatta selezione CJK** (`Cmd+Shift+F`) su una selezione, o **Formato → Formatta documento CJK** (`Alt+Cmd+Shift+F`) sull'intero file.

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
| Correggi spaziatura virgolette doppie | Normalizza la spaziatura intorno alle virgolette doppie | Attivo |
| Correggi spaziatura virgolette singole | Normalizza la spaziatura intorno alle virgolette singole | Attivo |
| Virgolette a forcella CJK | Converti le virgolette curve in parentesi a forcella `「」` per testo cinese tradizionale e giapponese. Disponibile solo quando lo stile virgolette è Curve | Off |
| Virgolette a forcella annidate | Converti le virgolette singole annidate in `『』` all'interno di `「」` | Off |

### Pulizia

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Limita punteggiatura consecutiva | Limita i segni di punteggiatura ripetuti come `!!!` | Off | Off, Singolo (`!!` diventa `!`), Doppio (`!!!` diventa `!!`) |
| Rimuovi spazi finali | Rimuovi gli spazi alla fine delle righe | Attivo | Attivo / Off |
| Normalizza puntini di sospensione | Converti i punti spaziati (`. . .`) in puntini di sospensione corretti (`...`) | Attivo | Attivo / Off |
| Comprimi newline | Riduci tre o più newline consecutive a due | Attivo | Attivo / Off |

## Scorciatoie

Visualizza e personalizza tutte le scorciatoie da tastiera. Le scorciatoie sono raggruppate per categoria (File, Modifica, Visualizza, Formato, ecc.).

- **Cerca** — Filtra le scorciatoie per nome, categoria o combinazione di tasti
- **Fai clic su una scorciatoia** per cambiare la sua combinazione di tasti. Premi la nuova combinazione, poi conferma
- **Ripristina** — Ripristina una singola scorciatoia al suo predefinito, o ripristina tutte in una volta
- **Esporta / Importa** — Salva le tue associazioni personalizzate come file JSON e importale su un'altra macchina

Vedi [Scorciatoie da Tastiera](/it/guide/shortcuts) per il riferimento completo alle scorciatoie predefinite.

## Terminale

Configura il pannello terminale integrato. Apri il terminale con `` Ctrl + ` ``.

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Shell | Quale shell usare. Richiede il riavvio del terminale per avere effetto | Predefinito di Sistema | Shell rilevate automaticamente nel sistema (es. zsh, bash, fish) |
| Posizione Pannello | Dove posizionare il pannello del terminale | Auto | Auto (basato sul rapporto d'aspetto della finestra), In basso, A destra |
| Dimensione Pannello | Proporzione dello spazio disponibile occupata dal terminale. Il trascinamento del pannello aggiorna anche questo valore | 40% | dal 10% all'80% |
| Dimensione Font | Dimensione del testo nel terminale | 13px | da 10px a 24px |
| Interlinea | Spaziatura verticale tra le righe del terminale | 1.2 (Compatta) | da 1.0 (Stretta) a 2.0 (Extra) |
| Stile Cursore | Forma del cursore del terminale | Barra | Barra, Blocco, Sottolineato |
| Cursore Lampeggiante | Se il cursore del terminale lampeggia | Attivo | Attivo / Off |
| Copia alla Selezione | Copia automaticamente il testo selezionato nel terminale negli appunti | Off | Attivo / Off |
| Renderer WebGL | Usa il rendering con accelerazione GPU per il terminale. Disabilita se si verificano problemi di input IME. Richiede il riavvio del terminale | Attivo | Attivo / Off |

Vedi [Terminale Integrato](/it/guide/terminal) per ulteriori informazioni su sessioni, scorciatoie da tastiera e ambiente shell.

## Informazioni

Visualizza la versione dell'app, i collegamenti al sito web e al repository GitHub e la gestione degli aggiornamenti.

### Aggiornamenti

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Aggiornamenti automatici | Controlla gli aggiornamenti automaticamente all'avvio | Attivo |
| Controlla ora | Attiva manualmente un controllo degli aggiornamenti | — |

Quando è disponibile un aggiornamento, appare una scheda che mostra il nuovo numero di versione, la data di rilascio e le note di rilascio. Puoi **Scaricare** l'aggiornamento, **Saltare** questa versione o — una volta scaricato — **Riavvia per Aggiornare**.

## Avanzate

::: tip
La sezione Avanzate è nascosta per impostazione predefinita. Premi `Ctrl + Option + Cmd + D` nella finestra Impostazioni per rivelarla.
:::

Configurazione per sviluppatori e a livello di sistema.

### Protocolli Link

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Protocolli link personalizzati | Protocolli URL aggiuntivi che VMark dovrebbe riconoscere quando inserisce collegamenti. Inserisci ogni protocollo come tag | `obsidian`, `vscode`, `dict`, `x-dictionary` |

Questo ti permette di creare collegamenti come `obsidian://open?vault=...` o `vscode://file/...` che VMark tratterà come URL validi.

### Prestazioni

| Impostazione | Descrizione | Predefinito |
|-------------|-------------|-------------|
| Mantieni entrambi gli editor attivi | Monta sia l'editor WYSIWYG che quello Sorgente contemporaneamente per un cambio di modalità più veloce. Aumenta l'utilizzo della memoria | Off |

### Motore dei workflow

| Impostazione | Descrizione | Predefinito | Opzioni |
|-------------|-------------|-------------|---------|
| Motore dei workflow | Abilita il visualizzatore/editor dei workflow GitHub Actions per i file `.yml`/`.yaml` sotto `.github/workflows/`. Quando disattivato, quei file si aprono come YAML semplice | Off | Attivo / Off |
| Preserva la formattazione YAML | Quando si salvano le modifiche al workflow effettuate tramite il pannello del modulo, preserva i commenti, le ancore, l'ordine delle chiavi e le righe vuote dello YAML originale tramite il pipeline CST round-trip. Quando disattivato, il salvataggio usa un serializzatore compatto (più veloce ma con perdita) | Attivo | Attivo / Off |

Vedi [Visualizzatore di workflow](/guide/workflow-viewer) per la superficie completa delle funzionalità.

### Specifico per piattaforma

| Impostazione | Descrizione | Predefinito | Piattaforme |
|-------------|-------------|-------------|-------------|
| Cancella la quarantena macOS all'apertura | Quando si apre un file che porta l'attributo di quarantena macOS (`com.apple.quarantine`), rimuovilo prima della lettura. Utile per i file scaricati dal web che VMark altrimenti sarebbe bloccato dall'aprire | Attivo | macOS |
| Mac Option come Meta (terminale) | Tratta il tasto Option di macOS come Meta nel terminale integrato. Necessario per strumenti come emacs e tmux che si aspettano scorciatoie con prefisso Alt | Off | macOS |

### Strumenti per Sviluppatori

Quando **Strumenti per sviluppatori** è attivato, appare un pannello **Hot Exit Dev Tools** con pulsanti per testare l'acquisizione della sessione, l'ispezione, il ripristino, la cancellazione e il riavvio — utile per il debug del comportamento di hot exit durante lo sviluppo.

## Vedi Anche

- [Funzionalità](/it/guide/features) — Panoramica delle capacità di VMark
- [Scorciatoie da Tastiera](/it/guide/shortcuts) — Riferimento completo alle scorciatoie
- [Formattazione CJK](/it/guide/cjk-formatting) — Regole dettagliate di formattazione CJK
- [Terminale Integrato](/it/guide/terminal) — Sessioni e utilizzo del terminale
- [Provider IA](/it/guide/ai-providers) — Guida alla configurazione del provider IA
- [Configurazione MCP](/it/guide/mcp-setup) — Configurazione del server MCP per gli assistenti IA
