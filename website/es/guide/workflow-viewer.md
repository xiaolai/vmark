# Visor de flujos de trabajo de GitHub Actions

VMark renderiza el YAML de los flujos de trabajo de GitHub Actions como un grafo acíclico dirigido (DAG) interactivo y te permite editar jobs, steps, triggers, permisos y concurrencia a través de formularios estructurados — sin perder nunca comentarios, anclas o formato del archivo subyacente.

La función opera en dos superficies:

1. **Archivos `.yml` independientes** dentro de `.github/workflows/` (o cualquier archivo YAML con las claves de nivel superior `on:` y `jobs:`): vista dividida con el código fuente a la izquierda y el lienzo interactivo más el editor de formularios a la derecha.
2. **Bloques de código en markdown**: cuando un bloque cercado por triples backticks `yaml` o `yml` contiene un flujo de trabajo reconocible, VMark lo renderiza en línea como una imagen del mismo grafo de jobs, igual que se renderizan los bloques `mermaid`.

::: tip No es lo mismo que los flujos de trabajo propios de VMark
Un archivo YAML cuyos `steps:` de nivel superior usan `genie/…` o `action/…` es un [flujo de trabajo de Genie](/es/guide/workflows) — el formato de pipeline propio de VMark, que VMark puede ejecutar. Un flujo de trabajo de GitHub Actions solo se visualiza y se edita aquí; consulta [Lo que esto no es](#lo-que-esto-no-es).
:::

## Archivos de flujo de trabajo independientes

Abre cualquier archivo `.github/workflows/*.yml` en VMark. El archivo se abre en una vista dividida — el código fuente YAML a la izquierda y el banco de trabajo del flujo de trabajo a la derecha (el selector Fuente / Dividido / Vista previa cambia la disposición). El banco de trabajo muestra:

- El flujo de trabajo completo como un lienzo interactivo de React Flow (jobs como nodos, dependencias `needs:` como aristas). Su barra de controles hace zoom, ajusta el grafo al panel y cambia la disposición entre de arriba abajo y de izquierda a derecha — útil para una cadena `needs:` larga en un panel ancho.
- El control de exportación en la esquina superior derecha del lienzo (consulta [Exportaciones](#exportaciones)).
- Un panel de edición estructurada bajo el lienzo: el banner de [Diagnósticos](#diagnosticos), los controles Guardar / Descartar, los formularios a nivel de flujo de trabajo y el formulario del job o step que esté seleccionado.

Haz clic en un job del lienzo para editarlo. Haz clic en un step dentro del job para editar ese step. Escape borra la selección y devuelve el foco al código fuente.

Mientras editas el código fuente, VMark mantiene los dos paneles sincronizados: mover el cursor a las líneas de un job resalta su nodo en el lienzo, las expresiones `${{ }}` se autocompletan con los contextos del flujo de trabajo analizado, y hacer Cmd-clic en una referencia local de `uses:` abre el archivo de destino.

### Edición de jobs

Campos editables:

| Campo | Tipo de patch |
|-------|---------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Resumen de solo lectura: número de steps, `needs:` y `uses:` (para jobs de flujos de trabajo reutilizables).

**Añadir trabajo** (encima de los formularios) crea un job a partir de un ID que escribes — debe empezar por una letra o un guion bajo y no existir ya — que se ejecuta en `ubuntu-latest` hasta que lo cambies. El botón de eliminar del formulario del job elimina el job seleccionado después de que lo confirmes.

El formulario del job también enumera los steps del job. Cada fila se puede mover hacia arriba o hacia abajo o eliminar (tras una confirmación), y **Añadir paso** añade al final un step nuevo como `run: echo TODO`, listo para editar.

### Edición de steps

Campos editables:

| Campo | Tipo de patch |
|-------|---------------|
| `name` | `step.set` |
| `run` (en steps `run`) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| Claves de `with:` | `with.set` / `with.remove` |

El bloque `with:` se renderiza como filas de añadir/editar/eliminar pares clave/valor. Renombrar una clave emite un `with.remove` para la clave antigua seguido de un `with.set` para la nueva. Una clave que ya usa otra fila se rechaza en línea.

En los steps `uses:`, la propia referencia a la action es de solo lectura — cámbiala en el código fuente si necesitas otra action.

En el formulario del step, **Alt + Izquierda** / **Alt + Derecha** pasan al step anterior / siguiente. El atajo funciona en cualquier parte de la ventana, salvo dentro de un campo de texto, un desplegable o un editor de código, donde Alt + Flecha conserva su significado habitual de navegar por palabras.

### Triggers

Un trigger escrito como mapeo (`on: { push: { branches: [main] } }`) tiene campos de filtro editables — branches, branches-ignore, tags, tags-ignore, paths, paths-ignore y types —, cada uno una lista separada por comas. Un cron de `schedule` se muestra como una frase en el idioma de la interfaz — los nombres de días y meses se quedan como abreviaturas inglesas de tres letras (`Mon`, `Jan`) —, con un aviso cuando se ejecuta con más frecuencia que cada 5 minutos (GitHub limita esas ejecuciones), y es de solo lectura. También lo es un trigger escrito como un simple nombre de evento o como una lista de nombres; edítalos en el código fuente.

### Permisos y concurrencia

Dos formularios a nivel de flujo de trabajo se sitúan encima del formulario del job:

- **Permisos** — el valor predeterminado de GitHub (sin clave `permissions:`), `read-all`, `write-all`, `none`, o una tabla por ámbito (`contents`, `pull-requests`, …) con read / write / none para cada uno.
- **Concurrencia** — el `group` y si se aplica `cancel-in-progress`. Un `cancel-in-progress` escrito como expresión se muestra, pero no se puede editar aquí.

## Guardado de cambios

Las ediciones se acumulan en una lista de patches en memoria a medida que cambias campos. El botón Guardar muestra el contador actual (por ejemplo, **3 sin guardar**), y los jobs y steps nuevos ya aparecen en el lienzo y en los formularios antes de guardar.

Cuando pulsas Guardar, VMark:

1. Lee el YAML actual del editor.
2. Aplica cada patch de la cola al CST (árbol de sintaxis concreta) del YAML — preservando comentarios, anclas y formato existente.
3. En un archivo en disco, escribe el resultado en el archivo y después actualiza el editor para que coincida — salvo que hayas tecleado en el código fuente mientras tanto, en cuyo caso se conserva lo que tecleaste.

Si la escritura falla, no se pierde nada: las ediciones siguen en la cola y puedes volver a guardar. Un documento sin título no tiene archivo en el que escribir, así que Guardar solo actualiza el editor; pulsa **Cmd+Shift+S** para guardarlo. **Descartar** elimina las ediciones de la cola.

### Preservar el formato

La ruta de guardado por defecto pasa cada patch a través de la API de CST del paquete `yaml` — los comentarios, los nodos ancla, las indentaciones personalizadas y las opciones existentes de estilo flow vs. block se preservan.

Desactiva **Preservar formato YAML al guardar** en Configuración → Avanzado si prefieres una salida canónica reformateada. La ruta de reformateo pierde los comentarios, así que es opt-in.

## Bloques de código en markdown

Escribe un flujo de trabajo dentro de un bloque de código YAML:

````markdown
```yaml
name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```
````

VMark detecta la forma del flujo de trabajo (claves de nivel superior `on:` y `jobs:`) y renderiza en línea una imagen de su grafo de jobs — el mismo lienzo que en la vista independiente, capturado como imagen. La imagen es de solo lectura; haz doble clic en ella para editar el código fuente.

## Diagnósticos

VMark muestra los diagnósticos de parseo y lint en un banner en la parte superior del panel de formularios. Al hacer clic en una fila, el código fuente salta a la línea problemática, o se selecciona el job problemático cuando la línea no está disponible (por ejemplo, en el modo Vista previa):

| Prefijo del código | Significado |
|--------------------|-------------|
| `GHA-PARSE-*` | YAML mal formado o claves requeridas ausentes |
| `GHA-JOB-*` | Problemas a nivel de job (id duplicado, conflicto entre `uses:` y `steps:`) |
| `GHA-NEEDS-*` | Problemas de dependencias (referencia desconocida, ciclo) |
| `GHA-STEP-*` | Problemas a nivel de step |
| `GHA-EXPR-*` | Referencias de contexto desconocidas |
| `GHA-MATRIX-*` | Problemas de expansión de matrix |
| `GHA-SEC-*` | Avisos de seguridad (por ejemplo, patrones de checkout en `pull_request_target`) |
| `GHA-ACTIONLINT-*` | Reenviados desde `actionlint` si está instalado |

Instala `actionlint` para obtener diagnósticos de expresiones más ricos. Con **Usar actionlint cuando esté disponible** activado — en Configuración → Avanzado (Archivos de flujo de trabajo), activado por defecto —, VMark ejecuta el binario desde el PATH de tu shell de inicio de sesión cada vez que cambia el código fuente de un archivo de flujo de trabajo y añade sus hallazgos al banner de Diagnósticos del banco de trabajo, etiquetados como `GHA-ACTIONLINT-<rule>`; las comprobaciones integradas anteriores nunca lo esperan. Si el interruptor está activado pero el binario no está instalado, VMark te lo indica una vez por sesión y, por lo demás, no dice nada; si el binario está presente pero no se puede ejecutar, el fallo se notifica una vez con el propio mensaje de actionlint. Desactiva el interruptor para omitir actionlint por completo. La operación MCP `workflow.validate` ejecuta la misma comprobación bajo demanda.

## Metadatos de actions

Para los steps `uses:` que referencian actions públicas de GitHub, VMark recupera el `action.yml` de cada action para rellenar las descripciones de los inputs en el editor estructurado. Los resultados se cachean en disco durante 24 horas. Las actions locales del espacio de trabajo (`./…`) se leen desde el disco, nunca desde la red.

Para mantener el editor de flujos de trabajo completamente sin conexión, desactiva **Obtener metadatos de acciones** en Configuración → Avanzado (Archivos de flujo de trabajo) — con él desactivado, no se hace ninguna petición de red y el formulario `with:` recurre a filas libres de clave/valor.

## Exportaciones

El control de exportación en la esquina superior derecha del lienzo ofrece tres formatos:

| Formato | Para qué |
|---------|----------|
| **Mermaid** | Incrustar en READMEs y otros documentos markdown. Se copia al portapapeles. Lossy: omite el estado de ejecución, los iconos de las actions, las insignias personalizadas y los detalles de expansión de matrix. |
| **SVG** | Incrustar en documentos que necesiten gráficos vectoriales. Usa `foreignObject` para el contenido HTML. |
| **PNG** | Compartir en chats o donde no se admita SVG. Renderiza al zoom actual del lienzo. |

## Lo que esto no es

VMark no ejecuta flujos de trabajo de GitHub Actions. Es un visor y editor — la ejecución sigue siendo trabajo de GitHub. La función está pensada puramente para leer, revisar y crear YAML de flujos de trabajo. Los pipelines ejecutables propios de VMark son un formato distinto: consulta [Flujos de trabajo de Genie](/es/guide/workflows).
