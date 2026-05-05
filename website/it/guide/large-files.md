# File di grandi dimensioni

VMark apre la maggior parte dei file Markdown all'istante, ma i file molto grandi richiedono qualche accorgimento per restare reattivi. Questa pagina descrive come VMark li gestisce e come puoi regolarne il comportamento.

## Cosa si considera "grande"

VMark classifica un file in base alla dimensione prima di aprirlo:

| Dimensione | Categoria | Cosa succede |
|------------|-----------|--------------|
| < 1 MB | Piccolo | Si apre immediatamente in modalità WYSIWYG (testo formattato). |
| 1 MB – 5 MB | Grande | Si apre in **modalità Sorgente** per impostazione predefinita — in meno di un secondo. La barra di stato propone "Passa a WYSIWYG". |
| 5 MB – 50 MB | Molto grande | Compare prima una finestra di conferma. Si apre solo in modalità Sorgente. |
| ≥ 50 MB | Rifiutato | VMark rifiuta di aprire il file. Usa `less`, `bat` o uno strumento simile. |

La dimensione viene letta dal sistema operativo senza leggere il file, quindi la decisione è rapida e non precarica dati.

## Perché la modalità Sorgente per i file grandi

La modalità Sorgente usa CodeMirror con virtualizzazione del viewport — viene renderizzata solo la porzione visibile del documento. La modalità WYSIWYG usa Tiptap/ProseMirror, che deve costruire un nodo DOM per ogni blocco del documento. Per un file Markdown da 1,4 MB con circa 2.250 blocchi questo richiede circa 15 secondi alla prima apertura; la modalità Sorgente apre lo stesso file in meno di un secondo.

Il collo di bottiglia non è il parsing — è la costruzione della view di ProseMirror. Spostare il parsing fuori dal thread principale non migliorerebbe in modo significativo l'attesa percepita.

## Indicazioni nella barra di stato

- **Apertura di un file grande in WYSIWYG:** uno spinner indeterminato con l'etichetta *"Apertura file grande (N MB)…"* compare a sinistra della barra di stato mentre l'editor si monta. Sparisce non appena l'editor è interattivo.
- **File aperto automaticamente in modalità Sorgente:** la barra di stato mostra *"Aperto in modalità Sorgente (file grande)."* con un collegamento **Passa a WYSIWYG**. Cliccando il collegamento la scheda attiva passa a WYSIWYG. Chiudendo e riaprendo il file si torna in modalità Sorgente — l'override vale solo per la sessione.

## Impostazioni

Apri **Impostazioni → Editor → File di grandi dimensioni**:

- **Apri automaticamente i file oltre 1 MB in modalità Sorgente** *(attivo per impostazione predefinita)* — disattiva se preferisci WYSIWYG per i file fino a 5 MB, accettando un tempo di apertura più lungo.
- **Avvisa prima di aprire file oltre 5 MB** *(attivo per impostazione predefinita)* — disattiva per saltare la finestra di conferma per i file tra 5 MB e 50 MB. Si apriranno comunque in modalità Sorgente.

Il rifiuto rigido a 50 MB non è regolabile dall'utente. La webview non può contenere in sicurezza stringhe di dimensione arbitraria senza rischio di crash per esaurimento di memoria.

## Suggerimenti

- Se devi continuare a modificare un file molto grande in WYSIWYG, valuta di suddividerlo in file più piccoli collegati da un documento indice. Markdown funziona bene come insieme di capitoli più brevi.
- Se devi solo leggere o cercare in un file grande, la modalità Sorgente con il righello dei numeri di riga e `Find` (`Mod + F`) è di solito il flusso più veloce.
- `Formato > Formatta testo CJK` e altri comandi che agiscono sull'intero documento funzionano correttamente anche sui documenti in modalità Sorgente.

## Casi limite

- **Il file cresce mentre è aperto.** VMark decide la categoria in base alla dimensione al momento dell'apertura. Un file che cresce fino a 2 MB mentre lo modifichi resta nella modalità che hai scelto.
- **Symlink.** Le dimensioni si riferiscono al file di destinazione, quindi un symlink a un file da 10 MB viene trattato come molto grande.
- **File vuoti.** I file da zero byte sono considerati piccoli e si aprono in WYSIWYG.
- **Il file scompare tra il controllo della dimensione e la lettura.** Compare il normale errore "file non trovato" — non viene mostrato alcun avviso aggiuntivo.

## Limitazioni note

- Le soglie sono dimensioni in byte, che approssimano il costo reale (numero di blocchi). Un file da 600 KB con migliaia di blocchi brevi può essere più lento di un file da 1,2 MB di paragrafi lunghi. I valori predefiniti sono prudenti.
- La fase C dell'iniziativa sui file grandi (rendering WYSIWYG differito) non è ancora rilasciata — vedi `dev-docs/plans/20260422-large-file-open-ux.md` per lo stato.
