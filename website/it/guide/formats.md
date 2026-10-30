# Formati Supportati

VMark apre direttamente tutti i formati di file elencati di seguito. Il valore aggiunto sono le **anteprime contestuali**: quando il file è un artefatto riconoscibile, VMark mostra la vista *giusta* al posto di un albero JSON generico.

[[toc]]

## Abilitare i formati

Markdown, testo normale e YAML/YML si aprono sempre con i loro editor completi — sono le impostazioni predefinite. Tutti gli altri formati sono **disattivati per impostazione predefinita** e richiedono l'attivazione di un toggle per categoria in **Impostazioni → Formati**:

| Toggle | Abilita |
|---|---|
| **Formati dati** | `.json`, `.jsonl`, `.toml` (riquadro sorgente + albero, con renderer di schema per Cargo / package.json / pyproject) |
| **Diagrammi e SVG** | `.mmd`, `.svg` (riquadro sorgente + rendering live sanitizzato) |
| **Anteprima HTML** | `.html`, `.htm` (iframe in sandbox — vedi [Modello di sicurezza per HTML](#modello-di-sicurezza-per-html)) |
| **Visualizzatori di codice** | 12 visualizzatori di codice in sola lettura (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`) |

Quando una categoria è disattivata, le estensioni corrispondenti ricadono sul fallback in testo normale — il file si apre comunque, ma senza anteprima o vista schema. Attiva un toggle e il registro si ricostruisce in loco; le schede aperte si rimontano con l'adattatore appropriato.

Al primo avvio dopo l'aggiornamento al supporto multi-formato, VMark mostra un toast una tantum che ti invita ad andare su **Impostazioni → Formati**. Se l'hai ignorato (o hai eseguito un'installazione pulita), il pannello è disponibile in **Impostazioni → Formati** in qualsiasi momento.

## Panoramica

| Famiglia | Estensioni | Predefinito | Editor | Anteprima |
|---|---|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | sempre attivo | modalità WYSIWYG + Sorgente | prosa renderizzata |
| Testo normale | `.txt` | sempre attivo | sorgente | — |
| Dati — YAML | `.yaml`, `.yml` | sempre attivo | sorgente + albero | albero navigabile, contestuale (GitHub Actions, workflow VMark) |
| Dati — JSON | `.json`, `.jsonl` | richiede toggle **Formati dati** | sorgente + albero | albero JSON navigabile, contestuale (`package.json`) |
| Dati — TOML | `.toml` | richiede toggle **Formati dati** | sorgente + albero | albero navigabile, contestuale (`Cargo.toml`, `pyproject.toml`) |
| Diagrammi | `.mmd` | richiede toggle **Diagrammi e SVG** | sorgente + rendering | diagramma Mermaid live |
| Vettoriale | `.svg` | richiede toggle **Diagrammi e SVG** | sorgente + rendering | rendering inline sanitizzato |
| Web | `.html`, `.htm` | richiede toggle **Anteprima HTML** | sorgente + rendering | iframe in sandbox (`sandbox=""` vuoto, DOMPurify, CSP); la [modalità attendibile](#anteprima-html-attendibile-opzionale) è opzionale, per singolo file |
| Codice (sola lettura) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | richiede toggle **Visualizzatori di codice** | visualizzatore (attiva la modifica) | — |
| Multimedia | immagini (`.png`, `.jpg`, `.gif`, `.webp`, `.heic`, `.tiff`, …), video (`.mp4`, `.webm`, `.mov`, …), audio (`.mp3`, `.wav`, `.flac`, …) | sempre attivo | visualizzatore (sola lettura) | immagine nativa / `<video>` / `<audio>` |

I file di codice si aprono in sola lettura con un banner che offre **Abilita modifica** o **Apri in un editor esterno**.

## Modalità di visualizzazione (Sorgente / Diviso / Anteprima)

Ogni formato che dispone di un'anteprima — HTML, SVG, Mermaid, JSON, YAML, TOML — si apre
con un piccolo interruttore **Sorgente · Diviso · Anteprima** nell'angolo in alto a destra:

- **Sorgente** — il riquadro sorgente modificabile, a tutta larghezza.
- **Diviso** — sorgente e anteprima affiancati (il valore predefinito).
- **Anteprima** — il risultato renderizzato, a tutta larghezza. L'anteprima è un
  rendering in **sola lettura**; per modificare, torna a Sorgente o Diviso.

Puoi cambiare modalità anche da tastiera: **`F6`** alterna Sorgente ⇄ Diviso e
**`Shift + F6`** alterna Anteprima ⇄ Diviso (Diviso è lo stato di base). La scelta viene
ricordata per ogni scheda. Imposta il valore predefinito per i file appena aperti in
**Impostazioni → Formati → Modalità di visualizzazione predefinita**.

I formati senza anteprima (testo normale, visualizzatori di codice) mostrano sempre solo il sorgente, quindi
l'interruttore non compare.

## File multimediali (immagini, video, audio)

Apri un'immagine, un video o un file audio e VMark lo mostra direttamente — come Quick
Look nel Finder. Ci sono due modi per visualizzarlo in anteprima:

- **Aprilo** (fai clic su di esso nell'esplora file, usa **File → Apri file...** oppure
  trascinalo nella finestra) per visualizzarlo in una scheda.
- **Quick Look**: seleziona un file nell'esplora file e premi **Spazio** per un'anteprima
  sovrapposta a tutta finestra. Premi **Spazio**, **Esc** o fai clic sullo sfondo
  per chiuderla.

Come funziona e cosa aspettarsi:

- **Mai caricato come testo.** I contenuti multimediali sono binari — VMark trasmette il file direttamente
  al visualizzatore tramite la pipeline nativa degli asset. Non viene mai letto come UTF-8,
  mai tenuto in memoria come documento e mai modificabile né salvabile. Anche
  i video di diversi gigabyte si aprono all'istante e supportano la ricerca nativa.
- **Le modifiche su disco compaiono da sole.** Riesporta l'immagine dal tuo editor, o lascia che
  uno script la riscriva, e la scheda aperta rileva da sola la nuova versione — senza
  riaprirla, senza chiudere e riaprire il file.
- **Ampia copertura dei formati.** VMark affida il file al motore multimediale della piattaforma,
  quindi il supporto segue ciò che la webview del tuo sistema è in grado di decodificare. Su macOS
  è ampio — HEIC, TIFF, `.mov`/H.264 e FLAC vengono tutti riprodotti. I formati che la
  webview non riesce a decodificare (ad es. `.mkv`, `.avi`, `.wmv`) si aprono comunque, mostrando un
  pannello di ripiego con **Apri con l’app predefinita** e **Mostra nel Finder**
  (**Mostra in Esplora risorse** su Windows, **Mostra nel gestore file** su Linux).
- **Sola lettura.** Le schede multimediali non risultano mai modificate e si chiudono senza richiesta di salvataggio.

## Anteprime contestuali

Quando il percorso o il contenuto corrisponde a uno schema noto, VMark sostituisce la vista contestuale appropriata all'albero generico.

### Workflow GitHub Actions (`.github/workflows/*.yml`)

Si apre con il banco di lavoro del workflow: il canvas interattivo del DAG dei job più un editor a moduli strutturato con Salva / Annulla (vedi la [guida al Visualizzatore di workflow](/it/guide/workflow-viewer)). Anche il riquadro sorgente conosce i workflow — completamento delle espressioni `${{ }}`, evidenziazione del job sul canvas in base al cursore e Cmd-clic sui riferimenti `uses:` locali.

- Rilevamento tramite percorso: un file `.yml` / `.yaml` sotto `.github/workflows/` viene instradato al renderer del workflow — anche con YAML non valido, così vedresti la vista degradata con diagnostica invece di un albero vuoto. (Il file deve raggiungere prima l'adattatore YAML; ciò richiede l'estensione `.yml`/`.yaml`.)
- Rilevamento tramite contenuto: chiavi di primo livello `on:` e `jobs:`.

### Workflow VMark (`steps:` di primo livello)

Si apre con il pannello di esecuzione del workflow: una barra degli strumenti **Esegui** / **Annulla** con una riga di stato, il grafo dei passaggi dal vivo (o l'errore di analisi) e **Ripristina file** dopo un'esecuzione che ha scritto dei file. Vedi la [guida ai workflow](/it/guide/workflows).

- Rilevamento tramite percorso: mai sotto `.github/workflows/` — quella cartella appartiene a GitHub.
- Rilevamento tramite contenuto: lo YAML viene analizzato correttamente, non ha `jobs:` di primo livello e ha un elenco `steps:` di primo livello in cui almeno un passaggio ha un `uses:` che inizia con `genie/`, `action/` o `webhook/`. Uno YAML non valido non è mai un workflow VMark.
- Il pannello richiede **Impostazioni → Avanzate → Motore workflow**. Con il motore disattivato, il file mostra il semplice albero YAML (a meno che un'esecuzione avviata da questa scheda sia ancora attiva, così il suo Annulla resta raggiungibile).

### `Cargo.toml`

Si apre con un albero delle dipendenze Rust — dipendenze runtime, dev e build, con specifiche di versione e flag di funzionalità.

- Rilevamento tramite percorso: nome file `Cargo.toml` (senza distinzione maiuscole/minuscole) su percorsi POSIX o Windows.
- Rilevamento tramite contenuto: intestazione `[package]` o `[workspace]`.
- Nessuna chiamata di rete — VMark non risolve mai crates.io.

### `package.json`

Si apre con un albero delle dipendenze npm — `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`.

- Rilevamento tramite percorso: nome file `package.json`.
- Rilevamento tramite contenuto: `name` di primo livello più almeno uno tra `dependencies` / `devDependencies` / `peerDependencies`.

### `pyproject.toml`

Si apre con un albero delle dipendenze Python — sia PEP 621 (`[project]` + `[project.optional-dependencies]`) che Poetry (`[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]`, `[tool.poetry.group.<name>.dependencies]`).

- Rilevamento tramite percorso: nome file `pyproject.toml`.
- Rilevamento tramite contenuto: intestazione `[project]` o `[tool.poetry]` (subordinato a un'analisi TOML riuscita).

## Regole di modifica

- **Markdown** include la barra degli strumenti completa, la formattazione dei paragrafi, le regole CJK, la matematica, Mermaid, le note a piè di pagina — tutte le funzionalità markdown esistenti.
- **Formati dati** (JSON, YAML, TOML) vengono aperti nel riquadro sorgente con marcatori di errore di analisi nel margine; l'anteprima ad albero si aggiorna mentre si digita. Le azioni di menu riservate al Markdown sono disabilitate (formattazione CJK, inserimento blocchi, formattazione paragrafi); i controlli pertinenti alla modalità rimangono attivi. Il menu contestuale del clic destro è ridotto alle azioni degli appunti (Taglia/Copia/Incolla/Seleziona tutto).
- **Formati visivi** (Mermaid, SVG, HTML) vengono aperti nel riquadro sorgente con la vista renderizzata nel riquadro destro. L'anteprima viene renderizzata con priorità inferiore rispetto alla digitazione, quindi su un documento grande resta un attimo indietro rispetto al cursore invece di rigenerarsi a ogni tasto premuto.
- **Formati di codice** si aprono come visualizzatori con evidenziazione della sintassi; attiva la modifica in loco o apri nel tuo editor esterno (vedi sotto).

## Dialetto Markdown

VMark legge e scrive Markdown con remark (con micromark sotto il cofano): CommonMark, più GitHub Flavored Markdown (tabelle, elenchi di attività, barrato con `~~`, link automatici, note a piè di pagina), front matter YAML, matematica `$…$` / `$$…$$`, wiki link (`[[target]]`), avvisi GitHub (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), blocchi `<details>`, `[TOC]` e quattro marcatori inline: `==highlight==`, `~subscript~`, `^superscript^` e `++underline++`. Una singola tilde indica il pedice, mai il barrato.

**Limite di annidamento.** Il WYSIWYG supporta citazioni ed elenchi annidati fino a 1000 livelli di profondità. Un documento più profondo si apre in **modalità Sorgente** con un messaggio che indica quanto è profondo, e la barra di stato mostra *"Aperto in modalità Sorgente (non visualizzabile in WYSIWYG)."* Finché resta in questo stato, il file è protetto dalla sovrascrittura da parte dell'editor avanzato. Riduci l'annidamento, poi usa **Passa al WYSIWYG**. Blocchi di codice delimitati, separatori tematici ed enfasi inline non contano ai fini del limite. Vedi anche [File di grandi dimensioni](/it/guide/large-files).

## Come VMark determina il tipo di un file

VMark tratta **il markdown come una lista di autorizzazioni, non come un'impostazione predefinita**. La regola, in ordine:

1. **Un'estensione della famiglia markdown** (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`) si apre nell'editor markdown avanzato.
2. **Un'estensione non markdown registrata** (quando la sua categoria è abilitata — JSON, YAML, visualizzatori di codice, ecc.) si apre nel riquadro sorgente di quel formato.
3. **Tutto il resto** — `.env`, `.env.local`, `Dockerfile`, `Makefile`, `.gitignore`, estensioni sconosciute — si apre nel **riquadro sorgente in testo normale**, mai nell'editor markdown.

Questo significa che un file di configurazione non viene mai renderizzato silenziosamente come markdown. Un `.env.local` si apre come testo normale, con le righe `KEY=value`, i commenti `#` e i trattini bassi lasciati esattamente come sono stati digitati.

Le famiglie di dotfile vengono riconosciute come gruppo: una sostituzione su `.env` copre `.env.local`, `.env.production` e così via.

### Aprire i file dal sistema

Il programma di installazione registra VMark presso il sistema operativo come editor per questi tipi di file, così compaiono in **Apri con** e un doppio clic li apre in VMark:

| Estensioni | Registrati come |
|---|---|
| `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | Markdown Document |
| `.txt` | Plain Text Document |
| `.json`, `.jsonl` | JSON Document |
| `.yaml`, `.yml` | YAML Document |
| `.toml` | TOML Document |
| `.mmd` | Mermaid Diagram |
| `.svg` | SVG Image |
| `.html`, `.htm` | HTML Document |

Su **Windows**, il programma di installazione non si appropria di un tipo di file già gestito da qualcos'altro: per ogni estensione che ha già un programma predefinito, VMark si aggiunge ad **Apri con** e lascia invariato quel predefinito. Diventa il predefinito solo dove non era registrato nulla — in pratica le estensioni Markdown, non `.txt`, `.html`, `.htm` o `.svg`. Un predefinito che scegli tu nelle impostazioni di Windows ha sempre la precedenza. La disinstallazione ripristina la voce di menu **Nuovo → Documento di testo** di Windows e il gestore precedente.

Un file registrato si apre in VMark solo se il suo formato è abilitato (vedi [Abilitare i formati](#abilitare-i-formati)); altrimenti si apre come testo normale.

Su Windows e Linux, una cartella passata dalla riga di comando (`vmark C:\notes` o `vmark ~/notes`) si apre come workspace nella propria finestra, come accade su macOS trascinando una cartella sull'icona del Dock. Funziona anche quando VMark è già in esecuzione.

### Evidenziazione della sintassi per i file in testo normale

Anche quando un file si apre come testo normale, VMark lo colora se ne riconosce il tipo — `.env`/`.ini`/`.conf` (properties), `.sh`/`.bash` (shell), `Dockerfile`, `.toml`, `.sql`, `.diff` e i linguaggi consueti. È un effetto puramente estetico: non cambia mai l'editor in cui il file si è aperto e funziona indipendentemente dal fatto che la categoria dei visualizzatori di codice sia abilitata.

### Sostituzione: "Imposta tipo di file"

Il rilevamento è l'impostazione predefinita, non una gabbia. Apri la palette dei comandi ed esegui:

- **Imposta tipo di file: Testo semplice** — forza l'apertura come testo normale della famiglia di file corrente (ad es. per evitare che venga renderizzato un `.txt` in cui tieni note grezze).
- **Imposta tipo di file: Markdown** — renderizza un file non `.md` con l'editor markdown (ad es. un `.txt` in cui scrivi effettivamente in markdown).
- **Imposta tipo di file: Ripristina predefinito** — rimuove la sostituzione.

Le sostituzioni vengono ricordate per famiglia di file (per estensione, o per radice del dotfile per file come `.env`) e persistono tra le sessioni. Hanno la precedenza sulle regole integrate descritte sopra.

## Trova, salva, ricerca nel contenuto

- **File → Apri file...** offre due filtri: **Tutti i formati supportati** (ogni formato registrato) e **Markdown**. La voce non ha una scorciatoia predefinita — `Mod + O` è Apertura rapida — ma puoi assegnarne una in **Impostazioni → Scorciatoie**. I filtri Salva con nome e l'estensione di salvataggio predefinita derivano dall'adattatore di formato della scheda attiva, quindi salvare un file `.toml` propone `.toml` come estensione.
- **Trascina e rilascia**: accetta qualsiasi estensione registrata.
- **Salva come**: i filtri e l'estensione predefinita al salvataggio derivano dall'adattatore di formato della scheda attiva.
- **Cmd+Shift+H** ricerca nel contenuto ("Trova nei file") indicizza ogni formato testuale (markdown, txt, json, yaml, toml, html, svg, mermaid). I file di codice sono esclusi per impostazione predefinita — sono in modalità visualizzatore di codice.

## Modello di sicurezza per HTML

Secondo ADR-4 nel piano multi-formato, l'anteprima HTML si basa su tre livelli di difesa indipendenti:

1. **`<iframe sandbox="">`** con una lista di autorizzazioni vuota — nessuno script, nessuna stessa origine, nessun modulo, nessun popup. Il sandboxing è applicato dall'attributo iframe da solo (CSP tramite `<meta>` non è una sandbox secondo MDN).
2. **Sanitizzazione DOMPurify** eseguita prima — rimuove `<script>`, URL `javascript:`, gestori di eventi inline, trucchi base-href.
3. **Iniezione CSP `<meta>`** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — limita il caricamento delle risorse nell'iframe.

Il validatore segnala i tag script, gli URL `javascript:` e i gestori di eventi inline come avvisi in modo da poter vedere cosa viene bloccato. Una volta che [rendi attendibile il file](#anteprima-html-attendibile-opzionale), vengono invece mostrati come informazioni, così nulla contraddice il banner di attendibilità. Due messaggi indicano ciò che l'anteprima non consente mai, attendibile o no: uno script esterno (`<script src="…">`) non viene mai caricato, poiché nessuno script proviene da un file o da un URL, e un link `javascript:` diretto a un'altra finestra o alla pagina di primo livello (`target="_top"`, `_blank` o un `<base target>`) non naviga mai, poiché l'anteprima non può uscire da sé stessa. Il rilevamento legge i tag della pagina in modo approssimativo; etichetta i risultati e non decide mai cosa viene eseguito — è la sandbox a farlo.

L'approvazione di sicurezza formale di questa anteprima è ancora in sospeso, e l'anteprima lo indica in un avviso sopra la pagina renderizzata: **L'anteprima HTML è isolata. La sua revisione di sicurezza è ancora in corso.** I tre livelli descritti sopra sono attivi; il passaggio mancante è verificarli contro i payload XSS di OWASP all'interno della webview dell'app in esecuzione.

### Anteprima HTML attendibile (opzionale)

L'anteprima sicura descritta sopra è quella predefinita e non cambia mai. Per un documento che
hai scritto tu — un laboratorio interattivo, una dashboard locale, una demo autonoma —
puoi autorizzare l'esecuzione degli script per **quel solo file, per questa sessione**.

Usa **Attiva anteprima attendibile…** nella barra sopra l'anteprima. Prima ricevi un
avviso; non viene eseguito nulla finché non confermi. Mentre è attiva, la barra resta visibile
e indica **Attendibile — script attivi**, e **Revoca attendibilità** è a portata di un clic.

Che cosa concede la modalità attendibile, e che cosa no:

| | Anteprima attendibile |
|---|---|
| JavaScript, DOM, eventi del puntatore, `requestAnimationFrame`, Web Audio | ✅ eseguiti |
| Rete (`fetch`, `XMLHttpRequest`, WebSocket, immagini/script remoti) | ❌ bloccata da `default-src 'none'` |
| La pagina di VMark stessa, i comandi Tauri, il tuo filesystem | ❌ irraggiungibili — il documento viene eseguito in un'origine opaca tutta sua |
| Navigazione di primo livello, popup, invio di moduli, download, finestre modali | ❌ non concessi (`sandbox="allow-scripts"` e nient'altro) |
| Fotocamera, microfono, geolocalizzazione, appunti | ❌ nessuna funzionalità viene delegata al frame |
| `localStorage` / `sessionStorage` | ❌ non disponibili — un'origine opaca non ha archiviazione same-origin |
| `eval` / `new Function` | ❌ non consentiti |

Tre proprietà da conoscere:

- **L'attendibilità non viene mai dedotta.** Né dall'estensione `.html`, né dalla provenienza
  del file, né da un file vicino che hai già reso attendibile. Solo la
  conferma la concede.
- **L'attendibilità non viene mai resa persistente.** Chiudi VMark e ogni autorizzazione scompare. Non è
  inoltre disponibile per un documento non salvato, che non ha un'identità a cui associare
  l'autorizzazione — salva prima il file.
- **Un'anteprima attendibile non si riesegue mai da sola.** Modificare il sorgente la contrassegna come
  *Potrebbe non corrispondere al sorgente attuale* e attende **Ricarica**, così una
  simulazione in corso non viene azzerata a ogni tasto premuto. Lo stesso indicatore compare quando
  VMark non può sapere che cosa sta eseguendo il frame — dopo che passi a un'altra
  scheda e torni indietro, o la chiudi e la riapri, l'anteprima continua a eseguire ciò che
  è stato pubblicato per ultimo per quel file, e quindi lo dichiara invece di sostenere di essere
  aggiornata. **Ricarica** ripubblica il file così com'è ora.

::: info Su Windows viene servita da un'origine http locale
WebView2 non supporta schemi URL personalizzati, quindi su Windows il documento attendibile viene servito
da `http://vmark-trusted.localhost` anziché da `vmark-trusted://` — la stessa
autorizzazione, la stessa sandbox e la stessa CSP, nella forma URL che Tauri usa lì per ogni
protocollo personalizzato. L'anteprima sicura funziona su tutte le piattaforme.
:::

Il contenuto attendibile viene servito da un'origine `vmark-trusted://`
(`http://vmark-trusted.localhost` su Windows) con una propria CSP restrittiva. Questa indirezione è necessaria, non decorativa: un
frame `srcdoc`, `blob:` o `data:` eredita la policy `script-src 'self'` di VMark stesso,
e una CSP all'interno del frame può solo restringere una policy ereditata, mai
allentarla — quindi nessun attributo dell'iframe da solo può far eseguire uno script inline.

## Apri nell'editor esterno

Per i file di codice, il pulsante **Apri in un editor esterno** nel banner di sola lettura avvia l'editor a scelta. Ordine di risoluzione:

1. **Impostazioni → Formati → Editor esterno** (il campo GUI — vedi [Impostazioni](/it/guide/settings#formati)). Inserisci il **nome di un editor noto** (`code`, `cursor`, `zed`, `subl`, `bbedit`, `idea`, `vim`, `nvim`, `emacs`, `notepad++`, …) oppure il **percorso completo** di un editor — un bundle `.app` su macOS, un eseguibile su Linux/Windows. Il campo contiene un solo programma, mai argomenti; per passare argomenti, usa `$VMARK_EXTERNAL_EDITOR`.
2. `$VMARK_EXTERNAL_EDITOR` (override dell'ambiente a livello di progetto)
3. `$VISUAL`
4. `$EDITOR`
5. Predefinito di piattaforma (`open -t` su macOS, `notepad.exe` su Windows, `xdg-open` su Linux)

L'impostazione GUI ha la precedenza sulle variabili d'ambiente — l'esplicito supera l'implicito. Lascia il campo vuoto per usare la catena di fallback delle variabili d'ambiente.

VMark instrada tramite un PATH di shell di login in modo che i wrapper di VS Code / Cursor / JetBrains si risolvano correttamente quando avviati da un'app GUI macOS.

### Controllo di sicurezza

L'impostazione **Editor esterno** stessa viene verificata prima di qualsiasi avvio. VMark rifiuta:

- caratteri di shell (`;`, `|`, `&`, `` ` ``, `$`, `<`, `>`, virgolette, interruzioni di riga) e un `-` iniziale
- un nome semplice che non corrisponde a un editor noto a VMark — *"«X» non è un editor che VMark riconosce per nome: inserisci invece il percorso completo dell'editor"*
- un percorso relativo, un percorso con un segmento `..` o una barra finale, o un percorso che non esiste
- un programma che esegue i file che riceve invece di aprirli — una shell (`sh`, `bash`, `zsh`, `pwsh`, `cmd`, …), un interprete (`python`, `node`, `ruby`, `perl`, `osascript`, …), un launcher (`env`, `sudo`, `open`, `xdg-open`, …) o un emulatore di terminale — verificato sia con il nome che hai digitato sia con il nome a cui si risolve un link

Le variabili d'ambiente della catena di fallback non sono soggette a restrizioni: sono impostate al di fuori di VMark, da te.

Il comando Tauri `open_in_external_editor` rifiuta inoltre:

- percorsi inesistenti
- directory e altri file non regolari (socket, dispositivi)
- percorsi la cui estensione canonicalizzata non è nel set di formati registrati di VMark
- symlink il cui target canonico non supera nessuno dei controlli precedenti

Una webview compromessa non può usare il pulsante per avviare l'editor esterno su file di sistema arbitrari (password, chiavi, ecc.) — solo su percorsi che VMark aprirebbe esso stesso.

## Cosa non è supportato

Secondo i non-obiettivi del piano:

- **Non è un editor di codice.** Nessun LSP, nessun completamento automatico, nessun refactoring, nessun debugger, nessun gutter git.
- **Non "ogni formato di testo normale".** Ambito limitato — vedi la tabella sopra.
- **Nessuna esecuzione di script HTML per impostazione predefinita.** Solo rendering in sandbox, a meno che tu non
  autorizzi esplicitamente un singolo file tramite l'[Anteprima HTML attendibile](#anteprima-html-attendibile-opzionale).
- **Nessuna stampa / esportazione / copia come HTML per formati non-markdown** nella v1.
- **Non ancora supportati come visualizzatori di codice**: Zig, Swift, Kotlin, Java, Elixir, OCaml e altri linguaggi fuori dal set di 12 estensioni. La regola decisionale è "linguaggi che usiamo noi stessi" — segnala un issue se desideri che ne venga aggiunto uno.

Se un formato che vuoi non è elencato e non è deliberatamente fuori ambito, segnala un issue.
