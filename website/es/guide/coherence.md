# Coherencia y la vista de desglose

La capa de coherencia de VMark mantiene honestos los proyectos de escritura desarrollados recursivamente: registra **qué documentos leyó realmente cada generación de IA**, detecta cuando esos documentos fuente cambian después y te muestra — bajo demanda — exactamente qué artefactos derivados podrían haber quedado desactualizados. Nada se actualiza automáticamente; tú sigues siendo el editor jefe.

## Cómo funciona (30 segundos)

- **El seguimiento de procedencia es opcional.** Activa primero *Ajustes → Archivos e imágenes → Guardado → Insertar bloque de identidad al guardar*. Hasta entonces, ninguna escritura — un guardado, la aplicación de un genio, una sugerencia de IA aceptada, una escritura por MCP, la restauración de una versión anterior o un archivo nuevo desde el explorador de archivos — marca tus archivos ni crea `.vmark/`.
- Una vez activado, cada guardado, aplicación de un genio, sugerencia de IA aceptada, escritura por MCP, restauración de una versión anterior y paso `save-file` de un flujo de trabajo se registra como una **transformación** en un registro (ledger) de texto plano dentro de tu espacio de trabajo (`.vmark/` — JSONL compatible con git y legible por humanos; borrar el `index.db` derivado no pierde nada).
- **Un espacio de trabajo que ya tiene un registro** — un `.vmark/` que creaste antes o que confirmó un colaborador — sigue registrando las escrituras en los documentos que sigue, incluso con el ajuste desactivado. Un documento cuenta como seguido cuando el registro ya lo ha anotado antes, o cuando el archivo ya lleva su propia identidad `vmark:` — un archivo con seguimiento que moviste, copiaste al espacio de trabajo o trajiste con un checkout de git; el propio escaneo del registro adopta exactamente esos. No marca nada: un documento sin identidad queda fuera, y una escritura cuyas entradas quedan así incompletas se registra como `inferred` en lugar de `exact`.
- Cuando una IA escribe un documento mientras lee otros, esas lecturas se convierten en **aristas de dependencia**, fijadas a la revisión que se leyó. Las rutas instrumentadas dentro de la aplicación registran entradas `exact`; una escritura por MCP registra honestamente un conjunto de lecturas `inferred` — solo lo que ese mismo cliente leyó por su propia conexión — y nombra al cliente que la hizo.
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
- **Eximir** — registra una divergencia intencional con un **motivo obligatorio** (los narradores poco fiables existen). En la v0, una exención es deliberadamente estrecha: se aplica solo a esta arista y a la revisión concreta de la fuente contra la que se resuelve. Los elementos eximidos permanecen visibles, marcados de forma distintiva, y se reabren si la fuente vuelve a moverse.

Aceptar más reciente y eximir se deshabilitan cuando la fuente tiene varias versiones actuales — no hay una única revisión contra la cual resolver; revisa (o reconcilia las versiones) primero.

## Silenciar los avisos que no necesitas

Dos controles en cada fila del desglose acotan aquello sobre lo que pregunta la capa. Ambos son exclusivamente humanos — ninguna herramienta MCP puede fijarlos.

**Marcar como terminado (ciclo de vida del documento).** Cuando un documento derivado está acabado — un capítulo publicado, un informe entregado —, elige **Marcar como terminado** en cualquiera de sus filas. Silencia todas las dependencias que llegan a ese documento, incluidas las que no aparecen en la lista en ese momento, y por eso pide confirmación. Sus aristas pasan al grupo plegado **Sin preguntas sobre esto** al final del panel, etiquetadas como *documento terminado*: siguen rastreadas, siguen visibles si las pides, simplemente ya no te interrumpen. **Reabrir** las devuelve con un solo clic y sin confirmación, ya que reabrir solo puede volver a añadir interrupciones. El ciclo de vida se registra en el registro (ledger), no en el frontmatter, así que marcar un documento como terminado no crea una nueva revisión de él.

**Anclas de sección.** Una arista sin ancla pregunta «¿cambió el archivo fuente?». **Anclar a una sección** la acota a «¿cambió la sección de la que dependo?»: elige un encabezado del documento fuente y la arista queda fijada a esa ruta de encabezados. Mientras la sección anclada no cambie, una edición de la fuente en otro lugar deja la arista en el grupo silenciado como *sección de la que depende sin cambios*; una edición dentro de la sección la muestra como *sección anclada modificada*. Si el encabezado desaparece, la arista se marca como *ancla perdida* en lugar de volver en silencio al comportamiento de archivo completo. **Cambiar ancla** la vuelve a fijar y **Archivo completo** la elimina. Las anclas son entradas propias y revisables del registro, así que siguen a la arista a través de las revisiones posteriores.

## El registro de coherencia y la evaluación de los avisos

El **Registro de coherencia** (una sección desplegable del panel de desglose) es el historial por arista que guarda el registro (ledger): cada verificación, ratificación y exención, cuántas veces se ha resuelto cada arista (*resuelto 3 veces*) y cuántas aristas se han resuelto más de una vez — la rotación, que es la verdadera carga de un grafo de dependencias ruidoso. Una verificación semántica que el modelo respondió por debajo del umbral de confianza se muestra con su veredicto y su confianza conservados (*el modelo dijo … con …, por debajo del umbral*), de modo que «sin señal» y «respondió, pero sin la confianza suficiente» siguen siendo distinguibles. El registro se lee del registro (ledger) completo, así que solo se carga cuando lo despliegas y se vuelve a cargar cada vez que lo despliegas.

**¿Valía la pena avisar?** Cada fila mostrada ofrece **¿Valía la pena?** con tres respuestas — **Sí**, **No**, **No sé** — y deliberadamente ninguna predeterminada. Tus respuestas se registran como entradas propias del registro (ledger) y se contabilizan en el Registro de coherencia (*Evaluados: relevante … · ruido … · dudoso … · sin evaluar …*). Esta es la medida de relevancia de la obsolescencia con la que se ajusta la capa: un aviso que juzgas ruido es candidato a un ancla de sección o a marcarse como terminado.

## Verificación semántica, afirmaciones y contextos

La obsolescencia de versión dice que una fuente *se movió*; la verificación semántica dice si ese movimiento realmente *contradice* el documento derivado. Las verificaciones son estrictamente **bajo demanda** (pull): pulsa **Verificar** sobre una arista obsoleta y VMark pide a tu proveedor de IA configurado que compare la revisión fijada de la fuente, la actual y el texto derivado. El veredicto llega como una insignia — *verificada válida*, *contradicha* (siempre con una cita textual como evidencia) o *sin verificar* cuando el modelo dudó, agotó el tiempo o respondió por debajo del umbral de confianza. Lo desconocido es honesto, nunca se oculta. Una verificación caduca en el momento en que cualquiera de los dos documentos vuelve a moverse — o cambia el conjunto de afirmaciones.

Las **afirmaciones canónicas** son hechos que has hecho explícitos («Elena es zurda»). Selecciona texto en un documento y ejecuta *Extraer afirmación de la selección*: la afirmación nace como **borrador**, con su procedencia (qué documento, qué revisión). Para ver y gestionar tus afirmaciones, ejecuta **Afirmaciones canónicas** desde la paleta de comandos — el panel no tiene elemento de menú ni atajo, y *Extraer afirmación de la selección* te lo abre con el nuevo borrador. Pasa una afirmación a **establecida** cuando se convierta en canon — solo las afirmaciones establecidas alimentan las verificaciones semánticas. Corregir o retirar una afirmación añade historial; nada se borra jamás. Ocultar una afirmación en un contexto es visibilidad reversible, no un retiro.

Los **contextos** son vistas con nombre del espacio de trabajo (el contexto *default* siempre está ahí). Cada contexto decide qué significa «actual» y qué afirmaciones aplican; un contexto hijo hereda las afirmaciones de su padre de forma aditiva. Los contextos son **invernadero** por defecto — los veredictos de verificación se leen como tensión consultiva. Cambiar uno a **aplicado** (un acto explícito y confirmado) marca las contradicciones como violaciones del canon. El selector de contexto del desglose elige a través de qué contexto estás mirando; los resultados de verificación quedan ligados exactamente al contexto y a la instantánea de afirmaciones que los produjeron y nunca se filtran de uno a otro.

## Procedencia, delegación y ramas

Tres cosas mantienen honesta la capa de coherencia a medida que un proyecto realmente evoluciona — ninguna de ellas da la lata, todas son solo bajo demanda (pull).

**Recuperación de procedencia.** Cuando editas a mano un documento derivado (en VMark o en un editor externo), la edición pierde correctamente sus entradas registradas — las viejas aristas de dependencia ya no describen el nuevo texto. El grupo *Procedencia desconocida* del desglose se ofrece a restaurarlas: pulsa **Sugerir entradas** y VMark propone el conjunto de entradas previo más reciente del documento (con los roles preservados), premarcado y editable. **Confirmar procedencia** vuelve a adjuntar las aristas a la versión actual sin crear una nueva revisión, de modo que los propios documentos aguas abajo nunca ven un cambio espurio. Los documentos que nunca tuvieron entradas no se listan jamás — no hay nada que recuperar ni nada con lo que dar la lata.

**Delegación en agentes.** Por defecto, solo tú puedes resolver aristas obsoletas. Si quieres que un agente de IA acepte la más reciente o exima en tu nombre (a través de la herramienta MCP `coherence_resolve`), otórgale desde el desglose una **delegación con límite de tiempo**: nombra al agente, elige el alcance (aceptar más reciente o eximir, o ambos) y fija una caducidad (7 días por defecto, nunca «para siempre»). Cada resolución delegada queda registrada en el otorgamiento, así que el rastro de auditoría siempre muestra quién actuó bajo la autoridad de quién. Revoca cualquier otorgamiento con un clic. Las afirmaciones canónicas y los contextos siguen siendo exclusivamente humanos — un agente nunca puede promover una afirmación ni aplicar un contexto.

**Contextos de rama.** Un contexto puede asignarse a una rama de git. Cuando haces checkout de una rama asignada, el desglose muestra un **chip candidato** que ofrece cambiar — nunca cambia por su cuenta. Si la rama aún no tiene contexto, el chip ofrece crear uno con su nombre. Cuando aterriza una fusión real (no fast-forward), un banner descartable te sugiere revisar el desglose; la divergencia y la obsolescencia que muestra son los estados normales del desglose — así que no se ejecuta nada nuevo, solo se te acompaña a la revisión.

## Identidad en el frontmatter

Con *Insertar bloque de identidad al guardar* activado, la primera vez que se captura un archivo, VMark añade un pequeño bloque de identidad a su frontmatter:

```yaml
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
```

Este ID es la forma en que un documento conserva su historial a través de renombrados y movimientos. Nunca afecta al hash del contenido (añadirlo no crea un "cambio"), y todo lo demás en tu frontmatter queda intacto. Si copias un archivo, el ID duplicado se detecta y se muestra para que lo resuelvas — nunca se corrige automáticamente.

Si prefieres que VMark nunca toque tus archivos, deja *Insertar bloque de identidad al guardar* desactivado: es el valor predeterminado. Así, VMark no añade este bloque a ningún archivo, se escriba como se escriba — tampoco a los archivos que una edición de IA o MCP solo leyó.

## Interoperabilidad con git

- Los archivos del registro `.vmark/` se rastrean en git y se fusionan limpiamente entre ramas (solo añadir, `merge=union`).
- Los checkouts, cambios de rama y resets se reconocen como **navegación** — nunca crean revisiones fantasma.
- `git revert` y las fusiones que generan contenido nuevo se capturan como transformaciones atribuidas a git.
- El índice derivado (`index.db`) está en el gitignore y se reconstruye a partir del registro de texto plano cuando hace falta.

## Para agentes de IA (MCP)

Los agentes externos pueden consultar el estado de coherencia mediante la [herramienta MCP `coherence`](/es/guide/mcp-tools#coherence) (acciones `status`, `edges`, `claims` y `contexts`), para los espacios de trabajo que hayas abierto en VMark. `status` es una lectura pura; `edges` reconcilia primero — puede añadir registros de procedencia al registro propio del espacio de trabajo, pero nunca toca tus documentos. La herramienta declara `readOnlyHint: true`, así que un cliente puede aprobarla automáticamente.

La resolución (ratificar/eximir) vive en una herramienta **independiente**, [`coherence_resolve`](/es/guide/mcp-tools#coherence-resolve), y por defecto queda en manos del humano: un agente solo puede llamarla después de que concedas a ese agente concreto una delegación con límite de tiempo, y cada resolución queda registrada para auditoría en el otorgamiento. Mantenerla fuera de `coherence` es lo que permite aprobar automáticamente la herramienta de lectura sin que un agente adquiera en silencio la capacidad de escribir en tu registro.

Las afirmaciones canónicas y los contextos nunca se pueden modificar por MCP.
