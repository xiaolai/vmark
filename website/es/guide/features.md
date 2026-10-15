# Características

VMark es el espacio de trabajo de texto plano en el que personas e IA colaboran. Markdown es la pieza central (con los modos WYSIWYG, Vista Previa de Fuente y Fuente), pero el espacio de trabajo también abre YAML, JSON, TOML, Mermaid, SVG, HTML y 9 formatos de visor de código — consulta [Formatos compatibles](/es/guide/formats) para ver la lista completa.

[[toc]]

## Modos de Edición

### Modo de Texto Enriquecido (WYSIWYG)

El modo de edición predeterminado proporciona una experiencia verdadera de "lo que ves es lo que obtienes":

- Vista previa de formato en vivo mientras escribes
- Revelación de sintaxis en línea al pasar el cursor
- Barra de herramientas intuitiva y menús contextuales
- Entrada de sintaxis Markdown sin interrupciones

### Modo Fuente

Cambia a la edición de Markdown sin procesar con resaltado de sintaxis completo:

- Editor potenciado por CodeMirror 6
- Resaltado de sintaxis completo
- Popups interactivos para matemáticas, enlaces, imágenes, wiki links y medios — la misma experiencia de edición que en WYSIWYG
- Pegado inteligente — el HTML de páginas web y documentos de Word se convierte automáticamente a Markdown limpio
- Pegado de imágenes del portapapeles — las capturas de pantalla e imágenes copiadas se guardan en la carpeta de recursos y se insertan como `![](path)`
- Multicursor compatible con bloques de código y soporte de límites de palabras CJK
- Perfecto para usuarios avanzados

Alterna entre modos con `F6`.

### Vista Dividida (Fuente + Vista Previa)

Edita el código fuente Markdown a la izquierda mientras una **vista previa WYSIWYG en vivo y de solo
lectura** se actualiza a la derecha — la vista previa *es* el renderizador WYSIWYG, así que
nunca se aparta de lo que verías en el Modo de Texto Enriquecido. Los comandos de formato y la
barra de herramientas actúan sobre el panel de fuente; arrastra el divisor (o usa las teclas de flecha sobre él) para
cambiar el tamaño.

- Actívala por sesión con `Shift + F6`, **Vista → Vista dividida de Markdown** o la
  paleta de comandos («Alternar vista dividida de Markdown»)
- Hazla la opción predeterminada para los archivos Markdown en **Configuración → Markdown → Diseño →
  Dividir fuente/vista previa por defecto**

WYSIWYG sigue siendo el predeterminado; la división es opcional. Las tres vistas son mutuamente
excluyentes — `F6` alterna Fuente y `Shift + F6` alterna Dividida, y cada una vuelve
a WYSIWYG —, así que cambiar entre ellas siempre es una sola pulsación.

El menú **Vista** muestra los tres modos — **Modo WYSIWYG**, **Modo código
fuente**, **Vista dividida de Markdown** — como un grupo con marcas de verificación, de modo que el modo activo
siempre es visible y la exclusión mutua es explícita. **Ajuste de línea** y
**Números de línea** se aplican solo al editor de fuente, así que aparecen atenuados mientras
estás en el modo WYSIWYG.

### Posición de Lectura

Tu lugar en un documento sobrevive a salir de él. Cambiar a otra pestaña y volver,
alternar el modo Fuente o la Vista Dividida, o que el archivo se vuelva a cargar desde el disco te
devuelven a donde estabas leyendo — no al principio.

Cada superficie recuerda su propia posición, así que Texto Enriquecido y Fuente guardan lugares
separados en el mismo archivo. Volver a la misma superficie — al cambiar de pestaña o al recargarse
el archivo — te devuelve a donde habías desplazado la vista, aunque el cursor esté en otro sitio;
el cursor se queda donde lo dejaste. Al cambiar entre Texto Enriquecido y Fuente, en cambio, la
vista sigue al cursor, si lo hay, porque es lo que mantiene el mismo párrafo a la vista en ambos.

Las posiciones son por documento y por sesión — cerrar una pestaña la olvida.

### Deshacer Entre Modos

Deshacer y rehacer cruzan la frontera WYSIWYG ⇄ Fuente. Cada cambio de modo registra un punto de control y, una vez agotado el historial propio del editor actual, `Mod + Z` sigue avanzando por esos puntos de control — restaurando el contenido anterior sin cambiar la vista en la que estás. Rehacer recorre la misma cadena hacia delante; un rehacer cuya rama abandonaste al hacer una edición nueva se rechaza en lugar de aplicarse sobre tu trabajo. La cadena se guarda por pestaña y se borra al cerrar la pestaña.

### Archivos Grandes

VMark abre automáticamente en modo Fuente los archivos de más de 1 MB para que se abran en menos de un segundo, avisa antes de tocar archivos de más de 5 MB y rechaza los de más de 50 MB. Consulta la guía de [Archivos grandes](./large-files.md) para ver los umbrales y la configuración.

### Vista Previa de Fuente

Edita el Markdown sin procesar de un solo bloque sin salir del modo WYSIWYG. Pulsa `F5` para abrir la Vista Previa de Fuente para el bloque en el cursor.

**Diseño:**
- Barra de encabezado con etiqueta del tipo de bloque y botones de acción
- Editor CodeMirror que muestra la fuente Markdown del bloque
- Bloque original mostrado como vista previa atenuada (cuando la vista previa en vivo está activada)

**Controles:**
| Acción | Atajo |
|--------|-------|
| Guardar cambios | `Cmd/Ctrl + Enter` |
| Cancelar (revertir) | `Escape` |
| Alternar vista previa en vivo | Hacer clic en el icono de ojo |

**Vista Previa en Vivo:**
- **DESACTIVADA (predeterminado):** Edita libremente, los cambios se aplican solo al guardar
- **ACTIVADA:** Los cambios se aplican inmediatamente mientras escribes, la vista previa se muestra abajo

**Bloques excluidos:**
Algunos bloques tienen sus propios mecanismos de edición y omiten la Vista Previa de Fuente:
- Bloques de código (incluyendo Mermaid, LaTeX) — usa doble clic para editar
- Imágenes en bloque — usa el popup de imagen
- Frontmatter, bloques HTML, reglas horizontales

La Vista Previa de Fuente es útil para la edición precisa de Markdown (corregir la sintaxis de tablas, ajustar la indentación de listas) mientras permaneces en el editor visual.

## Edición Multicursor

Edita múltiples ubicaciones simultáneamente — VMark soporta multicursor completo tanto en modos WYSIWYG como de Fuente.

| Acción | Atajo |
|--------|-------|
| Añadir cursor en la siguiente coincidencia | `Mod + D` |
| Omitir coincidencia, saltar a la siguiente | `Mod + Shift + D` |
| Seleccionar todas las ocurrencias | `Mod + Shift + L` |
| Añadir cursor arriba/abajo | `Mod + Alt + Arriba/Abajo` |
| Añadir cursor con clic | `Alt + Clic` |
| Deshacer último cursor | `Alt + Mod + Z` |
| Colapsar a cursor único | `Escape` |

Toda la edición estándar (escritura, eliminación, portapapeles, navegación) funciona en cada cursor de forma independiente. En la prosa, `Mod + D` y `Mod + Shift + L` buscan en todo el documento; dentro de un bloque de código se quedan en ese bloque. `Alt + Mod + Shift + L` selecciona todas las coincidencias solo en el bloque actual.

[Más información →](/es/guide/multi-cursor)

## Seleccionar Todo Inteligente

En el modo WYSIWYG, `Mod + A` amplía la selección un contenedor cada vez en lugar de saltar directamente a todo el documento: dentro de una tabla selecciona la celda, luego la fila, luego la tabla y luego el documento. `Mod + Z` deshace un paso de ampliación y `Escape` colapsa la selección en un cursor.

En el modo Fuente, `Mod + A` selecciona primero el bloque que lo contiene — un bloque de código delimitado, una tabla, una cita o una lista — y después todo el documento; `Mod + Z` también deshace ahí un paso de ampliación.

Este atajo pertenece al editor y no se puede personalizar.

## Auto-Emparejamiento y Escape con Tab

Cuando escribes un corchete de apertura, comilla o acento grave, VMark inserta automáticamente el par de cierre. Pulsa **Tab** para saltar más allá del carácter de cierre en lugar de usar la tecla de flecha.

- Corchetes: `()` `[]` `{}`
- Comillas: `""` `''` `` ` ` ``
- CJK: `「」` `『』` `（）` `【】` `《》` `〈〉`
- Comillas tipográficas: `""` `''`
- Marcas de formato en WYSIWYG: **negrita**, *cursiva*, `código`, ~~tachado~~, enlaces

La tecla Retroceso elimina ambos caracteres cuando el par está vacío. El auto-emparejamiento y el salto de corchetes con Tab están **desactivados dentro de bloques de código y código en línea** — los corchetes en el código son literales. Configurable en **Configuración → Editor**.

[Más información →](/es/guide/tab-navigation)

## Formato de Texto

### Estilos Básicos

- **Negrita**, *Cursiva*, <u>Subrayado</u>, ~~Tachado~~
- `Código en línea`, ==Resaltado==
- Subíndice y Superíndice
- Enlaces, Wiki Links y Bookmark Links con popups de vista previa
- Notas al pie con edición en línea
- Alternar comentario HTML (`Mod + /`)
- Comando de limpiar formato

### Transformaciones de Texto

Cambia rápidamente el estilo de texto a través de Formato → Transformar:

| Transformación | Atajo |
|----------------|-------|
| MAYÚSCULAS | `Ctrl + Shift + U` (macOS) / `Alt + Shift + U` (Win/Linux) |
| minúsculas | `Ctrl + Shift + L` (macOS) / `Alt + Shift + L` (Win/Linux) |
| Título Inicial | `Ctrl + Shift + T` (macOS) / `Alt + Shift + T` (Win/Linux) |
| Alternar Mayúsculas | — |

### Elementos de Bloque

- Encabezados del 1 al 6 con atajos fáciles (aumentar/disminuir nivel con `Mod + Alt + ]`/`[`)
- Citas (anidadas soportadas)
- Bloques de código con resaltado de sintaxis
- Listas ordenadas, desordenadas y de tareas
- Ciclar tipo de lista: convierte un párrafo a lista con viñetas, numerada o de tareas en secuencia
- Desactivar una lista: hacer clic de nuevo en el tipo de lista activo quita el formato de lista
- Convertir en código: la acción Bloque de código convierte toda la lista en el cursor — o cualquier selección de varios bloques (párrafos, encabezados, listas) — en un único bloque de código, con una línea por bloque o elemento de lista
- Reglas horizontales
- Tablas con soporte de edición completo

### Saltos de Línea Duros

Pulsa `Shift + Enter` para insertar un salto de línea duro dentro de un párrafo.
VMark usa el estilo de dos espacios por defecto para mayor compatibilidad.
Configura en **Configuración > Editor > Espacio en Blanco**.

### Operaciones de Línea

Manipulación de líneas potente a través de Editar → Líneas:

| Acción | Atajo |
|--------|-------|
| Mover Línea Arriba | `Alt + Arriba` |
| Mover Línea Abajo | `Alt + Abajo` |
| Duplicar Línea | `Shift + Alt + Abajo` |
| Eliminar Línea | `Mod + Shift + K` |
| Unir Líneas | `Mod + J` |
| Eliminar Líneas en Blanco | — |
| Ordenar Líneas Ascendente | `F4` _(solo en modo Fuente)_ |
| Ordenar Líneas Descendente | `Shift + F4` _(solo en modo Fuente)_ |

La ordenación trabaja sobre líneas de texto plano, por lo que solo está disponible en el modo Fuente.

## Tablas

Edición de tablas con todas las funciones:

- Insertar tablas a través del menú o atajo
- Añadir/eliminar filas y columnas
- Alineación de celdas (izquierda, centro, derecha)
- Las columnas se ajustan automáticamente al contenido; las tablas anchas se desplazan horizontalmente
- Ajustar al ancho — fija una tabla al ancho del editor con columnas proporcionales al contenido (Configuración → Markdown, o por tabla con clic derecho)
- Barra de herramientas contextual para acciones rápidas
- Navegación por teclado — `Tab` / `Shift + Tab` pasan de una celda a otra, las flechas salen de la tabla por sus bordes y `Mod + Enter` / `Mod + Shift + Enter` añaden una fila debajo / encima

## Imágenes

Soporte integral de imágenes:

- Insertar a través del diálogo de archivos
- Arrastrar y soltar desde el sistema de archivos
- Pegar desde el portapapeles
- Copia automática a la carpeta de recursos del proyecto
- Doble clic para editar la ruta de origen y el texto alternativo — las dimensiones de la imagen se muestran en solo lectura
- Clic derecho para Cambiar imagen, Eliminar imagen, Copiar ruta de imagen y Mostrar en Finder (Mostrar en Explorador en Windows, Mostrar en gestor de archivos en Linux)
- Alternar entre visualización en línea y en bloque

## Vídeo y Audio

Soporte completo de medios con etiquetas HTML5:

- Insertar vídeo y audio a través del selector de archivos de la barra de herramientas
- Arrastrar y soltar archivos multimedia en el editor
- Copia automática a la carpeta `.assets/` del proyecto
- Clic para editar la ruta de origen, título y póster (vídeo)
- Soporte de embebido de YouTube con iframes mejorados para la privacidad
- Respaldo de sintaxis de imagen: `![](file.mp4)` se promueve automáticamente a vídeo
- Decoración del modo fuente con bordes de colores específicos por tipo
- [Más información →](/es/guide/media-support)

## Panel de Frontmatter

Edita el frontmatter YAML directamente en el modo WYSIWYG sin cambiar al modo Fuente.

- **Colapsado por defecto** — una pequeña etiqueta "Frontmatter" aparece en la parte superior del documento cuando hay frontmatter presente
- **Clic para expandir** — abre un editor de texto plano para el contenido YAML
- **`Mod + Enter`** — guardar cambios y colapsar el panel
- **`Escape`** — revertir al último valor guardado y colapsar
- **Guardado automático al perder el foco** — si haces clic en otro lugar, los cambios se guardan automáticamente tras una breve pausa

El panel crea un punto de deshacer en el historial del editor, así que siempre puedes usar `Mod + Z` para revertir los cambios del frontmatter.

## Contenido Especial

### Cuadros de Información

Alertas de Markdown estilo GitHub:

- NOTE - Información general
- TIP - Sugerencias útiles
- IMPORTANT - Información clave
- WARNING - Problemas potenciales
- CAUTION - Acciones peligrosas

### Secciones Desplegables

Crea bloques de contenido expandibles usando el elemento HTML `<details>`.

### Ecuaciones Matemáticas

Renderizado de LaTeX potenciado por KaTeX:

- Matemáticas en línea: `$E = mc^2$`
- Matemáticas en bloque: bloques `$$...$$`
- Los delimitadores al estilo de ChatGPT se reconocen al abrir/pegar y se normalizan a la
  forma con `$`: `\( ... \)` pasa a ser matemáticas en línea, y un `\[ ... \]` aislado
  pasa a ser un bloque
- Un bloque `$$` debe cerrarse antes de una línea en blanco (la regla de pandoc) — un `$$`
  sin cerrar se muestra como texto literal en lugar de tragarse los párrafos que lo siguen.
  Las líneas en blanco finales justo antes del cierre no son problema (un bloque
  `$$` … `$$` vacío sigue siendo un bloque matemático)
- Soporte completo de sintaxis LaTeX
- Mensajes de error útiles con sugerencias de sintaxis

### Diagramas

Soporte de diagramas Mermaid con vista previa en vivo:

- Diagramas de flujo, secuencia, Gantt
- Diagramas de clases, estados, ER
- Panel de vista previa en vivo en modo Fuente (arrastrar, redimensionar, zoom)
- [Más información →](/es/guide/mermaid)

Soporte de Graphviz DOT con las mismas superficies de vista previa:

- Los bloques delimitados ` ```dot ` y ` ```graphviz ` se renderizan localmente (WASM)
- Panorámica, zoom y exportación PNG como los diagramas Mermaid
- [Más información →](/es/guide/graphviz)

### Gráficos SVG

Renderiza SVG sin procesar en línea mediante bloques de código ` ```svg `:

- Renderizado instantáneo con desplazamiento, zoom y exportación PNG
- Vista previa en vivo en modos WYSIWYG y Fuente
- Ideal para gráficos generados por IA e ilustraciones personalizadas
- [Más información →](/es/guide/svg)

### Tabla de Contenidos en Línea

Escribe `[TOC]` en una línea propia, o elige **Insertar → Tabla de contenidos**, para insertar una tabla de contenidos dinámica (el elemento de menú no tiene atajo predeterminado; asígnale uno en Configuración → Atajos):

- Generada automáticamente a partir de los encabezados del documento, con el anidamiento correcto
- Haz clic en cualquier encabezado para desplazarte directamente a él
- Se actualiza en tiempo real mientras editas
- Se renderiza en WYSIWYG y en la exportación (HTML/PDF), y hace el recorrido de ida y vuelta con el modo Fuente sin pérdidas

## Genios de IA

Asistencia de escritura con IA integrada impulsada por el proveedor de tu elección:

- 13 genios en cuatro categorías — edición, creativo, estructura y herramientas
- Selector estilo Spotlight con búsqueda y prompts de forma libre (`Mod + Y`)
- Renderizado de sugerencias en línea — aceptar o rechazar con atajos de teclado
- Soporta proveedores CLI (Claude, Codex, Gemini) y APIs REST (Anthropic, OpenAI, Google AI, Ollama)

[Más información →](/es/guide/ai-genies) | [Configurar proveedores →](/es/guide/ai-providers)

## Buscar y Reemplazar

Abre la barra de búsqueda con `Mod + F`. Se abre en la barra de la parte inferior de la ventana y funciona en modos WYSIWYG y Fuente.

**Navegación:**

| Acción | Atajo |
|--------|-------|
| Siguiente coincidencia | `Enter` o `Mod + G` |
| Coincidencia anterior | `Shift + Enter` o `Mod + Shift + G` |
| Usar selección para buscar | `Mod + E` |
| Cerrar barra de búsqueda | `Escape` |

**Opciones de búsqueda** — activa/desactiva mediante botones en la barra de búsqueda:

- **Distinguir mayúsculas** — coincidencia exacta de letras
- **Palabra completa** — coincidencia solo de palabras completas, no subcadenas
- **Expresión regular** — usar patrones regex (activar primero en Configuración)

**Reemplazar:**

El campo de reemplazo está junto al campo de búsqueda — ambos están siempre visibles y `Tab` pasa de uno a otro. Escribe el texto de reemplazo, luego usa **Reemplazar** (una coincidencia) o **Reemplazar Todo** (todas las coincidencias a la vez). El contador de coincidencias muestra la posición actual y el total (ej., "3 de 12") para que siempre sepas dónde estás.

## Lint de Markdown

VMark incluye un linter de Markdown integrado que revisa tu documento en busca de errores de sintaxis comunes y problemas de accesibilidad. Actívalo en **Configuración > Markdown > Lint**.

**Cómo usar:**

| Acción | Atajo |
|--------|-------|
| Ejecutar comprobación lint | `Alt + Mod + V` |
| Ir al siguiente problema | `F2` |
| Ir al problema anterior | `Shift + F2` |

Al ejecutar una comprobación lint, los diagnósticos aparecen como resaltados en línea y marcadores en el margen. Si no se encuentran problemas, una notificación confirma que el documento está limpio. Los problemas se clasifican como errores o advertencias.

**Reglas verificadas (13 en total):**

- Enlaces de referencia no definidos
- Recuento de columnas de tabla no coincidente
- Sintaxis de enlace invertida `(texto)[url]` en lugar de `[texto](url)`
- Espacio faltante después de `#` en encabezados
- Espacios dentro de marcadores de énfasis
- Texto de enlace vacío o URLs de enlace vacías
- Definiciones de enlace/imagen duplicadas
- Definiciones de enlace/imagen no utilizadas
- Incrementos de nivel de encabezado que saltan niveles (ej., H1 a H3)
- Imágenes sin texto alternativo (accesibilidad)
- Bloques de código delimitados sin cerrar
- Enlaces de fragmento rotos (`#ancla` que no coincide con ningún encabezado)

Los resultados del lint no se actualizan mientras escribes. En el modo Fuente, cualquier edición los borra. En el modo WYSIWYG, una edición quita los resaltados, pero el recuento de problemas de la barra de estado y los destinos de `F2` / `Shift + F2` se conservan desde la última ejecución hasta que vuelvas a ejecutar la comprobación o cierres la pestaña. Vuelve a ejecutar la comprobación en cualquier momento con `Alt + Mod + V`.

## Barra de Herramientas Universal

Una barra de herramientas de formato anclada en la parte inferior del editor, que proporciona acceso rápido a todas las acciones de formato tanto en modo WYSIWYG como de Fuente.

- **Alternar:** `Mod + Shift + B` abre la barra de herramientas y le da el foco. Pulsa de nuevo para devolver el foco al editor manteniendo la barra visible.
- **Navegación por teclado:** Usa las flechas `Izquierda`/`Derecha` para moverte entre grupos. `Enter` o `Espacio` abre un menú desplegable. Las flechas navegan dentro de los menús.
- **Escape en dos pasos:** Si un menú desplegable está abierto, `Escape` cierra primero el menú. Pulsa `Escape` de nuevo para cerrar toda la barra de herramientas.
- **Memoria de sesión:** La barra de herramientas recuerda qué botón fue el último enfocado durante la sesión actual, así que al re-enfocar continúas donde lo dejaste.
- **Atajo de Genios de IA:** La barra de herramientas incluye un botón de Genios de IA que abre el selector de genios (`Mod + Y`).

## Menú Contextual del Editor

Haz clic derecho en cualquier lugar del editor (modo WYSIWYG o Fuente) para abrir un menú contextual con acciones comunes.

- **Portapapeles:** Cortar, Copiar, Pegar y Seleccionar todo. En macOS usan el canal nativo del portapapeles, así que pegar contenido enriquecido (p. ej., HTML copiado de un navegador) conserva su formato — igual que `Mod + V`.
- **Formato en línea:** Negrita, Cursiva, Tachado y Código en línea, con marcas de verificación que muestran las marcas activas en el cursor.
- **Operaciones de bloque:** Submenús de nivel de encabezado y de tipo de lista, Cita y Bloque de código — las marcas de verificación reflejan el bloque actual.
- **Enlaces:** Insertar enlace sobre texto normal; sobre un enlace existente la sección cambia a Editar enlace, Copiar enlace y Quitar enlace.
- **Sensible al contexto:** Dentro de las tablas aparece en su lugar el menú de tabla específico; hacer clic derecho en una imagen abre el menú de imagen; dentro de los bloques de código solo se ofrecen las acciones del portapapeles. Los archivos que no son Markdown (JSON, YAML, …) reciben un menú reducido solo con el portapapeles.
- **Gestión de la selección:** Hacer clic derecho dentro de una selección la conserva; hacer clic derecho en otro lugar mueve primero el cursor allí (convención de macOS).
- **Teclado:** Las flechas navegan (los elementos deshabilitados se omiten), `Derecha`/`Izquierda` entran y salen de los submenús, `Escape` cierra primero el submenú y luego el menú. Las indicaciones de atajos reflejan tus asignaciones de teclas personalizadas.

## Paleta de Comandos

Pulsa `Mod + Shift + P` para abrir la paleta de comandos. Con la consulta vacía enumera todos los comandos disponibles agrupados por categoría — archivo, espacio de trabajo, vista, exportación, formato, encabezados, listas, tablas, líneas, selección, transformación, CJK, lint, historial, IA y más; escribe para filtrar y ordenar por coincidencia. `↑`/`↓` se mueven, `Enter` ejecuta el comando, `Escape` (o un clic en el fondo) la cierra. Solo se muestran los comandos que se aplican en ese momento — un comando del editor desaparece cuando no hay ningún documento abierto, y uno del espacio de trabajo cuando no hay espacio de trabajo — y el comando se ejecuta en la ventana desde la que abriste la paleta. Las páginas de esta guía nombran sus comandos de la paleta entre comillas («Alternar vista dividida de Markdown», «Breakdown View», «Estado de ventanas»). La paleta no tiene elemento de menú; su atajo se puede personalizar en **Configuración → Atajos**.

## Opciones de Exportación

VMark ofrece opciones de exportación flexibles para compartir tus documentos.

### Exportación HTML

**Archivo → Exportar → HTML** escribe una carpeta que contiene tanto `index.html` (con una carpeta `assets/` enlazada) como `standalone.html` (todo incrustado) — no hay modo que elegir; usa el archivo que más te convenga.

El HTML exportado incluye el [**VMark Reader**](/es/guide/export#vmark-reader) — controles interactivos para configuración, tabla de contenidos, lightbox de imágenes y más.

[Más información sobre exportación →](/es/guide/export)

### Exportación PDF

**Archivo → Exportar → PDF** abre el propio diálogo de exportación de VMark — tamaño de página (A4, Letter, A3, Legal) y orientación, márgenes predefinidos o un cuadro de márgenes personalizado que se puede arrastrar, tamaño de fuente, interlineado, fuentes latinas y CJK, estilos predefinidos y números de página — y después escribe el PDF en macOS, Windows y Linux, con un esquema de encabezados en el que se puede hacer clic en la barra lateral del visor. **Imprimir** (`Cmd/Ctrl + P`) es la vía aparte a través del diálogo de impresión del sistema. [Más información →](/es/guide/export#imprimir-exportar-pdf)

### Copiar como HTML

Copia el contenido formateado para pegarlo en otras aplicaciones (`Cmd/Ctrl + Shift + C`).

### Formato de Copia

Por defecto, copiar desde WYSIWYG pone texto sin formato en el portapapeles. Activa el formato de copia **Markdown** en **Configuración > Editor > Comportamiento** para poner la sintaxis Markdown en `text/plain` en su lugar — los encabezados conservan su `#`, los enlaces conservan sus URLs, etc. Útil cuando se pega en terminales, editores de código o aplicaciones de chat.

## Formato CJK

Herramientas de formato de texto chino/japonés/coreano integradas:

- Más de 20 reglas de formato configurables
- Espaciado CJK-Inglés
- Conversión de caracteres de ancho completo
- Normalización de puntuación
- Emparejamiento inteligente de comillas con detección de apóstrofes/primas
- Protección de construcciones técnicas (URLs, versiones, horas, decimales)
- Conversión de comillas contextual (tipográficas para CJK, rectas para latín)
- Alternar estilo de comillas en el cursor (`Shift + Mod + '`)
- [Más información →](/es/guide/cjk-formatting)

## Historial de Documentos

VMark guarda automáticamente instantáneas de tus documentos para que puedas recuperar versiones anteriores.

- **Guardado automático** con intervalo configurable captura instantáneas en segundo plano
- **Historial por documento** almacenado localmente en la carpeta de datos de la aplicación de VMark — un archivo de índice más un archivo Markdown por instantánea
- Abre la barra lateral de Historial con `Ctrl + Shift + 3` para explorar versiones anteriores
- Las instantáneas están **agrupadas por día** con marcas de tiempo que muestran la hora exacta de cada versión guardada
- **Restaura** una versión anterior haciendo clic en el botón de restaurar junto a cualquier instantánea (un diálogo de confirmación previene reversiones accidentales)
- **Elimina** instantáneas individuales que ya no necesites con el botón de papelera
- El contenido actual se guarda como nueva instantánea antes de cualquier reversión, así nunca pierdes tu trabajo
- El historial requiere que el documento esté guardado en un archivo (los documentos sin título no tienen historial)
- Activa o desactiva el seguimiento de historial en **Configuración > General**

## Recuperación de Sesión (Hot Exit)

Cuando VMark se reinicia para instalar una actualización, o se cierra inesperadamente, tu trabajo se preserva y se restaura en el siguiente inicio.

**Qué guarda un reinicio por actualización:**
- Todas las pestañas abiertas y su contenido (incluyendo cambios no guardados)
- Posiciones del cursor e historial de deshacer/rehacer
- Disposición de la interfaz: estado de la barra lateral, visibilidad del esquema, modo fuente/enfoque/máquina de escribir, estado del terminal
- Posición y tamaño de la ventana
- Espacio de trabajo activo y configuración del explorador de archivos

**Cómo funciona:**
- Cuando eliges reiniciar e instalar una actualización, VMark captura primero el estado completo de la sesión de todas las ventanas
- Al reiniciar, las pestañas se restauran exactamente como las dejaste, con documentos modificados (no guardados) marcados correspondientemente
- Los cambios no guardados también se escriben en instantáneas de recuperación cada 10 segundos. Tras un cierre inesperado, VMark los restaura en el siguiente inicio como pestañas no guardadas
- Las instantáneas de recuperación con más de 7 días se limpian automáticamente
- Un cierre normal no captura la sesión: VMark te pide primero que guardes los documentos no guardados (consulta [Cerrar pestañas y ventanas](/es/guide/tab-navigation#cerrar-pestanas-y-ventanas)). Aun así, las pestañas abiertas de un espacio de trabajo vuelven la próxima vez que lo abras (consulta [Restauración de Sesión](/es/guide/workspace-management#restauracion-de-sesion))

No se necesita configuración. La recuperación de sesión está siempre activa.

## Barra de Estado

La barra de estado recorre la parte inferior de la ventana (`F7` la oculta). El lado izquierdo contiene la tira de pestañas — consulta [Cambiar entre pestañas abiertas](/es/guide/tab-navigation#cambiar-entre-pestanas-abiertas) — y avisos breves como *«Abierto en modo Fuente (archivo grande).»* El lado derecho, de izquierda a derecha:

| Indicador | Qué muestra | Clic |
|---|---|---|
| Guardado automático | Un icono de guardar y cuánto hace que se guardó automáticamente el documento; se desvanece tras unos segundos | — |
| Recuentos | Palabras y caracteres (sin contar espacios); con una selección, *seleccionado / total* | Abre un panel emergente de **Recuento de palabras**: palabras, caracteres, caracteres sin espacios, caracteres CJK, caracteres sin puntuación |
| Lint | ⊗ errores o ⚠ advertencias encontrados por la última ejecución de [lint](#lint-de-markdown); oculto cuando no hay ninguno | Salta al siguiente problema |
| IA | Mientras se ejecuta un genio, *Pensando...* con los segundos transcurridos y una × para cancelar; después *Listo*, o el error con **Reintentar**, que vuelve a ejecutar la solicitud fallida, y **Descartar**; Reintentar no aparece si no hay nada que repetir, por ejemplo sin proveedor | — |
| MCP | Un icono de satélite, coloreado cuando hay un cliente de IA conectado; la palabra *off*, *…* o *error* cuando no funciona con normalidad. La información emergente nombra los clientes conectados | Abre **Configuración → Integraciones** |
| Historial MCP | Las escrituras de la IA en esta pestaña, de la más reciente a la más antigua, cada una con **Restaurar al estado anterior a esta escritura**; un botón de papelera borra el historial de la pestaña sin preguntar | Abre la lista |
| Terminal | — | Muestra u oculta el terminal |
| Modo | El modo actual — Fuente o WYSIWYG (oculto en los archivos de flujo de trabajo de GitHub Actions) | Cambia de modo |
| Candado | Si el documento es de solo lectura | Alterna solo lectura |

El lado derecho está oculto mientras hay una pestaña del navegador activa. Una barra de estado oculta vuelve a aparecer por sí sola mientras un genio de IA informa de su progreso o hay una pestaña del navegador activa.

## Detalles de Edición

Algunos comportamientos que funcionan sin ningún ajuste:

- **La selección sigue visible cuando el editor pierde el foco.** Haz clic en el terminal, la barra lateral o un popup y el texto seleccionado conserva un resaltado más tenue, para que veas sobre qué actuará un comando o una herramienta de IA. El modo Fuente muestra todos los rangos de una selección multicursor.
- **Escribir en el borde izquierdo de un código en línea escribe dentro de él.** Con el cursor justo antes de un fragmento de código en línea en el modo WYSIWYG — llegues como llegues —, el siguiente carácter se une al código en lugar de quedar fuera.
- **Los métodos de entrada (IME) son seguros.** Mientras compones con un método de entrada chino, japonés o coreano, y durante 50 ms después de terminar la composición, los atajos del editor y las conversiones automáticas no se activan, así que pulsar Enter para aceptar un candidato no divide también el párrafo. Deshacer y rehacer siguen funcionando. Una sílaba coreana confirmada con Enter también inicia la línea nueva. Se elimina la romanización sobrante delante del texto confirmado, y un carácter confirmado en una celda de tabla vacía se queda tal como se escribió. Las notificaciones informativas esperan a que termine la composición; los errores y advertencias se muestran de inmediato. Una edición de un cliente de IA por MCP se rechaza (el cliente vuelve a intentarlo) o se retiene hasta que termina la composición, y un cambio del archivo en disco también espera, así que ninguno sobrescribe el texto que aún estás componiendo.
- **Se respeta el movimiento reducido.** Cuando el ajuste de accesibilidad *reducir movimiento* de tu sistema operativo está activado, VMark desactiva sus animaciones y transiciones y se desplaza al instante en lugar de suavemente (incluido el modo máquina de escribir). No hay un ajuste aparte en VMark. El ajuste del sistema *reducir transparencia* desactiva igualmente el desenfoque de fondo.

## Vista y Enfoque

### Modo Enfoque (`F8`)

El Modo Enfoque atenúa todos los bloques excepto el que estás editando actualmente, reduciendo el ruido visual para que puedas concentrarte en un solo párrafo. El bloque activo se resalta con opacidad completa mientras el contenido circundante se desvanece a un color apagado. Actívalo con `F8` — funciona tanto en modo WYSIWYG como de Fuente y persiste hasta que lo desactives.

### Modo Máquina de Escribir (`F9`)

El Modo Máquina de Escribir mantiene la línea activa centrada verticalmente en la ventana gráfica, de modo que tus ojos permanecen en una posición fija mientras el documento se desplaza debajo de ti — igual que escribir en una máquina de escribir física. Actívalo con `F9`. Funciona en ambos modos de edición y usa desplazamiento suave con un pequeño umbral para evitar ajustes bruscos en movimientos menores del cursor.

### Combinar Enfoque + Máquina de Escribir

El Modo Enfoque y el Modo Máquina de Escribir pueden habilitarse simultáneamente. Juntos proporcionan un entorno de escritura completamente libre de distracciones: los bloques circundantes se atenúan *y* la línea actual permanece centrada en pantalla.

### Ajuste de Línea (`Alt + Z`)

Alterna el ajuste de línea suave con `Alt + Z`. Cuando está habilitado, las líneas largas se ajustan al ancho del editor en lugar de desplazarse horizontalmente. La configuración persiste entre sesiones.

### Modo Solo Lectura (`F10`)

Bloquea un documento para prevenir ediciones accidentales. Alterna con `F10`. Cuando está activo, toda entrada de teclado y comandos de formato se bloquean — puedes seguir desplazándote, seleccionar texto y copiar. Útil para revisar documentos terminados o consultar contenido mientras escribes en otra pestaña.

### Panel de Esquema (`Ctrl + Shift + 1`)

El panel de Esquema muestra la estructura de encabezados de tu documento como un árbol colapsable en la barra lateral. Ábrelo con `Ctrl + Shift + 1`.

- Haz clic en cualquier encabezado para desplazar el editor a esa sección
- Colapsa y expande grupos de encabezados para enfocarte en partes específicas de tu documento
- El encabezado actualmente activo se resalta mientras te desplazas o escribes
- Se actualiza en tiempo real al agregar, eliminar o renombrar encabezados
- Los títulos largos se ajustan a dos líneas y se muestran completos al pasar el puntero
- Un campo de filtro en la parte superior del panel reduce el árbol a los encabezados cuyo texto coincide con tu consulta (sin distinguir mayúsculas y minúsculas; se conservan los ancestros para que la ruta siga visible). Pulsa `Esc` para borrarlo.

### Zoom

Ajusta el tamaño de fuente del editor sin abrir Configuración:

| Acción | Atajo |
|--------|-------|
| Acercar | `Mod + =` |
| Alejar | `Mod + -` |
| Restablecer al valor predeterminado | `Mod + 0` |

El zoom cambia el tamaño de fuente del editor en incrementos de 2px (rango: 12px a 32px). Modifica el mismo valor de tamaño de fuente que se encuentra en **Configuración > Apariencia**, por lo que el zoom por teclado y el deslizador de configuración siempre se mantienen sincronizados.

## Utilidades de Texto

VMark incluye utilidades para limpieza y formato de texto, disponibles en el menú Formato:

### Limpieza de Texto (Formato → Limpiar Texto)

- **Eliminar Espacios Finales**: Elimina el espacio en blanco al final de las líneas
- **Contraer Líneas en Blanco**: Reduce múltiples líneas en blanco a una sola

### Formato CJK (Formato → CJK)

Herramientas de formato de texto chino/japonés/coreano integradas. [Más información →](/es/guide/cjk-formatting)

### Limpieza de Imágenes (Formato → Limpieza de texto → Limpiar imágenes no utilizadas...)

Encuentra y elimina imágenes huérfanas de tu carpeta de recursos (también disponible desde la paleta de comandos). VMark muestra lo que ha encontrado y pide confirmación antes de eliminar, y las imágenes eliminadas van a la papelera del sistema. Se conserva cualquier imagen que siga usando algún documento abierto — incluidos los cambios no guardados en otra ventana de VMark. Si VMark no puede confirmar que una imagen no se usa (por ejemplo, otra ventana no responde a tiempo), no elimina nada.

## Terminal Integrado

Panel de terminal integrado con múltiples sesiones, copiar/pegar, búsqueda, rutas de archivo y URLs clicables, menú contextual, sincronización de temas y configuración de fuente configurable. Actívalo con `` Ctrl + ` ``. [Más información →](/es/guide/terminal)

## Actualización Automática

VMark verifica automáticamente las actualizaciones y puede descargarlas e instalarlas dentro de la aplicación:

- Verificación automática de actualizaciones al iniciar
- Instalación de actualización con un clic
- Vista previa de notas de versión antes de actualizar

## Soporte de Espacio de Trabajo

- Abrir carpetas como espacios de trabajo
- Navegación de árbol de archivos en la barra lateral
- Cambio rápido de archivos
- Seguimiento de archivos recientes
- Tamaño y posición de ventana recordados entre sesiones
- Panel Estado de ventanas — consulta el estado en vivo de Claude Code / IA de cada ventana abierta y salta directamente a la que te necesita; fíjalo en esta ventana o en todas (incluidas las que abras después) para mantenerlo abierto mientras saltas entre ventanas

[Más información →](/es/guide/workspace-management)

## Coherencia, Base de Conocimiento y Slidev

- **Coherencia y vista de desglose** — un seguimiento de procedencia opcional registra qué documentos leyó cada generación de IA, marca los documentos posteriores cuando cambia uno anterior y añade encima comprobaciones semánticas, afirmaciones canónicas y contextos. Ábrelo desde **Ventana → Desglose de coherencia**. [Más información →](/es/guide/coherence)
- **Base de conocimiento** — sirve un espacio de trabajo abierto como un sitio con enlaces cruzados (enlaces wiki, retroenlaces, grafo de relaciones, búsqueda de texto completo) en `127.0.0.1`, en un panel (`Ctrl + Shift + 4`) o en tu navegador, y previsualiza y exporta presentaciones de Slidev. Ninguna versión publicada incluye todavía el entorno de ejecución del servidor de contenido que necesita, por lo que el panel, su elemento de menú, el comando de la paleta y el atajo están ocultos salvo que **Configuración → Avanzado → Herramientas de desarrollo** esté activado. [Más información →](/es/guide/knowledge-base)

## Personalización

### Temas

Seis temas de color integrados:

- Blanco (limpio, minimalista)
- Papel (blanco cálido)
- Menta (tinte verde suave)
- Sepia (aspecto vintage)
- Noche (modo oscuro)
- Solarized (oscuro, paleta Solarized)

### Fuentes

Configura fuentes separadas para:

- Texto latino
- Texto CJK (chino/japonés/coreano)
- Monoespaciado (código)

Cada selector ofrece una lista corta de fuentes recomendadas, las fuentes instaladas en tu ordenador y una entrada **Personalizada…** donde puedes escribir cualquier nombre de familia tipográfica. [Detalles →](/es/guide/settings#tipografia)

La fuente monoespaciada se comprueba antes de usarla, en el modo Fuente, en el código y en el terminal: si la fuente que elegiste no está instalada, o resulta no ser monoespaciada, VMark recurre a la siguiente de la lista que sí lo sea. Esto importa sobre todo en Linux con una configuración regional CJK, donde un nombre de fuente que falta podría resolverse en una fuente CJK proporcional y romper la cuadrícula del terminal.

### Diseño

Ajusta:

- Tamaño de fuente
- Altura de línea
- Espaciado de bloque (espacio entre párrafos y bloques)
- Espaciado de letras CJK (espaciado sutil para legibilidad CJK)
- Ancho del editor
- Tamaño de fuente de elementos de bloque (listas, citas, tablas, alertas)
- Alineación de encabezados (izquierda o centro)
- Alineación de imágenes y tablas (izquierda o centro)

### Atajos de Teclado

Todos los atajos son personalizables en Configuración → Atajos.

## Detalles Técnicos

VMark está construido con tecnología moderna:

| Componente | Tecnología |
|------------|------------|
| Marco de Escritorio | Tauri v2 (Rust) |
| Frontend | React 19, TypeScript |
| Gestión de Estado | Zustand v5 |
| Editor de Texto Enriquecido | Tiptap (ProseMirror) |
| Editor de Fuente | CodeMirror 6 |
| Estilos | Tailwind CSS v4 |

Todo el procesamiento ocurre localmente en tu máquina — sin servicios en la nube, sin cuentas requeridas.
