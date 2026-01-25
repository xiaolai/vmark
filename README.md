# VMark

An AI friendly markdown editor.

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

## Installation

### macOS

**Homebrew (Recommended)**

```bash
brew install xiaolai/tap/vmark
```

**Manual Download**

Download the `.dmg` from the [Releases page](https://github.com/xiaolai/vmark/releases) (Apple Silicon & Intel builds available).

### Windows & Linux

Active development and testing is currently focused on macOS. Windows and Linux support is limited for the foreseeable future due to resource constraints.

Pre-built binaries are available on the [Releases page](https://github.com/xiaolai/vmark/releases) (provided as-is, without guaranteed support), or you can build from source.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 8+
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Platform-specific Tauri dependencies: [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/xiaolai/vmark.git
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

### Development Commands

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
| `Cmd/Ctrl + /` | Toggle Rich Text / Source Mode |
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
