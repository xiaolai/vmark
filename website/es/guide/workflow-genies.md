<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# Genies de Flujo de Trabajo

Los Genies de VMark vienen en dos variantes:

- **Genies Markdown** (`.md`) — plantillas de prompt de un solo disparo. El formato Genie original. Consulta [AI Genies](/es/guide/ai-genies).
- **Genies de flujo de trabajo** (`.yml` / `.yaml`) — pipelines de varios pasos que encadenan genies markdown con un flujo de datos explícito.

Ambos formatos viven en el mismo directorio global de genies y aparecen en el mismo selector (`Cmd+Y`). Un genie de flujo de trabajo se muestra como una fila Genie normal; al seleccionarlo se inicia el ejecutor de flujos en lugar de la llamada de IA de un solo disparo.

## Cuándo usar cada uno

| Necesidad | Formato |
|-----------|---------|
| Transformación única (reescribir, traducir, resumir) | Markdown |
| Pipeline esquema → borrador → pulido | Flujo de trabajo |
| Diferentes modelos de IA para distintas etapas | Flujo de trabajo |
| Pasos que requieren puertas de aprobación | Flujo de trabajo |
| La salida de una etapa alimenta la siguiente | Flujo de trabajo |

Si encaja un solo prompt, usa un genie markdown. Si necesitas componer etapas, flujo de datos estructurado o aprobación con humano en el bucle, usa un flujo de trabajo.

## Formato del archivo

Un genie de flujo de trabajo es un archivo YAML. Campos de nivel superior:

| Campo | Requerido | Propósito |
|-------|-----------|-----------|
| `name` | Sí | Etiqueta legible. El selector usa el **nombre del archivo** como nombre visible; este campo aparece como descripción si no se define `description:`. |
| `description` | No | Resumen de una línea mostrado en el selector. |
| `defaults` | No | Modelo / aprobación / límites por defecto aplicados a cada paso. |
| `env` | No | Variables de entorno disponibles como `${VAR}` o `${{ env.NAME }}`. |
| `steps` | Sí | Lista ordenada de pasos. |

### Forma del paso

```yaml
- id: my-step
  uses: genie/<name>     # or action/<name>
  with:
    input: "text or expression"
  needs: prior-step      # optional; can also be a list
  approval: ask          # optional; "auto" (default) or "ask"
  model: claude-sonnet   # optional; overrides defaults
  limits:
    timeout: 120s        # default 300s
    max_tokens: 4096     # REST providers only
```

### Tipos de paso

| Prefijo `uses:` | Comportamiento |
|-----------------|----------------|
| `genie/<name>` | Carga el genie markdown correspondiente, rellena su plantilla con el mapa `with:` del paso y llama al proveedor de IA activo. Los marcadores `{{content}}` / `{{input}}` del genie markdown recogen `with.input` automáticamente. |
| `action/read-file` | Lee una ruta relativa al espacio de trabajo. La salida es el cuerpo del archivo. |
| `action/save-file` | Escribe `with.input` en `with.path`. |
| `action/notify` | Registra `with.message`. |
| `action/copy` | Devuelve `with.input` sin cambios (útil para encadenar). |

### Expresiones

Dentro de cualquier valor `with:`:

| Sintaxis | Resuelve a |
|----------|------------|
| `${{ steps.ID.outputs.FIELD }}` | Un campo de salida específico de un paso anterior. |
| `${{ steps.ID.output }}` | Atajo para `outputs.text` de un paso anterior. |
| `${{ env.NAME }}` | Un valor `env:` del flujo de trabajo. |
| `${VAR}` | Lo mismo que arriba, forma heredada. |
| `stepId.output` (toda la cadena) | Alias heredado para `${{ steps.stepId.output }}`. |

Las referencias a pasos / campos desconocidos hacen fallar el paso en el momento de la resolución de parámetros, antes de cualquier llamada de IA.

### Vinculación de plantilla

Cuando se ejecuta un paso `genie/<name>`, la plantilla de prompt de su genie markdown se rellena según estas reglas:

- `{{input}}` → `with.input`
- `{{content}}` → `with.content` si está presente, si no `with.input` (fatal si no hay ninguno)
- `{{context}}` → `with.context` si está presente, si no cadena vacía (nunca fatal)
- `{{any-other-key}}` → `with.<key>` (fatal si falta)

Esto significa que **los genies markdown existentes funcionan sin cambios** dentro de los flujos de trabajo — invócalos con `with: { input: "..." }` y el marcador `{{content}}` lo recogerá mediante la cadena de alias.

### Puerta de aprobación

Cuando un paso tiene `approval: ask` (o `defaults.approval: ask` del flujo de trabajo), el ejecutor pausa, abre un diálogo que muestra la vista previa del prompt resuelto y el modelo, y espera el veredicto del usuario antes de llamar al proveedor. Esc deniega. El tiempo de espera es el menor entre el `limits.timeout` del paso y 10 minutos.

## Ejemplo

VMark incluye un flujo de trabajo de muestra en `outline-and-polish.yml` dentro de los genies empaquetados. Cópialo en tu directorio de genies de usuario para personalizarlo:

```yaml
name: Outline and Polish
description: Generate an outline, then polish the output for clarity.

defaults:
  approval: auto

steps:
  - id: outline
    uses: genie/outline
    with:
      input: "Replace this seed with your topic."

  - id: polish
    uses: genie/polish
    needs: outline
    with:
      input: ${{ steps.outline.outputs.text }}
```

`genie/outline` produce un esquema estructurado; el paso `polish` reescribe esa salida para mayor claridad. Las dos referencias `genie/*` se resuelven a los genies markdown empaquetados en `structure/outline.md` y `editing/polish.md`.

## Cancelación, tiempos de espera, límites

- **Cancelar** — Haz clic en Detener en el panel lateral del flujo de trabajo. El ejecutor mata cualquier proceso hijo de proveedor CLI en curso en un tick y descarta las solicitudes REST pendientes.
- **Tiempo de espera por paso** — Envuelto en `tokio::time::timeout(step.limits.timeout)`. Al transcurrir, el paso falla con "Timed out after Xs" y los pasos posteriores se omiten.
- **Tope de salida** — La salida de un solo paso está limitada a 5 MB. Un proveedor descontrolado dispara cancelación + "Provider output exceeded 5 MB cap".

## Véase también

- [AI Genies](/es/guide/ai-genies) — formato y autoría de genies markdown.
- [Visor de flujos de trabajo](/es/guide/workflow-viewer) — el mismo panel lateral de React Flow usado aquí, originalmente para flujos de trabajo de GitHub Actions.

</div>
