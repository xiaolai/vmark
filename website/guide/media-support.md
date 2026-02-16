# Media Support

VMark supports video, audio, and YouTube embeds in your Markdown documents using standard HTML5 tags.

## Supported Formats

### Video

| Format | Extension |
|--------|-----------|
| MP4 | `.mp4` |
| WebM | `.webm` |
| MOV | `.mov` |
| AVI | `.avi` |
| MKV | `.mkv` |
| M4V | `.m4v` |
| OGV | `.ogv` |

### Audio

| Format | Extension |
|--------|-----------|
| MP3 | `.mp3` |
| M4A | `.m4a` |
| OGG | `.ogg` |
| WAV | `.wav` |
| FLAC | `.flac` |
| AAC | `.aac` |
| Opus | `.opus` |

## Syntax

### Video

Use standard HTML5 video tags:

```html
<video src="path/to/video.mp4" controls></video>
```

With optional attributes:

```html
<video src="video.mp4" title="Demo" poster="thumbnail.jpg" controls></video>
```

### Audio

Use standard HTML5 audio tags:

```html
<audio src="path/to/audio.mp3" controls></audio>
```

### YouTube Embeds

Use privacy-enhanced YouTube iframes:

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

### Image Syntax Fallback

You can also use image syntax with media file extensions — VMark automatically promotes them to the correct media type:

```markdown
![](video.mp4)
![](audio.mp3)
```

## Inserting Media

### Toolbar

Use the Insert menu in the toolbar:

- **Video** — opens a file picker for video files, copies to `.assets/`, inserts a `<video>` tag
- **Audio** — opens a file picker for audio files, copies to `.assets/`, inserts an `<audio>` tag
- **YouTube** — reads a YouTube URL from the clipboard and inserts a privacy-enhanced embed

### Drag & Drop

Drag video or audio files from your file system directly into the editor. VMark will:

1. Copy the file to the document's `.assets/` folder
2. Insert the appropriate media node with a relative path

### Source Mode

In Source mode, type the HTML tags directly. Media tags are highlighted with colored left borders:

- **Video** — teal border
- **Audio** — indigo border
- **YouTube** — red border

## Editing Media

Click any media element in WYSIWYG mode to open the media popup:

- **Source path** — edit the file path or URL
- **Title** — optional title attribute
- **Poster** (video only) — thumbnail image path
- **Remove** — delete the media element

Press `Escape` to close the popup and return to the editor.

## Path Resolution

VMark supports three types of media paths:

| Path Type | Example | Behavior |
|-----------|---------|----------|
| Relative | `./assets/video.mp4` | Resolved relative to the document's directory |
| Absolute | `/Users/me/video.mp4` | Used directly via Tauri asset protocol |
| External URL | `https://example.com/video.mp4` | Loaded directly from the web |

Relative paths are recommended — they keep your documents portable across machines.

## Security

- Relative paths are validated against directory traversal attacks
- YouTube iframes are restricted to `youtube.com` and `youtube-nocookie.com` domains
- Other iframe sources are stripped by the sanitizer
