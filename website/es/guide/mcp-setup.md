# Integración con IA (MCP)

VMark incluye un servidor MCP (Model Context Protocol) integrado que permite a los asistentes de IA como Claude interactuar directamente con tu editor.

## ¿Qué es MCP?

El [Model Context Protocol](https://modelcontextprotocol.io/) es un estándar abierto que permite a los asistentes de IA interactuar con herramientas y aplicaciones externas. El servidor MCP de VMark expone sus capacidades de editor como herramientas que los asistentes de IA pueden usar para:

- Leer y escribir contenido de documentos
- Aplicar formato y crear estructuras
- Navegar y gestionar documentos
- Insertar contenido especial (matemáticas, diagramas, wiki links)

## Configuración Rápida

VMark facilita la conexión con asistentes de IA con instalación en un clic.

### 1. Habilitar el Servidor MCP

Abre **Configuración → Integraciones** y activa el Servidor MCP:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="VMark MCP Server Settings" />
</div>

- **Activar servidor MCP** — Actívalo para permitir conexiones de IA
- **Iniciar al arrancar** — Se inicia automáticamente cuando se abre VMark
- **Aprobar automáticamente guardados en una ubicación nueva y resultados de genios** — Desactivado de forma predeterminada. Permite que una IA guarde un documento en una ruta *nueva* sin preguntar, y que un genio aplique su resultado directamente en lugar de como sugerencia. Nunca restringe las escrituras normales de la IA — su red de seguridad es el [historial de puntos de control de edición](#puntos-de-control-de-edicion) (consulta [Cómo funcionan las ediciones](#como-funcionan-las-ediciones))

### 2. Instalar Configuración

Haz clic en **Instalar** para tu asistente de IA:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP Install Configuration" />
</div>

Asistentes de IA compatibles:
- **Claude Desktop** — La aplicación de escritorio de Anthropic
- **Claude Code** — CLI para desarrolladores
- **Codex CLI** — Asistente de programación de OpenAI
- **Antigravity CLI** — `agy` de Google, el sucesor de Gemini CLI
- **Grok CLI** — El agente de programación de xAI
- **opencode** — El agente de terminal de código abierto e independiente del proveedor

**Instalar escribe una credencial por cliente.** Además de la ruta al servidor MCP de VMark, Instalar coloca un token secreto en el propio archivo de configuración del cliente, en `env.VMARK_MCP_TOKEN` (`environment.VMARK_MCP_TOKEN` para opencode). Cada cliente recibe su propio token, que no se guarda en ningún otro lugar. Le indica a VMark qué cliente se está conectando, en lugar de fiarse del nombre que el cliente declara. Hoy solo lo necesitan las acciones delegadas — responder en tu nombre a una pregunta de coherencia con `coherence_resolve`; todas las demás herramientas funcionan sin él. Instalar y **Reparar** conservan un token que sigue siendo válido; para emitir uno nuevo, desinstala y vuelve a instalar. Reinicia el cliente de IA después de cualquiera de las dos cosas. Trata el token como una contraseña: no pegues el archivo de configuración en un issue ni en un chat.

::: info Gemini CLI está descontinuado
Google sustituyó Gemini CLI por Antigravity. Si una instalación anterior de VMark dejó una
entrada `vmark` en `~/.gemini/settings.json`, el panel Integraciones muestra una fila
**Descontinuado** para ella con un botón **Eliminar**; las instalaciones nuevas se dirigen
a Antigravity.
:::

::: info Otros Clientes Compatibles con MCP
Otros clientes compatibles con MCP como Cursor, Windsurf y herramientas similares también pueden conectarse al servidor MCP de VMark. Configúralos manualmente apuntando a la ruta del binario del servidor MCP (ver [Configuración Manual](#configuracion-manual) más abajo).
:::

#### CC-Switch

Si gestionas tus CLI de IA con CC-Switch, el instalador también muestra una fila **CC-Switch**. **Añadir a CC-Switch** abre un enlace `ccswitch://v1/import` que entrega el servidor MCP de VMark — la ruta de su binario — a CC-Switch, que luego escribe la entrada `vmark` en los CLI que gestiones allí; un botón de copia te da el propio enlace si prefieres pegarlo. La fila está deshabilitada hasta que VMark ha resuelto su propio binario MCP.

#### Iconos de Estado

Cada proveedor muestra un indicador de estado:

| Icono | Estado | Significado |
|-------|--------|-------------|
| ✓ Verde | Válido | La configuración es correcta y funciona |
| ⚠ Ámbar | Ruta no coincide | VMark fue movido — haz clic en **Reparar** |
| ✗ Rojo | Binario no encontrado | Binario MCP no encontrado — reinstala VMark |
| 🗎 Rojo | Configuración ilegible | VMark no puede leer ni analizar el archivo de configuración, así que no se sabe si contiene una entrada de VMark. El mensaje nombra el archivo y el motivo. Corrígelo o muévelo y luego haz clic en **Comprobar de nuevo** — instalar y reparar quedan retenidos hasta que se pueda analizar, porque escribir en un archivo que VMark no puede leer podría destruir su contenido |
| ○ Gris | No configurado | No instalado — haz clic en **Instalar** |

::: tip ¿Moviste VMark?
Si mueves VMark.app a una ubicación diferente, el estado mostrará el ámbar "Ruta no coincide". Simplemente haz clic en el botón **Reparar** para actualizar la configuración con la nueva ruta.
:::

### 3. Reinicia tu Asistente de IA

Después de instalar o reparar, **reinicia tu asistente de IA** completamente (ciérralo y vuelve a abrirlo) para cargar la nueva configuración. VMark mostrará un recordatorio después de cada cambio de configuración.

### 4. Pruébalo

En tu asistente de IA, prueba comandos como:
- *"¿Qué hay en mi documento de VMark?"*
- *"Escribe un resumen sobre computación cuántica en VMark"*
- *"Añade una tabla de contenidos a mi documento"*

## Véalo en Acción

Hazle una pregunta a Claude y pídele que escriba la respuesta directamente en tu documento de VMark:

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop using VMark MCP" />
  <p class="screenshot-caption">Claude Desktop llama a <code>document</code> → <code>set_content</code> para escribir en VMark</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Content rendered in VMark" />
  <p class="screenshot-caption">El contenido aparece instantáneamente en VMark, completamente formateado</p>
</div>

<!-- Styles in style.css -->

## Configuración Manual

Si prefieres configurar manualmente, aquí están las ubicaciones de los archivos de configuración:

### Claude Desktop

Edita `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) o `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Claude Code

Edita `~/.claude.json` o el `.mcp.json` del proyecto:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Codex CLI

Edita `~/.codex/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Antigravity CLI

Edita `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Grok CLI

Edita `~/.grok/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### opencode

Edita `~/.config/opencode/opencode.json`. El esquema de opencode es distinto del de
`mcpServers`: la clave es `mcp`, y `command` es un único array que contiene
el programa y sus argumentos:

```json
{
  "mcp": {
    "vmark": {
      "type": "local",
      "command": ["/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"],
      "enabled": true
    }
  }
}
```

Si tu propia configuración está en `opencode.jsonc`, déjala ahí — opencode
combina ambos archivos, así que la entrada de VMark en `opencode.json` se suma. VMark escribe
el archivo JSON simple porque no puede conservar los comentarios de un `.jsonc`.

::: warning Una entrada `vmark` existente en `opencode.jsonc` gana
opencode combina `config.json`, luego `opencode.json` y luego `opencode.jsonc`, y
el último que se lee tiene prioridad. Así que, si antes añadiste a mano una entrada `vmark`
a `opencode.jsonc`, esta anula la que gestiona VMark — VMark indicará
que el proveedor es válido mientras opencode sigue usando tu entrada antigua (y
su ruta de binario obsoleta). Elimina el bloque `mcp.vmark` escrito a mano de
`opencode.jsonc` y deja que el panel Integraciones lo gestione.
:::

::: tip Encontrar la Ruta del Binario
En macOS, el binario del servidor MCP está dentro de VMark.app:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

En Windows:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

En Linux:
- `/usr/bin/vmark-mcp-server` (o donde lo hayas instalado)

El puerto se detecta automáticamente — no se necesitan `args`.
:::

### Opciones de línea de comandos (avanzado)

El binario del servidor MCP admite un pequeño conjunto de opciones para diagnósticos y configuraciones heredadas:

| Opción | Qué hace |
|---|---|
| `--version` (o `-v`) | Muestra la versión (debe coincidir con la de VMark en ejecución) y sale. |
| `--health-check` | Ejecuta una autoprueba del binario y sale: inicia el servidor MCP contra un puente simulado integrado, imprime su versión y su número de herramientas como JSON, y sale con un código distinto de cero si el número de herramientas no es el que espera esta compilación. **No** contacta con un VMark en ejecución — úsalo para confirmar que el binario funciona; usa **Configuración → Integraciones** para comprobar el puente en vivo. |
| `--port <número>` | Anulación manual del puerto. Omite el protocolo de autodescubrimiento y se conecta en el puerto indicado. Solo es útil para configuraciones heredadas en las que el puerto del puente está fijado externamente; se prefiere la ruta de autodescubrimiento. |

Ejemplo:

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # heredado / manual
```

Cualquier otro argumento — una opción mal escrita, `--port=9223` o una palabra suelta — se rechaza: el programa muestra un error de uso y termina con el código 64 en lugar de recurrir a la detección automática.

## Cómo Funciona

```text
AI Assistant <--stdio--> MCP Server <--WebSocket--> VMark Editor
```

1. **VMark inicia un puente WebSocket** en un puerto disponible al arrancarse
2. **El servidor MCP** lee el puerto y el token de autenticación del directorio de datos de la aplicación VMark
3. **El servidor MCP** se conecta y autentica a través del puente WebSocket
4. **El asistente de IA** se comunica con el servidor MCP a través de stdio
5. **Los comandos se retransmiten** al editor de VMark a través del puente

## Capacidades Disponibles

Cuando está conectado, tu asistente de IA tiene diez herramientas:

| Herramienta | Qué abarca |
|-------------|------------|
| `session` | Ventanas, pestañas, el documento activo y las pestañas del navegador (solo lectura) |
| `workspace` | Nuevo, abrir, guardar, guardar como, cerrar, cambiar de pestaña, enfocar una ventana, abrir un espacio de trabajo |
| `document` | Leer y escribir todo el documento como Markdown; transformaciones de formato CJK |
| `selection` | Leer y reemplazar el texto seleccionado |
| `comments` | Listar los comentarios de revisión del documento, responderlos y marcarlos como atendidos (un asistente no puede resolverlos) |
| `workflow` | Parches seguros para el CST y validación para YAML de GitHub Actions |
| `browser` / `browser_read` | Automatización del navegador integrado en macOS — la mitad que modifica y la de solo lectura |
| `coherence` / `coherence_resolve` | Leer la capa de coherencia; resolver aristas obsoletas bajo una delegación que concediste |

El formato no es una herramienta aparte: el asistente escribe Markdown, así que los encabezados, las tablas, las matemáticas y los diagramas son lo que escriba.

Consulta la [Referencia de Herramientas MCP](/es/guide/mcp-tools) para documentación completa.

## Verificar el Estado de MCP

VMark proporciona múltiples formas de verificar el estado del servidor MCP:

### Indicador en la Barra de Estado

La barra de estado muestra un indicador **MCP** en el lado derecho. Cuando algo
requiere tu atención, aparece una pequeña palabra de estado junto al icono del satélite;
una conexión sana es solo el icono verde. Al pasar el puntero se enumeran los clientes de IA
conectados en ese momento, por nombre y versión:

| Color | Palabra | Estado |
|-------|---------|--------|
| Verde | — | Conectado y en ejecución |
| Gris | `off` | Desconectado o detenido |
| Pulsante (animado) | `…` | Iniciándose |
| Rojo | `error` | El servidor falló — pasa el puntero para ver el motivo |

El inicio generalmente se completa en 1-2 segundos.

Haz clic en el indicador para abrir **Configuración → Integraciones**.

### Panel de Configuración

**Configuración → Integraciones** es la otra superficie de estado — no hay un cuadro de diálogo de estado aparte. Mientras el puente está en ejecución, muestra la dirección en la que escucha (`localhost:<port>`, con un botón de copia) y cuántos clientes de IA están conectados, y se actualiza cada pocos segundos. El botón **Probar conexión** (llamado **Comprobar sidecar** mientras el puente está detenido) ejecuta el propio `--health-check` del sidecar e informa de la versión del sidecar, su número de herramientas y cuándo se comprobó por última vez — confirma que el binario instalado funciona, no que haya un cliente conectado.

## Solución de Problemas

### "Conexión rechazada" o "Sin editor activo"

- Asegúrate de que VMark esté en ejecución y tenga un documento abierto
- Verifica que el Servidor MCP esté habilitado en Configuración → Integraciones
- Comprueba que el puente MCP muestre el estado "En ejecución"
- Reinicia VMark si la conexión fue interrumpida

### Ruta no coincide después de mover VMark

Si moviste VMark.app a una ubicación diferente (por ejemplo, de Descargas a Aplicaciones), la configuración apuntará a la ruta anterior:

1. Abre **Configuración → Integraciones**
2. Busca el icono de advertencia ámbar ⚠ junto a los proveedores afectados
3. Haz clic en **Reparar** para actualizar la ruta
4. Reinicia tu asistente de IA

### Las herramientas no aparecen en el asistente de IA

- Reinicia tu asistente de IA después de instalar la configuración
- Verifica que la configuración fue instalada (busca la marca de verificación verde en Configuración)
- Revisa los registros de tu asistente de IA para detectar errores de conexión MCP

### Los comandos fallan con "Sin editor activo"

- Asegúrate de que una pestaña de documento esté activa en VMark
- Haz clic en el área del editor para enfocarlo
- Algunos comandos requieren que primero haya texto seleccionado

## Cómo funcionan las ediciones

La superficie MCP reducida sigue el eje de lectura y escritura: los asistentes de IA llaman a `document.read` para obtener el contenido actual más un token de revisión, razonan sobre él y después llaman a `document.write` con el nuevo contenido completo. El token de revisión protege contra sobrescrituras silenciosas: si escribiste en VMark mientras la IA pensaba, la escritura devuelve `STALE` y la IA vuelve a leer.

Para los archivos YAML de flujos de trabajo de GitHub Actions, la IA usa `workflow.apply_patch` en su lugar — los mutadores de VMark, conscientes del CST, conservan los comentarios, los anclajes y el orden de las claves que una reescritura de texto en bruto perdería.

No hay paso de vista previa para `document.write`, `selection.set` ni `workflow.apply_patch` — el cambio llega al editor en cuanto se supera la comprobación de revisión. La red de seguridad es el [historial de puntos de control de edición](#puntos-de-control-de-edicion) que se describe más abajo; si quieres revisar antes de que llegue nada, mantén el documento bajo git y revisa el diff. La única puerta de aprobación es **Aprobar automáticamente guardados en una ubicación nueva y resultados de genios**: con ella desactivada (el valor predeterminado), una IA no puede guardar un documento en una ruta nueva — `workspace.save_as` devuelve `APPROVAL_REQUIRED` y VMark muestra una notificación que nombra el archivo. Incluso con ella activada, `save_as` se niega a sobrescribir otro archivo existente.

## Puntos de control de edición

Cada modificación de un documento por la IA — `document.write`, `document.transform`, `selection.set` y `workflow.apply_patch` — se registra en el historial de edición de VMark antes de cambiar nada. El botón **historial** de la barra de estado abre un panel para el documento enfocado. Su contador indica las versiones del documento hechas por la IA, y el botón adopta un color de advertencia cuando los cambios no se están registrando. El panel se actualiza en vivo, en todas las ventanas, a medida que se registran versiones.

El panel lista las versiones del documento, la más reciente primero. Cada fila muestra cuándo ocurrió, qué tipo de cambio fue, la herramienta y quién lo hizo: el proveedor del cliente de IA (por ejemplo `claude` o `codex`), su conexión y su etiqueta de sesión. Un cliente sin token aparece como **Cliente no identificado**, un token desconocido como **Credencial no reconocida** y un token compartido por varios clientes como **Credencial compartida por varios proveedores** — nunca como un proveedor, se dé el nombre que se dé el cliente. **Restaurar esta versión** devuelve el texto de esa versión; **Restaurar al estado anterior a este cambio** devuelve el texto anterior. Restaurar incrementa la revisión del documento, de modo que un cliente de IA que aún tenga la revisión antigua recibe `STALE` en su siguiente escritura en lugar de sobrescribir su restauración. La propia restauración se registra: el texto que reemplaza se guarda primero, y un documento editado mientras la restauración estaba en curso no se toca. Cuando VMark no puede confirmar que el registro de una restauración llegó al disco, te avisa junto al resultado.

Encima de las versiones, **Revisar cambios de IA** lista los cambios de IA que aún no has revisado, agrupados por cliente y sesión; las versiones cuyos cambios están todos revisados se resumen en un recuento. Cada cambio ofrece **Conservar** o **Revertir** (y después **Deshacer conservar** o **Deshacer reversión**). Una reversión que sobrescribiría texto que has editado desde entonces no se aplica: el cambio se marca como en conflicto y, cuando lo hayas resuelto a mano, **Marcar como resuelto** lo registra. Un cambio cuya ubicación ya no puede certificarse indica el motivo y no ofrece reversión automática. **Cerrar revisados** cierra para siempre todos los cambios revisados, tras una confirmación, porque no se puede deshacer. Un documento admite como máximo 500 cambios de IA sin revisar: en ese límite un aviso lo indica, y las ediciones de IA se rechazan con `REVIEW_BACKLOG_FULL` hasta que revises y cierres. Un guardado que partió de una versión distinta de la anterior — el documento se editó en dos ventanas — se marca como tal, con ambas restauraciones para deshacer la fusión. **Mostrar ambos cambios** abre dos diferencias de ese guardado: *Frente a la versión de la que partió este guardado*, y *Frente a la versión anterior*, frente a la versión anterior en el historial.

A continuación, **Comentarios** reúne los hilos de comentarios del documento. **Comentar la selección** cita el texto seleccionado en el editor (con solo un cursor, el párrafo en el que está) y añade tu comentario; el texto sin guardar se registra primero, así que un comentario nunca apunta a una versión anterior. Cada hilo muestra su estado — abierto, atendido, resuelto o reabierto —, quién lo escribió, el texto citado y las respuestas. Los comentarios se muestran como texto plano: el HTML de un comentario se muestra, nunca se ejecuta. Cuando el texto citado aparece ahora varias veces, el hilo dice cuántas; cuando ya no está, el hilo lo indica. Puedes **Responder** en cualquier estado, **Marcar como atendido** un hilo abierto o reabierto, **Resolver**lo y **Reabrir** o **Eliminar** uno resuelto; eliminar pide confirmación y no se puede deshacer. Mientras se envía un comentario o una respuesta, no se puede editar ni cancelar, aunque cierres el panel y lo vuelvas a abrir; si se rechaza, se conserva para que puedas cambiarlo y enviarlo de nuevo. Solo tú puedes resolver, reabrir o eliminar un hilo. Un hilo reabierto después de que su revisión original se borrara del historial muestra *La revisión de creación ya no se conserva* y se compara con el texto actual.

La parte superior del panel indica cuándo los cambios no se están registrando: el historial no pudo iniciarse o es de solo lectura, va con retraso (registros en cola que aún no están en el disco), el último guardado de este documento fue rechazado o el historial no respondió a tiempo, se rechazaron ediciones de IA en una ventana con demasiadas páginas abiertas, o algunos cambios de la IA ya no se pueden revertir automáticamente. El panel también cuenta las ediciones de IA registradas como cambios de todo el documento porque no se pudo confirmar el rango que cambiaron. Un cambio que ya no se puede revertir automáticamente se lee **Bloqueado: motivo (origen)** bajo la última versión en la que se certificó su ubicación, que aparece resaltada; si no hay ninguna, el panel indica que la ubicación no está disponible. Las escrituras que se aplicaron pero nunca se registraron aparecen en **Escrituras no registradas**, cada una con restaurar y descartar.

Para distinguir varias sesiones de un mismo cliente, defina `VMARK_SESSION_LABEL` en la configuración MCP del cliente, junto a `VMARK_MCP_TOKEN`:

```json
"env": { "VMARK_MCP_TOKEN": "…", "VMARK_SESSION_LABEL": "docs refactor" }
```

La etiqueta tiene como máximo 128 bytes UTF-8 y ningún carácter de control; una etiqueta que incumple la regla se descarta con una advertencia y el cliente se conecta sin ella. La elige la configuración del cliente, por lo que solo se muestra y no decide nada.

El historial se guarda en la carpeta `agent-journal` del directorio de datos de VMark, así que sobrevive a un reinicio. La carpeta contiene el texto anterior completo de cada edición registrada y solo es accesible para su propietario (`0700` en macOS y Linux). Los puntos de control de una versión anterior de VMark (un `mcp-checkpoints.jsonl`, importado en el primer inicio y luego renombrado) aparecen en **Puntos de control anteriores**, una sola lista para todos los documentos y ventanas. Restaurar uno abre su archivo; uno sin título, o uno cuyo archivo ya no se puede abrir, se restaura en un documento nuevo. La sección muestra cuánto texto de puntos de control se conserva y lo borra todo — cada archivo y cada ventana — en una sola acción, eliminando los textos del disco.

## Notas de Seguridad

- El servidor MCP solo acepta conexiones locales (localhost)
- No se envían datos a servidores externos
- Las operaciones de archivo de la IA se limitan a la raíz del espacio de trabajo abierto y a las carpetas de los documentos abiertos — consulta [Privacidad](/es/guide/privacy#a-que-puede-acceder-un-asistente-de-ia)
- Todo el procesamiento ocurre en tu máquina
- El puente WebSocket solo es accesible localmente
- Cada cliente instalado lleva su propio `VMARK_MCP_TOKEN`. Un cliente sin token, con uno desconocido o con uno compartido con otro cliente sigue conectándose, pero sus acciones delegadas se rechazan con un mensaje que te pide ejecutar Instalar para él en **Configuración → Integraciones** y reiniciarlo

## Próximos Pasos

- Explora todas las [Herramientas MCP](/es/guide/mcp-tools) disponibles
- Aprende sobre los [atajos de teclado](/es/guide/shortcuts)
- Descubre otras [características](/es/guide/features)
