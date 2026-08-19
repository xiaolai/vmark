# Riferimento Strumenti MCP

VMark espone **nove strumenti MCP compositi** agli assistenti IA: `session`, `workspace`, `document`, `workflow`, `selection`, `browser`, `browser_read`, `coherence` e `coherence_resolve`. Insieme coprono la spina dorsale dell'editor, il ciclo di vita di file/finestre, le modifiche CST-safe ai workflow, le modifiche mirate alla selezione, la navigazione delimitata del browser e una vista del livello di coerenza del workspace.

Tre dei nove — `session`, `browser_read` e `coherence` — dichiarano `readOnlyHint: true`, quindi un client MCP può auto-approvarli. È per questo che `browser`/`browser_read` e `coherence`/`coherence_resolve` sono strumenti separati: le annotazioni sono **per strumento**, non per azione, quindi uno strumento che raggruppa uno snapshot ARIA con `execute_js` deve segnalare la pericolosità di `execute_js`. Dividere secondo il criterio «questo modifica qualcosa?» permette a ciascuna metà di dire la verità, e mantiene ben visibili nell'elenco degli strumenti le azioni realmente distruttive della superficie.

La precedente superficie di 12 strumenti / 76 azioni è stata ridotta perché gli strumenti di formattazione interni al documento (grassetto, intestazioni, tabelle, ecc.) duplicano un lavoro che gli agenti IA fanno già banalmente tramite il round-trip Markdown. `selection` è stato mantenuto (secondo l'ADR-7 del piano di riduzione) perché il round-trip dell'intero documento è antieconomico sui file grandi — ogni modifica paga l'intero documento in token di input, l'intero documento in token di output (~5× il prezzo dell'input), e una finestra di scrittura più lunga che allarga il ciclo di ripetizione per revisione obsoleta. Vedi [il piano di riduzione MCP](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md) per la motivazione completa.

::: tip Flusso di Lavoro Consigliato
1. Chiama `session.get_state` una volta per vedere finestre aperte, schede e per ogni scheda `{filePath, dirty, revision, kind}`.
2. Per piccole modifiche Markdown o riscritture complete: `document.read` → ragionare → `document.write` (passando `expected_revision` per concorrenza sicura).
3. Per modifiche mirate su un file Markdown grande quando l'utente ha selezionato la regione da modificare: `selection.get` → ragionare → `selection.set` (riduce il costo in token sia di input sia di output alla sola selezione).
4. Per YAML di GitHub Actions (`kind: "yaml-workflow"`): `workflow.apply_patch` per modifiche CST-safe che preservano commenti e ancore; `workflow.validate` per la diagnostica actionlint.
5. Le operazioni sui file (apri, salva, chiudi, cambia scheda) si trovano in `workspace`.
:::

::: tip Diagrammi Mermaid
Quando si usa l'IA per generare diagrammi Mermaid tramite MCP, considera l'installazione del [server MCP mermaid-validator](/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) — rileva gli errori di sintassi usando gli stessi parser Mermaid v11 prima che i diagrammi raggiungano il tuo documento.
:::

---

## `session`

Orientamento one-shot. Scopri ogni finestra, ogni scheda e le capacità del server in una singola chiamata.

### `get_state`

Nessun argomento.

**Restituisce** `{windows, capabilities}`:

```json
{
  "windows": [
    {
      "label": "main",
      "focused": true,
      "activeWorkspaceInstanceId": "wsi-a1b2c3",
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown",
          "active": true,
          "visible": true
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow",
          "active": false,
          "visible": false
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.2.0"
  }
}
```

#### Sapere cosa è realmente sullo schermo

Una scheda può esistere, essere indirizzabile e comunque non essere mostrata. Tre campi lo indicano:

| Campo | Significato |
|---|---|
| `tab.active` | Questa scheda è la scheda corrente della sua finestra. |
| `tab.visible` | Questa scheda è renderizzata in questo momento. È `false` quando la scheda appartiene a un'istanza di workspace che la finestra non sta mostrando attualmente. |
| `window.activeWorkspaceInstanceId` | L'istanza di workspace che la finestra sta mostrando, o `null` quando la barra delle aree di lavoro è disattivata (in tal caso ogni scheda è visibile). |

`window.focused` è la finestra che l'**utente** sta guardando, letta dal sistema operativo. Non è «la finestra che ha risposto a questa richiesta» — VMark instrada una richiesta alla finestra che possiede il workspace pertinente, che in una sessione multi-finestra è spesso una finestra diversa.

Considerali come il passo di conferma: dopo `workspace.switch_tab`, un `get_state` successivo ti dice se la scheda è davvero davanti all'utente. `switch_tab` stesso rilegge gli store prima di rispondere, quindi riporta `activated: false` quando un'attivazione non è andata a buon fine invece di limitarsi a restituire la richiesta.

Il discriminatore `kind` ti dice se usare `document.write` (per markdown) o `workflow.apply_patch` (per yaml-workflow) su quella scheda.

---

## `workspace`

Ciclo di vita di file e finestre. Niente all'interno del documento.

> **Ambito dei percorsi.** Le operazioni sui file (`open`, `save`, `save_as`) sono
> confinate alla radice del workspace aperto e alle directory dei documenti già
> aperti. Una richiesta per un percorso al di fuori di tale ambito viene rifiutata
> con `INVALID_PATH`. Senza workspace e senza documenti aperti non c'è alcun ambito,
> quindi le operazioni sui file vengono rifiutate. Questo mantiene un client
> automatizzato entro ciò che hai aperto.

### `new`

Crea una nuova scheda senza titolo.

| Parametro | Tipo | Richiesto | Descrizione |
|-----------|------|-----------|-------------|
| `kind` | stringa | No | `"markdown"` (predefinito) o `"yaml-workflow"` |
| `windowLabel` | stringa | No | Finestra di destinazione; predefinita su quella in primo piano |

Restituisce `{tabId}`.

### `open`

Apri un **file** da disco in una scheda in **secondo piano** — la scheda visibile e
il workspace dell'utente non cambiano. Concatena il `tabId` restituito nelle chiamate
`document` / `selection`; usa `switch_tab` solo quando l'utente deve *vedere* la scheda.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `filePath` | stringa | Sì |
| `windowLabel` | stringa | No |

Restituisce `{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}`.

### `open_workspace`

Apri una **cartella** come workspace attivo. A differenza di `open` (un singolo file
all'interno di un albero già autorizzato), questo concede all'assistente l'accesso a un
intero nuovo albero di file, quindi è **regolato da un'approvazione utente una tantum**
e non è coperto dall'ambito dei percorsi di cui sopra.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `folderPath` | stringa | Sì |

`windowLabel` **non** è accettato qui, a differenza di `new` e `open`. La cartella si
apre sempre nella finestra su cui arriva la richiesta. Questo è deliberato: la finestra
di approvazione e l'apertura devono avvenire nella stessa finestra, e un'etichetta
fornita dal client potrebbe mettere il prompt davanti a una finestra mentre ne modifica
un'altra — approvando una cosa e ottenendone un'altra. Il targeting multi-finestra
richiede un instradamento delle richieste che ancora non esiste.

**Flusso di approvazione.** La prima chiamata restituisce `{needsApproval: true}` e
mostra una finestra di consenso che nomina il percorso *canonico* della cartella
(symlink risolti). L'assistente dovrebbe chiedere all'utente, poi **riprovare la stessa
chiamata**; una volta che l'utente approva, il nuovo tentativo apre la cartella. Una
richiesta negata continua a fallire finché non viene ri-approvata. Non c'è un'opzione
«ricorda» — ogni apertura viene approvata individualmente.

### `save`

Salva una scheda nel suo percorso esistente.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No (predefinito su quella in primo piano) |

Restituisce `{filePath, revision}`.

### `save_as`

Salva una scheda in un nuovo percorso.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No |
| `filePath` | stringa | Sì |

Restituisce `{revision}`.

Salvare in un percorso diverso dal file corrente della scheda stessa è trattato come una
nuova scrittura. Quando **Approva automaticamente le modifiche** (Impostazioni →
Integrazioni) è disattivato (l'impostazione predefinita), una richiesta di questo tipo
viene rifiutata con `APPROVAL_REQUIRED` e un toast ti dice cosa è stato bloccato. Salvare
di nuovo nel percorso proprio della scheda è sempre permesso.

### `close`

Chiude una scheda. Rifiuta di scartare lavoro non salvato senza `force`.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | Sì |
| `force` | booleano | No |

Restituisce `{closed: true}` in caso di successo, `{closed: false, reason: "DIRTY"}` se la scheda è modificata e `force` non è stato fornito.

### `switch_tab`

Attiva una scheda e la rende **visibile**. Con la [barra delle aree di lavoro](/guide/workspace-rail)
abilitata questo può cambiare il contesto del workspace attivo dell'utente — la risposta
riporta `workspaceSwitched: true` quando ciò accade, quindi l'assistente dovrebbe
avvisare l'utente.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | Sì |

Restituisce `{activated, workspaceSwitched, workspaceInstanceId, activeTabId}`.

### `focus_window`

Porta in primo piano una finestra.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `windowLabel` | stringa | Sì |

---

## `document`

Leggere, scrivere, trasformare. La spina dorsale della superficie.

### `read`

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No (predefinito su quella in primo piano) |

Restituisce `{content, revision, filePath, kind, dirty}`. Leggi sempre prima di scrivere — il token `revision` deve accompagnare il prossimo `write`.

### `write`

Sostituisce il contenuto completo del documento.

| Parametro | Tipo | Richiesto | Descrizione |
|-----------|------|-----------|-------------|
| `tabId` | stringa | No | Scheda di destinazione (predefinito su quella in primo piano) |
| `content` | stringa | Sì | Nuovo contenuto completo |
| `expected_revision` | stringa | No | Token di revisione dalla lettura più recente |

Se viene fornito `expected_revision` e il documento è cambiato dopo quella lettura, la risposta è una busta di errore strutturato `STALE` con la revisione corrente; rileggi e riprova.

```json
// successo
{ "revision": "rev-newAfterWrite" }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

Applica una riscrittura deterministica. Attualmente supporta trasformazioni specifiche CJK (conversione punteggiatura larghezza intera ↔ ASCII, spaziatura CJK ↔ Latino).

| Parametro | Tipo | Richiesto | Descrizione |
|-----------|------|-----------|-------------|
| `tabId` | stringa | No | Scheda di destinazione |
| `kind` | stringa | Sì | `"cjk-format"`, `"cjk-spacing"` o `"cjk-punctuation"` |
| `expected_revision` | stringa | No | Token di concorrenza |

`cjk-format` applica le impostazioni di formattazione CJK dell'utente end-to-end. `cjk-spacing` inserisce singoli spazi tra caratteri CJK e Latini/cifre adiacenti. `cjk-punctuation` converte la punteggiatura ASCII che si trova accanto ai caratteri CJK nella sua forma a larghezza intera.

Restituisce `{revision}`.

---

## `workflow`

Validazione `actionlint` e **modifiche chirurgiche CST-safe** per lo YAML dei workflow GitHub Actions. Disponibile solo per le schede il cui `kind` è `"yaml-workflow"`.

::: info `document.read` / `document.write` funzionano su ogni scheda — incluso lo YAML del workflow
Lo strumento `workflow` **non** è un sostituto della spina dorsale lettura/scrittura. Per una scheda di workflow, puoi:

- `document.read` per ottenere il testo YAML grezzo (con tutti i commenti)
- `document.write` per sostituirlo interamente (qualsiasi stringa invii viene memorizzata letteralmente — i commenti vengono preservati se li includi)
- `workflow.apply_patch` quando vuoi che **il server stesso garantisca** che commenti, ancore e ordine delle chiavi sopravvivano a una modifica parziale

Usa `apply_patch` quando cambi un campo lasciando tutto il resto intatto (il server non può eliminare i commenti che non modifica). Usa `document.write` quando stai riscrivendo interamente o generando un nuovo workflow da zero.
:::

### `apply_patch`

Applica un array di oggetti `IRPatch`. Le patch sono inviate attraverso i mutatori CST-aware di VMark, che preservano commenti, ancore e ordine delle chiavi. Un `document.write` grezzo su un file YAML li perderebbe.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No |
| `patches` | IRPatch[] | Sì |
| `expected_revision` | stringa | No |

`IRPatch` è un'unione discriminata (campo `kind`). Tipi supportati:

| `kind` | Effetto |
|---|---|
| `workflow.set` | Imposta i campi top-level (`{path, value}`) — `name`, `env.X`, ecc. |
| `job.set` | Imposta un campo su un job (`{jobId, path, value}`) |
| `step.set` | Imposta un campo su uno step (`{jobId, stepIndex, path, value}`) |
| `with.set` | Imposta una chiave nel blocco `with:` di uno step (`{jobId, stepIndex, key, value}`) |
| `with.remove` | Rimuove una chiave dal blocco `with:` di uno step |
| `needs.add` / `needs.remove` | Aggiungi o rimuovi un ID job da `needs:` |
| `trigger.setFilters` | Sostituisci un array di filtri trigger — branches, paths, types, ecc. (`{event, filter, value: string[]}`) |

Restituisce `{revision}` in caso di successo o una busta di errore strutturato `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW`.

### `validate`

Esegui `actionlint` sullo YAML del workflow.

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No |

Restituisce `{ok, diagnostics, binaryAvailable}`. Ogni diagnostica trasporta `{line, col, message, severity}`. `binaryAvailable: false` significa che `actionlint` non è installato localmente; installa tramite Homebrew o le release upstream.

---

## `selection`

Leggi o sostituisci la selezione corrente dell'utente nell'editor. Usa questa invece di `document.read`/`document.write` quando l'utente ha evidenziato la regione da modificare — `selection.get` restituisce solo la porzione selezionata, e `selection.set` riscrive solo quell'intervallo, quindi il costo in token scala con la modifica, non con il documento.

::: warning La selezione è stato della vista — solo scheda in primo piano
La selezione esiste solo nell'editor attualmente renderizzato. Se viene fornito `tabId`, deve corrispondere alla scheda in primo piano; una discrepanza restituisce `INVALID_TAB`. Se la scheda in primo piano non ha un editor attivo (ad es. un visualizzatore in sola lettura), la risposta è `NO_EDITOR`.
:::

### `get`

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No |

Restituisce:

| Campo | Tipo | Note |
|---|---|---|
| `text` | stringa | Serializzazione Markdown della porzione selezionata (modalità WYSIWYG), o testo selezionato grezzo (modalità sorgente). Stringa vuota quando è collassata. |
| `isEmpty` | booleano | `true` quando la selezione è collassata (solo cursore). |
| `range` | `{from, to}` | Posizioni ProseMirror in modalità WYSIWYG; offset di caratteri in modalità sorgente. |
| `mode` | `"wysiwyg"` \| `"source"` | Disambigua lo spazio delle posizioni di `range`. |
| `kind` | `"markdown"` \| `"yaml-workflow"` | Discriminatore del tipo di documento. |
| `tabId` | stringa | Restituito per conferma. |
| `revision` | stringa | Da ripassare a `set` per la concorrenza ottimistica. |

### `set`

| Parametro | Tipo | Richiesto |
|-----------|------|-----------|
| `tabId` | stringa | No |
| `content` | stringa | Sì |
| `expected_revision` | stringa | No (consigliato) |

Sostituisce qualunque cosa l'editor riporti come selezione corrente. **In modalità WYSIWYG**, il testo inline semplice viene inserito come nodo di testo letterale così che gli spazi iniziali/finali facciano round-trip esattamente; il contenuto che porta marcatori markdown (`**bold**`, `*italic*`, `` `code` ``, codice recintato, citazioni, elenchi, ecc.) viene analizzato come markdown e inserito come i nodi corrispondenti. **In modalità sorgente**, `content` viene sempre inserito come testo grezzo — la superficie sorgente è già byte markdown. Un `content` vuoto elimina la selezione. Quando la selezione è collassata, `content` viene inserito in corrispondenza del cursore.

Restituisce `{revision, replaced_chars}` in caso di successo. `replaced_chars` è la lunghezza del testo che era selezionato prima della chiamata — utile all'IA per confermare di aver modificato ciò che si aspettava.

`STALE` restituisce `{error: "STALE", message, current_revision}` esattamente come `document.write`. La revisione a livello di documento intercetta le battiture tra `get` e `set`. Il puro spostamento del cursore (senza una battitura) non è arbitrato dal server — se l'utente ha spostato il cursore tra `get` e `set`, la modifica finisce nella nuova posizione.

---

## `browser`

La metà **mutante** della superficie del browser integrato — tutto ciò che modifica la pagina,
la scheda o un accesso memorizzato. Leggi prima la pagina con [`browser_read`](#browser-read):
ogni modalità di targeting qui fa riferimento a ciò che una lettura ha restituito.

Gli strumenti del browser seguono **Impostazioni → Avanzate → macOS → Browser integrato**, che è
**attivo per impostazione predefinita** su macOS — quindi questi strumenti sono disponibili a un
client IA connesso a meno che tu non lo disattivi. Ogni azione fallisce con `BROWSER_DISABLED`
mentre è disattivato. Gli URL restituiti a MCP sono oscurati attraverso lo stesso confine usato
dallo stato della sessione del browser dell'app.

Annotato `readOnlyHint: false, destructiveHint: true` — accurato piuttosto che semplicemente
conservativo, perché ogni azione qui modifica qualcosa.

### `act`

Argomenti: `tabId?`, `operation: "click" | "type" | "scroll" | "key"` e destinazioni per
operazione:

- **click / type** — una destinazione, o `ref` (da una lettura precedente) **oppure** `role` + `name`,
  e `text?` per la digitazione. Un `ref` è preciso e indipendente dall'ordine, ma è onorato solo per
  un'operazione **già concessa**; se l'azione può richiedere approvazione, usa `role` + `name` così
  il prompt mostra all'utente un elemento leggibile.
- **scroll** — `ref` (portalo in vista) **oppure** `dy` (un delta verticale in pixel).
- **key** — `key` (ad es. `"Enter"`, `"Escape"`, `"Tab"`), un `ref` opzionale per la destinazione, e
  `modifiers: {ctrl, shift, alt, meta}` opzionali.

`scroll` e `key` sono di classe act (soggette ad approvazione) e inviano eventi DOM **sintetici**,
quindi un sito che si basa su `event.isTrusted` potrebbe ignorarli. Le operazioni mutanti richiedono
un'approvazione con ambito all'origine; i caricamenti scelti dall'IA non sono mai permessi.

**Un click verifica il proprio effetto prima di segnalare il successo.** La destinazione viene
portata in vista, deve essere renderizzata in modo visibile (vengono controllati gli stili calcolati
e gli antenati collassati, così un pulsante duplicato dentro uno step di accordion chiuso viene
saltato, non cliccato), e il punto del click viene sottoposto a hit-test — una destinazione coperta
da un overlay viene rifiutata nominando l'elemento occludente (`covered by div.cmp-overlay`) invece
di cliccarci attraverso. I risultati role + name riportano i conteggi `matchedTotal` /
`matchedVisible` così l'ambiguità è visibile, e ogni risposta act include l'`url` e la `generation`
correnti della scheda. `type` gestisce campi di testo, controlli `<select>` (passa l'etichetta o il
valore dell'opzione; un'opzione mancante viene rifiutata come `no-such-option`) e regioni
`contenteditable`.

### `workflow_run` / `workflow_cancel`

`workflow_run` esegue un workflow che fornisci come testo `source` su una scheda di proprietà
dell'IA. Argomenti: `tabId?`, `source` (il testo del workflow — una piccola grammatica orientata
alle righe; lo scrivi tu, lo fa l'IA, o [`workflow_record`](#workflow-record) lo cattura dalle tue stesse azioni), `inputs?` (una mappa `{name: value}` sostituita nei
riferimenti `{name}`), `allowRepeat?`. Restituisce `{runId, steps}` **immediatamente** —
l'esecuzione avviene in modo **asincrono**, perché un'esecuzione multi-step può sopravvivere a una
singola richiesta. Interroga il `workflow_status` di [`browser_read`](#browser-read) per il progresso.

Gli step deterministici — `click` / `type` / `navigate` in quella grammatica, ed `extract`
— vengono eseguiti dentro VMark e sono **soggetti ad approvazione individualmente**, esattamente
come un `act` emesso a mano: l'esecuzione autorizza ciascuno per conto proprio, quindi un workflow
non è un modo per aggirare i prompt di approvazione. `goal`, `confirm`, `api` e qualsiasi step in
prosa libera **mettono in pausa** l'esecuzione affinché l'IA la gestisca a mano. Una nuova
esecuzione **salta gli step di scrittura già riusciti** in questa sessione (il registro delle
scritture completate), a meno che `allowRepeat` non sia impostato — così rieseguire dopo una pausa
non invia due volte.

`workflow_cancel {tabId?, runId}` interrompe un'esecuzione. **Non è mai soggetta ad approvazione** —
fermare è sempre permesso — e ritira i prompt in sospeso dell'esecuzione e ti restituisce la scheda.
L'esecuzione si ferma anche nel momento in cui prendi il controllo del browser (qualsiasi interazione
con la pagina o la sua interfaccia riprende il controllo).

Le esecuzioni sono limitate (≤ 25 step, ≤ 120 s, source ≤ 64 KiB) e una alla volta per scheda.

### `workflow_record`

Registra le **tue stesse azioni** su una scheda di proprietà dell'IA in un workflow riproducibile.
Argomenti: `tabId?`, `recordOp` (`"start"` o `"stop"`) e `site?` (l'id del sito nel front-matter
del workflow registrato; il valore predefinito è `recording`).

`start` è **soggetto a consenso** tramite il permesso `record` che — come `execute_js` e
`session` — **non è mai una concessione permanente**: ogni registrazione ti chiede il permesso da
capo, così l'IA non può mai registrarti in silenzio. Finché non lo consenti, `start` restituisce
`needsApproval`; una volta fatto, VMark arma uno shim di cattura dormiente nel mondo della pagina e
inizia a registrare i **clic e le modifiche ai campi** che esegui. `stop` restituisce
`{source, inputs, eventCount}` — il `source` è testo del workflow che puoi salvare o passare
direttamente a [`workflow_run`](#workflow-run).

La registrazione è **priva di valori per costruzione**, e non è un filtro che si fida della pagina:
nulla di ciò che digiti viene mai catturato. Ogni campo di testo diventa una variabile `{input}` con
nome (il valore è fornito durante la riproduzione, mai registrato); un **campo password o di codice
monouso** diventa un passaggio `confirm:` — un cancello umano che completi a mano durante la
riproduzione — così un segreto non viene mai nemmeno parametrizzato; e ogni URL viene ridotto a
origine + percorso, così un token in una stringa di query non può sopravvivere. Ciò che viene
registrato sono i **localizzatori** che hai toccato (ruolo ARIA + nome accessibile), mai i loro dati.
La registrazione ti segue attraverso le navigazioni tra pagine ed è limitata (200 eventi per pagina,
1.000 per sessione).

### `open`

Argomenti: `url` e `timeoutMs` opzionale (1–12.000 ms). Crea una scheda di proprietà dell'IA usando
la postura Sandbox o Condivisa corrente e restituisce il suo `tabId`, `navigationId`, URL, titolo e
generation dopo il completamento del caricamento.

### `navigate`

Argomenti: `tabId?`, `url` e `timeoutMs` opzionale. Naviga una scheda di proprietà dell'IA e
restituisce il risultato del ticket di navigazione. Un timeout restituisce comunque il ticket così
che un successivo `wait` possa recuperare il risultato finale.

**Rilevamento dei gate.** Un risultato di `open` / `navigate` / `wait` caricato può contenere
`gate: {kind, hint}` quando la pagina raggiunta si presenta come un **muro di login**, un
**interstiziale di consenso**, una **sfida di verifica umana** o un **limite di frequenza** — così
l'IA scopre che non sta guardando il contenuto che ha richiesto, nel momento in cui legge il
risultato. Il rilevamento privilegia la precisione (un widget di sfida renderizzato, o almeno due
segnali indipendenti su una pagina scarna — un prezzo `$429`, un footer «Protected by Cloudflare», o
un articolo *sui* CAPTCHA non vengono mai classificati) ed è puramente consultivo: cambia ciò che
viene detto all'IA, mai ciò che è autorizzato, e ogni suggerimento punta a coinvolgere te piuttosto
che ad aggirare il gate.

### `style`

Argomenti: `tabId?`, una destinazione (`ref` **oppure** `selector`) e uno tra `set: {prop: value}`,
`addClasses`, `removeClasses` o `injectCss`. Rimuovi un overlay bloccante, evidenzia una destinazione,
ecc. **Classe act** (soggetta ad approvazione, op `style`). Mondo di contenuto isolato.

### `execute_js`

Argomenti: `tabId?`, `script` (deve fare `return` di un valore serializzabile in JSON). La via di
fuga per ciò che i verbi strutturati non possono esprimere. Viene eseguito nel **mondo di contenuto
isolato** — condivide il DOM (quindi `querySelector`, `element.style` funzionano) ma **non può**
vedere l'heap/le globali JS proprie della pagina. È approvato **solo per ogni chiamata** (mai una
concessione permanente, imposto nel driver Rust), l'approvazione mostra lo script, e il valore
restituito è contrassegnato come **non attendibile** e non viene mai inoltrato automaticamente a un
`act` successivo. Preferisci prima `query`/`style`.

### `session_save` / `session_load`

Argomenti: `tabId?`, `handle` (`[A-Za-z0-9._-]`, 1–128 caratteri). `session_save` cattura
un'istantanea della sessione della scheda in una voce del **keychain del sistema operativo**
identificata da `handle` e restituisce un riepilogo privo di valori (conteggi); `session_load` la
ripristina e restituisce `{loaded: true, handle}` — una conferma più l'handle fornito dall'IA, mai
alcun valore. Un `session_load` si applica solo a una pagina con la **stessa origine** da cui la
sessione è stata salvata. Questa è una credenziale **per riferimento** (ADR-A7): l'IA nomina una
sessione salvata e non riceve mai valori di cookie/token, che non vengono mai registrati. Entrambe
usano il permesso `session` — **mai una concessione permanente** (approvata per ogni chiamata), e
un'approvazione per un handle non può essere spesa per un altro. *Oggi questo copre `localStorage`;
la cattura dei cookie è un'attività di follow-up in fase di test dal vivo.*

### `console_clear`

Argomenti: `tabId?`. Restituisce `{entries: [{level, text}], url}` esattamente come il `console` di
[`browser_read`](#browser-read), **e svuota il buffer** così che la lettura successiva veda solo il
nuovo output. Si trova qui invece che con l'altra lettura della console perché lo svuotamento valuta
`element.textContent = "[]"` nella pagina — una scrittura sul DOM.

La postura Condivisa chiede l'approvazione della destinazione per ogni nuova origine a meno che non
esista una concessione `navigate` corrispondente. Una scheda creata da un umano richiede
un'approvazione di collegamento effimero prima della lettura/azione dell'IA. Le schede Sandbox usano
un archivio di cookie IA separato e non persistente.

---

## `browser_read`

La metà **in sola lettura**: osserva la scheda senza modificarla. Annotato
`readOnlyHint: true`, quindi un client MCP può auto-approvarla — che è lo scopo della divisione.
Queste azioni un tempo risiedevano in `browser`, dove un'unica annotazione a livello di strumento
doveva descrivere anche `execute_js`, così scattare uno snapshot ARIA costava un'approvazione umana.

`openWorldHint` resta `true`: sola lettura descrive ciò che lo strumento *modifica*, non se i byte
possono essere considerati attendibili. Tutto ciò che viene restituito è controllato dalla pagina e
**non attendibile** — non reinserire mai un risultato direttamente come destinazione di un'azione
`browser`.

### `read`

Restituisce `{url, snapshot}` per la scheda del browser in primo piano, o per la scheda indicata da
`tabId`. `snapshot` è un elenco orientato ad ARIA di `{role, name, ref}` — ogni `ref` (ad es. `"e5"`)
è un handle stabile per quell'elemento, valido per la durata della vista corrente.

### `screenshot`

Argomenti: `tabId?`. Restituisce un **blocco di contenuto immagine** (JPEG base64, con qualità
limitata) del rendering corrente della scheda, più una riga di testo che nomina la pagina — un canale
visivo sul layout e sullo stato renderizzato che lo snapshot ARIA non può descrivere. Viene catturato
nativamente (`takeSnapshot`) e non legge alcun DOM o JavaScript della pagina. Classe read: autorizzato
esattamente come `read` (permesso su una scheda di proprietà dell'IA; una scheda umana richiede un
collegamento, consumato alla cattura).

### `query`

Argomenti: `tabId?`, `selector` (CSS) e `fields: {attributes, box, styles:[...]}` opzionale.
Restituisce `{count, elements: [{ref, tag, text, …}]}` — dati DOM strutturati che lo snapshot ARIA
non può nominare (tabelle, valori calcolati). **Classe read.** Viene eseguito nel mondo di contenuto
isolato.

### `extract`

Argomenti: `tabId?`. Restituisce `{title, byline, url, markdown, textLength, truncated}` — la pagina
come **Markdown in modalità lettura**, per le pagine che l'IA vuole *leggere* anziché operare. Una
singola cattura limitata esporta l'HTML della pagina; l'estrazione stessa viene eseguita in VMark, mai
nella pagina: un **plugin del sito** registrato per l'origine ha la precedenza (il plugin Wikipedia
integrato rimuove l'interfaccia wiki — infobox, navbox, hatnote, link di modifica — per nome), e un
lettore generico basato su euristica di densità è il ripiego per ogni altro sito. `truncated: true`
significa che la pagina ha superato il limite di cattura e la coda non è stata letta. **Classe read.**
Tutto ciò che viene restituito deriva dalla pagina e non è attendibile.

### `workflow_status`

Argomenti: `tabId?`, `runId` (da `workflow_run`). Restituisce `{status, completedSteps, stepCount,
pausedAt?, reasonCode?, reason?, stepResults}` dove `status` è uno tra `running` / `paused` /
`completed` / `failed` / `cancelled`. Uno stato `paused` nomina in `pausedAt` lo step che ha bisogno
di te. **Classe read** — interrogalo liberamente.

### `console`

Argomenti: `tabId?`. Restituisce `{entries: [{level, text}], url}` — l'output `console.*` catturato
dalla pagina, più gli **errori non catturati e i rifiuti di promise non gestiti** (registrati come
voci `level: "error"` con prefisso `Uncaught` / `Unhandled rejection:` — il segnale che il solo
patching di `console.*` non vede mai). Solo schede Sandbox. La cattura funziona tramite uno shim nel
mondo della pagina che scrive in un buffer DOM nascosto, che il driver legge dal mondo isolato —
quindi **nessun canale di messaggistica** viene aperto verso VMark (la garanzia no-bridge regge).
L'output è controllato dalla pagina e **non attendibile** — trattalo come un `read`, mai come una
destinazione `act`.

Il buffer è un anello limitato, quindi letture consecutive si sovrappongono. Per svuotarlo man mano
che leggi, usa il `console_clear` di [`browser`](#browser) — lo svuotamento scrive `[]` nell'elemento
buffer della pagina, che è una scrittura sul DOM e quindi non può stare sotto `readOnlyHint: true`.

### `wait`

Argomenti: `tabId?`, `navigationId` opzionale e `timeoutMs` opzionale. Non avvia mai una navigazione.
Restituisce un risultato di caricamento/fallimento bufferizzato, `NAVIGATION_SUPERSEDED`, o `TIMEOUT`
quando il ticket non termina entro il limite.

### `wait_for`

Argomenti: `tabId?`, esattamente uno tra `ref` (da una lettura), `role` (+ `name` opzionale), `text`
(una sottostringa del testo visibile) o `urlContains` (una sottostringa che l'URL della scheda deve
contenere — conferma che una navigazione innescata da un click sia andata a buon fine, rispondendo
dallo stato della scheda senza un round-trip verso la pagina), e `timeoutMs` opzionale (1–12.000 ms).
Interroga finché la condizione non è soddisfatta o il timeout non scade e restituisce
`{matched: true|false}` (più il `ref` dell'elemento trovato per una condizione ref/role) — così puoi
distinguere «trovato» da «tempo scaduto». Classe read. Usalo per rendere un flusso deterministico:
agisci, `wait_for` sul risultato, poi leggi.

---

## `coherence`

Una vista in **sola lettura** del livello di coerenza del workspace — quali documenti derivati sono obsoleti rispetto alle sorgenti da cui sono stati generati. Nessuna azione modifica documenti o stato dell'editor. `status` è in sola lettura; `edges` riconcilia prima e può aggiungere record di provenienza al registro (ledger) del workspace, ma non cambia mai il contenuto dei documenti. Tutte sono servite interamente dal backend Rust a partire dal kernel per workspace, quindi funzionano anche quando nessuna finestra dell'editor è in primo piano.

Due ulteriori azioni in sola lettura espongono il livello semantico:

- `claims` — le affermazioni canoniche correnti: `{claim, entryId, statement, maturity, invalidAt, visible}`. Solo le affermazioni `established` vincolano le verifiche semantiche; `visible` riflette il contesto default.
- `contexts` — l'insieme dei contesti (il `default` implicito è sempre presente): `{id, name, parent, enforcement, visibleClaims, errors}`.

Annotato `readOnlyHint: true`. L'unica azione mutante, `resolve`, vive nel suo strumento — vedi [`coherence_resolve`](#coherence-resolve) — che è ciò che permette a questa di essere auto-approvabile. La mutazione di affermazioni e contesti non è mai esposta: il canone resta sotto controllo umano.

Tutte le azioni richiedono `workspace_root`: il percorso assoluto del workspace da interrogare. Ricavalo da `session.get_state` (il `filePath` delle schede aperte) o dallo strumento workspace. Un percorso mancante, non assoluto o che non è una directory viene rifiutato con un errore in forma di stringa semplice.

### `status`

Contatori di stato del kernel per un workspace.

| Parametro | Tipo | Richiesto | Descrizione |
|-----------|------|-----------|-------------|
| `workspace_root` | stringa | Sì | Percorso assoluto del workspace da interrogare |

**Restituisce:**

```json
{
  "initialized": true,
  "objects": 12,
  "open_items": 2,
  "quarantined": 0,
  "writer": "0198c0de-0000-7000-8000-000000000001"
}
```

| Campo | Significato |
|---|---|
| `initialized` | `false` quando il workspace non ha ancora un registro di coerenza (nessuna directory `.vmark/`). In quel caso tutti i contatori tranne `objects` sono 0. |
| `objects` | Oggetti tracciati (file con un'identità di coerenza). |
| `open_items` | Archi vivi non freschi — la dimensione corrente del dettaglio. |
| `quarantined` | Righe malformate del registro messe in quarantena all'ultima lettura. |
| `writer` | L'ID writer (UUID) di questa installazione. |

### `edges`

Il dettaglio: ogni arco di dipendenza vivo la cui sorgente si è mossa. Esegue prima una riconciliazione con scansione, quindi la risposta riflette i file su disco al momento della chiamata.

| Parametro | Tipo | Richiesto | Descrizione |
|-----------|------|-----------|-------------|
| `workspace_root` | stringa | Sì | Percorso assoluto del workspace da interrogare |

**Restituisce** un array — vuoto quando tutto è coerente:

```json
[
  {
    "txf": "0198c0de-0000-7000-8000-00000000000a",
    "input": 0,
    "upstream": "0198c0de-0000-7000-8000-00000000000b",
    "upstream_path": "characters/elena.md",
    "pinned": "rev-a1b2c3",
    "downstream": "0198c0de-0000-7000-8000-00000000000c",
    "downstream_path": "scenes/chapter-3.md",
    "downstream_rev": "rev-d4e5f6",
    "state": "version-stale"
  }
]
```

| Campo | Significato |
|---|---|
| `txf` / `input` | La voce di trasformazione e lo slot di input che identificano questo arco (passali alle azioni di risoluzione nell'app). |
| `upstream` / `upstream_path` | L'oggetto da cui dipende il derivato, e il suo ultimo percorso noto. |
| `pinned` | La revisione della sorgente da cui è stato generato il derivato. |
| `downstream` / `downstream_path` / `downstream_rev` | L'oggetto derivato, il suo percorso e la sua revisione corrente. |
| `state` | `"version-stale"`, `"stale-valid"`, `"stale-contradicted"`, `"stale-unknown"`, `"waived"`, `"diverged"`, `"diverged-multi-head"` o `"unpinnable"`. |

Risolvere un arco (accept-newer / waive) è normalmente un'azione umana eseguita nella vista di dettaglio di VMark. Un'IA può farlo solo tramite [`coherence_resolve`](#coherence-resolve), e solo quando il proprietario del workspace gliel'ha esplicitamente delegato.

---

## `coherence_resolve`

L'**unica azione mutante** sul livello di coerenza, nel suo strumento così che
[`coherence`](#coherence) possa restare auto-approvabile — e così che qualcosa di non annullabile sia
ben visibile nell'elenco degli strumenti invece di essere sepolto come un valore enum tra cinque.
Annotato `readOnlyHint: false, destructiveHint: true`.

### `resolve`

Argomenti: `{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`.
`txf` e `input` provengono da una riga `coherence` → `edges`.

Risolvi un arco obsoleto attivo come agente esplicitamente delegato. L'autorizzazione è **fail-closed**:
il proprietario del workspace deve aver concesso alla **tua identità di bridge autenticata** una delega
attiva e non scaduta che copra il tipo di risoluzione (concessa nell'app, dalla vista di dettaglio), e
l'arco deve essere ancora attivo. Ogni risoluzione delegata viene registrata nel log di audit a fronte
della concessione, e la voce non può essere annullata.

Un rifiuto significa che la concessione è mancante o scaduta — chiedi all'utente di concederla invece
di riprovare. Separare questa da `coherence` non ha cambiato alcuna proprietà di sicurezza:
l'autorizzazione si è sempre basata sul principal di bridge autenticato, mai su qualcosa che il client
afferma.

---

## Errori

Compaiono due forme di errore:

**Errori di dominio** — impostano `success: false` e restituiscono una busta codificata in JSON in `error`:

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**Errori sulla forma degli argomenti** — per argomenti richiesti mancanti/non validi (ad es. `document.write` senza un campo `content`), `error` è una stringa semplice che descrive il problema. La busta strutturata è riservata alle condizioni a livello di dominio.

| Codice | Mostrato come | Significato |
|---|---|---|
| `STALE` | busta | `expected_revision` non corrispondeva; rileggi e riprova |
| `INVALID_PATCH` | busta | `workflow.apply_patch` ha ricevuto un array `patches` malformato |
| `INVALID_TAB` | busta | `tabId` non poteva essere risolto |
| `INVALID_PATH` | busta | Un `filePath` non poteva essere letto, o è al di fuori dell'ambito del workspace aperto / del documento |
| `APPROVAL_REQUIRED` | busta | `save_as` verso una nuova posizione mentre **Approva automaticamente le modifiche** è disattivato |
| `NOT_WORKFLOW` | busta | `workflow.*` è stato chiamato su una scheda non YAML-workflow |
| `READ_ONLY` | busta | È stata tentata una mutazione su un documento di sola lettura |
| `NO_EDITOR` | busta | `selection.*` è stato chiamato ma la scheda in primo piano non ha un editor attivo |
| `INTERNAL` | busta | Errore inaspettato del gestore |
| (stringa semplice) | stringa | Argomento richiesto mancante o tipo errato |
