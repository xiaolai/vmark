# Esportare la cronologia delle modifiche in Git

VMark tiene una cronologia delle modifiche per ogni documento: ogni salvataggio e ogni modifica che un client IA fa tramite MCP viene registrata, insieme a chi l’ha fatta. **File → Cronologia documento → Esporta cronologia modifiche in Git…** copia questa cronologia in un repository Git, così puoi scorrerla con `git log`, confrontarla o conservarla con il tuo progetto.

## Come esportare

1. Apri il documento di cui vuoi la cronologia.
2. Scegli **File → Cronologia documento → Esporta cronologia modifiche in Git…** (oppure esegui *Esporta cronologia modifiche in Git* dalla tavolozza dei comandi).
3. Scegli una cartella all’interno del repository Git. Il selettore si apre nella cartella del documento.

VMark ti dice quanti commit ha aggiunto, oppure che il branch era già aggiornato.

## Cosa contiene il branch

La cronologia va in un branch a sé, `vmark-journal/<document-uuid>`. VMark non tocca mai il tuo albero di lavoro, l’indice, `HEAD` o qualsiasi altro branch, e non cambia branch. Il branch contiene un file, con il nome del documento.

- **Un commit per revisione.** L’autore è chi ha fatto la modifica (tu o il client IA), e la data è il momento della modifica.
- **Un commit di riepilogo per ogni tratto di cronologia sfoltita.** VMark sfoltisce le revisioni vecchie per mantenere piccola la cronologia. Una serie di revisioni sfoltite diventa un unico commit chiamato *Collected history*, che elenca tutti quelli che hanno modificato in quel tratto.

Ogni messaggio di commit termina con dei trailer che lo collegano a VMark:

| Trailer | Significato |
|---------|-------------|
| `VMark-Document` | L’identità del documento, uguale in ogni commit |
| `VMark-Revision` | La revisione registrata da questo commit |
| `VMark-Parent` | La revisione precedente |
| `VMark-Actor` | Chi ha fatto la modifica |
| `VMark-Kind` | Come è stata registrata: `controlled` (una modifica IA tramite VMark), `observed` (un salvataggio), `gap` (una modifica fatta fuori da VMark) e altri |
| `VMark-Tool` | Lo strumento MCP dietro una modifica IA |
| `VMark-Session`, `VMark-Client` | L’etichetta di sessione e il nome del client IA, quando li ha forniti |
| `VMark-Collected` | In un commit di riepilogo: l’intervallo di revisioni sfoltite che copre |
| `VMark-Actors` | In un commit di riepilogo: tutti quelli che hanno modificato in quell’intervallo, in ordine |

## Esportare di nuovo

Esporta tutte le volte che vuoi. Una nuova esportazione aggiunge solo le revisioni fatte dopo la precedente; se non c’è niente di nuovo, non cambia nulla. La stessa cronologia produce sempre gli stessi commit.

VMark rifiuta, invece di sovrascrivere, quando il branch non è più quello che ha lasciato:

- **Il branch è cambiato dall’ultima esportazione** (qualcuno ci ha fatto commit, l’ha riportato indietro o riscritto). Sposta o elimina il branch, poi esporta di nuovo.
- **Esiste un branch con quel nome, ma non è l’esportazione VMark di questo documento.**
- **Il branch è attivo** in un worktree.

## Requisiti e limiti

- Git deve essere installato. VMark lo cerca nel `PATH` della tua shell di login; se manca, l’esportazione lo dice.
- Viene esportata solo la cronologia salvata. Le modifiche non ancora salvate non ne fanno parte.
- VMark crea i commit con i comandi di basso livello di Git, quindi gli hook di commit non vengono eseguiti. Gli hook che osservano gli aggiornamenti dei branch vengono eseguiti.
- Una cronologia grande richiede un po’ di tempo: ogni commit costa alcuni processi Git.
- In un clone superficiale (shallow clone), VMark prosegue solo un branch che ha esportato lui stesso da questo computer.
- Non attivare il branch di esportazione mentre l’esportazione è in corso. Un checkout successivo all’ultimo controllo dei worktree può lasciare l’indice e i file di quel worktree non allineati al suo branch, che nel frattempo si è spostato.
