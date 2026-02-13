# AGENTS.md

Shared instructions for all AI agents (Claude, Codex, etc.).

<INSTRUCTIONS>
- You are an AI assistant working on the VMark project.
- Use English unless another language is requested.
- Follow the VMark working agreement:
  - Run `git status -sb` at session start.
  - Read relevant files before editing.
  - Keep diffs focused; avoid drive-by refactors.
  - Do not commit unless explicitly requested.
  - Keep code files under ~300 lines (split proactively).
  - Do not destructure Zustand stores in components; use selectors.
  - Prefer `useXStore.getState()` inside callbacks.
  - Keep features local; avoid cross-feature imports unless truly shared.
  - **Research before building**: For new features, search for industry best practices,
    established conventions, and proven solutions (web search, official docs, prior art in
    popular open-source projects). Don't invent when a well-tested pattern exists.
  - **Edge cases are not optional**: Brainstorm as many edge cases as possible — empty input,
    null/undefined, max values, concurrent access, Unicode/CJK, RTL text, rapid repeated
    actions, network failures, permission denials. Write tests for every one.
  - **Test-first is mandatory** for new behavior:
    - Write a failing test (RED), implement minimally (GREEN), refactor (REFACTOR).
    - Coverage thresholds are enforced — `pnpm check:all` fails if coverage drops.
    - Exceptions: CSS-only, docs, config. See `.claude/rules/10-tdd.md` for full scope.
  - Run `pnpm check:all` for gates.
  - No dev server; ask the user to run interactive app flows.
  - For E2E, use Tauri MCP tools. **Never use Chrome DevTools MCP** — VMark is a Tauri app, not a browser app.
- AI coding tool auth:
  - **Prefer subscription auth over API keys** for all AI coding tools (Claude Code, Codex CLI, Gemini CLI). Subscription plans are dramatically cheaper for sustained coding sessions — API billing can cost 10–30x more.
  - Claude Code: log in with Claude Max subscription. Codex CLI: `codex login` with ChatGPT Plus/Pro. Gemini CLI: Google account login.
  - API keys work as a fallback for light or automated usage.
- Tech stack reference:
  - Tauri v2, React 19, Zustand v5, shadcn/ui v4, Tailwind v4,
    Vite v7, Vitest v4, pnpm.
- Tauri bridge patterns:
  - Rust -> Webview: `window.emit()` / `app.emit()` -> frontend `listen()`.
  - Webview -> Rust: `invoke()`.
- Writing style:
  - **Em-dash spacing**: Always use spaces around em-dashes in English: `word — word` not `word—word`.
- Styling rules:
  - **Tokens first**: Never hardcode colors; use CSS vars (`--bg-color`, `--accent-bg`, etc.).
  - **Selection states**: Use `--accent-bg` for background, `--accent-primary` for text/icons.
  - **Focus indicators**: MUST be visible (accessibility). Use U-shaped underline for buttons, bottom-border for inputs.
  - **Popup positioning**: Editor popups MUST be inside editor container, not `document.body`.
  - **Popup inputs**: Borderless, no focus ring. Focus = caret only.
  - **Dark theme**: Use `.dark-theme` selector (not `[data-theme]`).
  - **Border radius**: `4px` (small), `6px` (medium), `8px` (popups/dialogs).
  - **Shadows**: Use `--popup-shadow` token, not hardcoded values.
- Mermaid diagrams:
  - VMark uses Mermaid v11 (strict Langium parser). Always validate diagrams with the `mermaid-validator` MCP tool before outputting.
  - When sending content to VMark, prefer validated Mermaid diagrams over plain-text graphs whenever possible.
  - Quote node labels containing special characters: `["Label (detail)"]`. No trailing semicolons. Prefer `flowchart` over `graph`.
- Cross-platform policy:
  - **macOS is the primary platform.** All changes must preserve macOS behavior — never break macOS to fix Windows/Linux.
  - Windows and Linux issues are addressed on a best-effort basis when resources permit.
  - Use `#[cfg(not(target_os = "macos"))]` or `cfg!(target_os = "windows")` to isolate platform-specific code.
  - **Command spawning**: Never use bare `Command::new("tool")`. Always use `ai_provider::build_command()` (handles `.cmd` shims on Windows) and set PATH via `ai_provider::login_shell_path()` (macOS GUI apps have minimal PATH).
  - When responding to GitHub issues, reply in the same language the reporter used.
- Key architectural patterns:
  - **Menu events**: Generic dispatcher in `menu_events.rs` emits `menu:{id}` to the focused window — no per-item handling needed for simple events.
  - **Menu builders**: `menu.rs` has TWO menu creation functions (`create_menu` + `create_menu_with_shortcuts`) — both MUST be updated when changing menus.
  - **Keyboard shortcuts**: Three files must stay in sync — `menu.rs` (Rust accelerators: `CmdOrCtrl+Shift+N`), `shortcutsStore.ts` (frontend defaults: `Mod-Shift-n`), `website/guide/shortcuts.md` (docs: `Mod + Shift + N`).
  - **Settings store**: Uses plain `.subscribe()` with manual prev-value tracking — NOT `subscribeWithSelector`.
  - **Capabilities**: Tauri permissions go in `src-tauri/capabilities/default.json`.
  - **Adding a Tauri plugin**: (1) add to `Cargo.toml`, (2) register `.plugin()` in `lib.rs`, (3) add permission to capabilities.
  - **Backtick shortcut escaping**: ProseMirror format `"Ctrl-\`"`, Tauri format `"Ctrl+\`"`.
</INSTRUCTIONS>
