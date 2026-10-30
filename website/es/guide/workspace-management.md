# Gestión del Espacio de Trabajo

Un espacio de trabajo en VMark es una carpeta abierta como raíz de tu proyecto. Cuando abres un espacio de trabajo, la barra lateral muestra un árbol de archivos, Apertura Rápida puede encontrar cada archivo que muestra el árbol de archivos, el terminal se inicia en la raíz del proyecto y tus pestañas abiertas se recuerdan para la próxima vez.

Sin un espacio de trabajo, aún puedes abrir archivos individuales, pero pierdes el explorador de archivos, la búsqueda dentro del proyecto y la restauración de sesiones.

::: tip Varios espacios de trabajo en una ventana
La [barra de espacios de trabajo](/es/guide/workspace-rail) experimental permite que una sola ventana contenga varios espacios de trabajo y cambie entre ellos — cada uno con sus propias pestañas, su árbol de archivos y su disposición.
:::

## Abrir un Espacio de Trabajo

| Método | Cómo |
|--------|------|
| Menú | **Archivo > Abrir Espacio de Trabajo** |
| Apertura Rápida | `Mod + O`, luego selecciona **Examinar...** al final |
| Arrastrar y soltar | Arrastra un archivo markdown desde el Finder a la ventana — VMark detecta su raíz de proyecto y abre el espacio de trabajo automáticamente |
| Espacios de Trabajo Recientes | **Archivo > Espacios de Trabajo Recientes** y elige un proyecto anterior |

Cuando abres un espacio de trabajo, VMark muestra la barra lateral con el explorador de archivos. Si el espacio de trabajo fue abierto anteriormente, las pestañas abiertas previamente se restauran.

En Windows y Linux, una carpeta pasada en la línea de comandos (`vmark C:\notes` o `vmark ~/notes`) se abre como espacio de trabajo en su propia ventana, igual que al soltar una carpeta sobre el icono del Dock en macOS. Esto también funciona cuando VMark ya está en ejecución.

::: tip
Si la ventana actual tiene cambios sin guardar, VMark ofrece abrir el espacio de trabajo en una nueva ventana en lugar de reemplazar tu trabajo.
:::

## Explorador de Archivos

El explorador de archivos aparece en la barra lateral siempre que hay un espacio de trabajo abierto. Muestra un árbol de archivos markdown con raíz en la carpeta del espacio de trabajo.

### Navegación

- **Un clic** en una carpeta para expandirla o contraerla
- **Un clic** en un archivo para abrirlo en una pestaña
- **Enter** (o `F2`) sobre un elemento seleccionado inicia su renombrado en línea
- Los archivos que VMark no edita por sí mismo (visibles con **Mostrar Todos los Archivos**) se abren con la aplicación predeterminada del sistema
- Las carpetas empiezan contraídas cuando se abre un espacio de trabajo por primera vez; su estado de apertura se conserva mientras cambias entre las vistas Archivos, Esquema e Historial

### Vista Rápida

Selecciona un archivo en el árbol y pulsa `Space` para previsualizarlo en una superposición a toda la ventana sin abrir una pestaña — las imágenes, los vídeos y el audio se muestran con sus controles nativos; cualquier otro archivo muestra un panel «No se puede previsualizar este formato» con un botón para abrirlo externamente. `←`/`↑` y `→`/`↓` recorren en orden los archivos visibles del árbol (sin volver al principio), y `Space`, `Escape` o un clic en el fondo cierran la vista previa. Escribir un espacio en el campo de renombrado en línea nunca la activa.

### Botones de la Cabecera

La cabecera de la vista Archivos incluye los controles que afectan a todo el árbol:

- **Expandir todas las carpetas** — abre todas las carpetas del árbol
- **Contraer todas las carpetas** — cierra todas las carpetas hasta volver a la raíz
- **Mostrar todos los archivos** — un alternador; cuando está activado (resaltado), el árbol
  enumera todos los archivos en lugar de solo los que VMark puede abrir
- **Nuevo archivo** / **Nueva carpeta** — crean el elemento dentro de la carpeta seleccionada, o en la
  raíz del espacio de trabajo cuando no hay nada seleccionado

### Operaciones de Archivos

Haz clic derecho en un archivo, en una carpeta o en el espacio vacío bajo el árbol para acceder al menú contextual:

| Acción | Se muestra para | Descripción |
|--------|-----------------|-------------|
| Abrir | Archivos | Abre el archivo en una nueva pestaña |
| Renombrar | Archivos, carpetas | Edita el nombre del archivo o carpeta en línea (también `F2`) |
| Duplicar | Archivos | Crea una copia del archivo |
| Mover a... | Archivos | Mueve el archivo a una carpeta diferente mediante un cuadro de diálogo |
| Eliminar | Archivos, carpetas | Mueve el archivo o carpeta a la papelera del sistema |
| Copiar ruta | Archivos, carpetas | Copia la ruta absoluta al portapapeles |
| Mostrar en Finder | Archivos, carpetas | Muestra el elemento en tu gestor de archivos — se llama **Mostrar en Explorador** en Windows y **Mostrar en gestor de archivos** en Linux |
| Nuevo Archivo | Carpetas, espacio vacío | Crea un nuevo archivo markdown en esta ubicación |
| Nueva Carpeta | Carpetas, espacio vacío | Crea una nueva carpeta en esta ubicación |
| Abrir terminal aquí | Carpetas | Inicia una nueva sesión de terminal en esta carpeta (desactivado cuando ya hay 5 sesiones abiertas) — consulta [Terminal](/es/guide/terminal) |

También puedes **arrastrar y soltar** archivos entre carpetas directamente en el árbol.

### Alternadores de Visibilidad

De forma predeterminada, el explorador muestra solo los tipos de archivo que VMark puede abrir y oculta los archivos de puntos.
**Las carpetas se enumeran contengan o no algo visible**, de modo que un proyecto con tipos
de archivo no compatibles parece un árbol de carpetas vacías — es el filtro en acción,
no un fallo al leer el directorio. Dos alternadores cambian esto:

| Alternador | Atajo | Qué hace |
|-----------|-------|---------|
| Mostrar Archivos Ocultos | `Mod + Shift + .` (macOS) / `Ctrl + H` (Win/Linux) | Muestra archivos de puntos y carpetas ocultas |
| Mostrar Todos los Archivos | `Mod + Shift + A` | Muestra archivos que no son markdown junto con tus documentos |

Ambas configuraciones se guardan por espacio de trabajo y persisten entre sesiones.

### Carpetas Excluidas

Algunos directorios nunca se enumeran por dentro, diga lo que diga la configuración del espacio de
trabajo — el mismo mínimo que aplica la búsqueda del espacio de trabajo: `.git`, `node_modules`, `.obsidian`,
`.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`,
`dist`, `.superpowers`. Siguen apareciendo como carpetas para que sepas que existen; su
contenido no se lee. Añade tus propios nombres en **Carpetas excluidas** en la
configuración del espacio de trabajo (un espacio de trabajo nuevo empieza con `.git` y `node_modules` ahí).

El árbol se enumera en una sola pasada y se actualiza cuando cambian los archivos. Una ráfaga de
cambios lo actualiza una sola vez, poco después de que termine la ráfaga; una carpeta que nunca
deja de cambiar (una descarga en curso, una compilación, una sincronización) se actualiza a
intervalos cada vez más amplios en lugar de continuamente, de modo que el explorador nunca
acapara un núcleo de CPU releyendo un espacio de trabajo con mucha actividad.

## Apertura Rápida

Presiona `Mod + O` para abrir la superposición de Apertura Rápida. Proporciona búsqueda difusa en tres fuentes, en este orden:

1. **Pestañas abiertas** en la ventana actual (marcadas con un indicador de punto), las usadas más recientemente primero
2. **Archivos recientes** que has abierto antes
3. **Todos los archivos que el explorador de archivos muestra en ese momento** en el espacio de trabajo

Antes de escribir, la lista muestra solo las pestañas abiertas y los archivos recientes. En cuanto escribes, aparecen resultados de las tres fuentes, agrupados en ese orden y ordenados por calidad de coincidencia dentro de cada grupo.

Escribe algunos caracteres para filtrar — la coincidencia es difusa, así que `rme` encuentra `README.md`. Usa las teclas de flecha para navegar y **Enter** para abrir. Una fila **Examinar...** fijada al final abre un cuadro de diálogo de archivos.

La tercera fuente sigue exactamente al explorador de archivos, así que los dos nunca discrepan
sobre lo que existe. Activa **Mostrar archivos ocultos** y la Apertura Rápida encuentra documentos
en `.claude/`, `.github/workflows/` y cualquier otro directorio de puntos; activa
**Mostrar todos los archivos** y encuentra también los que no son markdown, abriendo cada uno igual
que lo haría un clic en la barra lateral — los formatos propios de VMark en una pestaña, todo lo demás
en la aplicación predeterminada del sistema. Las carpetas de la lista que siempre se omite
(`.git`, `node_modules`, `.vscode` y las demás) quedan fuera de ambos.

| Acción | Atajo |
|--------|-------|
| Abrir Apertura Rápida | `Mod + O` |
| Navegar resultados | `Arriba / Abajo` |
| Abrir archivo seleccionado | `Enter` |
| Cerrar | `Escape` |

::: tip
Sin un espacio de trabajo, la Apertura Rápida sigue funcionando — muestra los archivos recientes y las pestañas abiertas, pero no puede buscar en el árbol de archivos.
:::

## Búsqueda de Contenido en el Espacio de Trabajo

Cuando hay un espacio de trabajo abierto, VMark puede buscar a través del **contenido de los archivos** (no solo nombres de archivo). De forma predeterminada busca en los tipos de archivo que VMark abre (Markdown, texto plano, YAML y JSON/TOML/Mermaid/SVG/HTML cuando su compatibilidad de formato está activada). Desactiva el conmutador **.md** (**Solo tipos de archivo compatibles**) para buscar en todos los archivos de texto (los binarios siempre se omiten).

| Acción | Atajo |
|---|---|
| Abrir el panel de búsqueda de contenido | `Mod + Shift + H` (también **Editar → Buscar → Buscar en archivos...**) |
| Saltar al siguiente resultado | `Enter` (o teclas de flecha para navegar) |
| Abrir el resultado en una nueva pestaña | Haz clic en la vista previa de la coincidencia |

Cada resultado muestra la ruta del archivo, número de línea y un fragmento con el texto coincidente resaltado. Los resultados no se ordenan: los archivos aparecen en el orden en que la búsqueda los alcanza al recorrer las carpetas del espacio de trabajo. Una búsqueda se detiene tras 50 archivos con coincidencias, 1.000 coincidencias o 5 segundos, y muestra lo que haya encontrado hasta ese momento.

**Excluidos por defecto**: las carpetas en las que VMark nunca entra — `.git`, `node_modules`, `.obsidian`, `.svn`, `__pycache__`, `.DS_Store`, `.vscode`, `.idea`, `target`, `.next`, `dist`, `.superpowers` — además de cualquier nombre incluido en **Carpetas excluidas** en Configuración del Espacio de Trabajo (un espacio de trabajo nuevo empieza con `.git` y `node_modules` ahí).

**Archivos ocultos**: la búsqueda de contenido siempre omite los archivos de puntos, diga lo que diga el alternador **Mostrar archivos ocultos** del explorador de archivos.

Esto es distinto de [Apertura Rápida](#apertura-rapida), que busca solo *nombres de archivo* — la búsqueda de contenido abre el archivo coincidente con el cursor situado en la línea coincidente.

## Espacios de Trabajo Recientes

VMark recuerda hasta 10 espacios de trabajo abiertos recientemente. Accede a ellos desde **Archivo > Espacios de Trabajo Recientes** en la barra de menú.

- Los espacios de trabajo están ordenados por la hora de la última apertura (el más reciente primero)
- La lista se sincroniza con el menú nativo en cada cambio
- Elige **Limpiar Espacios de Trabajo Recientes** para restablecer la lista

## Configuración del Espacio de Trabajo

Cada espacio de trabajo tiene su propia configuración que persiste entre sesiones. La configuración se almacena en el directorio de datos de la aplicación VMark — no dentro de la carpeta del proyecto — para mantener tu espacio de trabajo limpio.

Las siguientes configuraciones se guardan por espacio de trabajo:

| Configuración | Descripción |
|---------------|-------------|
| Carpetas excluidas | Carpetas ocultas del explorador de archivos |
| Mostrar archivos ocultos | Si los archivos de puntos son visibles |
| Mostrar todos los archivos | Si los archivos que no son markdown son visibles |
| Últimas pestañas abiertas | Rutas de archivos para la restauración de sesión en la próxima apertura |

::: tip
La configuración del espacio de trabajo está vinculada a la ruta de la carpeta. Abrir la misma carpeta en la misma máquina siempre restaura tu configuración, incluso desde una ventana diferente.
:::

## Ventana de Espacio de Trabajo Vacía

Cerrar el último documento abierto ya no cierra la ventana. En su lugar, la ventana permanece abierta en una **pantalla de bienvenida** y — si tienes un espacio de trabajo abierto — su barra lateral y su árbol de archivos siguen visibles. Funciona igual en macOS, Windows y Linux.

La pantalla de bienvenida ofrece acciones rápidas para volver al trabajo:

- Los botones **Nuevo archivo**, **Abrir archivo** y **Abrir espacio de trabajo…**
- Una lista de **Archivos recientes** y otra de **Espacios de trabajo recientes** — haz clic en cualquier
  entrada para volver a abrirla. Cada lista aparece solo cuando tiene entradas.

**Abrir archivo** y las listas de recientes reutilizan la ventana en la que ya estás. Una
ventana con la pantalla de bienvenida no tiene pestañas que desplazar, así que nada se abre en
una segunda ventana — salvo que la ventana aún tenga un espacio de trabajo abierto, en cuyo caso
un archivo de fuera de ese espacio de trabajo obtiene su propia ventana en lugar de sustituir el
árbol de archivos que todavía ves en la barra lateral.

La barra de título de una ventana con la pantalla de bienvenida muestra **VMark**: no hay ningún
documento abierto, así que no hay ningún nombre de archivo que mostrar.

Para cerrar la propia ventana, usa el botón rojo del semáforo, `Cmd/Ctrl + Q` (salir) o pulsa `Cmd/Ctrl + W` de nuevo mientras se muestra la pantalla de bienvenida.

## Documentos Lado a Lado

Abre dos documentos **distintos** a la vez — divide el editor en dos paneles, cada
uno con su propio documento. Útil para la lectura o traducción bilingüe (el original
a un lado, la traducción al otro) o para tener una referencia abierta mientras escribes.
Es distinto de la **Vista dividida de Markdown** (`Shift + F6`), que muestra el
código fuente + la vista previa del *mismo* archivo.

- Activa o desactiva la división con **`Alt + Mod + \`** o desde la paleta de comandos
  (**Dividir editor — dos documentos**). El documento actual se queda en un panel
  y el documento que usaste más recientemente antes que él (o, si no hay ninguno, otro documento abierto) se abre en el otro — el
  mismo documento nunca se muestra dos veces, así que la división necesita dos documentos abiertos.
  Haz clic en una pestaña mientras un panel tiene el foco para cambiar el documento de ese panel, o
  haz clic derecho en una pestaña y elige **Abrir al lado**.
- Arrastra el divisor (o enfócalo y usa las teclas de flecha) para cambiar el tamaño de los paneles.
- El panel que estás editando es el panel **enfocado** — la barra de herramientas, la barra de búsqueda y
  los comandos del menú actúan sobre él.
- Activa **Sincronizar el desplazamiento entre paneles divididos** (paleta de comandos) para desplazar ambos
  lados a la vez de forma proporcional — útil para alinear una traducción.

## Restauración de Sesión

Cuando cierras una ventana que tiene un espacio de trabajo abierto, VMark guarda la lista de pestañas abiertas en la configuración del espacio de trabajo. La próxima vez que abras el mismo espacio de trabajo, esas pestañas se restauran automáticamente.

- Solo se restauran las pestañas con una ruta de archivo guardada (las pestañas sin título no se persisten)
- Si un archivo fue movido o eliminado desde la última sesión, se omite silenciosamente
- Los datos de sesión se guardan al cerrar la ventana y al cerrar el espacio de trabajo (**Archivo > Cerrar Espacio de Trabajo**)

## Múltiples Ventanas

Cada ventana de VMark puede tener su propio espacio de trabajo independiente. Esto te permite trabajar en múltiples proyectos simultáneamente.

- **Archivo > Nueva Ventana** abre una ventana nueva
- Abrir un espacio de trabajo en una nueva ventana no afecta a otras ventanas
- El tamaño y la posición de la ventana se recuerdan por ventana

Cuando arrastras un archivo markdown desde el Finder y la ventana actual ya tiene trabajo sin guardar, VMark abre el proyecto del archivo en una nueva ventana automáticamente.

### Abrir un archivo desde fuera del espacio de trabajo actual

Una ventana con un espacio de trabajo abierto conserva ese espacio de trabajo. Abrir un archivo
que está en otro lugar — desde el Finder o el Explorador, desde **Archivo > Abrir** o desde Archivos
recientes — lo abre en una **nueva ventana** con raíz en su propia carpeta, de modo que el árbol de
archivos en el que estabas trabajando se queda donde está. Solo una ventana sin espacio de trabajo
propio recibe el archivo en el lugar.

En Windows y Linux, hacer doble clic en un archivo cuyo tipo está asociado a VMark ahora
lo entrega al VMark que ya tienes en ejecución en lugar de iniciar una segunda copia.
macOS siempre ha funcionado así.

### Separar Pestañas en Nuevas Ventanas

Puedes sacar una pestaña de su ventana para crear una nueva:

- **Arrastra una pestaña fuera de la barra de pestañas** — a más de unos 40 px por encima o por debajo de ella — para separarla. Suéltala sobre otra ventana de VMark para mover la pestaña a esa ventana; suéltala en cualquier otro lugar para abrirla en una nueva ventana en la posición del puntero
- **Arrastra una pestaña horizontalmente** dentro de la barra de pestañas para reordenarla entre otras pestañas
- Las pestañas fijadas no se pueden arrastrar

Una notificación toast confirma el movimiento y ofrece **Deshacer**, que devuelve la pestaña. Las pestañas del navegador y la última pestaña de la ventana principal no se pueden sacar arrastrando; vuelven a su sitio.

El gesto está bloqueado por dirección: el movimiento horizontal inicia un reordenamiento, mientras que el movimiento vertical activa una separación. Puedes cambiar de reordenamiento a separación a mitad del arrastre moviendo el puntero fuera de la barra de pestañas.

### Panel de Estado de Ventanas

Cuando ejecutas Claude Code en varias ventanas, **Vista > Mostrar/ocultar estado de ventanas** (también en la paleta de comandos, o pulsando `Ctrl + Shift + 5`) abre un panel que enumera todas las demás ventanas abiertas con su estado en vivo y te permite saltar directamente a cualquiera de ellas.

Cada fila muestra el nombre del documento de la ventana y su estado actual:

| Estado | Significado |
|--------|-------------|
| **Requiere atención** | Un terminal de esa ventana (sin foco) hizo sonar la campana — Claude Code la hace sonar cuando termina un turno o cuando te está esperando |
| **En ejecución** | Un genio de IA de VMark se está ejecutando en esa ventana |
| **Error** | La última ejecución de un genio de IA falló |
| **Inactiva** | No se está ejecutando nada |

Las filas se ordenan poniendo primero la atención, de modo que la ventana que te necesita queda arriba. Haz clic en cualquier fila para enfocar y traer al frente esa ventana; enfocar una ventana borra su marca de «requiere atención». El estado procede de dos señales fiables — el propio estado de invocación de los genios de IA de VMark y la campana del terminal — no del análisis de la salida del terminal.

**Fija el panel** para usarlo como «centro de control» persistente: mientras está fijado, hacer clic en una fila enfoca la ventana de destino pero deja el panel abierto, así que puedes saltar entre varias ventanas sin volver a abrirlo. El botón de fijar de la cabecera abre un pequeño menú con dos ámbitos:

- **Fijar esta ventana** — fija el panel solo en la ventana actual. Su estado abierto y fijado se recuerda por ventana entre reinicios, de modo que una ventana que configures como tu panel de control se queda así.
- **Fijar todas las ventanas** — una fijación global: todas las ventanas abren automáticamente el panel y se comportan como fijadas, *incluidas las ventanas que abras más adelante*, así que eliges la disposición de centro de control una sola vez en lugar de configurar cada ventana a mano. Al desactivarla, cada ventana vuelve a su propio estado de fijación por ventana.

## Cambios Externos

VMark monitorea tu espacio de trabajo en busca de cambios realizados por otros programas (Git, editores externos, herramientas de compilación, etc.) y mantiene los documentos abiertos sincronizados.

- **Los archivos sin modificar** se recargan automáticamente cuando su contenido cambia en disco. Una breve notificación toast confirma la recarga.
- **Los archivos con cambios sin guardar** activan un cuadro de diálogo con tres opciones: **Guardar como** (guardar tu versión en una nueva ubicación), **Recargar** (descartar tus cambios y cargar desde disco) o **Mantener** (preservar tus ediciones y marcar el archivo como divergente).
- **Los archivos eliminados** se marcan como faltantes en su pestaña pero no se cierran — puedes guardar el contenido en una nueva ubicación.
- Cuando múltiples archivos modificados cambian a la vez (por ejemplo, después de un `git checkout`), VMark los agrupa en un único diálogo para que puedas recargar todos, mantener todos o revisar cada archivo individualmente.
- Si el contenido en disco de un archivo divergente luego coincide con lo que tienes en el editor (por ejemplo, un `git checkout` restaura el mismo texto), VMark limpia automáticamente el estado divergente para que el autoguardado normal se reanude.

VMark filtra sus propios guardados para que nunca se te solicite por cambios que hiciste dentro de la aplicación.

## Documentos Recientes del Dock de macOS

Los documentos que abres en VMark se registran con macOS, así que aparecen en el submenú **Abrir recientes** cuando haces clic derecho en el icono de VMark en el Dock.

## Integración con el Terminal

El terminal integrado usa automáticamente la raíz del espacio de trabajo como su directorio de trabajo. Cuando abres o cambias de espacio de trabajo, las sesiones del terminal inactivas ejecutan `cd` a la nueva raíz. Una sesión ocupada ejecutando un comando no se interrumpe y cambia de directorio cuando el comando termina (para saber cuándo está ocupada se necesita la integración del shell). Con la [barra de espacios de trabajo](/es/guide/workspace-rail) activada, una sesión que pertenece a un espacio de trabajo conserva su propio directorio.

La variable de entorno `VMARK_WORKSPACE` se establece con la ruta del espacio de trabajo en cada sesión del terminal, para que tus scripts puedan referenciar la raíz del proyecto.

[Más información sobre el terminal →](/es/guide/terminal)

## Comando CLI de Shell

VMark puede instalar un comando de shell `vmark` para que puedas abrir archivos y carpetas desde el terminal.

### Instalación y eliminación

**Ayuda → Comando de shell: instalar 'vmark' en PATH…** es un único elemento que alterna. Cuando no hay ningún comando `vmark` instalado, escribe un pequeño script lanzador en `/usr/local/bin/vmark` y pide tu contraseña de administrador (el mismo enfoque que usa VS Code para su comando `code`). Cuando el script propio de VMark ya está ahí, el mismo elemento lo elimina. En ambos casos, un cuadro de diálogo informa del resultado. Solo en macOS.

### Uso

```bash
# Abrir un archivo
vmark README.md

# Abrir una carpeta como espacio de trabajo
vmark ~/projects/my-blog

# Abrir múltiples archivos
vmark chapter1.md chapter2.md
```

El comando delega a `open -b app.vmark`, así que macOS maneja el comportamiento de instancia única — los archivos se abren en tu ventana existente de VMark en lugar de iniciar un nuevo proceso.

Si el archivo en `/usr/local/bin/vmark` no lo escribió VMark, el elemento no toca nada y te pide que lo elimines manualmente.
