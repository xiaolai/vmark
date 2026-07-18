# Coherencia y la vista de desglose

La capa de coherencia de VMark mantiene honestos los proyectos de escritura desarrollados recursivamente: registra **qué documentos leyó realmente cada generación de IA**, detecta cuando esos documentos fuente cambian después y te muestra — bajo demanda — exactamente qué artefactos derivados podrían haber quedado desactualizados. Nada se actualiza automáticamente; tú sigues siendo el editor jefe.

## Cómo funciona (30 segundos)

- Cada guardado, aplicación de un genie, sugerencia de IA aceptada, escritura por MCP y paso `save-file` de un flujo de trabajo se registra como una **transformación** en un registro (ledger) de texto plano dentro de tu espacio de trabajo (`.vmark/` — JSONL compatible con git y legible por humanos; borrar el `index.db` derivado no pierde nada).
- Cuando una IA escribe un documento mientras lee otros, esas lecturas se convierten en **aristas de dependencia**, fijadas a la revisión exacta que se leyó.
- Cuando un documento fuente avanza más allá de una revisión fijada, la arista pasa a estar **obsoleta**. Si dos revisiones evolucionaron en paralelo (p. ej., en ramas de git), la arista está **divergente** — se muestra, nunca se adivina.
- Los archivos editados fuera de VMark (terminal, otros editores) se reconcilian al escanear como *ediciones externas observadas* — el historial permanece sin huecos, marcado honestamente como de procedencia desconocida.

## La vista de desglose

Ábrela desde **Ventana → Desglose de coherencia** (o la paleta de comandos: "Desglose de coherencia"). Es estrictamente **bajo demanda** (pull): se actualiza cuando la abres o pulsas actualizar — nunca molesta en segundo plano.

Los elementos se agrupan por artefacto (el documento derivado) y muestran el documento fuente, la revisión fijada y el estado actual:

| Estado | Significado |
|---|---|
| `version-stale` | La fuente avanzó más allá de aquello a partir de lo cual se construyó este artefacto |
| `diverged` | La revisión fijada y la actual son paralelas — no hay línea de descendencia |
| `diverged-multi-head` | La propia fuente tiene versiones actuales paralelas |
| `waived` | Aceptaste la divergencia, con un motivo registrado |
| `unpinnable` | La fuente no se puede resolver (p. ej., un pin inválido) |

### Acciones

Cada elemento ofrece tres acciones honestas — ninguna reescribe el historial:

- **Aceptar más reciente** — registra que el artefacto sigue siendo compatible con la fuente más reciente (una *ratificación*). El elemento sale de la lista; si la fuente vuelve a cambiar, regresa.
- **Revisar** — abre el artefacto para que puedas actualizarlo. Guardar una nueva versión retira la arista antigua.
- **Eximir** — registra una divergencia intencional con un **motivo obligatorio** (los narradores poco fiables existen). Los elementos eximidos permanecen visibles, marcados de forma distintiva, y se reabren si la fuente vuelve a moverse.

Aceptar más reciente y eximir se deshabilitan cuando la fuente tiene varias versiones actuales — no hay una única revisión contra la cual resolver; revisa (o reconcilia las versiones) primero.

## Verificación semántica, afirmaciones y contextos

La obsolescencia de versión dice que una fuente *se movió*; la verificación semántica dice si ese movimiento realmente *contradice* el documento derivado. Las verificaciones son estrictamente **bajo demanda** (pull): pulsa **Verificar** sobre una arista obsoleta y VMark pide a tu proveedor de IA configurado que compare la revisión fijada de la fuente, la actual y el texto derivado. El veredicto llega como una insignia — *verificada válida*, *contradicha* (siempre con una cita textual como evidencia) o *sin verificar* cuando el modelo dudó, agotó el tiempo o respondió por debajo del umbral de confianza. Lo desconocido es honesto, nunca se oculta. Una verificación caduca en el momento en que cualquiera de los dos documentos vuelve a moverse — o cambia el conjunto de afirmaciones.

Las **afirmaciones canónicas** son hechos que has hecho explícitos («Elena es zurda»). Selecciona texto en un documento y ejecuta *Extraer afirmación de la selección*: la afirmación nace como **borrador**, con su procedencia (qué documento, qué revisión). Pásala a **establecida** cuando se convierta en canon — solo las afirmaciones establecidas alimentan las verificaciones semánticas. Corregir o retirar una afirmación añade historial; nada se borra jamás. Ocultar una afirmación en un contexto es visibilidad reversible, no un retiro.

Los **contextos** son vistas con nombre del espacio de trabajo (el contexto *default* siempre está ahí). Cada contexto decide qué significa «actual» y qué afirmaciones aplican; un contexto hijo hereda las afirmaciones de su padre de forma aditiva. Los contextos son **invernadero** por defecto — los veredictos de verificación se leen como tensión consultiva. Cambiar uno a **aplicado** (un acto explícito y confirmado) marca las contradicciones como violaciones del canon. El selector de contexto del desglose elige a través de qué contexto estás mirando; los resultados de verificación quedan ligados exactamente al contexto y a la instantánea de afirmaciones que los produjeron y nunca se filtran de uno a otro.

## Identidad en el frontmatter

La primera vez que se captura un archivo, VMark añade un pequeño bloque de identidad a su frontmatter:

```yaml
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
```

Este ID es la forma en que un documento conserva su historial a través de renombrados y movimientos. Nunca afecta al hash del contenido (añadirlo no crea un "cambio"), y todo lo demás en tu frontmatter queda intacto. Si copias un archivo, el ID duplicado se detecta y se muestra para que lo resuelvas — nunca se corrige automáticamente.

## Interoperabilidad con git

- Los archivos del registro `.vmark/` se rastrean en git y se fusionan limpiamente entre ramas (solo añadir, `merge=union`).
- Los checkouts, cambios de rama y resets se reconocen como **navegación** — nunca crean revisiones fantasma.
- `git revert` y las fusiones que generan contenido nuevo se capturan como transformaciones atribuidas a git.
- El índice derivado (`index.db`) está en el gitignore y se reconstruye a partir del registro de texto plano cuando hace falta.

## Para agentes de IA (MCP)

Los agentes externos pueden consultar el estado de coherencia mediante la [herramienta MCP `coherence`](/es/guide/mcp-tools#coherence) (acciones `status` y `edges`), para los espacios de trabajo que hayas abierto en VMark. `status` es una lectura pura; `edges` reconcilia primero — puede añadir registros de procedencia al registro propio del espacio de trabajo, pero nunca toca tus documentos. La resolución (ratificar/eximir) deliberadamente *no* se expone por MCP en esta versión — las decisiones quedan en manos del humano en la aplicación.
