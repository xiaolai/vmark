# Lint de Markdown

VMark incluye un motor de lint integrado que detecta **problemas de corrección**, no preferencias de estilo. El lint se ejecuta a petición (Cmd-Shift-L o **Herramientas → Comprobar Markdown**) y muestra los resultados en línea como subrayados ondulados en el margen, con una insignia en la barra de estado y navegación con F2 entre los hallazgos.

## Qué es y qué no es el lint

El lint de VMark es un comprobador de **corrección**:

- Referencias cruzadas rotas
- Referencias indefinidas de enlaces / notas al pie
- Bloques de código sin cerrar
- Tablas con número de columnas no coincidente
- Niveles de encabezado que se saltan (h1 → h3)
- Imágenes sin texto alternativo
- Texto de enlace vacío o `href` vacío

El lint de VMark **no** es un comprobador de estilo. No marcará:

- Longitud de línea
- Estilo de marcador de lista (`-` vs `*`)
- Estilo de marcador de énfasis (`_` vs `*`)
- Estilo de encabezado (`#` vs subrayado)
- Espacios en blanco al final

Para la aplicación de estilo, usa una herramienta independiente como `prettier --check` fuera de VMark.

## Referencia de Reglas

| ID de regla | Severidad | Descripción |
|---------|----------|-------------|
| **E01** | Error | Referencia indefinida: `[link][missing]` apunta a una definición que no existe |
| **E02** | Error | Una fila de tabla tiene un número de columnas incorrecto (no coincide con la fila de encabezado) |
| **E03** | Error | Enlace invertido — parece `(text)[url]` en lugar de `[text](url)` |
| **E04** | Error | Encabezado ATX sin espacio después de `#` (por ejemplo, `##Heading` debería ser `## Heading`) |
| **E05** | Error | Espacio dentro de los marcadores de énfasis — `* word *` no se renderizará en cursiva |
| **E06** | Error | Bloque de código delimitado sin cerrar — el archivo termina con un delimitador ```` ``` ```` abierto |
| **E07** | Error | Definición duplicada de referencia de enlace (la misma `[label]:` aparece dos veces) |
| **E08** | Error | `href` de enlace vacío — `[text]()` |
| **W01** | Advertencia | Nivel de encabezado saltado (se esperaba h2, se encontró h3) |
| **W02** | Advertencia | Imagen sin texto alternativo — accesibilidad |
| **W03** | Advertencia | Definición de referencia de enlace sin usar (definida pero nunca enlazada) |
| **W04** | Advertencia | El fragmento de ancla no coincide con ningún encabezado — `#section` para una sección que no existe |
| **W05** | Advertencia | Texto de enlace vacío — `[](url)` |
| **M001** | Error | Archivo de imagen no encontrado en la ruta local |
| **M002** | Error | Archivo enlazado no encontrado en la ruta local |
| **Y001** | Error | Error de análisis YAML (para archivos YAML) |
| **Y002** | Advertencia | Advertencia de análisis YAML (para archivos YAML) |

## Activar el lint

| Activador | Acción |
|---|---|
| `Cmd + Shift + L` (macOS) / `Ctrl + Shift + L` (Win/Linux) | Ejecuta el lint en el documento activo |
| **Herramientas → Comprobar Markdown** | Igual que el atajo |
| `F2` | Saltar al siguiente diagnóstico |
| `Shift + F2` | Saltar al diagnóstico anterior |

Para los archivos markdown con rutas de archivo, la comprobación de existencia de enlaces se ejecuta automáticamente junto a las reglas síncronas — consulta [Comprobación de Enlaces](/es/guide/link-check).

Para los archivos YAML, los errores de análisis aparecen en vivo en el margen mientras escribes, y el mismo atajo `Cmd-Shift-L` rellena la insignia y la navegación con F2.

## Configuración

El motor de lint tiene un único conmutador visible para el usuario:

- **Configuración → Markdown → Habilitar lint de markdown** — activa o desactiva el motor por completo

Cuando está desactivado, el atajo no realiza ninguna acción y no aparecen diagnósticos en el margen.

## Ver también

- [Comprobación de Enlaces](/es/guide/link-check) — detección de enlaces / imágenes locales rotos
- [Configuración → Markdown → Lint](/es/guide/settings#lint)
