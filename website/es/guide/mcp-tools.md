# Referencia de herramientas MCP

VMark expone **diez herramientas MCP compuestas** a los asistentes de IA: `session`, `workspace`, `document`, `workflow`, `selection`, `comments`, `browser`, `browser_read`, `coherence` y `coherence_resolve`. En conjunto cubren la columna vertebral del editor, el ciclo de vida de archivos y ventanas, las ediciones seguras a nivel de CST para flujos de trabajo, las ediciones dirigidas sobre la selección, la navegación acotada del navegador y una vista de la capa de coherencia del espacio de trabajo.

Tres de las diez — `session`, `browser_read` y `coherence` — declaran `readOnlyHint: true`, de modo que un cliente MCP puede aprobarlas automáticamente. Esa es la razón por la que `browser`/`browser_read` y `coherence`/`coherence_resolve` son herramientas separadas: las anotaciones son **por herramienta**, no por acción, así que una herramienta que combina una instantánea ARIA con `execute_js` tiene que advertir del peligro de `execute_js`. Dividir según la pregunta «¿esto modifica algo?» permite que cada mitad diga la verdad y mantiene visibles en la lista de herramientas las acciones genuinamente destructivas de la superficie.

La superficie anterior de 12 herramientas / 76 acciones se podó porque las herramientas de formato dentro del documento (negrita, encabezados, tablas, etc.) duplican un trabajo que los agentes de IA ya hacen trivialmente mediante el viaje de ida y vuelta de Markdown. Se conservó `selection` (según el ADR-7 del plan de poda) porque el viaje de ida y vuelta del documento completo resulta poco económico en archivos grandes — cada edición paga el documento entero en tokens de entrada, el documento entero en tokens de salida (~5× el precio de entrada) y una ventana de escritura más larga que amplía el bucle de reintentos por revisión obsoleta. Consulta [el plan de poda de MCP](https://github.com/xiaolai/vmark/blob/main/.claude/adr/plans/20260504-mcp-pruning.md) para la justificación completa.

::: tip Flujo de trabajo recomendado
1. Llama a `session.get_state` una vez para ver las ventanas abiertas, las pestañas y, por pestaña, `{filePath, dirty, revision, kind}`.
2. Para cambios pequeños de Markdown o reescrituras completas: `document.read` → razonar → `document.write` (pasando `expected_revision` para una concurrencia segura).
3. Para ediciones dirigidas sobre un archivo Markdown grande cuando el usuario ha seleccionado la región a cambiar: `selection.get` → razonar → `selection.set` (reduce el coste en tokens tanto de entrada como de salida a la selección).
4. Para YAML de GitHub Actions (`kind: "yaml-workflow"`): `workflow.apply_patch` para ediciones seguras a nivel de CST que preservan los comentarios y los anclas; `workflow.validate` para los diagnósticos de actionlint.
5. Las operaciones de archivo (abrir, guardar, cerrar, cambiar pestañas) viven en `workspace`.
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
      "activeWorkspaceInstanceId": "wsi-a1b2c3",
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown",
          "active": true,
          "visible": true
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow",
          "active": false,
          "visible": false
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.2.0"
  }
}
```

#### Saber qué hay realmente en pantalla

Una pestaña puede existir, ser direccionable y aun así no estar mostrándose. Tres campos lo indican:

| Campo | Significado |
|---|---|
| `tab.active` | Esta pestaña es la pestaña actual de su ventana. |
| `tab.visible` | Esta pestaña se renderiza en este momento. Es `false` cuando la pestaña pertenece a una instancia del espacio de trabajo que la ventana no está mostrando actualmente. |
| `window.activeWorkspaceInstanceId` | La instancia del espacio de trabajo que la ventana está mostrando, o `null` cuando la barra de espacios de trabajo está desactivada (entonces todas las pestañas son visibles). |

`window.focused` es la ventana que el **usuario** está mirando, leída del sistema operativo. No es «la ventana que respondió a esta solicitud» — VMark enruta una solicitud a la ventana que posee el espacio de trabajo pertinente, que en una sesión con varias ventanas suele ser otra distinta.

`windows` enumera todas las ventanas de documento — `main` y cada ventana abierta desde el Finder o la línea de comandos —, porque VMark se lo pregunta a todas. Mientras escribe en su cliente de IA, ninguna ventana de VMark tiene el foco y todos los `focused` son `false`; una solicitud sin `tabId` ni ruta de espacio de trabajo va entonces a la última ventana de documento que usó, no a `main`.

Trata esto como el paso de confirmación: tras `workspace.switch_tab`, un `get_state` de seguimiento te dice si la pestaña está realmente delante del usuario. El propio `switch_tab` vuelve a leer los stores antes de responder, por lo que informa `activated: false` cuando una activación no se concretó, en lugar de limitarse a repetir la solicitud.

El discriminador `kind` te indica si debes usar `document.write` (para markdown) o `workflow.apply_patch` (para yaml-workflow) en esa pestaña.

---

## `workspace`

Ciclo de vida de archivos y ventanas. Nada dentro del documento.

> **Alcance de rutas.** Las operaciones de archivo (`open`, `save`, `save_as`) se limitan
> a la raíz del espacio de trabajo abierto y a los directorios de los documentos ya abiertos. Una
> solicitud de una ruta fuera de ese alcance se rechaza con `INVALID_PATH`. Sin
> espacio de trabajo y sin documento abierto, no hay alcance, por lo que las operaciones de archivo
> se rechazan. Esto mantiene a un cliente automatizado actuando dentro de lo que has abierto.

### `new`

Crea una nueva pestaña sin título.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `kind` | string | No | `"markdown"` (predeterminado) o `"yaml-workflow"` |
| `windowLabel` | string | No | Ventana de destino; por defecto, la enfocada |

Devuelve `{tabId}`.

### `open`

Abre un **archivo** del disco en una pestaña **en segundo plano** — la pestaña visible
del usuario y su espacio de trabajo no cambian. Encadena el `tabId` devuelto en llamadas a
`document` / `selection`; usa `switch_tab` solo cuando el usuario deba *ver* la pestaña.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `filePath` | string | Sí |
| `windowLabel` | string | No |

Devuelve `{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}`.

### `open_workspace`

Abre una **carpeta** como el espacio de trabajo activo. A diferencia de `open` (un solo archivo
dentro de un árbol ya consentido), esto concede al asistente acceso a un árbol de archivos
completamente nuevo, por lo que está **sujeto a una aprobación única del usuario** y no lo cubre
el alcance de rutas anterior.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `folderPath` | string | Sí |

Aquí **no** se acepta `windowLabel`, a diferencia de `new` y `open`. La carpeta
siempre se abre en la ventana en la que llega la solicitud. Esto es deliberado: el
diálogo de aprobación y la apertura deben producirse en la misma ventana, y una
etiqueta proporcionada por el cliente podría poner el aviso delante de una ventana mientras
muta otra — aprobando una cosa y obteniendo otra. Apuntar a varias ventanas necesita un
enrutamiento de solicitudes que aún no existe.

**Flujo de aprobación.** La primera llamada devuelve `{needsApproval: true}` y muestra un
diálogo de consentimiento que nombra la ruta *canónica* de la carpeta (con los enlaces simbólicos
resueltos). El asistente debe preguntar al usuario y luego **reintentar la misma llamada**; una vez
que el usuario aprueba, el reintento abre la carpeta. La aprobación pertenece a la conexión que la pidió: solo un reintento desde la misma conexión MCP puede usarla. Otro asistente conectado recibe su propia solicitud, y un cliente que se reconectó (una conexión nueva) debe aprobarse de nuevo. La aprobación también caduca si no se usa en cinco minutos. Una solicitud denegada seguirá fallando hasta
que se vuelva a aprobar. No hay opción de «recordar» — cada apertura se aprueba individualmente.

**Acceso a carpetas.** Aprobar el diálogo no basta para que VMark lea una carpeta fuera de los lugares que siempre puede leer (tu carpeta de usuario y los volúmenes montados). Para una carpeta así, el reintento aprobado abre el selector de carpetas de VMark en esa carpeta y responde `APPROVAL_REQUIRED`, pidiendo al usuario que la elija allí; una vez hecho, el siguiente reintento la abre. Si ya hay otro diálogo de carpetas abierto, no se muestra nada y la respuesta es `BUSY` — la aprobación se conserva, así que reintenta cuando el usuario haya cerrado ese diálogo. `BUSY` también es la respuesta mientras ya hay un cambio de espacio de trabajo en curso en esa ventana.

### `save`

Guarda una pestaña en su ruta existente.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No (por defecto, la enfocada) |

Devuelve `{filePath, revision, journaled}`.

### `save_as`

Guarda una pestaña en una ruta nueva.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |
| `filePath` | string | Sí |

Devuelve `{revision, journaled}`.

Guardar en una ruta distinta del archivo actual de la propia pestaña se trata como una
escritura nueva. Cuando **Aprobar automáticamente guardados en una ubicación nueva y resultados de genios** (Configuración → Integraciones) está
desactivado (lo predeterminado), una solicitud así se rechaza con `APPROVAL_REQUIRED` y un aviso
te indica qué se bloqueó. Guardar de vuelta en la ruta propia de la pestaña siempre está permitido.

La comprobación de la ruta se repite cuando le llega el turno al guardado en la cola de guardados de ese archivo. Una ruta que para entonces ha salido del ámbito permitido (por ejemplo, porque el espacio de trabajo se cerró mientras el guardado esperaba) se rechaza con `INVALID_PATH` y no se escribe nada.

`save_as` nunca reemplaza un archivo que no sea el propio de la pestaña. Un destino que ya contiene un archivo se rechaza con `APPROVAL_REQUIRED`, incluso un archivo creado después de comprobar la solicitud, mientras el guardado estaba en curso: el archivo solo se escribe si no hay nada en esa ruta en el momento de colocarlo, y el archivo encontrado allí conserva su contenido. Si el disco no puede escribir de esa forma, el guardado se rechaza en lugar de sobrescribir.

Un `save` o `save_as` se rechaza con `STALE` cuando un guardado hecho después de este — desde cualquier documento o ventana — ya llegó a ese archivo (por ejemplo, a través de un enlace simbólico y el archivo al que apunta), así que este, más antiguo, no escribió nada. Lee el documento antes de volver a escribir. `document.write` informa del mismo caso como `saved: false` con un `save_error`.

### `close`

Cierra una pestaña de documento. Se niega a descartar trabajo no guardado sin `force` y nunca cierra una pestaña fijada.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | Sí |
| `force` | boolean | No |

Devuelve `{closed: true}` en caso de éxito. En otro caso, `{closed: false, reason}`:

| `reason` | Significado |
|----------|-------------|
| `DIRTY` | La pestaña tiene cambios sin guardar y no se proporcionó `force` |
| `DIVERGENT` | El archivo cambió en el disco y el usuario conservó la versión de la pestaña; sin `force`, el cierre la perdería |
| `PINNED` | La pestaña está fijada — se rechaza incluso con `force`; el usuario debe desfijarla |

Las pulsaciones que el editor aún no ha transmitido se cuentan como no guardadas antes de la comprobación. Una pestaña del navegador se rechaza con un error `INVALID_TAB` — ciérrala con la acción `close` de la herramienta `browser`.

### `switch_tab`

Activa una pestaña y la hace **visible**. Con el [barra de espacios de trabajo](/es/guide/workspace-rail)
activado, esto puede cambiar el contexto de espacio de trabajo activo del usuario — la respuesta
informa `workspaceSwitched: true` cuando lo hace, así que el asistente debería avisar al usuario.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | Sí |

Devuelve `{activated, workspaceSwitched, workspaceInstanceId, activeTabId}`.

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
| `addresses` | string[] | No | Ids de comentarios de `comments.list` que esta edición responde (64 como máximo) |
| `save` | boolean | No | Guardar también en el disco (predeterminado `true`); `false` solo cambia la pestaña |

De forma predeterminada la escritura se guarda: la respuesta lleva `saved: true`, o `saved: false` con `save_skipped` (`"untitled"` — la pestaña aún no tiene archivo, usa `save_as`; `"opt_out"` — pasaste `save: false`) o `save_error` (la escritura en disco falló). Cuando el destino es la pestaña WYSIWYG activa de un documento Markdown, el texto se carga en el editor en vivo (como un único paso que se puede deshacer), y lo que se guarda es la serialización del editor — el mismo Markdown, posiblemente normalizado, no necesariamente los caracteres exactos enviados. Las demás pestañas guardan el texto tal como se envió, con los finales de línea normalizados.

Si la pestaña se cierra después de que la escritura la haya cambiado pero antes de guardarse, la respuesta es `saved: false` con un `save_error` que indica que la pestaña se cerró. No se escribe nada en la ruta que tenía la pestaña.

Cada guardado que hace un cliente de IA — mediante `write`, `workspace.save` o `workspace.save_as` — se registra en el historial del documento como una instantánea `mcp` (marcada como *(mcp)* en la barra lateral de Historial), de modo que las versiones escritas por una IA se distinguen de las tuyas. Igual que un guardado manual, nunca se fusiona con un autoguardado vecino ni se omite por su tamaño.

Cada respuesta de guardado incluye además `journaled` — en `write`, solo cuando se guardó. `"yes"`: el diario de ediciones de agentes de VMark registró el texto guardado. `"pending"`: está registrado y ocupa su lugar en la historia del documento cuando termine de registrarse una escritura aún en curso. `"no"`: el archivo está guardado, pero el diario no lo registró. Un guardado nunca es un error por causa del diario.

Si se proporciona `expected_revision` y el documento ha cambiado desde esa lectura, la respuesta es un sobre de error estructurado `STALE` con la revisión actual; vuelve a leer y reintenta.

```json
// success
{ "revision": "rev-newAfterWrite", "applied": true, "durable": true, "saved": true }

// stale
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

Mientras el usuario compone texto con un método de entrada (IME) en el editor que muestra la pestaña, en modo WYSIWYG o Fuente, la escritura se rechaza con `BUSY` y no cambia nada: el texto en composición pertenece al método de entrada hasta que se confirma. Un editor en modo Fuente también se considera en composición durante un breve margen justo después de que termine la composición. Reintenta en breve.

Cada escritura se registra en el diario de ediciones de agentes de VMark antes de que cambie nada. La respuesta de éxito incluye `applied: true` y `durable`: `durable: false` significa que el contenido se escribió pero su registro en el diario aún no pudo guardarse — VMark lo reintenta en segundo plano y, hasta que lo consiga, la siguiente escritura en ese documento se rechaza con `JOURNAL_DEGRADED`. Si el diario rechaza el registro por completo, la escritura sigue aplicada, queda en el log como no registrada y la siguiente escritura sigue adelante. Una escritura se rechaza sin cambiar nada con `JOURNAL_BUSY` mientras se registra otra escritura en el mismo documento (dos ventanas con el mismo archivo comparten un documento), con `STALE_PARENT` cuando otra ventana escribió el documento después de la última escritura de esta pestaña (vuelve a leer y reintenta), con `JOURNAL_UNAVAILABLE` cuando el diario no está en marcha o no responde a tiempo, y con `INVALID_TEXT` cuando `content` contiene un sustituto UTF-16 suelto. Si el usuario edita el documento, cierra la pestaña, empieza a componer con un método de entrada o mueve la selección (o cambia de pestaña, si no se indicó `tabId`) mientras se registra la escritura, esta se rechaza con `ABORTED` y un `reason` (`edited`, `closed`, `composing`, `selection`) y no cambia nada; vuelve a leer y reintenta. Un error `INTERNAL` que lleva `applied: true` es distinto: el editor falló después de que la escritura ya hubiera cambiado el documento, y se registró el texto que contenía entonces (`durable` como arriba, `current_revision` es la revisión del documento); vuelve a leer antes de escribir de nuevo. Un error `INTERNAL` sin `applied` tras una escritura fallida significa que el documento puede haber cambiado en parte; vuelve a leerlo también.

### `transform`

Aplica una reescritura determinista. Actualmente admite transformaciones específicas de CJK (conversión entre puntuación de ancho completo y ASCII, espaciado entre CJK y caracteres latinos).

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `tabId` | string | No | Pestaña de destino |
| `kind` | string | Sí | `"cjk-format"`, `"cjk-spacing"` o `"cjk-punctuation"` |
| `expected_revision` | string | No | Token de concurrencia |
| `addresses` | string[] | No | Ids de comentarios de `comments.list` que esta edición responde (64 como máximo) |

`cjk-format` aplica de extremo a extremo la configuración de formato CJK del usuario. `cjk-spacing` inserta un espacio único entre los caracteres CJK y los caracteres latinos o dígitos adyacentes. `cjk-punctuation` convierte la puntuación ASCII contigua a caracteres CJK a su forma de ancho completo.

Devuelve `{revision, applied, durable}`. Igual que `write`, se rechaza con `BUSY`, sin cambiar nada, mientras el usuario compone con un método de entrada en el editor que muestra la pestaña, en modo WYSIWYG o Fuente. Igual que `write`, se registra en el diario de ediciones de agentes de VMark antes de que cambie nada: `applied`, `durable` y los rechazos del diario (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) significan lo mismo; una llamada que no cambia nada no se registra.

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
| `addresses` | string[] | No |

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

Devuelve `{revision, applied, durable}` en caso de éxito o un sobre de error estructurado `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW`. Igual que `write`, se registra en el diario de ediciones de agentes de VMark antes de que cambie nada: `applied`, `durable` y los rechazos del diario (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) significan lo mismo; una llamada que no cambia nada no se registra.

### `validate`

Ejecuta `actionlint` sobre el YAML del flujo de trabajo.

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |

Devuelve `{ok, diagnostics, binaryAvailable}`. Cada diagnóstico contiene `{line, col, message, severity}`. `binaryAvailable: false` indica que `actionlint` no está instalado localmente; instálalo mediante Homebrew o las versiones oficiales.

---

## `selection`

Lee o reemplaza la selección actual del usuario en el editor. Usa esto en lugar de `document.read`/`document.write` cuando el usuario ha resaltado la región a cambiar — `selection.get` devuelve solo la porción seleccionada, y `selection.set` reescribe solo ese rango, de modo que el coste en tokens escala con la edición, no con el documento.

::: warning La selección es estado de vista — solo la pestaña enfocada
La selección solo existe en el editor que está renderizado actualmente. Si se proporciona `tabId`, debe coincidir con la pestaña enfocada; una discordancia devuelve `INVALID_TAB`. Si la pestaña enfocada no tiene un editor activo (p. ej. un visor de solo lectura), la respuesta es `NO_EDITOR`.
:::

### `get`

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |

Devuelve:

| Campo | Tipo | Notas |
|---|---|---|
| `text` | string | Serialización a Markdown de la porción seleccionada (modo WYSIWYG), o el texto seleccionado en bruto (modo fuente). Cadena vacía cuando está colapsada. |
| `isEmpty` | boolean | `true` cuando la selección está colapsada (solo el cursor). |
| `range` | `{from, to}` | Posiciones de ProseMirror en modo WYSIWYG; desplazamientos de caracteres en modo fuente. |
| `mode` | `"wysiwyg"` \| `"source"` | Desambigua el espacio de posiciones de `range`. |
| `kind` | `"markdown"` \| `"yaml-workflow"` | Discriminador del tipo de documento. |
| `tabId` | string | Se repite para confirmación. |
| `revision` | string | Devuélvela a `set` para una concurrencia optimista. |

### `set`

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |
| `content` | string | Sí |
| `expected_revision` | string | No (recomendado) |
| `addresses` | string[] | No |

Reemplaza lo que el editor informe como la selección actual. **En modo WYSIWYG**, el texto en línea plano se inserta como un nodo de texto literal, de modo que los espacios en blanco iniciales/finales se conservan exactamente; el contenido que lleva marcadores de markdown (`**bold**`, `*italic*`, `` `code` ``, código en bloque, citas, listas, etc.) se interpreta como markdown y se inserta como los nodos correspondientes. **En modo fuente**, `content` siempre se inserta como texto en bruto — la superficie de fuente ya son bytes de markdown. Un `content` vacío elimina la selección. Cuando la selección está colapsada, `content` se inserta en la posición del cursor.

Devuelve `{revision, replaced_chars, applied, durable}` en caso de éxito. `replaced_chars` es la longitud del texto que estaba seleccionado antes de la llamada — útil para que la IA confirme que editó lo que esperaba. Igual que `write`, se registra en el diario de ediciones de agentes de VMark antes de que cambie nada: `applied`, `durable` y los rechazos del diario (`JOURNAL_BUSY`, `STALE_PARENT`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE`, `INVALID_TEXT`, `ABORTED`) significan lo mismo; una llamada que no cambia nada no se registra.

`STALE` devuelve `{error: "STALE", message, current_revision}` exactamente como `document.write`. La revisión a nivel de documento detecta las pulsaciones de tecla entre `get` y `set`. El puro movimiento del cursor (sin una pulsación) no lo arbitra el servidor — si el usuario movió el cursor entre `get` y `set`, la edición se aplica en la nueva posición.

`set` devuelve `BUSY`, sin cambiar nada, mientras el usuario compone texto con un método de entrada en el editor enfocado, ya sea en modo WYSIWYG o en modo Fuente; reintenta en breve. `get` nunca se rechaza por esto.

---

## `comments`

Lee y responde los comentarios de revisión del usuario sobre un documento. Resolver, reabrir y eliminar un comentario son decisiones del usuario: la herramienta no tiene esas acciones, y una llamada que pida una se rechaza antes de llegar a VMark.

### `list`

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |
| `cursor` | string | No |

Devuelve `{doc, generation, threads, nextCursor?}`, con el hilo más antiguo primero. Cada hilo lleva su id `comment`, su `state` (`open`, `addressed`, `resolved` o `reopened`), su `commentGen`, el texto citado al que está anclado y sus respuestas.

Una lista larga llega en páginas, cada una lo bastante pequeña para llegar completa. Mientras exista `nextCursor`, vuelve a llamar a `list` con `cursor` igual a ese valor. Un hilo dividido entre páginas lleva `repliesFrom` y `repliesTotal`; sus partes posteriores solo llevan `comment`, `state`, `commentGen`, `continued: true` y las siguientes respuestas. Un cuerpo demasiado largo para cualquier página como texto JSON (solo un texto con muchos escapes) llega como `bodyBase64`, sus bytes UTF-8 en base64, en lugar de `body`. Un cursor cuyo hilo se eliminó, o uno emitido para otro documento, se rechaza con `STALE_COMMENT`: vuelve a listar sin cursor.

### `reply`

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |
| `commentId` | string | Sí |
| `body` | string | Sí |
| `expectedCommentGen` | string | Sí |

Añade una respuesta al hilo. VMark genera el id de la respuesta, así que una llamada reintentada recibe el primer resultado y nunca añade una segunda respuesta.

### `mark_addressed`

| Parámetro | Tipo | Requerido |
|-----------|------|-----------|
| `tabId` | string | No |
| `commentId` | string | Sí |
| `expectedCommentGen` | string | Sí |

Marca el hilo como atendido. Resolverlo sigue siendo decisión del usuario.

`comments.reply` y `comments.mark_addressed` indican ambos el `commentGen` del hilo tal como lo devolvió `list`. Se rechazan sin cambiar nada con `STALE_COMMENT` cuando el hilo cambió o se eliminó desde entonces (vuelve a listar), `INVALID_COMMENT` cuando el id del comentario está mal formado o no corresponde a ningún comentario de este documento, `COMMENT_NOT_ALLOWED` cuando el hilo está resuelto, `COMMENT_LIMIT` cuando el hilo tiene demasiadas respuestas, el texto es demasiado largo o el hilo ya no puede cambiar más, y con los rechazos del diario `JOURNAL_BUSY`, `JOURNAL_DEGRADED`, `JOURNAL_UNAVAILABLE` e `INVALID_TEXT`.

Para indicar que una edición responde a comentarios, pasa sus ids como `addresses` a `document.write`, `document.transform`, `workflow.apply_patch` o `selection.set`. El vínculo se guarda con la revisión y se muestra en el historial del documento (un comentario eliminado después aparece como comentario eliminado); no mueve ningún hilo. Más de 64 ids, un id repetido o un id desconocido, eliminado, resuelto o de otro documento se rechaza con `INVALID_ADDRESSES`, y nada cambia.

---

## `browser`

El **lado mutante** de la superficie del navegador integrado — todo lo que cambia la página,
la pestaña o un inicio de sesión guardado. Lee primero la página con [`browser_read`](#browser-read):
cada modo de destino aquí se refiere a lo que devolvió una lectura.

Las herramientas del navegador siguen **Configuración → Avanzado → macOS → Navegador integrado**, que está
**activado de forma predeterminada** en macOS — así que estas herramientas están disponibles para un
cliente de IA conectado a menos que lo desactives. Cada acción falla con `BROWSER_DISABLED` mientras
está desactivado. Las URL devueltas a MCP se ocultan a través del mismo límite que usa el estado de
sesión del navegador de la aplicación.

Anotada como `readOnlyHint: false, destructiveHint: true` — precisa en lugar de meramente
conservadora, porque cada acción aquí muta algo.

**Los errores tienen tipo.** Un rechazo llega como `TOKEN: message` (`STALE_COMMAND`,
`NOT_GRANTED`, `EVAL_TIMEOUT`, `TAB_LIMIT`, …) con el mismo token — y cualquier dato
estructurado que adjuntó la aplicación (un ticket de navegación, el `reason` de un act, el verbo de reintento) — en
`structuredContent`. Compara con el token, no con el texto.

Un `EVAL_TIMEOUT` es **indeterminado**, no un fallo limpio: el script enviado puede
haberse ejecutado hasta el final después de que el driver dejara de esperar, así que lleva
`data.detail.indeterminate: true` y no debe reintentarse como si no hubiera pasado nada —
lee la página (`browser_read`) para saber en qué estado está antes de volver a actuar.

### `act`

Argumentos: `tabId?`, `operation: "click" | "type" | "scroll" | "key"`, y objetivos por
operación:

- **click / type** — un objetivo, ya sea `ref` (de una lectura previa) **o** `role` + `name`,
  y `text?` para escribir. Una `ref` es precisa e independiente del orden, pero solo se respeta
  para una operación **ya concedida**; si la acción puede necesitar aprobación, usa `role` + `name`
  para que el aviso muestre al usuario un elemento legible.
- **scroll** — `ref` (desplázalo hasta que quede a la vista) **o** `dy` (un delta vertical en píxeles).
- **key** — `key` (p. ej. `"Enter"`, `"Escape"`, `"Tab"`), `ref` opcional para apuntar, y
  `modifiers: {ctrl, shift, alt, meta}` opcionales.

`scroll` y `key` son de clase Actuar (sujetas a aprobación) y despachan eventos **sintéticos** del DOM,
así que un sitio que se basa en `event.isTrusted` puede ignorarlos. Las operaciones mutantes requieren
una aprobación acotada al origen; las subidas elegidas por la IA nunca se permiten.

**Un clic verifica su efecto antes de informar de éxito, y se niega en lugar de
adivinar.** El objetivo se desplaza hasta quedar a la vista, debe estar renderizado de forma visible (se comprueban los
estilos calculados y los ancestros colapsados o transparentes, de modo que un botón duplicado dentro de un paso
de acordeón cerrado se omite, no se pulsa) y el punto del clic se comprueba por hit-test — un objetivo
cubierto por una superposición se rechaza nombrando al elemento que lo tapa (`covered by div.cmp-overlay`,
datos de la página) en lugar de pulsarse a través de él. Cuando varios elementos visibles comparten el rol y el
nombre, el act se rechaza como `ambiguous` y `candidates` enumera sus refs — nunca elige
uno por orden en el documento. Otros motivos de rechazo: `hidden`, `offscreen` (no se puede desplazar
hasta el área visible), `disabled` (incluidos `pointer-events: none` y los subárboles inertes),
`upload` (los campos de archivo nunca se automatizan) y `rejected-value` (el campo saneó el
texto). Se recorren las shadow roots abiertas; la respuesta incluye los contadores `matchedTotal` /
`matchedVisible`, la `url` y la `generation` actuales de la pestaña tanto en caso de éxito **como** de
fallo, y `popup: {url}` cuando la página intentó abrir una ventana durante el act (VMark
bloquea las ventanas emergentes; la URL es la que quería abrir). `type` gestiona campos de texto, controles `<select>`
(pasa la etiqueta o el valor de la opción; una opción inexistente se rechaza como
`no-such-option`) y regiones `contenteditable`. `key` emula las acciones predeterminadas que
les faltan a los eventos sintéticos — Enter dentro de un formulario lo envía, Tab mueve el foco — e informa de
`defaultAction`.

**Qué vincula una aprobación.** Una aprobación de `click` vincula el elemento (rol + nombre). Una
aprobación de `type`, `key` o `scroll` también vincula el texto, la tecla (con modificadores) o el
delta exactos que pediste — el aviso lo muestra —, así que un reintento con un contenido distinto vuelve a preguntar.

### `workflow_run` / `workflow_cancel`

`workflow_run` ejecuta un flujo de trabajo que proporcionas como texto `source` en una pestaña
propiedad de la IA. Argumentos: `tabId?`, `source` (el texto del flujo de trabajo — una pequeña
gramática orientada a líneas; lo escribes tú, lo hace la IA, o [`workflow_record`](#workflow-record) lo
captura a partir de tus propias acciones), `inputs?` (un mapa `{name: value}` sustituido en las
referencias `{name}`; hay que proporcionar todas las entradas declaradas y las no declaradas se rechazan),
`allowRepeat?` y `resumeRunId?` (ver más abajo).
Devuelve `{runId, steps, firstStep}` **de inmediato** — la ejecución se realiza de forma
**asíncrona**, porque una ejecución de varios pasos puede sobrevivir a una sola solicitud. Sondea el
`workflow_status` de [`browser_read`](#browser-read) para ver el progreso; mientras la ejecución te espera,
informa de `pendingApproval`.

Los pasos deterministas — `click` / `type` / `navigate` en esa gramática, y `extract` — se ejecutan
dentro de VMark y están **sujetos a aprobación individualmente**, exactamente como un `act` emitido a
mano: la ejecución autoriza cada uno por separado, de modo que un flujo de trabajo no es una manera de
eludir los avisos de aprobación. `goal`, `confirm`, `api` y cualquier paso en prosa libre **pausan** la
ejecución para que la IA los gestione a mano. **Reanudar tras una pausa:** haz el paso pausado (o pide a la IA
que te ayude) y luego inicia una ejecución nueva con `resumeRunId` apuntando a la ejecución pausada — hereda los
pasos completados y trata el paso pausado como hecho, así que no se envía nada dos veces. Volver a
ejecutar **el mismo source con las mismas entradas** también omite los pasos de escritura que ya tuvieron
éxito en esta sesión (el registro de escrituras completadas; los pasos omitidos se informan como
`skipped`), a menos que se establezca `allowRepeat`. Unas entradas distintas son otro trabajo y se ejecutan
completas.

`workflow_cancel {tabId?, runId}` detiene una ejecución. **Nunca está sujeta a aprobación** — detener
siempre está permitido — y retira los avisos pendientes de la ejecución, aborta un paso que está esperando
tu aprobación y te devuelve la pestaña. Una ejecución terminada informa `already-terminal`
y se deja como estaba; un `runId` desconocido es `RUN_NOT_FOUND`. La ejecución también se detiene en
cuanto tomas el control del navegador (cualquier interacción con la página o su interfaz recupera
el control) — incluso mientras espera un aviso.

Las ejecuciones están acotadas (≤ 25 pasos, source ≤ 64 KiB y 120 s de tiempo **en ejecución** — el tiempo
que pasa esperándote no cuenta) y son de una en una por pestaña.

### `workflow_record`

Graba **tus propias acciones** en una pestaña propiedad de la IA y las convierte en un flujo de trabajo
reproducible. Argumentos: `tabId?`, `recordOp` (`"start"` o `"stop"`) y `site?` (el id de sitio del
front-matter del flujo grabado; su valor predeterminado es `recording`).

`start` está **sujeto a consentimiento** mediante el permiso `record`, que — al igual que `execute_js` y
`session` — **nunca es un permiso permanente**: cada grabación te lo pide de nuevo, de modo que la IA
nunca puede grabarte en silencio. Hasta que lo permitas, `start` devuelve `needsApproval`; en cuanto lo
haces, VMark arma un shim de captura latente en el mundo de la página y empieza a grabar los **clics y
las ediciones de campos** que realizas. `stop` devuelve `{source, inputs, eventCount}` — el `source` es
texto de flujo de trabajo que puedes guardar o pasar directamente a [`workflow_run`](#workflow-run-workflow-cancel).

La grabación está **libre de valores por construcción**, y esto no es un filtro que confíe en la página:
nada de lo que escribes se captura jamás. Cada campo de texto se convierte en una variable `{input}` con
nombre (el valor se proporciona en la reproducción, nunca se graba); un **campo de contraseña o de código
de un solo uso** se convierte en un paso `confirm:` — un punto de control humano que completas a mano en
la reproducción — de modo que un secreto nunca llega siquiera a parametrizarse; y cada URL se reduce a
origen + ruta, de modo que un token en una cadena de consulta no puede sobrevivir. Lo que se graba son
los **localizadores** que tocaste (rol ARIA + nombre accesible), nunca sus datos. La grabación te sigue a
través de las navegaciones de página y está acotada (200 eventos por página, 1000 por sesión).

### `open`

Argumentos: `url`, `timeoutMs` opcional (1–9000 ms) y `profile` opcional
(`[A-Za-z0-9._-]`, macOS 14+, postura sandbox): un **contexto persistente con nombre** para que un inicio de sesión
pueda reutilizarse por nombre — abrir uno necesita una aprobación nueva para cada uso, y la IA nunca ve
las credenciales. Crea una pestaña propiedad de la IA usando la postura actual Sandbox o Compartida,
la trae al frente y devuelve su `tabId`, `navigationId`, URL, título y generación
una vez completada la carga. Puede haber como máximo **8 pestañas propiedad de la IA** abiertas (`TAB_LIMIT`); la IA
cierra las que ya no necesita. En la postura Compartida, un `open` que necesita tu aprobación de destino
conserva su pestaña e indica a la IA que reintente con `navigate` sobre ese `tabId`
(`data.retry`) — un `open` nuevo crearía una pestaña que la aprobación no puede cubrir.

### `navigate`

Argumentos: `tabId?`, `url` y `timeoutMs` opcional. Navega una pestaña propiedad de la IA (trayéndola
al frente) y devuelve el resultado del ticket de navegación. Un `TIMEOUT` aún lleva el
ticket, de modo que un `wait` posterior pueda recuperar el resultado final.

### `close`

Argumentos: `tabId`. Cierra una pestaña propiedad de la IA que abrió la IA. **Nunca está sujeta a aprobación** —
detener siempre está permitido. Una pestaña humana se rechaza (`TAB_NOT_AI_OWNED`). El resultado es
`{tabId, closed: true, destroyed: true}` una vez confirmado que la vista nativa ha desaparecido; un
desmontaje que el driver no pudo confirmar tras sus reintentos se informa como
`TAB_TEARDOWN_FAILED` con `data.destroyed: false` — el registro de la pestaña ya no existe,
así que no reintentes el cierre; dile al usuario que puede que una vista nativa siga en ejecución.

**Detección de barreras.** Un resultado de `open` / `navigate` / `wait` cargado puede llevar
`gate: {kind, hint}` cuando la página a la que se llegó se interpreta como un **muro de inicio de
sesión**, una **pantalla intersticial de consentimiento**, un **desafío de verificación humana** o un
**límite de frecuencia** — de modo que la IA se entera de que no está viendo el contenido que pidió, en
el momento en que lee el resultado. La detección prioriza la precisión (un widget de desafío renderizado,
o al menos dos señales independientes en una página escueta — un precio de «$429», un pie de página de
«Protected by Cloudflare» o un artículo *sobre* CAPTCHAs nunca clasifican) y es puramente orientativa:
cambia lo que se le dice a la IA, nunca lo que está autorizado, y cada sugerencia apunta a involucrarte
en lugar de sortear la barrera.

### `style`

Argumentos: `tabId?`, un objetivo (`ref` **o** `selector`), y uno de `set: {prop: value}`,
`addClasses`, `removeClasses` o `injectCss`. Descarta una superposición que bloquea, resalta un
objetivo, etc. **Clase Actuar** (sujeta a aprobación, op `style`). Mundo de contenido aislado.

### `execute_js`

Argumentos: `tabId?`, `script` — el cuerpo de una función async que hace `return` (o await) de un
valor serializable como JSON. La vía de escape para lo que los verbos estructurados no pueden expresar.
Se ejecuta en el **mundo de contenido aislado** — comparte el DOM (así que `querySelector`,
`element.style` funcionan) pero **no puede** ver el heap/globales de JS propios de la página. El valor vuelve
como `result` (`undefined` se convierte en `null`); una excepción, o un valor que JSON no puede codificar, es un
**fallo que nombra el error**, nunca un resultado. Se aprueba **solo por llamada** (nunca un permiso
permanente, impuesto en el driver de Rust), la aprobación muestra el script, y el
valor de retorno se marca como **no confiable** y nunca se introduce automáticamente en un `act` posterior. Prefiere
`query`/`style` primero.

### `session_save` / `session_load`

Argumentos: `tabId?`, `handle` (`[A-Za-z0-9._-]`, 1–128 caracteres). `session_save` toma una
instantánea de la sesión de la pestaña en una entrada del **keychain del sistema operativo** nombrada
por `handle` y devuelve un resumen sin valores (recuentos); `session_load` la restaura y devuelve
`{loaded: true, handle}` — una confirmación más el handle proporcionado por la IA, nunca ningún valor.
Un `session_load` solo se aplica a una página con el **mismo origen** desde el que se guardó la sesión.
Esto es credencial **por referencia** (ADR-A7): la IA nombra una sesión guardada y nunca recibe los
valores de cookies/tokens, que nunca se registran. Ambas son el permiso `session` — **nunca un permiso
permanente** (aprobado por llamada), y una aprobación para un handle no puede gastarse en otro. Una sesión
guardada cubre `localStorage` **y las cookies**, ambos acotados al origen en el que estaba la página
cuando la guardaste.

### `console_clear`

Argumentos: `tabId?`. Devuelve `{entries: [{level, text}], url}` exactamente como el `console` de
[`browser_read`](#browser-read), **y vacía el búfer** de modo que la siguiente lectura solo vea salida
nueva. Vive aquí en lugar de con la otra lectura de consola porque el vaciado evalúa
`element.textContent = "[]"` en la página — una escritura en el DOM.

La postura Compartida pide aprobación de destino para cada nuevo origen a menos que exista un permiso
`navigate` correspondiente. Una pestaña creada por un humano requiere una aprobación de vinculación
efímera antes de que la IA pueda leer/actuar. Las pestañas sandbox usan un almacén de cookies de IA
separado y no persistente.

---

## `browser_read`

El **lado de solo lectura**: observa la pestaña sin cambiarla. Anotada como
`readOnlyHint: true`, de modo que un cliente MCP puede aprobarla automáticamente — que es el objetivo de
la división. Estas acciones vivían antes en `browser`, donde una única anotación a nivel de herramienta
tenía que describir también `execute_js`, así que tomar una instantánea ARIA costaba una aprobación
humana.

`openWorldHint` permanece en `true`: solo lectura describe lo que la herramienta *cambia*, no si se
puede confiar en los bytes. Todo lo que se devuelve está controlado por la página y es **no confiable** —
nunca reintroduzcas un resultado directamente como objetivo de un act de `browser`.

### `read`

Devuelve `{url, snapshot, truncated?, unreachable?}` para la pestaña del navegador enfocada, o la
pestaña nombrada por `tabId`. `snapshot` es una lista orientada a ARIA de nodos `{role, name, ref}` —
más `level` para los encabezados, `checked`, `disabled` y `upload: true` para un campo de archivo que la
IA nunca puede operar —, y cada `ref` (p. ej. `"e5"`) es un handle estable para ese elemento, válido durante
la vida de la vista actual. El recorrido entra en las shadow roots abiertas; `unreachable` cuenta las
shadow roots cerradas y los marcos en los que no pudo entrar, y `truncated: true` significa que se alcanzó el límite de nodos
(2000) o el de nombres (200 caracteres).

### `screenshot`

Argumentos: `tabId?`. Devuelve un **bloque de contenido de imagen** (JPEG en base64, con calidad
acotada) del renderizado actual de la pestaña, más una línea de texto que nombra la página — un canal
visual hacia la disposición y el estado renderizado que la instantánea ARIA no puede describir. Se
captura de forma nativa (`takeSnapshot`) y no lee ningún DOM ni JavaScript de la página. Clase Leer:
autorizada exactamente como `read` (permitida en una pestaña propiedad de la IA; una pestaña humana
necesita una vinculación, que se consume al capturar).
Una pestaña que no es la página visible puede renderizarse en blanco — `open` y `navigate` traen una pestaña
al frente.

### `query`

Argumentos: `tabId?`, `selector` (CSS), y `fields: {attributes, box, styles:[...]}` opcional. Devuelve
`{count, elements: [{ref, tag, text, …}], truncated?}` — datos estructurados del DOM que la instantánea ARIA no
puede nombrar (tablas, valores calculados) —, con un máximo de 50 elementos y 500
caracteres de texto cada uno (`truncated: true` cuando el selector coincidió con más). **Clase Leer.** Se ejecuta en el mundo de contenido aislado.

### `extract`

Argumentos: `tabId?`. Devuelve `{title, byline, url, markdown, textLength, truncated}` — la página como
**Markdown en modo lectura**, para páginas que la IA quiere *leer* en lugar de operar. Una captura
acotada exporta el HTML de la página; la extracción en sí se ejecuta en VMark, nunca en la página: un
**complemento de sitio** registrado para el origen tiene la primera opción (el complemento integrado de
Wikipedia elimina la interfaz de wiki — infoboxes, navboxes, hatnotes, enlaces de edición — por nombre),
y un lector genérico basado en heurística de densidad es la alternativa para cualquier otro sitio.
`truncated: true` significa que la página superó el límite de captura y la parte final quedó sin leer.
**Clase Leer.** Todo lo que se devuelve deriva de la página y es no confiable.

### `workflow_status`

Argumentos: `tabId?`, `runId` (de `workflow_run`). Devuelve `{status, completedSteps,
skippedSteps, stepCount, firstStep, pausedAt?, pendingApproval?, reasonCode?, reason?,
resumedFrom?, stepResults}` donde `status` es uno de `running` / `paused` / `completed` /
`failed` / `cancelled` / `superseded`, `stepResults` contiene una entrada por paso
(`{index, status, attempts, reason?, data?}`) y `pendingApproval` está presente mientras la
ejecución espera tu decisión. Un estado `paused` nombra el paso que te necesita en
`pausedAt`. **Clase Leer** — sondéalo libremente.

### `console`

Argumentos: `tabId?`. Devuelve `{entries: [{level, text}], url}` — la salida `console.*` capturada de
la página, más los **errores no capturados y los rechazos de promesa no gestionados** (registrados como
entradas `level: "error"` con el prefijo `Uncaught` / `Unhandled rejection:` — la señal que el parcheo
de `console.*` por sí solo nunca ve). Solo pestañas propiedad de la IA (tanto en postura Sandbox como
Compartida; una pestaña humana no lleva shim de captura), solo el marco principal. La captura funciona mediante un shim del
mundo de la página que escribe en un búfer del DOM oculto que el driver lee desde el mundo aislado — así
que **no se abre ningún canal de mensajería** de vuelta hacia VMark (se mantiene la garantía de ausencia
de puente). La salida está controlada por la página y es **no confiable** — trátala como un `read`,
nunca como objetivo de un `act`.

El búfer es un anillo acotado, así que las lecturas consecutivas se solapan. Para vaciarlo a medida que
lees, usa el `console_clear` de [`browser`](#browser) — el vaciado escribe `[]` en el elemento búfer de
la página, que es una escritura en el DOM y por tanto no puede vivir bajo `readOnlyHint: true`.

### `wait`

Argumentos: `tabId?`, `navigationId` opcional (omítelo para el ticket más reciente de la pestaña) y
`timeoutMs` opcional (1–9000 ms). Nunca inicia una navegación, nunca cambia el foco ni
la pestaña activa y nunca crea una vista — solo observa, que es lo que le permite vivir
en la herramienta de solo lectura. Solo pestañas propiedad de la IA. Devuelve un resultado de carga/fallo almacenado en búfer,
`NAVIGATION_SUPERSEDED`, o `TIMEOUT` cuando el ticket no termina dentro del límite.

### `wait_for`

Argumentos: `tabId?`, exactamente uno de `ref` (de una lectura), `role` (+ `name` opcional), `text` (una
subcadena del texto visible), o `urlContains` (una subcadena que la URL de la pestaña debe contener —
confirma que una navegación provocada por un clic llegó a su destino, respondida desde el estado de la
pestaña sin ida y vuelta a la página), y `timeoutMs` opcional (1–9000 ms). Sondea hasta que la
condición se cumple o transcurre el tiempo de espera y devuelve `{matched: true|false}` (más la `ref`
del elemento coincidente para una condición ref/role) — de modo que puedes distinguir «encontrado» de
«se agotó el tiempo». Clase Leer. Úsalo para hacer un flujo determinista: actúa, espera el resultado con
`wait_for`, luego lee.

De lo que puede ver se derivan dos reglas. `urlContains` compara con la URL **ocultada** — la
cadena de consulta y el fragmento se eliminan, porque un token que una redirección haya dejado ahí no debe
poder sondearse —, así que una aguja que contenga `?` o `#` se rechaza de entrada. Y en una pestaña humana
vinculada con **Permitir una vez** se rechaza (`ATTACHMENT_ONCE_INSUFFICIENT`): sondear son muchas
lecturas, y una vinculación de una sola lectura no puede cubrirlo — pide **Permitir hasta la navegación**.

---

## `coherence`

Una vista de **solo lectura** de la capa de coherencia del espacio de trabajo — qué documentos derivados están obsoletos respecto a las fuentes a partir de las cuales se generaron. Ninguna acción modifica documentos ni el estado del editor. `status` es de solo lectura; `edges` reconcilia primero y puede añadir registros de procedencia al registro (ledger) del espacio de trabajo, pero nunca cambia el contenido de los documentos. Todas se responden por completo desde el backend en Rust a partir del kernel por espacio de trabajo, por lo que funcionan incluso cuando ninguna ventana del editor está en primer plano.

Dos acciones más de solo lectura exponen la capa semántica:

- `claims` — las afirmaciones canónicas actuales: `{claim, entryId, statement, maturity, invalidAt, visible}`. Solo las afirmaciones `established` restringen las verificaciones semánticas; `visible` refleja el contexto default.
- `contexts` — el conjunto de contextos (el `default` implícito siempre está presente): `{id, name, parent, enforcement, visibleClaims, errors}`.

Anotada como `readOnlyHint: true`. La única acción mutante, `resolve`, vive en su propia herramienta — consulta [`coherence_resolve`](#coherence-resolve) — que es lo que permite que esta sea aprobable automáticamente. La mutación de afirmaciones y contextos nunca se expone en absoluto: el canon permanece bajo control humano.

Todas las acciones requieren `workspace_root`: la ruta absoluta del espacio de trabajo a consultar. Obtenla de `session.get_state` (el `filePath` de las pestañas abiertas) o de la herramienta workspace. Una ruta ausente, no absoluta o que no sea un directorio se rechaza con un error de cadena simple.

### `status`

Contadores de estado del kernel para un espacio de trabajo.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `workspace_root` | string | Sí | Ruta absoluta del espacio de trabajo a consultar |

**Devuelve:**

```json
{
  "initialized": true,
  "objects": 12,
  "open_items": 2,
  "quarantined": 0,
  "writer": "0198c0de-0000-7000-8000-000000000001"
}
```

| Campo | Significado |
|---|---|
| `initialized` | `false` cuando el espacio de trabajo aún no tiene un registro de coherencia (sin directorio `.vmark/`). En ese caso, todos los contadores excepto `objects` son 0. |
| `objects` | Objetos rastreados (archivos con identidad de coherencia). |
| `open_items` | Aristas vivas no frescas — el tamaño actual del desglose. |
| `quarantined` | Líneas mal formadas del registro puestas en cuarentena en la última lectura. |
| `writer` | El ID de escritor (UUID) de esta instalación. |

### `edges`

El desglose: cada arista de dependencia viva cuya fuente se ha movido. Ejecuta primero una reconciliación con escaneo, de modo que la respuesta refleja los archivos en disco en el momento de la llamada.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `workspace_root` | string | Sí | Ruta absoluta del espacio de trabajo a consultar |

**Devuelve** un array — vacío cuando todo es coherente:

```json
[
  {
    "txf": "0198c0de-0000-7000-8000-00000000000a",
    "input": 0,
    "upstream": "0198c0de-0000-7000-8000-00000000000b",
    "upstream_path": "characters/elena.md",
    "pinned": "rev-a1b2c3",
    "downstream": "0198c0de-0000-7000-8000-00000000000c",
    "downstream_path": "scenes/chapter-3.md",
    "downstream_rev": "rev-d4e5f6",
    "state": "version-stale"
  }
]
```

| Campo | Significado |
|---|---|
| `txf` / `input` | La entrada de transformación y la ranura de entrada que identifican esta arista (pásalas a las acciones de resolución dentro de la aplicación). |
| `upstream` / `upstream_path` | El objeto del que depende el derivado, y su última ruta conocida. |
| `pinned` | La revisión de la fuente a partir de la cual se generó el derivado. |
| `downstream` / `downstream_path` / `downstream_rev` | El objeto derivado, su ruta y su revisión actual. |
| `state` | `"version-stale"`, `"stale-valid"`, `"stale-contradicted"`, `"stale-unknown"`, `"waived"`, `"diverged"`, `"diverged-multi-head"` o `"unpinnable"`. |

Resolver una arista (accept-newer / waive) es normalmente una acción humana que se realiza en el panel Desglose de coherencia de VMark. Una IA solo puede hacerlo a través de [`coherence_resolve`](#coherence-resolve), y solo cuando el propietario del espacio de trabajo se lo ha delegado explícitamente.

---

## `coherence_resolve`

La **única acción mutante** de la capa de coherencia, en su propia herramienta para que
[`coherence`](#coherence) pueda seguir siendo aprobable automáticamente — y para que algo que no se
puede deshacer resulte visible en la lista de herramientas en lugar de quedar enterrado como un valor de
enum entre cinco. Anotada como `readOnlyHint: false, destructiveHint: true`.

### `resolve`

Argumentos: `{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`.
`txf` e `input` provienen de una fila de `coherence` → `edges`.

Resuelve una arista obsoleta activa como agente explícitamente delegado. La autorización es de tipo
**fail-closed**: el propietario del espacio de trabajo debe haber otorgado a **tu identidad de puente
autenticada** una delegación activa y no caducada que cubra el tipo de resolución (otorgada en la app,
desde el panel Desglose de coherencia), y la arista debe seguir activa. Cada resolución delegada se registra en el log de
auditoría vinculada al otorgamiento, y la entrada no se puede deshacer. `coherence_resolve` no puede fijar una caducidad,
así que la exención de una IA nunca vence por sí sola.

Un rechazo significa que el otorgamiento falta o ha caducado — pide al usuario que lo conceda en lugar
de reintentar. Separar esto de `coherence` no cambió ninguna propiedad de seguridad: la autorización
siempre se ha basado en el principal de puente autenticado, nunca en nada que afirme el cliente.

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
| `STALE` | sobre | `expected_revision` no coincidió; vuelve a leer y reintenta. O `save` / `save_as`: un guardado hecho después de este ya llegó a ese archivo, así que este no escribió nada — lee antes de volver a escribir |
| `INVALID_PATCH` | sobre | `workflow.apply_patch` recibió un array `patches` mal formado |
| `INVALID_TAB` | sobre | No se pudo resolver `tabId` |
| `INVALID_PATH` | sobre | No se pudo leer un `filePath`, o está fuera del alcance del espacio de trabajo abierto / del documento |
| `APPROVAL_REQUIRED` | sobre | `save_as` a una ubicación nueva mientras **Aprobar automáticamente guardados en una ubicación nueva y resultados de genios** está desactivado; `save_as` a una ruta que ya contiene un archivo distinto del de la pestaña; o `open_workspace` espera la aprobación del usuario, o que elija la carpeta en el diálogo de carpetas de VMark |
| `BUSY` | sobre | `open_workspace` no pudo continuar: hay otro diálogo de carpetas abierto o un cambio de espacio de trabajo en curso en esa ventana; la aprobación se conserva — reintenta. O bien `document.write`, `document.transform` o `selection.set` llegó mientras el usuario componía texto con un método de entrada; no se cambió nada — reintenta en breve |
| `JOURNAL_BUSY` | sobre | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch` llegó mientras se registraba otra escritura en el mismo documento; no se cambió nada — reintenta en breve |
| `WRITE_BUSY` | cadena | Una llamada de escritura (`document.write` / `document.transform`, `selection.set`, `workflow.apply_patch`, `comments.reply` / `mark_addressed`, `coherence_resolve`, …) esperó 3 s detrás de otra escritura sin que le llegara el turno; no se aplicó — reintenta |
| `TIMEOUT` | cadena | Una llamada a `coherence` o `coherence_resolve` no terminó en 20 s. Si es una escritura (`edges`, `resolve`), sigue en curso y su resultado es desconocido — lee el estado actual antes de reintentar |
| `STALE_PARENT` | sobre | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: otra ventana escribió el documento después de la última escritura de esta pestaña; no se cambió nada — vuelve a leer y reintenta |
| `JOURNAL_DEGRADED` | sobre | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: un registro anterior del diario para este documento aún espera guardarse; no se cambió nada — reintenta en unos segundos |
| `JOURNAL_UNAVAILABLE` | sobre | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: el diario de ediciones de agentes no está en marcha o no puede registrar; no se cambió nada |
| `INVALID_TEXT` | sobre | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: `content` contiene un sustituto UTF-16 suelto; no se cambió nada |
| `REVIEW_BACKLOG_FULL` | sobre | `document.write`: el documento tiene demasiados cambios de IA sin revisar; no se cambió nada |
| `ABORTED` | sobre | `document.write` / `document.transform` / `selection.set` / `workflow.apply_patch`: el usuario editó, cerró, compuso texto en el documento o movió su selección mientras se registraba la escritura; `reason` indica cuál; no se cambió nada — vuelve a leer y reintenta |
| `NOT_WORKFLOW` | sobre | Se invocó `workflow.*` en una pestaña que no es YAML de flujo de trabajo |
| `READ_ONLY` | sobre | Se intentó una mutación en un documento de solo lectura |
| `NO_EDITOR` | sobre | Se invocó `selection.*` pero la pestaña enfocada no tiene un editor activo |
| `INTERNAL` | sobre | Error inesperado del manejador |
| (cadena simple) | cadena | Argumento requerido ausente o de tipo incorrecto |
