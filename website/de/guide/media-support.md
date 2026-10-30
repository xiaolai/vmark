# Medienunterstützung

VMark unterstützt Video-, Audio- und YouTube-Einbettungen in Ihren Markdown-Dokumenten mit Standard-HTML5-Tags.

## Unterstützte Formate

### Video

| Format | Erweiterung |
|--------|-------------|
| MP4 | `.mp4` |
| WebM | `.webm` |
| MOV | `.mov` |
| AVI | `.avi` |
| MKV | `.mkv` |
| M4V | `.m4v` |
| OGV | `.ogv` |

### Audio

| Format | Erweiterung |
|--------|-------------|
| MP3 | `.mp3` |
| M4A | `.m4a` |
| OGG | `.ogg` |
| WAV | `.wav` |
| FLAC | `.flac` |
| AAC | `.aac` |
| Opus | `.opus` |

## Syntax

### Video

Standard-HTML5-Video-Tags verwenden:

```html
<video src="path/to/video.mp4" controls></video>
```

Mit optionalen Attributen:

```html
<video src="video.mp4" title="Demo" poster="thumbnail.jpg" controls></video>
```

### Audio

Standard-HTML5-Audio-Tags verwenden:

```html
<audio src="path/to/audio.mp3" controls></audio>
```

### YouTube-Einbettungen

Datenschutzverbesserte YouTube-iFrames verwenden:

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

### Vimeo-Einbettungen

Vimeo-Player-iFrames verwenden:

```html
<iframe src="https://player.vimeo.com/video/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

Sie können auch eine Vimeo-URL direkt einfügen (z. B. `https://vimeo.com/123456789`) und VMark konvertiert sie automatisch in eine Einbettung.

Auch nicht gelistete Vimeo-Videos werden unterstützt: Fügen Sie den nicht gelisteten Freigabelink ein (`https://vimeo.com/123456789/abcdef1234` oder eine URL mit `?h=…`), und VMark behält den Datenschutz-Hash bei, den die Einbettung zum Abspielen benötigt.

### Bilibili-Einbettungen

Den Bilibili-Player-iFrame mit einer BV-ID verwenden:

```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xxxxxxxxx" width="560" height="350" frameborder="0" allowfullscreen></iframe>
```

Fügen Sie eine Bilibili-Video-URL ein (z. B. `https://bilibili.com/video/BV1xxxxxxxxx`) und VMark konvertiert sie automatisch in eine Einbettung. Beachten Sie, dass Kurz-URLs (`b23.tv`) nicht unterstützt werden, da sie eine Weiterleitungsauflösung erfordern.

### Bildsyntax-Fallback

Sie können auch Bildsyntax mit Mediendateiendungen verwenden — VMark befördert diese automatisch zum korrekten Medientyp:

```markdown
![](video.mp4)
![](audio.mp3)
```

## Medien einfügen

### Symbolleiste

Das Einfügen-Menü in der Symbolleiste verwenden:

- **Video** — öffnet eine Dateiauswahl für Videodateien, kopiert in `.assets/`, fügt einen `<video>`-Tag ein
- **Audio** — öffnet eine Dateiauswahl für Audiodateien, kopiert in `.assets/`, fügt einen `<audio>`-Tag ein
- **YouTube** — liest eine YouTube-URL aus der Zwischenablage und fügt eine datenschutzverbesserte Einbettung ein
- **Vimeo** und **Bilibili** — fügen Sie eine Video-URL direkt in den Editor ein und VMark erkennt den Anbieter automatisch

### Drag & Drop

Video- oder Audiodateien aus Ihrem Dateisystem direkt in den Editor ziehen. VMark wird:

1. Die Datei in den `.assets/`-Ordner des Dokuments kopieren
2. Den entsprechenden Medienknoten mit einem relativen Pfad einfügen

### Quellmodus

Im Quellmodus HTML-Tags direkt eingeben. Medien-Tags werden mit farbigen linken Rändern hervorgehoben:

- **Video** — Blaugrüner Rand
- **Audio** — Indigoblauer Rand
- **YouTube** — Roter Rand
- **Vimeo** — Blauer Rand
- **Bilibili** — Rosa Rand

### Intelligentes Einfügen im Quellmodus

Das Einfügen im Quellmodus tut das, was in Markdown korrekt ist, statt Rohtext abzuladen:

- **Ein Bildpfad** — oder mehrere, aus einer Mehrfachkopie im Finder oder Explorer — wird geprüft, in den Assets-Ordner des Dokuments kopiert und als `![](relative-path)` eingefügt. Ist ein Einfügevorgang mehrdeutig, fragt zuerst eine kleine Bestätigungs-Toast-Meldung nach
- **Ein Screenshot oder ein kopiertes Bild** (binäre Bilddaten in der Zwischenablage) wird im Assets-Ordner gespeichert und auf dieselbe Weise eingefügt
- **Eine über markiertem Text eingefügte URL** wird zu einem Link: `[selected text](https://…)`
- **Aus einer anderen App kopiertes HTML oder Markdown** wird vor dem Einfügen konvertiert und bereinigt — außer innerhalb eines umzäunten Codeblocks, wo eingefügter Text unverändert bleibt
- **Aus dem Finder oder Explorer in den Quelleditor gezogene Bilddateien** werden ebenfalls kopiert und eingefügt

Die Konvertierung folgt **Einstellungen → Markdown → Verarbeitung beim Einfügen aus der Zwischenablage** (`Smart` ist der Standard; die anderen Modi schalten sie ab), und Dateien werden in den Assets-Ordner kopiert, solange **Einstellungen → Dateien & Bilder → In Assets-Ordner kopieren** eingeschaltet ist (der Standard).

## Medien bearbeiten

Doppelklicken Sie auf ein beliebiges Medienelement im WYSIWYG-Modus, um das Medien-Popup zu öffnen:

- **Quellpfad** — den Dateipfad oder die URL bearbeiten
- **Titel** — optionales Titelattribut
- **Poster** (nur Video) — Pfad zum Vorschaubild
- **Entfernen** — das Medienelement löschen

`Escape` drücken, um das Popup zu schließen und zum Editor zurückzukehren.

## Pfadauflösung

VMark unterstützt drei Arten von Medienpfaden:

| Pfadtyp | Beispiel | Verhalten |
|---------|---------|-----------|
| Relativ | `./assets/video.mp4` | Relativ zum Verzeichnis des Dokuments aufgelöst |
| Relativ zum übergeordneten Ordner | `../images/photo.png` | Relativ zum Verzeichnis des Dokuments aufgelöst, wobei so viele Ebenen nach oben gegangen wird, wie der Pfad verlangt |
| Absolut | `/Users/me/video.mp4` | Direkt über das Tauri-Asset-Protokoll verwendet |
| Externe URL | `https://example.com/video.mp4` | Direkt aus dem Web geladen |

Relative Pfade werden empfohlen — sie halten Ihre Dokumente über Rechner hinweg portabel.

Ein gemeinsamer Assets-Ordner neben Ihren Notizen funktioniert wie geschrieben — `notes/report.md`
kann auf `../images/photo.png` verweisen. (Vor 0.9.79 wurden diese als defekte
Platzhalter dargestellt.)

## Sicherheit

- Ein Medienpfad darf kein URI-Schema tragen (`javascript:`, `file:` oder ein eigenes); solche Quellen werden abgelehnt statt geladen
- Ein relativer Pfad, der ein Verzeichnis bezeichnet (`.`, `..`, `assets/`), wird nicht geladen. Die Video-/Audio-Blöcke lehnen ihn sofort ab. Inline-Bilder geben ihn unverändert zurück, und die Webview löst ihn gegen den App-Ursprung auf, sodass er nie die Festplatte erreicht. Ein Pfad relativ zum Home-Ordner (`~/…`) wird genauso behandelt
- Absolute Pfade werden durch die Pfadregeln nicht eingeschränkt. Jeder absolute Pfad innerhalb des Asset-Bereichs wird angezeigt: Ihr Home-Ordner, `/Volumes`, `/mnt` und `/media` (unter Windows zusätzlich die Laufwerke `C:`–`F:`) sowie zur Laufzeit freigegebene Ordner. Ein Dokument kann daher jedes lesbare Bild an diesen Orten anzeigen, indem es dessen vollständigen Pfad angibt. Das Einfügen eines Bildes bei ausgeschaltetem **In Assets-Ordner kopieren** schreibt einen solchen absoluten Pfad. Deshalb darf ein relativer Pfad auch `..` verwenden: Er erreicht nichts, was ein absoluter Pfad nicht ohnehin erreichen könnte
- Video-Einbettungen werden nur von drei Hosts geladen: `www.youtube-nocookie.com` (der datenschutzfreundliche Player von YouTube), `player.vimeo.com` und `player.bilibili.com`. Ein YouTube-Link oder ein iFrame mit `youtube.com` wird über den datenschutzfreundlichen Host eingebettet. Die Content Security Policy von VMark lässt Frames nur von diesen Hosts und von keiner anderen Website zu
- Andere iFrame-Quellen werden vom Bereiniger entfernt
