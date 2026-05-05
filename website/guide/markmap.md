# Markmap Mindmaps

VMark supports [Markmap](https://markmap.js.org/) for creating interactive mindmap trees directly in your Markdown documents. Unlike Mermaid's static mindmap diagram type, Markmap uses plain Markdown headings as input and provides interactive pan/zoom/collapse.

## Inserting a Mindmap

### Using Menu

**Menu:** Insert > Mindmap

**Keyboard shortcut:** `Alt + Shift + Cmd + K` (macOS) / `Alt + Shift + Ctrl + K` (Windows/Linux)

### Using a Code Block

Type a fenced code block with the `markmap` language identifier:

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

### Using MCP Tool

Use the `media` MCP tool with `action: "markmap"` and the `code` parameter containing Markdown headings.

## Editing Modes

### Rich Text Mode (WYSIWYG)

In WYSIWYG mode, Markmap mindmaps are rendered as interactive SVG trees. You can:

- **Pan** by scrolling or clicking and dragging
- **Zoom** by holding `Cmd`/`Ctrl` and scrolling
- **Collapse/expand** nodes by clicking the circle at each branch
- **Fit** the view using the fit button (top-right corner on hover)
- **Double-click** the mindmap to edit the source

### Source Mode with Live Preview

In Source mode, a floating preview panel appears when your cursor is inside a markmap code block, updating as you type.

## Input Format

Markmap uses standard Markdown as input. Headings define the tree hierarchy:

| Markdown | Role |
|----------|------|
| `# Heading 1` | Root node |
| `## Heading 2` | First-level branch |
| `### Heading 3` | Second-level branch |
| `#### Heading 4+` | Deeper branches |

### Rich Content in Nodes

Nodes can contain inline Markdown:

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

List items under a heading become child nodes of that heading.

### Live Demo

Here is an interactive markmap rendered directly on this page — try panning, zooming, and collapsing nodes:

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

## Interactive Features

| Action | How |
|--------|-----|
| **Pan** | Scroll or click and drag |
| **Zoom** | `Cmd`/`Ctrl` + scroll |
| **Collapse node** | Click the circle at a branch point |
| **Expand node** | Click the circle again |
| **Fit to view** | Click the fit button (top-right on hover) |

## Theme Integration

Markmap mindmaps automatically adapt to VMark's current theme (White, Paper, Mint, Sepia, or Night). Branch colors adjust for readability in every theme.

## Export as PNG

Hover over a rendered mindmap in WYSIWYG mode to reveal an **export** button. Click it to choose a theme:

| Theme | Background |
|-------|------------|
| **Light** | White background |
| **Dark** | Dark background |

The mindmap is exported as a 2x resolution PNG via the system save dialog.

## Tips

### Markmap vs Mermaid Mindmap

VMark supports both Markmap and Mermaid's `mindmap` diagram type:

| Feature | Markmap | Mermaid Mindmap |
|---------|---------|-----------------|
| Input format | Standard Markdown | Mermaid DSL |
| Interactivity | Pan, zoom, collapse | Static image |
| Rich content | Links, bold, code, lists | Text only |
| Best for | Large, interactive trees | Simple static diagrams |

Use **Markmap** when you want interactivity or already have Markdown content. Use **Mermaid mindmap** when you need it alongside other Mermaid diagrams.

### Learning More

- **[Markmap Documentation](https://markmap.js.org/)** — Official reference
- **[Markmap Playground](https://markmap.js.org/repl)** — Interactive playground to test mindmaps
