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
| Datos — YAML | `.yaml`, `.yml` | siempre activo | fuente + árbol | árbol navegable, con conocimiento de esquema (GitHub Actions) |
| Datos — JSON | `.json`, `.jsonl` | requiere el alternador **Formatos de datos** | fuente + árbol | árbol JSON navegable, con conocimiento de esquema (`package.json`) |
| Datos — TOML | `.toml` | requiere el alternador **Formatos de datos** | fuente + árbol | árbol navegable, con conocimiento de esquema (`Cargo.toml`, `pyproject.toml`) |
| Diagramas | `.mmd` | requiere el alternador **Diagramas y SVG** | fuente + renderizado | diagrama Mermaid en vivo |
| Vector | `.svg` | requiere el alternador **Diagramas y SVG** | fuente + renderizado | renderizado en línea saneado |
| Web | `.html`, `.htm` | requiere el alternador **Vista previa HTML** | fuente + renderizado | iframe en zona de pruebas (`sandbox=""` lista de permisos vacía, DOMPurify, CSP) |
| Código (solo lectura) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | requiere el alternador **Visores de código** | visor (con opción de activar edición) | — |

Los archivos de código se abren en modo de solo lectura con un banner que ofrece **Habilitar edición** o **Abrir en editor externo**.

## Vistas previas con conocimiento de esquema

Cuando la ruta o el contenido coincide con un esquema conocido, VMark sustituye la vista genérica en árbol por la vista adecuada.

### Workflow de GitHub Actions (`.github/workflows/*.yml`)

Se abre con la visualización del workflow (DAG de trabajos, disparadores, permisos).

- Detección por ruta: un archivo `.yml` / `.yaml` bajo `.github/workflows/` se dirige al renderizador de workflows — incluso con YAML mal formado, de modo que ves la vista degradada con diagnósticos en lugar de un árbol vacío. (El archivo debe llegar primero al adaptador YAML; esto requiere la extensión `.yml` / `.yaml`.)
- Detección por contenido: claves `on:` y `jobs:` en el nivel superior.

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
- **Formatos de datos** (JSON, YAML, TOML) se editan en el panel de fuente con marcadores de error de análisis en el margen; la vista previa en árbol se actualiza mientras escribes. Las acciones de menú exclusivas de Markdown están desactivadas (formato CJK, insertar bloque, formato de párrafo); los controles relevantes para el modo permanecen activos.
- **Formatos visuales** (Mermaid, SVG, HTML) se editan en el panel de fuente con la vista renderizada en el panel derecho (con debounce).
- **Formatos de código** se abren como visores con resaltado de sintaxis; puedes cambiar para editar en el lugar o abrirlos en tu editor externo (ver más abajo).

## Buscar, guardar, búsqueda de contenido

- **Cmd+O** filtra con un preset único "Todos los formatos compatibles" que cubre todos los formatos registrados. Los filtros de Guardar como y la extensión de guardado predeterminada se derivan del adaptador de formato de la pestaña activa, por lo que guardar un archivo `.toml` propone `.toml` como extensión.
- **Arrastrar y soltar** acepta cualquier extensión registrada.
- **Guardar como** filtra y la extensión predeterminada al guardar se derivan del adaptador de formato de la pestaña activa.
- **Cmd+Shift+H** para la búsqueda de contenido ("Buscar en archivos") indexa todos los formatos de tipo texto (markdown, txt, json, yaml, toml, html, svg, mermaid). Los archivos de código están excluidos por defecto — están en modo visor de código.

## Modelo de seguridad para HTML

Según el ADR-4 del plan multi-formato, la vista previa HTML se basa en tres capas de defensa independientes:

1. **`<iframe sandbox="">`** con una lista de permisos vacía — sin scripts, sin mismo origen, sin formularios, sin ventanas emergentes. El sandboxing se aplica únicamente mediante el atributo del iframe (el CSP vía `<meta>` no es un sandbox según MDN).
2. **Saneado con DOMPurify** que se ejecuta primero — elimina `<script>`, URLs `javascript:`, manejadores de eventos en línea y trucos con base-href.
3. **Inyección de CSP mediante `<meta>`** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — restringe la carga de recursos dentro del iframe.

El validador muestra etiquetas de script, URLs `javascript:` y manejadores de eventos en línea como advertencias para que puedas ver qué está siendo bloqueado.

## Abrir en editor externo

Para los archivos de código, el botón **Abrir en editor externo** del banner de solo lectura lanza el editor que elijas. Orden de resolución:

1. **Configuración → Formatos → Editor externo** (el campo de interfaz — consulta [Configuración](/es/guide/settings#formatos)). Elige un paquete `.app` en macOS, un ejecutable en Linux/Windows, o cualquier cosa que tu shell pueda resolver.
2. `$VMARK_EXTERNAL_EDITOR` (variable de entorno de nivel de proyecto)
3. `$VISUAL`
4. `$EDITOR`
5. Valor predeterminado de la plataforma (`open -t` en macOS, `notepad.exe` en Windows, `xdg-open` en Linux)

La configuración de la interfaz tiene prioridad sobre las variables de entorno — lo explícito supera a lo implícito. Deja el campo vacío para usar la cadena de reserva de variables de entorno.

VMark enruta a través de un PATH de shell de inicio de sesión, de modo que los wrappers de VS Code / Cursor / JetBrains se resuelven correctamente cuando se lanzan desde una aplicación GUI de macOS.

### Puerta de seguridad

El comando Tauri `open_in_external_editor` rechaza:

- rutas inexistentes
- directorios y otros archivos no regulares (sockets, dispositivos)
- rutas cuya extensión canonicalizada no esté en el conjunto de formatos registrados de VMark
- enlaces simbólicos cuyo destino canónico no supere ninguna de las comprobaciones anteriores

Una webview comprometida no puede usar el botón para lanzar el editor externo sobre archivos arbitrarios del sistema (contraseñas, claves, etc.) — solo sobre rutas que VMark mismo abriría.

## Qué no está soportado

Según los objetivos no incluidos en el plan:

- **No es un editor de código.** Sin LSP, sin autocompletado, sin refactorización, sin depurador, sin marcadores de git.
- **No es "todos los formatos de texto plano".** Alcance acotado — consulta la tabla anterior.
- **Sin ejecución de scripts HTML.** Solo renderizado en zona de pruebas.
- **Sin impresión / exportación / copiar como HTML para formatos que no son markdown** en v1.
- **Aún no compatibles como visores de código**: Zig, Swift, Kotlin, Java, Elixir, OCaml y otros lenguajes fuera del conjunto de 12 extensiones. La regla de decisión es "lenguajes que nosotros mismos usamos" — abre un issue si quieres que se añada alguno.

Si el formato que buscas no está en la lista y no está deliberadamente fuera del alcance, abre un issue.
