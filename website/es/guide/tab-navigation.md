# Navegación Inteligente con Tab

Las teclas Tab y Shift+Tab de VMark son conscientes del contexto — te ayudan a navegar eficientemente por texto formateado, corchetes y enlaces sin necesidad de usar las teclas de flecha.

> Con la [barra de espacios de trabajo](/es/guide/workspace-rail) experimental, el ciclo entre pestañas y la tira de pestañas abarcan solo las pestañas del espacio de trabajo activo.

## Resumen Rápido

| Contexto | Acción de Tab | Acción de Shift+Tab |
|----------|---------------|---------------------|
| Dentro de corchetes `()` `[]` `{}` | Saltar más allá del corchete de cierre | Saltar antes del corchete de apertura |
| Dentro de comillas `""` `''` | Saltar más allá de la comilla de cierre | Saltar antes de la comilla de apertura |
| Dentro de corchetes CJK `「」` `『』` | Saltar más allá del corchete de cierre | Saltar antes del corchete de apertura |
| Dentro de **negrita**, *cursiva*, `código`, ~~tachado~~ | Saltar después del formato | Saltar antes del formato |
| Dentro de un enlace | Saltar después del enlace | Saltar antes del enlace |
| En una celda de tabla | Ir a la siguiente celda | Ir a la celda anterior |
| En un elemento de lista | Indentar el elemento | Desindentar el elemento (se detiene en el nivel más externo) |

## Escape de Corchetes y Comillas

Cuando el cursor está justo antes de un corchete o comilla de cierre, presionar Tab salta sobre él. Cuando el cursor está justo después de un corchete o comilla de apertura, presionar Shift+Tab salta de vuelta antes de él.

### Caracteres Admitidos

**Corchetes y comillas estándar:**
- Paréntesis: `( )`
- Corchetes cuadrados: `[ ]`
- Llaves: `{ }`
- Comillas dobles: `" "`
- Comillas simples: `' '`
- Comillas invertidas: `` ` ``

**Corchetes CJK:**
- Paréntesis de ancho completo: `（ ）`
- Corchetes lenticulares: `【 】`
- Corchetes angulares: `「 」`
- Corchetes angulares blancos: `『 』`
- Corchetes angulares dobles: `《 》`
- Corchetes angulares: `〈 〉`

**Comillas curvas:**
- Comillas dobles curvas: `" "`
- Comillas simples curvas: `' '`

### Cómo Funciona

```text
function hello(world|)
                    ↑ cursor antes de )
```

Presiona **Tab**:

```text
function hello(world)|
                     ↑ cursor después de )
```

Esto también funciona con corchetes anidados — Tab salta sobre el carácter de cierre inmediatamente adyacente.

Presionar **Shift+Tab** invierte la acción — si el cursor está justo después de un carácter de apertura:

```text
function hello(|world)
               ↑ cursor después de (
```

Presiona **Shift+Tab**:

```text
function hello|(world)
              ↑ cursor antes de (
```

### Ejemplo CJK

```text
这是「测试|」文字
         ↑ cursor antes de 」
```

Presiona **Tab**:

```text
这是「测试」|文字
          ↑ cursor después de 」
```

## Escape de Formato (Modo WYSIWYG)

En el modo WYSIWYG, Tab y Shift+Tab pueden escapar de las marcas de formato en línea.

### Formatos Admitidos

- Texto en **negrita**
- Texto en *cursiva*
- `Código en línea`
- ~~Tachado~~
- Enlaces

### Cómo Funciona

Cuando el cursor está en cualquier lugar dentro del texto formateado:

```text
This is **bold te|xt** here
                 ↑ cursor dentro de la negrita
```

Presiona **Tab**:

```text
This is **bold text**| here
                     ↑ cursor después de la negrita
```

Shift+Tab funciona al revés — salta al inicio del formato:

```text
This is **bold te|xt** here
                 ↑ cursor dentro de la negrita
```

Presiona **Shift+Tab**:

```text
This is |**bold text** here
        ↑ cursor antes de la negrita
```

### Escape de Enlace

Tab y Shift+Tab también escapan de los enlaces:

```text
Check out [VMark|](https://vmark.app)
               ↑ cursor dentro del texto del enlace
```

Presiona **Tab**:

```text
Check out [VMark](https://vmark.app)| and...
                                    ↑ cursor después del enlace
```

Presionar **Shift+Tab** dentro de un enlace mueve al inicio:

```text
Check out |[VMark](https://vmark.app) and...
          ↑ cursor antes del enlace
```

## Navegación de Enlace (Modo Fuente)

En el modo Fuente, Tab proporciona navegación inteligente dentro de la sintaxis de enlace Markdown.

### Corchetes Anidados y Escapados

VMark gestiona correctamente la sintaxis de enlace compleja:

```markdown
[text [with nested] brackets](url)     ✓ Funciona
[text \[escaped\] brackets](url)       ✓ Funciona
[link](https://example.com/page(1))    ✓ Funciona
```

La navegación con Tab identifica correctamente los límites del enlace incluso con corchetes anidados o escapados.

### Enlaces Estándar

```markdown
[link text|](url)
          ↑ cursor en el texto
```

Presiona **Tab** → el cursor se mueve a la URL:

```markdown
[link text](|url)
            ↑ cursor en la URL
```

Presiona **Tab** de nuevo → el cursor sale del enlace:

```markdown
[link text](url)|
                ↑ cursor después del enlace
```

### Wiki Links

```markdown
[[page name|]]
           ↑ cursor en el enlace
```

Presiona **Tab**:

```markdown
[[page name]]|
             ↑ cursor después del enlace
```

## Modo Fuente: Escape de Caracteres Markdown

En el modo Fuente, Tab también salta sobre los caracteres de formato Markdown:

| Caracteres | Uso |
|------------|-----|
| `*` | Negrita/cursiva |
| `_` | Negrita/cursiva |
| `^` | Superíndice |
| `~~` | Tachado (saltado como unidad) |
| `==` | Resaltado (saltado como unidad) |

### Ejemplo

```markdown
This is **bold|** text
              ↑ cursor antes de **
```

Presiona **Tab**:

```markdown
This is **bold**| text
                ↑ cursor después de **
```

::: info
El modo Fuente no tiene escape Shift+Tab para caracteres markdown — Shift+Tab solo desindenta (elimina espacios iniciales).
:::

## Modo Fuente: Auto-Emparejamiento

En el modo Fuente, escribir un carácter de formato inserta automáticamente su par de cierre:

| Carácter | Emparejamiento | Comportamiento |
|----------|----------------|----------------|
| `*` | `*\|*` o `**\|**` | Basado en retraso — espera 150ms para detectar simple vs doble |
| `~` | `~\|~` o `~~\|~~` | Basado en retraso |
| `_` | `_\|_` o `__\|__` | Basado en retraso |
| `=` | `==\|==` | Siempre empareja como doble |
| `` ` `` | `` `\|` `` | La comilla invertida simple empareja después de un retraso |
| ` ``` ` | Bloque de código | La triple comilla invertida al inicio de línea crea un bloque de código delimitado |

El auto-emparejamiento está **deshabilitado dentro de los bloques de código delimitados** — escribir `*` en un bloque de código inserta un `*` literal sin emparejamiento.

Retroceso entre un par elimina ambas mitades: `*\|*` → Retroceso → vacío.

## Navegación de Tabla

Cuando el cursor está dentro de una tabla:

| Acción | Tecla |
|--------|-------|
| Siguiente celda | Tab |
| Celda anterior | Shift + Tab |
| Añadir fila (en la última celda) | Tab |

Tab en la última celda de la última fila añade automáticamente una nueva fila.

## Indentación de Lista

Cuando el cursor está en un elemento de lista:

| Acción | Tecla |
|--------|-------|
| Indentar elemento | Tab |
| Desindentar elemento | Shift + Tab |

Desindentar quita un nivel de anidamiento y **se detiene en el nivel más externo** — no
saca un elemento de la lista. Para salir de una lista por completo, usa **Eliminar
lista**, o vuelve a pulsar el botón de lista para desactivarla.

## Configuración

El comportamiento de escape con Tab se puede personalizar en **Configuración → Editor**:

| Configuración | Efecto |
|---------------|--------|
| **Auto-emparejar Corchetes** | Habilitar/deshabilitar el emparejamiento de corchetes y el escape con Tab |
| **Corchetes CJK** | Incluir pares de corchetes CJK |
| **Comillas Curvas** | Incluir pares de comillas curvas (`""` `''`) |

::: tip
Si el escape con Tab entra en conflicto con tu flujo de trabajo, puedes deshabilitar completamente el auto-emparejamiento de corchetes. Tab insertará entonces espacios (o indentará en listas/tablas) de forma normal.
:::

## Comparación: Modo WYSIWYG vs Modo Fuente

| Función | Tab (WYSIWYG) | Shift+Tab (WYSIWYG) | Tab (Fuente) | Shift+Tab (Fuente) |
|---------|---------------|---------------------|--------------|-------------------|
| Escape de corchetes | ✓ | ✓ | ✓ | — |
| Escape de corchetes CJK | ✓ | ✓ | ✓ | — |
| Escape de comillas curvas | ✓ | ✓ | ✓ | — |
| Escape de marca (negrita, etc.) | ✓ | ✓ | N/A | N/A |
| Escape de enlace | ✓ | ✓ | ✓ (navegación de campo) | — |
| Escape de carácter Markdown (`*`, `_`, `~~`, `==`) | N/A | N/A | ✓ | — |
| Auto-emparejamiento Markdown (`*`, `~`, `_`, `=`) | N/A | N/A | ✓ (basado en retraso) | N/A |
| Navegación de tabla | Celda siguiente | Celda anterior | N/A | N/A |
| Indentación de lista | Indentar | Desindentar | Indentar | Desindentar |
| Soporte multicursor | ✓ | ✓ | ✓ | — |
| Deshabilitado dentro de bloques de código | ✓ | ✓ | ✓ | N/A |

## Soporte Multicursor

El escape con Tab funciona con múltiples cursores — cada cursor se procesa de forma independiente.

### Cómo Funciona

Cuando tienes múltiples cursores y presionas Tab o Shift+Tab:
- **Tab**: Los cursores dentro del formato escapan al final; los cursores antes de los corchetes de cierre saltan sobre ellos
- **Shift+Tab**: Los cursores dentro del formato escapan al inicio; los cursores después de los corchetes de apertura saltan antes de ellos
- Los cursores en texto sin formato permanecen en su lugar

### Ejemplo

```text
**bold|** and [link|](url) and plain|
     ^1          ^2            ^3
```

Presiona **Tab**:

```text
**bold**| and [link](url)| and plain|
        ^1               ^2         ^3
```

Cada cursor escapa de forma independiente según su contexto.

::: tip
Esto es particularmente poderoso para ediciones en lote — selecciona múltiples ocurrencias con `Mod + D`, luego usa Tab para escapar de todas ellas a la vez.
:::

## Prioridad y Comportamiento en Bloques de Código

### Prioridad de Escape

Cuando múltiples objetivos de escape se superponen, Tab los procesa **del más interno al más externo**:

```text
**bold text(|)** here
               ↑ Tab salta ) primero (el corchete es el más interno)
```

Presiona **Tab** de nuevo:

```text
**bold text()**| here
               ↑ Tab escapa la marca de negrita
```

Esto significa que el salto de corchetes siempre se ejecuta antes que el escape de marca — puedes confiar en que Tab saldrá de los corchetes primero y luego del formato.

### Guardia de Bloque de Código

Los saltos de corchetes con Tab y Shift+Tab están **deshabilitados dentro de los bloques de código** — tanto en los nodos `code_block` como en los fragmentos de código en línea. Esto evita que Tab salte sobre los corchetes en el código, donde los corchetes son sintaxis literal:

```text
`array[index|]`
              ↑ Tab NO salta ] en código en línea — inserta espacios en su lugar
```

La inserción de auto-emparejamiento también está deshabilitada dentro de los bloques de código tanto en el modo WYSIWYG como en el modo Fuente.

## Consejos

1. **Memoria muscular** — Una vez que te acostumbras al escape con Tab, navegarás mucho más rápido sin necesidad de las teclas de flecha.

2. **Funciona con auto-emparejamiento** — Cuando escribes `(`, VMark auto-inserta `)`. Después de escribir dentro, simplemente presiona Tab para saltar afuera.

3. **Estructuras anidadas** — Tab escapa un nivel a la vez. Para `((anidado))`, necesitas dos Tabs para salir completamente.

4. **Shift + Tab** — El espejo de Tab. Escapa hacia atrás desde las marcas, los enlaces y los corchetes de apertura. En las tablas, mueve a la celda anterior. En las listas, desindenta el elemento.

5. **Multicursor** — El escape con Tab funciona con todos tus cursores simultáneamente, haciendo las ediciones en lote aún más rápidas.

## Cambiar entre pestañas abiertas

Las pestañas están en la barra de estado, en la parte inferior de la ventana. Hay tres formas de
moverse entre ellas:

| Acción | Atajo | Notas |
|---|---|---|
| Última pestaña usada | `Ctrl + Tab` | Salta a la pestaña en la que estabas antes de esta. Vuelve a pulsarlo para regresar directamente. |
| Pestaña siguiente / anterior | `Mod + Shift + ]` / `Mod + Shift + [` | Avanza por la tira en orden, sin importar lo que hayas usado recientemente. |
| Apertura rápida | `Mod + O` | Escribe para filtrar. Las pestañas abiertas aparecen primero, con la usada más recientemente arriba. |

**Última pestaña usada es un conmutador, no un ciclo.** Te lleva al documento en el que
estuviste más recientemente, y pulsarlo una segunda vez te devuelve a donde
empezaste — la forma rápida de trabajar entre dos archivos. Pestaña siguiente y Pestaña anterior
recorren la tira por posición, que es lo que quieres cuando buscas
algo en lugar de volver a ello.

Es un elemento de menú además de un atajo (**Vista → Última pestaña usada**), y eso es
lo que le permite seguir funcionando mientras el navegador integrado tiene el foco del teclado.

### Cuando hay más pestañas de las que caben

La tira de pestañas se desplaza. Cuando hay pestañas fuera de cualquiera de los bordes, la tira se
difumina en ese borde y aparece una pequeña flecha — haz clic en ella para desplazarte una pantalla.
Cambiar de pestaña por cualquier medio también desplaza la nueva pestaña hasta hacerla visible, de modo
que la pestaña resaltada nunca queda oculta fuera de la pantalla.

La propia tira es accesible con el teclado: llega a ella con Tab y usa las teclas de flecha.

## Dos documentos lado a lado

**Vista → Dividir editor — dos documentos** (`Alt + Mod + \`) coloca un segundo
documento junto al actual. Para elegir qué documento, haz clic derecho en cualquier pestaña
y elige **Abrir al lado**.

| Acción | Atajo |
|---|---|
| Dividir editor — dos documentos | `Alt + Mod + \` |
| Cerrar panel | `Alt + Mod + Shift + \` |
| Enfocar el otro panel | `Alt + Mod + Shift + O` |
| Sincronizar desplazamiento | *(sin atajo predeterminado)* |

Notas sobre su comportamiento:

- La pestaña que se muestra en el **otro** panel está marcada en la tira de pestañas con un
  subrayado tenue, para que siempre sepas qué dos documentos están en pantalla y en cuál
  irá lo que escribas.
- **Cerrar uno de los dos colapsa la vista sobre el otro**, en lugar de llevarte
  a una pestaña sin relación. El documento que queda se mantiene en su sitio.
- **Sincronizar desplazamiento** vincula proporcionalmente el desplazamiento de los dos paneles.
  Está desactivado de forma predeterminada y es propio de cada división.
- **Los dos paneles comparten un mismo modo de vista.** El modo código fuente (`F6`)
  cambia ambos paneles a la vez, y pasar de un panel a otro mantiene el modo actual.
- Dividir requiere dos documentos abiertos. Las pestañas del navegador no son documentos, así que la
  división no se aplica a ellas.

## El menú contextual de la pestaña

Haz clic derecho en una pestaña para abrir su menú. Las teclas de flecha, Inicio y Fin se mueven por él; Intro o Espacio ejecutan un elemento; Escape lo cierra.

| Elemento | Qué hace | Disponible cuando |
|---|---|---|
| Mover a una ventana nueva | Mueve la pestaña a una ventana nueva, con un **Deshacer** en la confirmación. Una ventana secundaria que queda vacía se cierra. | El documento está cargado y no es la única pestaña de la ventana principal |
| Fijar / Desfijar | Fija o desfija la pestaña — consulta [Pestañas fijadas](#pestanas-fijadas). | Siempre |
| Abrir al lado | Muestra la pestaña en el otro panel de la división — consulta [Dos documentos lado a lado](#dos-documentos-lado-a-lado). | Tanto esta pestaña como la activa son documentos, y esta no es la pestaña activa (no se muestra para las pestañas del navegador) |
| Renombrar | Renombra el archivo directamente en la pestaña — consulta [Renombrar un archivo](#renombrar-un-archivo). | El documento se ha guardado |
| Copiar ruta | Copia la ruta absoluta del archivo. | El documento se ha guardado |
| Copiar ruta relativa | Copia la ruta relativa a la carpeta del espacio de trabajo. | Hay un espacio de trabajo abierto y el archivo está dentro de él |
| Mostrar en Finder | Muestra el archivo en Finder (**Mostrar en Explorador** en Windows, **Mostrar en gestor de archivos** en Linux). | El documento se ha guardado |
| Restaurar en disco | Vuelve a escribir el contenido de la pestaña en su ruta. | El archivo se eliminó del disco mientras estaba abierto |
| Volver a la versión guardada | Tras una confirmación, descarta tus cambios y vuelve a cargar el archivo desde el disco. | La pestaña tiene cambios sin guardar y su archivo sigue existiendo |
| Cerrar | Cierra la pestaña (primero pregunta si quieres guardar si tiene cambios sin guardar). | La pestaña no está fijada |
| Cerrar otras | Cierra todas las demás pestañas no fijadas. | Existe otra pestaña no fijada |
| Cerrar pestañas a la derecha | Cierra las pestañas no fijadas situadas a su derecha. | Existe alguna |
| Cerrar pestañas no fijadas | Cierra todas las pestañas no fijadas, incluida esta. | Existe una pestaña no fijada |
| Cerrar todo | Cierra todas las pestañas, incluidas las fijadas. Si se va a cerrar alguna pestaña fijada, primero pide confirmación e indica cuántas son; al cancelar no se cierra nada. | Siempre |

Los cierres en bloque actúan sobre las pestañas del espacio de trabajo actual y las cierran de una en una. Cada pestaña con cambios sin guardar pregunta primero, y cancelar cualquiera de esas preguntas detiene el resto.

## Pestañas fijadas

Fija una pestaña desde su menú contextual para tenerla a mano:

- Se mueve al grupo de pestañas fijadas a la izquierda de la tira, muestra un icono de chincheta y pierde su botón de cierre. Las pestañas no se pueden arrastrar a través del límite entre pestañas fijadas y no fijadas (*«Las pestañas fijadas permanecen a la izquierda. Soltar bloqueado.»*), y una pestaña fijada no se puede arrastrar fuera de su ventana.
- No se puede cerrar por ningún medio — `Mod + W`, clic central, **Cerrar** o un cierre en bloque — hasta que la desfijes; al intentarlo se muestra *«Desanclar antes de cerrar»*. Dos cierres deliberados son la excepción: **Cerrar todo** también cierra las pestañas fijadas una vez que confirmas, y cerrar un espacio de trabajo desde la barra cierra sus pestañas fijadas junto con las demás.
- Cerrar una ventana que contiene pestañas fijadas pide confirmación — *«Esta ventana tiene N pestañas fijadas. ¿Cerrar de todos modos?»* — salvo que ya se haya mostrado un diálogo de guardado.
- Una pestaña fijada sigue fijada al moverla a otra ventana o espacio de trabajo y tras un reinicio por actualización, pero no al salir de VMark: las pestañas que se vuelven a abrir en el siguiente inicio no están fijadas.

No hay atajo de teclado para fijar.

## Renombrar un archivo

Elige **Renombrar** en el menú contextual de una pestaña. El nombre pasa a ser editable en la pestaña, con la parte anterior a la extensión seleccionada. Intro o hacer clic fuera confirma; Escape cancela. El archivo se renombra en el disco y todas las pestañas abiertas que apuntan a él lo siguen. VMark nunca sobrescribe: si el nombre ya está en uso, un diálogo dice *Ya existe un archivo llamado «X».* Un nombre vacío, sin cambios, `.` o `..`, o que contenga `/` o `\`, se rechaza o se ignora. Lo que escribes es el nombre completo — si borras la extensión, el archivo la pierde.

En **macOS**, con **Configuración → Apariencia → Mostrar nombre de archivo en la barra de título** activado, también puedes hacer doble clic en el nombre del archivo en la barra de título para renombrarlo. Se aplican las mismas reglas y los mismos mensajes; tras una colisión o un error el nombre sigue siendo editable para que puedas probar otro. Si **Mostrar extensiones de archivo** está desactivado, se conserva la extensión original cuando escribes un nombre sin ella. Hacer doble clic en el título de un documento sin guardar abre **Guardar** en su lugar.

## Cerrar pestañas y ventanas

Nada con cambios sin guardar se cierra sin preguntar.

- **Cerrar una pestaña** con cambios sin guardar (`Mod + W`, la × de la pestaña o **Cerrar**) pregunta *«¿Deseas guardar los cambios en …?»* con **Guardar**, **No guardar** y **Cancelar**. **Guardar** en un documento que nunca se ha guardado abre un diálogo de guardado en tu carpeta de guardado predeterminada, con el título de la pestaña como nombre sugerido. Cancelar ese diálogo, o un guardado fallido, mantiene la pestaña abierta.
- **Cerrar una ventana** con un documento sin guardar hace la misma pregunta. Con dos o más, un único diálogo los enumera todos — los documentos que nunca se han guardado se marcan como *(nuevo)* — con **Guardar todo**, **No guardar** y **Cancelar**.
- **Guardar todo** guarda todos los documentos que tienen archivo. Para los documentos que nunca se han guardado pide una ubicación: un diálogo de guardado si hay uno, o **un único selector de carpeta** para varios (*«Elegir carpeta para N documentos nuevos»*). Después cada uno se guarda en esa carpeta con su título, y un nombre que ya está en uso recibe un número (`Untitled 2.md`), así que no se sobrescribe nada.
- **Salir** (`Mod + Q`) hace la misma comprobación en cada ventana, de una en una; cancelar en cualquier ventana cancela la salida. Con **Configuración → Archivos e imágenes → Confirmar salida** activado (el valor predeterminado), la primera pulsación solo muestra *«Presiona ⌘Q de nuevo para salir»* — vuelve a pulsarlo antes de dos segundos. Una salida iniciada por el sistema operativo (al apagar, por ejemplo) omite la doble pulsación.
- **Guardar todo y salir** guarda los documentos sin guardar de todas las ventanas sin el diálogo — aunque sigue preguntando dónde colocar los que nunca se han guardado (un diálogo de guardado, o un selector de carpeta para varios, en la ventana que los contiene) — y después sale. Si un documento no se puede guardar, o cancelas ese diálogo, la salida se detiene: esa ventana sigue abierta y un guardado fallido indica el motivo.

En macOS, VMark sigue ejecutándose después de cerrar su última ventana; en Windows y Linux, cerrar la última ventana sale de la aplicación — salvo que, en Windows, **Configuración → Archivos e imágenes → Minimizar a la bandeja al cerrar** esté activado: entonces la última ventana se oculta en la bandeja del sistema, sin cerrar nada y sin pedir guardar (consulta [Configuración](/es/guide/settings)).
