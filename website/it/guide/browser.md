# Browser integrato

VMark può ospitare un vero browser web **all'interno** di una finestra di documento — una pagina web diventa una scheda di prima classe accanto ai tuoi documenti markdown. È una webview nativa autentica (`WKWebView` di macOS), non una finestra Chrome esterna né un frame incorporato.

::: info Solo macOS
Il browser integrato è disponibile su **macOS**, dove è attivo per impostazione predefinita. Non è disponibile su Windows né su Linux: lì le impostazioni descritte di seguito e il comando **Nuova scheda del browser** non compaiono affatto.
:::


::: info Barra delle aree di lavoro
Con la [barra delle aree di lavoro](/it/guide/workspace-rail) sperimentale abilitata, le pagine del browser sono **globali per la finestra**: restano raggiungibili da ogni area di lavoro nella finestra e non sono mai legate alle schede di una singola area di lavoro.
:::

## Disattivarlo

Il browser è **attivo per impostazione predefinita** su macOS. **Nuova scheda del browser** si
trova nel menu **File** (`Alt + Mod + Shift + B`) e nella palette dei comandi — non serve
abilitare nulla prima.

Per disattivarlo, vai su **Impostazioni → Avanzate** e disattiva **Browser
integrato**. Questo chiude eventuali schede del browser aperte, revoca ogni autorizzazione
dei siti che l'IA aveva accumulato e ritira la superficie di automazione IA descritta di seguito.

Due impostazioni relative alla postura dell'IA si trovano subito sotto l'interruttore e
compaiono solo quando è attivo. Entrambe hanno valori predefiniti prudenti e non cambiano
per il fatto che il browser sia abilitato:

| Impostazione | Predefinito | Significato |
|---|---|---|
| **Sessione IA** | Sandbox | Le pagine guidate dall'IA ottengono una sessione isolata invece di condividere quella con cui hai effettuato l'accesso |
| **Consenti loopback** | Off | La navigazione dell'IA verso `localhost` / indirizzi di rete privata viene rifiutata |

Le autorizzazioni dei siti non si trovano nelle Impostazioni — vivono nella barra laterale
del browser, nella finestra che le possiede.

## Usarlo

Una scheda del browser si apre nell'area dell'editor, accanto ai tuoi documenti — la barra laterale, la striscia delle schede, il terminale e la barra di stato restano tutti al loro posto. I suoi controlli si trovano **sopra la pagina** e condividono la barra del titolo della finestra, che VMark disegna da sé.

| Controllo | Azione |
|---------|--------|
| ‹ / › | Indietro / avanti. Disattivati quando non c'è nessun posto dove andare |
| ⟳ / ✕ | Ricarica, o interrompi un caricamento in corso |
| Barra degli indirizzi | Una **omnibox**: digita un URL per andarci, o qualsiasi altra cosa per cercare |
| ☆ / ★ | Aggiungi questa pagina ai segnalibri |

Una nuova scheda del browser si apre su DuckDuckGo (`https://duckduckgo.com`), e l'omnibox cerca con DuckDuckGo. Un input che inizia con `http://` o `https://` viene aperto così come è digitato; un nome host senza spazi (`example.com`, `localhost:3000`, un indirizzo IPv4) viene aperto come indirizzo web — `http` per gli indirizzi locali, `https` per tutto il resto; qualsiasi altra cosa viene cercata. Per ora non è possibile cambiare né la pagina iniziale né il motore di ricerca.

La barra degli indirizzi segue automaticamente la pagina: se un sito reindirizza, o un link ti porta altrove, la barra si aggiorna per mostrare dove ti trovi effettivamente.

**Una scheda conserva la sua pagina quando passi altrove.** Guardare un documento e tornare indietro non ricarica la pagina né fa perdere ciò che vi avevi digitato — la pagina viene solo nascosta, e viene distrutta quando chiudi la sua scheda. È anche ciò che permette a un'IA di continuare a lavorare in una scheda del browser mentre scrivi (vedi *Co-guida* più sotto).

Se una pagina tenta di aprire una finestra pop-up (`window.open`, un link `target="_blank"`), VMark la blocca e mostra l'indirizzo bloccato lungo il bordo superiore della pagina con un pulsante **Apri in una nuova scheda**, così un accesso che pretende un pop-up è a un clic di distanza invece di un clic che non ha fatto nulla.

## La barra laterale segue la scheda

Quando una scheda del browser è attiva, la barra laterale mostra la **cronologia di navigazione** e i **segnalibri**. Quando torni a un documento, mostra di nuovo l'esplora file, la struttura e la cronologia del file — automaticamente. Non c'è una seconda modalità da tenere sincronizzata, e ogni lato ricorda ciò che avevi aperto per ultimo, così un'occhiata a una scheda del browser non ti costa l'albero dei file che stavi usando.

La **cronologia** è per finestra e vive solo per la sessione: non viene mai scritta su disco. (C'è comunque un pulsante **Cancella** — «scompare quando esci» non è la stessa cosa di «puoi liberartene adesso».) Una ricarica non aggiunge una voce duplicata, e un sito che ti reindirizza registra la pagina che *intendevi* visitare invece di ogni singolo passaggio lungo il percorso.

I **segnalibri** invece persistono. Vengono memorizzati sotto l'esatto URL che hai aggiunto ai segnalibri — stessa pagina, sezione diversa (`#install` rispetto a `#usage`) sono due segnalibri, e VMark non «riordinerà» silenziosamente i parametri di query di un URL, perché un URL riscritto potrebbe non riportarti a ciò che avevi visto.

## La finestra diventa neutra attorno a una pagina

I temi di VMark sono deliberatamente tinteggiati — Paper è un grigio caldo, Mint e Sepia lo sono ancora di più. È piacevole per scrivere, ma sbagliato da avvolgere attorno alla pagina web di qualcun altro: una cornice colorata altera il modo in cui leggi ogni colore al suo interno, ed è per questo che nessun vero browser tinteggia il proprio chrome.

Quindi quando una scheda del browser è a fuoco, la finestra circostante passa a un neutro semplice — **bianco in un tema chiaro, scuro in un tema scuro** — e torna indietro nel momento in cui torni a un documento. Il tuo tema resta invariato; cambia solo ciò che circonda una pagina web.

**Il terminale segue la stessa regola.** Se hai un terminale aperto accanto a una scheda del browser, assume il neutro corrispondente invece di mantenere il colore del tuo tema, così le due metà della finestra concordano invece di incontrarsi su una giuntura visibile. Un tema scuro ottiene un terminale scuro, non uno bianco — i colori in un terminale sono calibrati rispetto al suo sfondo, e forzare il bianco renderebbe difficile leggere l'output di un tema scuro.

### Se una pagina va in crash

Se il processo del contenuto web di una pagina termina, la scheda mostra un overlay **«Questa pagina è andata in crash»** con un pulsante **Ricarica** invece di una vista vuota o bloccata. VMark ricarica automaticamente alcune volte per i crash transitori; se una pagina continua ad andare in crash al caricamento, si ferma e aspetta che tu ricarichi manualmente, così non rimani mai bloccato in un ciclo di ricaricamento.

## Come è costruito (e perché è privato per progettazione)

VMark crea da sé la webview della piattaforma e la aggiunge come figlia nativa della finestra — **non** ne chiede una al framework dell'app. Questo è importante per la privacy: una webview creata dal framework inietterebbe un bridge di messaggistica interno in ogni pagina, consegnando a qualsiasi sito un canale verso l'app. Poiché VMark possiede una webview appena costruita priva di tale bridge, **una pagina visitata non ha alcun canale verso VMark**. La pagina è guidata rigorosamente in una sola direzione (l'app può leggere e agire sulla pagina; la pagina non può rispondere indietro).

Le sessioni (accessi, cookie) persistono per profilo nell'archivio dati della webview del sistema operativo, così effettui l'accesso a ciascun sito una sola volta. Su macOS 14 e successivi, la tua navigazione usa un archivio persistente riservato a VMark, separato dalle webview delle altre app. Su macOS 13 e precedenti, macOS non offre un archivio per singola app, quindi la tua navigazione (e un'IA che condivide la tua sessione) usa l'archivio webview predefinito del sistema. Un profilo IA con nome ottiene comunque lì un proprio archivio non persistente, così resta separato dai tuoi accessi, ma le sue sessioni non vengono conservate. VMark non ha un proprio archivio di password o cookie; l'unica eccezione è una sessione che approvi esplicitamente di salvare per un'IA (vedi *Salva / carica sessione* più sotto), i cui cookie e `localStorage` finiscono nel **keychain del sistema operativo**, mai in un file.

## Guidare il browser con l'IA

Un assistente IA connesso tramite [MCP](./mcp-tools) può utilizzare la scheda del browser:

- **Leggi** — ottiene un'istantanea strutturata di accessibilità della pagina (ogni elemento interattivo o strutturale come ruolo + nome accessibile, più un handle **ref** stabile come `e5`). L'istantanea attraversa le shadow root aperte e dice onestamente cosa non è riuscita a raggiungere (shadow root chiuse, frame) e se è stata troncata dai suoi limiti di dimensione.
- **Agisci** — fa clic o digita su un bersaglio, tramite il suo **ref** preciso da una lettura precedente, oppure tramite **ruolo + nome accessibile** ARIA (per esempio, fai clic sul link chiamato "Learn more"). Un ref viene onorato solo per un'azione già concessa; qualsiasi cosa richieda la tua approvazione usa ruolo + nome, così il prompt può mostrarti un elemento leggibile. Un clic **verifica di essere effettivamente andato a segno**: porta il bersaglio in vista, richiede che sia visibilmente renderizzato — un pulsante duplicato all'interno di una sezione compressa viene ignorato, non cliccato — ed esegue un hit-test del punto di clic, così un bersaglio coperto da un overlay viene segnalato come "coperto da …" invece di essere cliccato attraverso. Quando più elementi visibili condividono lo stesso ruolo e nome, il clic viene **rifiutato come ambiguo** invece di essere risolto con il primo che compare nella pagina — una pagina non può infilare il proprio link "Learn more" davanti a quello del sito. All'IA viene detto cosa *è successo*, non solo che ci ha provato, così non può agire silenziosamente sulla cosa sbagliata e riferire un successo. Gli input di tipo file non vengono mai cliccati.
- **Scorri** — porta un elemento (tramite ref) in vista, o scorri di una quantità in pixel. Di classe Act (soggetto ad approvazione come Fare clic); l'approvazione vincola esattamente lo scorrimento richiesto.
- **Tasto** — invia la pressione di un tasto (`Enter`, `Escape`, `Tab`, frecce, con Ctrl/Shift/Alt/Meta opzionali) a un elemento a fuoco o a un ref — per esempio, inviare un modulo o chiudere una finestra di dialogo. Di classe Act, e l'approvazione vincola esattamente il tasto e i modificatori. Invio all'interno di un modulo lo invia e Tab sposta il focus, come farebbe un input reale; gli altri tasti sono eventi DOM **sintetici**, quindi un sito che si fida solo dell'input hardware reale potrebbe ignorarli.
- **Interroga** — rilevamento strutturato del DOM che l'istantanea di accessibilità non sa nominare (tabelle, valori calcolati, attributi) tramite selettore CSS. Di classe Read.
- **Estrai** — la pagina come Markdown in modalità lettura (titolo, firma, prosa dell'articolo, con il boilerplate rimosso), per le pagine che l'IA vuole *leggere* invece di utilizzare. I plugin dei siti affinano l'estrazione per origine — il plugin integrato per Wikipedia rimuove il chrome del wiki in base al nome — con un lettore generico come riserva. La pagina esporta solo byte; l'estrazione viene eseguita in VMark. Di classe Read.
- **Stile** — manipolazione CSS (chiudere un overlay che blocca, evidenziare un bersaglio) impostando stili inline, attivando classi o iniettando un blocco `<style>` (a livello di pagina, non limitato a un selettore). Di classe Act, e l'approvazione vincola lo stile esatto — non può essere sostituito con altro CSS dopo che l'hai consentito.
- **Esegui JS** — la via di fuga: esegue uno script per ciò che i verbi strutturati non possono esprimere. Viene eseguito nel **mondo di contenuto isolato** (DOM + CSS, **mai** il JavaScript proprio della pagina), è approvato **per ogni chiamata** (mai memorizzato — non esiste un "Consenti su questo sito" per esso), e il suo risultato è trattato come **non attendibile**. Il prompt di approvazione ti mostra lo **script esatto**, e quello script è ciò che viene eseguito — l'IA non può farti approvare uno script e poi eseguirne un altro. Preferisci Interroga/Stile; ricorri a questo solo quando questi non bastano.
- **Salva / carica sessione** — salva la sessione corrente della scheda sotto un **handle** (un nome che approvi), e successivamente la ripristina così che un flusso inizi già con l'accesso effettuato — *senza che l'IA veda mai i tuoi cookie o token*. I valori sono memorizzati nel **keychain del sistema operativo** (cifrati a riposo), e l'IA riceve solo l'handle e un riepilogo del conteggio. Sia il salvataggio sia il caricamento sono **approvati per ogni chiamata**, e un'approvazione per un handle non può essere spesa per un altro. Un ripristino si applica solo a una pagina sulla **stessa origine** da cui è stata salvata. Questo è credenziale **per riferimento**: l'IA nomina una sessione, VMark custodisce il segreto.
- **Console** — legge l'output `console.*` catturato dalla pagina (log/warn/error…), **più gli errori non catturati e i rifiuti di promise non gestiti** — il segnale che una pagina emette quando il suo stesso script si rompe, che il semplice logging della `console` non mostra mai — così l'IA può fare il debug di una pagina che sta guidando. Di sola lettura, solo sulle schede di proprietà dell'IA (le tue schede non hanno alcuno shim di cattura), e l'output è trattato come dati della pagina **non attendibili**. Questo è costruito per preservare la garanzia di privacy by design: la cattura scrive nel DOM della pagina stessa e VMark lo legge da lì, così non viene aperto alcun canale di messaggistica verso l'app.

::: tip Salvataggio/caricamento sessione — ambito
Una sessione salvata comprende **`localStorage` e i cookie**, entrambi limitati all'origine a
cui la pagina era vincolata quando l'hai salvata. I cookie vengono letti e riprodotti
attraverso l'archivio nativo dei cookie e sono **limitati al dominio in entrambe le direzioni**
— il salvataggio non copia mai l'intero barattolo dei cookie, e il ripristino non pianta mai
un cookie sotto un sito non correlato.
:::
- **Apri** — crea una scheda di proprietà dell'IA, la porta in primo piano e carica un URL HTTP(S). Possono essere aperte al massimo otto schede di proprietà dell'IA alla volta, e l'IA **chiude** le proprie schede quando ha finito (la chiusura non è mai soggetta ad approvazione — fermarsi è sempre consentito). Facoltativamente la scheda si apre su un **profilo con nome**, un contesto persistente che permette di riutilizzare un accesso per nome; aprirne uno ti chiede conferma ogni volta, e l'IA non vede mai le credenziali.
- **Naviga** — naviga in una scheda di proprietà dell'IA (portandola in primo piano) e attende il suo ticket di navigazione. Quando la pagina che si carica risulta essere un **cancello** invece del contenuto richiesto — un muro di accesso, un interstiziale di consenso, una sfida di verifica umana (reCAPTCHA/Turnstile) o un avviso di limite di frequenza — il risultato lo segnala, e all'IA viene detto di **coinvolgerti** invece di tentare di aggirarlo. Il rilevamento è orientato alla precisione: un prezzo che menziona "$429" o un piè di pagina che dice "Cloudflare" non lo fa scattare.
- **Attendi** — attende un ticket di navigazione specifico senza avviare un altro caricamento.
- **Attendi condizione** — interroga ripetutamente finché una condizione non è soddisfatta (un elemento tramite ref o ruolo + nome, un frammento di testo visibile, o l'**URL della scheda che contiene** una sottostringa — quest'ultima conferma che una navigazione innescata da un clic è andata a segno; la stringa di query e il frammento non vengono mai confrontati, perché un token che un reindirizzamento vi ha inserito non deve poter essere sondato) o finché non scade un timeout, riferendo se c'è stata corrispondenza. Rende deterministico un flusso a più passaggi — agisci, poi attendi il risultato, poi leggi — invece di tirare a indovinare. Né *Attendi* né *Attendi condizione* cambiano la scheda che stai guardando.
- **Screenshot** — ottiene un'immagine JPEG del rendering corrente della pagina, così l'IA può vedere il layout e lo stato renderizzato che l'istantanea di accessibilità non nomina. Come *Leggi*, non è mutante: consentito su una scheda di proprietà dell'IA, e su una scheda umana solo mentre l'hai collegata. Una scheda che non è la pagina visibile può essere renderizzata vuota.
- **Esegui un flusso di lavoro** — riproduce una breve sequenza salvata di passaggi (click / type / navigate / extract, scritti in una piccola grammatica testuale e passati come `source`) come un'unica **esecuzione asincrona**: restituisce subito un id di esecuzione e ne interroghi lo stato, perché un'esecuzione a più passaggi sopravvive a una singola richiesta. Ogni passaggio al suo interno è **soggetto ad approvazione individualmente** esattamente come un'azione emessa a mano — un flusso di lavoro non è un modo per aggirare i prompt — e i passaggi che l'IA non può eseguire in modo deterministico (un "obiettivo" in prosa libera, una "conferma") mettono in pausa l'esecuzione perché l'IA li gestisca a mano. Per proseguire dopo una pausa, il passaggio in pausa viene eseguito a mano e una nuova esecuzione **riprende** da quella in pausa: eredita i passaggi completati e considera eseguito il passaggio in pausa, così nulla viene inviato due volte; anche una ri-esecuzione dello stesso flusso con gli stessi input salta i passaggi di scrittura già riusciti. Le esecuzioni sono limitate (solo il tempo di esecuzione — il tempo passato ad aspettare te non conta), una alla volta per scheda, e possono essere annullate — annullare è sempre consentito, anche mentre un passaggio attende la tua approvazione, e prendere tu stesso il controllo del browser interrompe l'esecuzione.
- **Registra un flusso di lavoro** — invece di scrivere la grammatica a mano, puoi **registrarne** uno: con la tua approvazione (richiesta ogni volta — la registrazione non è mai un permesso permanente), VMark cattura i **clic e le modifiche ai campi** che esegui sulla scheda e restituisce testo del flusso di lavoro pronto all'uso. È **privo di valori per costruzione**: nulla di ciò che digiti viene salvato — ogni campo diventa un `{input}` con nome che compili durante la riproduzione, un campo password diventa un passaggio `confirm:` manuale, e gli URL vengono ridotti a origine + percorso. Registra *quali* controlli hai toccato, mai *cosa* hai inserito.

La postura del browser IA si configura in **Impostazioni → Avanzate**:

- **Sandbox** (consigliato) usa un unico archivio di webview IA condiviso e non persistente. Condivide
  i cookie con le altre schede sandbox, ma non con le schede umane.
- **Profilo condiviso** usa l'archivio di webview umano e chiede l'approvazione della destinazione prima
  di ogni navigazione dell'IA, a meno che quell'origine non abbia una concessione `navigate` corrispondente.

Le schede create dall'IA sono transitorie e non vengono ripristinate dopo il riavvio. I loro URL, modalità, titolo,
generazione e stato di caricamento compaiono in `session.get_state`; le credenziali sono oscurate dalle
risposte MCP.

Le azioni sono **soggette ad approvazione**: un'operazione che non hai autorizzato non viene eseguita — all'IA viene detto che è richiesta l'approvazione e attende. I caricamenti di file non sono **mai** consentiti all'IA (un caricamento di file scelto dall'IA sarebbe una via di esfiltrazione dei dati); questi restano rigorosamente guidati dall'essere umano.

### Approvare un'azione

Quando l'IA chiede di agire, VMark mostra un prompt e mette in pausa la pagina. Ti indica il **sito**, l'**azione** e l'**elemento** (il suo ruolo e il suo nome accessibile, ad es. `button "Publish"`) — e, per un'azione che porta con sé un contenuto, il contenuto stesso: il testo che un *Type* inserirà, il tasto che un *Key* premerà, lo script esatto che un *Run script* o uno *Stile* eseguirà. È questo che l'approvazione vincola; un nuovo tentativo con un contenuto diverso chiede di nuovo.

- **Consenti una volta** — autorizza esattamente quell'unica azione, su quell'elemento, su quella pagina. Viene consumata immediatamente e non diventa un'autorizzazione permanente.
- **Consenti su questo sito** — l'IA può eseguire *quell'operazione* su *quel sito* senza chiedere di nuovo. Non si estende ad altre operazioni o altri siti.
- **Nega** — non accade nulla. Premere `Escape`, o semplicemente premere `Enter`, nega anch'esso: il prompt è deliberatamente orientato verso il rifiuto. Un **Consenti** nel primo mezzo secondo dopo la comparsa di un prompt viene ignorato, e una pressione deve iniziare e finire sullo stesso prompt — così un prompt ritirato sotto il tuo dito non può passare il tuo clic a quello successivo.

Il prompt ti mostra una **descrizione dell'azione, non un'immagine della pagina** — e questo è voluto. Una pagina web controlla i propri pixel, quindi una ostile potrebbe dare a un pulsante "Elimina tutto" l'aspetto di "Pubblica". Ciò che VMark ti mostra è esattamente ciò che il controllo di sicurezza applica, preso dal motore del browser piuttosto che dalle affermazioni della pagina su sé stessa.

L'autorizzazione inoltre **decade quando la pagina naviga**. Un prompt descrive un'azione su una pagina *specifica*; se la pagina cambia mentre stai decidendo, la richiesta viene scartata invece di essere applicata a qualunque cosa si sia caricata al suo posto. Una "Consenti una volta" non consumata viene scartata allo stesso modo.

Questo include la navigazione *all'interno* di una pagina. La maggior parte dei siti moderni si sposta tra le viste senza mai caricare una nuova pagina — l'indirizzo cambia, il contenuto viene riscritto, ma il sito non se ne va mai. Questo è importante qui, perché il sito e l'origine restano gli stessi mentre il `button "Publish"` che hai approvato potrebbe non essere più il pulsante con quel nome. Quindi VMark tratta una navigazione all'interno della pagina esattamente come qualsiasi altra: l'autorizzazione decade con la **vista** per cui è stata concessa, non semplicemente con la pagina.

Ciò che regge il peso, però, è il descrittore stesso. Un sito può riscrivere il proprio contenuto in qualsiasi momento senza navigare affatto, e nessun motore di browser lo segnala. Quindi ciò che una "Consenti una volta" autorizza è esattamente un'operazione, su un elemento identificato dal suo ruolo e nome accessibile, su un sito — e viene consumata immediatamente. "Consenti su questo sito" è quella su cui riflettere due volte: è un'autorizzazione permanente per quell'operazione su quel sito, e un sito a cui la concedi è un sito di cui ti stai fidando per essa.

### Rivedere e revocare le autorizzazioni

La **barra laterale del browser** (nella finestra che le possiede) elenca ogni sito a cui hai concesso autorizzazioni, e cosa può fare. **Revoca** le ritira immediatamente — la successiva azione dell'IA su quel sito chiede di nuovo. Le autorizzazioni appartengono alla finestra in cui sono state concesse.

Le autorizzazioni dei siti sono conservate solo in memoria: **non vengono mai scritte su disco**, decadono alla chiusura di VMark, e disattivare il browser le revoca tutte. Lasciare che un'IA mantenga la capacità di fare clic su un sito attraverso i riavvii è una promessa più grande di quanto sembri, quindi VMark non la fa silenziosamente.

Quando un'IA prende di mira una scheda creata da un essere umano, VMark chiede prima se collegare l'accesso
dell'IA a quella scheda. Il collegamento è vincolato alla generazione di navigazione corrente. **Consenti una volta**
viene consumata dalla prima lettura o azione che il motore del browser autorizza (anche un clic che poi
risulta coperto o nascosto la consuma); **Consenti fino alla navigazione** scade alla successiva
navigazione completa o all'interno della pagina, chiusura, disattivazione o riavvio. Finché non colleghi una
scheda, l'IA ne vede solo l'origine — non il titolo né il percorso. Se il collegamento non riesce (il driver
ha rifiutato, o la pagina si è spostata mentre stavi decidendo), il prompt resta aperto e lo segnala; puoi
riprovare o negare.

La navigazione dell'IA rifiuta per impostazione predefinita i bersagli loopback, LAN privata, link-local,
di metadati, malformati e con schema non supportato, e sulle schede di proprietà dell'IA un elenco di regole
sui contenuti applica lo stesso rifiuto a ciò che una pagina incorpora — frame, immagini, script, fetch — così
una pagina pubblica non può usare la scheda dell'IA per raggiungere la tua rete. Prima che venga emesso un
`open` o un `navigate` avviato dall'IA, VMark risolve anche il nome host della destinazione e rifiuta la
navigazione (`SSRF_BLOCKED`, `reason: resolves-private`) quando una qualsiasi risposta è uno di quegli
indirizzi bloccati, oppure (`reason: unresolved`) quando il nome non viene risolto entro un'attesa limitata
— un nome dall'aspetto pubblico che punta alla tua LAN o a un servizio di metadati cloud viene intercettato
prima che WebKit invii una richiesta. Restano due limiti, detti chiaramente: il controllo preliminare copre
le navigazioni emesse dall'IA, non le destinazioni dei reindirizzamenti, i clic sui link all'interno della
pagina o ciò che una pagina incorpora (questi restano controlli sul testo dell'URL più l'elenco di regole sui
contenuti per gli indirizzi privati letterali), e una risposta DNS che cambia dopo il controllo preliminare
(rebinding) non viene ricontrollata, perché WKWebView non espone alcun hook per singola richiesta
sull'indirizzo effettivamente usato da una connessione.

## Co-guida: guarda un'IA guidare il browser dal terminale

Il browser è un riquadro, non una modalità. Questo rende possibile un particolare flusso di lavoro: apri un **terminale** (`Ctrl + \``) accanto a una scheda del browser, esegui un agente IA al suo interno, e guarda la pagina rispondere mentre lavora.

Il terminale e il browser si trovano **affiancati** — il browser si ridimensiona per fare spazio invece di essere coperto. Così vedi la pagina per tutto il tempo in cui l'agente vi opera, e ogni azione che compie deve comunque passare attraverso di te (vedi *Approvare un'azione* qui sopra).

Questa è la forma prevista per l'uso del browser IA in VMark: l'agente propone, la pagina è visibile, e tu approvi. Non è l'agente che lavora in una finestra che non puoi vedere.

**Riprendere il controllo è un unico gesto.** Mentre l'esecuzione di un flusso di lavoro IA sta guidando una scheda, il suo chrome mostra un indicatore **"L'IA sta controllando — fai clic per riprendere il controllo"**. Facendo clic su di esso — o semplicemente interagendo tu stesso con la pagina o con la sua barra degli indirizzi — riprendi immediatamente la scheda e interrompi l'esecuzione. Non devi mai cercare un pulsante di arresto nel terminale dell'agente; toccare il browser è il pulsante di arresto.

## Quando una pagina non si carica

Una rete offline, un nome host errato, un certificato rifiutato o una connessione respinta
producono tutti un messaggio nel riquadro del browser che spiega cosa è andato storto, con un pulsante **Riprova**,
così un caricamento fallito non sembra mai una pagina semplicemente lenta.

## Limitazioni attuali

- Solo macOS in questa build.
- Le finestre di dialogo JavaScript `alert()` e `confirm()` vengono mostrate e sei tu a rispondere; `prompt()` è per ora soppresso. I pop-up (`window.open`) vengono bloccati, e l'indirizzo bloccato viene offerto come nuova scheda.
- Una pagina protetta da autenticazione HTTP basic non si carica — non esiste ancora una richiesta di nome utente/password.
- La ricerca nella pagina e lo zoom della pagina non sono implementati.
- VMark non decide ancora da sé le richieste di fotocamera, microfono, posizione o notifiche; si applica la gestione predefinita della webview di sistema.
- Download, stampa e criteri di rete per singola richiesta non sono ancora implementati. Le azioni di hover e trascinamento non hanno ancora un verbo per l'IA.

Questi vengono aggiunti in modo incrementale; la pagina qui sopra descrive ciò che funziona oggi.
