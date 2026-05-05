# Navegación Inteligente con Tab

Las teclas Tab y Shift+Tab de VMark son conscientes del contexto — te ayudan a navegar eficientemente por texto formateado, corchetes y enlaces sin necesidad de usar las teclas de flecha.

## Resumen Rápido

| Contexto | Acción de Tab | Acción de Shift+Tab |
|----------|---------------|---------------------|
| Dentro de corchetes `()` `[]` `{}` | Saltar más allá del corchete de cierre | Saltar antes del corchete de apertura |
| Dentro de comillas `""` `''` | Saltar más allá de la comilla de cierre | Saltar antes de la comilla de apertura |
| Dentro de corchetes CJK `「」` `『』` | Saltar más allá del corchete de cierre | Saltar antes del corchete de apertura |
| Dentro de **negrita**, *cursiva*, `código`, ~~tachado~~ | Saltar después del formato | Saltar antes del formato |
| Dentro de un enlace | Saltar después del enlace | Saltar antes del enlace |
| En una celda de tabla | Ir a la siguiente celda | Ir a la celda anterior |
| En un elemento de lista | Indentar el elemento | Desindentar el elemento |

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
