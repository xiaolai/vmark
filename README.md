# VMark

A local-first Markdown editor built with Tauri v2 and React, featuring dual editing modes and seamless rich text / source switching.

## Features

- **Dual Editing Modes**: Switch between rich text (Tiptap/ProseMirror) and source mode (CodeMirror 6)
- **Local-First**: All data stays on your machine - no cloud dependencies
- **Workspace Support**: Open folders as workspaces with file tree navigation
- **CJK Formatting**: Built-in Chinese/Japanese/Korean text formatting tools
- **Mermaid Diagrams**: Render flowcharts, sequence diagrams, and more
- **LaTeX Math**: KaTeX-powered mathematical equations
- **Focus & Typewriter Modes**: Distraction-free writing experience

## Tech Stack

- **Desktop Framework**: Tauri v2
- **Frontend**: React 19, TypeScript
- **State Management**: Zustand v5
- **Rich Text Editor**: Tiptap (ProseMirror)
- **Source Editor**: CodeMirror 6
- **Styling**: Tailwind CSS v4
- **Build Tool**: Vite v7

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 8+
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Platform-specific Tauri dependencies: [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

## Getting Started

```bash
# Clone the repository
git clone <repository-url>
cd vmark

# Install dependencies
pnpm install

# Run in development mode
pnpm tauri:dev

# Run tests
pnpm test

# Build for production
pnpm tauri build
```

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server (web only) |
| `pnpm tauri:dev` | Start Tauri development mode |
| `pnpm test` | Run unit tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | Run ESLint |
| `pnpm check:all` | Run lint + test + build |
| `pnpm build` | Build frontend for production |
| `pnpm tauri build` | Build desktop application |

## Project Structure

```
vmark/
├── src/                    # Frontend source
│   ├── components/         # React components
│   ├── hooks/              # Custom React hooks
│   ├── stores/             # Zustand state stores
│   ├── plugins/            # Editor plugins (Tiptap, CodeMirror)
│   ├── utils/              # Pure utility functions
│   └── pages/              # Route pages
├── src-tauri/              # Rust backend
│   └── src/                # Tauri commands and plugins
├── website/                # VitePress documentation site
└── public/                 # Static assets
```

## Keyboard Shortcuts


| Shortcut | Action |
|----------|--------|
| `F7` or `Cmd/Ctrl + /` | Toggle Rich Text / Source Mode |
| `F8` | Toggle Focus Mode |
| `F9` | Toggle Typewriter Mode |
| `F10` | Toggle Word Wrap |

## Smart Paste (WYSIWYG)

- **Markdown auto-detect**: Pasting Markdown in rich text mode converts it into rich content when detection matches (headings, lists, code fences, tables, etc.).
- **Plain-text override**: Use `Cmd/Ctrl+Shift+V` to paste plain text without formatting.
- **Setting**: Toggle in Settings -> Markdown -> "Smart paste Markdown".

## Testing

Unit tests use Vitest. Run the test suite:

```bash
pnpm test           # Run once
pnpm test:watch     # Watch mode
```

## License

Private - All rights reserved.
