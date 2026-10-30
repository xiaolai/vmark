# Formatos Compatibles

VMark abre directamente todos los formatos de archivo que se indican a continuación. El diferenciador son las **vistas previas con conocimiento de esquema**: cuando el archivo es un artefacto conocido, VMark muestra la vista *adecuada*, no un árbol JSON genérico.

[[toc]]

## Activar formatos

Markdown, texto plano y YAML/YML siempre se abren con sus editores completos — esos son los valores predeterminados tranquilos. Todos los demás formatos que se enumeran a continuación están **desactivados por defecto** y están sujetos a un alternador de categoría en **Configuración → Formatos**:

| Alternador | Activa |
|---|---|
| **Formatos de datos** | `.json`, `.jsonl`, `.toml` (panel dividido: fuente + árbol, con renderizadores de esquema para `Cargo.toml` / `package.json` / `pyproject.toml`) |
| **Diagramas y SVG** | `.mmd`, `.svg` (panel dividido: fuente + renderizado en vivo saneado) |
| **Vista previa HTML** | `.html`, `.htm` (iframe en zona de pruebas — consulta [Modelo de seguridad para HTML](#modelo-de-seguridad-para-html)) |
| **Visores de código** | 12 visores de código de solo lectura (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`) |

Cuando una categoría está desactivada, las extensiones correspondientes pasan al modo de texto plano de reserva, de modo que el archivo sigue abriéndose — solo sin la vista previa o la vista de esquema. Cambia un alternador y el registro se reconstruye en el lugar; las pestañas abiertas se remontan con el adaptador adecuado.

En el primer inicio tras actualizar a la compatibilidad con múltiples formatos, VMark muestra una notificación puntual que te invita a ir a **Configuración → Formatos**. Si la descartaste (o instalaste una versión nueva), el panel está en **Configuración → Formatos** en cualquier momento.

## De un vistazo

| Familia | Extensiones | Predeterminado | Editor | Vista previa |
|---|---|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | siempre activo | Modos WYSIWYG + Fuente | prosa renderizada |
| Texto plano | `.txt` | siempre activo | fuente | — |
| Datos — YAML | `.yaml`, `.yml` | siempre activo | fuente + árbol | árbol navegable, con conocimiento de esquema (GitHub Actions, flujos de trabajo de VMark) |
| Datos — JSON | `.json`, `.jsonl` | requiere el alternador **Formatos de datos** | fuente + árbol | árbol JSON navegable, con conocimiento de esquema (`package.json`) |
| Datos — TOML | `.toml` | requiere el alternador **Formatos de datos** | fuente + árbol | árbol navegable, con conocimiento de esquema (`Cargo.toml`, `pyproject.toml`) |
| Diagramas | `.mmd` | requiere el alternador **Diagramas y SVG** | fuente + renderizado | diagrama Mermaid en vivo |
| Vector | `.svg` | requiere el alternador **Diagramas y SVG** | fuente + renderizado | renderizado en línea saneado |
| Web | `.html`, `.htm` | requiere el alternador **Vista previa HTML** | fuente + renderizado | iframe en zona de pruebas (`sandbox=""` lista de permisos vacía, DOMPurify, CSP); el [modo de confianza](#vista-previa-html-de-confianza-opcional) es opcional por archivo |
| Código (solo lectura) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | requiere el alternador **Visores de código** | visor (con opción de activar edición) | — |
| Multimedia | imágenes (`.png`, `.jpg`, `.gif`, `.webp`, `.heic`, `.tiff`, …), vídeo (`.mp4`, `.webm`, `.mov`, …), audio (`.mp3`, `.wav`, `.flac`, …) | siempre activo | visor (solo lectura) | imagen nativa / `<video>` / `<audio>` |

Los archivos de código se abren en modo de solo lectura con un banner que ofrece **Habilitar edición** o **Abrir en editor externo**.

## Modos de vista (Fuente / Dividido / Vista previa)

Cualquier formato que tenga vista previa — HTML, SVG, Mermaid, JSON, YAML, TOML — se abre con
un pequeño conmutador **Fuente · Dividido · Vista previa** en la esquina superior derecha:

- **Fuente** — el panel de fuente editable, a ancho completo.
- **Dividido** — fuente y vista previa lado a lado (el valor predeterminado).
- **Vista previa** — el resultado renderizado, a ancho completo. La vista previa es un
  renderizado de **solo lectura**; para editar, vuelve a Fuente o Dividido.

También puedes cambiar desde el teclado: **`F6`** alterna Fuente ⇄ Dividido y
**`Shift + F6`** alterna Vista previa ⇄ Dividido (Dividido es el estado base). La elección
se recuerda por pestaña. Define el valor predeterminado para los archivos recién abiertos en
**Configuración → Formatos → Modo de vista predeterminado**.

Los formatos sin vista previa (texto plano, visores de código) siempre muestran solo la fuente,
por lo que no aparece ningún conmutador.

## Archivos multimedia (imágenes, vídeo, audio)

Abre una imagen, un vídeo o un archivo de audio y VMark lo muestra en línea — como la Vista
Rápida de Finder. Dos formas de previsualizar:

- **Ábrelo** (haz clic en él en el explorador de archivos, usa **Archivo → Abrir archivo…** o
  arrástralo) para verlo en una pestaña.
- **Vista Rápida**: selecciona un archivo en el explorador y pulsa **Espacio** para una
  superposición de vista previa a toda la ventana. Pulsa **Espacio**, **Esc** o haz clic en el
  fondo para cerrarla.

Cómo funciona y qué esperar:

- **Nunca se carga como texto.** El contenido multimedia es binario — VMark transmite el archivo
  directamente al visor a través del canal nativo de recursos. Nunca se lee como UTF-8,
  nunca se mantiene en memoria como documento y nunca se puede editar ni guardar. Incluso
  los vídeos de varios gigabytes se abren al instante y se desplazan de forma nativa.
- **Los cambios en disco se reflejan.** Vuelve a exportar la imagen desde tu editor, o deja que
  un script la reescriba, y la pestaña abierta recoge la nueva versión por sí sola — sin
  reabrir, sin cerrar y volver a abrir el archivo.
- **Amplia cobertura de formatos.** VMark entrega el archivo al motor multimedia de la
  plataforma, por lo que la compatibilidad depende de lo que el webview de tu sistema pueda
  decodificar. En macOS es amplia — HEIC, TIFF, `.mov`/H.264 y FLAC se reproducen. Los
  formatos que el webview no puede decodificar (p. ej. `.mkv`, `.avi`, `.wmv`) se abren igualmente,
  mostrando un panel alternativo con **Abrir con la aplicación predeterminada** y **Mostrar en Finder**
  (**Mostrar en Explorador** en Windows, **Mostrar en gestor de archivos** en Linux).
- **Solo lectura.** Las pestañas multimedia nunca quedan modificadas y se cierran sin pedir guardar.

## Vistas previas con conocimiento de esquema

Cuando la ruta o el contenido coincide con un esquema conocido, VMark sustituye la vista genérica en árbol por la vista adecuada.

### Workflow de GitHub Actions (`.github/workflows/*.yml`)

Se abre con el banco de trabajo de workflows: el lienzo interactivo con el DAG de trabajos más un editor de formularios estructurado con Guardar / Descartar (consulta la [guía del Visor de Workflow](/es/guide/workflow-viewer)). El panel de fuente también conoce los workflows — autocompletado de expresiones `${{ }}`, resaltado del trabajo en el lienzo según la posición del cursor y Cmd-clic en las referencias locales de `uses:`.

- Detección por ruta: un archivo `.yml` / `.yaml` bajo `.github/workflows/` se dirige al renderizador de workflows — incluso con YAML mal formado, de modo que ves la vista degradada con diagnósticos en lugar de un árbol vacío. (El archivo debe llegar primero al adaptador YAML; esto requiere la extensión `.yml` / `.yaml`.)
- Detección por contenido: claves `on:` y `jobs:` en el nivel superior.

### Flujo de trabajo de VMark (`steps:` de nivel superior)

Se abre con el panel de ejecución del flujo de trabajo: una barra de herramientas **Ejecutar** / **Cancelar** con una línea de estado, el grafo de pasos en vivo (o el error de análisis) y **Restaurar archivos** después de una ejecución que escribió archivos. Consulta la [guía de flujos de trabajo](/es/guide/workflows).

- Detección por ruta: nunca bajo `.github/workflows/` — esa carpeta es de GitHub.
- Detección por contenido: el YAML se analiza correctamente, no tiene `jobs:` de nivel superior y tiene una lista `steps:` de nivel superior en la que el `uses:` de al menos un paso empieza por `genie/`, `action/` o `webhook/`. Un YAML roto nunca es un flujo de trabajo de VMark.
- El panel necesita **Configuración → Avanzado → Motor de flujo de trabajo**. Con el motor desactivado, el archivo muestra el árbol YAML normal (salvo que siga activa una ejecución iniciada desde esta pestaña, para que su Cancelar siga siendo accesible).

### `Cargo.toml`

Se abre con un árbol de dependencias de Rust — dependencias de ejecución, de desarrollo y de compilación, con especificaciones de versión y marcadores de características.

- Detección por ruta: nombre de archivo `Cargo.toml` (sin distinción entre mayúsculas y minúsculas) en rutas POSIX o Windows.
- Detección por contenido: encabezado `[package]` o `[workspace]`.
- Sin llamadas de red — VMark nunca resuelve crates.io.

### `package.json`

Se abre con un árbol de dependencias npm — `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`.

- Detección por ruta: nombre de archivo `package.json`.
- Detección por contenido: clave `name` en el nivel superior más cualquiera de `dependencies` / `devDependencies` / `peerDependencies`.

### `pyproject.toml`

Se abre con un árbol de dependencias de Python — tanto PEP 621 (`[project]` + `[project.optional-dependencies]`) como Poetry (`[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]`, `[tool.poetry.group.<name>.dependencies]`).

- Detección por ruta: nombre de archivo `pyproject.toml`.
- Detección por contenido: encabezado `[project]` o `[tool.poetry]` (sujeto a un análisis TOML limpio).

## Reglas de edición

- **Markdown** incluye la barra de herramientas completa, formato de párrafo, reglas CJK, matemáticas, mermaid, notas al pie — todas las características de markdown existentes.
- **Formatos de datos** (JSON, YAML, TOML) se editan en el panel de fuente con marcadores de error de análisis en el margen; la vista previa en árbol se actualiza mientras escribes. Las acciones de menú exclusivas de Markdown están desactivadas (formato CJK, insertar bloque, formato de párrafo); los controles relevantes para el modo permanecen activos. El menú contextual del botón derecho se reduce a las acciones del portapapeles (Cortar/Copiar/Pegar/Seleccionar todo).
- **Formatos visuales** (Mermaid, SVG, HTML) se editan en el panel de fuente con la vista renderizada en el panel derecho. La vista previa se renderiza con menor prioridad que tu escritura, de modo que en un documento grande se pone al día un instante por detrás del cursor en lugar de volver a renderizarse con cada pulsación.
- **Formatos de código** se abren como visores con resaltado de sintaxis; puedes cambiar para editar en el lugar o abrirlos en tu editor externo (ver más abajo).

## Dialecto Markdown

VMark lee y escribe Markdown con remark (micromark por debajo): CommonMark, más GitHub Flavored Markdown (tablas, listas de tareas, tachado con `~~`, enlaces automáticos, notas al pie), front matter YAML, matemáticas `$…$` / `$$…$$`, enlaces wiki (`[[target]]`), alertas de GitHub (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), bloques `<details>`, `[TOC]` y cuatro marcas en línea: `==highlight==`, `~subscript~`, `^superscript^` y `++underline++`. Una sola tilde es subíndice, nunca tachado.

**Límite de anidamiento.** WYSIWYG admite citas y listas anidadas hasta 1000 niveles de profundidad. Un documento más profundo se abre en **modo Fuente** con un mensaje que indica su profundidad, y la barra de estado muestra *«Abierto en modo Fuente (no se puede mostrar en WYSIWYG).»* Mientras está en ese estado, el archivo está protegido para que el editor enriquecido no lo sobrescriba. Reduce el anidamiento y después usa **Cambiar a WYSIWYG**. El código delimitado, los separadores temáticos y el énfasis en línea no cuentan para el límite. Consulta también [Archivos grandes](/es/guide/large-files).

## Cómo decide VMark el tipo de un archivo

VMark trata **markdown como una lista de permitidos, no como un valor predeterminado**. La regla, en orden:

1. **Una extensión de la familia markdown** (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`) se abre en el editor de markdown enriquecido.
2. **Una extensión registrada que no es markdown** (cuando su categoría está activada — JSON, YAML, visores de código, etc.) se abre en el panel de fuente de ese formato.
3. **Todo lo demás** — `.env`, `.env.local`, `Dockerfile`, `Makefile`, `.gitignore`, extensiones desconocidas — se abre en el **panel de fuente de texto plano**, nunca en el editor de markdown.

Esto significa que un archivo de configuración nunca se renderiza en silencio como markdown. Un `.env.local` se abre como texto plano, con sus líneas `KEY=value`, sus comentarios `#` y sus guiones bajos exactamente como se escribieron.

Las familias de archivos ocultos (dotfiles) se reconocen como grupo: una anulación sobre `.env` cubre `.env.local`, `.env.production`, etc.

### Abrir archivos desde tu sistema

El instalador registra VMark en tu sistema operativo como editor para estos tipos de archivo, de modo que aparecen en **Abrir con** y se pueden abrir en VMark con doble clic:

| Extensiones | Registrado como |
|---|---|
| `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | Markdown Document |
| `.txt` | Plain Text Document |
| `.json`, `.jsonl` | JSON Document |
| `.yaml`, `.yml` | YAML Document |
| `.toml` | TOML Document |
| `.mmd` | Mermaid Diagram |
| `.svg` | SVG Image |
| `.html`, `.htm` | HTML Document |

En **Windows**, el instalador no se apropia de un tipo de archivo que ya gestiona otro programa: para cada extensión que ya tiene un programa predeterminado, VMark se añade a **Abrir con** y deja ese predeterminado en su sitio. Solo se convierte en el predeterminado donde no había nada registrado — en la práctica, las extensiones de Markdown, no `.txt`, `.html`, `.htm` ni `.svg`. Un predeterminado que elijas tú en la configuración de Windows siempre gana. Al desinstalar se restauran la entrada de menú **Nuevo → Documento de texto** de Windows y el gestor anterior.

Un archivo registrado se abre en VMark solo si su formato está activado (consulta [Activar formatos](#activar-formatos)); si no, se abre como texto plano.

En Windows y Linux, una carpeta pasada en la línea de comandos (`vmark C:\notes` o `vmark ~/notes`) se abre como espacio de trabajo en su propia ventana, igual que al soltar una carpeta sobre el icono del Dock en macOS. Esto también funciona cuando VMark ya está en ejecución.

### Resaltado de sintaxis para archivos planos

Incluso cuando un archivo se abre como texto plano, VMark lo colorea si reconoce el tipo — `.env`/`.ini`/`.conf` (propiedades), `.sh`/`.bash` (shell), `Dockerfile`, `.toml`, `.sql`, `.diff` y los lenguajes habituales. Es puramente estético; nunca cambia el editor en el que se abrió el archivo y funciona tanto si la categoría de visores de código está activada como si no.

### Anulación: "Establecer tipo de archivo"

La detección es el valor predeterminado, no una jaula. Abre la paleta de comandos y ejecuta:

- **Establecer tipo de archivo: Texto sin formato** — fuerza que la familia del archivo actual se abra como texto plano (p. ej. para que un `.txt` que usas como notas en bruto deje de renderizarse).
- **Establecer tipo de archivo: Markdown** — renderiza un archivo que no es `.md` con el editor de markdown (p. ej. un `.txt` en el que en realidad escribes markdown).
- **Establecer tipo de archivo: Restablecer predeterminado** — elimina la anulación.

Las anulaciones se recuerdan por familia de archivo (por extensión, o por la raíz del nombre del dotfile en archivos como `.env`) y persisten entre sesiones. Tienen prioridad sobre las reglas integradas anteriores.

## Buscar, guardar, búsqueda de contenido

- **Archivo → Abrir archivo…** ofrece dos filtros: **Todos los formatos compatibles** (todos los formatos registrados) y **Markdown**. El elemento no tiene atajo predeterminado — `Mod + O` es **Apertura rápida** —, pero puedes asignarle uno en **Configuración → Atajos**. Los filtros de Guardar como y la extensión de guardado predeterminada se derivan del adaptador de formato de la pestaña activa, por lo que guardar un archivo `.toml` propone `.toml` como extensión.
- **Arrastrar y soltar** acepta cualquier extensión registrada.
- **Guardar como** filtra y la extensión predeterminada al guardar se derivan del adaptador de formato de la pestaña activa.
- **Cmd+Shift+H** para la búsqueda de contenido ("Buscar en archivos") indexa todos los formatos de tipo texto (markdown, txt, json, yaml, toml, html, svg, mermaid). Los archivos de código están excluidos por defecto — están en modo visor de código.

## Modelo de seguridad para HTML

Según el ADR-4 del plan multi-formato, la vista previa HTML se basa en tres capas de defensa independientes:

1. **`<iframe sandbox="">`** con una lista de permisos vacía — sin scripts, sin mismo origen, sin formularios, sin ventanas emergentes. El sandboxing se aplica únicamente mediante el atributo del iframe (el CSP vía `<meta>` no es un sandbox según MDN).
2. **Saneado con DOMPurify** que se ejecuta primero — elimina `<script>`, URLs `javascript:`, manejadores de eventos en línea y trucos con base-href.
3. **Inyección de CSP mediante `<meta>`** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — restringe la carga de recursos dentro del iframe.

El validador muestra etiquetas de script, URLs `javascript:` y manejadores de eventos en línea como advertencias para que puedas ver qué está siendo bloqueado. Una vez que [confías en el archivo](#vista-previa-html-de-confianza-opcional) se muestran como información, para que nada contradiga el banner de confianza. Dos mensajes indican lo que la vista previa nunca permite, sea de confianza o no: un script externo (`<script src="…">`) nunca se carga, ya que ningún script procede de un archivo o una URL, y un enlace `javascript:` dirigido a otra ventana o a la página superior (`target="_top"`, `_blank` o un `<base target>`) nunca navega, ya que la vista previa no puede salir de sí misma. La detección lee las etiquetas de la página de forma aproximada; etiqueta los hallazgos y nunca decide qué se ejecuta — eso lo decide la zona de pruebas.

La aprobación formal de seguridad de esta vista previa sigue pendiente, y la vista previa lo indica en un aviso sobre la página renderizada: **La vista previa HTML está aislada. Su revisión de seguridad aún está en curso.** Las tres capas anteriores están implementadas; el paso pendiente es confirmarlas frente a las cargas XSS de OWASP dentro del webview de la aplicación en ejecución.

### Vista previa HTML de confianza (opcional)

La vista previa segura anterior es el valor predeterminado y nunca cambia. Para un documento
que hayas escrito tú — un laboratorio interactivo, un panel local, una demo autocontenida —
puedes autorizar la ejecución de scripts para **ese único archivo, durante esta sesión**.

Usa **Activar vista previa de confianza…** en la barra situada sobre la vista previa. Primero
recibes una advertencia; nada se ejecuta hasta que confirmas. Mientras está activa, la barra
permanece visible e indica **De confianza — scripts activados**, y **Revocar confianza** está
a un clic de distancia.

Qué concede el modo de confianza y qué no:

| | Vista previa de confianza |
|---|---|
| JavaScript, DOM, eventos de puntero, `requestAnimationFrame`, Web Audio | ✅ se ejecuta |
| Red (`fetch`, `XMLHttpRequest`, WebSocket, imágenes/scripts remotos) | ❌ bloqueada por `default-src 'none'` |
| La propia página de VMark, los comandos de Tauri, tu sistema de archivos | ❌ inalcanzables — el documento se ejecuta en un origen opaco propio |
| Navegación de nivel superior, ventanas emergentes, envío de formularios, descargas, modales | ❌ no concedidos (`sandbox="allow-scripts"` y nada más) |
| Cámara, micrófono, geolocalización, portapapeles | ❌ no se delega ninguna función al marco |
| `localStorage` / `sessionStorage` | ❌ no disponibles — un origen opaco no tiene almacenamiento del mismo origen |
| `eval` / `new Function` | ❌ no permitidos |

Tres propiedades que conviene conocer:

- **La confianza nunca se infiere.** Ni de la extensión `.html`, ni de la procedencia
  del archivo, ni de un archivo hermano en el que ya confiaste. Solo la confirmación
  la concede.
- **La confianza nunca se conserva.** Cierra VMark y todas las concesiones desaparecen. Tampoco
  está disponible para un documento sin guardar, que no tiene identidad a la que asociar una
  concesión — guarda primero el archivo.
- **Una vista previa de confianza nunca se vuelve a ejecutar sola.** Editar la fuente la marca
  como *Puede no coincidir con el código fuente actual* y espera a **Recargar**, de modo que una
  simulación en curso no se reinicia con cada pulsación. La misma marca aparece cuando
  VMark no puede saber qué está ejecutando el marco — después de cambiar a otra pestaña y
  volver, o de cerrarla y reabrirla, la vista previa sigue ejecutando lo último que se
  publicó para ese archivo, así que lo indica en lugar de afirmar que está al día.
  **Recargar** vuelve a publicar el archivo tal como está ahora.

::: info Windows lo sirve a través de un origen http local
WebView2 no admite esquemas de URL personalizados, por lo que en Windows el documento de confianza
se sirve desde `http://vmark-trusted.localhost` en lugar de `vmark-trusted://` — la misma
concesión, la misma zona de pruebas y el mismo CSP, bajo la forma de URL que Tauri usa allí para
todos los protocolos personalizados. La vista previa segura funciona en todas las plataformas.
:::

El contenido de confianza se sirve desde un origen `vmark-trusted://`
(`http://vmark-trusted.localhost` en Windows) con su propio CSP restrictivo. Esa indirección es
necesaria, no decorativa: un marco `srcdoc`, `blob:` o `data:` hereda la política
`script-src 'self'` del propio VMark, y un CSP dentro del marco solo puede endurecer uno
heredado, nunca relajarlo — así que ningún atributo del iframe por sí solo puede hacer que se
ejecute un script en línea.

## Abrir en editor externo

Para los archivos de código, el botón **Abrir en editor externo** del banner de solo lectura lanza el editor que elijas. Orden de resolución:

1. **Configuración → Formatos → Editor externo** (el campo de interfaz — consulta [Configuración](/es/guide/settings#formatos)). Introduce el **nombre de un editor conocido** (`code`, `cursor`, `zed`, `subl`, `bbedit`, `idea`, `vim`, `nvim`, `emacs`, `notepad++`, …) o la **ruta completa** de un editor — un paquete `.app` en macOS, un ejecutable en Linux/Windows. El campo contiene un programa, nunca argumentos; para pasar argumentos, usa `$VMARK_EXTERNAL_EDITOR`.
2. `$VMARK_EXTERNAL_EDITOR` (variable de entorno de nivel de proyecto)
3. `$VISUAL`
4. `$EDITOR`
5. Valor predeterminado de la plataforma (`open -t` en macOS, `notepad.exe` en Windows, `xdg-open` en Linux)

La configuración de la interfaz tiene prioridad sobre las variables de entorno — lo explícito supera a lo implícito. Deja el campo vacío para usar la cadena de reserva de variables de entorno.

VMark enruta a través de un PATH de shell de inicio de sesión, de modo que los wrappers de VS Code / Cursor / JetBrains se resuelven correctamente cuando se lanzan desde una aplicación GUI de macOS.

### Puerta de seguridad

El propio ajuste **Editor externo** se comprueba antes de lanzar nada. VMark rechaza:

- caracteres de shell (`;`, `|`, `&`, `` ` ``, `$`, `<`, `>`, comillas, saltos de línea) y un `-` inicial
- un nombre sin ruta que no sea un editor que VMark conozca — *«X» no es un editor que VMark reconozca por su nombre: introduce la ruta completa del editor*
- una ruta relativa, una ruta con un segmento `..` o una barra final, o una ruta que no existe
- un programa que ejecuta los archivos que recibe en lugar de abrirlos — un shell (`sh`, `bash`, `zsh`, `pwsh`, `cmd`, …), un intérprete (`python`, `node`, `ruby`, `perl`, `osascript`, …), un lanzador (`env`, `sudo`, `open`, `xdg-open`, …) o un emulador de terminal — comprobado tanto con el nombre que escribiste como con el nombre al que se resuelve un enlace

Las variables de entorno de la cadena de reserva no están restringidas: las defines tú, fuera de VMark.

El comando Tauri `open_in_external_editor` también rechaza:

- rutas inexistentes
- directorios y otros archivos no regulares (sockets, dispositivos)
- rutas cuya extensión canonicalizada no esté en el conjunto de formatos registrados de VMark
- enlaces simbólicos cuyo destino canónico no supere ninguna de las comprobaciones anteriores

Una webview comprometida no puede usar el botón para lanzar el editor externo sobre archivos arbitrarios del sistema (contraseñas, claves, etc.) — solo sobre rutas que VMark mismo abriría.

## Qué no está soportado

Según los objetivos no incluidos en el plan:

- **No es un editor de código.** Sin LSP, sin autocompletado, sin refactorización, sin depurador, sin marcadores de git.
- **No es "todos los formatos de texto plano".** Alcance acotado — consulta la tabla anterior.
- **Sin ejecución de scripts HTML por defecto.** Solo renderizado en zona de pruebas, salvo que
  autorices explícitamente un archivo mediante la [vista previa HTML de confianza](#vista-previa-html-de-confianza-opcional).
- **Sin impresión / exportación / copiar como HTML para formatos que no son markdown** en v1.
- **Aún no compatibles como visores de código**: Zig, Swift, Kotlin, Java, Elixir, OCaml y otros lenguajes fuera del conjunto de 12 extensiones. La regla de decisión es "lenguajes que nosotros mismos usamos" — abre un issue si quieres que se añada alguno.

Si el formato que buscas no está en la lista y no está deliberadamente fuera del alcance, abre un issue.
