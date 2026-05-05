# Mapas Mentales con Markmap

VMark soporta [Markmap](https://markmap.js.org/) para crear árboles de mapas mentales interactivos directamente en tus documentos Markdown. A diferencia del tipo de diagrama de mapa mental estático de Mermaid, Markmap usa encabezados Markdown simples como entrada y proporciona panorámica, zoom y colapso interactivos.

## Insertar un Mapa Mental

### Usando el Menú

**Menú:** Insertar > Mapa Mental

**Atajo de teclado:** `Alt + Shift + Cmd + K` (macOS) / `Alt + Shift + Ctrl + K` (Windows/Linux)

### Usando un Bloque de Código

Escribe un bloque de código delimitado con el identificador de lenguaje `markmap`:

````markdown
```markmap
# Mindmap

## Branch A
### Topic 1
### Topic 2

## Branch B
### Topic 3
### Topic 4
```text
````

### Usando la Herramienta MCP

Usa la herramienta MCP `media` con `action: "markmap"` y el parámetro `code` que contiene los encabezados Markdown.

## Modos de Edición

### Modo Texto Enriquecido (WYSIWYG)

En el modo WYSIWYG, los mapas mentales Markmap se renderizan como árboles SVG interactivos. Puedes:

- **Hacer panorámica** desplazando o haciendo clic y arrastrando
- **Hacer zoom** manteniendo `Cmd`/`Ctrl` y desplazando
- **Colapsar/expandir** nodos haciendo clic en el círculo en cada rama
- **Ajustar** la vista usando el botón de ajuste (esquina superior derecha al pasar el ratón)
- **Doble clic** en el mapa mental para editar el código fuente

### Modo Fuente con Vista Previa en Vivo

En el modo Fuente, aparece un panel de vista previa flotante cuando el cursor está dentro de un bloque de código markmap, actualizándose a medida que escribes.

## Formato de Entrada

Markmap usa Markdown estándar como entrada. Los encabezados definen la jerarquía del árbol:

| Markdown | Función |
|----------|---------|
| `# Heading 1` | Nodo raíz |
| `## Heading 2` | Rama de primer nivel |
| `### Heading 3` | Rama de segundo nivel |
| `#### Heading 4+` | Ramas más profundas |

### Contenido Enriquecido en los Nodos

Los nodos pueden contener Markdown en línea:

````markdown
```markmap
# Project Plan

## Research
### Read **important** papers
### Review [existing tools](https://example.com)

## Implementation
### Write `core` module
### Add tests
- Unit tests
- Integration tests

## Documentation
### API reference
### User guide
```text
````

Los elementos de lista bajo un encabezado se convierten en nodos hijos de ese encabezado.

### Demostración en vivo

Aquí hay un markmap interactivo renderizado directamente en esta página — prueba a hacer pan, zoom y colapsar nodos:

```markmap
# VMark Features

## Editor
### WYSIWYG Mode
### Source Mode
### Focus Mode
### Typewriter Mode

## AI Integration
### MCP Server
### AI Genies
### Smart Paste

## Markdown
### Mermaid Diagrams
### Markmap Mindmaps
### LaTeX Math
### Code Blocks
- Syntax highlighting
- Line numbers

## Platform
### macOS
### Windows
### Linux
```

## Funciones Interactivas

| Acción | Cómo |
|--------|------|
| **Panorámica** | Desplazar o hacer clic y arrastrar |
| **Zoom** | `Cmd`/`Ctrl` + desplazar |
| **Colapsar nodo** | Hacer clic en el círculo en un punto de rama |
| **Expandir nodo** | Hacer clic en el círculo de nuevo |
| **Ajustar a la vista** | Hacer clic en el botón de ajuste (arriba a la derecha al pasar el ratón) |

## Integración de Temas

Los mapas mentales Markmap se adaptan automáticamente al tema actual de VMark (White, Paper, Mint, Sepia o Night). Los colores de las ramas se ajustan para facilitar la lectura en todos los temas.

## Exportar como PNG

Pasa el ratón sobre un mapa mental renderizado en el modo WYSIWYG para mostrar un botón de **exportar**. Haz clic en él para elegir un tema:

| Tema | Fondo |
|------|-------|
| **Claro** | Fondo blanco |
| **Oscuro** | Fondo oscuro |

El mapa mental se exporta como PNG de resolución 2x a través del cuadro de diálogo de guardado del sistema.

## Consejos

### Markmap vs Mapa Mental de Mermaid

VMark admite tanto Markmap como el tipo de diagrama `mindmap` de Mermaid:

| Función | Markmap | Mapa Mental de Mermaid |
|---------|---------|------------------------|
| Formato de entrada | Markdown estándar | DSL de Mermaid |
| Interactividad | Panorámica, zoom, colapso | Imagen estática |
| Contenido enriquecido | Enlaces, negrita, código, listas | Solo texto |
| Mejor para | Árboles grandes e interactivos | Diagramas estáticos simples |

Usa **Markmap** cuando quieras interactividad o ya tengas contenido Markdown. Usa el **mapa mental de Mermaid** cuando lo necesites junto con otros diagramas Mermaid.

### Más Información

- **[Documentación de Markmap](https://markmap.js.org/)** — Referencia oficial
- **[Playground de Markmap](https://markmap.js.org/repl)** — Playground interactivo para probar mapas mentales
