# Scorciatoie da Tastiera

VMark è progettato per flussi di lavoro da tastiera. La maggior parte delle scorciatoie può essere personalizzata nelle Impostazioni. Un piccolo numero di primitive è fisso: i selettori multi-cursore `Mod+D` (Seleziona occorrenza successiva) e `Mod+Shift+L` (Seleziona tutte le occorrenze) e le associazioni globali Annulla/Ripristina. Le altre scorciatoie multi-cursore (Salta occorrenza, Annulla cursore soft, Aggiungi cursore sopra/sotto) sono configurabili. Le scorciatoie contrassegnate _(contestuali)_ sono gestite all'interno dell'editor per strutture specifiche (ad es. attivazione casella elenco di attività) e non sono esposte nel registro di personalizzazione.

## Notazione

- **Mod** = Cmd su macOS, Ctrl su Windows/Linux
- **Alt** = Option su macOS

## Tasti Funzione su macOS

VMark usa i tasti funzione (F2–F10) per attivazioni rapide della modalità. Su macOS, questi tasti sono mappati alle funzioni di sistema (luminosità, volume, ecc.) per impostazione predefinita.

**Per usare i tasti F direttamente senza tenere premuto Fn:**

1. Apri **Impostazioni di Sistema** → **Tastiera**
2. Abilita **"Usa i tasti F1, F2, ecc. come tasti funzione standard"**

In alternativa, tieni premuto il tasto **Fn** quando premi F2–F10 per attivare le scorciatoie VMark.

::: tip
Se preferisci mantenere le funzioni di sistema sui tasti F, puoi personalizzare le scorciatoie VMark nelle Impostazioni (`Mod + ,`) per usare combinazioni di tasti diverse.
:::

### Riferimento Rapido Tasti F

| Tasto | Azione |
|-------|--------|
| `F2` | Problema successivo |
| `Shift + F2` | Problema precedente |
| `F3` | Mostra/nascondi caratteri invisibili |
| `F4` | Ordina righe in modo crescente _(solo modalità Sorgente; nessun effetto in WYSIWYG)_ |
| `Shift + F4` | Ordina righe in modo decrescente _(solo modalità Sorgente; nessun effetto in WYSIWYG)_ |
| `F5` | Anteprima Sorgente |
| `F6` | Vista sorgente (Markdown: WYSIWYG ⇄ Sorgente; altri formati: Sorgente ⇄ Diviso) |
| `Shift + F6` | Diviso / Anteprima (Markdown: vista divisa; altri formati: Anteprima ⇄ Diviso) |
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
| Link segnalibro | `Alt + Mod + B` |
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
| Ordina righe in modo crescente | `F4` _(solo modalità Sorgente)_ |
| Ordina righe in modo decrescente | `Shift + F4` _(solo modalità Sorgente)_ |

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
| Indice | _(personalizzabile)_ |
| Matematica inline | `Alt + Mod + M` |
| Blocco matematico | `Alt + Mod + Shift + M` |
| Inserisci nota | `Alt + Mod + N` |
| Inserisci suggerimento | `Alt + Mod + Shift + T` |
| Inserisci avviso | `Mod + Shift + W` |
| Inserisci importante | `Alt + Mod + Shift + I` |
| Inserisci cautela | `Mod + Shift + U` |
| Inserisci comprimibile | `Alt + Mod + D` |
| Inserisci diagramma | `Alt + Mod + Shift + D` |
| Inserisci diagramma Graphviz | _(personalizzabile)_ |
| Inserisci mappa mentale | `Alt + Mod + Shift + K` |
| Attiva/disattiva commento | `Mod + /` |

## Selezione e Multi-Cursore

| Azione | Scorciatoia |
|--------|-------------|
| Seleziona riga | `Mod + L` |
| Seleziona tutte le occorrenze nel blocco | `Alt + Mod + Shift + L` |
| Espandi selezione | `Ctrl + Shift + Su` |
| Seleziona occorrenza successiva | `Mod + D` |
| Salta occorrenza | `Mod + Shift + D` |
| Seleziona tutte le occorrenze | `Mod + Shift + L` |
| Annulla cursore soft | `Alt + Mod + Z` |
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
| Vista sorgente (Markdown ⇄ Sorgente; altri formati Sorgente ⇄ Diviso) | `F6` |
| Diviso / Anteprima (Markdown diviso; altri formati Anteprima ⇄ Diviso) | `Shift + F6` |
| Dividi editor — due documenti | `Alt + Mod + \` |
| Attiva/disattiva barra di stato | `F7` |
| Modalità Focus | `F8` |
| Modalità Macchina da Scrivere | `F9` |
| Modalità Sola Lettura | `F10` |
| Dimensione effettiva | `Mod + 0` |
| Ingrandisci | `Mod + =` |
| Riduci | `Mod + -` |
| Testo a capo | `Alt + Z` |
| Ultima scheda usata | `Ctrl + Tab` |
| Dividi editor — due documenti | `Alt + Mod + \` |
| Chiudi riquadro | `Alt + Mod + Shift + \` |
| Attiva l'altro riquadro | `Alt + Mod + Shift + O` |
| Attiva/disattiva barra laterale | `Ctrl + Shift + 0` |
| Attiva/disattiva struttura | `Ctrl + Shift + 1` |
| Attiva/disattiva esplora file | `Ctrl + Shift + 2` |
| Attiva/disattiva cronologia | `Ctrl + Shift + 3` |
| Mostra/Nascondi knowledge base | `Ctrl + Shift + 4` |
| Mostra/Nascondi stato finestre | `Ctrl + Shift + 5` |
| Attiva/disattiva numeri di riga (margine Sorgente/vista divisa) | `Alt + Mod + L` |
| Attiva/disattiva terminale | Ctrl + `` ` `` |
| Metti a fuoco terminale o editor | Ctrl + Shift + `` ` `` (Alt + Shift + `` ` `` su Windows/Linux) |
| Attiva/disattiva anteprima diagramma | `Alt + Mod + P` |
| Adatta tabelle alla larghezza | _(personalizzabile)_ |
| Apri la barra degli strumenti universale | `Mod + Shift + B` |
| Anteprima Sorgente | `F5` |
| Controlla Markdown | `Alt + Mod + V` |
| Problema successivo | `F2` |
| Problema precedente | `Shift + F2` |

::: tip Mostra/Nascondi knowledge base
`Ctrl + Shift + 4` è nascosta per impostazione predefinita, insieme alla voce di menu
**Vista → Mostra/Nascondi knowledge base** e al comando della palette. Nessuna build
di rilascio, su nessuna piattaforma, include il runtime del content server richiesto
dalla funzione, quindi i punti di accesso compaiono solo quando **Impostazioni →
Avanzate → Strumenti sviluppatore** è attivo — vedi
[Knowledge Base e Slidev](/it/guide/knowledge-base#requisiti). La scorciatoia resta
comunque elencata e personalizzabile in **Impostazioni → Scorciatoie**.
:::

## Operazioni sui File

| Azione | Scorciatoia |
|--------|-------------|
| Nuovo file | `Mod + N` |
| Apertura rapida | `Mod + O` _(browser di file con ricerca approssimativa)_ |
| Apri la palette dei comandi | `Mod + Shift + P` |
| Apri file... | Solo menu _(selettore file nativo)_ |
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
| Nuova scheda del browser | `Alt + Mod + Shift + B` |
| Scheda successiva | `Mod + Shift + ]` |
| Scheda precedente | `Mod + Shift + [` |
| Chiudi scheda | `Mod + W` |
| Riapri scheda chiusa | _(personalizzabile)_ |
| Mostra/nascondi file nascosti | `Mod + Shift + .` |
| Mostra/nascondi tutti i file | `Mod + Shift + A` |

::: tip Nota per Windows/Linux
Mostra/nascondi file nascosti usa `Ctrl + H` su Windows e Linux.

Attiva/disattiva barra laterale usa `Alt + Shift + 0` su Windows e Linux, perché lì `Mod`
è Ctrl — quindi la combinazione macOS `Ctrl + Shift + 0` entrerebbe in conflitto con
`Mod + Shift + 0` di Paragrafo.
:::

::: tip Nuova scheda del browser
`Alt + Mod + Shift + B` apre una scheda del browser integrato e compare anche nel menu
**File**. Il browser integrato è attivo per impostazione predefinita su macOS; se lo
disattivi in **Impostazioni → Avanzate → Browser integrato**, la voce di menu viene
nascosta (non resa grigia) finché non lo riattivi. Il browser è disponibile solo su
macOS, quindi la voce non compare mai su Windows o Linux.

È una vera voce di menu e non solo un'associazione da tastiera, e questo conta: quando
una pagina web ha il focus della tastiera, il motore del browser consuma i tasti premuti
prima che VMark li veda, quindi una scorciatoia interna all'app non può attivarsi. Un
acceleratore di menu viene gestito da macOS stesso, quindi funziona anche mentre navighi.
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
| Sposta il focus sul terminale o sull'editor | `` Ctrl + Shift + ` `` (`` Alt + Shift + ` `` su Windows/Linux) |
| Copia | `Mod + C` (con selezione); su Linux anche `Ctrl + Shift + C` o `Ctrl + Insert` |
| Incolla | `Mod + V`; su Linux anche `Ctrl + Shift + V` o `Shift + Insert` |
| Seleziona tutto (solo l'output del terminale) | `Mod + A` (`Ctrl + Shift + A` su Linux) |
| Cancella | `Mod + K` (`Ctrl + Shift + K` su Linux) |
| Cerca | `Mod + F` (`Ctrl + Shift + F` su Linux) |
| Passa alla sessione 1–5 | `Mod + 1` fino a `Mod + 5` |
| Ingrandisci il font del terminale | `Mod + =` |
| Riduci il font del terminale | `Mod + -` |
| Dimensione predefinita del font del terminale | `Mod + 0` |
| Prompt dei comandi precedente | `Mod + ↑` |
| Prompt dei comandi successivo | `Mod + ↓` |
| A capo nella riga di input (Claude Code e strumenti simili) | `Shift + Enter` |

Quando il terminale è attivo, `Mod + =`, `Mod + -` e `Mod + 0` ridimensionano il font del terminale invece di quello dell'editor.

La navigazione tra i prompt salta da un prompt dei comandi all'altro nello scrollback e richiede l'integrazione della shell (zsh o bash).

Su macOS il terminale traduce anche le consuete combinazioni di modifica del testo per la shell:

| Azione | Scorciatoia |
|--------|-------------|
| Sposta di una parola a sinistra / destra | `Option + ←` / `Option + →` |
| Vai a inizio / fine riga | `Cmd + ←` / `Cmd + →` |
| Elimina la riga di input (invia `Ctrl + U`) | `Cmd + Backspace` |

Le combinazioni con `Ctrl` come `Ctrl + A`, `Ctrl + R` e `Ctrl + W` vanno direttamente alla shell su macOS.

Su Linux il terminale segue la consueta convenzione dei terminali Linux: le semplici combinazioni `Ctrl` + lettera vanno alla shell, quindi i tasti di readline come `Ctrl + A`, `Ctrl + E`, `Ctrl + K`, `Ctrl + F`, `Ctrl + U` e `Ctrl + W` funzionano come in qualsiasi altro terminale Linux, e le azioni proprie del terminale passano a `Ctrl + Shift`: `Ctrl + Shift + A` seleziona tutto, `Ctrl + Shift + K` cancella, `Ctrl + Shift + F` cerca, e `Ctrl + Shift + C` / `Ctrl + Shift + V` copiano e incollano. Anche `Ctrl + Insert` e `Shift + Insert` copiano e incollano. Il terminale mantiene due semplici combinazioni `Ctrl`: `Ctrl + C` copia una selezione (e invia SIGINT quando non c'è nulla di selezionato), e `Ctrl + V` incolla. `Ctrl + 1` fino a `Ctrl + 5` continuano a cambiare sessione.

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
2. Vai alla scheda **Scorciatoie** (digita nella casella di ricerca per filtrare per nome, categoria, descrizione o tasto)
3. Fai clic sul tasto mostrato accanto a una scorciatoia — oppure su **Non assegnato** per una che non ha ancora un tasto
4. Premi la combinazione di tasti desiderata, poi fai clic su **Assegna** (`Escape` annulla)

La finestra di dialogo ti avvisa prima che tu assegni una combinazione:

- **Conflitto** — la combinazione è già usata da un'altra scorciatoia, che viene indicata. Puoi comunque scegliere **Assegna comunque**.
- **Non supportata** — VMark non può usare quella combinazione, quindi non può essere assegnata. Provane un'altra.

Una scorciatoia personalizzata viene evidenziata e riceve un pulsante **Reimposta al valore predefinito**. **Reimposta tutto** ripristina tutti i valori predefiniti dopo aver chiesto conferma. **Esporta** salva le tue scorciatoie come file JSON (`vmark-shortcuts.json`) e **Importa** ne carica uno; se una qualsiasi voce del file non è valida, non viene importato nulla e i problemi vengono elencati.

::: tip
Le scorciatoie si sincronizzano con gli acceleratori del menu quando applicabile, quindi le voci del menu mostreranno le tue scorciatoie personalizzate.
:::
