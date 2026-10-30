# Supporto Media

VMark supporta video, audio ed embed YouTube nei tuoi documenti Markdown usando i tag HTML5 standard.

## Formati Supportati

### Video

| Formato | Estensione |
|---------|-----------|
| MP4 | `.mp4` |
| WebM | `.webm` |
| MOV | `.mov` |
| AVI | `.avi` |
| MKV | `.mkv` |
| M4V | `.m4v` |
| OGV | `.ogv` |

### Audio

| Formato | Estensione |
|---------|-----------|
| MP3 | `.mp3` |
| M4A | `.m4a` |
| OGG | `.ogg` |
| WAV | `.wav` |
| FLAC | `.flac` |
| AAC | `.aac` |
| Opus | `.opus` |

## Sintassi

### Video

Usa i tag video HTML5 standard:

```html
<video src="path/to/video.mp4" controls></video>
```

Con attributi opzionali:

```html
<video src="video.mp4" title="Demo" poster="thumbnail.jpg" controls></video>
```

### Audio

Usa i tag audio HTML5 standard:

```html
<audio src="path/to/audio.mp3" controls></audio>
```

### Embed YouTube

Usa iframe YouTube con privacy migliorata:

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

### Embed Vimeo

Usa iframe del player Vimeo:

```html
<iframe src="https://player.vimeo.com/video/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

Puoi anche incollare direttamente un URL Vimeo (ad esempio `https://vimeo.com/123456789`) e VMark lo convertirà automaticamente in un embed.

Sono supportati anche i video Vimeo non in elenco: incolla il link di condivisione non in elenco (`https://vimeo.com/123456789/abcdef1234` o un URL con `?h=…`) e VMark conserva l'hash di privacy necessario all'embed per la riproduzione.

### Embed Bilibili

Usa l'iframe del player Bilibili con un BV ID:

```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xxxxxxxxx" width="560" height="350" frameborder="0" allowfullscreen></iframe>
```

Incolla un URL di un video Bilibili (ad esempio `https://bilibili.com/video/BV1xxxxxxxxx`) e VMark lo convertirà automaticamente in un embed. Nota che gli URL brevi (`b23.tv`) non sono supportati poiché richiedono la risoluzione del reindirizzamento.

### Fallback Sintassi Immagine

Puoi anche usare la sintassi delle immagini con estensioni di file multimediali — VMark le promuove automaticamente al tipo di media corretto:

```markdown
![](video.mp4)
![](audio.mp3)
```

## Inserimento di Media

### Barra degli Strumenti

Usa il menu Inserisci nella barra degli strumenti:

- **Video** — apre un selettore di file per i file video, copia in `.assets/`, inserisce un tag `<video>`
- **Audio** — apre un selettore di file per i file audio, copia in `.assets/`, inserisce un tag `<audio>`
- **YouTube** — legge un URL YouTube dagli appunti e inserisce un embed con privacy migliorata
- **Vimeo** e **Bilibili** — incolla un URL video direttamente nell'editor e VMark rileva automaticamente il provider

### Trascina e Rilascia

Trascina file video o audio dal tuo filesystem direttamente nell'editor. VMark:

1. Copierà il file nella cartella `.assets/` del documento
2. Inserirà il nodo media appropriato con un percorso relativo

### Modalità Sorgente

In modalità Sorgente, digita i tag HTML direttamente. I tag media sono evidenziati con bordi colorati a sinistra:

- **Video** — bordo verde acqua
- **Audio** — bordo indaco
- **YouTube** — bordo rosso
- **Vimeo** — bordo blu
- **Bilibili** — bordo rosa

### Incolla Intelligente in Modalità Sorgente

Incollare in modalità Sorgente fa ciò che è corretto per il markdown invece di riversare testo grezzo:

- **Un percorso di immagine** — o più d'uno, da una copia di più file nel Finder o in Esplora file — viene validato, copiato nella cartella degli asset del documento e inserito come `![](relative-path)`. Quando un incolla è ambiguo, un piccolo toast di conferma chiede prima
- **Uno screenshot o un'immagine copiata** (dati immagine binari negli appunti) viene salvato nella cartella degli asset e inserito allo stesso modo
- **Un URL incollato sopra del testo selezionato** diventa un link: `[selected text](https://…)`
- **HTML o Markdown copiato da un'altra app** viene convertito e ripulito prima di essere inserito — tranne all'interno di un blocco di codice delimitato, dove il testo incollato resta invariato
- **I file immagine trascinati dal Finder o da Esplora file** nell'editor sorgente vengono anch'essi copiati e inseriti

La conversione segue **Impostazioni → Markdown → Gestione dell'incolla dagli appunti** (`Intelligente` è il valore predefinito; le altre modalità la escludono), e i file vengono copiati nella cartella degli asset finché **Impostazioni → File e immagini → Copia nella cartella asset** è attivo (il valore predefinito).

## Modifica dei Media

Fai doppio clic su qualsiasi elemento media in modalità WYSIWYG per aprire il popup media:

- **Percorso sorgente** — modifica il percorso del file o l'URL
- **Titolo** — attributo titolo opzionale
- **Poster** (solo video) — percorso dell'immagine miniatura
- **Rimuovi** — elimina l'elemento media

Premi `Escape` per chiudere il popup e tornare all'editor.

## Risoluzione dei Percorsi

VMark supporta tre tipi di percorsi media:

| Tipo di Percorso | Esempio | Comportamento |
|-----------------|---------|--------------|
| Relativo | `./assets/video.mp4` | Risolto rispetto alla directory del documento |
| Relativo al genitore | `../images/photo.png` | Risolto rispetto alla directory del documento, risalendo di tanti livelli quanti ne indica il percorso |
| Assoluto | `/Users/me/video.mp4` | Usato direttamente tramite il protocollo asset Tauri |
| URL Esterno | `https://example.com/video.mp4` | Caricato direttamente dal web |

I percorsi relativi sono consigliati — mantengono i tuoi documenti portabili tra le macchine.

Una cartella di asset condivisa accanto alle tue note funziona così com'è scritta — `notes/report.md`
può fare riferimento a `../images/photo.png`. (Prima della 0.9.79 questi venivano mostrati come
segnaposto non funzionanti.)

## Sicurezza

- Un percorso media non può contenere uno schema URI (`javascript:`, `file:` o uno personalizzato); tali sorgenti vengono rifiutate invece di essere caricate
- Un percorso relativo che indica una directory (`.`, `..`, `assets/`) non viene caricato. I blocchi video/audio lo rifiutano direttamente. Le immagini inline lo restituiscono invariato, e la webview lo risolve rispetto all'origine dell'app, quindi non raggiunge mai il disco. Un percorso relativo alla home (`~/…`) viene trattato allo stesso modo
- I percorsi assoluti non sono limitati dalle regole sui percorsi. Viene mostrato qualsiasi percorso assoluto all'interno dell'ambito degli asset: la tua cartella home, `/Volumes`, `/mnt` e `/media` (più le unità `C:`–`F:` su Windows) e le cartelle concesse durante l'esecuzione. Un documento può quindi mostrare qualsiasi immagine leggibile in quei luoghi scrivendone il percorso completo. Incollare un'immagine con **Copia nella cartella asset** disattivato scrive proprio un percorso assoluto di questo tipo. Per questo anche un percorso relativo può usare `..`: non raggiunge nulla che un percorso assoluto non potesse già raggiungere
- Gli embed video vengono caricati solo da tre host: `www.youtube-nocookie.com` (il player di YouTube con privacy avanzata), `player.vimeo.com` e `player.bilibili.com`. Un link di YouTube, o un iframe scritto con `youtube.com`, viene incorporato tramite l'host con privacy avanzata. La content security policy di VMark consente di caricare frame da questi host e da nessun altro sito
- Le altre sorgenti di iframe vengono rimosse dal sanitizer
