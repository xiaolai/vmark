# VMark

**The Markdown Editor That Gets It Right**

Free. Smart. Beautiful. Yours.

<p align="center">
  <img src="website/public/screenshots/ai-workflow.png" alt="VMark AI Integration - Claude Code, Claude Desktop, and VMark" width="800">
</p>

VMark is a modern, local-first Markdown editor designed for the AI era. Three editing modes — WYSIWYG, Source Peek, and full Source — with multi-cursor editing, CJK formatting, and native AI integration.

**[Download](https://github.com/xiaolai/vmark/releases)** · **[Documentation](https://vmark.app/guide/)** · **[Features](https://vmark.app/guide/features)**

---

## Highlights

- **Three Modes** — WYSIWYG (Tiptap/ProseMirror), Source Peek (`F5`), Source Mode (`F6`, CodeMirror 6)
- **AI-Native** — MCP integration for Claude Desktop, Claude Code, Codex CLI, Gemini CLI. AI Genies for inline writing assistance.
- **Multi-Cursor** — `Mod + D` to select next match, `Alt + Click` to add cursors, `Mod + Alt + ↑↓` for vertical cursors
- **Tab Escape** — Auto-pair brackets/quotes, press Tab to jump past closing characters
- **CJK Done Right** — 20+ formatting rules for Chinese, Japanese, Korean text
- **5 Themes** — White, Paper, Mint, Sepia, Night
- **Local-First** — No cloud, no accounts, no analytics. Documents stay on your machine.
- **123 Shortcuts** — All customizable in Settings

See the full feature list at **[vmark.app/guide/features](https://vmark.app/guide/features)**.

---

## Install

**macOS (Homebrew):**

```bash
brew install xiaolai/tap/vmark
```

**Manual:** Download from the [Releases page](https://github.com/xiaolai/vmark/releases).
- Apple Silicon: `VMark_x.x.x_aarch64.dmg`
- Intel: `VMark_x.x.x_x64.dmg`

**Windows & Linux:** Pre-built binaries on the [Releases page](https://github.com/xiaolai/vmark/releases). macOS is the primary platform; other builds are best-effort.

---

## AI Integration

VMark speaks [MCP](https://modelcontextprotocol.io/) natively. **Settings → Integrations → Install** — one click per assistant.

Supported: Claude Desktop, Claude Code, Codex CLI, Gemini CLI.

See the **[MCP Setup Guide](https://vmark.app/guide/mcp-setup)**.

---

## Contributing: Issues Only, No PRs

VMark is **vibe-coded** — written entirely by AI under human supervision. We welcome **issues** (bug reports, feature requests) but cannot safely merge external PRs.

When you file an issue, AI fixes it with full context of the project's conventions, test suite, and architecture.

- **[Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml)** · **[Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml)**
- Read more: **[Why Issues, Not PRs](https://vmark.app/guide/users-as-developers/why-issues-not-prs)**

---

## Building from Source

**Prerequisites:** [Node.js](https://nodejs.org/) 20+, [pnpm](https://pnpm.io/) 10+, [Rust](https://www.rust-lang.org/tools/install) (stable), [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/xiaolai/vmark.git
cd vmark
pnpm install
pnpm tauri dev        # Development
pnpm tauri build      # Production
pnpm check:all        # Lint + test + build
```

**Tech Stack:** Tauri v2 (Rust), React 19, TypeScript, Zustand v5, Tiptap, CodeMirror 6, Tailwind CSS v4

**AI-Assisted Development:** The repo ships with full configuration for Claude Code, Codex CLI, and Gemini CLI. See `AGENTS.md` for conventions and `.claude/` for rules, skills, and subagents.

---

## License

[ISC License](LICENSE) — free to use, copy, modify, and distribute. See the [license page](https://vmark.app/guide/license) for details.

---

<p align="center">
  <b>Questions?</b> Open an <a href="https://github.com/xiaolai/vmark/issues">issue</a> · <b>Updates?</b> Watch this repo
</p>
