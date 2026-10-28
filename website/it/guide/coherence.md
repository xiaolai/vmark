# Coerenza e la vista di dettaglio

Il livello di coerenza di VMark mantiene onesti i progetti di scrittura sviluppati ricorsivamente: registra **quali documenti ha letto davvero ogni generazione IA**, si accorge quando quei documenti sorgente cambiano in seguito e ti mostra — su richiesta — esattamente quali artefatti derivati potrebbero ora essere obsoleti. Nulla viene mai aggiornato automaticamente; il caporedattore resti tu.

## Come funziona (30 secondi)

- **Il tracciamento della provenienza è facoltativo.** Attiva prima *Impostazioni → File e immagini → Salvataggio → Inserisci il blocco identità al salvataggio*. Fino ad allora nessuna scrittura — un salvataggio, l'applicazione di un genie, un suggerimento IA accettato, una scrittura via MCP, il ripristino di una versione precedente o un nuovo file dall'esplora file — marca i tuoi file o crea `.vmark/`.
- Una volta attivata l'opzione, ogni salvataggio, applicazione di un genie, suggerimento IA accettato, scrittura via MCP, ripristino di una versione precedente e step `save-file` di un workflow viene registrato come **trasformazione** in un registro (ledger) in testo semplice dentro il tuo workspace (`.vmark/` — JSONL git-friendly e leggibile; eliminare l'`index.db` derivato non perde nulla).
- **Un workspace che ha già un registro** — un `.vmark/` che hai creato in precedenza o che un collaboratore ha committato — continua a registrare le scritture sui documenti che segue, anche con l'opzione disattivata. Un documento conta come seguito quando il registro lo ha già annotato in precedenza, oppure quando il file porta già una propria identità `vmark:` — un file già seguito che hai spostato, copiato nel workspace o recuperato con un checkout; la scansione del registro stesso adotta proprio questi. Non marca nulla: un documento senza identità viene escluso, e una scrittura i cui input risultano così incompleti viene registrata come `inferred` anziché `exact`.
- Quando un'IA scrive un documento mentre ne legge altri, quelle letture diventano **archi di dipendenza**, fissati alla revisione che è stata letta. I percorsi strumentati all'interno dell'app registrano input `exact`; una scrittura via MCP registra onestamente un insieme di letture `inferred` — solo ciò che lo stesso client ha letto sulla propria connessione — e indica il client che l'ha eseguita.
- Quando un documento sorgente avanza oltre una revisione fissata, l'arco diventa **obsoleto**. Se due revisioni sono evolute in parallelo (ad es. su branch git), l'arco è **divergente** — segnalato, mai indovinato.
- I file modificati fuori da VMark (terminale, altri editor) vengono riconciliati alla scansione come *modifiche esterne osservate* — la cronologia resta senza lacune, contrassegnata onestamente come di provenienza sconosciuta.

## La vista di dettaglio

Aprila da **Finestra → Dettaglio coerenza** (o dalla palette dei comandi: "Dettaglio coerenza"). È strettamente **pull**: si aggiorna quando la apri o premi aggiorna — non ti assilla mai in background.

Gli elementi sono raggruppati per artefatto (il documento derivato) e mostrano il documento sorgente, la revisione fissata e lo stato corrente:

| Stato | Significato |
|---|---|
| `version-stale` | La sorgente è avanzata oltre ciò da cui questo artefatto è stato costruito |
| `diverged` | La revisione fissata e quella corrente sono parallele — nessuna linea di discendenza |
| `diverged-multi-head` | La sorgente stessa ha versioni correnti parallele |
| `waived` | Hai accettato la divergenza, con un motivo registrato |
| `unpinnable` | La sorgente non può essere risolta (ad es. un pin non valido) |

### Azioni

Ogni elemento offre tre azioni oneste — nessuna riscrive la cronologia:

- **Accetta più recente** — registra che l'artefatto è ancora compatibile con la sorgente più recente (una *ratifica*). L'elemento esce dalla lista; se la sorgente cambia di nuovo, ricompare.
- **Rivedi** — apre l'artefatto così puoi aggiornarlo. Salvare una nuova versione ritira l'arco vecchio.
- **Esenta** — registra una divergenza intenzionale con un **motivo obbligatorio** (i narratori inaffidabili esistono). Nella v0 un'esenzione è volutamente circoscritta: si applica solo a questo arco e alla specifica revisione della sorgente rispetto a cui viene risolta. Gli elementi esentati restano visibili, contrassegnati in modo distinto, e si riaprono se la sorgente si muove ancora.

Accetta più recente ed esenta sono disabilitati quando la sorgente ha più versioni correnti — non c'è un'unica revisione con cui risolvere; prima rivedi (o riconcilia le versioni).

## Silenziare le segnalazioni che non ti servono

Due controlli su ogni riga della vista di dettaglio restringono ciò su cui il livello ti interpella. Entrambi sono esclusivamente umani — nessuno strumento MCP può impostarli.

**Segna come concluso (ciclo di vita del documento).** Quando un documento derivato è finito — un capitolo pubblicato, un rapporto consegnato — scegli **Segna come concluso** su una qualsiasi delle sue righe. Silenzia ogni dipendenza verso quel documento, comprese quelle non elencate al momento, ed è per questo che chiede conferma. I suoi archi si spostano nel gruppo compresso **Nessuna domanda su questi** in fondo al pannello, etichettati *documento concluso*: ancora tracciati, ancora visibili su richiesta, semplicemente non ti interrompono più. **Riapri** li riporta indietro con un solo clic e senza conferma, perché riaprire non fa che aggiungere di nuovo interruzioni. Il ciclo di vita viene registrato nel registro, non nel frontmatter, quindi segnare un documento come concluso non ne crea una nuova revisione.

**Ancore di sezione.** Un arco non ancorato chiede «il file sorgente è cambiato?». **Ancora a una sezione** lo restringe a «la sezione da cui dipendo è cambiata?»: scegli un'intestazione del documento sorgente e l'arco viene fissato al percorso di quell'intestazione. Finché la sezione ancorata resta invariata, una modifica altrove nella sorgente lascia l'arco nel gruppo silenziato come *sezione di riferimento invariata*; una modifica all'interno della sezione lo fa emergere come *sezione ancorata modificata*. Se l'intestazione scompare, l'arco viene segnalato come *ancora persa* invece di tornare in silenzio al comportamento sull'intero file. **Cambia ancora** lo fissa di nuovo e **Intero file** rimuove l'ancora. Le ancore sono voci del registro a sé stanti, rivedibili, quindi seguono l'arco attraverso le revisioni successive.

## Il registro di coerenza e il giudizio sulle segnalazioni

Il **Registro di coerenza** (una sezione espandibile nel pannello di dettaglio) è la cronologia per arco conservata nel registro (ledger): ogni verifica, ratifica ed esenzione, quante volte ciascun arco è stato risolto (*risolto 3 volte*) e quanti archi sono stati risolti più di una volta — il ricambio continuo, che è il vero peso di un grafo delle dipendenze rumoroso. Una verifica semantica a cui il modello ha risposto sotto la soglia di confidenza viene mostrata con il verdetto e la confidenza conservati (*il modello ha detto … a …, sotto la soglia*), così «nessun segnale» e «ha risposto, ma senza sufficiente sicurezza» restano distinguibili. Il registro di coerenza viene letto dall'intero ledger, quindi si carica solo quando lo espandi e si ricarica a ogni espansione.

**Valeva la pena segnalarlo?** Ogni riga mostrata offre **Segnalazione utile?** con tre risposte — **Sì**, **No**, **Incerto** — e volutamente nessuna predefinita. Le tue risposte vengono registrate come voci del registro a sé stanti e conteggiate nel registro di coerenza (*Giudicati: rilevante … · rumore … · incerto … · non giudicati …*). È questa la misura di rilevanza dell'obsolescenza su cui il livello viene tarato: una segnalazione che giudichi rumore è candidata a un'ancora di sezione o a un segno di documento concluso.

## Verifica semantica, affermazioni e contesti

L'obsolescenza di versione dice che una sorgente si è *mossa*; la verifica semantica dice se quel movimento *contraddice* davvero il documento derivato. Le verifiche sono strettamente **pull**: premi **Verifica** su un arco obsoleto e VMark chiede al provider di IA configurato di confrontare la revisione fissata della sorgente, quella corrente e il testo derivato. Il verdetto arriva come un badge — *verificato valido*, *contraddetto* (sempre con una citazione testuale come evidenza) o *non verificato* quando il modello era incerto, è andato in timeout o ha risposto sotto la soglia di confidenza. L'ignoto è onesto, mai nascosto. Una verifica scade nel momento in cui uno dei due documenti si muove di nuovo — o l'insieme delle affermazioni cambia.

Le **affermazioni canoniche** sono fatti che hai reso espliciti («Elena è mancina»). Seleziona del testo in un documento ed esegui *Estrai affermazione dalla selezione*: l'affermazione nasce come **bozza**, con la sua provenienza (quale documento, quale revisione). Per vedere e gestire le tue affermazioni, esegui **Affermazioni canoniche** dalla palette dei comandi — il pannello non ha una voce di menu né una scorciatoia, e *Estrai affermazione dalla selezione* lo apre per te con la nuova bozza. Promuovi un'affermazione a **stabilita** quando diventa canone — solo le affermazioni stabilite alimentano le verifiche semantiche. Correggere o ritirare un'affermazione aggiunge cronologia; nulla viene mai eliminato. Nascondere un'affermazione in un contesto è visibilità reversibile, non un ritiro.

I **contesti** sono viste con nome del workspace (il contesto *default* c'è sempre). Ogni contesto stabilisce cosa significa «corrente» e quali affermazioni si applicano; un contesto figlio eredita in modo additivo le affermazioni del genitore. I contesti sono **serra** per impostazione predefinita — i verdetti delle verifiche si leggono come tensione consultiva. Passarne uno ad **applicato** (un atto esplicito e confermato) contrassegna le contraddizioni come violazioni del canone. Il selettore di contesto della vista di dettaglio sceglie attraverso quale contesto stai guardando; i risultati delle verifiche sono legati esattamente al contesto e allo snapshot di affermazioni che li hanno prodotti e non trapelano mai dall'uno all'altro.

## Provenienza, delega e branch

Tre cose mantengono onesto il livello di coerenza mentre un progetto evolve davvero — nessuna di esse ti assilla, tutte sono esclusivamente in modalità pull.

**Recupero della provenienza.** Quando modifichi a mano un documento derivato (in VMark o in un editor esterno), la modifica perde giustamente i suoi input registrati — i vecchi archi di dipendenza non descrivono più il nuovo testo. Il gruppo *Provenienza sconosciuta* della vista di dettaglio propone di ripristinarli: premi **Suggerisci input** e VMark propone l'insieme di input precedente più recente del documento (ruoli preservati), preselezionato e modificabile. **Conferma provenienza** riaggancia gli archi alla versione corrente senza creare una nuova revisione, così i documenti a valle dello stesso documento non vedono mai una modifica spuria. I documenti che non hanno mai avuto input non vengono mai elencati — non c'è nulla da recuperare e nulla con cui assillare.

**Delega agli agenti.** Per impostazione predefinita solo tu puoi risolvere gli archi obsoleti. Se vuoi che un agente IA accetti la più recente o esenti per tuo conto (tramite lo strumento MCP `coherence_resolve`), concedigli dalla vista di dettaglio una **delega a tempo**: assegna un nome all'agente, scegli l'ambito (accettare la più recente e/o esentare) e imposta una scadenza (7 giorni per impostazione predefinita, mai «per sempre»). Ogni risoluzione delegata viene registrata a fronte della concessione, così la traccia di audit mostra sempre chi ha agito sotto l'autorità di chi. Revoca qualsiasi concessione con un clic. Le affermazioni canoniche e i contesti restano esclusivamente umani — un agente non può mai promuovere un'affermazione né applicare un contesto.

**Contesti di branch.** Un contesto può essere mappato a un branch git. Quando fai il checkout di un branch mappato, la vista di dettaglio mostra un **chip candidato** che propone di cambiare — non cambia mai da solo. Se il branch non ha ancora un contesto, il chip propone di crearne uno con il suo nome. Quando arriva un merge reale (non fast-forward), un banner ignorabile ti invita a rivedere il dettaglio; la divergenza e l'obsolescenza che mostra sono i normali stati della vista di dettaglio — non viene quindi eseguito nulla di nuovo, vieni solo accompagnato alla revisione.

## Identità nel frontmatter

Con *Inserisci il blocco identità al salvataggio* attivo, la prima volta che un file viene acquisito, VMark aggiunge un piccolo blocco di identità al suo frontmatter:

```yaml
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
```

Questo ID è il modo in cui un documento conserva la propria cronologia attraverso rinomine e spostamenti. Non influisce mai sull'hash del contenuto (aggiungerlo non crea una "modifica"), e tutto il resto del tuo frontmatter viene lasciato intatto. Se copi un file, l'ID duplicato viene rilevato e segnalato perché sia tu a risolverlo — mai corretto automaticamente.

Se preferisci che VMark non tocchi mai i tuoi file, lascia *Inserisci il blocco identità al salvataggio* disattivato — è l'impostazione predefinita. Così VMark non aggiunge questo blocco a nessun file, comunque venga scritto — nemmeno ai file che una modifica di IA o MCP si è limitata a leggere.

## Interoperabilità con git

- I file del registro `.vmark/` sono tracciati da git e si fondono in modo pulito tra i branch (solo append, `merge=union`).
- Checkout, cambi di branch e reset sono riconosciuti come **navigazione** — non creano mai revisioni fantasma.
- `git revert` e i merge che generano nuovo contenuto vengono acquisiti come trasformazioni attribuite a git.
- L'indice derivato (`index.db`) è nel gitignore e viene ricostruito dal registro in testo semplice ogni volta che serve.

## Per gli agenti IA (MCP)

Gli agenti esterni possono interrogare lo stato di coerenza tramite lo [strumento MCP `coherence`](/it/guide/mcp-tools#coherence) (azioni `status`, `edges`, `claims` e `contexts`), per i workspace che hai aperto in VMark. `status` è una lettura pura; `edges` riconcilia prima — può aggiungere record di provenienza al registro del workspace stesso, ma non tocca mai i tuoi documenti. Lo strumento dichiara `readOnlyHint: true`, quindi un client può approvarlo automaticamente.

La risoluzione (ratifica/esenzione) si trova in uno strumento **separato**, [`coherence_resolve`](/it/guide/mcp-tools#coherence-resolve), e per impostazione predefinita resta all'essere umano: un agente può chiamarlo solo dopo che hai concesso a quello specifico agente una delega a tempo, e ogni risoluzione viene registrata nel log di audit a fronte della concessione. Tenerlo fuori da `coherence` è ciò che permette di approvare automaticamente lo strumento di lettura senza che un agente acquisisca in silenzio la capacità di scrivere nel tuo registro.

Le affermazioni canoniche e i contesti non sono mai modificabili tramite MCP.
