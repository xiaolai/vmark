# Proveedores de IA

Los [Genios de IA](/es/guide/ai-genies) de VMark necesitan un proveedor de IA para generar sugerencias. Puedes usar una herramienta CLI instalada localmente o conectarte directamente a una API REST.

## Configuración Rápida

La forma más rápida de comenzar:

1. Abre **Configuración > Integraciones**
2. Haz clic en **Detectar** para buscar herramientas CLI instaladas
3. Si se encuentra una CLI (por ejemplo, Claude, Gemini), selecciónala — ya está listo
4. Si no hay ninguna CLI disponible, elige un proveedor REST, introduce tu clave API y selecciona un modelo

Solo puede haber un proveedor activo a la vez.

## Proveedores CLI

Los proveedores CLI usan herramientas de IA instaladas localmente. VMark las ejecuta como subprocesos y transmite su salida de vuelta al editor.

| Proveedor | Comando CLI | Instalación |
|-----------|-------------|-------------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |

### Cómo Funciona la Detección CLI

Haz clic en **Detectar** en Configuración > Integraciones. VMark busca en tu `$PATH` cada comando CLI e informa sobre su disponibilidad. Si se encuentra una CLI, su botón de radio queda disponible para selección.

### Ventajas

- **Sin clave API** — la CLI gestiona la autenticación usando tu inicio de sesión existente
- **Mucho más barato** — las herramientas CLI usan tu plan de suscripción (por ejemplo, Claude Max, ChatGPT Plus/Pro, Google One AI Premium), que tiene una tarifa mensual fija. Los proveedores de API REST cobran por token y pueden costar entre 10 y 30 veces más para un uso intensivo
- **Usa tu configuración CLI** — las preferencias de modelo, los prompts del sistema y la facturación son gestionados por la propia CLI

::: tip Suscripción vs API para Desarrolladores
Si también usas estas herramientas para programación asistida por IA (Claude Code, Codex CLI, Gemini CLI), la misma suscripción cubre tanto los Genios de IA de VMark como tus sesiones de programación — sin coste adicional.
:::

### Configuración: Claude CLI

1. Instala Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Ejecuta `claude` una vez en tu terminal para autenticarte
3. En VMark, haz clic en **Detectar** y luego selecciona **Claude**

### Configuración: Gemini CLI

1. Instala Gemini CLI: `npm install -g @google/gemini-cli` (o desde el [repositorio oficial](https://github.com/google-gemini/gemini-cli))
2. Ejecuta `gemini` una vez para autenticarte con tu cuenta de Google
3. En VMark, haz clic en **Detectar** y luego selecciona **Gemini**

## Proveedores de API REST

Los proveedores REST se conectan directamente a APIs en la nube. Cada uno requiere un endpoint, una clave API y un nombre de modelo.

| Proveedor | Endpoint Predeterminado | Variable de Entorno |
|-----------|------------------------|---------------------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| Google AI | *(integrado)* | `GOOGLE_API_KEY` o `GEMINI_API_KEY` |
| Ollama (API) | `http://localhost:11434` | — |

### Campos de Configuración

Al seleccionar un proveedor REST, aparecen tres campos:

- **Endpoint API** — La URL base (oculta para Google AI, que usa un endpoint fijo)
- **Clave API** — Tu clave secreta (almacenada solo en memoria — nunca se escribe en disco)
- **Modelo** — El identificador del modelo (por ejemplo, `claude-sonnet-4-5-20250929`, `gpt-4o`, `gemini-2.0-flash`)

### Auto-Relleno con Variables de Entorno

VMark lee las variables de entorno estándar al iniciarse. Si `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` o `GEMINI_API_KEY` está definida en tu perfil de shell, el campo de clave API se rellena automáticamente al seleccionar ese proveedor.

Esto significa que puedes configurar tu clave una vez en `~/.zshrc` o `~/.bashrc`:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Luego reinicia VMark — no es necesario introducir la clave manualmente.

### Configuración: Anthropic (REST)

1. Obtén una clave API en [console.anthropic.com](https://console.anthropic.com)
2. En Configuración > Integraciones de VMark, selecciona **Anthropic**
3. Pega tu clave API
4. Elige un modelo (predeterminado: `claude-sonnet-4-5-20250929`)

### Configuración: OpenAI (REST)

1. Obtén una clave API en [platform.openai.com](https://platform.openai.com)
2. En Configuración > Integraciones de VMark, selecciona **OpenAI**
3. Pega tu clave API
4. Elige un modelo (predeterminado: `gpt-4o`)

### Configuración: Google AI (REST)

1. Obtén una clave API en [aistudio.google.com](https://aistudio.google.com)
2. En Configuración > Integraciones de VMark, selecciona **Google AI**
3. Pega tu clave API
4. Elige un modelo (predeterminado: `gemini-2.0-flash`)

### Configuración: Ollama API (REST)

Úsalo cuando quieras acceso estilo REST a una instancia local de Ollama, o cuando Ollama esté ejecutándose en otra máquina de tu red.

1. Asegúrate de que Ollama esté en ejecución: `ollama serve`
2. En Configuración > Integraciones de VMark, selecciona **Ollama (API)**
3. Establece el endpoint en `http://localhost:11434` (o tu host de Ollama)
4. Deja la clave API vacía
5. Establece el modelo con el nombre del modelo que hayas descargado (por ejemplo, `llama3.2`)

## Elegir un Proveedor

| Situación | Recomendación |
|-----------|--------------|
| Ya tienes Claude Code instalado | **Claude (CLI)** — cero configuración, usa tu suscripción |
| Ya tienes Codex o Gemini instalado | **Codex / Gemini (CLI)** — usa tu suscripción |
| Necesitas privacidad / uso sin conexión | Instala Ollama → **Ollama (API)** en `http://localhost:11434` |
| Modelo personalizado o alojado en tu servidor | **Ollama (API)** con tu endpoint |
| Quieres la opción en la nube más económica | **Cualquier proveedor CLI** — la suscripción es mucho más barata que la API |
| Sin suscripción, solo uso ocasional | Configura la variable de entorno con la clave API → **Proveedor REST** (pago por token) |
| Necesitas la mayor calidad de salida | **Claude (CLI)** o **Anthropic (REST)** con `claude-sonnet-4-5-20250929` |

## Modelo Personalizado por Genio

Los genios individuales pueden anular el modelo predeterminado del proveedor usando el campo `model` en el frontmatter:

```markdown
---
name: quick-fix
description: Quick grammar fix
scope: selection
model: claude-haiku-4-5-20251001
---
```

Esto es útil para dirigir tareas simples a modelos más rápidos y económicos, manteniendo un modelo potente como predeterminado.

## Fiabilidad y tiempos de espera

VMark protege cada llamada al proveedor para que una CLI bloqueada o una respuesta de API mal formada nunca pueda bloquear el editor:

- **Tiempo de espera de subproceso CLI**: cada invocación de proveedor CLI se ejecuta bajo un tiempo de espera de ejecución. Si la CLI no responde, VMark cancela la llamada, devuelve el error al genio y libera el trabajador — el grupo de hilos no puede quedar atascado por un subproceso descontrolado.
- **Seguridad en el análisis JSON de REST**: si un proveedor REST devuelve una respuesta con una forma inesperada (página de error HTML, JSON truncado, cambio de esquema tras una actualización en el servidor), VMark muestra un error tipado en el frontend en lugar de dejar al listener de IA esperando indefinidamente. Verás el error en el banner de estado del genio con la opción de reintentar.
- **Tokens de cancelación**: las tareas de genio o workflow de larga duración pueden cancelarse en cualquier momento — pulsa Cancelar en el selector de genio o cierra el panel y la solicitud en curso se cancela limpiamente.
- **Cliente HTTP compartido**: los proveedores REST comparten un único cliente `reqwest` con pool de conexiones, de modo que las ejecuciones consecutivas de genios no pagan el coste del handshake TCP/TLS cada vez.
- **Descubrimiento de PATH en Windows**: en Windows, VMark lee el `PATH` completo del usuario (incluidas las entradas exclusivas de PowerShell) al detectar CLIs, de modo que las herramientas instaladas por el usuario que funcionan en un terminal también funcionan dentro de VMark.

## Notas de Seguridad

- **Las claves API son efímeras** — se almacenan solo en memoria, nunca se escriben en disco ni en `localStorage`
- **Las variables de entorno** se leen una vez al inicio y se almacenan en memoria
- **Los proveedores CLI** usan tu autenticación CLI existente — VMark nunca ve tus credenciales
- **Todas las solicitudes van directamente** desde tu máquina al proveedor — no hay servidores de VMark intermediarios

## Solución de Problemas

**"No hay proveedor de IA disponible"** — Haz clic en **Detectar** para buscar CLIs, o configura un proveedor REST con una clave API.

**La CLI muestra "No encontrado"** — La CLI no está en tu `$PATH`. Instálala o verifica tu perfil de shell. En macOS, las aplicaciones GUI pueden no heredar el `$PATH` del terminal — intenta añadir la ruta a `/etc/paths.d/`.

**La CLI se bloquea / sin respuesta** — El tiempo de espera de ejecución de VMark cancelará la llamada automáticamente; verás un error en el banner de estado del genio. Si una CLI en particular alcanza el tiempo de espera de forma sistemática, ejecútala una vez desde el terminal para confirmar que funciona allí y luego comprueba si requiere autenticación interactiva.

**El proveedor REST devuelve 401** — Tu clave API no es válida o ha expirado. Genera una nueva desde la consola del proveedor.

**El proveedor REST devuelve 429** — Has alcanzado el límite de solicitudes. Espera un momento e inténtalo de nuevo, o cambia a un proveedor diferente.

**El proveedor REST devuelve JSON ilegible / inesperado** — VMark muestra un error de análisis tipado (p. ej. "list_models returned an unexpected response shape"). Verifica la URL del endpoint y que el contrato de la API coincida con el tipo de proveedor seleccionado; algunas pasarelas auto-alojadas anuncian URLs compatibles con OpenAI pero envían un esquema diferente.

**Respuestas lentas** — Los proveedores CLI añaden sobrecarga de subprocesos. Para respuestas más rápidas, usa proveedores REST que se conectan directamente. Para la opción local más rápida, usa Ollama con un modelo pequeño.

**Error de modelo no encontrado** — El identificador del modelo no coincide con lo que ofrece el proveedor. Consulta la documentación del proveedor para los nombres de modelo válidos.

## Ver También

- [Genios de IA](/es/guide/ai-genies) — Cómo usar la asistencia de escritura con IA
- [Configuración de MCP](/es/guide/mcp-setup) — Integración de IA externa mediante el Protocolo de Contexto de Modelo
