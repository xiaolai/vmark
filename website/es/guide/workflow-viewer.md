# Visor de flujos de trabajo de GitHub Actions

VMark renderiza el YAML de los flujos de trabajo de GitHub Actions como un grafo acíclico dirigido (DAG) interactivo y te permite editar jobs, steps y triggers a través de formularios estructurados — sin perder nunca comentarios, anclas o formato del archivo subyacente.

La función opera en dos superficies:

1. **Archivos `.yml` independientes** dentro de `.github/workflows/` (o cualquier archivo cuya forma de nivel superior coincida con un flujo de trabajo): vista dividida con el código fuente a la izquierda y el lienzo interactivo más el editor de formularios a la derecha.
2. **Bloques de código en markdown**: cuando un bloque cercado por triples backticks `yaml` o `yml` contiene un flujo de trabajo reconocible, VMark lo renderiza como un DAG al estilo Mermaid en línea, igual que se renderizan los bloques `mermaid`.

## Archivos de flujo de trabajo independientes

Abre cualquier archivo `.github/workflows/*.yml` en VMark. El panel lateral derecho se abre automáticamente y muestra:

- El flujo de trabajo completo como un lienzo interactivo de React Flow (jobs como nodos, dependencias `needs:` como aristas).
- Un panel de edición estructurada bajo el lienzo.
- Controles Guardar / Descartar en la cabecera del editor.

Haz clic en un job del lienzo para editarlo. Haz clic en un step dentro del job para editar ese step.

### Edición de jobs

Campos editables:

| Campo | Tipo de patch |
|-------|---------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Resumen de solo lectura: número de steps, `needs:` y `uses:` (para jobs de flujos de trabajo reutilizables).

### Edición de steps

Campos editables:

| Campo | Tipo de patch |
|-------|---------------|
| `name` | `step.set` |
| `run` (en steps `run`) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| Claves de `with:` | `with.set` / `with.remove` |

El bloque `with:` se renderiza como filas de añadir/editar/eliminar pares clave/valor. Renombrar una clave emite un `with.remove` para la clave antigua seguido de un `with.set` para la nueva.

En los steps `uses:`, la propia referencia a la action es de solo lectura — cámbiala en el código fuente si necesitas otra action.

### Triggers

El resumen de triggers (event, branches, tags, paths, cron, types) es de solo lectura en esta versión. Editar la densa estructura de los triggers a través de campos de una sola línea es demasiado lossy; edita los triggers en el código fuente hasta que se publique un selector dedicado.

## Guardado de cambios

Las ediciones se acumulan en una lista de patches en memoria a medida que cambias campos. El botón Guardar muestra el contador actual (por ejemplo, **3 sin guardar**).

Cuando pulsas Guardar, VMark:

1. Lee el YAML actual del editor.
2. Aplica cada patch de la cola al CST (árbol de sintaxis concreta) del YAML — preservando comentarios, anclas y formato existente.
3. Reescribe el resultado en el editor como si lo hubieras tecleado.

El archivo se vuelve dirty en el sentido habitual; pulsa **Cmd+S** para escribirlo en disco.

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

VMark detecta la forma del flujo de trabajo (`jobs:` de nivel superior con `runs-on` por job) y renderiza el diagrama en línea. El diagrama es de solo lectura — edita el código fuente para cambiar el flujo de trabajo.

## Diagnósticos

VMark muestra los diagnósticos de parseo y lint junto al código fuente:

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

Instala `actionlint` y activa **Usar actionlint cuando esté disponible** en Configuración → Avanzado para obtener diagnósticos de expresiones más ricos.

## Metadatos de actions

Para los steps `uses:` que referencian actions públicas de GitHub, VMark puede recuperar el `action.yml` de cada action para rellenar las descripciones de los inputs en el editor estructurado. Es opt-in y se cachea en disco durante 24 horas.

Activa **Recuperar metadatos de actions** en Configuración → Avanzado. Desactívalo para mantener todas las referencias a actions como texto puro — no se hacen peticiones de red.

## Exportaciones

El panel lateral del flujo de trabajo incluye tres opciones de exportación accesibles desde el menú de su cabecera:

| Formato | Para qué |
|---------|----------|
| **Mermaid** | Incrustar en READMEs y otros documentos markdown. Lossy: omite el estado de ejecución, los iconos de las actions, las insignias personalizadas y los detalles de expansión de matrix. |
| **SVG** | Incrustar en documentos que necesiten gráficos vectoriales. Usa `foreignObject` para el contenido HTML. |
| **PNG** | Compartir en chats o donde no se admita SVG. Renderiza al zoom actual del lienzo. |

## Lo que esto no es

VMark no ejecuta flujos de trabajo de GitHub Actions. Es un visor y editor — la ejecución sigue siendo trabajo de GitHub. La función está pensada puramente para leer, revisar y crear YAML de flujos de trabajo.
