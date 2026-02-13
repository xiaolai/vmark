# SVG Graphics

VMark provides first-class support for SVG — Scalable Vector Graphics. There are two ways to use SVG in your documents, each suited to a different workflow.

| Method | Best For | Editable Source? |
|--------|----------|-----------------|
| [Image embed](#embedding-svg-as-an-image) (`![](file.svg)`) | Static SVG files on disk | No |
| [Code block](#svg-code-blocks) (` ```svg `) | Inline SVG, AI-generated graphics | Yes |

## Embedding SVG as an Image

Use standard Markdown image syntax to embed an SVG file:

```markdown
![Architecture diagram](./assets/architecture.svg)
```

This works exactly like PNG or JPEG images — drag and drop, paste, or insert via the toolbar. SVG files are recognized as images and rendered inline.

**When to use this:** You have an `.svg` file (from Figma, Illustrator, Inkscape, or a design tool) and want to display it in your document.

**Limitations:** The SVG renders as a static image. You cannot edit the SVG source inline, and no pan+zoom or export controls appear.

## SVG Code Blocks

Wrap raw SVG markup in a fenced code block with the `svg` language identifier:

````markdown
```svg
<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="100" rx="10" fill="#4a6fa5"/>
  <text x="100" y="55" text-anchor="middle" fill="white"
        font-size="18" font-family="system-ui">Hello SVG</text>
</svg>
```
````

The SVG renders inline — just like Mermaid diagrams — with interactive controls.

::: tip Unique to VMark
Neither Typora nor Obsidian support ` ```svg ` code blocks. This is a VMark-exclusive feature, designed for AI workflows where tools generate SVG visualizations (charts, illustrations, icons) that don't fit Mermaid's grammar.
:::

### When to Use Code Blocks

- **AI-generated graphics** — Claude, ChatGPT, and other AI tools can generate SVG charts, diagrams, and illustrations directly. Paste the SVG into a code block to render it inline.
- **Inline SVG authoring** — Edit SVG source directly in your document and see live results.
- **Self-contained documents** — The SVG lives inside the Markdown file, with no external file dependency.

## Editing in WYSIWYG Mode

In Rich Text mode, SVG code blocks render inline automatically.

### Entering Edit Mode

Double-click a rendered SVG to open the source editor. An edit header appears with:

| Button | Action |
|--------|--------|
| **Copy** | Copy SVG source to clipboard |
| **Cancel** (X) | Revert changes and exit (also `Esc`) |
| **Save** (checkmark) | Apply changes and exit |

A **live preview** below the editor updates as you type, so you can see your changes in real time.

### Pan and Zoom

Hover over a rendered SVG to reveal interactive controls:

| Action | How |
|--------|-----|
| **Zoom** | Hold `Cmd` (macOS) or `Ctrl` (Windows/Linux) and scroll |
| **Pan** | Click and drag the SVG |
| **Reset** | Click the reset button (top-right corner) |

These are the same pan+zoom controls used for Mermaid diagrams.

### Export as PNG

Hover over a rendered SVG to reveal the **export** button (top-right, next to the reset button). Click it to choose a background theme:

| Theme | Background |
|-------|------------|
| **Light** | White (`#ffffff`) |
| **Dark** | Dark (`#1e1e1e`) |

The SVG is exported as a 2x resolution PNG via the system save dialog.

## Source Mode Preview

In Source mode, when your cursor is inside a ` ```svg ` code block, a floating preview panel appears — the same panel used for Mermaid diagrams.

| Feature | Description |
|---------|-------------|
| **Live preview** | Updates immediately as you type (no debounce — SVG rendering is instant) |
| **Drag to move** | Drag the header to reposition |
| **Resize** | Drag any edge or corner |
| **Zoom** | `−` and `+` buttons, or `Cmd/Ctrl` + scroll (10% to 300%) |

::: info
The Source mode diagram preview must be enabled. Toggle it with the **Diagram Preview** button in the status bar.
:::

## SVG Validation

VMark validates SVG content before rendering:

- The content must start with `<svg` or `<?xml`
- The XML must be well-formed (no parse errors)
- The root element must be `<svg>`

If validation fails, an **Invalid SVG** error message is shown instead of the rendered graphic. Double-click the error to edit and fix the source.

## AI Workflow

AI coding assistants can generate SVG directly into your VMark documents via MCP tools. The AI sends a code block with `language: "svg"` and the SVG content, which renders inline automatically.

**Example prompt:**

> Create a bar chart showing quarterly revenue: Q1 $2.1M, Q2 $2.8M, Q3 $3.2M, Q4 $3.9M

The AI generates an SVG bar chart that renders inline in your document, with pan+zoom and PNG export available immediately.

## Comparison: SVG Code Block vs Mermaid

| Feature | ` ```svg ` | ` ```mermaid ` |
|---------|-----------|---------------|
| Input | Raw SVG markup | Mermaid DSL |
| Rendering | Instant (synchronous) | Async (200ms debounce) |
| Pan + Zoom | Yes | Yes |
| PNG Export | Yes | Yes |
| Live preview | Yes | Yes |
| Theme adaptation | No (uses SVG's own colors) | Yes (adapts to light/dark) |
| Best for | Custom graphics, AI-generated visuals | Flowcharts, sequence diagrams, structured diagrams |

## Tips

### Security

VMark sanitizes SVG content before rendering. Script tags and event handler attributes (`onclick`, `onerror`, etc.) are stripped. This protects against XSS when pasting SVG from untrusted sources.

### Sizing

If your SVG doesn't include explicit `width`/`height` attributes, add a `viewBox` to control its aspect ratio:

```xml
<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
  <!-- content -->
</svg>
```

### Export Quality

PNG export uses 2x resolution for crisp display on Retina screens. A solid background color is added automatically (the SVG itself may have a transparent background).
