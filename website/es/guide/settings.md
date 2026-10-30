# Configuración

El panel de configuración de VMark te permite personalizar todos los aspectos del editor. Ábrelo con `Mod + ,` o a través de **VMark > Configuración** en la barra de menú.

La ventana de configuración tiene una barra lateral que enumera las secciones en orden alfabético (según sus nombres en inglés), con Acerca de al final y Avanzado debajo cuando está visible. Los cambios surten efecto inmediatamente — no hay botón de guardar.

Usa el **cuadro de búsqueda** de la parte superior de la barra lateral para filtrar los ajustes de todos los paneles por nombre o descripción — las filas coincidentes se agrupan, así que no necesitas saber en qué categoría está un ajuste. Para restaurar todo a los valores de fábrica, usa **Restablecer a los valores predeterminados** en la sección Acerca de.

## Apariencia

Controla el tema visual y el comportamiento de la ventana.

### Tema

Elige entre seis temas de color. El tema activo se indica con un anillo alrededor de su muestra.

| Tema | Fondo | Estilo |
|------|-------|--------|
| White | `#FFFFFF` | Blanco limpio, el mayor contraste |
| Paper | `#EEEDED` | Papel de periódico cálido, el predeterminado |
| Mint | `#CCE6D0` | Verde suave, agradable para la vista |
| Sepia | `#F9F0DB` | Papel de libro, para lecturas largas |
| Night | `#23262B` | Pizarra oscura para poca luz |
| Solarized | `#002B36` | Solarized Dark, la paleta clásica |

::: info Windows 10 y Linux solo ofrecen White y Night
En Windows 10 y Linux el sistema dibuja la barra de título, y solo puede ser clara u oscura. Por eso esas plataformas ofrecen únicamente **White** y **Night**, y un tema que no puede coincidir con el marco del sistema se muestra como el más cercano de los dos: Paper, Mint y Sepia se muestran como White, Solarized como Night. Tu elección guardada no cambia — en macOS y Windows 11 está disponible el catálogo completo. En Windows 11 la barra de título adopta los colores del propio tema; la barra de menús se sigue dibujando clara u oscura.
:::

#### Seguir la apariencia del sistema

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Seguir la apariencia del sistema | Cambia automáticamente entre tus temas claro y oscuro según el sistema | Desactivado |

Cuando está activado, la fila única de tema se sustituye por dos filas — **Tema claro** (usado mientras el sistema está en modo claro, Paper por defecto) y **Tema oscuro** (usado en modo oscuro, Night por defecto). VMark cambia entre ellos en cuanto cambia la apariencia del sistema; tu elección manual de tema se conserva y se restaura al desactivar la opción.

### Barra lateral

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Estilo de la barra lateral | Cómo se enmarcan la barra lateral y el riel de espacios de trabajo. **Altura completa** los coloca junto al borde de la ventana con una fina línea divisoria, como las barras laterales de macOS; **Tarjeta** los hace flotar dentro de la ventana con esquinas redondeadas y sombra. También se aplica a la ventana de Ajustes | Altura completa | Altura completa, Tarjeta |

### Ventana

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Mostrar nombre de archivo en la barra de título | Muestra el nombre del archivo actual en la barra de título de la ventana de macOS. **Solo macOS** — este ajuste está oculto en las demás plataformas, porque Windows y Linux siempre muestran el nombre de archivo en la barra de título del sistema | Desactivado |

En macOS, VMark dibuja su propia barra de título sobre la del sistema, así que el
nombre de archivo es un elemento opcional de esa franja. En Windows y Linux el
sistema dibuja una barra de título real encima de la ventana: el nombre de
archivo (con un `•` mientras haya cambios sin guardar) siempre aparece allí, y
VMark no añade ninguna franja de título propia.

### Modo Enfoque

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Nivel de atenuación | Con qué intensidad se atenúa el contenido no enfocado en el Modo enfoque. **Estándar** mantiene la atenuación predeterminada solo por color; **Fuerte** y **Más fuerte** añaden además una opacidad progresivamente menor | Estándar | Estándar, Fuerte, Más fuerte |

## Editor

Tipografía, visualización, comportamiento de edición, espacios en blanco y archivos grandes.

### Tipografía

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Fuente Latina | Familia tipográfica para texto latino (inglés) | System Default | System Default, Athelas, Palatino, Georgia, Charter, Literata — además de cualquier fuente instalada |
| Fuente CJK | Familia tipográfica para texto en chino, japonés y coreano | System Default | System Default, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans — además de cualquier fuente instalada |
| Fuente Mono | Familia tipográfica para código y texto monoespaciado — también la usa el terminal integrado | System Default | System Default, SF Mono, Monaco, Menlo, Consolas, DejaVu Sans Mono, Liberation Mono, Ubuntu Mono, Noto Sans Mono, Noto Sans Mono CJK SC, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata — además de cualquier fuente instalada |
| Tamaño de Fuente | Tamaño de fuente base para el contenido del editor | 18px | 14px, 16px, 18px, 20px, 22px |
| Altura de Línea | Espaciado vertical entre líneas | 1.8 (Relajado) | 1.4 (Compacto), 1.6 (Normal), 1.8 (Relajado), 2.0 (Espacioso), 2.2 (Extra) |
| Espaciado de Bloque | Espacio visual entre elementos de bloque (encabezados, párrafos, listas) medido en múltiplos de la altura de línea | 1x (Normal) | 0.5x (Ajustado), 1x (Normal), 1.5x (Relajado), 2x (Espacioso) |
| Espaciado de Caracteres CJK | Espaciado adicional entre caracteres CJK, en unidades em | Desactivado | Desactivado, 0.02em (Sutil), 0.03em (Ligero), 0.05em (Normal), 0.08em (Amplio), 0.10em (Más Amplio), 0.12em (Extra) |

#### Usar una fuente que instalaste tú

Los nombres de la lista anterior son una selección, no el límite. Cada uno de
los tres selectores de fuente incluye también una sección **Fuentes instaladas**
que enumera todas las familias tipográficas del equipo, así que una fuente que
instalaste — LXGW WenKai, Iosevka, Source Han Serif — se elige igual que las
integradas.

Elige **Personalizada…** al final de la lista para escribir en su lugar un
nombre de familia. Usa el nombre exactamente como lo informa el sistema (macOS:
Catálogo Tipográfico; Windows: Configuración → Personalización → Fuentes) — para
LXGW WenKai / 霞鹜文楷 es `LXGW WenKai`. La fuente se aplica en cuanto el nombre
está completo; si no cambia nada, el nombre no coincide con ninguna familia
instalada. Un nombre que contenga comillas, comas, puntos y coma o paréntesis se
rechaza, y la fila lo indica.

::: tip Fuentes instaladas es exclusivo de macOS
macOS enumera por ti todas las familias instaladas. En Windows y Linux la
sección está vacía y **Personalizada…** es la vía de acceso — escribir el nombre
de la familia funciona igual en las tres plataformas.
:::

La elección se traslada a la exportación PDF, que renderiza con el mismo motor y
las mismas fuentes. La exportación HTML no puede incluir una fuente de tu
equipo, así que una página exportada recurre a las fuentes del lector, salvo que
tenga instalada la misma familia.

### Visualización

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Ancho del Editor | Ancho máximo del contenido. Los valores más amplios se adaptan a monitores grandes; los más estrechos mejoran la legibilidad | 50em (Medio) | 36em (Compacto), 42em (Estrecho), 50em (Medio), 60em (Amplio), 80em (Extra Amplio), Ilimitado |

::: tip El mismo ancho se lee distinto en latín y en CJK
El Ancho del Editor se mide en `em`, así que la longitud de línea en *caracteres* depende de la escritura: a 50em una línea latina contiene unos 90–100 caracteres (unas 2× la medida tipográfica de 45–75 caracteres, adecuada para un editor de dos paneles), mientras que una línea CJK contiene unos 50 caracteres de ancho completo — justo en el rango tradicional de 40–60 para el texto chino. Si escribes sobre todo prosa latina y quieres una medida de libro, elige 36–42em; para documentos mayoritariamente CJK el valor predeterminado ya es la medida clásica.
:::

::: tip
50em con un tamaño de fuente de 18px equivale aproximadamente a 900px — un ancho de lectura cómodo para la mayoría de las pantallas.
:::

### Comportamiento

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Tamaño de tabulación | Número de espacios insertados al presionar Tab | 2 espacios | 2 espacios, 4 espacios |
| Abrir archivos en una pestaña nueva | Abre los archivos existentes en una pestaña nueva en lugar de reutilizar la pestaña vacía actual | Desactivado | Activado / Desactivado |
| Habilitar emparejamiento automático | Inserta automáticamente los corchetes y comillas de cierre correspondientes al escribir uno de apertura | Activado | Activado / Desactivado |
| Corchetes CJK | Empareja automáticamente corchetes específicos de CJK como `「」` `【】` `《》`. Solo disponible cuando el emparejamiento automático está habilitado | Auto | Desactivado, Auto |
| Incluir comillas curvas | Empareja automáticamente `“”` y `‘’`, y convierte una `"` o `'` recta escrita en un par curvo. Puede entrar en conflicto con algunas funciones de comillas inteligentes del IME. Aparece cuando los corchetes CJK están en Auto | Activado | Activado / Desactivado |
| También emparejar `"` | Al escribir la comilla doble de cierre `"` también inserta un par `""`. Útil cuando tu IME alterna entre comillas de apertura y cierre. Aparece cuando las comillas curvas están habilitadas | Desactivado | Activado / Desactivado |
| Formato de copia | Qué formato usar para el portapapeles de texto sin formato al copiar desde el modo WYSIWYG | Texto sin formato | Texto sin formato, Markdown |
| Copiar al seleccionar | Copia automáticamente el texto al portapapeles cuando lo seleccionas | Desactivado | Activado / Desactivado |

### Espacios en Blanco

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Fin de línea al guardar | Controla cómo se gestionan los finales de línea al guardar archivos | Conservar existente | Conservar existente, LF (`\n`), CRLF (`\r\n`) |
| Los saltos de línea se convierten en saltos forzados | Trata los saltos de línea simples dentro de un párrafo como saltos forzados (no afecta a las líneas en blanco entre bloques) | Desactivado | Activado / Desactivado |
| Conservar saltos de línea consecutivos | Mantener múltiples líneas en blanco tal como están en lugar de colapsarlas | Activado | Activado / Desactivado |
| Estilo de salto de línea forzado al guardar | Cómo se representan los saltos de línea forzados en el archivo Markdown guardado | Conservar existente | Dos espacios (Recomendado), Conservar existente, Barra invertida (`\`) |
| Mostrar etiquetas `<br>` | Muestra visiblemente las etiquetas de salto de línea HTML en el editor | Desactivado | Activado / Desactivado |
| Mostrar invisibles | Visualiza los espacios en blanco: espacios como `·`, tabuladores como `→` (solo Fuente), saltos de línea blandos como `↓` (solo Fuente), saltos de línea forzados como `⏎`. Oculto al imprimir. Alternar: `F3` o Vista → Mostrar invisibles. | Desactivado | Activado / Desactivado |

::: tip
Dos espacios es el estilo de salto de línea forzado más compatible — funciona en GitHub, GitLab y todos los principales renderizadores de Markdown. El estilo de barra invertida puede fallar en Reddit, Jekyll y algunos analizadores más antiguos.
:::

### Archivos Grandes

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Modo Fuente automático | Abre los archivos grandes en modo Fuente — archivos de más de 1 MB o markdown con 1.200+ bloques estimados (omite WYSIWYG para mantener un rendimiento fluido). Puedes cambiar a WYSIWYG desde la barra de estado en cualquier momento | Activado | Activado / Desactivado |
| Avisar por encima del tamaño | Mostrar un aviso de confirmación antes de abrir archivos de más de 5 MB. Los archivos de 50 MB o más siempre se rechazan | Activado | Activado / Desactivado |

Consulta [Archivos Grandes](/es/guide/large-files) para el desglose completo de cómo se manejan los archivos grandes.

## Markdown

Comportamiento de pegado, diseño y configuración de renderizado HTML.

### Pegar e Ingresar

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Habilitar regex en la búsqueda | Muestra un botón de alternancia de regex en la barra de Buscar y Reemplazar | Activado | Activado / Desactivado |
| Modo de pegado | Cómo se procesa el contenido del portapapeles al pegar. **Inteligente** convierte HTML en Markdown y detecta la sintaxis Markdown; **Texto plano** pega siempre texto sin formato; **Enriquecido** conserva el formato HTML original | Inteligente | Inteligente, Texto plano, Enriquecido |
| Pegado Markdown en WYSIWYG | Al pegar texto que parece Markdown en el editor WYSIWYG, convertirlo automáticamente en contenido enriquecido | Auto | Auto, Desactivado |

### Diseño

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Dividir fuente/vista previa por defecto | Abre los archivos Markdown en la vista dividida con la fuente y una vista previa en vivo en paralelo (de lo contrario, en WYSIWYG). Alterna por sesión con `Shift + F6` o **Vista → Vista dividida de Markdown** | Desactivado | Activado / Desactivado |
| Tamaño de fuente de elementos de bloque | Tamaño de fuente relativo para listas, citas, tablas, alertas y bloques de detalles | 100% | 100%, 95%, 90%, 85% |
| Alineación de encabezados | Alineación de texto para los encabezados. Solo en el editor — no se aplica a la exportación ni a la impresión | Izquierda | Izquierda, Centro |
| Bordes de imágenes y diagramas | Si mostrar un borde alrededor de imágenes, diagramas Mermaid y bloques matemáticos. Solo en el editor — no se aplica a la exportación ni a la impresión | Ninguno | Ninguno, Siempre, Al pasar el ratón |
| Alineación de imágenes y tablas | Alineación horizontal para imágenes de bloque y tablas. Solo en el editor — no se aplica a la exportación ni a la impresión | Centro | Centro, Izquierda |
| Ajustar tablas al ancho | Restringe todas las tablas al ancho del editor en lugar de permitir el desplazamiento horizontal | Desactivado | Activado / Desactivado |
| Números de línea en bloques de código | Muestra números de línea dentro de los bloques de código en el editor WYSIWYG. Independiente de **Números de línea** del menú Vista, que controla el margen del editor Fuente/Dividido | Desactivado | Activado / Desactivado |

### Lint

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Habilitar markdown lint | Verificar problemas comunes de markdown (enlaces rotos, texto alt faltante, incrementos de encabezados, bloques de código no cerrados, etc.) | Activado | Activado / Desactivado |

Consulta [Lint de Markdown](/es/guide/lint) para la lista completa de reglas y niveles de severidad.

### Renderizado HTML

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| HTML sin formato en texto enriquecido | Controla si los bloques HTML sin formato se renderizan en el modo WYSIWYG | Saneado | Oculto, Saneado, Saneado + estilos |
| Etiquetas HTML permitidas | Qué tan amplio es el conjunto de etiquetas renderizadas | Estricto | Estricto, Ampliado |
| Permitir también estas etiquetas | Nombres de etiquetas adicionales permitidas, separados por comas | _(vacío)_ | p. ej. `kbd, samp, var` |

::: tip
**Oculto** colapsa el HTML sin formato y no renderiza nada. **Saneado** renderiza HTML con las etiquetas peligrosas eliminadas. **Saneado + estilos** además conserva un subconjunto seguro de atributos `style` en línea.

**Estricto** permite un conjunto de etiquetas pequeño y conservador. **Ampliado** además renderiza `<svg>` (y sus elementos hijos seguros), `<figure>`/`<figcaption>`, `<details>`/`<summary>` y otras etiquetas semánticas/estructurales — todas igualmente saneadas. Usa **Permitir también estas etiquetas** para añadir extras concretos por encima (p. ej. `kbd, samp, var`).
:::

::: warning
Independientemente de estos ajustes, las etiquetas peligrosas (`<script>`, `<style>`, `<iframe>`, `<form>`, controladores de eventos, …) se eliminan **siempre** — el campo de etiquetas personalizadas no puede volver a habilitarlas. La amplitud de la lista de permitidos solo afecta a la vista previa WYSIWYG; el HTML sin formato de tu archivo nunca se modifica.
:::

## Archivos e Imágenes

Explorador de archivos, guardado, historial de documentos, manejo de imágenes y herramientas de documentos.

### Espacio de trabajo

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Barra de espacios de trabajo | Muestra la barra de espacios de trabajo a la izquierda y mantiene varios espacios de trabajo y archivos sueltos en una sola ventana | Desactivado |

Consulta [Barra de espacios de trabajo](/es/guide/workspace-rail) para ver lo que añade la barra.

### Explorador de Archivos

Los dos primeros ajustes solo se aplican cuando hay un espacio de trabajo (carpeta) abierto, y se guardan
por espacio de trabajo.

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Mostrar archivos ocultos | Incluye archivos de puntos y elementos del sistema ocultos en la barra lateral del explorador de archivos | Desactivado |
| Mostrar todos los archivos | Muestra archivos que no son markdown en el explorador de archivos. Los archivos que no son markdown se abren con la aplicación predeterminada del sistema | Desactivado |
| Mostrar extensiones de archivo | Muestra el nombre de archivo completo — `notes.md`, no `notes` — en la barra lateral, la barra de pestañas y la barra de título. Se aplica en todas partes, haya o no espacio de trabajo | Activado |

Desactivar **Mostrar extensiones de archivo** oculta solo las extensiones que VMark reconoce. Un archivo
que no puede abrir conserva su sufijo en cualquier caso, así que el nombre que ves siempre existe en disco.

### Comportamiento al Salir

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Confirmar al salir | Requiere presionar `Cmd+Q` (o `Ctrl+Q`) dos veces para salir, evitando salidas accidentales | Activado |
| Minimizar a la bandeja al cerrar | **Solo Windows.** Al cerrar la última ventana, VMark sigue ejecutándose en la bandeja del sistema en lugar de salir | Desactivado |

**Minimizar a la bandeja al cerrar** solo cambia la *última* ventana. Con varias ventanas abiertas, cerrar una sigue cerrándola; es el cierre final — el que antes hacía salir de VMark — el que ahora lo deja en la bandeja. No se cierra nada, así que el trabajo sin guardar se queda exactamente donde lo dejaste.

- **Haz clic izquierdo** en el icono de la bandeja para recuperar VMark.
- **Haz clic derecho** para ver **Mostrar VMark** y **Salir de VMark**. Salir desde la bandeja trae primero la ventana de vuelta, para que cualquier aviso de cambios sin guardar aparezca donde puedas responderlo.
- `Ctrl+Q` sigue saliendo como siempre.
- Desactivar el ajuste mientras VMark está en la bandeja trae la ventana de vuelta antes de que desaparezca el icono, así que nunca puede dejar VMark en ejecución sin ventana y sin icono.

El ajuste no aparece en macOS ni en Linux.

### Guardado

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Habilitar guardado automático | Guarda automáticamente los archivos después de editar | Activado | Activado / Desactivado |
| Insertar bloque de identidad al guardar | Permite que VMark inserte un bloque de identidad `vmark:` en el frontmatter de un archivo y cree una carpeta `.vmark` en el espacio de trabajo, para que la capa de coherencia pueda seguir el documento. Se aplica a toda escritura: guardados, ediciones de IA y MCP, restauraciones de versiones anteriores y archivos nuevos. Si está desactivado, no se inserta nada ni se crea ninguna carpeta `.vmark`; un espacio de trabajo que ya tenga una sigue registrando los cambios de los documentos que sigue — uno que ya ha registrado antes, o uno que ya lleva su propia identidad `vmark:`, como un archivo con seguimiento que moviste o que trajiste con un checkout de git. Consulta [Coherencia](/es/guide/coherence#como-funciona-30-segundos) | Desactivado | Activado / Desactivado |
| Intervalo de guardado | Tiempo entre guardados automáticos. Solo disponible cuando el guardado automático está habilitado | 30 segundos | 10s, 30s, 1 min, 2 min, 5 min |
| Conservar historial del documento | Rastrea las versiones del documento para deshacer y recuperación | Activado | Activado / Desactivado |
| Versiones máximas | Número de instantáneas del historial a conservar por documento | 50 versiones | 10, 25, 50, 100 |
| Conservar versiones durante | Antigüedad máxima de las instantáneas del historial antes de ser eliminadas | 7 días | 1 día, 7 días, 14 días, 30 días |
| Ventana de fusión | Los guardados automáticos consecutivos dentro de esta ventana se consolidan en una única instantánea, reduciendo el ruido de almacenamiento | 30 segundos | Desactivado, 10s, 30s, 1 min, 2 min |
| Tamaño máximo de archivo para el historial | Omite las instantáneas del historial del autoguardado para archivos más grandes que este umbral. Los guardados manuales, los guardados por MCP y la copia de seguridad que se toma antes de restaurar una versión se conservan siempre | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Ilimitado |

### Imágenes

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Redimensionar automáticamente al pegar | Redimensiona automáticamente las imágenes grandes antes de guardarlas en la carpeta de recursos. El valor es la dimensión máxima en píxeles | Desactivado | Desactivado, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copiar a la carpeta de recursos | Copia las imágenes pegadas o arrastradas a la carpeta de recursos del documento en lugar de incrustarlas | Activado | Activado / Desactivado |
| Limpiar imágenes no usadas al cerrar | Elimina automáticamente las imágenes de la carpeta de recursos que el documento ya no referencia. Se ejecuta al cerrar el documento, la ventana o la aplicación. Las imágenes aún referenciadas por otro documento de la misma carpeta se conservan, y las eliminadas van a la papelera del sistema | Desactivado | Activado / Desactivado |

::: tip
Habilita **Redimensionar automáticamente al pegar** si con frecuencia pegas capturas de pantalla o fotos — mantiene ligera tu carpeta de recursos sin necesidad de redimensionar manualmente.
:::

### Herramientas de Documentos

VMark detecta [Pandoc](https://pandoc.org) para habilitar la exportación a formatos adicionales (DOCX, EPUB, LaTeX y más). Haz clic en **Detectar** para buscar Pandoc en tu sistema. Si se encuentra, se muestran su versión y ruta.

Consulta [Exportar e Imprimir](/es/guide/export) para más detalles sobre todas las opciones de exportación.

## Integraciones

Configuración del servidor MCP y del proveedor de IA.

### Servidor MCP

El servidor MCP (Model Context Protocol) permite que los asistentes de IA externos como Claude Code y Cursor controlen VMark de forma programática.

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Activar servidor MCP | Inicia o detiene el servidor MCP. Cuando está en ejecución, una insignia de estado muestra el puerto y los clientes conectados | Activado (alternador) |
| Iniciar al arrancar | Inicia automáticamente el servidor MCP cuando se abre VMark | Activado |
| Aprobar automáticamente guardados en una ubicación nueva y resultados de genios | Permite que un cliente MCP guarde un documento en una ubicación nueva sin preguntar, y que un genio aplique su resultado directamente en lugar de mostrar una vista previa. Cuando está desactivado, una solicitud MCP de guardar en una ruta nueva se rechaza y una notificación te avisa. Las escrituras de documentos por MCP nunca dependen de esto — cada una se registra en el historial de ediciones de agentes y puede restaurarse desde el historial de escrituras MCP de la barra de estado | Desactivado |

Cuando el servidor está en ejecución, el panel también muestra:
- **Puerto** — asignado automáticamente; los clientes de IA lo descubren a través del archivo de configuración
- **Versión** — versión del servidor lateral MCP
- **Herramientas / Recursos** — número de herramientas y recursos MCP disponibles
- **Clientes Conectados** — número de clientes de IA actualmente conectados

Debajo de la sección del Servidor MCP, puedes instalar la configuración MCP de VMark en los clientes de IA compatibles (Claude Desktop, Claude Code, Codex CLI, Gemini CLI) con un solo clic.

Consulta [Configuración de MCP](/es/guide/mcp-setup) y [Referencia de Herramientas MCP](/es/guide/mcp-tools) para más detalles.

### Proveedores de IA

Configura qué proveedor de IA impulsa los [Genios de IA](/es/guide/ai-genies). Solo puede haber un proveedor activo a la vez.

**Proveedores CLI** — Usa herramientas CLI de IA instaladas localmente (Claude, Codex, Gemini). Haz clic en **Detectar** para buscar en tu `$PATH` las CLIs disponibles. Los proveedores CLI usan tu plan de suscripción y no requieren clave API.

**Proveedores de API REST** — Conéctate directamente a una API: Anthropic, OpenAI, un servicio **compatible con OpenAI** (DeepSeek, Groq, OpenRouter, …), Google AI o un servidor local de Ollama (Ollama API). Cada uno necesita un nombre de modelo y una clave API — excepto Ollama, donde la clave es opcional. Todos salvo Google AI usan además un endpoint, ya rellenado cuando el proveedor tiene uno estándar (la opción compatible con OpenAI no lo tiene, así que lo introduces tú).

Consulta [Proveedores de IA](/es/guide/ai-providers) para instrucciones de configuración detalladas de cada proveedor.

## Formatos

Alternadores de inclusión voluntaria para los adaptadores de formato no predeterminados, más el comando explícito de editor externo para el escape del visor de código de solo lectura.

Markdown, texto plano y YAML/YML están **siempre** registrados — los valores predeterminados tranquilos. Todos los demás adaptadores están **desactivados por defecto** para que los usuarios existentes no se lleven sorpresas al actualizar. Cambia un alternador y el registro se reconstruye en el lugar; las pestañas abiertas se remontan con el adaptador adecuado, sin necesidad de reiniciar.

Para la lista completa de formatos y sus vistas previas, consulta [Formatos Compatibles](/es/guide/formats).

### Compatibilidad de formatos

| Alternador | Predeterminado | Activa |
|---|---|---|
| **Formatos de datos** | Desactivado | `.json`, `.jsonl`, `.toml` — panel dividido: fuente + árbol navegable. Vistas previas con conocimiento de esquema para `Cargo.toml`, `package.json`, `pyproject.toml`. |
| **Diagramas y SVG** | Desactivado | `.mmd` (Mermaid) y `.svg` — panel dividido: fuente + renderizado en vivo saneado. |
| **Vista previa HTML** | Desactivado | `.html` y `.htm` — vista previa en iframe en zona de pruebas (`sandbox=""` lista de permisos vacía, DOMPurify, CSP `<meta>`). Su aprobación de seguridad sigue pendiente, y la vista previa lo indica — consulta [Modelo de seguridad para HTML](/es/guide/formats#modelo-de-seguridad-para-html). |
| **Visores de código** | Desactivado | 12 visores de solo lectura (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Se abren en un visor con resaltado de sintaxis y botones **Habilitar edición** y **Abrir en editor externo**. |

Cuando una categoría está desactivada, las extensiones correspondientes pasan al modo de texto plano de reserva, de modo que el archivo sigue abriéndose — solo sin la vista de esquema.

### Modo de vista predeterminado

Los archivos con vista previa (HTML, SVG, Mermaid, JSON, YAML, TOML) se abren en uno de tres
[modos de vista](/es/guide/formats#modos-de-vista-fuente-dividido-vista-previa):

| Opción | Resultado |
|---|---|
| **Fuente** | Panel de código fuente editable, a ancho completo. |
| **Dividido** (predeterminado) | Código fuente y vista previa en paralelo. |
| **Vista previa** | Representación de solo lectura, a ancho completo. |

Es el valor predeterminado para las pestañas recién abiertas; cada pestaña recuerda su propia elección, y
puedes cambiar cualquier pestaña con el conmutador en pantalla o `F6` / `Shift + F6`.

### Editor externo

Para el botón **Abrir en editor externo** de las pestañas de código de solo lectura, elige el editor que debe lanzarse: el nombre de un editor conocido (`code`, `zed`, `subl`, `vim`, …) o la ruta completa de un paquete de aplicación (p. ej. `/Applications/Visual Studio Code.app`) o de un ejecutable. Los shells, los intérpretes y los emuladores de terminal se rechazan, igual que una ruta que no existe.

La configuración de la interfaz tiene prioridad sobre cualquier variable de entorno — lo explícito supera a lo implícito. Déjalo vacío para usar la cadena de reserva de variables de entorno `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → valor predeterminado de la plataforma`. Consulta [Abrir en editor externo](/es/guide/formats#abrir-en-editor-externo) para el orden de resolución completo y la puerta de seguridad.

### Notificación puntual de actualización

En el primer inicio tras actualizar a la compatibilidad con múltiples formatos, VMark muestra una notificación no bloqueante que apunta a **Configuración → Formatos**. La notificación se activa una sola vez por instalación — una vez mostrada (o descartada), no vuelve a aparecer.

### Anulaciones por tipo de archivo

Además de los alternadores por categoría, puedes anular cómo se abre una familia de archivos concreta desde la paleta de comandos — **Establecer tipo de archivo: Texto sin formato / Markdown / Restablecer predeterminado**. Las anulaciones se guardan por familia de archivos (por extensión, o por el nombre del archivo de puntos en archivos como `.env`) y persisten entre sesiones. Consulta [Cómo decide VMark el tipo de un archivo](/es/guide/formats#como-decide-vmark-el-tipo-de-un-archivo).

El panel **Formatos** enumera todas las anulaciones que hayas establecido, cada una como `clave → formato`. Elimina una entrada con su botón `×`, o usa **Borrar todo** para quitarlas de una vez — las entradas eliminadas vuelven a la regla integrada.

## Idioma

El idioma de la interfaz y las reglas de formato CJK (chino, japonés, coreano).

### Idioma de la interfaz

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Idioma de la interfaz | Cambia el idioma de la interfaz para menús, etiquetas y mensajes. Surte efecto inmediatamente | Idioma del sistema | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

En el primer inicio, VMark elige el primer idioma de la lista de idiomas preferidos de tu sistema que incluye, y recurre al inglés si ninguno coincide. En cuanto eliges un idioma aquí, se conserva tu elección.

### Formato CJK

Las reglas siguientes se aplican cuando ejecutas **Formato → CJK → Formatear selección** (`Cmd+Shift+F`) sobre una selección, o **Formato → CJK → Formatear archivo completo** (`Alt+Cmd+Shift+F`) sobre todo el archivo.

::: tip
La sección Idioma contiene más de 20 alternadores de formato detallados. Para una explicación completa de cada regla con ejemplos, consulta [Formato CJK](/es/guide/cjk-formatting).
:::

### Normalización de Ancho Completo

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Convertir letras/números de ancho completo | Convierte caracteres alfanuméricos de ancho completo a medio ancho (por ejemplo, `ＡＢＣ` a `ABC`) | Activado |
| Normalizar el ancho de la puntuación | Convierte comas y puntos de ancho completo a medio ancho cuando están entre caracteres CJK | Activado |
| Convertir paréntesis | Convierte paréntesis de ancho completo a medio ancho cuando el contenido es CJK | Activado |
| Convertir corchetes | Convierte corchetes de medio ancho a ancho completo `【】` cuando el contenido es CJK | Desactivado |

### Espaciado

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Añadir espaciado CJK-Inglés | Inserta un espacio entre caracteres CJK y latinos | Activado |
| Añadir espaciado CJK-paréntesis | Inserta un espacio entre caracteres CJK y paréntesis | Activado |
| Eliminar espaciado de moneda | Elimina el espacio extra después de los símbolos de moneda (por ejemplo, `$ 100` se convierte en `$100`) | Activado |
| Eliminar espaciado de barra | Elimina los espacios alrededor de las barras (por ejemplo, `A / B` se convierte en `A/B`), preservando las URLs | Activado |
| Colapsar múltiples espacios | Reduce múltiples espacios consecutivos a uno solo | Activado |

### Guiones y Comillas

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Convertir guiones | Convierte dobles guiones (`--`) en rayas largas (`——`) entre caracteres CJK | Activado |
| Corregir espaciado de raya larga | Asegura el espaciado correcto alrededor de las rayas largas | Activado |
| Convertir comillas rectas | Convierte las comillas rectas `"` y `'` en comillas tipográficas (curvas) | Activado |
| Estilo de comillas | Estilo objetivo para la conversión de comillas tipográficas | Curvas `""` `''` |
| Comillas contextuales | Usa comillas curvas alrededor del texto CJK pero mantiene las comillas rectas en el texto puramente latino. Solo disponible cuando Convertir comillas rectas está activado | Activado |
| Comportamiento de alternancia de comillas | Cómo el comando de alternar estilo de comillas cicla entre los estilos — **Simple** cambia entre rectas ↔ tu estilo preferido; **Ciclo completo** rota por todos los estilos | Simple |
| Corregir espaciado de comillas dobles | Normaliza el espaciado alrededor de las comillas dobles | Activado |
| Corregir espaciado de comillas simples | Normaliza el espaciado alrededor de las comillas simples | Activado |
| Corchetes angulares CJK | Convierte las comillas curvas en corchetes angulares `「」` para texto chino tradicional y japonés. Solo disponible cuando el estilo de comillas es Curvas | Desactivado |
| Corchetes angulares anidados | Convierte las comillas simples anidadas en `『』` dentro de `「」` | Desactivado |

### Tratamiento de Secciones

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Omitir secciones de referencia | Deja sin formatear las secciones `## References` y `## Further Reading` al aplicar el formato CJK — útil para documentos académicos cuyo texto de citas debe quedar literal | Desactivado | Activado / Desactivado |

### Limpieza

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Limitar puntuación consecutiva | Limita los signos de puntuación repetidos como `!!!` | Desactivado | Desactivado, Simple (`!!` a `!`), Doble (`!!!` a `!!`) |
| Eliminar espacios al final | Elimina los espacios al final de las líneas | Activado | Activado / Desactivado |
| Normalizar puntos suspensivos | Convierte los puntos espaciados (`. . .`) en puntos suspensivos correctos (`...`) | Activado | Activado / Desactivado |
| Colapsar saltos de línea | Reduce tres o más saltos de línea consecutivos a dos | Desactivado | Activado / Desactivado |

## Atajos

Ver y personalizar todos los atajos de teclado. Los atajos están agrupados por categoría (Archivo, Editar, Vista, Formato, etc.).

- **Buscar** — Filtra atajos por nombre, categoría o combinación de teclas
- **Haz clic en un atajo** para cambiar su combinación de teclas. Presiona la nueva combinación y confirma
- **Restablecer** — Restaura un atajo individual a su predeterminado, o restablece todos a la vez
- **Exportar / Importar** — Guarda tus combinaciones personalizadas como un archivo JSON e impórtalas en otra máquina

Consulta [Atajos de Teclado](/es/guide/shortcuts) para la referencia completa de atajos predeterminados.

## Terminal

Configura el panel del terminal integrado. Abre el terminal con `` Ctrl + ` ``.

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Shell | Qué shell usar. Requiere reiniciar el terminal para que surta efecto. Un shell guardado que ya no está disponible se muestra como *(no disponible)* y se usa el predeterminado | System Default | Shells detectados automáticamente en tu sistema (por ejemplo, zsh, bash, fish) |
| Posición del Panel | Dónde colocar el panel del terminal | Auto | Auto (basado en la relación de aspecto de la ventana), Arriba, Abajo, Izquierda, Derecha |
| Tamaño del Panel | Proporción del espacio disponible que ocupa el terminal. Arrastrar para redimensionar el panel también actualiza este valor | 40% | 10% a 80% |
| Tamaño de Fuente | Tamaño del texto en el terminal | 13px | 10px a 24px |
| Altura de Línea | Espaciado vertical entre líneas del terminal | 1.2 (Compacto) | 1.0 (Ajustado) a 2.0 (Extra) |
| Estilo del Cursor | Forma del cursor del terminal | Barra | Barra, Bloque, Subrayado |
| Cursor Parpadeante | Si el cursor del terminal parpadea | Activado | Activado / Desactivado |
| Copiar al Seleccionar | Copia automáticamente el texto del terminal seleccionado al portapapeles | Desactivado | Activado / Desactivado |
| Mostrar transcripciones automáticamente | Muestra Markdown, tablas y diagramas Mermaid de Claude/Codex junto a la CLI del terminal. Añade un hook SessionStart local a la configuración de Claude Code y Codex; reinicia las sesiones CLI activas después de habilitarlo | Desactivado | Activado / Desactivado |
| Renderizador WebGL | Usa renderizado acelerado por GPU para el terminal. Desactívalo si experimentas problemas de entrada IME. Requiere reiniciar el terminal. Solo macOS y Windows — Linux usa siempre el renderizador DOM | Activado | Activado / Desactivado |
| Portapapeles remoto (OSC 52) | Permite que los programas que se ejecutan en el terminal — por ssh, dentro de tmux — copien al portapapeles del sistema. El canal es solo de escritura: la lectura del portapapeles siempre se rechaza, ya que cualquier salida impresa en el terminal podría solicitarla | Activado | Activado / Desactivado |
| Historial de desplazamiento | Número de líneas de salida que cada sesión conserva en su historial de desplazamiento. Los valores más altos usan más memoria | 5.000 | 1.000 / 5.000 / 10.000 / 50.000 |
| Modo lector de pantalla | Expone la salida del terminal a las tecnologías de asistencia (VoiceOver). Desactivado por defecto por rendimiento | Desactivado | Activado / Desactivado |

También aparecen aquí dos interruptores específicos de plataforma, ambos activados por defecto: **Option como tecla Meta** (solo macOS — trata la tecla Option como Meta, que es lo que herramientas como emacs y tmux esperan para los atajos con prefijo `Alt` y la navegación por palabras; desactívalo si necesitas las teclas muertas de Option para acentos, como `Option + E`) e **Integración con el shell** (oculto en Windows — inyecta marcadores de comandos en zsh y bash para la navegación entre prompts, las marcas de estado de salida y el seguimiento del directorio actual; se aplica en las nuevas sesiones de terminal).

### Accesibilidad

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Campana de terminal | Cómo se señala una campana de terminal (BEL). **Visual** marca actividad en segundo plano en la pestaña de sesión; **Audible** emite un pitido suave y (en una sesión en segundo plano) también marca la pestaña para que la encuentres; **Desactivada** la ignora. Se aplica en vivo a las sesiones en ejecución | Visual | Desactivada, Visual, Audible |
| Notificar cuando no está enfocada | Muestra una notificación del sistema (con el nombre del documento de la ventana) cuando un terminal hace sonar la campana mientras esa ventana de VMark no está enfocada — p. ej., Claude Code termina un turno. Te permite seguir Claude Code en varias ventanas sin vigilar cada una. Requiere conceder permiso de notificaciones la primera vez | Activado | Activado / Desactivado |
| Contraste mínimo | Eleva el texto tenue del terminal a una relación de contraste mínima respecto a su fondo. Súbelo para mejorar la legibilidad; **Desactivado** anula el ajuste. Se aplica en vivo a las sesiones en ejecución | WCAG AA (4,5:1) | Desactivado, WCAG AA (4,5:1), WCAG AAA (7:1), Máximo |

Consulta [Terminal Integrado](/es/guide/terminal) para más información sobre sesiones, atajos de teclado y entorno de shell.

## Acerca de

Muestra la versión de la app, enlaces al sitio web y al repositorio de GitHub, y gestión de actualizaciones. El enlace **Avisos de terceros** abre los textos de licencia del software de código abierto incluido con VMark en la app predeterminada del sistema para archivos de texto.

### Actualizaciones

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Actualizaciones automáticas | Busca nuevas versiones periódicamente | Activado | Activado / Desactivado |
| Frecuencia de comprobación | Con qué frecuencia comprobar si hay actualizaciones. Solo disponible cuando las actualizaciones automáticas están activadas | Al iniciar | Al iniciar, Diariamente, Semanalmente, Solo manual |
| Descargar actualizaciones automáticamente | Descarga las nuevas versiones en segundo plano cuando estén disponibles | Desactivado | Activado / Desactivado |
| Comprobar ahora | Activa manualmente una verificación de actualizaciones | — | — |

Cuando hay una actualización disponible, aparece una tarjeta que muestra el nuevo número de versión, la fecha de publicación y las notas de la versión. Puedes **Descargar** la actualización, **Omitir** esta versión o — una vez descargada — **Reiniciar para actualizar**.

#### La actualización coincide con cómo instalaste VMark

El actualizador descarga el mismo formato de paquete que instalaste, no uno fijo por plataforma:

| Instalaste | El actualizador descarga |
|---|---|
| macOS `.dmg` | el paquete de aplicación firmado |
| Windows `.exe` (NSIS) | el instalador `.exe` |
| Windows `.msi` | el paquete `.msi` |
| Linux `.deb` | el paquete `.deb` |
| Linux `.rpm` | el paquete `.rpm` |
| Linux AppImage | la AppImage |

En Linux, actualizar una instalación `.deb` o `.rpm` ejecuta el gestor de paquetes del sistema, así que se te pide autenticarte — instalar un paquete del sistema requiere privilegios de root. Las actualizaciones de AppImage sustituyen el archivo en su sitio y no piden nada.

#### Si una actualización se queda atascada

Tanto la comprobación como la descarga se hacen por la red, y una conexión que se cuelga en lugar de fallar directamente podría dejar la actualización en curso para siempre. Si una comprobación no avanza durante un minuto, o una descarga o instalación durante tres minutos, VMark muestra en la ventana del documento una notificación persistente **Actualización estancada**. Su botón **Reintentar** devuelve el actualizador al estado inactivo para que puedas volver a intentarlo — **Comprobar ahora** en esta sección, o la siguiente comprobación automática, empieza de nuevo con una comprobación nueva.

La actividad de actualización se escribe en el archivo de registro, así que si el problema se repite, conviene adjuntar el registro a un informe de error:

| Plataforma | Ubicación del registro |
|---|---|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Restablecer

| Configuración | Descripción |
|---------------|-------------|
| Restablecer a los valores predeterminados | Restaura los ajustes de estos paneles a sus valores predeterminados. Primero aparece un aviso de confirmación — esto no se puede deshacer |

Hay tres cosas que se guardan por separado y **no** se restablecen: las personalizaciones de atajos de teclado (usa **Restablecer todos** en el panel [Atajos](#atajos)), la configuración de tu proveedor de IA y los ajustes del explorador de archivos por espacio de trabajo (**Mostrar archivos ocultos**, **Mostrar todos los archivos**). El idioma de la interfaz vuelve al idioma de tu sistema.

## Avanzado

::: tip
La sección Avanzado está visible por defecto — alberga el interruptor para desactivar el navegador integrado, que viene activado. Presiona `Ctrl + Option + Cmd + D` en la ventana de Configuración para ocultarla, y de nuevo para volver a mostrarla.
:::

Configuración de desarrollador y del sistema.

### Protocolos de Enlace

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Protocolos de enlace personalizados | Protocolos de URL adicionales que VMark trata como enlaces. Introduce cada protocolo como una etiqueta | `obsidian`, `vscode`, `dict`, `x-dictionary` |

La lista hace dos cosas. Al insertar un enlace, una URL del portapapeles con uno de estos protocolos se reconoce como enlace, igual que `https://`. Y al abrir un enlace, VMark solo lo entrega a tu sistema si su protocolo es `http`, `https`, `mailto` o figura en esta lista — así los enlaces `obsidian://open?vault=...` y `vscode://file/...` se abren en sus aplicaciones, mientras que cualquier otro protocolo se rechaza. Algunos protocolos nunca pueden habilitarse de este modo, diga lo que diga la lista: `javascript:`, `data:`, `file:` y similares.

Un valor predeterminado que quitas sigue quitado. Un protocolo predeterminado añadido en una versión posterior de VMark se añade a tu lista una sola vez, en el primer arranque de esa versión.

### Rendimiento

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Mantener ambos editores activos | Monta tanto el editor WYSIWYG como el modo Fuente simultáneamente para un cambio de modo más rápido. Aumenta el uso de memoria | Desactivado |

### Coherencia

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Confianza de la comprobación semántica | Qué seguridad debe tener una comprobación antes de que su respuesta se registre como veredicto. Por debajo de este valor, la respuesta se conserva pero se marca como desconocida | 0.9 | 0.7, 0.8, 0.9, 0.95 |

Consulta [Coherencia](/es/guide/coherence) para saber qué es una comprobación y cómo se registran los veredictos.

### Archivos de flujo de trabajo

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Obtener metadatos de acciones | Permite que VMark obtenga `action.yml` de las GitHub Actions referenciadas para rellenar el formulario `with:` del editor estructurado. Desactívalo para mantener el editor de flujos de trabajo totalmente sin conexión | Activado | Activado / Desactivado |
| Usar actionlint cuando esté disponible | Si el binario `actionlint` está en tu PATH, se ejecuta sobre los archivos de flujo de trabajo para obtener diagnósticos más ricos. No tiene efecto si el binario no está instalado | Activado | Activado / Desactivado |

### Flujo de trabajo

El visor de GitHub Actions no tiene interruptor: al abrir un archivo bajo
`.github/workflows/` se muestran el grafo y el editor de formularios, y las
ayudas del panel de código fuente (autocompletado de expresiones, sincronización
del cursor con el lienzo, ir a la definición de `uses:`) se cargan con él. Lo que
queda aquí es la única preferencia del visor y el motor de ejecución, que es
independiente.

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Conservar el formato YAML | Al guardar las ediciones de workflow realizadas a través del panel de formulario, conserva los comentarios, anclas, orden de claves y líneas en blanco del YAML original mediante el pipeline de ida y vuelta CST. Cuando está desactivado, guardar usa un serializador compacto (más rápido pero con pérdidas) | Activado | Activado / Desactivado |
| Motor de workflow | Ejecuta los archivos de workflow YAML propios de VMark: un archivo de workflow se abre con su grafo de pasos y una barra de herramientas Ejecutar / Cancelar junto al código fuente, y los genios de workflow pueden ejecutarse. Los pasos pueden llamar a proveedores de IA y escribir archivos, así que permanece desactivado hasta que lo pidas | Desactivado | Activado / Desactivado |

El motor no cambia lo que muestra el visor: los archivos de GitHub Actions se
abren en el visor en cualquier caso y, con el motor desactivado, un archivo de
workflow de VMark se muestra como un árbol YAML sin formato. Con el motor
desactivado, VMark además rechaza directamente las solicitudes de ejecución de
workflows en lugar de limitarse a ocultar el botón — incluidas las que llegan
por MCP — e informa «El motor de flujo de trabajo está desactivado en la
configuración».

Ambas filas están en **Herramientas de desarrollo** (consulta más abajo) — activa
Herramientas de desarrollo para mostrarlas. Consulta [Visor de Workflow](/es/guide/workflow-viewer)
para el visor y [Flujos de trabajo de Genie](/es/guide/workflows) para el motor.

### Navegador Integrado

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Navegador integrado | El navegador web dentro de la aplicación (solo macOS). Mientras está activado, **Nueva pestaña del navegador** aparece en el menú Archivo y en la paleta de comandos, y las herramientas MCP `browser` están disponibles. Desactivarlo cierra las pestañas del navegador abiertas y retira la superficie de automatización de IA | Activado | Activado / Desactivado |
| Sesión del navegador de IA | Elige `Sandbox` (recomendado, cookies de IA aisladas y no persistentes) o `Perfil compartido` (perfil humano con aprobaciones de destino) | Sandbox | Sandbox / Compartido |
| Permitir acceso de bucle invertido a la IA | Permite que la IA navegue a localhost y direcciones de bucle invertido. Los rangos de LAN privada, metadatos y enlace local siguen bloqueados | Desactivado | Activado / Desactivado |

Estos ajustes están en **Avanzado → macOS** y solo aparecen en macOS. Las dos
filas de postura de la IA solo aparecen mientras el navegador está activado, y
no se ven afectadas por ello — se mantienen en Sandbox / bucle invertido
bloqueado hasta que las cambies. Consulta [Navegador Integrado](/es/guide/browser)
para la superficie completa de la función.

### Específico de Plataforma

| Configuración | Descripción | Predeterminado | Plataformas |
|---------------|-------------|----------------|-------------|
| Limpiar la cuarentena de macOS al abrir | Al abrir un espacio de trabajo, elimina el atributo de cuarentena de descargas de macOS (`com.apple.quarantine`) de la carpeta del espacio de trabajo y de los archivos que están directamente dentro de ella y que VMark puede abrir (las subcarpetas no se tocan). Sin esto, macOS puede descartar en silencio un doble clic en Finder sobre un archivo descargado mientras VMark está en ejecución. En la interfaz aparece como **Eliminar la cuarentena de descargas al abrir el espacio de trabajo**, en **Avanzado → macOS** | Activado | macOS |

El ajuste **Option como tecla Meta** del terminal está en el panel [Terminal](#terminal).

### Herramientas de Desarrollador

**Herramientas de desarrollo** es un interruptor maestro persistente para los ajustes
experimentales y exclusivos de desarrollo. Al activarlo aparecen la fila
**Conservar el formato YAML**, el alternador **Motor de flujo de trabajo** y un panel
**Herramientas de desarrollo de salida en caliente** (botones para probar la captura,
inspección, restauración, limpieza y reinicio de sesión). Como el interruptor
persiste, una función en desarrollo que actives sigue accesible entre sesiones y en
las versiones publicadas — no necesitas volver a activar las Herramientas de
desarrollo cada vez que abres Configuración.

También muestra la [Base de conocimiento](/es/guide/knowledge-base) fuera de
Configuración: el elemento de menú **Vista → Base de conocimiento**, el comando de
la paleta y el atajo `Ctrl + Shift + 4` están ocultos hasta que se activan las
Herramientas de desarrollo, porque ninguna versión publicada en ninguna plataforma
incluye el entorno de ejecución del servidor de contenido que necesita esa función.

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Herramientas de desarrollo | Activa el modo de desarrollador y muestra a continuación los ajustes experimentales y exclusivos de desarrollo | Desactivado |

## Ver También

- [Características](/es/guide/features) — Descripción general de las capacidades de VMark
- [Atajos de Teclado](/es/guide/shortcuts) — Referencia completa de atajos
- [Formato CJK](/es/guide/cjk-formatting) — Reglas detalladas de formato CJK
- [Terminal Integrado](/es/guide/terminal) — Sesiones de terminal y uso
- [Proveedores de IA](/es/guide/ai-providers) — Guía de configuración de proveedores de IA
- [Configuración de MCP](/es/guide/mcp-setup) — Configuración del servidor MCP para asistentes de IA
