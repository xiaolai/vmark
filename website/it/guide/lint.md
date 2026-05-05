# Lint markdown

VMark include un motore di lint integrato che intercetta **problemi di correttezza**, non preferenze di stile. Il lint viene eseguito su richiesta (Cmd-Shift-L o **Strumenti → Controlla Markdown**) e mostra i risultati inline come ondulati nel margine, con un badge nella barra di stato e navigazione F2 tra i risultati.

## Cos'è e cosa non è il lint

Il lint di VMark è un controllo di **correttezza**:

- Riferimenti incrociati interrotti
- Riferimenti non definiti a collegamenti / note a piè di pagina
- Blocchi di codice non chiusi
- Tabelle con conteggio colonne non corrispondente
- Livelli di intestazione che saltano (h1 → h3)
- Immagini senza testo alt
- Testo del collegamento vuoto o `href` vuoto

Il lint di VMark **non** è un controllore di stile. Non segnala:

- Lunghezza delle righe
- Stile dei marcatori di elenco (`-` vs `*`)
- Stile dei marcatori di enfasi (`_` vs `*`)
- Stile delle intestazioni (`#` vs sottolineatura)
- Spazi bianchi finali

Per l'imposizione dello stile, usa uno strumento separato come `prettier --check` al di fuori di VMark.

## Riferimento delle regole

| ID regola | Gravità | Descrizione |
|-----------|---------|-------------|
| **E01** | Errore | Riferimento non definito: `[link][missing]` punta a una definizione che non esiste |
| **E02** | Errore | Una riga della tabella ha un numero di colonne sbagliato (non corrisponde alla riga di intestazione) |
| **E03** | Errore | Collegamento invertito — sembra `(testo)[url]` invece di `[testo](url)` |
| **E04** | Errore | Intestazione ATX senza spazio dopo `#` (es. `##Intestazione` dovrebbe essere `## Intestazione`) |
| **E05** | Errore | Spazio all'interno dei marcatori di enfasi — `* parola *` non viene resa in corsivo |
| **E06** | Errore | Blocco di codice con recinzione non chiuso — il file termina con una recinzione ```` ``` ```` aperta |
| **E07** | Errore | Definizione duplicata del riferimento al collegamento (lo stesso `[label]:` appare due volte) |
| **E08** | Errore | `href` del collegamento vuoto — `[testo]()` |
| **W01** | Avviso | Livello di intestazione saltato (atteso h2, trovato h3) |
| **W02** | Avviso | Immagine senza testo alt — accessibilità |
| **W03** | Avviso | Definizione di riferimento al collegamento inutilizzata (definita ma mai collegata) |
| **W04** | Avviso | Il frammento di ancoraggio non corrisponde a nessuna intestazione — `#sezione` per una sezione che non esiste |
| **W05** | Avviso | Testo del collegamento vuoto — `[](url)` |
| **M001** | Errore | File immagine non trovato nel percorso locale |
| **M002** | Errore | File collegato non trovato nel percorso locale |
| **Y001** | Errore | Errore di analisi YAML (per file YAML) |
| **Y002** | Avviso | Avviso di analisi YAML (per file YAML) |

## Avvio del lint

| Trigger | Azione |
|---|---|
| `Cmd + Shift + L` (macOS) / `Ctrl + Shift + L` (Win/Linux) | Esegui il lint sul documento attivo |
| **Strumenti → Controlla Markdown** | Identico alla scorciatoia |
| `F2` | Vai alla diagnostica successiva |
| `Shift + F2` | Vai alla diagnostica precedente |

Per i file markdown con percorsi di file, il controllo dell'esistenza dei collegamenti viene eseguito automaticamente insieme alle regole sincrone — vedi [Controllo collegamenti](/it/guide/link-check).

Per i file YAML, gli errori di analisi appaiono in tempo reale nel margine mentre digiti, e la stessa scorciatoia `Cmd-Shift-L` popola il badge e la navigazione F2.

## Impostazioni

Il motore di lint ha un singolo interruttore esposto all'utente:

- **Impostazioni → Markdown → Abilita markdown lint** — attiva o disattiva interamente il motore

Quando è disabilitato, la scorciatoia diventa un'operazione vuota e nessuna diagnostica appare nel margine.

## Vedi anche

- [Controllo collegamenti](/it/guide/link-check) — rilevamento di collegamenti / immagini locali interrotti
- [Impostazioni → Markdown → Lint](/it/guide/settings#lint)
