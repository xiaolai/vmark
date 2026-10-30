# Barra degli spazi di lavoro

::: warning Sperimentale
La barra degli spazi di lavoro è sperimentale e **disattivata per impostazione predefinita**. Attivala in **Impostazioni → File e immagini → Area di lavoro → Barra delle aree di lavoro**. Con la barra disattivata, VMark si comporta esattamente come prima — un workspace per finestra.
:::

La barra degli spazi di lavoro permette a una finestra di contenere **più workspace contemporaneamente**, mostrati come una striscia verticale di glifi colorati sul bordo sinistro. Fare clic su un workspace esegue un **cambio di contesto completo**: le schede dell'editor, l'albero dei file della barra laterale, il layout a pannelli divisi e lo stato della barra laterale e della struttura passano all'insieme proprio di quel workspace — come cambiare Spazio in un browser, non semplicemente applicare un filtro.

## Cosa cambia e cosa resta

| Superficie | Al cambio di workspace nella barra |
|---------|------------------|
| Barra delle schede dell'editor | Mostra solo le schede del workspace attivo (più le pagine del browser) |
| Albero dei file della barra laterale | Si riposiziona sulla radice del workspace attivo, con il proprio stato di cartelle aperte e di scorrimento |
| Pannelli divisi | Ogni workspace ricorda il proprio layout diviso |
| Struttura | Lo stato di compressione, filtro e scorrimento di ogni scheda segue il workspace |
| Scheda successiva/precedente, menu contestuale delle schede, "schede aperte" di Apertura rapida | Limitati al workspace attivo |
| Riapri scheda chiusa | Le schede chiuse vengono registrate per workspace (più un ambito condiviso per il browser) e riaperte dalla più recente con **File → Riapri scheda chiusa**, dalla palette dei comandi o da una scorciatoia che assegni in Impostazioni → Scorciatoie (non ne ha una predefinita: le combinazioni vicine sono già occupate). Un documento riaperto viene riletto dal disco, quindi mostra il file com'è adesso; se il file è stato spostato o eliminato, la scheda non viene ripristinata e un avviso ne spiega il motivo. Una scheda senza titolo si riapre vuota. Le modifiche non salvate non vengono recuperate — chiudendo una scheda modificata è già stato chiesto se salvare |
| **Pagine del browser** | **Globali per la finestra** — raggiungibili da ogni workspace |
| Menu dei file recenti e degli spazi di lavoro recenti | Globali |
| Salvataggio automatico, richieste di salvataggio, monitoraggio dei file | Coprono **ogni** scheda, nascosta o no |

Il cambio non chiude mai nulla: le schede di un workspace nascosto restano aperte in background, continuano a essere salvate automaticamente e ricevono comunque una richiesta di salvataggio se chiudi la finestra con modifiche non salvate.

## File indipendenti

I file aperti al di fuori di ogni radice di workspace risiedono in una voce sintetica **File indipendenti** (l'icona dei file impilati). Passando a essa vengono mostrate quelle schede; compare automaticamente quando serve.

## Spostare i file tra workspace

L'appartenenza segue il percorso del file:

- **Salva con nome** nella cartella di un altro workspace sposta lì la scheda — e, se è la scheda che stai guardando, il workspace visibile la segue.
- Le rinomine o gli spostamenti su disco (anche dal Finder) ricollocano la scheda allo stesso modo.
- Aprire un file che appartiene a un workspace *nascosto* (tramite Apertura rapida, i recenti o una finestra di dialogo dei file) passa prima a quel workspace, così la scheda che hai chiesto è quella che vedi.

## Sessioni e riavvio

La configurazione di ogni workspace ricorda **solo le proprie schede** e il layout diviso. Le pagine del browser aperte dall'utente vengono conservate per finestra. L'hot exit ripristina ogni workspace della finestra — compresi lo stato della barra laterale per workspace e la cronologia registrata delle schede chiuse — e riattiva il workspace in cui ti trovavi.

## Comportamento dell'IA (MCP)

I client IA che aprono documenti tramite MCP non strappano mai via il tuo workspace visibile: `workspace.open` crea una **scheda in background** e restituisce il suo `tabId` per le chiamate successive sul documento. Solo l'azione esplicita `workspace.switch_tab` cambia ciò che vedi, e la sua risposta riporta `workspaceSwitched: true` così che l'IA possa dirti che è successo. Vedi il [Riferimento Strumenti MCP](/it/guide/mcp-tools).

## Azioni della barra

| Azione | Come |
|--------|-----|
| Cambiare workspace | Fai clic sul suo glifo |
| Aggiungere un workspace | **File > Apri spazio di lavoro** (una cartella già presente nella barra viene attivata invece di essere duplicata) |
| Riordinare | Trascina un glifo sopra un altro |
| Spostare in una finestra propria | Trascina un glifo fuori dalla finestra |
| Duplicare in una nuova finestra | Il pulsante **⧉** al passaggio del mouse |
| Chiudere un workspace | Clic destro → Chiudi. Tutte le sue schede si chiudono insieme al workspace, comprese quelle fissate; ogni scheda non salvata chiede prima conferma, e annullando il workspace resta aperto |

## Sessioni del terminale

Ogni workspace nella barra possiede le proprie sessioni del terminale. Un cambio nella barra sostituisce le schede del terminale visibili; le shell dei workspace nascosti continuano a funzionare indisturbate — non vi viene digitato alcun `cd`, che siano occupate o inattive — e tornando indietro ricompaiono le stesse shell, con la sessione su cui eri ricordata per ogni workspace. Le nuove sessioni (il pulsante **+**, "Apri terminale qui", "Esegui nel terminale") vengono create nel workspace attivo e partono dalla sua radice; chiudere un workspace o spostarlo in una finestra propria chiude anche le sue sessioni. I dettagli sono nella [guida al terminale](/it/guide/terminal#sessioni-del-terminale-e-barra-degli-spazi-di-lavoro).

## Limitazione nota

Su macOS, due grafie della stessa cartella che differiscono solo per maiuscole e minuscole (possibili sui volumi che non distinguono le maiuscole) vengono trattate come workspace **diversi**. È voluto: l'identità di un workspace è esatta byte per byte su macOS e Linux, e insensibile alle maiuscole su Windows.
