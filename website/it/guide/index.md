# Introduzione a VMark

VMark è un editor Markdown local-first con due modalità di modifica, ricchi strumenti di formattazione e un eccellente supporto per il testo CJK (cinese/giapponese/coreano).

## Avvio Rapido

1. **Scarica e installa** VMark dalla [pagina di download](/it/download)
2. **Avvia l'app** e inizia subito a scrivere
3. **Apri un file** con `Cmd/Ctrl + O` oppure trascina e rilascia un file `.md`
4. **Apri una cartella** con `Cmd/Ctrl + Shift + O` per la modalità workspace

## Panoramica dell'Interfaccia

### Aree Principali

- **Editor**: L'area di scrittura principale dove componi i tuoi documenti
- **Barra laterale**: Navigazione ad albero dei file (attiva/disattiva con `Ctrl + Shift + 2`)
- **Struttura**: Vista della struttura del documento (attiva/disattiva con `Ctrl + Shift + 1`)
- **Barra di stato**: Conteggio parole, conteggio caratteri e stato del salvataggio automatico (attiva/disattiva con `F7`)
- **Terminale**: Pannello shell integrato (attiva/disattiva con `` Ctrl + ` ``)

### Barra dei Menu

- **File**: Operazioni di nuovo, apri, salva, esporta
- **Modifica**: Annulla/ripristina, appunti, trova/sostituisci, cronologia documenti
- **Blocco**: Intestazioni, elenchi, citazioni, operazioni sulle righe
- **Formato**: Stili di testo, collegamenti, trasformazioni del testo
- **Visualizza**: Modalità editor, barra laterale, modalità focus/macchina da scrivere
- **Strumenti**: Pulizia testo, formattazione CJK, gestione immagini

### Modalità di Modifica

VMark supporta due modalità di modifica tra cui puoi passare:

| Modalità | Descrizione | Scorciatoia |
|----------|-------------|-------------|
| Rich Text | Modifica WYSIWYG con formattazione in tempo reale | Predefinita |
| Sorgente | Markdown grezzo con evidenziazione della sintassi | `F6` |

### Modalità di Visualizzazione

Migliora la concentrazione nella scrittura con queste modalità di visualizzazione:

| Modalità | Descrizione | Scorciatoia |
|----------|-------------|-------------|
| Focus | Evidenzia il paragrafo corrente | `F8` |
| Macchina da scrivere | Mantieni il cursore centrato | `F9` |
| Testo a capo | Attiva/disattiva il ritorno a capo automatico | `Alt + Z` |

## Formattazione di Base

### Stili di Testo

| Stile | Sintassi | Scorciatoia |
|-------|----------|-------------|
| **Grassetto** | `**testo**` | `Cmd/Ctrl + B` |
| *Corsivo* | `*testo*` | `Cmd/Ctrl + I` |
| ~~Barrato~~ | `~~testo~~` | `Cmd/Ctrl + Shift + X` |
| `Codice` | `` `codice` `` | `Cmd/Ctrl + Shift + `` ` `` |

### Elementi a Blocco

- **Intestazioni**: Usa i simboli `#` oppure `Cmd/Ctrl + 1-6`
- **Elenchi**: Inizia le righe con `-`, `*`, `1.` o `- [ ]` per elenchi di attività
- **Citazioni**: Inizia con `>` oppure usa `Alt/Option + Cmd + Q`
- **Blocchi di codice**: Usa tre apici inversi con linguaggio opzionale
- **Tabelle**: Usa il menu Formato oppure `Cmd/Ctrl + Shift + T`

## Lavorare con i File

### Creazione e Apertura

- **Nuovo file**: `Cmd/Ctrl + N`
- **Apri file**: `Cmd/Ctrl + O`
- **Apri cartella**: `Cmd/Ctrl + Shift + O` (modalità workspace)

### Salvataggio

- **Salva**: `Cmd/Ctrl + S`
- **Salva come**: `Cmd/Ctrl + Shift + S`
- **Salvataggio automatico**: Abilitato per impostazione predefinita, configurabile nelle impostazioni

### Esportazione

- **Esporta HTML**: Usa **File → Esporta HTML** — include il VMark Reader interattivo
- **Esporta PDF**: Usa Stampa (`Cmd/Ctrl + P`) e salva come PDF
- **Copia come HTML**: `Cmd/Ctrl + Shift + C`

L'HTML esportato include il VMark Reader con sommario, pannello impostazioni e altro. [Scopri di più →](/it/guide/export)

## Impostazioni

Apri le impostazioni con `Cmd/Ctrl + ,` per personalizzare:

- **Aspetto**: Tema, font, dimensione font, interlinea
- **Editor**: Intervallo di salvataggio automatico, comportamenti predefiniti
- **File e immagini**: Gestione delle risorse, strumenti documento
- **Integrazioni**: Provider IA, server MCP
- **Lingua**: Regole di formattazione CJK
- **Markdown**: Opzioni di esportazione, preferenze di formattazione
- **Scorciatoie**: Personalizza le scorciatoie da tastiera
- **Terminale**: Dimensione font e interlinea del terminale

## Assistenza alla Scrittura con IA

VMark include Genies IA integrati — seleziona del testo e premi `Mod + Y` per rifinire, espandere, tradurre o trasformare la tua scrittura con l'IA. Configura il tuo provider preferito in **Impostazioni > Integrazioni**.

[Scopri di più sui Genies IA →](/it/guide/ai-genies) | [Configura i provider →](/it/guide/ai-providers)

## Suggerimenti per Iniziare

1. **Naviga con la struttura**: Fai clic sugli elementi della struttura per passare alle sezioni
2. **Prova la modalità focus**: `F8` attenua tutto tranne il paragrafo corrente
3. **Convalida durante la scrittura**: `Cmd + Shift + L` esegue il motore di lint markdown e il controllo dei collegamenti interrotti
4. **Impara le scorciatoie**: il riferimento completo è nella [guida alle scorciatoie](/it/guide/shortcuts)

## Prossimi Passi

- Scopri tutte le [funzionalità](/it/guide/features)
- Padroneggia le [scorciatoie da tastiera](/it/guide/shortcuts)
- Esplora gli strumenti di [formattazione CJK](/it/guide/cjk-formatting)
