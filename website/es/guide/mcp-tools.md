# Referencia de herramientas MCP

VMark expone **cuatro herramientas MCP compuestas** a los asistentes de IA: `session`, `workspace`, `document` y `workflow`. En conjunto cubren **14 acciones** — la columna de lectura/escritura, además del ciclo de vida de archivos y ventanas, más las ediciones seguras a nivel de CST para YAML de GitHub Actions.

La superficie anterior de 12 herramientas / 76 acciones se podó porque las herramientas de formato dentro del documento (negrita, encabezados, tablas, etc.) duplican un trabajo que los agentes de IA ya hacen trivialmente mediante el viaje de ida y vuelta de Markdown. Consulta [el plan de poda de MCP](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md) para la justificación completa.

::: tip Flujo de trabajo recomendado
1. Llama a `session.get_state` una vez para ver las ventanas abiertas, las pestañas y, por pestaña, `{filePath, dirty, revision, kind}`.
2. Para Markdown: `document.read` → razonar → `document.write` (pasando `expected_revision` para una concurrencia segura).
3. Para YAML de GitHub Actions (`kind: "yaml-workflow"`): `workflow.apply_patch` para ediciones seguras a nivel de CST que preservan los comentarios y los anclas; `workflow.validate` para los diagnósticos de actionlint.
4. Las operaciones de archivo (abrir, guardar, cerrar, cambiar pestañas) viven en `workspace`.
:::

::: tip Diagramas Mermaid
Cuando uses IA para generar Mermaid mediante MCP, considera instalar el [servidor MCP mermaid-validator](/es/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) — detecta errores de sintaxis usando los mismos parsers de Mermaid v11 antes de que los diagramas lleguen a tu documento.
:::

---

## `session`

Orientación de un solo paso. Descubre cada ventana, cada pestaña y las capacidades del servidor en una única llamada.

### `get_state`

Sin argumentos.

**Devuelve** `{windows, capabilities}`:

```json
{
  "windows": [
    {
      "label": "main",
      "focused": true,
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown"
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow"
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.1.0"
  }
}
```

El discriminador `kind` te indica si debes usar `document.write` (para markdown) o `workflow.apply_patch` (para yaml-workflow) en esa pestaña.

---

## `workspace`

Ciclo de vida de archivos y ventanas. Nada dentro del documento.

### `new`

Crea una nueva pestaña sin título.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `kind` | string | No | `"markdown"` (predeterminado) o `"yaml-workflow"` |
| `windowLabel` | string | No | Ventana de destino; por defecto, la enfocada |

Devuelve `{tabId}`.

### `open`

Abre un archivo desde el disco.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `filePath` | string | Sí |
| `windowLabel` | string | No |

Devuelve `{tabId}`.

### `save`

Guarda una pestaña en su ruta existente.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No (por defecto, la enfocada) |

Devuelve `{filePath, revision}`.

### `save_as`

Guarda una pestaña en una ruta nueva.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |
| `filePath` | string | Sí |

Devuelve `{revision}`.

### `close`

Cierra una pestaña. Se niega a descartar trabajo no guardado sin `force`.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | Sí |
| `force` | boolean | No |

Devuelve `{closed: true}` en caso de éxito, o `{closed: false, reason: "DIRTY"}` si la pestaña está sucia y no se proporcionó `force`.

### `switch_tab`

Activa una pestaña.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | Sí |

### `focus_window`

Enfoca una ventana.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `windowLabel` | string | Sí |

---

## `document`

Leer, escribir, transformar. La columna vertebral de la superficie.

### `read`

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No (por defecto, la enfocada) |

Devuelve `{content, revision, filePath, kind, dirty}`. Lee siempre antes de escribir — el token `revision` debe acompañar al siguiente `write`.

### `write`

Reemplaza por completo el contenido del documento.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `tabId` | string | No | Pestaña de destino (por defecto, la enfocada) |
| `content` | string | Sí | Nuevo contenido completo |
| `expected_revision` | string | No | Token de revisión de la última lectura |

Si se proporciona `expected_revision` y el documento ha cambiado desde esa lectura, la respuesta es un sobre de error estructurado `STALE` con la revisión actual; vuelve a leer y reintenta.

```json
// success
{ "revision": "rev-newAfterWrite" }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

Aplica una reescritura determinista. Actualmente admite transformaciones específicas de CJK (conversión entre puntuación de ancho completo y ASCII, espaciado entre CJK y caracteres latinos).

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `tabId` | string | No | Pestaña de destino |
| `kind` | string | Sí | `"cjk-format"`, `"cjk-spacing"` o `"cjk-punctuation"` |
| `expected_revision` | string | No | Token de concurrencia |

`cjk-format` aplica de extremo a extremo la configuración de formato CJK del usuario. `cjk-spacing` inserta un espacio único entre los caracteres CJK y los caracteres latinos o dígitos adyacentes. `cjk-punctuation` convierte la puntuación ASCII contigua a caracteres CJK a su forma de ancho completo.

Devuelve `{revision}`.

---

## `workflow`

Validación con `actionlint` y **ediciones quirúrgicas seguras a nivel de CST** para YAML de flujos de trabajo de GitHub Actions. Disponible solo para pestañas cuyo `kind` sea `"yaml-workflow"`.

::: info `document.read` / `document.write` funcionan en cualquier pestaña — incluido el YAML de flujos de trabajo
La herramienta `workflow` **no** sustituye a la columna de lectura/escritura. Para una pestaña de flujo de trabajo puedes:

- `document.read` para obtener el texto YAML en bruto (con todos los comentarios)
- `document.write` para reemplazarlo por completo (la cadena que envíes se almacenará tal cual — los comentarios se preservan si los incluyes)
- `workflow.apply_patch` cuando quieras que **el propio servidor garantice** que los comentarios, los anclas y el orden de las claves sobreviven a una edición parcial

Usa `apply_patch` cuando cambies un solo campo y quieras dejar todo lo demás intacto (el servidor no puede descartar comentarios que no toca). Usa `document.write` cuando estés reescribiendo en bloque o generando un nuevo flujo de trabajo desde cero.
:::

### `apply_patch`

Aplica un array de objetos `IRPatch`. Los parches se despachan a través de los mutadores con conciencia de CST de VMark, que preservan los comentarios, los anclas y el orden de las claves. Un `document.write` directo a un archivo YAML los perdería.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |
| `patches` | IRPatch[] | Sí |
| `expected_revision` | string | No |

`IRPatch` es una unión discriminada (campo `kind`). Tipos admitidos:

| `kind` | Efecto |
|---|---|
| `workflow.set` | Establece campos de nivel superior (`{path, value}`) — `name`, `env.X`, etc. |
| `job.set` | Establece un campo en un job (`{jobId, path, value}`) |
| `step.set` | Establece un campo en un step (`{jobId, stepIndex, path, value}`) |
| `with.set` | Establece una clave en el bloque `with:` de un step (`{jobId, stepIndex, key, value}`) |
| `with.remove` | Elimina una clave del bloque `with:` de un step |
| `needs.add` / `needs.remove` | Añade o elimina un ID de job de `needs:` |
| `trigger.setFilters` | Reemplaza un array de filtros del trigger — branches, paths, types, etc. (`{event, filter, value: string[]}`) |

Devuelve `{revision}` en caso de éxito o un sobre de error estructurado `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW`.

### `validate`

Ejecuta `actionlint` sobre el YAML del flujo de trabajo.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |

Devuelve `{ok, diagnostics, binaryAvailable}`. Cada diagnóstico contiene `{line, col, message, severity}`. `binaryAvailable: false` indica que `actionlint` no está instalado localmente; instálalo mediante Homebrew o las versiones oficiales.

---

## Errores

Aparecen dos formas de error:

**Errores de dominio** — establecen `success: false` y devuelven un sobre codificado en JSON en `error`:

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**Errores de forma de argumentos** — para argumentos requeridos ausentes o inválidos (por ejemplo, un `document.write` sin campo `content`), `error` es una cadena simple que describe el problema. El sobre estructurado se reserva para condiciones de nivel de dominio.

| Código | Se expone como | Significado |
|---|---|---|
| `STALE` | sobre | `expected_revision` no coincidió; vuelve a leer y reintenta |
| `INVALID_PATCH` | sobre | `workflow.apply_patch` recibió un array `patches` mal formado |
| `INVALID_TAB` | sobre | No se pudo resolver `tabId` |
| `INVALID_PATH` | sobre | `workspace.open` recibió un `filePath` que no se pudo leer |
| `NOT_WORKFLOW` | sobre | Se invocó `workflow.*` en una pestaña que no es YAML de flujo de trabajo |
| `READ_ONLY` | sobre | Se intentó una mutación en un documento de solo lectura |
| `INTERNAL` | sobre | Error inesperado del manejador |
| (cadena simple) | cadena | Argumento requerido ausente o de tipo incorrecto |
