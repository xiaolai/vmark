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

Para cualquier cosa no listada arriba, consulta [Reportar errores](#reportar-errores).

## Archivos de registro

VMark genera archivos de registro para ayudar a diagnosticar problemas. Los registros incluyen advertencias y errores tanto del backend de Rust como del frontend.

### Ubicación de los archivos de registro

| Plataforma | Ruta |
|------------|------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%APPDATA%\app.vmark\logs\` |
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
