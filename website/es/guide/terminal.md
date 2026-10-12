# Terminal Integrado

VMark incluye un panel de terminal integrado para que puedas ejecutar comandos sin salir del editor.

Presiona `` Ctrl + ` `` para mostrar u ocultar el panel del terminal. Al abrirlo, el cursor pasa al shell, y al cerrarlo el cursor vuelve al editor — así el panel es accesible y se puede abandonar sin tocar el ratón.

Para moverte entre el editor y un terminal ABIERTO sin ocultarlo, presiona `` Ctrl + Shift + ` `` (**Enfocar la terminal o el editor**; `` Alt + Shift + ` `` en Windows y Linux). Alterna en ambas direcciones y nunca cambia la visibilidad del panel — si el terminal está oculto, lo abre en lugar de no hacer nada.

## Sesiones

El terminal admite hasta 5 sesiones concurrentes, cada una con su propio proceso de shell. Una barra de pestañas vertical en el lado derecho muestra las pestañas de sesión numeradas.

| Acción | Cómo |
|--------|------|
| Nueva sesión | Haz clic en el botón **+** |
| Cambiar sesión | Haz clic en un número de pestaña |
| Cerrar sesión | Haz clic en el icono de papelera |
| Reiniciar shell | Haz clic en el icono de reinicio |
| Renombrar sesión | Haz doble clic en una pestaña, escribe un nombre y presiona `Enter` (`Escape` cancela) |
| Cambiar el lado del panel | Haz clic en el icono de intercambio (↕ / ↔) para mover el terminal al lado opuesto de su eje actual. En modo **Automático** se mantiene el cambio inteligente según la proporción (horizontal → lateral, vertical → abajo/arriba) — solo elige el otro extremo. |
| Maximizar el panel | Haz doble clic en el control de redimensionado; vuelve a hacer doble clic para restaurar |

Cuando cierras la última sesión, el panel se oculta pero la sesión sigue activa — vuelve a abrirlo con `` Ctrl + ` `` y estarás donde lo dejaste. Cuando el shell termina limpiamente (`exit` o `Ctrl + D`), su pestaña se cierra automáticamente — y el panel se oculta si era la última. Si el shell termina con un error, la pestaña permanece abierta mostrando el código de salida; presiona cualquier tecla para reiniciarlo.

Cerrar una sesión — con el icono de papelera, cerrando su ventana o saliendo de VMark — termina todo lo que se inició en ella, no solo el shell. VMark envía una señal de colgado (`SIGHUP`) a todo el grupo de procesos del shell, espera hasta un segundo a que termine y luego fuerza la terminación (`SIGKILL`) de lo que quede. Un trabajo que hayas separado deliberadamente en su propio grupo de procesos (por ejemplo con `nohup` o `setsid`) no se ve afectado. En Windows no hay paso de colgado: el shell se termina de inmediato.

**Notificaciones:** cuando un terminal hace sonar la campana (p. ej., Claude Code termina un turno) mientras esa ventana de VMark no está enfocada, VMark publica una notificación del sistema con el nombre del documento de la ventana — así puedes ejecutar Claude Code en varias ventanas y recibir un aviso de la que te necesita, sin vigilar cada una. Actívalo o desactívalo con **Ajustes → Terminal → Notificar cuando no está enfocada** (activado por defecto; pide permiso de notificaciones la primera vez). La misma señal de campana sin foco también marca la ventana en el [panel Estado de ventanas](/es/guide/workspace-management#panel-de-estado-de-ventanas), para que veas qué ventana te necesita y vayas directamente a ella.

Cada pestaña refleja el título del programa en ejecución (definido por herramientas que emiten un título de terminal, como `vim` o `ssh`), salvo que hayas renombrado la sesión manualmente — un cambio de nombre manual siempre tiene prioridad. Para renombrar, **haz doble clic en la pestaña**: `Enter` confirma, `Escape` descarta, y hacer clic fuera conserva lo que escribiste. Un nombre vacío se ignora.

**Maximizar:** el tamaño del panel se detiene en el 80 % del espacio disponible para que el editor siga siendo accesible, y un **doble clic en el control de redimensionado** lo ajusta a ese límite. Un segundo doble clic lo devuelve al tamaño guardado. Es una alternancia de vista — nunca cambia el tamaño que configuraste.

**Abrir terminal aquí:** haz clic derecho en cualquier carpeta del explorador de archivos y elige **Abrir terminal aquí** para iniciar una sesión en ese directorio. La nueva sesión se abre allí independientemente de dónde estén tus otras sesiones. Con cinco sesiones, el elemento aparece atenuado.

## Sesiones del terminal y la barra de espacios de trabajo

Con la [barra de espacios de trabajo](/es/guide/workspace-rail) activada, cada espacio de trabajo de la barra tiene su **propio conjunto** de sesiones de terminal. Cambiar de espacio de trabajo intercambia las pestañas de terminal visibles — los shells del espacio de trabajo oculto se quedan exactamente donde estaban: vivos, en el mismo directorio de trabajo, sin que se escriba nada en ellos. Al volver se muestran de nuevo los mismos shells, y la sesión que estabas viendo se recuerda por espacio de trabajo.

- Las sesiones nuevas pertenecen al espacio de trabajo que estaba activo cuando se crearon, y comienzan en la raíz de ese espacio de trabajo.
- El límite de 5 sesiones y la numeración `Terminal 1…5` se aplican al conjunto **visible** — las sesiones de los espacios de trabajo ocultos no consumen el margen del espacio de trabajo activo.
- Abrir el panel sobre un espacio de trabajo sin sesiones crea una allí automáticamente; sin un espacio de trabajo (o un archivo guardado que ancle un directorio) el panel muestra una indicación en su lugar.
- Cerrar un espacio de trabajo desde la barra, o moverlo a su propia ventana, cierra sus sesiones de terminal con él.
- Con la barra **desactivada**, todo se comporta como antes: un único conjunto de sesiones para toda la ventana cuyos shells inactivos siguen los cambios de espacio de trabajo con un `cd`.

## Atajos de Teclado

Estos atajos funcionan cuando el panel del terminal está enfocado:

| Acción | Atajo |
|--------|-------|
| Copiar | `Mod + C` (con selección) |
| Pegar | `Mod + V` |
| Limpiar | `Mod + K` |
| Buscar | `Mod + F` |
| Inicio / fin de línea | `Cmd + ←` / `Cmd + →` (macOS) |
| Eliminar línea | `Cmd + ⌫` (macOS) |
| Zoom de la fuente del terminal | `Mod + =` / `Mod + -` / `Mod + 0` |
| Seleccionar toda la salida del terminal | `Mod + A` |
| Cambiar a la sesión 1 … 5 | `Mod + 1` … `Mod + 5` |
| Alternar Terminal | `` Ctrl + ` `` |
| Enfocar la terminal o el editor | `` Ctrl + Shift + ` `` |
| Prompt de comando anterior | `Mod + ↑` |
| Prompt de comando siguiente | `Mod + ↓` |

Cuando el terminal está enfocado, `Mod + =` / `-` / `0` ajustan el zoom de la fuente del **terminal** (configurada por separado en los ajustes del Terminal), no la del editor, y `Mod + F` abre la búsqueda del **terminal** en lugar de la barra de búsqueda del editor.

La navegación entre prompts (`Mod + ↑` / `Mod + ↓`) requiere la integración con el shell — consulta [Integración con el shell](#integracion-con-el-shell) más abajo.

**Linux:** `Ctrl` + una letra va al shell, así que las teclas de readline como `Ctrl + A`, `Ctrl + E`, `Ctrl + K`, `Ctrl + F`, `Ctrl + U` y `Ctrl + W` funcionan como en cualquier terminal de Linux. Los atajos de letra propios de la terminal pasan a `Ctrl + Shift`: `Ctrl + Shift + F` busca, `Ctrl + Shift + K` limpia, `Ctrl + Shift + A` selecciona todo, y `Ctrl + Shift + C` / `Ctrl + Shift + V` copian y pegan. `Ctrl + C` sigue copiando una selección (si no la hay, envía SIGINT) y `Ctrl + V` sigue pegando; `Ctrl + Insert` / `Shift + Insert` también copian y pegan.

::: tip
`Mod + C` sin una selección de texto envía SIGINT al proceso en ejecución — igual que presionar Ctrl+C en un terminal normal.
:::

## Leer el historial mientras escribes

Desplázate hacia arriba para leer la salida anterior y sigue escribiendo: la vista se queda donde estás y en la parte inferior del terminal aparece un **prompt flotante** con una copia en vivo de las filas en las que escribes — el prompt del shell o el cuadro de entrada de una TUI como Claude Code. Las teclas siguen llegando al shell, así que el autocompletado con Tab, el historial y los métodos de entrada funcionan como siempre. Haz clic en la flecha de su extremo derecho para volver al prompt; desaparece sola cuando el prompt vuelve a estar a la vista. Pulsar Enter o Ctrl+C también vuelve abajo, para que veas qué hace el comando — o el prompt que enviaste a una TUI — a continuación; cualquier otra tecla, incluida Mayús+Enter, deja la vista donde está. Los programas a pantalla completa (vim, less) no tienen historial, así que nunca aparece allí.

## Búsqueda

Presiona `Mod + F` para abrir la barra de búsqueda. Escribe para buscar de forma incremental en el buffer del terminal.

| Acción | Atajo |
|--------|-------|
| Siguiente coincidencia | `Enter` |
| Coincidencia anterior | `Shift + Enter` |
| Cerrar búsqueda | `Escape` |

La barra informa de lo que encontró junto al campo de entrada:

- **`3 / 17`** — estás en la tercera de diecisiete coincidencias.
- **`5000 matches`** — demasiadas coincidencias para que el terminal sepa
  cuál está activa, así que informa del total sin posición.
- **Sin resultados** — la consulta no coincidió con nada; el texto del campo
  también se vuelve rojo.

Entre el campo de entrada y las flechas hay tres alternadores:

| Alternador | Efecto |
|------------|--------|
| **Aa** | Distinguir mayúsculas y minúsculas |
| **ab** | Solo palabras completas |
| **.\*** | Tratar la consulta como una expresión regular |

Con el modo de expresión regular activado, un patrón a medio escribir (`[` camino
de `[a-z]`) simplemente no muestra resultados en lugar de producir un error —
sigue escribiendo. Los alternadores se restablecen cada vez que cierras la barra
o cambias de sesión.

## Menú Contextual

Haz clic derecho dentro del terminal para acceder a:

- **Copiar** — copiar el texto seleccionado (deshabilitado cuando no hay nada seleccionado)
- **Copiar sin saltos de línea** — copia la selección eliminando los saltos de línea debidos al ancho de visualización. Algunos programas de línea de comandos (codex y otras aplicaciones TUI) ajustan su salida al ancho del terminal insertando saltos de línea reales; una copia normal conserva esos saltos. "Copiar sin saltos de línea" vuelve a unir las líneas ajustadas en párrafos continuos (las líneas en blanco se mantienen como separaciones de párrafo). Tiene en cuenta el texto CJK — el texto chino/japonés se une sin insertar espacios. Selecciona el bloque que sabes que es un único flujo lógico, ya que VMark no puede distinguir un salto de ajuste de uno intencionado.
- **Pegar** — pegar desde el portapapeles al shell
- **Seleccionar todo** — seleccionar todo el buffer del terminal
- **Limpiar** — limpiar la salida visible
- **Restablecer visualización** — vuelve a pintar el terminal y restablece su caché de renderizado. Úsalo si los caracteres empiezan a superponerse, mezclan mayúsculas y minúsculas o se ven corruptos tras una sesión larga — algo que se ve sobre todo al ejecutar durante horas CLIs con mucho estilo (p. ej., Claude Code). Los terminales de una misma ventana comparten una caché de glifos, así que esto vuelve a pintar todos los terminales de la ventana, no solo la pestaña activa.
- **Copiar salida del comando** — copia todo lo que imprimió un comando, sin su línea de prompt y sin la salida del comando siguiente. Solo aparece cuando haces clic derecho dentro de la salida de un comando y la [integración con el shell](#integracion-con-el-shell) está activada, ya que es lo que indica a VMark dónde empezó y terminó cada comando.

El menú se puede usar por completo con el teclado: se abre con la primera acción disponible enfocada, las flechas se mueven entre los elementos (saltando los deshabilitados), Inicio/Fin saltan al primero/último, Enter o Espacio activan, y Escape o Tab lo cierran.

## Ejecutar un bloque de código

Pasa el puntero sobre cualquier bloque `bash`, `sh`, `zsh` o `shell` — o un
bloque de transcripción etiquetado `console`, `shell-session`, `shellsession` o
`terminal` — en tu documento y aparecerá un botón **▶ Ejecutar en la terminal**
junto al botón de copiar. Pega el bloque en el terminal — mostrando el panel e
iniciando una sesión si hace falta — y se detiene ahí.

::: warning Pega; no ejecuta
El comando se coloca en la línea de entrada del shell y **nunca se ejecuta por
ti**: no se añade un salto de línea, así que no pasa nada hasta que *tú*
presionas Enter. Lee primero lo que ha llegado ahí — un documento puede venir de
cualquier parte, y un bloque de código es solo texto que alguien escribió.
:::

En un bloque de transcripción (`console`, `shell-session`, `shellsession`,
`terminal`) — una sesión pegada — se eliminan los prompts iniciales `$ `, `% ` y
`# ` para que obtengas el comando y no el prompt. En un bloque `bash` se dejan
tal cual, ya que ahí forman parte del código fuente.

## Enlaces Clicables

El terminal detecta tres tipos de enlaces en la salida de comandos:

- **URLs web** — haz clic para abrir en tu navegador predeterminado
- **Hipervínculos OSC 8** — hipervínculos de terminal explícitos que emiten herramientas como `ls --hyperlink=auto`, `gh` y los compiladores modernos. El texto visible y la URL subyacente pueden diferir; al hacer clic se abre la URL.
- **Rutas de archivo** — una ruta que contiene una `/` y termina en una extensión de archivo; haz clic para abrir el archivo en el editor (admite sufijos `:line:col`; una ruta relativa se resuelve respecto al directorio actual del shell cuando la [integración con el shell](#integracion-con-el-shell) lo informa, y si no, respecto a la raíz del espacio de trabajo)

## Entorno de Shell

VMark establece estas variables de entorno en cada sesión del terminal:

| Variable | Valor |
|----------|-------|
| `TERM` | `xterm-256color` |
| `TERM_PROGRAM` | `WezTerm` |
| `TERM_PROGRAM_VERSION` | `20240203-110809-5046fc22` |
| `VMARK_WORKSPACE` | Ruta raíz del espacio de trabajo (cuando hay una carpeta abierta) |
| `PATH` | PATH completo del shell de inicio de sesión (igual que en tu terminal del sistema) |
| `COLORTERM` | `truecolor` |
| `LC_CTYPE` | `UTF-8` — **solo macOS** |

`TERM_PROGRAM` indica `WezTerm`, no `vmark`, y es deliberado. Varias
herramientas CLI — entre ellas `/terminal-setup` de Claude Code — activan la
codificación de teclas [CSI u](https://invisible-island.net/xterm/modified-keys.html)
solo para los terminales de una lista fija, y recurren a una ruta degradada de
"terminal desconocido" para todos los demás. VMark habla ese protocolo, así que
se identifica como el terminal de la lista cuyo comportamiento más se parece al
suyo. Cambiar este valor a `vmark` rompería silenciosamente Shift+Enter y otras
secuencias de teclas modificadas en esas herramientas. Consulta
[ADR-006](https://github.com/xiaolai/vmark/blob/main/dev-docs/decisions/ADR-006-terminal-program-identity.md).

`LC_CTYPE=UTF-8` se establece **solo en macOS**. Una aplicación gráfica abierta
desde el Dock o Spotlight apenas hereda entorno allí, así que sin él el shell
recurre a la configuración regional C y las herramientas imprimen `?` para el
texto CJK. El nombre simple `UTF-8` es una configuración regional en macOS y
*no* lo es en Linux, así que establecerlo allí sustituiría una configuración
regional heredada perfectamente válida por una inválida — todos los programas
que llaman a `setlocale()` protestarían. En Linux y Windows se heredan sin
cambios los `LANG` / `LC_*` de tu propia sesión de escritorio.

VMark deliberadamente **no** establece `EDITOR`. Tu propio `$EDITOR` — lo que
exporte tu configuración del shell — es lo que abrirán `git commit`,
`crontab -e` y similares. (VMark forzaba antes `EDITOR=vmark`, pero el comando
`vmark` es opcional y regresa de inmediato en lugar de esperar a que cierres la
pestaña, así que `git commit` fallaba con "command not found" o con un mensaje
de commit vacío. Que funcione requiere un protocolo bloqueante `vmark --wait`,
que aún no existe.)

El terminal integrado hereda el `PATH` de tu shell de inicio de sesión, por lo que las herramientas CLI como `node`, `claude` y otros binarios instalados por el usuario son detectables — igual que en una ventana de terminal normal.

Salvo que elijas un shell en la configuración del terminal, VMark inicia tu shell de inicio de sesión. El shell que elijas debe ser uno que VMark ofrezca — en macOS y Linux, un shell listado en `/etc/shells` (o tu shell de inicio de sesión) que exista y sea ejecutable; en Windows, PowerShell, `pwsh`, `cmd.exe` o `%COMSPEC%` — indicado como ruta absoluta. Una elección guardada que ya no está disponible aparece como *(no disponible)* en los ajustes, y VMark inicia en su lugar tu shell predeterminado. En macOS y Linux lee primero el shell de inicio de sesión de la entrada de tu cuenta de usuario, luego `$SHELL`, y recurre a `/bin/sh`. En Windows usa `%COMSPEC%` y, si no está definido, la ruta completa de `cmd.exe`. El directorio de trabajo comienza en la raíz del espacio de trabajo, o el directorio principal del archivo activo, o `$HOME`.

Los atajos de shell estándar como `Ctrl+R` (búsqueda inversa del historial en zsh/bash) funcionan cuando el terminal está enfocado — el editor no los intercepta.

Cuando la raíz del espacio de trabajo cambia después de que el terminal ya está en ejecución, las sesiones inactivas cambian automáticamente su directorio a la nueva raíz mediante `cd`. Una sesión ocupada con un comando (por ejemplo, `vim` o `less`) no se interrumpe: cambia de directorio cuando el comando termina, lo que requiere la [integración con el shell](#integracion-con-el-shell) para detectarlo. Con la [barra de espacios de trabajo](/es/guide/workspace-rail) activada, las sesiones que pertenecen a un espacio de trabajo conservan su propio directorio.

## Micrófono, cámara y Apple Events en macOS

Los programas que ejecutas en el terminal integrado pueden solicitar el micrófono, la cámara o permiso para controlar otras apps (Apple Events, que usa `osascript`). macOS pregunta en nombre de VMark, porque considera a VMark la app responsable de todo lo que inicia su terminal. Permite el acceso cuando macOS lo pregunte; puedes cambiarlo más adelante en **Ajustes del Sistema → Privacidad y seguridad**, en **Micrófono**, **Cámara** o **Automatización**. La solicitud se produce cuando un programa usa el recurso por primera vez, no al abrir el terminal.

Si un programa graba silencio, captura un fotograma negro o muestra un error de «no autorizado» sin que aparezca ninguna solicitud, comprueba en la página de ajustes correspondiente que VMark aparece en la lista y está permitido. Al informar del problema, incluye la salida del programa.

Con entradas de audio virtuales como BlackHole, el permiso por sí solo no enruta el audio. Selecciona la entrada deseada en tu herramienta de grabación, enruta el audio hacia ella y verifica una grabación corta antes de una sesión larga: que un archivo de audio crezca no demuestra por sí solo que se haya capturado sonido. VMark no incluye grabadora ni transcriptor; esos comandos los proporcionan herramientas que instalas por separado.

## Aún no implementado

Estas funciones están registradas pero **no** se incluyen hoy. Se enumeran aquí
porque versiones anteriores de esta página describían algunas como si
existieran:

- **Pausar / Reanudar una sesión.** VMark puede suspender internamente un
  proceso de shell — lo hace automáticamente como control de flujo cuando la
  salida llega más rápido de lo que el terminal puede renderizarla — pero no hay
  un control visible para el usuario, ni un menú contextual en la pestaña de
  sesión donde colocarlo.
- **Un `vmark --wait` bloqueante** para que `$EDITOR` pueda apuntar a VMark
  (consulta [Entorno de Shell](#entorno-de-shell) más arriba).
- **Persistencia del historial de desplazamiento entre reinicios** (consulta
  [Persistencia](#persistencia)).
- **Integración con el shell fish** (consulta
  [Integración con el shell](#integracion-con-el-shell)).

## Configuración

Abre **Ajustes → Terminal** para configurar:

| Configuración | Rango | Predeterminado | Plataformas |
|---------------|-------|----------------|-------------|
| Tamaño del panel | 10 % – 80 % del espacio disponible, en pasos del 5 % | 40 % | Todas |
| Tamaño de Fuente | 10 – 24 px | 13 px | Todas |
| Altura de Línea | 1.0 – 2.0 | 1.2 | Todas |
| Copiar al Seleccionar | Activado / Desactivado | Desactivado | Todas |
| Mostrar transcripciones automáticamente | Activado / Desactivado | Desactivado | Todas |
| Tecla Option de Mac como Meta | Activado / Desactivado | Activado | macOS |
| Integración con el shell | Activado / Desactivado | Activado | macOS / Linux (zsh, bash) |
| Portapapeles remoto (OSC 52) | Activado / Desactivado | Activado | Todas |
| Historial de desplazamiento | 1.000 / 5.000 / 10.000 / 50.000 líneas | 5.000 | Todas |
| Modo lector de pantalla | Activado / Desactivado | Desactivado | Todas |

### Mostrar transcripciones automáticamente

Activa **Mostrar transcripciones automáticamente** para ver el Markdown del asistente, tablas seleccionables y diagramas Mermaid en una sección de transcripción con formato dentro del área del terminal. Se sitúa a la derecha de la CLI cuando el terminal está arriba o abajo, y debajo de ella cuando el terminal está a la izquierda o a la derecha; la CLI interactiva sigue siendo utilizable a su lado.

La sección empieza contraída. Se abre sola cuando una nueva respuesta contiene una tabla o un diagrama Mermaid — las respuestas de texto sin formato, que el terminal ya muestra bien, la dejan cerrada. Haz clic en el botón de gráfico de la barra de pestañas del terminal (texto emergente **Transcripción con formato**) para mostrarla u ocultarla en cualquier momento; el botón aparece resaltado mientras se muestra la transcripción, y al ocultarla la CLI recupera toda el área; después de contraerla, permanece cerrada hasta la siguiente respuesta con una tabla o un diagrama. El contenido que ya está en la transcripción cuando la sesión se muestra por primera vez no la abre. Un terminal oculto deja de leer transcripciones.

Al habilitarla se añade un hook `SessionStart` local al `settings.json` de Claude Code y al `hooks.json` de Codex, conservando los hooks existentes. Después de habilitarla, inicia o reanuda Claude/Codex en un terminal de VMark; reinicia las sesiones que ya estén en ejecución. Codex puede pedirte que confíes en el nuevo hook la primera vez que se ejecute. Se requieren Node y una versión de la CLI con hooks de ciclo de vida. Los hooks deshabilitados explícitamente o restringidos por políticas, las sesiones SSH remotas y los directorios de configuración personalizados de la CLI que difieran del entorno de VMark no pueden proporcionar un vínculo.

Cada terminal sigue su sesión exacta en lugar de la transcripción modificada más recientemente. La vista previa conserva hasta 100 mensajes del asistente de los últimos 2 MiB de datos de la transcripción. El HTML sin procesar y las imágenes remotas permanecen inertes; los diagramas no válidos siguen siendo legibles como código fuente. Al deshabilitarla se elimina la sección con formato y se desactivan los hooks instalados por VMark.

### Accesibilidad

| Configuración | Opciones | Predeterminado |
|---------------|----------|----------------|
| Campana de terminal | Desactivada / Visual / Audible | Visual |
| Contraste mínimo | Desactivado / WCAG AA (4,5:1) / WCAG AAA (7:1) / Máximo | WCAG AA (4,5:1) |

La mayoría de los cambios se aplican inmediatamente a todas las sesiones abiertas — tamaño y posición del panel, tamaño de fuente, altura de línea, cursor, Copiar al Seleccionar, Tecla Option de Mac como Meta, Historial de desplazamiento, Modo lector de pantalla, Campana de terminal y Contraste mínimo. El **Intérprete de comandos**, el **Renderizador WebGL** (no disponible en Linux), el **Portapapeles remoto** y la **Integración con el shell** se fijan cuando se inicia una sesión, así que se aplican a las sesiones que se abran después. El **Tamaño del panel** llega hasta el 80 % del espacio disponible. El editor conserva un tamaño mínimo en píxeles, así que nunca desaparece del todo por grande que sea el terminal. Haz doble clic en el control de redimensionado para saltar directamente al máximo y volver sin cambiar el tamaño guardado. **Tecla Option de Mac como Meta** enruta la tecla Option de macOS como Meta en el terminal integrado para que emacs, tmux y herramientas similares vean los atajos con prefijo Alt (solo macOS); está activada por defecto, así que Option+Flecha mueve por palabras en lugar de insertar caracteres acentuados. La **Integración con el shell** está disponible en macOS y Linux (oculta en Windows). El **Portapapeles remoto** es solo de escritura (las lecturas se rechazan siempre) y se describe más abajo. El **Historial de desplazamiento** controla cuántas líneas de salida conserva cada sesión en su historial — los valores más altos usan más memoria. El **Modo lector de pantalla** expone la salida del terminal a tecnologías de asistencia como VoiceOver; está desactivado por defecto por rendimiento. La **Campana de terminal** elige cómo se señala una campana (BEL) — una marca visual de actividad en segundo plano en la pestaña de sesión, un pitido audible suave (que también marca la pestaña de una sesión en segundo plano para que la encuentres) o nada. El **Contraste mínimo** eleva el texto tenue del terminal a una relación de contraste legible respecto a su fondo; súbelo por accesibilidad o ponlo en Desactivado para anular el ajuste.

::: tip Familia de fuente del terminal
El terminal usa la **Fuente mono** de **Ajustes → Editor**, no una fuente
propia, así que cambiarla allí cambia a la vez el estilo de los bloques de
código, el modo Fuente y el terminal. En Linux, la opción Predeterminado del
sistema sigue la fuente monoespaciada de tu escritorio, que es la que usa tu
terminal del sistema.
:::

::: tip Tamaño de fuente y zoom
El tamaño de fuente del terminal es deliberadamente independiente del tamaño de
lectura del editor: un terminal es una superficie densa de supervisión, y su
valor predeterminado de 13 px coincide con el de los terminales independientes,
no con los 18 px de lectura. `Mod + =` / `Mod + -` hacen zoom en pasos de 2 px,
así que la fuente del terminal puede quedar en un valor que el desplegable no
incluye (13 → 15 → 17 …). El desplegable muestra el tamaño realmente en vigor,
añadiendo el valor con zoom a la lista en lugar de devolverte a un valor
predefinido.
:::

## Portapapeles remoto (OSC 52)

Copia dentro de una sesión `ssh`, dentro de `tmux` o en un editor remoto, y el
texto llega a **tu** portapapeles — no al de la máquina remota. Los programas lo
solicitan imprimiendo una secuencia de escape OSC 52; VMark la dirige al
portapapeles del sistema.

```bash
# Desde cualquier lugar donde el terminal pueda imprimir — también por ssh:
printf '\e]52;c;%s\a' "$(printf 'hello' | base64)"
```

::: warning Solo escritura — las lecturas se rechazan siempre
OSC 52 también define una forma de *leer* el portapapeles, y VMark **nunca**
responde a ella, ni siquiera con este ajuste activado. Cualquier proceso que
pueda imprimir bytes en tu terminal podría pedirlo — incluido `cat` sobre un
archivo que no escribiste — y la respuesta llegaría como si la hubieras
tecleado. iTerm2 y VS Code lo rechazan por el mismo motivo. El ajuste controla
las escrituras; las lecturas se rechazan incondicionalmente.
:::

Desactiva **Ajustes → Terminal → Portapapeles remoto** para cerrar el
canal por completo. El cambio se aplica a las sesiones creadas a partir de ese
momento.

## Integración con el shell

Cuando la **Integración con el shell** está activada, VMark inyecta marcadores
de comandos ligeros en el shell para que el terminal entienda dónde empieza y
termina cada comando. Esto habilita:

- **Navegación entre prompts** — `Cmd + ↑` / `Cmd + ↓` salta al prompt de
  comando anterior / siguiente en el historial de desplazamiento.
- **Indicadores de estado de salida** — una fina barra en el margen marca cada
  línea de comando en verde (éxito) o rojo (fallo).
- **Seguimiento en vivo del directorio de trabajo** — las rutas de archivo
  relativas en la salida se resuelven respecto al directorio actual del shell, y
  los terminales nuevos se abren allí.

Se admiten **zsh** y **bash**, en macOS y Linux. En ambos casos la inyección no
es destructiva — primero se carga tu configuración real, y los hooks de VMark se
añaden en lugar de sustituirla, así que tu prompt, tema y alias no se tocan.

| Shell | Cómo se engancha VMark | Qué conserva |
|---|---|---|
| zsh | `ZDOTDIR` apunta a un `.zshrc` generado que carga el tuyo y luego registra hooks con `add-zsh-hook` | Se respeta un `$ZDOTDIR` personalizado: VMark obtiene el real desde un shell de inicio de sesión y carga `.zshenv` y `.zshrc` desde allí, no solo desde `$HOME` |
| bash | `bash --rcfile <generated>`, que carga primero `~/.bashrc` | Un `PROMPT_COMMAND` existente y una trampa `DEBUG` existente se **combinan**, no se sustituyen — así `bash-preexec`, `direnv` y `atuin` siguen funcionando |

Como el terminal ejecuta un shell interactivo que no es de inicio de sesión, los
archivos solo de inicio de sesión (`.zprofile`, `.bash_profile`, `.profile`)
quedan fuera del alcance en ambos shells, igual que en una pestaña de terminal
normal.

fish todavía no está integrado; funciona con normalidad pero sin estas
funciones. Desactiva el ajuste para deshabilitar la inyección por completo. Los
cambios se aplican a las sesiones creadas a partir de ese momento (reinicia el
terminal para aplicarlos).

## Persistencia

El estado abierto o cerrado del panel del terminal se guarda y se restaura en los reinicios con salida en caliente. Su tamaño es el ajuste **Tamaño del panel** — una proporción de la ventana que se actualiza al arrastrar el control de redimensionado —, así que se conserva con tu configuración y sobrevive a cada reinicio, sea cual sea el lado en que esté el panel. Los procesos de shell en sí no pueden preservarse — se genera un nuevo shell para cada sesión al reiniciar. El historial de desplazamiento tampoco se conserva: restaurarlo implicaría escribir en disco todo lo que pasó por tu terminal (claves de API incluidas), así que se deja deliberadamente para un diseño que resuelva eso primero.
