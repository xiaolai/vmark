# Navigazione Intelligente con Tab

I tasti Tab e Shift+Tab di VMark sono sensibili al contesto — ti aiutano a navigare in modo efficiente nel testo formattato, nelle parentesi e nei collegamenti senza dover usare i tasti freccia.

> Con la [barra degli spazi di lavoro](/it/guide/workspace-rail) sperimentale, il passaggio ciclico tra le schede e la barra delle schede coprono solo le schede dello spazio di lavoro attivo.

## Panoramica Rapida

| Contesto | Azione Tab | Azione Shift+Tab |
|----------|------------|------------------|
| All'interno di parentesi `()` `[]` `{}` | Salta oltre la parentesi di chiusura | Salta prima della parentesi di apertura |
| All'interno di virgolette `""` `''` | Salta oltre la virgoletta di chiusura | Salta prima della virgoletta di apertura |
| All'interno di parentesi CJK `「」` `『』` | Salta oltre la parentesi di chiusura | Salta prima della parentesi di apertura |
| All'interno di **grassetto**, *corsivo*, `codice`, ~~barrato~~ | Salta dopo la formattazione | Salta prima della formattazione |
| All'interno di un collegamento | Salta dopo il collegamento | Salta prima del collegamento |
| In una cella di tabella | Passa alla cella successiva | Passa alla cella precedente |
| In un elemento di elenco | Aumenta rientro | Diminuisce rientro |

## Escape Parentesi e Virgolette

Quando il cursore è subito prima di una parentesi o virgoletta di chiusura, premere Tab salta oltre di essa. Quando il cursore è subito dopo una parentesi o virgoletta di apertura, premere Shift+Tab torna indietro prima di essa.

### Caratteri Supportati

**Parentesi e virgolette standard:**
- Parentesi tonde: `( )`
- Parentesi quadre: `[ ]`
- Parentesi graffe: `{ }`
- Virgolette doppie: `" "`
- Virgolette singole: `' '`
- Backtick: `` ` ``

**Parentesi CJK:**
- Parentesi tonde a larghezza intera: `（ ）`
- Parentesi lenticolari: `【 】`
- Parentesi a forcella: `「 」`
- Parentesi a forcella bianche: `『 』`
- Parentesi ad angolo doppie: `《 》`
- Parentesi ad angolo: `〈 〉`

**Virgolette curve:**
- Virgolette doppie curve: `" "`
- Virgolette singole curve: `' '`

### Come Funziona

```text
function hello(world|)
                    ↑ cursore prima di )
```

Premi **Tab**:

```text
function hello(world)|
                     ↑ cursore dopo )
```

Funziona anche con le parentesi annidate — Tab salta oltre il carattere di chiusura immediatamente adiacente.

Premi **Shift+Tab** per invertire l'azione — se il cursore è subito dopo un carattere di apertura:

```text
function hello(|world)
               ↑ cursore dopo (
```

Premi **Shift+Tab**:

```text
function hello|(world)
              ↑ cursore prima di (
```

### Esempio CJK

```text
这是「测试|」文字
         ↑ cursore prima di 」
```

Premi **Tab**:

```text
这是「测试」|文字
          ↑ cursore dopo 」
```

## Escape dalla Formattazione (Modalità WYSIWYG)

In modalità WYSIWYG, Tab e Shift+Tab possono uscire dai segni di formattazione inline.

### Formati Supportati

- Testo **grassetto**
- Testo *corsivo*
- `Codice inline`
- ~~Barrato~~
- Collegamenti

### Come Funziona

Quando il cursore è all'interno del testo formattato:

```text
This is **bold te|xt** here
                 ↑ cursore all'interno del grassetto
```

Premi **Tab**:

```text
This is **bold text**| here
                     ↑ cursore dopo il grassetto
```

Shift+Tab funziona al contrario — salta all'inizio della formattazione:

```text
This is **bold te|xt** here
                 ↑ cursore all'interno del grassetto
```

Premi **Shift+Tab**:

```text
This is |**bold text** here
        ↑ cursore prima del grassetto
```

### Escape dal Collegamento

Tab e Shift+Tab escono anche dai collegamenti:

```text
Check out [VMark|](https://vmark.app)
               ↑ cursore all'interno del testo del collegamento
```

Premi **Tab**:

```text
Check out [VMark](https://vmark.app)| and...
                                    ↑ cursore dopo il collegamento
```

Premi **Shift+Tab** all'interno di un collegamento per andare all'inizio:

```text
Check out |[VMark](https://vmark.app) and...
          ↑ cursore prima del collegamento
```

## Navigazione nei Collegamenti (Modalità Sorgente)

In modalità Sorgente, Tab fornisce una navigazione intelligente all'interno della sintassi dei collegamenti Markdown.

### Parentesi Annidate ed Escape

VMark gestisce correttamente la sintassi complessa dei collegamenti:

```markdown
[testo [con parentesi annidate] e altro](url)     ✓ Funziona
[testo \[escape\] parentesi](url)                  ✓ Funziona
[link](https://example.com/page(1))                ✓ Funziona
```

La navigazione Tab identifica correttamente i confini dei collegamenti anche con parentesi annidate o con escape.

### Collegamenti Standard

```markdown
[testo del link|](url)
               ↑ cursore nel testo
```

Premi **Tab** → il cursore si sposta all'URL:

```markdown
[testo del link](|url)
                 ↑ cursore nell'URL
```

Premi **Tab** di nuovo → il cursore esce dal collegamento:

```markdown
[testo del link](url)|
                     ↑ cursore dopo il collegamento
```

### Wiki Link

```markdown
[[nome pagina|]]
             ↑ cursore nel collegamento
```

Premi **Tab**:

```markdown
[[nome pagina]]|
               ↑ cursore dopo il collegamento
```

## Modalità Sorgente: Escape dai Caratteri Markdown

In modalità Sorgente, Tab salta anche oltre i caratteri di formattazione Markdown:

| Caratteri | Usati Per |
|-----------|----------|
| `*` | Grassetto/corsivo |
| `_` | Grassetto/corsivo |
| `^` | Apice |
| `~~` | Barrato (saltato come unità) |
| `==` | Evidenziato (saltato come unità) |

### Esempio

```markdown
This is **bold|** text
              ↑ cursore prima di **
```

Premi **Tab**:

```markdown
This is **bold**| text
                ↑ cursore dopo **
```

::: info
La modalità Sorgente non ha escape con Shift+Tab per i caratteri markdown — Shift+Tab riduce solo il rientro (rimuove gli spazi iniziali).
:::

## Modalità Sorgente: Auto-Accoppiamento

In modalità Sorgente, digitare un carattere di formattazione inserisce automaticamente la coppia di chiusura:

| Carattere | Accoppiamento | Comportamento |
|-----------|--------------|--------------|
| `*` | `*\|*` o `**\|**` | Basato su ritardo — attende 150ms per rilevare singolo vs doppio |
| `~` | `~\|~` o `~~\|~~` | Basato su ritardo |
| `_` | `_\|_` o `__\|__` | Basato su ritardo |
| `=` | `==\|==` | Si accoppia sempre come doppio |
| `` ` `` | `` `\|` `` | Il backtick singolo si accoppia dopo un ritardo |
| ` ``` ` | Recinzione codice | Il triplo backtick all'inizio della riga crea un blocco di codice delimitato |

L'auto-accoppiamento è **disabilitato all'interno dei blocchi di codice delimitati** — digitare `*` in un blocco di codice inserisce un `*` letterale senza accoppiamento.

Backspace tra una coppia elimina entrambe le metà: `*\|*` → Backspace → vuoto.

## Navigazione nelle Tabelle

Quando il cursore è all'interno di una tabella:

| Azione | Tasto |
|--------|-------|
| Cella successiva | Tab |
| Cella precedente | Shift + Tab |
| Aggiungi riga (all'ultima cella) | Tab |

Tab sull'ultima cella dell'ultima riga aggiunge automaticamente una nuova riga.

## Rientro negli Elenchi

Quando il cursore è in un elemento di elenco:

| Azione | Tasto |
|--------|-------|
| Aumenta rientro | Tab |
| Diminuisce rientro | Shift + Tab |

La riduzione del rientro rimuove un livello di annidamento e **si ferma al livello più esterno** — non
estrae un elemento dall'elenco. Per uscire del tutto da un elenco, usa **Rimuovi
elenco**, oppure premi di nuovo il pulsante dell'elenco per disattivarlo.

## Impostazioni

Il comportamento dell'escape con Tab può essere personalizzato in **Impostazioni → Editor**:

| Impostazione | Effetto |
|-------------|---------|
| **Auto-accoppia Parentesi** | Abilita/disabilita l'accoppiamento delle parentesi e l'escape con Tab |
| **Parentesi CJK** | Includi le coppie di parentesi CJK |
| **Virgolette Curve** | Includi le coppie di virgolette curve (`“”` `‘’`); una virgoletta dritta digitata diventa una coppia curva |

::: tip
Se l'escape con Tab è in conflitto con il tuo flusso di lavoro, puoi disabilitare completamente l'auto-accoppiamento delle parentesi. Tab inserirà quindi spazi (o indenterà negli elenchi/tabelle) normalmente.
:::

## Confronto: Modalità WYSIWYG vs Sorgente

| Funzione | Tab (WYSIWYG) | Shift+Tab (WYSIWYG) | Tab (Sorgente) | Shift+Tab (Sorgente) |
|----------|--------------|---------------------|----------------|---------------------|
| Escape parentesi | ✓ | ✓ | ✓ | — |
| Escape parentesi CJK | ✓ | ✓ | ✓ | — |
| Escape virgolette curve | ✓ | ✓ | ✓ | — |
| Escape segni (grassetto, ecc.) | ✓ | ✓ | N/A | N/A |
| Escape collegamento | ✓ | ✓ | ✓ (navigazione campi) | — |
| Escape caratteri Markdown (`*`, `_`, `~~`, `==`) | N/A | N/A | ✓ | — |
| Auto-accoppiamento Markdown (`*`, `~`, `_`, `=`) | N/A | N/A | ✓ (basato su ritardo) | N/A |
| Navigazione tabella | Cella successiva | Cella precedente | N/A | N/A |
| Rientro elenco | Aumenta | Diminuisce | Aumenta | Diminuisce |
| Supporto multi-cursore | ✓ | ✓ | ✓ | — |
| Saltato all'interno di blocchi di codice | ✓ | ✓ | ✓ | N/A |

## Supporto Multi-Cursore

L'escape con Tab funziona con più cursori — ogni cursore viene elaborato indipendentemente.

### Come Funziona

Quando hai più cursori e premi Tab o Shift+Tab:
- **Tab**: I cursori all'interno della formattazione escono alla fine; i cursori prima delle parentesi di chiusura saltano oltre di esse
- **Shift+Tab**: I cursori all'interno della formattazione escono all'inizio; i cursori dopo le parentesi di apertura saltano prima di esse
- I cursori nel testo normale rimangono fermi

### Esempio

```text
**bold|** and [link|](url) and plain|
     ^1          ^2            ^3
```

Premi **Tab**:

```text
**bold**| and [link](url)| and plain|
        ^1               ^2         ^3
```

Ogni cursore esce indipendentemente in base al suo contesto.

::: tip
Questo è particolarmente potente per le modifiche in blocco — seleziona più occorrenze con `Mod + D`, poi usa Tab per uscirne tutte contemporaneamente.
:::

## Priorità e Comportamento nei Blocchi di Codice

### Priorità dell'Escape

Quando più destinazioni di escape si sovrappongono, Tab le elabora **dalla più interna**:

```text
**bold text(|)** here
               ↑ Tab salta ) prima (la parentesi è la più interna)
```

Premi **Tab** di nuovo:

```text
**bold text()**| here
               ↑ Tab esce dal segno grassetto
```

Ciò significa che il salto della parentesi si attiva sempre prima dell'escape del segno — puoi fare affidamento su Tab per uscire prima dalle parentesi, poi dalla formattazione.

### Protezione del Blocco di Codice

I salti con Tab e Shift+Tab sono **disabilitati all'interno dei blocchi di codice** — sia i nodi `code_block` che gli span di codice inline. Questo impedisce a Tab di saltare oltre le parentesi nel codice, dove le parentesi sono sintassi letterale:

```text
`array[index|]`
              ↑ Tab NON salta ] nel codice inline — inserisce spazi
```

Anche l'inserimento dell'auto-accoppiamento è disabilitato all'interno dei blocchi di codice sia per la modalità WYSIWYG che per la modalità Sorgente.

## Suggerimenti

1. **Memoria muscolare** — Una volta che ti abitui all'escape con Tab, ti ritroverai a navigare molto più velocemente senza i tasti freccia.

2. **Funziona con l'auto-accoppiamento** — Quando digiti `(`, VMark inserisce automaticamente `)`. Dopo aver digitato all'interno, usa semplicemente Tab per uscire.

3. **Strutture annidate** — Tab esce un livello alla volta. Per `((annidate))`, hai bisogno di due Tab per uscire completamente.

4. **Shift + Tab** — Il contrario di Tab. Esce all'indietro dai segni, dai collegamenti e dalle parentesi di apertura. Nelle tabelle, si sposta alla cella precedente. Negli elenchi, riduce il rientro.

5. **Multi-cursore** — L'escape con Tab funziona con tutti i tuoi cursori contemporaneamente, rendendo le modifiche in blocco ancora più veloci.

## Passare da una scheda aperta all'altra

Le schede si trovano nella barra di stato in fondo alla finestra. Ci sono tre modi per spostarsi
tra di esse:

| Azione | Scorciatoia | Note |
|---|---|---|
| Ultima scheda usata | `Ctrl + Tab` | Salta alla scheda in cui eri prima di questa. Premila di nuovo per tornare subito indietro. |
| Scheda successiva / precedente | `Mod + Shift + ]` / `Mod + Shift + [` | Si sposta lungo la barra in ordine, indipendentemente da ciò che hai usato di recente. |
| Apertura rapida | `Mod + O` | Digita per filtrare. Le schede aperte compaiono per prime, con quella usata più di recente in cima. |

**Ultima scheda usata è un interruttore, non un ciclo.** Ti porta al documento in cui
eri più di recente, e premerla una seconda volta ti riporta al punto di
partenza — il modo rapido per lavorare tra due file. Scheda successiva e precedente invece percorrono
la barra in base alla posizione, ed è ciò che serve quando stai cercando
qualcosa invece di tornarci.

È sia una voce di menu sia una scorciatoia (**Vista → Ultima scheda usata**), ed è
questo che le permette di continuare a funzionare mentre il browser integrato ha il focus della tastiera.

### Quando le schede non entrano tutte

La barra delle schede scorre. Quando ci sono schede oltre uno dei bordi, la barra sfuma su
quel bordo e compare una piccola freccia — fai clic per scorrere di una schermata. Passare
a un'altra scheda in qualsiasi modo fa anche scorrere la nuova scheda nella vista, così la scheda evidenziata non è
mai nascosta fuori dallo schermo.

La barra stessa è raggiungibile da tastiera: arrivaci con Tab e usa i tasti freccia.

## Due documenti affiancati

**Vista → Dividi editor — due documenti** (`Alt + Mod + \`) mette un secondo
documento accanto a quello corrente. Per scegliere quale documento, fai clic destro su una scheda qualsiasi
e scegli **Apri di lato**.

| Azione | Scorciatoia |
|---|---|
| Dividi editor — due documenti | `Alt + Mod + \` |
| Chiudi riquadro | `Alt + Mod + Shift + \` |
| Attiva l'altro riquadro | `Alt + Mod + Shift + O` |
| Sincronizza lo scorrimento | *(nessuna predefinita)* |

Note sul comportamento:

- La scheda mostrata nell'**altro** riquadro è contrassegnata nella barra delle schede da una leggera
  sottolineatura, così sai sempre quali due documenti sono sullo schermo e in quale
  andrà ciò che digiti.
- **Chiudere uno dei due fa ricadere la vista sull'altro**, invece di farti saltare
  a una scheda non correlata. Il documento rimasto resta dov'è.
- **Sincronizza lo scorrimento** collega proporzionalmente lo scorrimento dei due riquadri.
  È disattivato per impostazione predefinita ed è specifico per ogni divisione.
- **I due riquadri condividono un'unica modalità di visualizzazione.** La modalità sorgente (`F6`)
  cambia entrambi i riquadri insieme, e spostarsi tra i riquadri mantiene la modalità attuale.
- La divisione richiede due documenti aperti. Le schede del browser non sono documenti, quindi la
  divisione non si applica a esse.

## Il menu contestuale della scheda

Fai clic destro su una scheda per aprirne il menu. I tasti freccia, Home e Fine si spostano al suo interno; Invio o Spazio eseguono una voce; Esc lo chiude.

| Voce | Cosa fa | Disponibile quando |
|---|---|---|
| Sposta in una nuova finestra | Sposta la scheda in una nuova finestra, con un **Annulla** nella conferma. Una finestra secondaria rimasta vuota si chiude. | Il documento è caricato e non è l'unica scheda della finestra principale |
| Fissa / Sblocca | Fissa o sblocca la scheda — vedi [Schede fissate](#schede-fissate). | Sempre |
| Apri di lato | Mostra la scheda nell'altro riquadro della divisione — vedi [Due documenti affiancati](#due-documenti-affiancati). | Sia questa scheda sia quella attiva sono documenti, e questa non è la scheda attiva (non mostrata per le schede del browser) |
| Rinomina | Rinomina il file direttamente nella scheda — vedi [Rinominare un file](#rinominare-un-file). | Il documento è stato salvato |
| Copia percorso | Copia il percorso assoluto del file. | Il documento è stato salvato |
| Copia percorso relativo | Copia il percorso relativo alla cartella dello spazio di lavoro. | È aperto uno spazio di lavoro e il file si trova al suo interno |
| Mostra nel Finder | Mostra il file nel Finder (**Mostra in Esplora risorse** su Windows, **Mostra nel gestore file** su Linux). | Il documento è stato salvato |
| Ripristina su disco | Riscrive il contenuto della scheda nel suo percorso. | Il file è stato eliminato dal disco mentre era aperto |
| Torna alla versione salvata | Dopo una conferma, scarta le tue modifiche e ricarica il file dal disco. | La scheda ha modifiche non salvate e il suo file esiste ancora |
| Chiudi | Chiude la scheda (chiede prima di salvare se ci sono modifiche non salvate). | La scheda non è fissata |
| Chiudi altre | Chiude tutte le altre schede non fissate. | Esiste un'altra scheda non fissata |
| Chiudi schede a destra | Chiude le schede non fissate alla sua destra. | Ne esiste almeno una |
| Chiudi schede non fissate | Chiude tutte le schede non fissate, compresa questa. | Esiste una scheda non fissata |
| Chiudi tutto | Chiude tutte le schede, comprese quelle fissate. Se verrebbe chiusa una scheda fissata, prima chiede conferma indicando quante sono; annullando non si chiude nulla. | Sempre |

Le chiusure multiple agiscono sulle schede dello spazio di lavoro corrente e le chiudono una alla volta. Ogni scheda con modifiche non salvate chiede prima conferma, e annullare una qualsiasi di queste richieste interrompe le restanti.

## Schede fissate

Fissa una scheda dal suo menu contestuale per tenerla a portata di mano:

- Si sposta nel gruppo delle schede fissate a sinistra della barra, mostra un'icona a forma di puntina e perde il pulsante di chiusura. Le schede non possono essere trascinate oltre il confine tra schede fissate e non fissate (*"Le schede fissate rimangono a sinistra. Rilascio bloccato."*), e una scheda fissata non può essere trascinata fuori dalla sua finestra.
- Non può essere chiusa in alcun modo — `Mod + W`, clic centrale, **Chiudi** o una chiusura multipla — finché non la sblocchi; il tentativo mostra *"Sblocca prima di chiudere"*. Fanno eccezione due chiusure intenzionali: **Chiudi tutto** chiude anche le schede fissate dopo la tua conferma, e chiudere un'area di lavoro dalla barra chiude le sue schede fissate insieme alle altre.
- Chiudere una finestra che contiene schede fissate chiede conferma — *"Questa finestra ha N schede fissate. Chiudere comunque?"* — a meno che non sia già stata mostrata una finestra di salvataggio.
- Una scheda resta fissata se la sposti in un'altra finestra o in un altro spazio di lavoro e dopo un riavvio per aggiornamento, ma non quando esci da VMark: le schede riaperte all'avvio successivo non sono fissate.

Non esiste una scorciatoia da tastiera per fissare una scheda.

## Rinominare un file

Scegli **Rinomina** nel menu contestuale di una scheda. Il nome diventa modificabile nella scheda, con la parte che precede l'estensione selezionata. Invio o un clic altrove confermano; Esc annulla. Il file viene rinominato sul disco e ogni scheda aperta che vi punta si aggiorna di conseguenza. VMark non sovrascrive mai: se il nome è già in uso, una finestra di dialogo indica *Esiste già un file chiamato "X".* Un nome vuoto, invariato, `.` o `..`, oppure che contiene `/` o `\`, viene rifiutato o ignorato. Ciò che digiti è il nome completo — se elimini l'estensione, il file la perde.

Su **macOS**, con **Impostazioni → Aspetto → Mostra il nome del file nella barra del titolo** attivo, puoi anche fare doppio clic sul nome del file nella barra del titolo per rinominarlo. Valgono le stesse regole e gli stessi messaggi; dopo un conflitto o un errore il nome resta modificabile, così puoi provarne un altro. Se **Mostra le estensioni dei file** è disattivato, l'estensione originale viene mantenuta quando digiti un nome senza estensione. Un doppio clic sul titolo di un documento non salvato apre invece **Salva**.

## Chiudere schede e finestre

Nulla che abbia modifiche non salvate viene chiuso senza chiedere.

- **Chiudere una scheda** con modifiche non salvate (`Mod + W`, la × della scheda o **Chiudi**) chiede *"Vuoi salvare le modifiche a …?"* con **Salva**, **Non salvare** e **Annulla**. **Salva** su un documento mai salvato apre una finestra di salvataggio nella tua cartella di salvataggio predefinita, con il titolo della scheda come nome suggerito. Annullare quella finestra, o un salvataggio non riuscito, lascia la scheda aperta.
- **Chiudere una finestra** con un documento non salvato pone la stessa domanda. Con due o più, un'unica finestra di dialogo li elenca tutti — i documenti mai salvati sono contrassegnati come *(nuovo)* — con **Salva tutto**, **Non salvare** e **Annulla**.
- **Salva tutto** salva ogni documento che ha un file. Per i documenti mai salvati chiede una posizione: una finestra di salvataggio se ce n'è uno solo, oppure **un unico selettore di cartella** se sono diversi (*"Scegli cartella per N nuovi documenti"*). Ognuno viene poi salvato in quella cartella con il proprio titolo, e un nome già in uso riceve un numero (`Untitled 2.md`), così nulla viene sovrascritto.
- **Uscire** (`Mod + Q`) esegue lo stesso controllo in ogni finestra, una finestra alla volta; annullare in una qualsiasi finestra annulla l'uscita. Con **Impostazioni → File e immagini → Conferma uscita** attivo (il valore predefinito), la prima pressione mostra solo *"Premi di nuovo ⌘Q per uscire"* — premilo di nuovo entro due secondi. Un'uscita richiesta dal sistema operativo (per esempio allo spegnimento) salta la doppia pressione.
- **Salva tutto ed esci** salva i documenti non salvati di ogni finestra senza la finestra di dialogo — chiedendo comunque dove mettere quelli mai salvati (una finestra di salvataggio, o un selettore di cartella per più documenti, nella finestra che li contiene) — poi esce. Se un documento non può essere salvato, o annulli quella finestra di dialogo, l'uscita si interrompe: quella finestra resta aperta e un salvataggio non riuscito ne indica il motivo.

Su macOS, VMark continua a funzionare dopo la chiusura dell'ultima finestra; su Windows e Linux, chiudere l'ultima finestra fa uscire dall'app — a meno che, su Windows, **Impostazioni → File e immagini → Riduci nell’area di notifica alla chiusura** sia attivo: in quel caso l'ultima finestra viene invece nascosta nell'area di notifica, senza chiudere nulla e senza richiesta di salvataggio (vedi [Impostazioni](/it/guide/settings)).
