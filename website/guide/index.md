# Getting Started with VMark

VMark is the plain-text workspace where humans and AI collaborate. Both parties read and write the same artifacts directly — markdown, YAML, JSON, TOML, Mermaid, SVG, HTML, code — with no translation layer in between. Where the file is a known artifact (a GitHub Actions workflow, `Cargo.toml`, `package.json`, `pyproject.toml`), VMark renders the *right* view, not a generic JSON tree.

The differentiator isn't "open more file types" — every IDE does that. It's **schema-aware previews**: the structured view per artifact, paired with a live source pane.

## Quick Start

1. **Download and install** VMark from the [download page](/download)
2. **Launch the app** and start writing immediately
3. **Open a file** with `Cmd/Ctrl + O` or drag & drop any [supported format](/guide/formats)
4. **Open a folder** with `Cmd/Ctrl + Shift + O` for workspace mode

## Interface Overview

### Main Areas

- **Editor**: The main writing area where you compose your documents
- **Sidebar**: File tree navigation (toggle with `Ctrl + Shift + 2`)
- **Outline**: Document structure view (toggle with `Ctrl + Shift + 1`)
- **Status Bar**: Word count, character count, and auto-save status (toggle with `F7`)
- **Terminal**: Integrated shell panel (toggle with `` Ctrl + ` ``)

### Menu Bar

- **File**: New, open, save, export operations
- **Edit**: Undo/redo, clipboard, find/replace, document history
- **Block**: Headings, lists, blockquotes, line operations
- **Format**: Text styles, links, text transformations
- **View**: Editor modes, sidebar, focus/typewriter modes
- **Tools**: Text cleanup, CJK formatting, image management

### Editing Modes

VMark supports two editing modes that you can switch between:

| Mode | Description | Shortcut |
|------|-------------|----------|
| Rich Text | WYSIWYG editing with live formatting | Default |
| Source | Raw Markdown with syntax highlighting | `F6` |

### View Modes

Enhance your writing focus with these view modes:

| Mode | Description | Shortcut |
|------|-------------|----------|
| Focus | Highlight current paragraph | `F8` |
| Typewriter | Keep cursor centered | `F9` |
| Word Wrap | Toggle line wrapping | `Alt + Z` |

## Basic Formatting

### Text Styles

| Style | Syntax | Shortcut |
|-------|--------|----------|
| **Bold** | `**text**` | `Cmd/Ctrl + B` |
| *Italic* | `*text*` | `Cmd/Ctrl + I` |
| ~~Strikethrough~~ | `~~text~~` | `Cmd/Ctrl + Shift + X` |
| `Code` | `` `code` `` | `Cmd/Ctrl + Shift + `` ` `` |

### Block Elements

- **Headings**: Use `#` symbols or `Cmd/Ctrl + 1-6`
- **Lists**: Start lines with `-`, `*`, `1.`, or `- [ ]` for task lists
- **Blockquotes**: Start with `>` or use `Alt/Option + Cmd + Q`
- **Code blocks**: Use triple backticks with optional language
- **Tables**: Use the Format menu or `Cmd/Ctrl + Shift + T`

## Working with Files

### Creating and Opening

- **New file**: `Cmd/Ctrl + N`
- **Open file**: `Cmd/Ctrl + O`
- **Open folder**: `Cmd/Ctrl + Shift + O` (workspace mode)

### Saving

- **Save**: `Cmd/Ctrl + S`
- **Save As**: `Cmd/Ctrl + Shift + S`
- **Auto-save**: Enabled by default, configurable in settings

### Exporting

- **Export HTML**: Use **File → Export HTML** — includes interactive VMark Reader
- **Export PDF**: Use Print (`Cmd/Ctrl + P`) and save as PDF
- **Copy as HTML**: `Cmd/Ctrl + Shift + C`

Exported HTML includes the VMark Reader with table of contents, settings panel, and more. [Learn more →](/guide/export)

## Settings

Open settings with `Cmd/Ctrl + ,` to customize:

- **Appearance**: Theme, fonts, font size, line height
- **Editor**: Auto-save interval, default behaviors
- **Files & Images**: Asset management, document tools
- **Integrations**: AI providers, MCP server
- **Language**: CJK formatting rules
- **Markdown**: Export options, formatting preferences
- **Shortcuts**: Customize keyboard shortcuts
- **Terminal**: Terminal font size and line height

## AI Writing Assistance

VMark includes built-in AI Genies — select text and press `Mod + Y` to polish, expand, translate, or transform your writing with AI. Configure your preferred provider in **Settings > Integrations**.

[Learn more about AI Genies →](/guide/ai-genies) | [Configure providers →](/guide/ai-providers)

## Tips for Getting Started

1. **Navigate with outline**: Click outline items to jump between sections
2. **Try focus mode**: `F8` dims everything except the current paragraph
3. **Validate as you write**: `Cmd + Shift + L` runs the markdown lint engine and broken-link check
4. **Learn shortcuts**: the full reference is in the [shortcuts guide](/guide/shortcuts)

## Next Steps

- Learn about all [features](/guide/features)
- Master [keyboard shortcuts](/guide/shortcuts)
- Explore [CJK formatting](/guide/cjk-formatting) tools
