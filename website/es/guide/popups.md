# Popups en Línea

VMark proporciona popups contextuales para editar enlaces, imágenes, medios, matemáticas, notas al pie y más. Estos popups funcionan tanto en el modo WYSIWYG como en el modo Fuente con una navegación por teclado consistente.

## Atajos de Teclado Comunes

Todos los popups comparten estos comportamientos de teclado:

| Acción | Atajo |
|--------|-------|
| Cerrar/Cancelar | `Escape` |
| Confirmar/Guardar | `Enter` |
| Navegar campos | `Tab` / `Shift + Tab` |

## Popup de Enlace

Al hacer clic en un enlace se muestra su popup de edición. El cursor se queda donde hiciste clic, así que puedes seguir editando el texto del enlace — escribir, `Backspace` y copiar/pegar actúan sobre el documento. El popup se cierra en cuanto editas el texto o mueves el cursor fuera del enlace.

### Editar un Enlace Existente

**Activación:** Haz clic en un enlace, o coloca el cursor en un enlace + `Mod + K`

Un clic deja el teclado en el documento; haz clic en el campo URL para editar el destino. `Mod + K` lleva el foco directamente al campo URL.

**Campos:**
- **URL** — Editar el destino del enlace
- **Abrir** — Abre el enlace en el navegador
- **Copiar** — Copia la URL al portapapeles
- **Eliminar** — Elimina el enlace, conserva el texto

**Abrir sin el popup:** `Cmd + Clic` (`Ctrl + Clic` en Windows/Linux) sobre un enlace abre su destino directamente.

### Crear un Nuevo Enlace

**Activación:** Selecciona texto + `Mod + K`

**Portapapeles inteligente:** Si el portapapeles contiene una URL, se rellena automáticamente.

**Campos:**
- **Entrada de URL** — Introduce el destino
- **Confirmar** — Presiona Enter o haz clic en ✓
- **Cancelar** — Presiona Escape o haz clic en ✗

### Modo Fuente

- **`Cmd + Clic`** (`Ctrl + Clic` en Windows/Linux) en un enlace → las URL externas se abren en el navegador, los enlaces `#marcador` saltan al encabezado y las rutas de archivos locales abren el archivo en una nueva pestaña
- **Clic** en la sintaxis `[texto](url)` → muestra el popup de edición; el cursor se queda en el markdown para que puedas seguir escribiendo
- **`Mod + K`** dentro de un enlace → muestra el popup de edición con el foco en el campo URL

::: tip Enlace Marcador
Los enlaces que comienzan con `#` se tratan como marcadores (enlaces internos de encabezado). Abrir salta al encabezado en lugar de abrir un navegador.
:::

::: tip Enlaces entre Archivos
Los enlaces que apuntan a archivos locales abren el archivo de destino en una nueva pestaña, situándose en el encabezado cuando el enlace lleva un `#fragment`. Las rutas relativas como `../appendix/cards.md` o `./notes.md` se resuelven respecto al directorio del documento actual. Las rutas absolutas — `/Users/me/notes/a.md` en macOS/Linux, `C:\notes\a.md` en Windows — abren exactamente el archivo que indican. Las rutas de red (`\\server\share\…`) no se abren desde los enlaces. Si el documento no tiene título, solo se pueden abrir rutas absolutas.
:::

## Popup de Medios (Imágenes, Vídeo, Audio)

Un popup unificado para editar todos los tipos de medios — imágenes, vídeo y audio.

### Popup de Edición

**Activación:** Doble clic en cualquier elemento multimedia (imagen, vídeo o audio)

**Campos comunes (todos los tipos de medios):**
- **Fuente** — Ruta del archivo o URL

**Campos específicos por tipo:**

| Campo | Imagen | Vídeo | Audio |
|-------|--------|-------|-------|
| Texto alternativo | Sí | — | — |
| Título | — | Sí | Sí |
| Portada | — | Sí | — |
| Dimensiones | Solo lectura | — | — |
| Alternar en línea/bloque | Sí (no en imágenes enlazadas) | — | — |

**Botones:**
- **Examinar** — Selecciona un archivo del sistema de archivos
- **Copiar** — Copia la ruta de la fuente al portapapeles
- **Eliminar** — Elimina el elemento multimedia

**Atajos:**
- `Mod + Shift + I` — Insertar nueva imagen
- `Enter` — Guardar cambios
- `Escape` — Cerrar popup

### Modo Fuente

En el modo Fuente, hacer clic en la sintaxis de imagen `![alt](ruta)` abre el mismo popup de medios. Los archivos multimedia (extensiones de vídeo/audio) muestran una vista previa flotante con controles de reproducción nativos al pasar el ratón.

## Menú Contextual de Imagen

Al hacer clic derecho en una imagen en el modo WYSIWYG se abre un menú contextual con acciones rápidas (separado del popup de edición de doble clic).

**Activación:** Clic derecho en cualquier imagen

**Acciones:**
| Acción | Descripción |
|--------|-------------|
| Cambiar Imagen | Abre un selector de archivos para reemplazar la imagen |
| Eliminar Imagen | Elimina la imagen del documento |
| Copiar Ruta | Copia la ruta de origen de la imagen al portapapeles |
| Revelar en Finder | Abre la ubicación del archivo de imagen en el administrador de archivos (la etiqueta se adapta según la plataforma) |

Presiona `Escape` para cerrar el menú contextual sin realizar ninguna acción.

## Popup de Matemáticas

Edita expresiones matemáticas LaTeX con vista previa en tiempo real.

**Activación:**
- **WYSIWYG:** Haz clic en la matemática en línea `$...$`
- **Fuente:** Coloca el cursor dentro de `$...$`, `$$...$$` o bloques ` ```latex `

**Campos:**
- **Entrada LaTeX** — Edita la expresión matemática
- **Vista previa** — Vista previa renderizada en tiempo real
- **Visualización de Errores** — Muestra errores LaTeX con sugerencias de sintaxis útiles

**Atajos:**
- `Mod + Enter` — Guardar y cerrar
- `Escape` — Cancelar y cerrar
- `Shift + Retroceso` — Eliminar matemática en línea (funciona incluso cuando no está vacía, solo WYSIWYG)
- `Alt + Mod + M` — Insertar nueva matemática en línea

::: tip Sugerencias de Error
Cuando tienes un error de sintaxis LaTeX, el popup muestra sugerencias útiles como llaves faltantes, comandos desconocidos o delimitadores desequilibrados.
:::

::: info Modo Fuente
El modo Fuente ofrece el mismo popup editable de matemáticas que el modo WYSIWYG — un área de texto para la entrada LaTeX con una vista previa KaTeX en vivo debajo. El popup se abre automáticamente cuando el cursor entra en una sintaxis matemática (`$...$`, `$$...$$` o ` ```latex `). Pulsa `Mod + Enter` para guardar o `Escape` para cancelar.
:::

## Popup de Nota al Pie

Edita el contenido de las notas al pie en línea.

**Activación:**
- **WYSIWYG:** Pasa el ratón sobre la referencia de nota al pie `[^1]`

**Campos:**
- **Contenido** — Texto de nota al pie de múltiples líneas (se redimensiona automáticamente)
- **Ir a la Definición** — Salta a la definición de la nota al pie
- **Eliminar** — Elimina la nota al pie

**Comportamiento:**
- Las nuevas notas al pie enfocan automáticamente el campo de contenido
- El área de texto se expande a medida que escribes

## Popup de Wiki Link

Edita los enlaces estilo wiki para conexiones internas de documentos.

**Activación:**
- **WYSIWYG:** Pasa el ratón sobre `[[destino]]` (retraso de 300ms)
- **Fuente:** Haz clic en la sintaxis del wiki link

**Campos:**
- **Destino** — Ruta relativa al espacio de trabajo (la extensión `.md` se gestiona automáticamente)
- **Examinar** — Selecciona un archivo del espacio de trabajo
- **Abrir** — Abre el documento vinculado
- **Copiar** — Copia la ruta de destino
- **Eliminar** — Elimina el wiki link

## Menú Contextual de Tabla

Acciones de edición rápida de tablas.

**Activación:**
- **WYSIWYG:** Usa la barra de herramientas o los atajos de teclado
- **Fuente:** Clic derecho en una celda de tabla

**Acciones:**
| Acción | Descripción |
|--------|-------------|
| Insertar Fila Arriba/Abajo | Añade fila en el cursor |
| Insertar Columna Izquierda/Derecha | Añade columna en el cursor |
| Eliminar Fila | Elimina la fila actual |
| Eliminar Columna | Elimina la columna actual |
| Eliminar Tabla | Elimina toda la tabla |
| Alinear Columna Izquierda/Centro/Derecha | Establece la alineación para la columna actual |
| Alinear Todo Izquierda/Centro/Derecha | Establece la alineación para todas las columnas |
| Formatear Tabla | Auto-alinea las columnas de la tabla (embellece el markdown) |

## Popup de Revisión Ortográfica

Corrige errores ortográficos con sugerencias.

**Activación:**
- Clic derecho en una palabra mal escrita (subrayado rojo)

**Acciones:**
- **Sugerencias** — Haz clic para reemplazar con la sugerencia
- **Añadir al Diccionario** — Deja de marcarla como mal escrita

## Comparación de Modos

| Elemento | Edición WYSIWYG | Fuente |
|----------|-----------------|--------|
| Enlace | Clic / `Mod+K` / `Cmd+Clic` para abrir | Clic / `Mod+K` / `Cmd+Clic` para abrir |
| Imagen | Doble clic | Clic en `![](ruta)` |
| Vídeo | Doble clic | — |
| Audio | Doble clic | — |
| Matemáticas | Clic | Cursor en matemáticas → popup |
| Nota al pie | Pasar el ratón | Edición directa |
| Wiki Link | Pasar el ratón | Clic |
| Tabla | Barra de herramientas | Menú clic derecho |
| Revisión Ortográfica | Clic derecho | Clic derecho |

## Consejos de Navegación en Popups

### Flujo de Enfoque
1. El popup se abre con el primer campo enfocado
2. `Tab` avanza por los campos y botones
3. `Shift + Tab` retrocede
4. El enfoque se repite dentro del popup

### Edición Rápida
- Para cambios simples de URL: edita y presiona `Enter`
- Para cancelar: presiona `Escape` desde cualquier campo
- Para contenido de múltiples líneas (notas al pie, matemáticas): usa `Mod + Enter` para guardar

### Comportamiento del Ratón
- Haz clic fuera del popup para cerrarlo (los cambios se descartan)
- Los popups al pasar el ratón (nota al pie, wiki) tienen un retraso de 300ms antes de mostrarse
- Mover el ratón de vuelta al popup lo mantiene abierto

<!-- Styles in style.css -->
