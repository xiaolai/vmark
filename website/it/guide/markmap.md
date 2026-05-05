# Mappe Mentali Markmap

VMark supporta [Markmap](https://markmap.js.org/) per creare alberi di mappe mentali interattive direttamente nei tuoi documenti Markdown. A differenza del tipo di diagramma mindmap statico di Mermaid, Markmap usa semplici intestazioni Markdown come input e fornisce pan/zoom/collasso interattivi.

## Inserimento di una Mappa Mentale

### Usando il Menu

**Menu:** Inserisci > Mappa Mentale

**Scorciatoia da tastiera:** `Alt + Shift + Cmd + K` (macOS) / `Alt + Shift + Ctrl + K` (Windows/Linux)

### Usando un Blocco di Codice

Digita un blocco di codice delimitato con l'identificatore di linguaggio `markmap`:

````markdown
```markmap
# Mappa Mentale

## Ramo A
### Argomento 1
### Argomento 2

## Ramo B
### Argomento 3
### Argomento 4
```text
````

### Usando lo Strumento MCP

Usa lo strumento MCP `media` con `action: "markmap"` e il parametro `code` contenente intestazioni Markdown.

## Modalità di Modifica

### Modalità Rich Text (WYSIWYG)

In modalità WYSIWYG, le mappe mentali Markmap vengono renderizzate come alberi SVG interattivi. Puoi:

- **Fare pan** scorrendo o facendo clic e trascinando
- **Fare zoom** tenendo premuto `Cmd`/`Ctrl` e scorrendo
- **Comprimere/espandere** i nodi facendo clic sul cerchio ad ogni ramo
- **Adattare** la vista usando il pulsante di adattamento (angolo in alto a destra al passaggio)
- **Doppio clic** sulla mappa mentale per modificare il sorgente

### Modalità Sorgente con Anteprima Live

In modalità Sorgente, un pannello di anteprima fluttuante appare quando il cursore è all'interno di un blocco di codice markmap, aggiornandosi mentre digiti.

## Formato di Input

Markmap usa Markdown standard come input. Le intestazioni definiscono la gerarchia dell'albero:

| Markdown | Ruolo |
|----------|-------|
| `# Intestazione 1` | Nodo radice |
| `## Intestazione 2` | Ramo di primo livello |
| `### Intestazione 3` | Ramo di secondo livello |
| `#### Intestazione 4+` | Rami più profondi |

### Contenuto Ricco nei Nodi

I nodi possono contenere Markdown inline:

````markdown
```markmap
# Piano di Progetto

## Ricerca
### Leggi articoli **importanti**
### Esamina [strumenti esistenti](https://example.com)

## Implementazione
### Scrivi modulo `core`
### Aggiungi test
- Test unitari
- Test di integrazione

## Documentazione
### Riferimento API
### Guida utente
```text
````

Gli elementi di elenco sotto un'intestazione diventano nodi figli di quell'intestazione.

### Demo dal vivo

Ecco un markmap interattivo renderizzato direttamente in questa pagina — prova a fare panoramica, zoom e a comprimere i nodi:

```markmap
# VMark Features

## Editor
### WYSIWYG Mode
### Source Mode
### Focus Mode
### Typewriter Mode

## AI Integration
### MCP Server
### AI Genies
### Smart Paste

## Markdown
### Mermaid Diagrams
### Markmap Mindmaps
### LaTeX Math
### Code Blocks
- Syntax highlighting
- Line numbers

## Platform
### macOS
### Windows
### Linux
```

## Funzionalità Interattive

| Azione | Come |
|--------|------|
| **Pan** | Scorri o fai clic e trascina |
| **Zoom** | `Cmd`/`Ctrl` + scroll |
| **Comprimi nodo** | Fai clic sul cerchio a un punto del ramo |
| **Espandi nodo** | Fai di nuovo clic sul cerchio |
| **Adatta alla vista** | Fai clic sul pulsante di adattamento (in alto a destra al passaggio) |

## Integrazione del Tema

Le mappe mentali Markmap si adattano automaticamente al tema corrente di VMark (White, Paper, Mint, Sepia o Night). I colori dei rami si adattano per la leggibilità in tutti i temi.

## Esporta come PNG

Passa il mouse su una mappa mentale renderizzata in modalità WYSIWYG per rivelare un pulsante **esporta**. Fai clic per scegliere un tema:

| Tema | Sfondo |
|------|--------|
| **Chiaro** | Sfondo bianco |
| **Scuro** | Sfondo scuro |

La mappa mentale viene esportata come PNG a risoluzione 2x tramite la finestra di salvataggio del sistema.

## Suggerimenti

### Markmap vs Mermaid Mindmap

VMark supporta sia Markmap che il tipo di diagramma `mindmap` di Mermaid:

| Funzione | Markmap | Mermaid Mindmap |
|----------|---------|-----------------|
| Formato di input | Markdown standard | DSL Mermaid |
| Interattività | Pan, zoom, collasso | Immagine statica |
| Contenuto ricco | Collegamenti, grassetto, codice, elenchi | Solo testo |
| Migliore per | Alberi grandi e interattivi | Diagrammi statici semplici |

Usa **Markmap** quando vuoi interattività o hai già contenuto Markdown. Usa la **mindmap Mermaid** quando hai bisogno di usarla insieme ad altri diagrammi Mermaid.

### Per Saperne di Più

- **[Documentazione Markmap](https://markmap.js.org/)** — Riferimento ufficiale
- **[Playground Markmap](https://markmap.js.org/repl)** — Playground interattivo per testare le mappe mentali
