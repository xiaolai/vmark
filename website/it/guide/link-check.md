# Controllo collegamenti

VMark verifica che i target locali di collegamenti e immagini nel tuo markdown esistano effettivamente su disco. Viene eseguito insieme al [motore di lint markdown](/it/guide/lint) tramite `Cmd-Shift-L` o **Strumenti → Controlla Markdown**.

## Cosa controlla

Per ogni collegamento e immagine locale nel documento:

- `[testo](./altro.md)` — il file `./altro.md` si risolve ed esiste
- `![alt](./immagine.png)` — il file immagine esiste
- `[testo](./altro.md#sezione)` — il file esiste (il controllo dell'ancoraggio è gestito dalla [regola `linkFragments`](/it/guide/lint#riferimento-delle-regole))

Quando un target è mancante, il testo del collegamento viene sottolineato con un ondulato rosso e una voce appare nel badge del lint / nella navigazione F2.

## Cosa salta

- **Collegamenti solo frammento** (`#ancoraggio`) — gestiti dalla regola `linkFragments` che controlla rispetto alle intestazioni del documento corrente
- **URL esterni** — `http://`, `https://`, `ftp://`, `mailto:`, `tel:`, `data:`, `file:`
- **Documenti senza titolo** — senza un percorso di file salvato, gli URL relativi non possono essere risolti rispetto a nessuna directory

## Come funziona la risoluzione

Il controllo dei collegamenti risolve i percorsi rispetto alla directory del file sorgente:

| Collegamento in `/repo/docs/intro.md` | Si risolve in |
|---|---|
| `[a](./altro.md)` | `/repo/docs/altro.md` |
| `[a](../condiviso.md)` | `/repo/condiviso.md` |
| `[a](immagini/logo.png)` | `/repo/docs/immagini/logo.png` |
| `[a](/docs/intro.md)` | `/repo/docs/docs/intro.md` (radicato come relativo all'interno della directory del file) |

I frammenti vengono rimossi prima della ricerca del file — `[a](./altro.md#sezione)` controlla solo `./altro.md`.

## Prestazioni

- **Asincrono** — viene eseguito in parallelo con le regole sincrone; i risultati vengono integrati quando pronti
- **Deduplicato** — ogni percorso risolto univoco viene controllato una sola volta per esecuzione, anche se collegato più volte
- **Nessun trigger su pressione tasto** — `fs.exists` su ogni pressione tasto sarebbe gravoso; viene eseguito solo sul trigger esplicito di lint
- **Tolleranza agli errori operativi** — se `fs.exists` lancia un'eccezione (permesso negato, problema di scope delle capacità), il risultato è `error` (saltato), non `missing`. Meglio silenzioso che sbagliato.

## Codici diagnostici

| Codice | Gravità | Trigger |
|---|---|---|
| **M001** | Errore | File immagine non trovato nel percorso locale risolto |
| **M002** | Errore | File collegato non trovato nel percorso locale risolto |

## Vedi anche

- [Lint markdown](/it/guide/lint) — riferimento completo delle regole
- [Impostazioni → Markdown → Lint](/it/guide/settings#lint)
