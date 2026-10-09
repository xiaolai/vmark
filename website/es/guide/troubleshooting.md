# Solución de problemas

## Búsqueda Rápida

Problemas comunes y dónde encontrar la solución:

| Síntoma | Causa probable | Dónde mirar |
|---|---|---|
| El cliente MCP no se conecta | Archivo de puerto obsoleto o VMark no en ejecución | [Problemas de conexión del servidor MCP](#problemas-de-conexion-del-servidor-mcp) |
| El archivo no se abre o muestra texto ilegible | Codificación no UTF-8 o atributo de cuarentena | [El archivo no se abre](#el-archivo-no-se-abre) |
| El Genio de IA se cuelga o no devuelve nada | Proveedor mal configurado o CLI no en PATH | [El Genio de IA no responde](#el-genio-de-ia-no-responde) |
| El atajo de teclado no hace nada | Reasignado en Configuración o anulado por el sistema | [El atajo de teclado no funciona](#el-atajo-de-teclado-no-funciona) |
| Editor lento con archivos grandes | Memoria por pestaña + retraso de entrada con más de 10K líneas | [Rendimiento del editor](#rendimiento-del-editor) |
| El menú sigue en inglés tras cambiar el idioma | El menú se reconstruye al iniciar | [La barra de menú muestra inglés](#la-barra-de-menu-muestra-ingles-tras-cambiar-el-idioma) |
| Exportación a PDF incompleta | Rutas de imágenes o permisos de escritura | [Problemas de exportación/impresión](#problemas-de-exportacion-impresion) |
| Inicio lento en Windows | WebView2 + escaneo del antivirus | [La aplicación se inicia lentamente en Windows](#la-aplicacion-se-inicia-lentamente-en-windows) |
| `Cmd + R` / `Ctrl + R` no hace nada | La recarga está bloqueada a propósito | [La recarga está bloqueada](#la-recarga-esta-bloqueada) |
| Al hacer doble clic en un archivo, se abrió en el VMark que ya estaba en ejecución | Reenvío a una sola instancia en Windows y Linux | [Una sola instancia de VMark en Windows y Linux](#una-sola-instancia-de-vmark-en-windows-y-linux) |
| Ventana en blanco en Linux | Renderizador DMABUF de WebKitGTK | [Ventana en blanco en Linux](#ventana-en-blanco-en-linux) |
| Las comillas rectas y `--` se quedan literales en macOS | Las sustituciones inteligentes del sistema están desactivadas para VMark | [Comillas y guiones tipográficos en macOS](#comillas-y-guiones-tipograficos-en-macos) |
| VMark nunca "duerme" en el Monitor de Actividad | App Nap está desactivado para que los asistentes de IA sigan funcionando | [VMark permanece activo en segundo plano](#vmark-permanece-activo-en-segundo-plano-app-nap) |
| Se abre un diálogo de carpetas para un espacio de trabajo reciente, o un error menciona `forbidden path` | La carpeta está fuera de lo que VMark puede leer | [Acceso a carpetas y errores `forbidden path`](#acceso-a-carpetas-y-errores-forbidden-path) |

Para cualquier cosa no listada arriba, consulta [Reportar errores](#reportar-errores).

## Archivos de registro

VMark genera archivos de registro para ayudar a diagnosticar problemas. Los registros incluyen advertencias y errores tanto del backend de Rust como del frontend.

### Ubicación de los archivos de registro

| Plataforma | Ruta |
|------------|------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Niveles de registro

| Nivel | Qué se registra | Producción | Desarrollo |
|-------|-----------------|------------|------------|
| Error | Fallos, cierres inesperados | Sí | Sí |
| Warn | Problemas recuperables, alternativas | Sí | Sí |
| Info | Hitos, cambios de estado | Sí | Sí |
| Debug | Seguimiento detallado | No | Sí |

### Rotación de registros

- Tamaño máximo de archivo: 5 MB
- Rotación: conserva un archivo de registro anterior
- Los registros antiguos se reemplazan automáticamente

## Reportar errores

Al reportar un error, incluye:

1. **Versión de VMark** — se muestra en la insignia de la barra de navegación o en el diálogo Acerca de
2. **Sistema operativo** — versión de macOS, compilación de Windows o distribución de Linux
3. **Pasos para reproducir** — qué hiciste antes de que ocurriera el problema
4. **Archivo de registro** — adjunta o pega las entradas de registro relevantes

Las entradas de registro tienen marca de tiempo y están etiquetadas por módulo (por ejemplo, `[HotExit]`, `[MCP Bridge]`, `[Export]`), lo que facilita encontrar las secciones relevantes.

### Encontrar registros relevantes

1. Abre el directorio de registros indicado en la tabla anterior
2. Abre el archivo `.log` más reciente
3. Busca entradas `ERROR` o `WARN` cercanas al momento en que ocurrió el problema
4. Copia las líneas relevantes e inclúyelas en tu reporte de error

## Problemas comunes

### La aplicación se inicia lentamente en Windows

VMark está optimizado para macOS. En Windows, el inicio puede ser más lento debido a la inicialización de WebView2. Asegúrate de que:

- WebView2 Runtime esté actualizado
- El software antivirus no esté escaneando el directorio de datos de la aplicación en tiempo real

### La barra de menú muestra inglés tras cambiar el idioma

Si la barra de menú permanece en inglés después de cambiar el idioma en Configuración, reinicia VMark. El menú se reconstruye en el siguiente inicio con el idioma guardado.

### El terminal no acepta signos de puntuación CJK

Corregido en v0.6.5+. Actualiza a la última versión.

### Problemas de conexión del servidor MCP

El servidor MCP puede fallar al iniciar o los clientes pueden no conectarse.

- Asegúrate de que VMark esté en ejecución — el servidor MCP solo se inicia cuando la aplicación está abierta.
- Verifica que ningún otro proceso esté usando el mismo puerto. El servidor MCP escribe un archivo de puerto para el descubrimiento de clientes; archivos de puerto obsoletos de una sesión anterior pueden causar conflictos. Reinicia VMark para regenerarlo.
- Revisa el archivo de registro en busca de entradas `[MCP Bridge]` para identificar errores de conexión.

### El atajo de teclado no funciona

Un atajo puede parecer que no responde si entra en conflicto con otra asignación o ha sido personalizado.

- Abre Configuración (`Mod + ,`) y navega a la pestaña **Atajos** para verificar si el atajo ha sido reasignado.
- Busca asignaciones duplicadas — si dos acciones comparten la misma combinación de teclas, solo una se ejecutará.
- En macOS, algunos atajos pueden entrar en conflicto con asignaciones del sistema (por ejemplo, Mission Control, Spotlight). Revisa **Configuración del Sistema > Teclado > Atajos de teclado**.

### Problemas de exportación/impresión

La exportación a PDF puede colgarse o producir una salida incompleta.

- Si faltan imágenes en la exportación, verifica que las rutas de las imágenes sean relativas al documento y que los archivos existan en disco. Las URLs absolutas e imágenes remotas deben ser accesibles.
- Verifica los permisos de archivo en el directorio de salida — VMark necesita acceso de escritura para guardar el archivo exportado.
- Para documentos grandes, la exportación puede tomar más tiempo. Revisa el archivo de registro en busca de entradas `[Export]` si parece atascado.

### El archivo no se abre

VMark puede rechazar abrir un archivo o mostrar contenido ilegible.

- Verifica que el archivo tenga permisos de lectura para tu cuenta de usuario.
- VMark espera Markdown codificado en UTF-8. Los archivos en otras codificaciones (por ejemplo, GB2312, Shift-JIS) pueden no mostrarse correctamente — conviértelos a UTF-8 primero.
- Si el archivo está bloqueado por otro proceso (por ejemplo, un cliente de sincronización o herramienta de respaldo), cierra ese proceso e intenta de nuevo.
- **macOS: hacer doble clic en un archivo descargado no hace nada mientras VMark está en ejecución.** Los archivos guardados por algunas aplicaciones llevan el atributo de cuarentena de descargas (`com.apple.quarantine`), y macOS puede descartar en silencio la solicitud de abrir un archivo así en una aplicación que ya se está ejecutando. Al abrir un espacio de trabajo, VMark elimina el atributo de la carpeta del espacio de trabajo y de los archivos que están directamente dentro de ella y que puede abrir (las subcarpetas no se tocan) — es el ajuste **Eliminar la cuarentena de descargas al abrir el espacio de trabajo** en **Configuración → Avanzado → macOS**, activado de forma predeterminada. Para cualquier otro archivo, usa **Archivo → Abrir archivo…**, o ejecuta `xattr -d com.apple.quarantine <file>` en Terminal.

### Acceso a carpetas y errores `forbidden path`

Fuera de tu carpeta personal y de los volúmenes montados — y, en Windows, fuera de las unidades `C:\` a `F:\` — VMark solo lee aquello a lo que le diste acceso; consulta [Qué Puede Leer VMark en el Disco](/es/guide/privacy#que-puede-leer-vmark-en-el-disco).

- **Se abre un diálogo de carpetas al elegir un espacio de trabajo reciente.** VMark no puede confirmar que elegiste esa carpeta antes, y nada más le permite leer allí. El diálogo se abre en esa carpeta: haz clic en **Abrir** para confirmarla y VMark la recordará a partir de entonces. Si cancelas, no se abre nada.
- **La solicitud de un asistente de IA para abrir una carpeta necesita un paso más.** Después de que apruebes la solicitud, VMark muestra el mismo diálogo; elige allí la carpeta y deja que el asistente lo vuelva a intentar.
- **Un error menciona `forbidden path` o una imagen no se muestra.** El archivo está fuera de todos los lugares que VMark puede leer — a menudo es una imagen junto a un documento que abriste por separado. Abre la carpeta del documento con **Archivo → Abrir espacio de trabajo...** para darle a VMark la carpeta completa.

### Rendimiento del editor

El editor puede volverse lento con archivos muy grandes o muchas pestañas abiertas.

- Cierra pestañas que no uses para liberar memoria — cada pestaña abierta mantiene su propio estado de editor.
- Los documentos muy grandes (más de 10.000 líneas) pueden causar retraso en la entrada. Considera dividirlos en archivos más pequeños.
- Desactiva el Modo Enfoque y el Modo Máquina de Escribir si no los necesitas, ya que añaden sobrecarga de renderizado adicional.

### El Genio de IA no responde

Los Genios de IA requieren un proveedor de IA configurado para funcionar.

- Abre Configuración y verifica que un proveedor de IA (por ejemplo, Ollama, OpenAI, Anthropic) esté configurado con un nombre de modelo válido.
- El CLI del proveedor debe estar disponible en tu PATH. En macOS, las aplicaciones con interfaz gráfica tienen un PATH mínimo — si el CLI se instaló a través de Homebrew, asegúrate de que tu perfil de shell exporte la ruta correcta.
- Verifica el nombre del modelo en busca de errores tipográficos. Un nombre de modelo incorrecto fallará silenciosamente o devolverá un error.

### La recarga está bloqueada

`Cmd + R`, `Ctrl + R` y `Ctrl + Shift + R` no hacen nada, a propósito. Recargar el webview descartaría todos los editores abiertos, su historial de deshacer y cualquier estado sin guardar, así que VMark bloquea los atajos, la vía de descarga de la página y el propio menú contextual del webview. Dos excepciones: `Ctrl + R` llega al shell cuando el terminal integrado está enfocado (reverse-i-search), y `F5` nunca se bloquea porque es el atajo de la Vista rápida del código fuente. Las compilaciones de desarrollo solo avisan de los documentos sin guardar.

### Una sola instancia de VMark en Windows y Linux

Hacer doble clic en un archivo, o volver a abrir VMark desde un lanzador, entrega el archivo al VMark que ya está en ejecución y trae una ventana al frente en lugar de iniciar una segunda copia. Un segundo proceso compartiría los datos de la aplicación, la sesión y el almacenamiento de ventanas del primero, y ambos sobrescribirían el estado del otro — la pérdida de datos detrás de #1330. macOS siempre se ha comportado así a través del sistema operativo. Una compilación de desarrollo (`tauri dev`) usa su propio identificador y por eso cuenta como una aplicación distinta.

En Windows, si el VMark que ya está en ejecución ha dejado de responder y ya no puede recibir el traspaso, un nuevo inicio no abre una segunda copia a su lado. En su lugar muestra un mensaje: abra el Administrador de tareas, finalice todos los procesos `VMark` y vuelva a iniciar VMark (#1527).

En Linux esto depende del bus de sesión de D-Bus. En una sesión sin un `DBUS_SESSION_BUS_ADDRESS` utilizable, VMark se inicia igualmente pero sin esta protección — volver a abrirlo inicia una segunda copia, con el riesgo descrito arriba — y el registro indica que la protección está desactivada. Ábrelo desde una sesión de escritorio, o desde un shell donde esa variable esté definida.

### Ventana en blanco en Linux

En algunas combinaciones de AMD / Mesa / WebKitGTK (Arch con KDE Plasma 6 fue el caso notificado, #1058) el renderizador DMABUF de WebKitGTK falla y el área de contenido se queda en blanco. VMark establece `WEBKIT_DISABLE_DMABUF_RENDERER=1` antes de que se inicie el webview para que esto no ocurra. Si quieres recuperar el renderizador DMABUF, inicia con `WEBKIT_DISABLE_DMABUF_RENDERER=0` — VMark solo establece la variable cuando tú no lo has hecho.

### Un atajo escribe un carácter con un método de entrada chino activado

Corregido. Con la puntuación china activada, un método de entrada reescribe las teclas de puntuación — la tecla de acento grave produce `·`, los corchetes producen `【】` — y confirma ese carácter **antes** de que la aplicación sepa que se pulsó la tecla. Así, `` Ctrl + ` `` alternaba el terminal *y además* dejaba un `·` suelto en el documento, marcando como editado un archivo limpio.

Ahora VMark veta la inserción en sí en lugar de la pulsación, así que un acorde de comando no escribe nada. La escritura normal en chino, las teclas muertas (`Option + e`) y los caracteres AltGr de los teclados europeos no se ven afectados — solo se rechazan las inserciones que llegan mientras se mantiene pulsado `Ctrl` o `Cmd`, y ningún acorde de VMark significa "escribe este carácter".

Si aún ves un carácter suelto al usar un atajo, vale la pena [informar del problema](https://github.com/xiaolai/vmark/issues) indicando el nombre del método de entrada y el acorde exacto.

### Comillas y guiones tipográficos en macOS

Escribir `--` o `"` en VMark se queda literal aunque tu Mac tenga activada la opción *Usar comillas y guiones tipográficos*. De lo contrario, el sistema reescribiría el texto por debajo del editor — `-->` en un bloque Mermaid se convertía en `—>` — así que VMark desactiva las sustituciones automáticas de guiones, comillas y puntos solo para su propio proceso. Las demás aplicaciones no se ven afectadas, como tampoco los métodos de entrada ni tus propias sustituciones de texto. Para comillas tipográficas dentro de VMark, usa las [reglas de comillas tipográficas del formateador CJK](/es/guide/cjk-formatting#estilos-de-comillas-tipograficas) o el alternador de estilo de comillas (`Shift + Mod + '`).

### VMark permanece activo en segundo plano (App Nap)

En macOS, VMark renuncia a App Nap mientras se está ejecutando, así que el Monitor de Actividad lo muestra como que nunca duerme, incluso cuando sus ventanas están ocultas. App Nap congelaría el webview — y con él todas las solicitudes de los asistentes de IA (MCP) — hasta que trajeras una ventana al frente; permanecer activo es lo que permite que un asistente siga trabajando mientras estás en otra aplicación. El sistema puede seguir entrando en reposo cuando está inactivo; VMark solo pide que no se le aplique App Nap.
