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
| Dati — YAML | `.yaml`, `.yml` | sempre attivo | sorgente + albero | albero navigabile, contestuale (GitHub Actions) |
| Dati — JSON | `.json`, `.jsonl` | richiede toggle **Formati dati** | sorgente + albero | albero JSON navigabile, contestuale (`package.json`) |
| Dati — TOML | `.toml` | richiede toggle **Formati dati** | sorgente + albero | albero navigabile, contestuale (`Cargo.toml`, `pyproject.toml`) |
| Diagrammi | `.mmd` | richiede toggle **Diagrammi e SVG** | sorgente + rendering | diagramma Mermaid live |
| Vettoriale | `.svg` | richiede toggle **Diagrammi e SVG** | sorgente + rendering | rendering inline sanitizzato |
| Web | `.html`, `.htm` | richiede toggle **Anteprima HTML** | sorgente + rendering | iframe in sandbox (empty `sandbox=""`, DOMPurify, CSP) |
| Codice (sola lettura) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | richiede toggle **Visualizzatori di codice** | visualizzatore (attiva la modifica) | — |

I file di codice si aprono in sola lettura con un banner che offre **Abilita modifica** o **Apri nell'editor esterno**.

## Anteprime contestuali

Quando il percorso o il contenuto corrisponde a uno schema noto, VMark sostituisce la vista contestuale appropriata all'albero generico.

### Workflow GitHub Actions (`.github/workflows/*.yml`)

Si apre con la visualizzazione del workflow (DAG dei job, trigger, permessi).

- Rilevamento tramite percorso: un file `.yml` / `.yaml` sotto `.github/workflows/` viene instradato al renderer del workflow — anche con YAML non valido, così vedresti la vista degradata con diagnostica invece di un albero vuoto. (Il file deve raggiungere prima l'adattatore YAML; ciò richiede l'estensione `.yml`/`.yaml`.)
- Rilevamento tramite contenuto: chiavi di primo livello `on:` e `jobs:`.

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
- **Formati dati** (JSON, YAML, TOML) vengono aperti nel riquadro sorgente con marcatori di errore di analisi nel margine; l'anteprima ad albero si aggiorna mentre si digita. Le azioni di menu riservate al Markdown sono disabilitate (formattazione CJK, inserimento blocchi, formattazione paragrafi); i controlli pertinenti alla modalità rimangono attivi.
- **Formati visivi** (Mermaid, SVG, HTML) vengono aperti nel riquadro sorgente con la vista renderizzata nel riquadro destro (con debounce).
- **Formati di codice** si aprono come visualizzatori con evidenziazione della sintassi; attiva la modifica in loco o apri nel tuo editor esterno (vedi sotto).

## Trova, salva, ricerca nel contenuto

- **Cmd+O** filtri: un singolo preset "Tutti i supportati" che copre ogni formato registrato. I filtri Salva con nome e l'estensione di salvataggio predefinita derivano dall'adattatore di formato della scheda attiva, quindi salvare un file `.toml` propone `.toml` come estensione.
- **Trascina e rilascia**: accetta qualsiasi estensione registrata.
- **Salva come**: i filtri e l'estensione predefinita al salvataggio derivano dall'adattatore di formato della scheda attiva.
- **Cmd+Shift+H** ricerca nel contenuto ("Trova nei file") indicizza ogni formato testuale (markdown, txt, json, yaml, toml, html, svg, mermaid). I file di codice sono esclusi per impostazione predefinita — sono in modalità visualizzatore di codice.

## Modello di sicurezza per HTML

Secondo ADR-4 nel piano multi-formato, l'anteprima HTML si basa su tre livelli di difesa indipendenti:

1. **`<iframe sandbox="">`** con una lista di autorizzazioni vuota — nessuno script, nessuna stessa origine, nessun modulo, nessun popup. Il sandboxing è applicato dall'attributo iframe da solo (CSP tramite `<meta>` non è una sandbox secondo MDN).
2. **Sanitizzazione DOMPurify** eseguita prima — rimuove `<script>`, URL `javascript:`, gestori di eventi inline, trucchi base-href.
3. **Iniezione CSP `<meta>`** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — limita il caricamento delle risorse nell'iframe.

Il validatore segnala i tag script, gli URL `javascript:` e i gestori di eventi inline come avvisi in modo da poter vedere cosa viene bloccato.

## Apri nell'editor esterno

Per i file di codice, il pulsante **Apri nell'editor esterno** nel banner di sola lettura avvia l'editor a scelta. Ordine di risoluzione:

1. **Impostazioni → Formati → Editor esterno** (il campo GUI — vedi [Impostazioni](/it/guide/settings#formati)). Scegli un bundle `.app` su macOS, un eseguibile su Linux/Windows, o qualsiasi cosa la tua shell risolverebbe.
2. `$VMARK_EXTERNAL_EDITOR` (override dell'ambiente a livello di progetto)
3. `$VISUAL`
4. `$EDITOR`
5. Predefinito di piattaforma (`open -t` su macOS, `notepad.exe` su Windows, `xdg-open` su Linux)

L'impostazione GUI ha la precedenza sulle variabili d'ambiente — l'esplicito supera l'implicito. Lascia il campo vuoto per usare la catena di fallback delle variabili d'ambiente.

VMark instrada tramite un PATH di shell di login in modo che i wrapper di VS Code / Cursor / JetBrains si risolvano correttamente quando avviati da un'app GUI macOS.

### Controllo di sicurezza

Il comando Tauri `open_in_external_editor` rifiuta:

- percorsi inesistenti
- directory e altri file non regolari (socket, dispositivi)
- percorsi la cui estensione canonicalizzata non è nel set di formati registrati di VMark
- symlink il cui target canonico non supera nessuno dei controlli precedenti

Una webview compromessa non può usare il pulsante per avviare l'editor esterno su file di sistema arbitrari (password, chiavi, ecc.) — solo su percorsi che VMark aprirebbe esso stesso.

## Cosa non è supportato

Secondo i non-obiettivi del piano:

- **Non è un editor di codice.** Nessun LSP, nessun completamento automatico, nessun refactoring, nessun debugger, nessun gutter git.
- **Non "ogni formato di testo normale".** Ambito limitato — vedi la tabella sopra.
- **Nessuna esecuzione di script HTML.** Solo rendering in sandbox.
- **Nessuna stampa / esportazione / copia come HTML per formati non-markdown** nella v1.
- **Non ancora supportati come visualizzatori di codice**: Zig, Swift, Kotlin, Java, Elixir, OCaml e altri linguaggi fuori dal set di 12 estensioni. La regola decisionale è "linguaggi che usiamo noi stessi" — segnala un issue se desideri che ne venga aggiunto uno.

Se un formato che vuoi non è elencato e non è deliberatamente fuori ambito, segnala un issue.
