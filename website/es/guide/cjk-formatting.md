# Guía de Formato CJK

VMark incluye un conjunto completo de reglas de formato para texto en chino, japonés y coreano. Estas herramientas ayudan a mantener una tipografía coherente al mezclar caracteres CJK y latinos.

::: info El coreano se deja intacto a propósito
El coreano usa su propio espaciado entre palabras, y las partículas se unen directamente a la palabra anterior — `VMark에는`, nunca `VMark 에는`. Insertar un espacio ahí es un error gramatical, no una preferencia tipográfica, así que **el hangul queda excluido de todas las reglas de espaciado** y de la conversión a puntuación de ancho completo. El texto coreano pasa sin cambios; solo se formatean los caracteres han que contenga.
:::

## Inicio Rápido

Usa **Formato → CJK → Formatear archivo completo** o presiona `Alt + Mod + Shift + F` para formatear el documento completo.

**Formato → CJK → Formatear selección** (`Mod + Shift + F`) formatea **los bloques que abarca tu selección** — el párrafo, la lista o la tabla completos que toca el cursor o la selección, no los caracteres exactos seleccionados. El espaciado CJK es una propiedad del límite *entre* dos caracteres adyacentes, y una selección a media palabra no contiene ese límite, así que el comando nombra una región que corregir en lugar del texto que reescribir. Sin selección, formatea el bloque donde está el cursor.

Ambos comandos protegen exactamente lo mismo (ver [Contenido protegido](#contenido-protegido)), así que seleccionar todo antes de `Mod + Shift + F` es seguro.

---

## Reglas de Formato

### 1. Espaciado CJK-Latino

Añade automáticamente espacios entre caracteres CJK y caracteres/números latinos,
incluidos los números con signo (negativo, positivo, más-menos) y los números con
un prefijo de moneda.

| Antes | Después |
|-------|---------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |
| 我有-1个 | 我有 -1 个 |
| 我有+1个 | 我有 +1 个 |
| 误差±5%范围 | 误差 ±5% 范围 |
| 中文-$100元 | 中文 -$100 元 |
| 范围-100到-200 | 范围 -100 到 -200 |

Los caracteres de signo reconocidos son los ASCII `-` `+`, los de ancho completo
`－` `＋`, el signo menos Unicode `−` y el más-menos `±`. Un signo solo se une al
número cuando le sigue un dígito (o un símbolo de moneda seguido de un dígito), de
modo que los identificadores CJK-latinos con guion (p. ej. `中文-Web`) y las
expresiones CJK-CJK con guion (p. ej. `中文-我`) se mantienen intactos, y los
rangos como `5-10` se conservan.

**Qué cuenta como CJK y qué cuenta como latino.** Un carácter CJK es un carácter
han, hiragana, katakana o bopomofo según su escritura Unicode. Eso incluye los
bloques han menos comunes (Extensión A, las extensiones del plano suplementario y
los ideogramas de compatibilidad), la marca de iteración `々`, el cero ideográfico
`〇`, el katakana de medio ancho y la marca de sonido prolongado `ー`. Un carácter
latino es cualquier letra de escritura latina, incluidas las letras acentuadas, así
que se añade espacio a ambos lados de una palabra:

| Antes | Después |
|-------|---------|
| 中文café中文 | 中文 café 中文 |
| 中文𠀀abc | 中文𠀀 abc |
| ｶﾀｶﾅabc | ｶﾀｶﾅ abc |
| 日本・東京 | 日本・東京 |

Las letras latinas de ancho completo (`Ａ`) llevan su propio espaciado y nunca se
separan. El punto medio katakana `・` es puntuación, no una letra, así que no se
añade espacio a su lado.

**Enlaces.** El paréntesis de cierre de un enlace se separa del texto CJK que le
sigue solo cuando el texto visible del enlace termina en una letra latina o un
dígito — ese es el hueco que ve el lector. `参见[link](https://x.com)中文` se
convierte en `参见[link](https://x.com) 中文`; `参见[中文](https://x.com)中文` no cambia.

### 2. Puntuación de Ancho Completo

Convierte la puntuación de medio ancho a ancho completo en contexto CJK.

| Antes | Después |
|-------|---------|
| 你好,世界 | 你好，世界 |
| 什么? | 什么？ |
| 注意:重要 | 注意：重要 |

### 3. Conversión de Caracteres de Ancho Completo

Convierte letras y números de ancho completo a medio ancho.

| Antes | Después |
|-------|---------|
| １２３４ | 1234 |
| ＡＢＣ | ABC |

### 4. Conversión de Paréntesis

Convierte paréntesis de medio ancho a ancho completo cuando rodean contenido CJK. Ambos paréntesis deben estar en el mismo párrafo: separados por una línea en blanco, se quedan como se escribieron.

| Antes | Después |
|-------|---------|
| (注意) | （注意） |
| [重点] | 【重点】 |
| (English) | (English) |

### 5. Conversión de Guiones

Convierte guiones dobles en guiones largos CJK adecuados.

| Antes | Después |
|-------|---------|
| 原因--结果 | 原因 —— 结果 |
| 说明--这是 | 说明 —— 这是 |

### 6. Conversión de Comillas Tipográficas

VMark usa un **algoritmo de emparejamiento de comillas basado en pila** que gestiona correctamente:

- **Apóstrofos**: Las contracciones como `don't`, `it's`, `l'amour` se conservan
- **Posesivos**: `Xiaolai's` permanece igual
- **Primos**: Las medidas como `5'10"` (pies/pulgadas) se conservan
- **Décadas**: Las abreviaciones como `'90s` son reconocidas
- **Detección de contexto CJK**: Las comillas alrededor de contenido CJK se convierten en comillas curvas o corchetes angulares

| Antes | Después |
|-------|---------|
| 他说"hello" | 他说 “hello” |
| "don't worry" | “don't worry” |
| 5'10" tall | 5'10" tall |

Las comillas curvas llevan un espacio junto al texto CJK: `他说"hello"` se convierte en `他说 “hello”`. Las comillas angulares (`「 」`, `『 』`) y la puntuación final nunca lo llevan. Para mantener las comillas curvas ajustadas, desactiva **Corregir espaciado de comillas dobles** o **Corregir espaciado de comillas simples** en Ajustes → Idioma → Formato CJK: `“ ”` y `‘ ’` son de ancho completo en contexto CJK, y GB/T 15834 y JLREQ consideran el hueco parte del glifo — precisamente para eso existen estos interruptores.

Con la opción de corchetes angulares activada:

| Antes | Después |
|-------|---------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Normalización de Puntos Suspensivos

Estandariza el formato de los puntos suspensivos, con la forma que usa la escritura circundante. No hay una única respuesta correcta: el chino (GB/T 15834) y el japonés (JIS X 4051) usan los puntos suspensivos de seis puntos `……` y **no** llevan espacio después, el coreano usa `…`, y solo el texto latino usa `...` seguido de un espacio.

| Antes | Después |
|-------|---------|
| 等等. . . | 等等…… |
| 然后...继续 | 然后……继续 |
| そして...続く | そして……続く |
| 그리고...계속 | 그리고…계속 |
| wait...ok | wait... ok |

La escritura se decide a partir de los caracteres inmediatamente contiguos a los puntos, no del documento, así que `...` dentro de una cita en inglés en un archivo chino conserva su forma latina.

### 8. Puntuación Repetida

Limita los signos de puntuación consecutivos (límite configurable).

| Antes | Después (límite=1) |
|-------|---------------------|
| 太棒了！！！ | 太棒了！ |
| 真的吗？？？ | 真的吗？ |

### 9. Otras Limpiezas

- Espacios múltiples comprimidos: `多个   空格` → `多个 空格`
- Espacios al final de línea eliminados
- Espaciado de barras: `A / B` → `A/B`
- Unión de moneda y unidad: `$ 100` → `$100`, `100 %` → `100%`. Solo se eliminan espacios y tabulaciones: un número al final de una línea o párrafo nunca se une a una unidad o moneda de la línea siguiente, y se conserva un espacio de no separación que hayas escrito entre un número y su unidad

---

## Contenido Protegido

El siguiente contenido **no** se ve afectado por el formato:

- Bloques de código (```) — incluida una valla **sin cerrar**, que abarca el resto del documento, tal como especifica CommonMark
- Código en línea (`)
- URLs de enlaces
- Rutas de imágenes
- Etiquetas HTML
- Frontmatter — tanto YAML (`---`) como TOML (`+++`)
- Matemáticas en línea (`$…$`), detectadas con la misma regla que usa el renderizador de VMark, de modo que un par de importes como `价格是 $100 和 $200 元` *no* se confunde con matemáticas
- Matemáticas en bloque (`$$…$$`)
- Bloques de código con sangría
- Enlaces wiki (`[[target]]`, `[[target|display]]`)
- Marcadores de notas al pie — referencias como `[^1]` y la etiqueta `[^1]:` de una definición (el texto propio de la definición sí se formatea)
- Referencias de caracteres HTML (`&amp;`, `&#x5176;`)
- Separadores temáticos (`---`, `***`)
- Puntuación escapada con barra invertida (por ejemplo, `\,` permanece como `,`)

### Construcciones Técnicas

El **Escáner de Segmentos Latinos** de VMark detecta y protege automáticamente las construcciones técnicas de la conversión de puntuación:

| Tipo | Ejemplos | Protección |
|------|----------|------------|
| URLs | `https://example.com` | Toda la puntuación se conserva |
| Correos | `user@example.com` | @ y . se conservan |
| Versiones | `v1.2.3`, `1.2.3.4` | Los puntos se conservan |
| Decimales | `3.14`, `0.5` | El punto se conserva |
| Horas | `12:30`, `1:30:00` | Los dos puntos se conservan |
| Millares | `1,000`, `1,000,000` | Las comas se conservan |
| Dominios | `example.com` | El punto se conserva |

Ejemplo:

| Antes | Después |
|-------|---------|
| 版本v1.2.3发布 | 版本 v1.2.3 发布 |
| 访问https://example.com获取 | 访问 https://example.com 获取 |
| 温度是3.14度 | 温度是 3.14 度 |

### Escapes con Barra Invertida

Añade `\` antes de cualquier signo de puntuación para evitar la conversión:

| Entrada | Salida |
|---------|--------|
| `价格\,很贵` | 价格,很贵 (la coma permanece en medio ancho) |
| `测试\.内容` | 测试.内容 (el punto permanece en medio ancho) |

---

## Formateo Asistido por IA

Cuando el [servidor MCP](/es/guide/mcp-setup) está conectado, los asistentes de IA pueden aplicar el formateo CJK de forma programática a través de la herramienta `document.transform` con uno de tres valores de `kind`:

- `"cjk-format"` — normalización CJK completa (espaciado + puntuación + comillas tipográficas), el mismo formateador que ejecuta el comando del menú, siguiendo tu configuración en Ajustes → Idioma
- `"cjk-spacing"` — inserta un espacio dondequiera que un carácter CJK se encuentre con una letra latina o un dígito, y nada más
- `"cjk-punctuation"` — convierte `,` `.` `!` `?` `;` `:` `(` `)` de medio ancho junto a un carácter CJK en su forma de ancho completo; nunca convierte de ancho completo a medio ancho

Solo `cjk-format` lee tu configuración de formato. `cjk-spacing` y `cjk-punctuation` son reglas fijas que la ignoran y, a diferencia del formateador, también tratan el hangul coreano como CJK. Las tres trabajan sobre el código fuente markdown del documento y dejan intacto el [contenido protegido](#contenido-protegido).

Consulta la [Referencia de Herramientas MCP](/es/guide/mcp-tools#transform) para la forma completa de la solicitud — `document.transform` toma `tabId`, `kind` y un `expected_revision` para concurrencia optimista.

## Configuración

Las opciones de formato CJK se pueden configurar en Ajustes → Idioma:

- Activar/desactivar reglas específicas
- Establecer el límite de repetición de puntuación
- Elegir el estilo de comillas (estándar o corchetes angulares)

### Comillas Contextuales

Cuando las **Comillas contextuales** están activadas (predeterminado):

- Las comillas alrededor de contenido CJK → comillas curvas `""`
- Las comillas alrededor de contenido puramente latino → comillas rectas `""`

Esto preserva la apariencia natural del texto en inglés mientras formatea correctamente el contenido CJK.

### Corchetes Angulares CJK *(desactivados por defecto)*

Cuando las **Comillas angulares CJK** están activadas, las comillas curvas alrededor de contenido CJK se convierten en corchetes angulares (`「」` para el primario, `『』` para el anidado) — la forma de comillas tradicional tipográficamente para la composición CJK vertical. El contenido latino mantiene las comillas curvas estándar independientemente de esta configuración.

### Omisión de la Sección de Referencias

Cuando **Omitir secciones de referencia** está activado en Ajustes → Idioma → Manejo de secciones (desactivado por defecto), el formateador CJK detecta los encabezados "References" / "Further Reading" / "参考文献" / "参考资料" / "Bibliography" y omite el reformateo en esas secciones — el texto con formato de citación a menudo depende de una puntuación específica que las reglas CJK normalizarían. Actívalo para documentos académicos; déjalo desactivado para formatear el archivo completo.

### Verificación de Integridad

Después de cada pasada de formato CJK, el formateador compara el **esqueleto de contenido** del documento antes y después: el texto sin espacios ni puntuación y con el ancho de carácter normalizado. Todas las reglas de formato cambian únicamente espacios, puntuación o el ancho de un alfanumérico, así que ese esqueleto debe volver idéntico — y, al ser una secuencia y no un recuento, también detecta contenido reordenado. Cuentan las letras, los dígitos, los ideogramas, el kana, el hangul y los emoji.

Si la comprobación falla, el documento queda **completamente sin modificar** y una notificación te lo indica. Un rechazo nunca es silencioso, y nunca se confunde con «no había nada que cambiar».

---

## Espaciado de Caracteres CJK

VMark incluye una función dedicada de espaciado de caracteres para texto CJK que mejora la legibilidad añadiendo un espaciado sutil entre caracteres.

### Configuración

Configúralo en **Ajustes → Editor → Tipografía → Espaciado de letras CJK**:

| Opción | Valor | Descripción |
|--------|-------|-------------|
| Desactivado | 0 | Sin espaciado (predeterminado) |
| Sutil | 0.02em | Espaciado apenas perceptible |
| Ligero | 0.03em | Espaciado ligero |
| Normal | 0.05em | Recomendado para la mayoría de los casos |
| Amplio | 0.08em | Espaciado más pronunciado |
| Más amplio | 0.10em | Aún más amplio, para tamaños de visualización grandes |
| Extra | 0.12em | El ajuste más amplio |

### Cómo Funciona

- Aplica CSS de `letter-spacing` a segmentos de caracteres CJK
- Excluye bloques de código y código en línea
- Funciona tanto en el modo WYSIWYG como en el HTML exportado
- Sin efecto sobre texto latino ni números

### Ejemplo

Sin espaciado de caracteres:
> 这是一段中文文字，没有任何字间距。

Con espaciado de 0.05em:
> 这 是 一 段 中 文 文 字 ， 有 轻 微 的 字 间 距 。

La diferencia es sutil pero mejora la legibilidad, especialmente en pasajes más largos.

---

## Estilos de Comillas Tipográficas

VMark puede convertir automáticamente las comillas rectas en comillas tipográficamente correctas. Esta función opera durante el formato CJK y admite múltiples estilos de comillas.

### Estilos de Comillas

| Estilo | Comillas Dobles | Comillas Simples |
|--------|-----------------|------------------|
| Curvas | "texto" | 'texto' |
| Corchetes Angulares | 「texto」 | 『texto』 |
| Comillas Angulares | «texto» | ‹texto› |

### Algoritmo de Emparejamiento Basado en Pila

VMark usa un sofisticado algoritmo basado en pila para el emparejamiento de comillas:

1. **Tokenización**: Identifica todos los caracteres de comillas en el texto
2. **Clasificación**: Determina si cada comilla es de apertura o cierre según el contexto
3. **Detección de Apóstrofos**: Reconoce contracciones (don't, it's) y las conserva
4. **Detección de Primos**: Reconoce medidas (5'10") y las conserva
5. **Detección de Contexto CJK**: Comprueba si el contenido entre comillas involucra caracteres CJK
6. **Limpieza de Huérfanos**: Gestiona correctamente las comillas sin pareja; una comilla que sigue abierta al final de un párrafo queda sin pareja, así que las comillas nunca se emparejan a través de una línea en blanco

### Ejemplos

| Antes | Después (Curvas) |
|-------|-----------------|
| "hello" | "hello" |
| 'world' | 'world' |
| it's | it's |
| don't | don't |
| 5'10" | 5'10" |
| '90s | '90s |

Los apóstrofos en contracciones (como "it's" o "don't") se conservan correctamente.

### Alternar Estilo de Comillas en el Cursor

Puedes cambiar rápidamente el estilo de comillas de las comillas existentes sin reformatear todo el documento. Coloca el cursor dentro de cualquier par de comillas y presiona `Shift + Mod + '` para alternar. Esto solo funciona en modo WYSIWYG; el modo Fuente no tiene alternancia de comillas.

**Modo simple** (predeterminado): Alterna entre comillas rectas y tu estilo preferido.

| Antes | Después | Siguiente |
|-------|---------|-----------|
| "hello" | "hello" | "hello" |
| 'world' | 'world' | 'world' |

**Modo ciclo completo**: Recorre los cuatro estilos.

| Paso | Dobles | Simples |
|------|--------|---------|
| 1 | "texto" | 'texto' |
| 2 | "texto" | 'texto' |
| 3 | 「texto」 | 『texto』 |
| 4 | «texto» | ‹texto› |
| 5 | "texto" (vuelve al inicio) | 'texto' |

**Comillas anidadas**: Cuando las comillas están anidadas, el comando alterna el par **más interno** que encierra el cursor.

**Detección inteligente**: Los apóstrofos (`don't`), los primos (`5'10"`) y las abreviaciones de décadas (`'90s`) nunca se tratan como pares de comillas.

::: tip
Cambia entre el modo simple y el modo ciclo completo en Ajustes → Idioma → Formato CJK → Comportamiento de alternancia de comillas.
:::

### Configuración

Activa la conversión de comillas tipográficas (**Convertir comillas rectas**) en Ajustes → Idioma → Formato CJK. También puedes seleccionar tu estilo de comillas preferido en el menú desplegable.

---

## Conversión de Corchetes Angulares CJK

Cuando las **Comillas angulares CJK** están activadas, las comillas curvas alrededor de contenido CJK se convierten automáticamente en corchetes angulares.

### Caracteres Admitidos

La conversión a corchetes angulares se activa cuando el contenido entre comillas — o
el texto inmediatamente contiguo — es han, hiragana, katakana o bopomofo:

| Tipo de Contenido | Ejemplo | ¿Convierte? |
|-------------------|---------|-------------|
| Chino | `"中文"` | ✓ `「中文」` |
| Japonés con Kanji | `"日本語"` | ✓ `「日本語」` |
| Solo Hiragana | `"ひらがな"` | ✓ `「ひらがな」` |
| Solo Katakana | `"カタカナ"` | ✓ `「カタカナ」` |
| Coreano | `"한글"` | ✗ permanece como `"한글"` |
| Inglés | `"hello"` | ✗ permanece como `"hello"` |

El coreano queda excluido por el mismo motivo que en las reglas de espaciado: el
coreano usa `“ ”`, no corchetes angulares.

---

## Párrafo de Prueba

Copia este texto sin formato en VMark y presiona `Alt + Mod + Shift + F` para formatearlo:

```text
最近我在学习TypeScript和React,感觉收获很大.作为一个developer,掌握这些modern前端技术是必须的.

目前已经完成了３个projects,代码量超过１０００行.其中最复杂的是一个dashboard应用,包含了数据可视化,用户认证,还有API集成等功能.

学习过程中遇到的最大挑战是--状态管理.Redux的概念. . .说实话有点难理解.后来换成了Zustand,简单多了!

老师说"don't give up"然后继续讲"写代码要注重可读性",我觉得很有道理.

访问https://example.com/docs获取v2.0.0版本文档,价格$99.99,时间12:30开始.

项目使用的技术栈如下:

- **Frontend**--React + TypeScript
- **Backend**--Node.js + Express
- **Database**--PostgreSQL

总共花费大约$２００美元购买了学习资源,包括书籍和online courses.虽然价格不便宜,但非常值得.
```

### Resultado Esperado

Después del formato, el texto tendrá este aspecto:

---

最近我在学习 TypeScript 和 React，感觉收获很大。作为一个 developer，掌握这些 modern 前端技术是必须的。

目前已经完成了 3 个 projects，代码量超过 1000 行。其中最复杂的是一个 dashboard 应用，包含了数据可视化，用户认证，还有 API 集成等功能。

学习过程中遇到的最大挑战是 —— 状态管理。Redux 的概念……说实话有点难理解。后来换成了 Zustand，简单多了！

老师说 “don't give up” 然后继续讲 “写代码要注重可读性”，我觉得很有道理。

访问 https://example.com/docs 获取 v2.0.0 版本文档，价格 $99.99，时间 12:30 开始。

项目使用的技术栈如下：

- **Frontend**--React + TypeScript
- **Backend**--Node.js + Express
- **Database**--PostgreSQL

总共花费大约 $200 美元购买了学习资源，包括书籍和 online courses。虽然价格不便宜，但非常值得。

---

**Cambios aplicados:**
- Espaciado CJK-Latino añadido (学习 TypeScript)
- Puntuación de ancho completo convertida (，。！)
- Números de ancho completo normalizados (３→3, １０００→1000, ２００→200)
- Guiones dobles convertidos en rayas largas (是--状态 → 是 —— 状态)
- Puntos suspensivos normalizados a la forma china, sin espacio después (. . . → ……)
- Comillas tipográficas aplicadas con espacio junto al texto CJK, apóstrofo conservado (don't)
- Construcciones técnicas protegidas (https://example.com/docs, v2.0.0, $99.99, 12:30)

**Y lo que _no_ cambia:** el `--` de `**Frontend**--React` se queda como guion
doble. La conversión de guiones necesita un carácter CJK o un alfanumérico
inmediatamente junto a los guiones, y `*` no es ninguna de las dos cosas. Activarla
con los marcadores de énfasis convertiría el `--` de cada elemento de lista
puramente en inglés de un documento chino, lo que es peor que dejar estos tres tal
cual.
