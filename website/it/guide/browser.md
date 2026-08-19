# Browser integrato

VMark può ospitare un vero browser web **all'interno** di una finestra di documento — una pagina web diventa una scheda di prima classe accanto ai tuoi documenti markdown. È una webview nativa autentica (`WKWebView` di macOS), non una finestra Chrome esterna né un frame incorporato.

::: warning Sperimentale
Il browser integrato è una funzionalità in fase iniziale ed è **solo per macOS** in questa build. Il supporto per Windows e Linux arriverà più avanti — su quelle piattaforme le impostazioni descritte di seguito non compaiono affatto.
:::


::: info Barra delle aree di lavoro
Con la [barra delle aree di lavoro](/guide/workspace-rail) sperimentale abilitata, le pagine del browser sono **globali per la finestra**: restano raggiungibili da ogni area di lavoro nella finestra e non sono mai legate alle schede di una singola area di lavoro.
:::

## Disattivarlo

Il browser è **attivo per impostazione predefinita** su macOS. **Nuova scheda browser** si
trova nel menu **File** (`Alt + Mod + Shift + B`) e nella palette dei comandi — non serve
abilitare nulla prima.

Per disattivarlo, vai su **Impostazioni → Avanzate → macOS** e disattiva
**Browser integrato**. Questo chiude anche eventuali schede del browser aperte e ritira la
superficie di automazione IA descritta di seguito.

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

Una scheda del browser si apre nell'area dell'editor, accanto ai tuoi documenti — la barra laterale, la striscia delle schede, il terminale e la barra di stato restano tutti al loro posto. I suoi controlli si trovano **sopra la pagina**: su macOS condividono la barra del titolo della finestra, poiché VMark la disegna da sé. Dove invece è il sistema a disegnare la barra del titolo (Windows, Linux), si trovano all'interno della finestra sopra la pagina, come li dispone ogni altro browser desktop.

| Controllo | Azione |
|---------|--------|
| ‹ / › | Indietro / avanti. Disattivati quando non c'è nessun posto dove andare |
| ⟳ / ✕ | Ricarica, o interrompi un caricamento in corso |
| Barra degli indirizzi | Una **omnibox**: digita un URL per andarci, o qualsiasi altra cosa per cercare |
| ☆ / ★ | Aggiungi questa pagina ai segnalibri |

La barra degli indirizzi segue automaticamente la pagina: se un sito reindirizza, o un link ti porta altrove, la barra si aggiorna per mostrare dove ti trovi effettivamente.

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

Le sessioni (accessi, cookie) persistono per profilo nell'archivio dati della webview del sistema operativo, così effettui l'accesso a ciascun sito una sola volta. VMark non memorizza di per sé alcuna credenziale.

## Guidare il browser con l'IA

Un assistente IA connesso tramite [MCP](./mcp-tools) può utilizzare la scheda del browser:

- **Leggi** — ottiene un'istantanea strutturata di accessibilità della pagina (ogni elemento interattivo o strutturale come ruolo + nome accessibile, più un handle **ref** stabile come `e5`).
- **Agisci** — fa clic o digita su un bersaglio, tramite il suo **ref** preciso da una lettura precedente, oppure tramite **ruolo + nome accessibile** ARIA (per esempio, fai clic sul link chiamato "Learn more"). Un ref viene onorato solo per un'azione già concessa; qualsiasi cosa richieda la tua approvazione usa ruolo + nome, così il prompt può mostrarti un elemento leggibile. Un clic **verifica di essere effettivamente andato a segno**: porta il bersaglio in vista, richiede che sia visibilmente renderizzato — un pulsante duplicato all'interno di una sezione compressa viene ignorato, non cliccato — ed esegue un hit-test del punto di clic, così un bersaglio coperto da un overlay viene segnalato come "coperto da …" invece di essere cliccato attraverso. All'IA viene detto cosa *è successo*, non solo che ci ha provato, così non può agire silenziosamente sulla cosa sbagliata e riferire un successo.
- **Scorri** — porta un elemento (tramite ref) in vista, o scorri di una quantità in pixel. Di classe Act (soggetto ad approvazione come Fare clic).
- **Tasto** — invia la pressione di un tasto (`Enter`, `Escape`, `Tab`, frecce, con Ctrl/Shift/Alt/Meta opzionali) a un elemento a fuoco o a un ref — per esempio, inviare un modulo o chiudere una finestra di dialogo. Di classe Act. Nota: i tasti e gli scorrimenti sono eventi DOM **sintetici**, quindi un sito che si fida solo dell'input hardware reale potrebbe ignorarli.
- **Interroga** — rilevamento strutturato del DOM che l'istantanea di accessibilità non sa nominare (tabelle, valori calcolati, attributi) tramite selettore CSS. Di classe Read.
- **Estrai** — la pagina come Markdown in modalità lettura (titolo, firma, prosa dell'articolo, con il boilerplate rimosso), per le pagine che l'IA vuole *leggere* invece di utilizzare. I plugin dei siti affinano l'estrazione per origine — il plugin integrato per Wikipedia rimuove il chrome del wiki in base al nome — con un lettore generico come riserva. La pagina esporta solo byte; l'estrazione viene eseguita in VMark. Di classe Read.
- **Stile** — manipolazione CSS (chiudere un overlay che blocca, evidenziare un bersaglio) impostando stili inline, attivando classi o iniettando un blocco `<style>` (a livello di pagina, non limitato a un selettore). Di classe Act, e l'approvazione vincola lo stile esatto — non può essere sostituito con altro CSS dopo che l'hai consentito.
- **Esegui JS** — la via di fuga: esegue uno script per ciò che i verbi strutturati non possono esprimere. Viene eseguito nel **mondo di contenuto isolato** (DOM + CSS, **mai** il JavaScript proprio della pagina), è approvato **per ogni chiamata** (mai memorizzato — non esiste un "Consenti su questo sito" per esso), e il suo risultato è trattato come **non attendibile**. Il prompt di approvazione ti mostra lo **script esatto**, e quello script è ciò che viene eseguito — l'IA non può farti approvare uno script e poi eseguirne un altro. Preferisci Interroga/Stile; ricorri a questo solo quando questi non bastano.
- **Salva / carica sessione** — salva la sessione corrente della scheda sotto un **handle** (un nome che approvi), e successivamente la ripristina così che un flusso inizi già con l'accesso effettuato — *senza che l'IA veda mai i tuoi cookie o token*. I valori sono memorizzati nel **keychain del sistema operativo** (cifrati a riposo), e l'IA riceve solo l'handle e un riepilogo del conteggio. Sia il salvataggio sia il caricamento sono **approvati per ogni chiamata**, e un'approvazione per un handle non può essere spesa per un altro. Un ripristino si applica solo a una pagina sulla **stessa origine** da cui è stata salvata. Questo è credenziale **per riferimento**: l'IA nomina una sessione, VMark custodisce il segreto.
- **Console** — legge l'output `console.*` catturato dalla pagina (log/warn/error…), **più gli errori non catturati e i rifiuti di promise non gestiti** — il segnale che una pagina emette quando il suo stesso script si rompe, che il semplice logging della `console` non mostra mai — così l'IA può fare il debug di una pagina che sta guidando. Di sola lettura, e l'output è trattato come dati della pagina **non attendibili**. Questo è costruito per preservare la garanzia di privacy by design: la cattura scrive nel DOM della pagina stessa e VMark lo legge da lì, così non viene aperto alcun canale di messaggistica verso l'app.

::: tip Salvataggio/caricamento sessione — ambito
Una sessione salvata comprende **`localStorage` e i cookie**, entrambi limitati all'origine a
cui la pagina era vincolata quando l'hai salvata. I cookie vengono letti e riprodotti
attraverso l'archivio nativo dei cookie e sono **limitati al dominio in entrambe le direzioni**
— il salvataggio non copia mai l'intero barattolo dei cookie, e il ripristino non pianta mai
un cookie sotto un sito non correlato.
:::
- **Apri** — crea una scheda di proprietà dell'IA e carica un URL HTTP(S).
- **Naviga** — naviga in una scheda di proprietà dell'IA e attende il suo ticket di navigazione. Quando la pagina che si carica risulta essere un **cancello** invece del contenuto richiesto — un muro di accesso, un interstiziale di consenso, una sfida di verifica umana (reCAPTCHA/Turnstile) o un avviso di limite di frequenza — il risultato lo segnala, e all'IA viene detto di **coinvolgerti** invece di tentare di aggirarlo. Il rilevamento è orientato alla precisione: un prezzo che menziona "$429" o un piè di pagina che dice "Cloudflare" non lo fa scattare.
- **Attendi** — attende un ticket di navigazione specifico senza avviare un altro caricamento.
- **Attendi condizione** — interroga ripetutamente finché una condizione non è soddisfatta (un elemento tramite ref o ruolo + nome, un frammento di testo visibile, o l'**URL della scheda che contiene** una sottostringa — quest'ultima conferma che una navigazione innescata da un clic è andata a segno) o finché non scade un timeout, riferendo se c'è stata corrispondenza. Rende deterministico un flusso a più passaggi — agisci, poi attendi il risultato, poi leggi — invece di tirare a indovinare.
- **Screenshot** — ottiene un'immagine JPEG del rendering corrente della pagina, così l'IA può vedere il layout e lo stato renderizzato che l'istantanea di accessibilità non nomina. Come *Leggi*, non è mutante: consentito su una scheda di proprietà dell'IA, e su una scheda umana solo mentre l'hai collegata.
- **Esegui un flusso di lavoro** — riproduce una breve sequenza salvata di passaggi (click / type / navigate / extract, scritti in una piccola grammatica testuale e passati come `source`) come un'unica **esecuzione asincrona**: restituisce subito un id di esecuzione e ne interroghi lo stato, perché un'esecuzione a più passaggi sopravvive a una singola richiesta. Ogni passaggio al suo interno è **soggetto ad approvazione individualmente** esattamente come un'azione emessa a mano — un flusso di lavoro non è un modo per aggirare i prompt — e i passaggi che l'IA non può eseguire in modo deterministico (un "obiettivo" in prosa libera, una "conferma") mettono in pausa l'esecuzione affinché tu li gestisca a mano. Una ri-esecuzione salta i passaggi già riusciti, così ripetere l'esecuzione dopo una pausa non invia mai due volte. Le esecuzioni sono limitate e una alla volta per scheda, e possono essere annullate — annullare è sempre consentito, e prendere tu stesso il controllo del browser interrompe l'esecuzione. *(Non c'è alcun registratore integrato in questa build; sei tu o l'IA a scrivere il testo del flusso di lavoro.)*

La postura del browser IA si configura in **Impostazioni → Avanzate → Browser integrato**:

- **Sandbox** (consigliato) usa un unico archivio di webview IA condiviso e non persistente. Condivide
  i cookie con le altre schede sandbox, ma non con le schede umane.
- **Profilo condiviso** usa l'archivio di webview umano e chiede l'approvazione della destinazione prima
  di ogni navigazione dell'IA, a meno che quell'origine non abbia una concessione `navigate` corrispondente.

Le schede create dall'IA sono transitorie e non vengono ripristinate dopo il riavvio. I loro URL, modalità, titolo,
generazione e stato di caricamento compaiono in `session.get_state`; le credenziali sono oscurate dalle
risposte MCP.

Le azioni sono **soggette ad approvazione**: un'operazione che non hai autorizzato non viene eseguita — all'IA viene detto che è richiesta l'approvazione e attende. I caricamenti di file non sono **mai** consentiti all'IA (un caricamento di file scelto dall'IA sarebbe una via di esfiltrazione dei dati); questi restano rigorosamente guidati dall'essere umano.

### Approvare un'azione

Quando l'IA chiede di agire, VMark mostra un prompt e mette in pausa la pagina. Ti dice esattamente tre cose — il **sito**, l'**azione** e l'**elemento** (il suo ruolo e il suo nome accessibile, ad es. `button "Publish"`):

- **Consenti una volta** — autorizza esattamente quell'unica azione, su quell'elemento, su quella pagina. Viene consumata immediatamente e non diventa un'autorizzazione permanente.
- **Consenti su questo sito** — l'IA può eseguire *quell'operazione* su *quel sito* senza chiedere di nuovo. Non si estende ad altre operazioni o altri siti.
- **Nega** — non accade nulla. Premere `Escape`, o semplicemente premere `Enter`, nega anch'esso: il prompt è deliberatamente orientato verso il rifiuto.

Il prompt ti mostra una **descrizione dell'azione, non un'immagine della pagina** — e questo è voluto. Una pagina web controlla i propri pixel, quindi una ostile potrebbe dare a un pulsante "Elimina tutto" l'aspetto di "Pubblica". Ciò che VMark ti mostra è esattamente ciò che il controllo di sicurezza applica, preso dal motore del browser piuttosto che dalle affermazioni della pagina su sé stessa.

L'autorizzazione inoltre **decade quando la pagina naviga**. Un prompt descrive un'azione su una pagina *specifica*; se la pagina cambia mentre stai decidendo, la richiesta viene scartata invece di essere applicata a qualunque cosa si sia caricata al suo posto. Una "Consenti una volta" non consumata viene scartata allo stesso modo.

Questo include la navigazione *all'interno* di una pagina. La maggior parte dei siti moderni si sposta tra le viste senza mai caricare una nuova pagina — l'indirizzo cambia, il contenuto viene riscritto, ma il sito non se ne va mai. Questo è importante qui, perché il sito e l'origine restano gli stessi mentre il `button "Publish"` che hai approvato potrebbe non essere più il pulsante con quel nome. Quindi VMark tratta una navigazione all'interno della pagina esattamente come qualsiasi altra: l'autorizzazione decade con la **vista** per cui è stata concessa, non semplicemente con la pagina.

Ciò che regge il peso, però, è il descrittore stesso. Un sito può riscrivere il proprio contenuto in qualsiasi momento senza navigare affatto, e nessun motore di browser lo segnala. Quindi ciò che una "Consenti una volta" autorizza è esattamente un'operazione, su un elemento identificato dal suo ruolo e nome accessibile, su un sito — e viene consumata immediatamente. "Consenti su questo sito" è quella su cui riflettere due volte: è un'autorizzazione permanente per quell'operazione su quel sito, e un sito a cui la concedi è un sito di cui ti stai fidando per essa.

### Rivedere e revocare le autorizzazioni

**Impostazioni → Avanzate → Autorizzazioni dei siti** elenca ogni sito a cui hai concesso autorizzazioni, e cosa può fare. **Revoca** le ritira immediatamente — la successiva azione dell'IA su quel sito chiede di nuovo.

Le autorizzazioni dei siti sono conservate solo in memoria: **non vengono mai scritte su disco** e decadono alla chiusura di VMark. Lasciare che un'IA mantenga la capacità di fare clic su un sito attraverso i riavvii è una promessa più grande di quanto sembri, quindi VMark non la fa silenziosamente.

Quando un'IA prende di mira una scheda creata da un essere umano, VMark chiede prima se collegare l'accesso
dell'IA a quella scheda. Il collegamento è vincolato alla generazione di navigazione corrente. **Consenti una volta**
viene consumata dopo una lettura o azione riuscita; **Consenti fino alla navigazione** scade alla successiva
navigazione completa o all'interno della pagina, chiusura, disattivazione o riavvio.

La navigazione dell'IA rifiuta per impostazione predefinita i bersagli loopback, LAN privata, link-local,
di metadati, malformati e con schema non supportato. Il DNS rebinding resta una limitazione di competenza di WebKit;
VMark non pretende di eliminarlo.

## Co-guida: guarda un'IA guidare il browser dal terminale

Il browser è un riquadro, non una modalità. Questo rende possibile un particolare flusso di lavoro: apri un **terminale** (`Ctrl + \``) accanto a una scheda del browser, esegui un agente IA al suo interno, e guarda la pagina rispondere mentre lavora.

Il terminale e il browser si trovano **affiancati** — il browser si ridimensiona per fare spazio invece di essere coperto. Così vedi la pagina per tutto il tempo in cui l'agente vi opera, e ogni azione che compie deve comunque passare attraverso di te (vedi *Approvare un'azione* qui sopra).

Questa è la forma prevista per l'uso del browser IA in VMark: l'agente propone, la pagina è visibile, e tu approvi. Non è l'agente che lavora in una finestra che non puoi vedere.

**Riprendere il controllo è un unico gesto.** Mentre l'esecuzione di un flusso di lavoro IA sta guidando una scheda, il suo chrome mostra un indicatore **"L'IA sta controllando — fai clic per riprendere il controllo"**. Facendo clic su di esso — o semplicemente interagendo tu stesso con la pagina o con la sua barra degli indirizzi — riprendi immediatamente la scheda e interrompi l'esecuzione. Non devi mai cercare un pulsante di arresto nel terminale dell'agente; toccare il browser è il pulsante di arresto.

## Quando una pagina non si carica

Una rete offline, un nome host errato, un certificato rifiutato o una connessione respinta
producono tutti un messaggio nel riquadro del browser che spiega cosa è andato storto, con un pulsante **Riprova**.
Le build precedenti mostravano invece un riquadro vuoto, indistinguibile da una
pagina semplicemente lenta.

## Limitazioni attuali

- Solo macOS in questa build.
- Le finestre di dialogo JavaScript `confirm()` / `prompt()` sono soppresse per ora (viene mostrato solo `alert()`); i pop-up (`window.open`) vengono bloccati invece di essere aperti come nuove schede.
- Download, stampa e criteri di rete per singola richiesta non sono ancora implementati.

Questi vengono aggiunti in modo incrementale; la pagina qui sopra descrive ciò che funziona oggi.
