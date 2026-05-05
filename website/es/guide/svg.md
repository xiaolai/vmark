# Gráficos SVG

VMark proporciona soporte de primera clase para SVG — Scalable Vector Graphics (Gráficos Vectoriales Escalables). Hay dos formas de usar SVG en tus documentos, cada una adecuada para un flujo de trabajo diferente.

| Método | Mejor Para | ¿Fuente Editable? |
|--------|------------|-------------------|
| [Imagen incrustada](#embedding-svg-as-an-image) (`![](file.svg)`) | Archivos SVG estáticos en disco | No |
| [Bloque de código](#svg-code-blocks) (` ```svg `) | SVG en línea, gráficos generados por IA | Sí |

## Incrustar SVG como Imagen {#embedding-svg-as-an-image}

Usa la sintaxis estándar de imagen Markdown para incrustar un archivo SVG:

```markdown
![Architecture diagram](./assets/architecture.svg)
```

Funciona exactamente como las imágenes PNG o JPEG — arrastra y suelta, pega o inserta a través de la barra de herramientas. Los archivos SVG se reconocen como imágenes y se renderizan en línea.

**Cuándo usar esto:** Tienes un archivo `.svg` (de Figma, Illustrator, Inkscape o una herramienta de diseño) y quieres mostrarlo en tu documento.

**Limitaciones:** El SVG se renderiza como una imagen estática. No puedes editar el código fuente SVG en línea, y no aparecen controles de panorámica, zoom ni exportación.

## Bloques de Código SVG {#svg-code-blocks}

Envuelve el marcado SVG sin procesar en un bloque de código delimitado con el identificador de lenguaje `svg`:

````markdown
```svg
<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="100" rx="10" fill="#4a6fa5"/>
  <text x="100" y="55" text-anchor="middle" fill="white"
        font-size="18" font-family="system-ui">Hello SVG</text>
</svg>
```text
````

El SVG se renderiza en línea — igual que los diagramas Mermaid — con controles interactivos.

::: tip Exclusivo de VMark
Ni Typora ni Obsidian soportan bloques de código ` ```svg `. Esta es una función exclusiva de VMark, diseñada para flujos de trabajo con IA donde las herramientas generan visualizaciones SVG (gráficos, ilustraciones, iconos) que no se ajustan a la gramática de Mermaid.
:::

### Cuándo Usar Bloques de Código

- **Gráficos generados por IA** — Claude, ChatGPT y otras herramientas de IA pueden generar gráficos, diagramas e ilustraciones SVG directamente. Pega el SVG en un bloque de código para renderizarlo en línea.
- **Creación de SVG en línea** — Edita el código fuente SVG directamente en tu documento y ve los resultados en vivo.
- **Documentos autocontenidos** — El SVG vive dentro del archivo Markdown, sin dependencia de archivos externos.

## Editar en Modo WYSIWYG

En el modo Texto Enriquecido, los bloques de código SVG se renderizan en línea automáticamente.

### Entrar en Modo de Edición

Haz doble clic en un SVG renderizado para abrir el editor de código fuente. Aparece un encabezado de edición con:

| Botón | Acción |
|-------|--------|
| **Copiar** | Copia el código fuente SVG al portapapeles |
| **Cancelar** (X) | Revierte los cambios y sale (también `Esc`) |
| **Guardar** (marca de verificación) | Aplica los cambios y sale |

Una **vista previa en vivo** debajo del editor se actualiza mientras escribes, para que puedas ver tus cambios en tiempo real.

### Panorámica y Zoom

Pasa el ratón sobre un SVG renderizado para mostrar los controles interactivos:

| Acción | Cómo |
|--------|------|
| **Zoom** | Mantén `Cmd` (macOS) o `Ctrl` (Windows/Linux) y desplaza |
| **Panorámica** | Haz clic y arrastra el SVG |
| **Restablecer** | Haz clic en el botón de restablecimiento (esquina superior derecha) |

Estos son los mismos controles de panorámica y zoom que se usan para los diagramas Mermaid.

### Exportar como PNG

Pasa el ratón sobre un SVG renderizado para mostrar el botón de **exportar** (arriba a la derecha, junto al botón de restablecimiento). Haz clic en él para elegir un tema de fondo:

| Tema | Fondo |
|------|-------|
| **Claro** | Blanco (`#ffffff`) |
| **Oscuro** | Oscuro (`#1e1e1e`) |

El SVG se exporta como PNG de resolución 2x a través del cuadro de diálogo de guardado del sistema.

## Vista Previa en Modo Fuente

En el modo Fuente, cuando el cursor está dentro de un bloque de código ` ```svg `, aparece un panel de vista previa flotante — el mismo panel usado para los diagramas Mermaid.

| Función | Descripción |
|---------|-------------|
| **Vista previa en vivo** | Se actualiza inmediatamente mientras escribes (sin debounce — el renderizado SVG es instantáneo) |
| **Arrastrar para mover** | Arrastra el encabezado para reposicionar |
| **Redimensionar** | Arrastra cualquier borde o esquina |
| **Zoom** | Botones `−` y `+`, o `Cmd/Ctrl` + desplazar (10% a 300%) |

::: info
La vista previa de diagrama en modo Fuente debe estar habilitada. Actívala con el botón **Vista Previa de Diagrama** en la barra de estado.
:::

## Validación SVG

VMark valida el contenido SVG antes de renderizarlo:

- El contenido debe comenzar con `<svg` o `<?xml`
- El XML debe estar bien formado (sin errores de análisis)
- El elemento raíz debe ser `<svg>`

Si la validación falla, se muestra un mensaje de error **SVG No Válido** en lugar del gráfico renderizado. Haz doble clic en el error para editar y corregir el código fuente.

## Flujo de Trabajo con IA

Los asistentes de programación con IA pueden generar SVG directamente en tus documentos de VMark a través de las herramientas MCP. La IA envía un bloque de código con `language: "svg"` y el contenido SVG, que se renderiza en línea automáticamente.

**Prompt de ejemplo:**

> Crea un gráfico de barras que muestre los ingresos trimestrales: Q1 $2.1M, Q2 $2.8M, Q3 $3.2M, Q4 $3.9M

La IA genera un gráfico de barras SVG que se renderiza en línea en tu documento, con panorámica, zoom y exportación PNG disponibles inmediatamente.

## Comparación: Bloque de Código SVG vs Mermaid

| Función | ` ```svg ` | ` ```mermaid ` |
|---------|-----------|---------------|
| Entrada | Marcado SVG sin procesar | DSL de Mermaid |
| Renderizado | Instantáneo (síncrono) | Asíncrono (debounce de 200ms) |
| Panorámica + Zoom | Sí | Sí |
| Exportación PNG | Sí | Sí |
| Vista previa en vivo | Sí | Sí |
| Adaptación de tema | No (usa los colores propios del SVG) | Sí (se adapta a todos los temas) |
| Mejor para | Gráficos personalizados, visuales generados por IA | Diagramas de flujo, diagramas de secuencia, diagramas estructurados |

## Consejos

### Seguridad

VMark sanea el contenido SVG antes de renderizarlo. Las etiquetas de script y los atributos de controladores de eventos (`onclick`, `onerror`, etc.) se eliminan. Esto protege contra XSS al pegar SVG de fuentes no confiables.

### Tamaño

Si tu SVG no incluye atributos explícitos `width`/`height`, añade un `viewBox` para controlar su relación de aspecto:

```xml
<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
  <!-- content -->
</svg>
```

### Calidad de Exportación

La exportación PNG usa resolución 2x para una visualización nítida en pantallas Retina. Se añade automáticamente un color de fondo sólido (el propio SVG puede tener un fondo transparente).
