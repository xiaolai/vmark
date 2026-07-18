# Coerenza e la vista di dettaglio

Il livello di coerenza di VMark mantiene onesti i progetti di scrittura sviluppati ricorsivamente: registra **quali documenti ha letto davvero ogni generazione IA**, si accorge quando quei documenti sorgente cambiano in seguito e ti mostra — su richiesta — esattamente quali artefatti derivati potrebbero ora essere obsoleti. Nulla viene mai aggiornato automaticamente; il caporedattore resti tu.

## Come funziona (30 secondi)

- Ogni salvataggio, applicazione di un genie, suggerimento IA accettato, scrittura via MCP e step `save-file` di un workflow viene registrato come **trasformazione** in un registro (ledger) in testo semplice dentro il tuo workspace (`.vmark/` — JSONL git-friendly e leggibile; eliminare l'`index.db` derivato non perde nulla).
- Quando un'IA scrive un documento mentre ne legge altri, quelle letture diventano **archi di dipendenza**, fissati alla revisione esatta che è stata letta.
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
- **Esenta** — registra una divergenza intenzionale con un **motivo obbligatorio** (i narratori inaffidabili esistono). Gli elementi esentati restano visibili, contrassegnati in modo distinto, e si riaprono se la sorgente si muove ancora.

Accetta più recente ed esenta sono disabilitati quando la sorgente ha più versioni correnti — non c'è un'unica revisione con cui risolvere; prima rivedi (o riconcilia le versioni).

## Verifica semantica, affermazioni e contesti

L'obsolescenza di versione dice che una sorgente si è *mossa*; la verifica semantica dice se quel movimento *contraddice* davvero il documento derivato. Le verifiche sono strettamente **pull**: premi **Verifica** su un arco obsoleto e VMark chiede al provider di IA configurato di confrontare la revisione fissata della sorgente, quella corrente e il testo derivato. Il verdetto arriva come un badge — *verificato valido*, *contraddetto* (sempre con una citazione testuale come evidenza) o *non verificato* quando il modello era incerto, è andato in timeout o ha risposto sotto la soglia di confidenza. L'ignoto è onesto, mai nascosto. Una verifica scade nel momento in cui uno dei due documenti si muove di nuovo — o l'insieme delle affermazioni cambia.

Le **affermazioni canoniche** sono fatti che hai reso espliciti («Elena è mancina»). Seleziona del testo in un documento ed esegui *Estrai affermazione dalla selezione*: l'affermazione nasce come **bozza**, con la sua provenienza (quale documento, quale revisione). Promuovila a **stabilita** quando diventa canone — solo le affermazioni stabilite alimentano le verifiche semantiche. Correggere o ritirare un'affermazione aggiunge cronologia; nulla viene mai eliminato. Nascondere un'affermazione in un contesto è visibilità reversibile, non un ritiro.

I **contesti** sono viste con nome del workspace (il contesto *default* c'è sempre). Ogni contesto stabilisce cosa significa «corrente» e quali affermazioni si applicano; un contesto figlio eredita in modo additivo le affermazioni del genitore. I contesti sono **serra** per impostazione predefinita — i verdetti delle verifiche si leggono come tensione consultiva. Passarne uno ad **applicato** (un atto esplicito e confermato) contrassegna le contraddizioni come violazioni del canone. Il selettore di contesto della vista di dettaglio sceglie attraverso quale contesto stai guardando; i risultati delle verifiche sono legati esattamente al contesto e allo snapshot di affermazioni che li hanno prodotti e non trapelano mai dall'uno all'altro.

## Identità nel frontmatter

La prima volta che un file viene acquisito, VMark aggiunge un piccolo blocco di identità al suo frontmatter:

```yaml
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
```

Questo ID è il modo in cui un documento conserva la propria cronologia attraverso rinomine e spostamenti. Non influisce mai sull'hash del contenuto (aggiungerlo non crea una "modifica"), e tutto il resto del tuo frontmatter viene lasciato intatto. Se copi un file, l'ID duplicato viene rilevato e segnalato perché sia tu a risolverlo — mai corretto automaticamente.

## Interoperabilità con git

- I file del registro `.vmark/` sono tracciati da git e si fondono in modo pulito tra i branch (solo append, `merge=union`).
- Checkout, cambi di branch e reset sono riconosciuti come **navigazione** — non creano mai revisioni fantasma.
- `git revert` e i merge che generano nuovo contenuto vengono acquisiti come trasformazioni attribuite a git.
- L'indice derivato (`index.db`) è nel gitignore e viene ricostruito dal registro in testo semplice ogni volta che serve.

## Per gli agenti IA (MCP)

Gli agenti esterni possono interrogare lo stato di coerenza tramite lo [strumento MCP `coherence`](/it/guide/mcp-tools#coherence) (azioni `status` ed `edges`), per i workspace che hai aperto in VMark. `status` è una lettura pura; `edges` riconcilia prima — può aggiungere record di provenienza al registro del workspace stesso, ma non tocca mai i tuoi documenti. La risoluzione (ratifica/esenzione) deliberatamente *non* è esposta via MCP in questa versione — le decisioni restano all'essere umano nell'app.
