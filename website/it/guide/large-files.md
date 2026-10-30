# File di grandi dimensioni

VMark apre la maggior parte dei file Markdown all'istante, ma i file molto grandi richiedono qualche accorgimento per restare reattivi. Questa pagina descrive come VMark li gestisce e come puoi regolarne il comportamento.

## Cosa si considera "grande"

VMark classifica un file in base alla dimensione e, per il Markdown, a una stima del numero di blocchi prima di aprirlo:

| Dimensione o numero di blocchi | Categoria | Cosa succede |
|------------|-----------|--------------|
| < 1 MB e meno di 1.200 blocchi stimati | Piccolo | Si apre immediatamente in modalità WYSIWYG (testo formattato). |
| 1 MB – 5 MB, o 1.200+ blocchi stimati | Grande | Si apre in **modalità Sorgente** per impostazione predefinita — in meno di un secondo. La barra di stato propone "Passa a WYSIWYG". |
| 5 MB – 50 MB | Molto grande | Compare prima una finestra di conferma. Si apre solo in modalità Sorgente. |
| ≥ 50 MB | Rifiutato | VMark rifiuta di aprire il file. Usa `less`, `bat` o uno strumento simile. |

La dimensione viene letta dal sistema operativo senza leggere il file. Quando un file Markdown è sotto 1 MB, VMark stima poi il numero di blocchi con una scansione riga per riga dei suoi byte — non un'analisi Markdown — così la decisione resta rapida e il documento non viene mai caricato nella webview.

## Perché la modalità Sorgente per i file grandi

La modalità Sorgente usa CodeMirror con virtualizzazione del viewport — viene renderizzata solo la porzione visibile del documento. La modalità WYSIWYG usa Tiptap/ProseMirror, che deve costruire un nodo DOM per ogni blocco del documento. Per un file Markdown da 1,4 MB con circa 2.250 blocchi questo richiede circa 15 secondi alla prima apertura; la modalità Sorgente apre lo stesso file in meno di un secondo.

Il costo di costruzione della vista segue il numero di blocchi, non la dimensione del file. Tre fixture di dimensioni quasi identiche (377–397 KB), che differivano solo nel modo in cui i byte erano suddivisi in blocchi, si sono aperte in 3,6, 5,2 e 18 secondi con 601, 1.201 e 3.401 blocchi. Un documento da 524 KB con 3.773 blocchi brevi ha impiegato più di 30 secondi su quella macchina — sotto la soglia di 1 MB, ma ben oltre il punto in cui la finestra smette di rispondere. Per questo la stima dei blocchi può da sola instradare un file in modalità Sorgente.

La maggior parte di quel tempo va nella costruzione e nell'impaginazione della view, non nel parsing. Su un lungo documento CJK misurato su una macchina lenta, il parsing era tra un quarto e due quinti del costo di apertura dell'editor.

## Mentre un documento si apre

Una finestra risponde ai menu, alle scorciatoie e al pulsante di chiusura prima che VMark costruisca la vista rich text del documento, che compare subito dopo. In passato un documento lungo veniva costruito per primo e, su una macchina lenta, questo poteva impedire alla finestra di essere pronta: i menu rispondevano in ritardo e il log riportava *menu commands did not mount within 5000ms*.

Anche ciò che WYSIWYG fa all'apertura resta proporzionato al documento:

- Le immagini si caricano quando si avvicinano all'area visibile.
- **Spaziatura tra Lettere CJK** (**Impostazioni → Editor → Tipografia**) non fa alcun lavoro finché è disattivata, come da impostazione predefinita, e analizza il documento una sola volta quando è attiva.
- Le decorazioni, come l'evidenziazione del codice, la spaziatura CJK e i segni del lint, costano all'incirca in modo lineare rispetto alla lunghezza del documento. I documenti molto lunghi costavano in modo quadratico.
- Oltre 100.000 caratteri, WYSIWYG disattiva il controllo ortografico di sistema per quel documento, perché ricontrollare dopo ogni modifica rallenta la digitazione. Si riattiva se il documento torna sotto quella dimensione. La modalità Sorgente non è interessata.

## Indicazioni nella barra di stato

- **Apertura di un file grande in WYSIWYG:** uno spinner indeterminato con l'etichetta *"Apertura file grande (N MB)…"* compare a sinistra della barra di stato mentre l'editor si monta. Sparisce non appena l'editor è interattivo.
- **File aperto automaticamente in modalità Sorgente:** la barra di stato mostra *"Aperto in modalità Sorgente (file grande)."* con un collegamento **Passa a WYSIWYG**. Cliccando il collegamento la scheda attiva passa a WYSIWYG. Chiudendo e riaprendo il file si torna in modalità Sorgente — l'override vale solo per la sessione.
- **Documento che WYSIWYG non può visualizzare:** un documento con citazioni o elenchi annidati per più di 1000 livelli non può essere analizzato come testo formattato, qualunque sia la sua dimensione. Si apre in modalità Sorgente con un messaggio che indica la profondità, e la barra di stato mostra *"Aperto in modalità Sorgente (non visualizzabile in WYSIWYG)."* Riduci l'annidamento, poi usa **Passa a WYSIWYG**.

## Impostazioni

Apri **Impostazioni → Editor → File di grandi dimensioni**:

- **Apri automaticamente i file di grandi dimensioni in modalità Sorgente** *(attivo per impostazione predefinita)* — vale per i file oltre 1 MB e per il Markdown con molti blocchi. Disattiva se preferisci WYSIWYG per i file fino a 5 MB, accettando un tempo di apertura più lungo.
- **Avvisa prima di aprire file oltre 5 MB** *(attivo per impostazione predefinita)* — disattiva per saltare la finestra di conferma per i file tra 5 MB e 50 MB. Si apriranno comunque in modalità Sorgente.

Il rifiuto rigido a 50 MB non è regolabile dall'utente. La webview non può contenere in sicurezza stringhe di dimensione arbitraria senza rischio di crash per esaurimento di memoria.

## Suggerimenti

- Se devi continuare a modificare un file molto grande in WYSIWYG, valuta di suddividerlo in file più piccoli collegati da un documento indice. Markdown funziona bene come insieme di capitoli più brevi.
- Se devi solo leggere o cercare in un file grande, la modalità Sorgente con il righello dei numeri di riga e `Find` (`Mod + F`) è di solito il flusso più veloce.
- **Formato → CJK → Formatta intero file** e altri comandi che agiscono sull'intero documento funzionano correttamente anche sui documenti in modalità Sorgente.

## Casi limite

- **Il file cresce mentre è aperto.** VMark decide la categoria in base alla dimensione al momento dell'apertura. Un file che cresce fino a 2 MB mentre lo modifichi resta nella modalità che hai scelto.
- **Symlink.** Le dimensioni si riferiscono al file di destinazione, quindi un symlink a un file da 10 MB viene trattato come molto grande.
- **File vuoti.** I file da zero byte sono considerati piccoli e si aprono in WYSIWYG.
- **Il file scompare tra il controllo della dimensione e la lettura.** Compare il normale errore "file non trovato" — non viene mostrato alcun avviso aggiuntivo.

## Limitazioni note

- Il conteggio dei blocchi è una stima, non un'analisi: testo separato da righe vuote, titoli, elementi di elenco, righe di tabella e ogni blocco di codice delimitato contano come un blocco, mentre il codice all'interno di un delimitatore e le righe di frontmatter vengono saltati. Un documento dalla forma insolita può essere instradato in modalità Sorgente quando WYSIWYG sarebbe stato abbastanza veloce; **Passa a WYSIWYG** è un clic. I file non Markdown non vengono mai instradati in base al numero di blocchi.
- WYSIWYG costruisce ancora ogni blocco del documento all'apertura — solo le immagini e le formule matematiche in linea aspettano di avvicinarsi all'area visibile — quindi passare un file grande a WYSIWYG richiede tutto il tempo di apertura descritto sopra.
