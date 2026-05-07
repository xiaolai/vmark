# Configuración

El panel de configuración de VMark te permite personalizar todos los aspectos del editor. Ábrelo con `Mod + ,` o a través de **VMark > Configuración** en la barra de menú.

La ventana de configuración tiene una barra lateral con secciones agrupadas por tema — las secciones más utilizadas aparecen primero, con Acerca de y Avanzado al final. Los cambios surten efecto inmediatamente — no hay botón de guardar.

## Apariencia

Controla el tema visual y el comportamiento de la ventana.

### Tema

Elige entre cinco temas de color. El tema activo se indica con un anillo alrededor de su muestra.

| Tema | Fondo | Estilo |
|------|-------|--------|
| White | `#FFFFFF` | Limpio, alto contraste |
| Paper | `#EEEDED` | Neutro cálido (predeterminado) |
| Mint | `#CCE6D0` | Verde suave, agradable para la vista |
| Sepia | `#F9F0DB` | Amarillento cálido, estilo libro |
| Night | `#23262B` | Modo oscuro |

### Idioma

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Idioma | Cambia el idioma de la interfaz para menús, etiquetas y mensajes. Surte efecto inmediatamente | English | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

### Ventana

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Mostrar nombre de archivo en la barra de título | Muestra el nombre del archivo actual en la barra de título de la ventana de macOS | Desactivado |
| Ocultar automáticamente la barra de estado | Oculta automáticamente la barra de estado cuando no estás interactuando con ella | Desactivado |

## Editor

Tipografía, visualización, comportamiento de edición y configuración de espacios en blanco.

### Tipografía

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Fuente Latina | Familia tipográfica para texto latino (inglés) | System Default | System Default, Athelas, Palatino, Georgia, Charter, Literata |
| Fuente CJK | Familia tipográfica para texto en chino, japonés y coreano | System Default | System Default, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans |
| Fuente Mono | Familia tipográfica para código y texto monoespaciado | System Default | System Default, SF Mono, Monaco, Menlo, Consolas, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata |
| Tamaño de Fuente | Tamaño de fuente base para el contenido del editor | 18px | 14px, 16px, 18px, 20px, 22px |
| Altura de Línea | Espaciado vertical entre líneas | 1.8 (Relajado) | 1.4 (Compacto), 1.6 (Normal), 1.8 (Relajado), 2.0 (Espacioso), 2.2 (Extra) |
| Espaciado de Bloque | Espacio visual entre elementos de bloque (encabezados, párrafos, listas) medido en múltiplos de la altura de línea | 1x (Normal) | 0.5x (Ajustado), 1x (Normal), 1.5x (Relajado), 2x (Espacioso) |
| Espaciado de Caracteres CJK | Espaciado adicional entre caracteres CJK, en unidades em | Desactivado | Desactivado, 0.02em (Sutil), 0.03em (Ligero), 0.05em (Normal), 0.08em (Amplio), 0.10em (Más Amplio), 0.12em (Extra) |

### Visualización

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Ancho del Editor | Ancho máximo del contenido. Los valores más amplios se adaptan a monitores grandes; los más estrechos mejoran la legibilidad | 50em (Medio) | 36em (Compacto), 42em (Estrecho), 50em (Medio), 60em (Amplio), 80em (Extra Amplio), Ilimitado |

::: tip
50em con un tamaño de fuente de 18px equivale aproximadamente a 900px — un ancho de lectura cómodo para la mayoría de las pantallas.
:::

### Comportamiento

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Tamaño de tabulación | Número de espacios insertados al presionar Tab | 2 espacios | 2 espacios, 4 espacios |
| Habilitar emparejamiento automático | Inserta automáticamente los corchetes y comillas de cierre correspondientes al escribir uno de apertura | Activado | Activado / Desactivado |
| Corchetes CJK | Empareja automáticamente corchetes específicos de CJK como `「」` `【】` `《》`. Solo disponible cuando el emparejamiento automático está habilitado | Auto | Desactivado, Auto |
| Incluir comillas curvas | Empareja automáticamente los caracteres `""` y `''`. Puede entrar en conflicto con algunas funciones de comillas inteligentes del IME. Aparece cuando los corchetes CJK están en Auto | Activado | Activado / Desactivado |
| También emparejar `"` | Al escribir la comilla doble de cierre `"` también inserta un par `""`. Útil cuando tu IME alterna entre comillas de apertura y cierre. Aparece cuando las comillas curvas están habilitadas | Desactivado | Activado / Desactivado |
| Formato de copia | Qué formato usar para el portapapeles de texto sin formato al copiar desde el modo WYSIWYG | Texto sin formato | Texto sin formato, Markdown |
| Copiar al seleccionar | Copia automáticamente el texto al portapapeles cuando lo seleccionas | Desactivado | Activado / Desactivado |

### Espacios en Blanco

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Fin de línea al guardar | Controla cómo se gestionan los finales de línea al guardar archivos | Conservar existente | Conservar existente, LF (`\n`), CRLF (`\r\n`) |
| Conservar saltos de línea consecutivos | Mantener múltiples líneas en blanco tal como están en lugar de colapsarlas | Desactivado | Activado / Desactivado |
| Estilo de salto de línea forzado al guardar | Cómo se representan los saltos de línea forzados en el archivo Markdown guardado | Conservar existente | Dos espacios (Recomendado), Conservar existente, Barra invertida (`\`) |
| Mostrar etiquetas `<br>` | Muestra visiblemente las etiquetas de salto de línea HTML en el editor | Desactivado | Activado / Desactivado |

::: tip
Dos espacios es el estilo de salto de línea forzado más compatible — funciona en GitHub, GitLab y todos los principales renderizadores de Markdown. El estilo de barra invertida puede fallar en Reddit, Jekyll y algunos analizadores más antiguos.
:::

## Markdown

Comportamiento de pegado, diseño y configuración de renderizado HTML.

### Pegar e Ingresar

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Habilitar regex en la búsqueda | Muestra un botón de alternancia de regex en la barra de Buscar y Reemplazar | Activado | Activado / Desactivado |
| Modo de pegado | Cómo VMark enruta el contenido del portapapeles | Inteligente | Inteligente, Sin formato |
| Pegado Markdown en WYSIWYG | Al pegar texto que parece Markdown en el editor WYSIWYG, convertirlo automáticamente en contenido enriquecido | Auto | Auto, Desactivado |

### Diseño

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Tamaño de fuente de elementos de bloque | Tamaño de fuente relativo para listas, citas, tablas, alertas y bloques de detalles | 100% | 100%, 95%, 90%, 85% |
| Alineación de encabezados | Alineación de texto para los encabezados | Izquierda | Izquierda, Centro |
| Bordes de imágenes y diagramas | Si mostrar un borde alrededor de imágenes, diagramas Mermaid y bloques matemáticos | Ninguno | Ninguno, Siempre, Al pasar el ratón |
| Alineación de imágenes y tablas | Alineación horizontal para imágenes de bloque y tablas | Centro | Centro, Izquierda |

### Lint

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Habilitar markdown lint | Verificar problemas comunes de markdown (enlaces rotos, texto alt faltante, incrementos de encabezados, bloques de código no cerrados, etc.) | Activado | Activado / Desactivado |

Consulta [Lint de Markdown](/es/guide/lint) para la lista completa de reglas y niveles de severidad.

### Renderizado HTML

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| HTML sin formato en texto enriquecido | Controla si los bloques HTML sin formato se renderizan en el modo WYSIWYG | Oculto | Oculto, Saneado, Saneado + estilos |

::: tip
**Oculto** es la opción más segura — los bloques HTML sin formato se colapsan y no se renderizan. **Saneado** renderiza HTML con las etiquetas peligrosas eliminadas. **Saneado + estilos** también conserva los atributos `style` en línea.
:::

## Archivos e Imágenes

Explorador de archivos, guardado, historial de documentos, manejo de imágenes y herramientas de documentos.

### Explorador de Archivos

Estas configuraciones solo se aplican cuando hay un espacio de trabajo (carpeta) abierto.

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Mostrar archivos ocultos | Incluye archivos de puntos y elementos del sistema ocultos en la barra lateral del explorador de archivos | Desactivado |
| Mostrar todos los archivos | Muestra archivos que no son markdown en el explorador de archivos. Los archivos que no son markdown se abren con la aplicación predeterminada del sistema | Desactivado |

### Comportamiento al Salir

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Confirmar al salir | Requiere presionar `Cmd+Q` (o `Ctrl+Q`) dos veces para salir, evitando salidas accidentales | Activado |

### Guardado

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Habilitar guardado automático | Guarda automáticamente los archivos después de editar | Activado | Activado / Desactivado |
| Intervalo de guardado | Tiempo entre guardados automáticos. Solo disponible cuando el guardado automático está habilitado | 30 segundos | 10s, 30s, 1 min, 2 min, 5 min |
| Conservar historial del documento | Rastrea las versiones del documento para deshacer y recuperación | Activado | Activado / Desactivado |
| Versiones máximas | Número de instantáneas del historial a conservar por documento | 50 versiones | 10, 25, 50, 100 |
| Conservar versiones durante | Antigüedad máxima de las instantáneas del historial antes de ser eliminadas | 7 días | 1 día, 7 días, 14 días, 30 días |
| Ventana de fusión | Los guardados automáticos consecutivos dentro de esta ventana se consolidan en una única instantánea, reduciendo el ruido de almacenamiento | 30 segundos | Desactivado, 10s, 30s, 1 min, 2 min |
| Tamaño máximo de archivo para el historial | Omite las instantáneas del historial para archivos más grandes que este umbral | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Ilimitado |

### Imágenes

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Redimensionar automáticamente al pegar | Redimensiona automáticamente las imágenes grandes antes de guardarlas en la carpeta de recursos. El valor es la dimensión máxima en píxeles | Desactivado | Desactivado, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copiar a la carpeta de recursos | Copia las imágenes pegadas o arrastradas a la carpeta de recursos del documento en lugar de incrustarlas | Activado | Activado / Desactivado |
| Limpiar imágenes no usadas al cerrar | Elimina automáticamente las imágenes de la carpeta de recursos que ya no están referenciadas en el documento cuando lo cierras | Desactivado | Activado / Desactivado |
| Umbral de imagen en línea | Tamaño máximo (MB) para incrustar imágenes como URLs de datos base64 en la exportación HTML/PDF. Los archivos más grandes se enlazan en su lugar | 1.0 MB | 0.1 – 10 MB |

### Archivos Grandes

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Avisar por encima del tamaño | Mostrar un aviso de confirmación al abrir archivos por encima de este tamaño | 5 MB | Activado / Desactivado |
| Modo Fuente automático | Abre automáticamente los archivos por encima del umbral en modo Fuente (omite WYSIWYG para mantener un rendimiento fluido) | Activado | Activado / Desactivado |

Consulta [Archivos Grandes](/guide/large-files) para el desglose completo de cómo se manejan los archivos grandes.

### Actualizaciones

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Frecuencia de comprobación | Cuándo comprobar nuevas versiones de VMark | Al iniciar | Al iniciar, Diario, Semanal, Manual |
| Descargar actualizaciones automáticamente | Descarga los artefactos de la versión en segundo plano una vez detectada una actualización | Desactivado | Activado / Desactivado |
| Omitir una versión | Suprime el aviso de actualización para una versión específica (se establece por actualización desde el propio aviso) | Ninguna | — |

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
| Habilitar Servidor MCP | Inicia o detiene el servidor MCP. Cuando está en ejecución, una insignia de estado muestra el puerto y los clientes conectados | Activado (alternador) |
| Iniciar al abrir | Inicia automáticamente el servidor MCP cuando se abre VMark | Activado |
| Auto-aprobar ediciones | Aplica los cambios de documentos iniciados por IA sin mostrar una vista previa para su aprobación primero. Usar con precaución | Desactivado |

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

**Proveedores de API REST** — Conéctate directamente a las APIs en la nube (Anthropic, OpenAI, Google AI, Ollama API). Cada uno requiere un endpoint, una clave API y un nombre de modelo.

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
| **Vista previa HTML** | Desactivado | `.html` y `.htm` — vista previa en iframe en zona de pruebas (`sandbox=""` lista de permisos vacía, DOMPurify, CSP `<meta>`). Verificado con el top 20 de OWASP — consulta [Modelo de seguridad para HTML](/es/guide/formats#modelo-de-seguridad-para-html). |
| **Visores de código** | Desactivado | 12 visores de solo lectura (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Se abren en un visor con resaltado de sintaxis y botones **Habilitar edición** y **Abrir en editor externo**. |

Cuando una categoría está desactivada, las extensiones correspondientes pasan al modo de texto plano de reserva, de modo que el archivo sigue abriéndose — solo sin la vista de esquema.

### Editor externo

Para el botón **Abrir en editor externo** de las pestañas de código de solo lectura, elige el editor que debe lanzarse. Un paquete de aplicación (p. ej. `/Applications/Visual Studio Code.app`) o un ejecutable.

La configuración de la interfaz tiene prioridad sobre cualquier variable de entorno — lo explícito supera a lo implícito. Déjalo vacío para usar la cadena de reserva de variables de entorno `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → valor predeterminado de la plataforma`. Consulta [Abrir en editor externo](/es/guide/formats#abrir-en-editor-externo) para el orden de resolución completo y la puerta de seguridad.

### Notificación puntual de actualización

En el primer inicio tras actualizar a la compatibilidad con múltiples formatos, VMark muestra una notificación no bloqueante que apunta a **Configuración → Formatos**. La notificación se activa una sola vez por instalación — una vez mostrada (o descartada), no vuelve a aparecer.

## Idioma

Reglas de formato CJK (chino, japonés, coreano). Estas reglas se aplican cuando ejecutas **Formato → Formatear Selección CJK** (`Cmd+Shift+F`) sobre una selección, o **Formato → Formatear Documento CJK** (`Alt+Cmd+Shift+F`) sobre todo el archivo.

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
| Corregir espaciado de comillas dobles | Normaliza el espaciado alrededor de las comillas dobles | Activado |
| Corregir espaciado de comillas simples | Normaliza el espaciado alrededor de las comillas simples | Activado |
| Corchetes angulares CJK | Convierte las comillas curvas en corchetes angulares `「」` para texto chino tradicional y japonés. Solo disponible cuando el estilo de comillas es Curvas | Desactivado |
| Corchetes angulares anidados | Convierte las comillas simples anidadas en `『』` dentro de `「」` | Desactivado |

### Limpieza

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Limitar puntuación consecutiva | Limita los signos de puntuación repetidos como `!!!` | Desactivado | Desactivado, Simple (`!!` a `!`), Doble (`!!!` a `!!`) |
| Eliminar espacios al final | Elimina los espacios al final de las líneas | Activado | Activado / Desactivado |
| Normalizar puntos suspensivos | Convierte los puntos espaciados (`. . .`) en puntos suspensivos correctos (`...`) | Activado | Activado / Desactivado |
| Colapsar saltos de línea | Reduce tres o más saltos de línea consecutivos a dos | Activado | Activado / Desactivado |

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
| Shell | Qué shell usar. Requiere reiniciar el terminal para que surta efecto | System Default | Shells detectados automáticamente en tu sistema (por ejemplo, zsh, bash, fish) |
| Posición del Panel | Dónde colocar el panel del terminal | Auto | Auto (basado en la relación de aspecto de la ventana), Abajo, Derecha |
| Tamaño del Panel | Proporción del espacio disponible que ocupa el terminal. Arrastrar para redimensionar el panel también actualiza este valor | 40% | 10% a 80% |
| Tamaño de Fuente | Tamaño del texto en el terminal | 13px | 10px a 24px |
| Altura de Línea | Espaciado vertical entre líneas del terminal | 1.2 (Compacto) | 1.0 (Ajustado) a 2.0 (Extra) |
| Estilo del Cursor | Forma del cursor del terminal | Barra | Barra, Bloque, Subrayado |
| Cursor Parpadeante | Si el cursor del terminal parpadea | Activado | Activado / Desactivado |
| Copiar al Seleccionar | Copia automáticamente el texto del terminal seleccionado al portapapeles | Desactivado | Activado / Desactivado |
| Renderizador WebGL | Usa renderizado acelerado por GPU para el terminal. Desactívalo si experimentas problemas de entrada IME. Requiere reiniciar el terminal | Activado | Activado / Desactivado |

Consulta [Terminal Integrado](/es/guide/terminal) para más información sobre sesiones, atajos de teclado y entorno de shell.

## Acerca de

Muestra la versión de la app, enlaces al sitio web y al repositorio de GitHub, y gestión de actualizaciones.

### Actualizaciones

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Actualizaciones automáticas | Verifica actualizaciones automáticamente al inicio | Activado |
| Verificar Ahora | Activa manualmente una verificación de actualizaciones | — |

Cuando hay una actualización disponible, aparece una tarjeta que muestra el nuevo número de versión, la fecha de publicación y las notas de la versión. Puedes **Descargar** la actualización, **Omitir** esta versión o — una vez descargada — **Reiniciar para Actualizar**.

## Avanzado

::: tip
La sección Avanzado está oculta por defecto. Presiona `Ctrl + Option + Cmd + D` en la ventana de Configuración para mostrarla.
:::

Configuración de desarrollador y del sistema.

### Protocolos de Enlace

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Protocolos de enlace personalizados | Protocolos de URL adicionales que VMark debe reconocer al insertar enlaces. Introduce cada protocolo como una etiqueta | `obsidian`, `vscode`, `dict`, `x-dictionary` |

Esto te permite crear enlaces como `obsidian://open?vault=...` o `vscode://file/...` que VMark tratará como URLs válidas.

### Rendimiento

| Configuración | Descripción | Predeterminado |
|---------------|-------------|----------------|
| Mantener ambos editores activos | Monta tanto el editor WYSIWYG como el modo Fuente simultáneamente para un cambio de modo más rápido. Aumenta el uso de memoria | Desactivado |

### Motor de Workflow

| Configuración | Descripción | Predeterminado | Opciones |
|---------------|-------------|----------------|---------|
| Motor de workflow | Habilita el visor/editor de workflows de GitHub Actions para los archivos `.yml`/`.yaml` bajo `.github/workflows/`. Cuando está desactivado, esos archivos se abren como YAML sin formato | Desactivado | Activado / Desactivado |
| Conservar el formato YAML | Al guardar las ediciones de workflow realizadas a través del panel de formulario, conserva los comentarios, anclas, orden de claves y líneas en blanco del YAML original mediante el pipeline de ida y vuelta CST. Cuando está desactivado, guardar usa un serializador compacto (más rápido pero con pérdidas) | Activado | Activado / Desactivado |

Consulta [Visor de Workflow](/guide/workflow-viewer) para la superficie completa de la función.

### Específico de Plataforma

| Configuración | Descripción | Predeterminado | Plataformas |
|---------------|-------------|----------------|-------------|
| Limpiar la cuarentena de macOS al abrir | Cuando abres un archivo que tiene el atributo de cuarentena de macOS (`com.apple.quarantine`), elimínalo antes de leerlo. Útil para archivos descargados de la web que VMark no podría abrir de otro modo | Activado | macOS |
| Tecla Option de Mac como Meta (terminal) | Trata la tecla Option de macOS como Meta en el terminal integrado. Necesario para herramientas como emacs y tmux que esperan atajos con prefijo Alt | Desactivado | macOS |

### Herramientas de Desarrollador

Cuando las **Herramientas de desarrollador** están activadas, aparece un panel **Hot Exit Dev Tools** con botones para probar la captura, inspección, restauración, limpieza y reinicio de sesión — útil para depurar el comportamiento de salida en caliente durante el desarrollo.

## Ver También

- [Características](/es/guide/features) — Descripción general de las capacidades de VMark
- [Atajos de Teclado](/es/guide/shortcuts) — Referencia completa de atajos
- [Formato CJK](/es/guide/cjk-formatting) — Reglas detalladas de formato CJK
- [Terminal Integrado](/es/guide/terminal) — Sesiones de terminal y uso
- [Proveedores de IA](/es/guide/ai-providers) — Guía de configuración de proveedores de IA
- [Configuración de MCP](/es/guide/mcp-setup) — Configuración del servidor MCP para asistentes de IA
