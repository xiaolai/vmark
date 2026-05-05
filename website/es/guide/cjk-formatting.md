# Guía de Formato CJK

VMark incluye un conjunto completo de reglas de formato para texto en chino, japonés y coreano. Estas herramientas ayudan a mantener una tipografía coherente al mezclar caracteres CJK y latinos.

## Inicio Rápido

Usa **Formato → Formatear Documento CJK** o presiona `Alt + Mod + Shift + F` para formatear el documento completo.

Para formatear solo una selección, usa `Mod + Shift + F`.

---

## Reglas de Formato

### 1. Espaciado CJK-Latino

Añade automáticamente espacios entre caracteres CJK y caracteres/números latinos.

| Antes | Después |
|-------|---------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |

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

Convierte paréntesis de medio ancho a ancho completo cuando rodean contenido CJK.

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
| 他说"hello" | 他说 "hello" |
| "don't worry" | "don't worry" |
| 5'10" tall | 5'10" tall |

Con la opción de corchetes angulares activada:

| Antes | Después |
|-------|---------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Normalización de Puntos Suspensivos

Estandariza el formato de los puntos suspensivos.

| Antes | Después |
|-------|---------|
| 等等. . . | 等等... |
| 然后. . .继续 | 然后... 继续 |

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
- Espaciado de moneda: `$ 100` → `$100`

---

## Contenido Protegido

El siguiente contenido **no** se ve afectado por el formato:

- Bloques de código (```)
- Código en línea (`)
- URLs de enlaces
- Rutas de imágenes
- Etiquetas HTML
- Frontmatter YAML
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

- `"cjk-format"` — normalización CJK completa (espaciado + puntuación + comillas tipográficas según tu configuración)
- `"cjk-spacing"` — ajusta solo el espaciado en blanco alrededor de los límites CJK ↔ Latín/dígitos
- `"cjk-punctuation"` — convierte la puntuación entre ancho completo y medio ancho según las reglas

Cada transformación ejecuta el documento activo a través de un viaje de ida y vuelta de serialización-formato-análisis para preservar las marcas en línea (negrita, enlaces, matemáticas, etc.) y respetar tus reglas de formato configuradas.

Consulta la [Referencia de Herramientas MCP](/es/guide/mcp-tools#document-tool) para la forma completa de la solicitud — `document.transform` toma `tabId`, `kind` y un `expected_revision` para concurrencia optimista.

## Configuración

Las opciones de formato CJK se pueden configurar en Configuración → Idioma:

- Activar/desactivar reglas específicas
- Establecer el límite de repetición de puntuación
- Elegir el estilo de comillas (estándar o corchetes angulares)

### Comillas Contextuales

Cuando las **Comillas Contextuales** están activadas (predeterminado):

- Las comillas alrededor de contenido CJK → comillas curvas `""`
- Las comillas alrededor de contenido puramente latino → comillas rectas `""`

Esto preserva la apariencia natural del texto en inglés mientras formatea correctamente el contenido CJK.

### Corchetes Angulares CJK *(desactivados por defecto)*

Cuando los **Corchetes Angulares CJK** están activados, las comillas curvas alrededor de contenido CJK se convierten en corchetes angulares (`「」` para el primario, `『』` para el anidado) — la forma de comillas tradicional tipográficamente para la composición CJK vertical. El contenido latino mantiene las comillas curvas estándar independientemente de esta configuración.

### Omisión de la Sección de Referencias

El formateador CJK detecta los encabezados "References" / "参考文献" / "参考资料" / "Bibliography" y omite el reformateo en esas secciones — el texto con formato de citación a menudo depende de una puntuación específica que las reglas CJK normalizarían.

### Verificación de Integridad

Después de cada pasada de formato CJK, el formateador ejecuta una comprobación de integridad que compara el contenido visible del texto (ignorando las transformaciones de espacios en blanco/puntuación) antes y después. Si la comprobación falla, la operación se revierte y aparece un diagnóstico — garantiza que el formato CJK nunca pierda contenido en silencio.

---

## Espaciado de Caracteres CJK

VMark incluye una función dedicada de espaciado de caracteres para texto CJK que mejora la legibilidad añadiendo un espaciado sutil entre caracteres.

### Configuración

Configúralo en **Configuración → Editor → Tipografía → Espaciado de Caracteres CJK**:

| Opción | Valor | Descripción |
|--------|-------|-------------|
| Desactivado | 0 | Sin espaciado (predeterminado) |
| Sutil | 0.02em | Espaciado apenas perceptible |
| Ligero | 0.03em | Espaciado ligero |
| Normal | 0.05em | Recomendado para la mayoría de los casos |
| Amplio | 0.08em | Espaciado más pronunciado |

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
6. **Limpieza de Huérfanos**: Gestiona correctamente las comillas sin pareja

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

Puedes cambiar rápidamente el estilo de comillas de las comillas existentes sin reformatear todo el documento. Coloca el cursor dentro de cualquier par de comillas y presiona `Shift + Mod + '` para alternar.

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
Cambia entre el modo simple y el modo ciclo completo en Configuración → Idioma → Formato CJK → Modo de Alternancia de Comillas.
:::

### Configuración

Activa la Conversión de Comillas Tipográficas en Configuración → Idioma → Formato CJK. También puedes seleccionar tu estilo de comillas preferido en el menú desplegable.

---

## Conversión de Corchetes Angulares CJK

Cuando los **Corchetes Angulares CJK** están activados, las comillas curvas alrededor de contenido CJK se convierten automáticamente en corchetes angulares.

### Caracteres Admitidos

La conversión a corchetes angulares se activa cuando el contenido entre comillas contiene **caracteres chinos** (Ideogramas Unificados CJK U+4E00–U+9FFF):

| Tipo de Contenido | Ejemplo | ¿Convierte? |
|-------------------|---------|-------------|
| Chino | `"中文"` | ✓ `「中文」` |
| Japonés con Kanji | `"日本語"` | ✓ `「日本語」` |
| Solo Hiragana | `"ひらがな"` | ✗ permanece como `"ひらがな"` |
| Solo Katakana | `"カタカナ"` | ✗ permanece como `"カタカナ"` |
| Coreano | `"한글"` | ✗ permanece como `"한글"` |
| Inglés | `"hello"` | ✗ permanece como `"hello"` |

**Consejo:** Para texto japonés solo con Kana, usa manualmente los corchetes angulares `「」` o incluye al menos un carácter Kanji.

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

学习过程中遇到的最大挑战是 —— 状态管理。Redux 的概念... 说实话有点难理解。后来换成了 Zustand，简单多了！

老师说 "don't give up" 然后继续讲 "写代码要注重可读性"，我觉得很有道理。

访问 https://example.com/docs 获取 v2.0.0 版本文档，价格 $99.99，时间 12:30 开始。

项目使用的技术栈如下：

- **Frontend** —— React + TypeScript
- **Backend** —— Node.js + Express
- **Database** —— PostgreSQL

总共花费大约 $200 美元购买了学习资源，包括书籍和 online courses。虽然价格不便宜，但非常值得。

---

**Cambios aplicados:**
- Espaciado CJK-Latino añadido (学习 TypeScript)
- Puntuación de ancho completo convertida (，。！)
- Números de ancho completo normalizados (３→3, １０００→1000, ２００→200)
- Guiones dobles convertidos en rayas largas (-- → ——)
- Puntos suspensivos normalizados (. . . → ...)
- Comillas tipográficas aplicadas, apóstrofo conservado (don't)
- Construcciones técnicas protegidas (https://example.com/docs, v2.0.0, $99.99, 12:30)
