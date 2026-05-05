# Genios de IA

Los Genios de IA son plantillas de prompts que transforman tu texto usando IA. Selecciona texto, invoca un genio y revisa los cambios sugeridos — todo sin salir del editor.

## Inicio Rápido

1. Configura un proveedor de IA en **Configuración > Integraciones** (ver [Proveedores de IA](/es/guide/ai-providers))
2. Selecciona algo de texto en el editor
3. Pulsa `Mod + Y` para abrir el selector de genios
4. Elige un genio o escribe un prompt de forma libre
5. Revisa la sugerencia en línea — acepta o rechaza

## El Selector de Genios

Pulsa `Mod + Y` (o menú **Herramientas > Genios de IA**) para abrir un overlay estilo Spotlight con una sola entrada unificada.

**Búsqueda y forma libre** — Empieza a escribir para filtrar genios por nombre, descripción o categoría. Si no hay genios coincidentes, la entrada se convierte en un campo de prompt de forma libre.

**Fichas Rápidas** — Cuando el alcance es "selección" y la entrada está vacía, aparecen botones de un clic para acciones comunes (Pulir, Condensar, Gramática, Reformular).

**Forma libre en dos pasos** — Cuando no hay genios coincidentes, pulsa `Enter` una vez para ver una pista de confirmación, luego `Enter` de nuevo para enviar como prompt de IA. Esto evita envíos accidentales.

**Cambio de alcance** — Pulsa `Tab` para cambiar entre alcances: selección → bloque → documento → todo.

**Historial de prompts** — En modo de forma libre (sin genios coincidentes), pulsa `ArrowUp` / `ArrowDown` para recorrer prompts anteriores. Pulsa `Ctrl + R` para abrir un menú desplegable de historial con búsqueda. El texto fantasma muestra el prompt coincidente más reciente como pista en gris — pulsa `Tab` para aceptarlo.

### Retroalimentación de Procesamiento

Después de seleccionar un genio o enviar un prompt de forma libre, el selector muestra retroalimentación en línea:

- **Procesando** — Un indicador de pensamiento con contador de tiempo transcurrido. Pulsa `Escape` para cancelar.
- **Vista previa** — La respuesta de IA se transmite en tiempo real. Usa `Aceptar` para aplicar o `Rechazar` para descartar.
- **Error** — Si algo sale mal, aparece el mensaje de error con un botón `Reintentar`.

La barra de estado también muestra el progreso de IA — un icono giratorio con tiempo transcurrido mientras se ejecuta, un breve destello de "Listo" al terminar, o un indicador de error con botones Reintentar/Descartar. La barra de estado se muestra automáticamente cuando la IA tiene estado activo, incluso si la ocultaste previamente con `F7`.

## Genios Integrados

VMark viene con 13 genios en cuatro categorías:

### Edición

| Genio | Descripción | Alcance |
|-------|-------------|---------|
| Pulir | Mejorar claridad y fluidez | Selección |
| Condensar | Hacer el texto más conciso | Selección |
| Corregir Gramática | Corregir gramática y ortografía | Selección |
| Simplificar | Usar lenguaje más simple | Selección |

### Creativo

| Genio | Descripción | Alcance |
|-------|-------------|---------|
| Expandir | Desarrollar idea en prosa más completa | Selección |
| Reformular | Decir lo mismo de diferente manera | Selección |
| Vívido | Añadir detalles sensoriales e imágenes | Selección |
| Continuar | Continuar escribiendo desde aquí | Bloque |

### Estructura

| Genio | Descripción | Alcance |
|-------|-------------|---------|
| Resumir | Resumir el documento | Documento |
| Esquema | Generar un esquema | Documento |
| Titular | Sugerir opciones de título | Documento |

### Herramientas

| Genio | Descripción | Alcance |
|-------|-------------|---------|
| Traducir | Traducir al inglés | Selección |
| Reescribir en Inglés | Reescribir texto en inglés | Selección |

## Alcance

Cada genio opera en uno de tres alcances:

- **Selección** — El texto resaltado. Si no hay nada seleccionado, recurre al bloque actual.
- **Bloque** — El párrafo o elemento de bloque en la posición del cursor.
- **Documento** — El contenido completo del documento.

El alcance determina qué texto se extrae y se pasa a la IA como `{{content}}`.

::: tip
Si el alcance es **Selección** pero no hay nada seleccionado, el genio opera en el párrafo actual.
:::

## Revisión de Sugerencias

Después de que un genio se ejecuta, la sugerencia aparece en línea:

- **Reemplazar** — Texto original con tachado, nuevo texto en verde
- **Insertar** — Nuevo texto mostrado en verde después del bloque de origen
- **Eliminar** — Texto original con tachado

Cada sugerencia tiene botones de aceptar (marca de verificación) y rechazar (X).

### Atajos de Teclado

| Acción | Atajo |
|--------|-------|
| Aceptar sugerencia | `Enter` |
| Rechazar sugerencia | `Escape` |
| Siguiente sugerencia | `Tab` |
| Sugerencia anterior | `Shift + Tab` |
| Aceptar todas | `Mod + Shift + Enter` |
| Rechazar todas | `Mod + Shift + Escape` |

## Indicador de Barra de Estado

Mientras la IA genera, la barra de estado muestra un icono de destello giratorio con un contador de tiempo transcurrido ("Pensando... 3s"). Un botón de cancelar (×) permite detener la solicitud.

Al completarse, aparece brevemente una marca de verificación "Listo" durante 3 segundos. Si ocurre un error, la barra de estado muestra el mensaje de error con botones Reintentar y Descartar.

La barra de estado se muestra automáticamente cuando la IA tiene estado activo (ejecutándose, error o éxito), incluso si la ocultaste con `F7`.

---

## Escribir Genios Personalizados

Puedes crear tus propios genios. Cada genio es un único archivo Markdown con frontmatter YAML y una plantilla de prompt.

### Dónde Viven los Genios

Los genios se almacenan en el directorio de datos de la aplicación:

| Plataforma | Ruta |
|------------|------|
| macOS | `~/Library/Application Support/app.vmark/genies/` |
| Windows | `%APPDATA%\app.vmark\genies\` |
| Linux | `~/.local/share/app.vmark/genies/` |

Abre esta carpeta desde el menú **Herramientas > Abrir Carpeta de Genios**.

### Estructura de Directorios

Los subdirectorios se convierten en **categorías** en el selector. Puedes organizar los genios como desees:

```
genies/
├── editing/
│   ├── polish.md
│   ├── condense.md
│   └── fix-grammar.md
├── creative/
│   ├── expand.md
│   └── rephrase.md
├── academic/          ← tu categoría personalizada
│   ├── cite.md
│   └── abstract.md
└── my-workflows/      ← otra categoría personalizada
    └── blog-intro.md
```

### Formato de Archivo

Cada archivo de genio tiene dos partes: **frontmatter** (metadatos) y **plantilla** (el prompt).

```markdown
---
description: Mejorar claridad y fluidez
scope: selection
category: editing
---

Eres un editor experto. Mejora la claridad, fluidez y concisión
del siguiente texto preservando la voz e intención del autor.

Devuelve solo el texto mejorado — sin explicaciones.

{{content}}
```

El nombre de archivo `polish.md` se convierte en el nombre de visualización "Polish" en el selector.

### Campos del Frontmatter

| Campo | Requerido | Valores | Predeterminado |
|-------|-----------|---------|----------------|
| `description` | No | Descripción breve mostrada en el selector | Vacío |
| `scope` | No | `selection`, `block`, `document` | `selection` |
| `category` | No | Nombre de categoría para agrupación | Nombre del subdirectorio |
| `action` | No | `replace`, `insert` | `replace` |
| `context` | No | `1`, `2` | `0` (ninguno) |
| `model` | No | Identificador de modelo para anular el predeterminado del proveedor | Predeterminado del proveedor |

**Nombre del genio** — El nombre de visualización siempre se deriva del **nombre de archivo** (sin `.md`). Por ejemplo, `fix-grammar.md` aparece como "Fix Grammar" en el selector. Renombra el archivo para cambiar el nombre de visualización.

### El Marcador de Posición `{{content}}`

El marcador de posición `{{content}}` es el núcleo de cada genio. Cuando se ejecuta un genio, VMark:

1. **Extrae el texto** basándose en el alcance (texto seleccionado, bloque actual o documento completo)
2. **Reemplaza** cada `{{content}}` en tu plantilla con el texto extraído
3. **Envía** el prompt completado al proveedor de IA activo
4. **Transmite** la respuesta de vuelta como una sugerencia en línea

Por ejemplo, con esta plantilla:

```markdown
Traduce el siguiente texto al francés.

{{content}}
```

Si el usuario selecciona "Hello, how are you?", la IA recibe:

```
Traduce el siguiente texto al francés.

Hello, how are you?
```

La IA responde con "Bonjour, comment allez-vous ?" y aparece como una sugerencia en línea reemplazando el texto seleccionado.

### El Marcador de Posición `{{context}}`

El marcador de posición `{{context}}` le da a la IA texto circundante de solo lectura — para que pueda coincidir con el tono, estilo y estructura de los bloques cercanos sin modificarlos.

**Cómo funciona:**

1. Establece `context: 1` o `context: 2` en el frontmatter para incluir ±1 o ±2 bloques vecinos
2. Usa `{{context}}` en tu plantilla donde quieras que se inyecte el texto circundante
3. La IA ve el contexto pero la sugerencia solo reemplaza `{{content}}`

**Los bloques compuestos son atómicos** — si un vecino es una lista, tabla, cita o bloque de detalles, toda la estructura cuenta como un bloque.

**Restricciones de alcance** — El contexto solo funciona con alcance `selection` y `block`. Para el alcance `document`, el contenido ya ES el documento completo.

**Prompts de forma libre** — Cuando escribes una instrucción de forma libre en el selector, VMark automáticamente incluye ±1 bloque circundante como contexto para los alcances `selection` y `block`. No se necesita configuración.

**Compatible con versiones anteriores** — Los genios sin `{{context}}` funcionan exactamente como antes. Si la plantilla no contiene `{{context}}`, no se extrae texto circundante.

**Ejemplo — lo que recibe la IA:**

Con `context: 1` y el cursor en el segundo párrafo de un documento de tres párrafos:

```
[Antes]
Contenido del primer párrafo aquí.

[Después]
Contenido del tercer párrafo aquí.
```

Las secciones `[Antes]` y `[Después]` se omiten cuando no hay vecinos en esa dirección (ej., el contenido está al principio o al final del documento).

### El Campo `action`

Por defecto, los genios **reemplazan** el texto de origen con el resultado de la IA. Establece `action: insert` para **añadir** el resultado después del bloque de origen en su lugar.

Usa `replace` para: edición, reformulación, traducción, corrección de gramática — cualquier cosa que transforme el texto original.

Usa `insert` para: continuar escribiendo, generar resúmenes debajo del contenido, añadir comentarios — cualquier cosa que añada nuevo texto sin eliminar el original.

**Ejemplo — acción de inserción:**

```markdown
---
description: Continuar escribiendo desde aquí
scope: block
action: insert
---

Continúa escribiendo naturalmente desde donde termina el siguiente texto.
Mantén la voz, estilo y tono del autor. Escribe 2-3 párrafos.

No repitas ni resumas el texto existente — simplemente continúalo.

{{content}}
```

### El Campo `model`

Anula el modelo predeterminado para un genio específico. Útil cuando quieres un modelo más económico para tareas simples o uno más potente para tareas complejas.

```markdown
---
description: Corrección rápida de gramática (usa modelo rápido)
scope: selection
model: claude-haiku-4-5-20251001
---

Corrige errores de gramática y ortografía. Devuelve solo el texto corregido.

{{content}}
```

El identificador del modelo debe coincidir con lo que acepta tu proveedor activo.

## Escribir Prompts Efectivos

### Sé Específico sobre el Formato de Salida

Dile a la IA exactamente qué devolver. Sin esto, los modelos tienden a añadir explicaciones, encabezados o comentarios.

```markdown
<!-- Bien -->
Devuelve solo el texto mejorado — sin explicaciones.

<!-- Mal — la IA puede envolver la salida en comillas, añadir "Aquí está la versión mejorada:", etc. -->
Mejora este texto.
```

### Establece un Rol

Dale a la IA un personaje para anclar su comportamiento.

```markdown
<!-- Bien -->
Eres un editor técnico experto que se especializa en documentación de APIs.

<!-- Correcto pero menos enfocado -->
Edita el siguiente texto.
```

### Limita el Alcance

Dile a la IA qué NO cambiar. Esto evita la sobre-edición.

```markdown
<!-- Bien -->
Corrige solo errores de gramática y ortografía.
No cambies el significado, estilo o tono.
No reestructures las oraciones.

<!-- Mal — da demasiada libertad a la IA -->
Corrige este texto.
```

### Usa Markdown en los Prompts

Puedes usar formato Markdown en tus plantillas de prompt. Esto ayuda cuando quieres que la IA produzca salida estructurada.

```markdown
---
description: Generar un análisis de pros/contras
scope: selection
action: insert
---

Analiza el siguiente texto y produce una breve lista de pros/contras.

Formato:

**Pros:**
- punto 1
- punto 2

**Contras:**
- punto 1
- punto 2

{{content}}
```

### Mantén los Prompts Enfocados

Un genio, un trabajo. No combines múltiples tareas en un solo genio — crea genios separados en su lugar.

```markdown
<!-- Bien — un trabajo claro -->
---
description: Convertir a voz activa
scope: selection
---

Reescribe el siguiente texto usando voz activa.
No cambies el significado.
Devuelve solo el texto reescrito.

{{content}}
```

## Ejemplos de Genios Personalizados

### Académico — Escribir un Resumen

```markdown
---
description: Generar un resumen académico
scope: document
action: insert
---

Lee el siguiente artículo y escribe un resumen académico conciso
(150-250 palabras). Sigue la estructura estándar: antecedentes, métodos,
resultados, conclusión.

{{content}}
```

### Blog — Generar un Gancho

```markdown
---
description: Escribir un párrafo de apertura atractivo
scope: document
action: insert
---

Lee el siguiente borrador y escribe un párrafo de apertura convincente
que enganche al lector. Usa una pregunta, hecho sorprendente o escena vívida.
Mantenlo en menos de 3 oraciones.

{{content}}
```

### Código — Explicar Bloque de Código

```markdown
---
description: Añadir una explicación en lenguaje sencillo sobre el código
scope: selection
action: insert
---

Lee el siguiente código y escribe una breve explicación en lenguaje sencillo
de lo que hace. Usa 1-2 oraciones. No incluyas el código en sí
en tu respuesta.

{{content}}
```

### Email — Hacer Profesional

```markdown
---
description: Reescribir en tono profesional
scope: selection
---

Reescribe el siguiente texto con un tono profesional y apropiado para negocios.
Mantén el mismo significado y puntos clave. Elimina el lenguaje informal,
argot y palabras de relleno.

Devuelve solo el texto reescrito — sin explicaciones.

{{content}}
```

### Traducción — Al Español

```markdown
---
description: Traducir al español
scope: selection
---

Traduce el siguiente texto al español neutro.
Preserva el significado, tono y formato originales.
Usa un español natural e idiomático — no una traducción literal.

Devuelve solo el texto traducido — sin explicaciones.

{{content}}
```

### Consciente del Contexto — Ajustar al Entorno

```markdown
---
description: Reescribir para que encaje con el tono y estilo circundantes
scope: selection
context: 1
---

Reescribe el siguiente contenido para que encaje naturalmente con su contexto circundante.
Coincide con el tono, estilo y nivel de detalle.

Devuelve solo el texto reescrito — sin explicaciones.

## Contexto circundante (no incluir en la salida):
{{context}}

## Contenido a reescribir:
{{content}}
```

### Revisión — Verificación de Hechos

```markdown
---
description: Señalar afirmaciones que necesitan verificación
scope: selection
action: insert
---

Lee el siguiente texto y enumera cualquier afirmación factual que deba ser
verificada. Para cada afirmación, señala por qué podría necesitar comprobación (ej.,
números específicos, fechas, estadísticas o afirmaciones categóricas).

Formatea como una lista con viñetas. Si todo parece sólido, di
"No se señalaron afirmaciones para verificación."

{{content}}
```

## Sugerencias de IA

Cuando un Genio devuelve texto destinado a reemplazar la selección (en lugar de una respuesta de chat de forma libre), VMark lo presenta como una **sugerencia** con un diff en línea: tachado rojo para el texto original, subrayado verde para el texto propuesto. Tú revisas y apruebas antes de que cualquier cambio se persista.

| Acción | Atajo |
|---|---|
| Aceptar la sugerencia enfocada | `Tab` |
| Rechazar la sugerencia enfocada | `Esc` |
| Aceptar todas las sugerencias del documento | `Mod + Shift + Enter` _(sensible al contexto — también Añadir Fila Arriba cuando se está dentro de una tabla)_ |
| Pasar a la siguiente sugerencia | `Tab` desde una posición no enfocada |

Cuando un Genio reescribe varios párrafos, cada reemplazo es una sugerencia navegable de forma independiente. Aceptar una no acepta automáticamente las demás.

La interfaz de sugerencias también tiene una superficie MCP — los agentes de IA externos conectados a través del [servidor MCP](/es/guide/mcp-tools) pueden emitir las acciones `suggestion.accept` / `suggestion.reject` para manipular el mismo estado.

## Limitaciones

- Los genios solo funcionan en **modo WYSIWYG**. En modo fuente, una notificación toast lo explica.
- Solo se puede ejecutar un genio a la vez. Si la IA ya está generando, el selector no iniciará otro.
- El marcador de posición `{{content}}` se reemplaza literalmente — no soporta condicionales ni bucles.
- Los documentos muy grandes pueden alcanzar los límites de tokens del proveedor cuando se usa `scope: document`.

## Solución de Problemas

**"No hay proveedor de IA disponible"** — Abre Configuración > Integraciones y configura un proveedor. Ver [Proveedores de IA](/es/guide/ai-providers).

**El genio no aparece en el selector** — Verifica que el archivo tenga extensión `.md`, frontmatter válido con delimitadores `---`, y esté en el directorio de genios (no en un subdirectorio de más de un nivel de profundidad).

**La IA devuelve basura o errores** — Verifica que tu clave API sea correcta y que el nombre del modelo sea válido para tu proveedor. Consulta el terminal/consola para detalles de error.

**La sugerencia no cumple las expectativas** — Refina tu prompt. Añade restricciones ("devuelve solo el texto", "no expliques"), establece un rol o reduce el alcance.

## Ver También

- [Proveedores de IA](/es/guide/ai-providers) — Configura proveedores CLI o API REST
- [Atajos de Teclado](/es/guide/shortcuts) — Referencia completa de atajos
- [Herramientas MCP](/es/guide/mcp-tools) — Integración de IA externa mediante MCP
