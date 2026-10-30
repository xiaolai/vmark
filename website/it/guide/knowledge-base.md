# Base di conoscenza e Slidev

VMark può servire l'intero spazio di lavoro come una knowledge base navigabile e
con collegamenti incrociati, e mostrare in anteprima ed esportare presentazioni
[Slidev](https://sli.dev) — entrambe le funzioni si basano su un unico server di
contenuti locale che VMark avvia su richiesta.

::: warning Stato
Questa funzionalità viene distribuita per fasi, e **nessuna build di rilascio, su
nessuna piattaforma, include il runtime del server di contenuti** da cui dipende —
vedi [Requisiti](#requisiti). Per questo motivo è **nascosta a meno che la modalità
sviluppatore non sia attiva**: la voce del menu Vista, la voce della palette dei
comandi e la scorciatoia `Ctrl + Shift + 4` compaiono solo dopo aver abilitato
**Impostazioni → Avanzate → Strumenti sviluppatore**. Attivala e apri il pannello
**Knowledge base** per vedere cosa è presente sulla tua macchina e cosa manca.
:::

## Requisiti

La knowledge base, il suo grafo delle relazioni, la ricerca, il ricaricamento dal
vivo e l'anteprima Slidev girano tutti su un unico server di contenuti locale — un
programma Node.js separato che VMark avvia su richiesta. Prima che possa partire
devono essere presenti due cose:

- **Node.js.** VMark risolve `node` tramite il `PATH` della tua shell di login,
  come farebbe un terminale, quindi un Node.js visibile solo a uno strumento locale
  del progetto non conta. Installalo in modo che `node` sia nel `PATH` della shell
  di login.
- **Il server di contenuti stesso** (`server/content` nel repository di VMark,
  compilato in un `cli.js`). **Nessuna build pacchettizzata di VMark lo include
  ancora — su nessuna piattaforma.** Non si tratta di una lacuna di Linux o
  Windows: nemmeno il DMG per macOS include un runtime del server di contenuti, e i
  controlli di rilascio di VMark lo verificano a ogni rilascio. Finché non ci sarà
  una soluzione per la distribuzione, la funzionalità richiede un ambiente di
  sviluppo — un checkout di VMark con il server di contenuti compilato, reso
  disponibile tramite la variabile d'ambiente `VMARK_CONTENT_SERVER_CLI` (oppure un
  runtime `base-kb` che collochi a mano nei dati applicativi di VMark; VMark non ne scarica mai uno).

Il pannello verifica entrambi quando si apre. Se manca uno dei due, indica quale e
cosa lo fornirebbe, invece di tentare un avvio destinato a fallire.

## Aprire il pannello

La Knowledge base è **nascosta per impostazione predefinita**, perché una build di
rilascio non può avviarla. Per mostrarla, attiva **Impostazioni → Avanzate →
Strumenti sviluppatore**. La voce di menu **Vista → Knowledge base**, la voce della
palette dei comandi ("Attiva/disattiva knowledge base") e la scorciatoia
`Ctrl + Shift + 4` compaiono insieme ad essa, e scompaiono di nuovo quando la
disattivi.

Con gli Strumenti sviluppatore attivi, apri il pannello da **Vista → Knowledge
base**, dalla palette dei comandi o con `Ctrl + Shift + 4`. Il pannello si aggancia
a destra; attivalo di nuovo per nasconderlo.

Disattivare di nuovo gli Strumenti sviluppatore nasconde i punti di accesso e
chiude anche il pannello: il pannello non ha un pulsante di chiusura proprio, quindi
lasciarlo aperto lascerebbe un riquadro che nulla potrebbe chiudere. Un server già
**in esecuzione** non viene toccato — riattiva gli Strumenti sviluppatore per
raggiungere il suo pulsante Arresta; in ogni caso VMark arresta i propri server di
contenuti quando si chiude.

## Knowledge base

Apri uno spazio di lavoro e avvia il pannello **Knowledge base**. VMark lancia un
server locale associato a `127.0.0.1` (solo loopback) e rende ogni file markdown
come HTML usando la stessa semantica markdown dell'editor — wiki link, avvisi,
formule matematiche, tabelle, elenchi di attività e blocchi details vengono resi
in modo identico.

Funzionalità:

- **Navigazione tramite wiki link** — `[[Page]]`, `[[dir/Page]]`, `[[Page#Heading]]`
  e `[[Page|Alias]]` vengono risolti in tutto lo spazio di lavoro. I collegamenti non
  risolti sono mostrati come "mancanti", così le lacune restano visibili.
- **Grafo delle relazioni** — note, tag (`#tag` e `tags:` nel frontmatter) e
  relazioni tipizzate nel frontmatter (`up`, `related`, `links`, …) formano un grafo
  interattivo con backlink.
- **Ricerca a testo completo** in tutto lo spazio di lavoro.
- **Ricaricamento dal vivo** — le modifiche salvate aggiornano automaticamente le
  pagine servite.

Puoi consultare la knowledge base dentro VMark (pannello integrato) oppure
**aprirla nel browser** — l'azione "Apri nel browser" esegue un handshake
autenticato una tantum, così il browser riceve un cookie di sessione. Il server è
solo loopback e protetto da cookie; non espone mai il tuo spazio di lavoro al di
fuori della tua macchina.

## Presentazioni Slidev

Quando apri un file markdown il cui frontmatter lo contrassegna come presentazione
Slidev (ad es. `theme:`, `layout:` + diapositive, oppure un esplicito
`format: slidev`), VMark può eseguire la vera toolchain di Slidev per mostrarlo in
anteprima dal vivo — lo stesso renderer usato da Slidev, quindi layout, animazioni
al clic e componenti sono completamente fedeli.

Con la presentazione aperta e il pannello Knowledge base in esecuzione, usa
**Anteprima diapositive** per aprire la presentazione dal vivo nel browser ed
**Esporta diapositive** per renderizzarla. Slidev osserva la presentazione su
disco, quindi salvare le modifiche in VMark ricarica al volo l'anteprima aperta.

### Esportazione

Le presentazioni Slidev si esportano in **PDF**, **PNG** o **PPTX**. Il server di
contenuti esegue il comando `slidev export` di Slidev, che renderizza le
diapositive in Chromium tramite il pacchetto `playwright-chromium`. VMark non
scarica né cerca un browser per questo: se `playwright-chromium` non è installato
accanto a Slidev nel runtime del server di contenuti, l'esportazione fallisce e
mostra il messaggio di errore di Slidev. Un'esportazione che dura più di tre minuti
viene interrotta.

**Esporta diapositive** chiede dove salvare con il pannello di salvataggio nativo
di VMark, e l'esportazione scrive solo nel percorso scelto lì; l'estensione del
file deve corrispondere al formato (`.pdf`, `.png`, `.pptx`).

## Privacy e sicurezza

- Il server si associa solo a `127.0.0.1` e richiede un token per sessione
  (consegnato come cookie HttpOnly, SameSite=Strict).
- L'accesso ai file è limitato alla radice dello spazio di lavoro; l'attraversamento
  dei percorsi viene rifiutato e i link simbolici non vengono seguiti.
- L'HTML renderizzato viene sanificato e servito con una content security policy.
  **L'attendibilità dello spazio di lavoro cambia esattamente una cosa: se le
  immagini remote vengono mostrate.** VMark passa l'attendibilità dello spazio di
  lavoro al server quando lo avvia; per uno spazio di lavoro attendibile la policy
  allenta `img-src` in modo che le immagini `https:` vengano caricate, mentre per
  uno spazio di lavoro non attendibile vengono mostrate solo le immagini locali e
  inline. L'attendibilità non decide se uno spazio di lavoro venga servito —
  qualsiasi spazio di lavoro aperto può esserlo. Modificare l'attendibilità di uno
  spazio di lavoro mentre la sua knowledge base è in esecuzione riavvia il server,
  così la policy segue la modifica.
