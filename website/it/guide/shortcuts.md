# Scorciatoie da Tastiera

VMark è progettato per flussi di lavoro da tastiera. La maggior parte delle scorciatoie può essere personalizzata nelle Impostazioni. Un piccolo numero di primitive è fisso: i selettori multi-cursore `Mod+D` (Seleziona occorrenza successiva) e `Mod+Shift+L` (Seleziona tutte le occorrenze) e le associazioni globali Annulla/Ripristina. Le altre scorciatoie multi-cursore (Salta occorrenza, Annulla cursore soft, Aggiungi cursore sopra/sotto) sono configurabili. Le scorciatoie contrassegnate _(contestuali)_ sono gestite all'interno dell'editor per strutture specifiche (ad es. attivazione casella elenco di attività) e non sono esposte nel registro di personalizzazione.

## Notazione

- **Mod** = Cmd su macOS, Ctrl su Windows/Linux
- **Alt** = Option su macOS

## Tasti Funzione su macOS

VMark usa i tasti funzione (F4–F10) per attivazioni rapide della modalità. Su macOS, questi tasti sono mappati alle funzioni di sistema (luminosità, volume, ecc.) per impostazione predefinita.

**Per usare i tasti F direttamente senza tenere premuto Fn:**

1. Apri **Impostazioni di Sistema** → **Tastiera**
2. Abilita **"Usa i tasti F1, F2, ecc. come tasti funzione standard"**

In alternativa, tieni premuto il tasto **Fn** quando premi F4–F10 per attivare le scorciatoie VMark.

::: tip
Se preferisci mantenere le funzioni di sistema sui tasti F, puoi personalizzare le scorciatoie VMark nelle Impostazioni (`Mod + ,`) per usare combinazioni di tasti diverse.
:::

### Riferimento Rapido Tasti F

| Tasto | Azione |
|-------|--------|
| `F2` | Problema successivo |
| `Shift + F2` | Problema precedente |
| `F4` | Ordina righe in modo crescente |
| `Shift + F4` | Ordina righe in modo decrescente |
| `F5` | Anteprima Sorgente |
| `F6` | Attiva/disattiva modalità Sorgente |
| `F7` | Attiva/disattiva barra di stato |
| `F8` | Modalità Focus |
| `F9` | Modalità Macchina da Scrivere |
| `F10` | Modalità Sola Lettura |

## Modifica

| Azione | Scorciatoia |
|--------|-------------|
| Annulla | `Mod + Z` |
| Ripristina | `Mod + Shift + Z` |

## Formattazione del Testo

| Azione | Scorciatoia |
|--------|-------------|
| Grassetto | `Mod + B` |
| Corsivo | `Mod + I` |
| Sottolineato | `Mod + U` |
| Barrato | `Mod + Shift + X` |
| Codice inline | Mod + Shift + `` ` `` |
| Evidenziato | `Mod + Shift + M` |
| Pedice | `Alt + Mod + =` |
| Apice | `Alt + Mod + Shift + =` |
| Collegamento | `Mod + K` |
| Apri collegamento (modalità Sorgente) | `Cmd + Clic` |
| Rimuovi collegamento | `Alt + Shift + K` |
| Wiki Link | `Alt + Mod + K` |
| Segnalibro | `Alt + Mod + B` |
| Cancella formattazione | `Mod + \` |

## Formattazione a Blocchi

| Azione | Scorciatoia |
|--------|-------------|
| Intestazione 1-6 | `Mod + 1` fino a `Mod + 6` |
| Paragrafo | `Mod + Shift + 0` |
| Aumenta livello intestazione | `Alt + Mod + ]` |
| Diminuisci livello intestazione | `Alt + Mod + [` |
| Citazione | `Alt + Mod + Q` |
| Blocco di codice | `Alt + Mod + C` |
| Elenco puntato | `Alt + Mod + U` |
| Elenco numerato | `Alt + Mod + O` |
| Elenco di attività | `Alt + Mod + X` |
| Attiva/disattiva casella attività | `Mod + Shift + Enter` _(contestuale; non personalizzabile)_ |
| Cambia tipo di elenco | _(personalizzabile)_ |
| Rientra | `Mod + ]` |
| Rientra a sinistra | `Mod + [` |
| Riga orizzontale | `Alt + Mod + -` |

## Operazioni sulle Righe

| Azione | Scorciatoia |
|--------|-------------|
| Sposta riga su | `Alt + Su` |
| Sposta riga giù | `Alt + Giù` |
| Duplica riga | `Shift + Alt + Giù` |
| Elimina riga | `Mod + Shift + K` |
| Unisci righe | `Mod + J` |
| Ordina righe in modo crescente | `F4` |
| Ordina righe in modo decrescente | `Shift + F4` |

## Trasformazioni del Testo

| Azione | macOS | Windows/Linux |
|--------|-------|---------------|
| MAIUSCOLO | `Ctrl + Shift + U` | `Alt + Shift + U` |
| minuscolo | `Ctrl + Shift + L` | `Alt + Shift + L` |
| Prima Lettera Maiuscola | `Ctrl + Shift + T` | `Alt + Shift + T` |
| Alterna maiuscole/minuscole | _(personalizzabile)_ | _(personalizzabile)_ |
| Rimuovi righe vuote | _(personalizzabile)_ | _(personalizzabile)_ |
| Alterna stile virgolette | `Shift + Mod + '` | `Shift + Mod + '` |

## Inserimento

| Azione | Scorciatoia |
|--------|-------------|
| Inserisci immagine | `Mod + Shift + I` |
| Inserisci video | — |
| Inserisci audio | — |
| Inserisci tabella | `Mod + Shift + T` |
| Matematica inline | `Alt + Mod + M` |
| Blocco matematico | `Alt + Mod + Shift + M` |
| Inserisci nota | `Alt + Mod + N` |
| Inserisci suggerimento | `Alt + Mod + Shift + T` |
| Inserisci avviso | `Mod + Shift + W` |
| Inserisci importante | `Alt + Mod + Shift + I` |
| Inserisci cautela | `Mod + Shift + U` |
| Inserisci comprimibile | `Alt + Mod + D` |
| Inserisci diagramma | `Alt + Shift + Mod + D` |
| Inserisci mappa mentale | `Alt + Shift + Mod + K` |
| Attiva/disattiva commento | `Mod + /` |

## Selezione e Multi-Cursore

| Azione | Scorciatoia |
|--------|-------------|
| Seleziona riga | `Mod + L` |
| Espandi selezione | `Ctrl + Shift + Su` |
| Seleziona occorrenza successiva | `Mod + D` |
| Salta occorrenza | `Mod + Shift + D` |
| Seleziona tutte le occorrenze | `Mod + Shift + L` |
| Annulla ultimo cursore | `Alt + Mod + Z` |
| Aggiungi cursore sopra | `Mod + Alt + Su` |
| Aggiungi cursore sotto | `Mod + Alt + Giù` |
| Comprimi multi-cursore | `Escape` |

## Trova e Sostituisci

| Azione | Scorciatoia |
|--------|-------------|
| Trova e sostituisci | `Mod + F` |
| Trova successivo | `Mod + G` |
| Trova precedente | `Mod + Shift + G` |
| Usa selezione per la ricerca | `Mod + E` |
| Trova nei file | `Mod + Shift + H` |

## Visualizzazione e Modalità

| Azione | Scorciatoia |
|--------|-------------|
| Attiva/disattiva modalità Sorgente | `F6` |
| Attiva/disattiva barra di stato | `F7` |
| Modalità Focus | `F8` |
| Modalità Macchina da Scrivere | `F9` |
| Modalità Sola Lettura | `F10` |
| Dimensione effettiva | `Mod + 0` |
| Ingrandisci | `Mod + =` |
| Riduci | `Mod + -` |
| Testo a capo | `Alt + Z` |
| Attiva/disattiva struttura | `Ctrl + Shift + 1` |
| Attiva/disattiva esplora file | `Ctrl + Shift + 2` |
| Attiva/disattiva cronologia | `Ctrl + Shift + 3` |
| Attiva/disattiva numeri di riga (blocchi di codice) | `Alt + Mod + L` |
| Attiva/disattiva terminale | Ctrl + `` ` `` |
| Attiva/disattiva anteprima diagramma | `Alt + Mod + P` |
| Adatta tabelle alla larghezza | _(personalizzabile)_ |
| Barra degli strumenti universale | `Mod + Shift + P` |
| Anteprima Sorgente | `F5` |
| Controlla Markdown | `Alt + Mod + V` |
| Problema successivo | `F2` |
| Problema precedente | `Shift + F2` |

## Operazioni sui File

| Azione | Scorciatoia |
|--------|-------------|
| Nuovo file | `Mod + N` |
| Apertura rapida | `Mod + O` |
| Apri workspace | `Mod + Shift + O` |
| Salva | `Mod + S` |
| Salva come | `Mod + Shift + S` |
| Salva tutto ed esci | `Alt + Mod + Shift + Q` |
| Sposta in | Solo menu |
| Chiudi | `Mod + W` |
| Esporta HTML | Solo menu |
| Stampa | `Mod + P` |
| Esporta PDF | — |
| Impostazioni | `Mod + ,` |

## Appunti

| Azione | Scorciatoia |
|--------|-------------|
| Copia come HTML | `Mod + Shift + C` |
| Incolla testo normale | `Mod + Shift + V` |

## Genies IA

| Azione | Scorciatoia |
|--------|-------------|
| Apri Genies IA | `Mod + Y` |
| Accetta suggerimento | `Enter` |
| Rifiuta suggerimento | `Escape` |
| Suggerimento successivo | `Tab` |
| Suggerimento precedente | `Shift + Tab` |
| Accetta tutti i suggerimenti | `Mod + Shift + Enter` |
| Rifiuta tutti i suggerimenti | `Mod + Shift + Escape` |

## Formattazione CJK

| Azione | Scorciatoia |
|--------|-------------|
| Formatta selezione | `Mod + Shift + F` |
| Formatta documento | `Alt + Mod + Shift + F` |

## Finestra e Schede

| Azione | Scorciatoia |
|--------|-------------|
| Nuova finestra | `Mod + Shift + N` |
| Nuova scheda | `Mod + T` |
| Chiudi scheda | `Mod + W` |
| Mostra/nascondi file nascosti | `Mod + Shift + .` |
| Mostra/nascondi tutti i file | _(personalizzabile)_ |

::: tip Nota per Windows/Linux
Mostra/nascondi file nascosti usa `Ctrl + H` su Windows e Linux.
:::

## Aiuto (solo macOS)

| Azione | Scorciatoia |
|--------|-------------|
| Cerca nei menu | `Cmd + Shift + /` |

::: tip
Questa è una scorciatoia di sistema nativa di macOS che cerca in tutte le voci di menu. Digita una parola chiave per trovare ed eseguire qualsiasi azione del menu.
:::

## Navigazione Intelligente con Tab

Tab e Shift+Tab sono contestuali — saltano parentesi, virgolette, marcatori di formattazione e collegamenti.

| Contesto | Azione Tab |
|----------|------------|
| Prima di `)`, `]`, `}`, virgolette | Salta oltre il carattere di chiusura |
| Prima delle parentesi CJK `」`, `』`, ecc. | Salta oltre la parentesi di chiusura |
| All'interno di **grassetto**, *corsivo*, `codice` | Salta dopo la formattazione |
| All'interno di un collegamento | Salta dopo il collegamento |

| Contesto | Azione Shift+Tab |
|----------|------------------|
| Dopo `(`, `[`, `{`, virgolette | Salta prima del carattere di apertura |
| Dopo le parentesi CJK `「`, `『`, ecc. | Salta prima della parentesi di apertura |
| All'interno di **grassetto**, *corsivo*, `codice` | Salta prima della formattazione |
| All'interno di un collegamento | Salta prima del collegamento |

::: tip
Vedi [Navigazione Intelligente con Tab](/it/guide/tab-navigation) per la guida completa incluse le parentesi CJK, le virgolette curve e le impostazioni.
:::

## Modifica delle Tabelle

Quando il cursore è all'interno di una tabella:

| Azione | Scorciatoia |
|--------|-------------|
| Cella successiva | `Tab` |
| Cella precedente | `Shift + Tab` |
| Aggiungi riga sotto | `Mod + Enter` |
| Aggiungi riga sopra | `Mod + Shift + Enter` |
| Elimina riga | `Mod + Backspace` |
| Aggiungi colonna a sinistra | `Alt + Mod + Left` |
| Aggiungi colonna a destra | `Alt + Mod + Right` |
| Elimina colonna | `Alt + Mod + Backspace` |
| Allinea colonna a sinistra | `Mod + Alt + Shift + L` |
| Allinea colonna a destra | `Mod + Shift + R` |
| Allinea colonna al centro | _(personalizzabile)_ |
| Formatta tabella | `Alt + Mod + T` |
| Esci dalla tabella | Tasti freccia al bordo della tabella |

## Navigazione nei Popup

Quando un popup è aperto (collegamento, immagine, matematica, ecc.):

| Azione | Scorciatoia |
|--------|-------------|
| Chiudi popup | `Escape` |
| Conferma/Salva | `Enter` |
| Naviga tra i campi | `Tab` / `Shift + Tab` |

## Modifica di Blocchi Matematici

Quando si modifica un blocco matematico:

| Azione | Scorciatoia |
|--------|-------------|
| Conferma e chiudi | `Mod + Enter` |
| Annulla e chiudi | `Escape` |

## Terminale

Quando il terminale integrato è attivo:

| Azione | Scorciatoia |
|--------|-------------|
| Attiva/disattiva terminale | `` Ctrl + ` `` |
| Copia | `Mod + C` (con selezione) |
| Incolla | `Mod + V` |
| Cancella | `Mod + K` |
| Cerca | `Mod + F` |

Quando la barra di ricerca del terminale è aperta:

| Azione | Scorciatoia |
|--------|-------------|
| Corrispondenza successiva | `Enter` |
| Corrispondenza precedente | `Shift + Enter` |
| Chiudi ricerca | `Escape` |

::: tip
`Mod + C` senza una selezione invia SIGINT al processo in esecuzione. Vedi [Terminale Integrato](/it/guide/terminal) per la guida completa.
:::

## Personalizzare le Scorciatoie

1. Apri le Impostazioni con `Mod + ,`
2. Vai alla scheda **Scorciatoie**
3. Fai clic su qualsiasi scorciatoia per modificarla
4. Premi la combinazione di tasti desiderata
5. Le modifiche vengono salvate automaticamente

::: tip
Le scorciatoie si sincronizzano con gli acceleratori del menu quando applicabile, quindi le voci del menu mostreranno le tue scorciatoie personalizzate.
:::
