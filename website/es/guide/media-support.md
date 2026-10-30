# Soporte de Medios

VMark soporta vídeo, audio e incrustaciones de YouTube en tus documentos Markdown usando etiquetas HTML5 estándar.

## Formatos Admitidos

### Vídeo

| Formato | Extensión |
|---------|-----------|
| MP4 | `.mp4` |
| WebM | `.webm` |
| MOV | `.mov` |
| AVI | `.avi` |
| MKV | `.mkv` |
| M4V | `.m4v` |
| OGV | `.ogv` |

### Audio

| Formato | Extensión |
|---------|-----------|
| MP3 | `.mp3` |
| M4A | `.m4a` |
| OGG | `.ogg` |
| WAV | `.wav` |
| FLAC | `.flac` |
| AAC | `.aac` |
| Opus | `.opus` |

## Sintaxis

### Vídeo

Usa las etiquetas de vídeo HTML5 estándar:

```html
<video src="path/to/video.mp4" controls></video>
```

Con atributos opcionales:

```html
<video src="video.mp4" title="Demo" poster="thumbnail.jpg" controls></video>
```

### Audio

Usa las etiquetas de audio HTML5 estándar:

```html
<audio src="path/to/audio.mp3" controls></audio>
```

### Incrustaciones de YouTube

Usa iframes de YouTube con privacidad mejorada:

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

### Embeds de Vimeo

Usa iframes del reproductor de Vimeo:

```html
<iframe src="https://player.vimeo.com/video/VIDEO_ID" width="560" height="315" frameborder="0" allowfullscreen></iframe>
```

También puedes pegar una URL de Vimeo directamente (por ejemplo, `https://vimeo.com/123456789`) y VMark la convertirá automáticamente en un embed.

También se admiten los vídeos de Vimeo no listados: pega el enlace para compartir no listado (`https://vimeo.com/123456789/abcdef1234` o una URL con `?h=…`) y VMark conserva el hash de privacidad que el embed necesita para reproducirse.

### Embeds de Bilibili

Usa el iframe del reproductor de Bilibili con un BV ID:

```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xxxxxxxxx" width="560" height="350" frameborder="0" allowfullscreen></iframe>
```

Pega una URL de vídeo de Bilibili (por ejemplo, `https://bilibili.com/video/BV1xxxxxxxxx`) y VMark la convertirá en un embed automáticamente. Ten en cuenta que las URLs cortas (`b23.tv`) no son compatibles ya que requieren resolución de redirección.

### Alternativa con Sintaxis de Imagen

También puedes usar la sintaxis de imagen con extensiones de archivos multimedia — VMark los promociona automáticamente al tipo de medio correcto:

```markdown
![](video.mp4)
![](audio.mp3)
```

## Insertar Medios

### Barra de Herramientas

Usa el menú Insertar en la barra de herramientas:

- **Vídeo** — abre un selector de archivos para vídeos, copia a `.assets/`, inserta una etiqueta `<video>`
- **Audio** — abre un selector de archivos para audio, copia a `.assets/`, inserta una etiqueta `<audio>`
- **YouTube** — lee una URL de YouTube del portapapeles e inserta una incrustación con privacidad mejorada
- **Vimeo** y **Bilibili** — pega una URL de vídeo directamente en el editor y VMark detecta automáticamente el proveedor

### Arrastrar y Soltar

Arrastra archivos de vídeo o audio desde tu sistema de archivos directamente al editor. VMark:

1. Copiará el archivo a la carpeta `.assets/` del documento
2. Insertará el nodo multimedia apropiado con una ruta relativa

### Modo Fuente

En el modo Fuente, escribe las etiquetas HTML directamente. Las etiquetas multimedia se resaltan con bordes izquierdos de colores:

- **Vídeo** — borde verde azulado
- **Audio** — borde índigo
- **YouTube** — borde rojo
- **Vimeo** — borde azul
- **Bilibili** — borde rosa

### Pegado Inteligente en Modo Fuente

Pegar en el modo Fuente hace lo correcto para Markdown en lugar de volcar texto sin procesar:

- **Una ruta de imagen** — o varias, de una copia de varios archivos en Finder o el Explorador — se valida, se copia a la carpeta de recursos del documento y se inserta como `![](relative-path)`. Cuando un pegado es ambiguo, un pequeño aviso de confirmación pregunta primero
- **Una captura de pantalla o una imagen copiada** (datos de imagen binarios en el portapapeles) se guarda en la carpeta de recursos y se inserta de la misma forma
- **Una URL pegada sobre texto seleccionado** se convierte en un enlace: `[selected text](https://…)`
- **HTML o Markdown copiado desde otra aplicación** se convierte y se limpia antes de insertarse — excepto dentro de un bloque de código delimitado, donde el texto pegado se mantiene literal
- **Los archivos de imagen arrastrados desde Finder o el Explorador** al editor de código fuente también se copian e insertan

La conversión sigue **Ajustes → Markdown → Manejo del pegado del portapapeles** (`Smart` es el predeterminado; los demás modos lo desactivan), y los archivos se copian a la carpeta de recursos mientras **Ajustes → Archivos e imágenes → Copiar a la carpeta de recursos** esté activado (el valor predeterminado).

## Editar Medios

Haz doble clic en cualquier elemento multimedia en el modo WYSIWYG para abrir el popup de medios:

- **Ruta de origen** — edita la ruta del archivo o URL
- **Título** — atributo de título opcional
- **Portada** (solo vídeo) — ruta de la imagen en miniatura
- **Eliminar** — elimina el elemento multimedia

Presiona `Escape` para cerrar el popup y volver al editor.

## Resolución de Rutas

VMark admite tres tipos de rutas de medios:

| Tipo de Ruta | Ejemplo | Comportamiento |
|--------------|---------|----------------|
| Relativa | `./assets/video.mp4` | Resuelta relativa al directorio del documento |
| Relativa al padre | `../images/photo.png` | Resuelta relativa al directorio del documento, subiendo tantos niveles como indique la ruta |
| Absoluta | `/Users/me/video.mp4` | Usada directamente a través del protocolo de recursos de Tauri |
| URL externa | `https://example.com/video.mp4` | Cargada directamente desde la web |

Se recomiendan las rutas relativas — mantienen tus documentos portátiles entre máquinas.

Una carpeta de recursos compartida junto a tus notas funciona tal cual — `notes/report.md`
puede hacer referencia a `../images/photo.png`. (Antes de la 0.9.79 se mostraban como
marcadores de posición rotos.)

## Seguridad

- Una ruta multimedia no puede llevar un esquema de URI (`javascript:`, `file:` o uno personalizado); esas fuentes se rechazan en lugar de cargarse
- Una ruta relativa que nombra un directorio (`.`, `..`, `assets/`) no se carga. Los bloques de vídeo/audio la rechazan directamente. Las imágenes en línea la devuelven sin cambios, y la webview la resuelve contra el origen de la app, así que nunca llega al disco. Una ruta relativa a la carpeta personal (`~/…`) se trata igual
- Las rutas absolutas no están restringidas por las reglas de rutas. Se muestra cualquier ruta absoluta dentro del ámbito de recursos: tu carpeta personal, `/Volumes`, `/mnt` y `/media` (más las unidades `C:`–`F:` en Windows) y las carpetas concedidas en tiempo de ejecución. Por tanto, un documento puede mostrar cualquier imagen legible de esos lugares escribiendo su ruta completa. Pegar una imagen con **Copiar a la carpeta de recursos** desactivado escribe una ruta absoluta de ese tipo. Por eso una ruta relativa también puede usar `..`: no alcanza nada que una ruta absoluta no pudiera alcanzar ya
- Los embeds de vídeo se cargan solo desde tres hosts: `www.youtube-nocookie.com` (el reproductor de privacidad mejorada de YouTube), `player.vimeo.com` y `player.bilibili.com`. Un enlace de YouTube, o un iframe escrito con `youtube.com`, se inserta a través del host de privacidad mejorada. La política de seguridad de contenido de VMark permite cargar marcos desde estos hosts y desde ningún otro sitio
- Otras fuentes de iframe son eliminadas por el saneador
