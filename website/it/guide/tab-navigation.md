# Navigazione Intelligente con Tab

I tasti Tab e Shift+Tab di VMark sono sensibili al contesto — ti aiutano a navigare in modo efficiente nel testo formattato, nelle parentesi e nei collegamenti senza dover usare i tasti freccia.

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

## Impostazioni

Il comportamento dell'escape con Tab può essere personalizzato in **Impostazioni → Editor**:

| Impostazione | Effetto |
|-------------|---------|
| **Auto-accoppia Parentesi** | Abilita/disabilita l'accoppiamento delle parentesi e l'escape con Tab |
| **Parentesi CJK** | Includi le coppie di parentesi CJK |
| **Virgolette Curve** | Includi le coppie di virgolette curve (`""` `''`) |

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
