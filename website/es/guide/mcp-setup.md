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

- **Habilitar Servidor MCP** — Activa para permitir conexiones de IA
- **Iniciar al abrir** — Se inicia automáticamente cuando se abre VMark
- **Auto-aprobar ediciones** — Aplica cambios de IA sin vista previa (ver más abajo)

### 2. Instalar Configuración

Haz clic en **Instalar** para tu asistente de IA:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP Install Configuration" />
</div>

Asistentes de IA compatibles:
- **Claude Desktop** — La aplicación de escritorio de Anthropic
- **Claude Code** — CLI para desarrolladores
- **Codex CLI** — Asistente de programación de OpenAI
- **Gemini CLI** — Asistente de IA de Google

::: info Otros Clientes Compatibles con MCP
Otros clientes compatibles con MCP como Cursor, Windsurf y herramientas similares también pueden conectarse al servidor MCP de VMark. Configúralos manualmente apuntando a la ruta del binario del servidor MCP (ver [Configuración Manual](#configuracion-manual) más abajo).
:::

#### Iconos de Estado

Cada proveedor muestra un indicador de estado:

| Icono | Estado | Significado |
|-------|--------|-------------|
| ✓ Verde | Válido | La configuración es correcta y funciona |
| ⚠ Ámbar | Ruta no coincide | VMark fue movido — haz clic en **Reparar** |
| ✗ Rojo | Binario no encontrado | Binario MCP no encontrado — reinstala VMark |
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

### Gemini CLI

Edita `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

::: tip Encontrar la Ruta del Binario
En macOS, el binario del servidor MCP está dentro de VMark.app:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

En Windows:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

En Linux:
- `/usr/bin/vmark-mcp-server` (o donde lo hayas instalado)

El puerto se detecta automáticamente — no se necesitan `args`.
:::

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

Cuando está conectado, tu asistente de IA puede:

| Categoría | Capacidades |
|-----------|-------------|
| **Documento** | Leer/escribir contenido, buscar, reemplazar |
| **Selección** | Obtener/establecer selección, reemplazar texto seleccionado |
| **Formato** | Negrita, cursiva, código, enlaces y más |
| **Bloques** | Encabezados, párrafos, bloques de código, citas |
| **Listas** | Listas con viñetas, ordenadas y de tareas |
| **Tablas** | Insertar, modificar filas/columnas |
| **Especial** | Ecuaciones matemáticas, diagramas Mermaid, wiki links |
| **Espacio de trabajo** | Abrir/guardar documentos, gestionar ventanas |

Consulta la [Referencia de Herramientas MCP](/es/guide/mcp-tools) para documentación completa.

## Verificar el Estado de MCP

VMark proporciona múltiples formas de verificar el estado del servidor MCP:

### Indicador en la Barra de Estado

La barra de estado muestra un indicador **MCP** en el lado derecho:

| Color | Estado |
|-------|--------|
| Verde | Conectado y en ejecución |
| Gris | Desconectado o detenido |
| Pulsante (animado) | Iniciándose |

El inicio generalmente se completa en 1-2 segundos.

Haz clic en el indicador para abrir el cuadro de diálogo de estado detallado.

### Cuadro de Diálogo de Estado

Accede a través de **Ayuda → Estado del Servidor MCP** o haz clic en el indicador de la barra de estado.

El cuadro de diálogo muestra:
- Estado de la conexión (Saludable / Error / Detenido)
- Estado de ejecución del puente y puerto
- Versión del servidor
- Herramientas disponibles (12) y recursos (4)
- Hora del último chequeo de estado
- Lista completa de herramientas disponibles con botón de copia

### Panel de Configuración

En **Configuración → Integraciones**, cuando el servidor está en ejecución verás:
- Número de versión
- Recuento de herramientas y recursos
- Botón **Probar Conexión** — ejecuta un chequeo de estado
- Botón **Ver Detalles** — abre el cuadro de diálogo de estado

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

## Sistema de Sugerencias y Auto-Aprobación

Por defecto, cuando los asistentes de IA modifican tu documento (insertar, reemplazar o eliminar contenido), VMark crea **sugerencias** que requieren tu aprobación:

- **Insertar** — El nuevo texto aparece como vista previa de texto fantasma
- **Reemplazar** — El texto original tiene tachado, el nuevo texto como texto fantasma
- **Eliminar** — El texto a eliminar aparece con tachado

Presiona **Enter** para aceptar o **Escape** para rechazar. Esto preserva tu historial de deshacer/rehacer y te da control total.

### Modo Auto-Aprobación

::: warning Usar con Precaución
Habilitar **Auto-aprobar ediciones** omite la vista previa de sugerencias y aplica los cambios de IA inmediatamente. Solo activa esto si confías en tu asistente de IA y quieres una edición más rápida.
:::

Cuando la auto-aprobación está habilitada:
- Los cambios se aplican directamente sin vista previa
- Deshacer (Mod+Z) sigue funcionando para revertir cambios
- Los mensajes de respuesta incluyen "(auto-aprobado)" para mayor transparencia

Esta configuración es útil para:
- Flujos de trabajo de escritura asistida por IA de manera rápida
- Asistentes de IA confiables con tareas bien definidas
- Operaciones en lote donde revisar cada cambio es poco práctico

## Notas de Seguridad

- El servidor MCP solo acepta conexiones locales (localhost)
- No se envían datos a servidores externos
- Todo el procesamiento ocurre en tu máquina
- El puente WebSocket solo es accesible localmente
- La auto-aprobación está desactivada de forma predeterminada para evitar cambios no deseados

## Próximos Pasos

- Explora todas las [Herramientas MCP](/es/guide/mcp-tools) disponibles
- Aprende sobre los [atajos de teclado](/es/guide/shortcuts)
- Descubre otras [características](/es/guide/features)
