# Grafica SVG

VMark fornisce supporto di prima classe per SVG — Scalable Vector Graphics. Ci sono due modi per usare SVG nei tuoi documenti, ognuno adatto a un flusso di lavoro diverso.

| Metodo | Migliore Per | Sorgente Modificabile? |
|--------|-------------|----------------------|
| [Incorporamento immagine](#incorporamento-svg-come-immagine) (`![](file.svg)`) | File SVG statici su disco | No |
| [Blocco di codice](#blocchi-di-codice-svg) (` ```svg `) | SVG inline, grafica generata dall'IA | Sì |

## Incorporamento SVG come Immagine {#incorporamento-svg-come-immagine}

Usa la sintassi standard delle immagini Markdown per incorporare un file SVG:

```markdown
![Diagramma architettura](./assets/architecture.svg)
```

Funziona esattamente come le immagini PNG o JPEG — trascina e rilascia, incolla o inserisci tramite la barra degli strumenti. I file SVG vengono riconosciuti come immagini e renderizzati inline.

**Quando usarlo:** Hai un file `.svg` (da Figma, Illustrator, Inkscape o uno strumento di design) e vuoi visualizzarlo nel tuo documento.

**Limitazioni:** L'SVG viene renderizzato come immagine statica. Non puoi modificare il sorgente SVG inline e non appaiono controlli di pan+zoom o esportazione.

## Blocchi di Codice SVG {#blocchi-di-codice-svg}

Racchiudi il markup SVG grezzo in un blocco di codice delimitato con l'identificatore di linguaggio `svg`:

````markdown
```svg
<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="100" rx="10" fill="#4a6fa5"/>
  <text x="100" y="55" text-anchor="middle" fill="white"
        font-size="18" font-family="system-ui">Hello SVG</text>
</svg>
```text
````

L'SVG viene renderizzato inline — proprio come i diagrammi Mermaid — con controlli interattivi.

::: tip Esclusivo di VMark
Né Typora né Obsidian supportano i blocchi di codice ` ```svg `. Questa è una funzionalità esclusiva di VMark, progettata per i flussi di lavoro IA in cui gli strumenti generano visualizzazioni SVG (grafici, illustrazioni, icone) che non si adattano alla grammatica di Mermaid.
:::

### Quando Usare i Blocchi di Codice

- **Grafica generata dall'IA** — Claude, ChatGPT e altri strumenti IA possono generare grafici, diagrammi e illustrazioni SVG direttamente. Incolla l'SVG in un blocco di codice per renderizzarlo inline.
- **Creazione SVG inline** — Modifica il sorgente SVG direttamente nel tuo documento e vedi i risultati in tempo reale.
- **Documenti autonomi** — L'SVG vive all'interno del file Markdown, senza dipendenze da file esterni.

## Modifica in Modalità WYSIWYG

In modalità Rich Text, i blocchi di codice SVG vengono renderizzati inline automaticamente.

### Entrare in Modalità Modifica

Fai doppio clic su un SVG renderizzato per aprire l'editor sorgente. Appare un'intestazione di modifica con:

| Pulsante | Azione |
|---------|--------|
| **Copia** | Copia il sorgente SVG negli appunti |
| **Annulla** (X) | Annulla le modifiche ed esci (anche `Esc`) |
| **Salva** (segno di spunta) | Applica le modifiche ed esci |

Un'**anteprima live** sotto l'editor si aggiorna mentre digiti, così puoi vedere le tue modifiche in tempo reale.

### Pan e Zoom

Passa il mouse su un SVG renderizzato per rivelare i controlli interattivi:

| Azione | Come |
|--------|------|
| **Zoom** | Tieni premuto `Cmd` (macOS) o `Ctrl` (Windows/Linux) e scorri |
| **Pan** | Fai clic e trascina l'SVG |
| **Reset** | Fai clic sul pulsante reset (angolo in alto a destra) |

Questi sono gli stessi controlli di pan+zoom usati per i diagrammi Mermaid.

### Esporta come PNG

Passa il mouse su un SVG renderizzato per rivelare il pulsante **esporta** (in alto a destra, accanto al pulsante reset). Fai clic per scegliere un tema di sfondo:

| Tema | Sfondo |
|------|--------|
| **Chiaro** | Bianco (`#ffffff`) |
| **Scuro** | Scuro (`#1e1e1e`) |

L'SVG viene esportato come PNG a risoluzione 2x tramite la finestra di salvataggio del sistema.

## Anteprima in Modalità Sorgente

In modalità Sorgente, quando il cursore è all'interno di un blocco di codice ` ```svg `, appare un pannello di anteprima fluttuante — lo stesso pannello usato per i diagrammi Mermaid.

| Funzione | Descrizione |
|----------|-------------|
| **Anteprima live** | Si aggiorna immediatamente mentre digiti (nessun debounce — il rendering SVG è istantaneo) |
| **Trascina per spostare** | Trascina l'intestazione per riposizionare |
| **Ridimensiona** | Trascina qualsiasi bordo o angolo |
| **Zoom** | Pulsanti `−` e `+`, o `Cmd/Ctrl` + scroll (dal 10% al 300%) |

::: info
L'anteprima del diagramma in modalità Sorgente deve essere abilitata. Attivala con il pulsante **Anteprima Diagramma** nella barra di stato.
:::

## Validazione SVG

VMark valida il contenuto SVG prima del rendering:

- Il contenuto deve iniziare con `<svg` o `<?xml`
- L'XML deve essere ben formato (nessun errore di analisi)
- L'elemento radice deve essere `<svg>`

Se la validazione fallisce, viene mostrato un messaggio di errore **SVG non valido** invece della grafica renderizzata. Fai doppio clic sull'errore per modificare e correggere il sorgente.

## Flusso di Lavoro IA

Gli assistenti IA di codifica possono generare SVG direttamente nei tuoi documenti VMark tramite gli strumenti MCP. L'IA invia un blocco di codice con `language: "svg"` e il contenuto SVG, che viene renderizzato inline automaticamente.

**Prompt di esempio:**

> Crea un grafico a barre che mostra le entrate trimestrali: Q1 $2.1M, Q2 $2.8M, Q3 $3.2M, Q4 $3.9M

L'IA genera un grafico a barre SVG che viene renderizzato inline nel tuo documento, con pan+zoom ed esportazione PNG disponibili immediatamente.

## Confronto: Blocco di Codice SVG vs Mermaid

| Funzione | ` ```svg ` | ` ```mermaid ` |
|----------|-----------|---------------|
| Input | Markup SVG grezzo | DSL Mermaid |
| Rendering | Istantaneo (sincrono) | Asincrono (debounce 200ms) |
| Pan + Zoom | Sì | Sì |
| Esportazione PNG | Sì | Sì |
| Anteprima live | Sì | Sì |
| Adattamento tema | No (usa i colori propri dell'SVG) | Sì (si adatta a tutti i temi) |
| Migliore per | Grafica personalizzata, visual generati dall'IA | Diagrammi di flusso, diagrammi di sequenza, diagrammi strutturati |

## Suggerimenti

### Sicurezza

VMark sanitizza il contenuto SVG prima del rendering. I tag script e gli attributi degli handler di eventi (`onclick`, `onerror`, ecc.) vengono rimossi. Questo protegge dagli attacchi XSS quando si incolla SVG da fonti non attendibili.

### Dimensionamento

Se il tuo SVG non include attributi espliciti `width`/`height`, aggiungi un `viewBox` per controllarne il rapporto d'aspetto:

```xml
<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
  <!-- contenuto -->
</svg>
```

### Qualità di Esportazione

L'esportazione PNG usa una risoluzione 2x per una visualizzazione nitida sugli schermi Retina. Viene aggiunto automaticamente un colore di sfondo solido (l'SVG stesso potrebbe avere uno sfondo trasparente).
