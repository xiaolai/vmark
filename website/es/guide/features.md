# Características

VMark es un editor Markdown con muchas funciones diseñado para flujos de trabajo de escritura modernos. Aquí tienes lo que incluye.

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
- Pegado de imágenes del portapapeles — las capturas de pantalla e imágenes copiadas se guardan en la carpeta de recursos y se insertan como `![](ruta)`
- Multicursor compatible con bloques de código y soporte de límites de palabras CJK
- Perfecto para usuarios avanzados

Alterna entre modos con `F6`.

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

Toda la edición estándar (escritura, eliminación, portapapeles, navegación) funciona en cada cursor de forma independiente. Con alcance de bloque por defecto para evitar ediciones no deseadas en diferentes secciones.

[Más información →](/es/guide/multi-cursor)

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
| Ordenar Líneas Ascendente | `F4` |
| Ordenar Líneas Descendente | `Shift + F4` |

## Tablas

Edición de tablas con todas las funciones:

- Insertar tablas a través del menú o atajo
- Añadir/eliminar filas y columnas
- Alineación de celdas (izquierda, centro, derecha)
- Redimensionar columnas arrastrando
- Barra de herramientas contextual para acciones rápidas
- Navegación por teclado (Tab, flechas, Enter)

## Imágenes

Soporte integral de imágenes:

- Insertar a través del diálogo de archivos
- Arrastrar y soltar desde el sistema de archivos
- Pegar desde el portapapeles
- Copia automática a la carpeta de recursos del proyecto
- Redimensionar a través del menú contextual
- Doble clic para editar la ruta de origen, texto alternativo y dimensiones
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
- Matemáticas en bloque: `$$...$$`
- Soporte completo de sintaxis LaTeX
- Mensajes de error útiles con sugerencias de sintaxis

### Diagramas

Soporte de diagramas Mermaid con vista previa en vivo:

- Diagramas de flujo, secuencia, Gantt
- Diagramas de clases, estados, ER
- Panel de vista previa en vivo en modo Fuente (arrastrar, redimensionar, zoom)
- [Más información →](/es/guide/mermaid)

### Gráficos SVG

Renderiza SVG sin procesar en línea mediante bloques de código ` ```svg `:

- Renderizado instantáneo con desplazamiento, zoom y exportación PNG
- Vista previa en vivo en modos WYSIWYG y Fuente
- Ideal para gráficos generados por IA e ilustraciones personalizadas
- [Más información →](/es/guide/svg)

## Genios de IA

Asistencia de escritura con IA integrada impulsada por el proveedor de tu elección:

- 13 genios en cuatro categorías — edición, creativo, estructura y herramientas
- Selector estilo Spotlight con búsqueda y prompts de forma libre (`Mod + Y`)
- Renderizado de sugerencias en línea — aceptar o rechazar con atajos de teclado
- Soporta proveedores CLI (Claude, Codex, Gemini) y APIs REST (Anthropic, OpenAI, Google AI, Ollama)

[Más información →](/es/guide/ai-genies) | [Configurar proveedores →](/es/guide/ai-providers)

## Buscar y Reemplazar

Abre la barra de búsqueda con `Mod + F`. Aparece en línea en la parte superior del área del editor y funciona en modos WYSIWYG y Fuente.

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

Haz clic en el chevron de expansión en la barra de búsqueda para revelar la fila de reemplazo. Escribe el texto de reemplazo, luego usa **Reemplazar** (una coincidencia) o **Reemplazar Todo** (todas las coincidencias a la vez). El contador de coincidencias muestra la posición actual y el total (ej., "3 de 12") para que siempre sepas dónde estás.

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

Los resultados del lint son efímeros y se eliminan cuando editas el documento. Vuelve a ejecutar la comprobación en cualquier momento con `Alt + Mod + V`.

## Barra de Herramientas Universal

Una barra de herramientas de formato anclada en la parte inferior del editor, que proporciona acceso rápido a todas las acciones de formato tanto en modo WYSIWYG como de Fuente.

- **Alternar:** `Mod + Shift + P` abre la barra de herramientas y le da el foco. Pulsa de nuevo para devolver el foco al editor manteniendo la barra visible.
- **Navegación por teclado:** Usa las flechas `Izquierda`/`Derecha` para moverte entre grupos. `Enter` o `Espacio` abre un menú desplegable. Las flechas navegan dentro de los menús.
- **Escape en dos pasos:** Si un menú desplegable está abierto, `Escape` cierra primero el menú. Pulsa `Escape` de nuevo para cerrar toda la barra de herramientas.
- **Memoria de sesión:** La barra de herramientas recuerda qué botón fue el último enfocado durante la sesión actual, así que al re-enfocar continúas donde lo dejaste.
- **Atajo de Genios de IA:** La barra de herramientas incluye un botón de Genios de IA que abre el selector de genios (`Mod + Y`).

## Opciones de Exportación

VMark ofrece opciones de exportación flexibles para compartir tus documentos.

### Exportación HTML

Exporta a HTML independiente con dos modos de empaquetado:

- **Modo carpeta** (predeterminado): Crea `Documento/index.html` con recursos en una subcarpeta
- **Modo archivo único**: Crea un archivo `.html` autocontenido con imágenes embebidas

El HTML exportado incluye el [**VMark Reader**](/es/guide/export#vmark-reader) — controles interactivos para configuración, tabla de contenidos, lightbox de imágenes y más.

[Más información sobre exportación →](/es/guide/export)

### Exportación PDF

Imprime a PDF con el diálogo nativo del sistema (`Cmd/Ctrl + P`).

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
- **Historial por documento** almacenado localmente en formato JSONL
- Abre la barra lateral de Historial con `Ctrl + Shift + 3` para explorar versiones anteriores
- Las instantáneas están **agrupadas por día** con marcas de tiempo que muestran la hora exacta de cada versión guardada
- **Restaura** una versión anterior haciendo clic en el botón de restaurar junto a cualquier instantánea (un diálogo de confirmación previene reversiones accidentales)
- **Elimina** instantáneas individuales que ya no necesites con el botón de papelera
- El contenido actual se guarda como nueva instantánea antes de cualquier reversión, así nunca pierdes tu trabajo
- El historial requiere que el documento esté guardado en un archivo (los documentos sin título no tienen historial)
- Activa o desactiva el seguimiento de historial en **Configuración > General**

## Recuperación de Sesión (Hot Exit)

Cuando cierras VMark o sale inesperadamente, tu sesión se preserva y restaura en el siguiente inicio.

**Qué se guarda:**
- Todas las pestañas abiertas y su contenido (incluyendo cambios no guardados)
- Posiciones del cursor e historial de deshacer/rehacer
- Disposición de la interfaz: estado de la barra lateral, visibilidad del esquema, modo fuente/enfoque/máquina de escribir, estado del terminal
- Posición y tamaño de la ventana
- Espacio de trabajo activo y configuración del explorador de archivos

**Cómo funciona:**
- Al cerrar, VMark captura el estado completo de la sesión de todas las ventanas
- Al reiniciar, las pestañas se restauran exactamente como las dejaste, con documentos modificados (no guardados) marcados correspondientemente
- La recuperación por caída se ejecuta automáticamente tras una salida inesperada, restaurando documentos desde instantáneas de recuperación periódicas
- Las instantáneas de recuperación con más de 7 días se limpian automáticamente

No se necesita configuración. La recuperación de sesión está siempre activa.

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

### Limpieza de Imágenes (Archivo → Limpiar Imágenes No Utilizadas)

Encuentra y elimina imágenes huérfanas de tu carpeta de recursos.

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

[Más información →](/es/guide/workspace-management)

## Personalización

### Temas

Cinco temas de color integrados:

- Blanco (limpio, minimalista)
- Papel (blanco cálido)
- Menta (tinte verde suave)
- Sepia (aspecto vintage)
- Noche (modo oscuro)

### Fuentes

Configura fuentes separadas para:

- Texto latino
- Texto CJK (chino/japonés/coreano)
- Monoespaciado (código)

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
