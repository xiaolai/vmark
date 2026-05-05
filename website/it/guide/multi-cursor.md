# Modifica Multi-Cursore

VMark supporta una potente modifica multi-cursore sia in modalità WYSIWYG che Sorgente, consentendo di modificare più posizioni contemporaneamente.

## Avvio Rapido

| Azione | Scorciatoia |
|--------|-------------|
| Aggiungi cursore alla corrispondenza successiva | `Mod + D` |
| Salta corrispondenza, vai alla successiva | `Mod + Shift + D` |
| Aggiungi cursori a tutte le corrispondenze | `Mod + Shift + L` |
| Annulla ultima aggiunta cursore | `Alt + Mod + Z` |
| Aggiungi cursore sopra | `Mod + Alt + Su` |
| Aggiungi cursore sotto | `Mod + Alt + Giù` |
| Aggiungi/rimuovi cursore al clic | `Alt + Clic` |
| Comprimi al cursore singolo | `Escape` |

::: tip
**Mod** = Cmd su macOS, Ctrl su Windows/Linux
**Alt** = Option su macOS
:::

## Aggiunta di Cursori

### Seleziona Occorrenza Successiva (`Mod + D`)

1. Seleziona una parola o posiziona il cursore su una parola
2. Premi `Mod + D` per aggiungere un cursore alla prossima occorrenza
3. Premi di nuovo per aggiungere altri cursori
4. Digita per modificare tutte le posizioni contemporaneamente

<div class="feature-box">
<strong>Esempio:</strong> Per rinominare una variabile <code>count</code> in <code>total</code>:
<ol>
<li>Fai doppio clic su <code>count</code> per selezionarla</li>
<li>Premi <code>Mod + D</code> ripetutamente per selezionare ogni occorrenza</li>
<li>Digita <code>total</code> — tutte le occorrenze vengono aggiornate contemporaneamente</li>
</ol>
</div>

### Seleziona Tutte le Occorrenze (`Mod + Shift + L`)

Seleziona tutte le occorrenze della parola o della selezione corrente contemporaneamente:

1. Seleziona una parola o un testo
2. Premi `Mod + Shift + L`
3. Tutte le occorrenze corrispondenti nel blocco corrente vengono selezionate
4. Digita per sostituire tutte contemporaneamente

### Alt + Clic

Tieni premuto `Alt` (Option su macOS) e fai clic per:
- **Aggiungere** un cursore in quella posizione
- **Rimuovere** un cursore se ne esiste già uno lì

Questo è utile per posizionare cursori in posizioni arbitrarie che non sono testo corrispondente.

### Salta Occorrenza (`Mod + Shift + D`)

Quando `Mod + D` seleziona una corrispondenza che non vuoi, saltala:

1. Premi `Mod + D` per iniziare ad aggiungere corrispondenze
2. Se l'ultima corrispondenza è indesiderata, premi `Mod + Shift + D` per saltarla
3. La corrispondenza saltata viene rimossa e viene selezionata la corrispondenza successiva

Questo è l'equivalente multi-cursore di "Trova Successivo" — ti permette di scegliere quali occorrenze modificare.

### Annullamento Soft (`Alt + Mod + Z`)

Annulla l'ultima aggiunta di cursore senza perdere tutti i cursori:

1. Premi `Mod + D` più volte per accumulare cursori
2. Se ne hai aggiunto uno di troppo, premi `Alt + Mod + Z`
3. L'ultimo cursore aggiunto viene rimosso, ripristinando lo stato precedente

A differenza di `Escape` (che comprime tutto), l'annullamento soft torna indietro un cursore alla volta.

### Aggiungi Cursore Sopra / Sotto (`Mod + Alt + Su/Giù`)

Aggiungi cursori verticalmente, una riga alla volta:

1. Posiziona il cursore su una riga
2. Premi `Mod + Alt + Giù` per aggiungere un cursore nella riga successiva
3. Premi di nuovo per continuare ad aggiungere cursori verso il basso
4. Usa `Mod + Alt + Su` per aggiungere cursori verso l'alto

Questo è ideale per modificare testo allineato in colonne o per fare la stessa modifica su righe consecutive.

## Modifica con Più Cursori

Una volta che hai più cursori, tutte le modifiche standard funzionano su ogni cursore:

### Digitazione
- I caratteri vengono inseriti in tutte le posizioni dei cursori
- Le selezioni vengono sostituite in tutte le posizioni

### Eliminazione
- **Backspace** — elimina il carattere prima di ogni cursore
- **Canc** — elimina il carattere dopo ogni cursore

### Navigazione
- **Tasti freccia** — spostano tutti i cursori insieme
- **Shift + Freccia** — estendono la selezione su ogni cursore
- **Mod + Freccia** — saltano per parola/riga su ogni cursore

### Escape con Tab

L'escape con Tab funziona indipendentemente per ogni cursore:

- I cursori all'interno di **grassetto**, *corsivo*, `codice`, o ~~barrato~~ saltano alla fine di quella formattazione
- I cursori all'interno dei collegamenti escono dal collegamento
- I cursori prima delle parentesi di chiusura `)` `]` `}` saltano oltre di esse
- I cursori nel testo normale rimangono fermi

Questo ti permette di uscire da più regioni formattate contemporaneamente. Vedi [Navigazione Intelligente con Tab](./tab-navigation.md#multi-cursor-support) per i dettagli.

### Appunti

**Copia** (`Mod + C`):
- Copia il testo da tutte le selezioni, unito da newline

**Incolla** (`Mod + V`):
- Se gli appunti hanno lo stesso numero di righe dei cursori, ogni riga va a ogni cursore
- Altrimenti, il contenuto completo degli appunti viene incollato su tutti i cursori

## Ambito del Blocco

Le operazioni multi-cursore hanno **ambito limitato al blocco corrente** per prevenire modifiche indesiderate in sezioni non correlate.

### In Modalità WYSIWYG
- I cursori non possono attraversare i confini dei blocchi di codice
- Se il cursore principale è all'interno di un blocco di codice, i nuovi cursori rimangono in quel blocco

### In Modalità Sorgente
- Le righe vuote fungono da confini del blocco
- `Mod + D` e `Mod + Shift + L` corrispondono solo all'interno del paragrafo corrente

<div class="feature-box">
<strong>Perché l'ambito del blocco?</strong>
<p>Questo impedisce di modificare accidentalmente un nome di variabile in sezioni di codice non correlate o di cambiare testo in paragrafi diversi che coincidono.</p>
</div>

## Compressione dei Cursori

Premi `Escape` per comprimere di nuovo a un singolo cursore nella posizione primaria.

::: tip Stabilità del cursore
I cursori compressi rimangono stabili quando il testo viene inserito nella posizione del cursore. Non si espandono inaspettatamente in selezioni dopo inserimenti mappati (corretto in v0.6.x).
:::

## Feedback Visivo

- **Cursore primario** — cursore lampeggiante standard
- **Cursori secondari** — cursori lampeggianti aggiuntivi con stile distinto
- **Selezioni** — la selezione di ogni cursore è evidenziata

In modalità scura, i colori del cursore e della selezione si adattano automaticamente per la visibilità.

## Confronto tra Modalità

| Funzione | WYSIWYG | Sorgente |
|----------|---------|---------|
| `Mod + D` | ✓ | ✓ |
| `Mod + Shift + D` (Salta) | ✓ | ✓ |
| `Mod + Shift + L` | ✓ | ✓ |
| `Alt + Mod + Z` (Annullamento Soft) | ✓ | ✓ |
| `Mod + Alt + Su/Giù` | ✓ | ✓ |
| `Alt + Clic` | ✓ | ✓ |
| Ambito del blocco | Recinzioni di codice | Righe vuote |
| Ricerca con ritorno a capo | ✓ | ✓ |

## Suggerimenti e Best Practice

### Rinominare Variabili
1. Fai doppio clic sul nome della variabile
2. `Mod + Shift + L` per selezionare tutte nel blocco
3. Digita il nuovo nome

### Aggiungere Prefissi/Suffissi
1. Posiziona il cursore prima/dopo testo ripetuto
2. `Mod + D` per aggiungere cursori a ogni occorrenza
3. Digita il prefisso o il suffisso

### Modifica degli Elementi di Elenco
1. Seleziona il pattern comune (come `- ` all'inizio delle righe)
2. `Mod + Shift + L` per selezionare tutti
3. Modifica tutti gli elementi dell'elenco contemporaneamente

### Quando Usare Ogni Scorciatoia

| Scenario | Scorciatoia Migliore |
|----------|---------------------|
| Selezione attenta e incrementale | `Mod + D` |
| Salta la corrispondenza indesiderata | `Mod + Shift + D` |
| Sostituisci tutto nel blocco | `Mod + Shift + L` |
| Annulla l'ultimo passo del cursore | `Alt + Mod + Z` |
| Modifica righe consecutive | `Mod + Alt + Su/Giù` |
| Posizioni arbitrarie | `Alt + Clic` |
| Uscita rapida | `Escape` |

## Limitazioni

- **Nodi atomici**: Non è possibile posizionare cursori all'interno di immagini, contenuto incorporato o blocchi matematici in modalità WYSIWYG
- **Input IME**: Quando si usano metodi di input (cinese, giapponese, ecc.), la composizione influenza solo il cursore primario
- **A livello di documento**: Le selezioni hanno ambito limitato ai blocchi, non all'intero documento

## Riferimento Tastiera

| Azione | Scorciatoia |
|--------|-------------|
| Seleziona occorrenza successiva | `Mod + D` |
| Salta occorrenza | `Mod + Shift + D` |
| Seleziona tutte le occorrenze | `Mod + Shift + L` |
| Annullamento soft cursore | `Alt + Mod + Z` |
| Aggiungi cursore sopra | `Mod + Alt + Su` |
| Aggiungi cursore sotto | `Mod + Alt + Giù` |
| Aggiungi/rimuovi cursore | `Alt + Clic` |
| Comprimi al cursore singolo | `Escape` |
| Sposta tutti i cursori | Tasti freccia |
| Estendi tutte le selezioni | `Shift + Freccia` |
| Salta per parola | `Alt + Freccia` |
| Salta per riga | `Mod + Freccia` |

<!-- Styles in style.css -->
