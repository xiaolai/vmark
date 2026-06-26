# [AGENTS.md](http://AGENTS.md)

Shared instructions for all AI agents (Claude, Codex, etc.).

- You are an AI assistant working on the VMark project.

- Use English unless another language is requested.

- Follow the VMark working agreement:

  - Run `git status -sb` at session start.

  - Read relevant files before editing.

  - Keep diffs focused; avoid drive-by refactors.

  - Do not commit unless explicitly requested.

  - Keep code files under \~300 lines (split proactively).

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

  - **Pushes to `main` and `v*` tags are gated at push time.** A versioned
    `pre-push` hook (`.githooks/pre-push`) runs `pnpm check:all` before any
    push that updates `main` or a release tag, and refuses the push if it is
    red. Feature-branch pushes are not gated locally — CI gates those via the
    PR's required `frontend` check. The hook is auto-enabled by the root
    `prepare` script (`git config core.hooksPath .githooks`) on `pnpm install`;
    if a fresh clone hasn't run install yet, enable it manually with the same
    command. Bypassing (`git push --no-verify`) requires explicit
    authorization — see `.claude/rules/60-ai-governance.md` §9.

  - No dev server; ask the user to run interactive app flows.

  - For E2E, use Tauri MCP tools. **Never use Chrome DevTools MCP** — VMark is a Tauri app, not a browser app.

  - **Tauri MCP automation port = 9323.** The `tauri-plugin-mcp-bridge` (debug-only) is pinned to `127.0.0.1:9323` in `src-tauri/src/lib.rs`. Connect with `tauri_driver_session` action `start`, `port: 9323`. Do **not** rely on the default 9223 — that is VMark's own MCP bridge (sidecar ↔ webview, for AI clients) and is auth-protected, so commands sent there drop with "Connection closed".

  - **Internationalization (i18n)**: All user-facing strings must use `t()` (React) or `t!()` (Rust).
    Never hardcode English strings in UI code. Translation keys use flat dot-separated camelCase
    (e.g., `sidebar.newFile`, `dialog.save.title`). New strings require adding keys to
    `src/locales/en/*.json` (React) or `src-tauri/locales/en.yml` (Rust).

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

  - **Close issues when fixed** — close issues after the fix is merged. Use `Closes #N` in PR descriptions to auto-close. Only leave issues open if the fix is partial or needs follow-up.

  - **Cost reports**: Daily cost reports use a single rolling issue (close previous, open new) with data archived to `.github/cost-reports/ledger.json`. Do not keep old cost-report issues open — the workflow handles the lifecycle automatically.

- AI governance (long-running plans):

  - See `.claude/rules/60-ai-governance.md` for the full rule set; background research in `dev-docs/grills/ai-governance-2026-05.md`.

  - Plans live in `dev-docs/plans/YYYYMMDD-name.md` with WI-IDs (`WI-1.2`). Every WI in a "complete" phase must be linked via commit message or test-file header — checked by `scripts/check-wi-linkage.sh`.

  - Each phase has machine-checkable DoD. For the GHA workflow viewer plan: `bash scripts/check-gha-phase.sh <N>`.

  - New dependencies are reviewed for hallucination/slopsquatting on every PR via `scripts/check-new-deps.sh` (CI-enforced).

  - High-risk paths are TDD-hook-enforced via `.claude/hooks/gha-tdd-guard.mjs` (PreToolUse: blocks Write/Edit on production source without sibling test).

  - Cross-model review (Codex) is mandatory for plans >500 lines or >3 phases before Phase 1 commits.

- Key architectural patterns:

  - **Menu events**: Generic dispatcher in `menu_events.rs` emits `menu:{id}` to the focused window — no per-item handling needed for simple events.

  - **Menu builders**: `menu/localized.rs` has ONE function (`create_localized_menu`) that handles both default and custom shortcuts with rust-i18n translated labels. When changing menus, update this function and the corresponding keys in `src-tauri/locales/en.yml`.

  - **Menu icons**: Every menu item MUST have an SF Symbol icon mapped in `macos_menu.rs` (`MENU_ICONS` array). Use real SF Symbol names only — verify names exist in the SF Symbols app before adding. Never invent symbol names.

  - **Keyboard shortcuts**: Three files must stay in sync — `menu/localized.rs` (Rust accelerators: `CmdOrCtrl+Shift+N`), `src/stores/settingsStore/shortcuts.ts` (frontend defaults: `Mod-Shift-n`), `website/guide/shortcuts.md` (docs: `Mod + Shift + N`).

  - **Settings store**: Uses plain `.subscribe()` with manual prev-value tracking — NOT `subscribeWithSelector`.

  - **Capabilities**: Tauri permissions go in `src-tauri/capabilities/default.json`.

  - **Adding a Tauri plugin**: (1) add to `Cargo.toml`, (2) register `.plugin()` in `lib.rs`, (3) add permission to capabilities.

  - **Backtick shortcut escaping**: ProseMirror format `"Ctrl-\`"`, Tauri format `"Ctrl+\`"\`.

  - **Architecture overview**: See `dev-docs/architecture.md` for C4 diagram, entry points, data flows, and module map.

  - **Three-tier source layout** (ADR-013):
    | Tier | May import | Examples |
    |---|---|---|
    | `src/utils/` | stdlib, other `utils/` | Pure parsers, formatters, string helpers |
    | `src/services/` | `utils/`, `stores/`, Tauri APIs | Persistence, IME toast, feature flags, format bridge |
    | `src/hooks/` | `services/`, `stores/`, React APIs | React adapters over services |

    `utils/` must be leaf-pure. If you find yourself adding `useXStore` or `@tauri-apps/*` imports inside `utils/`, the file belongs in `services/` instead. `services/` is organised by domain folder (`services/ime/`, `services/featureFlags/`, `services/formats/`).

  - **Shell layer** (ADR-007): `src/shell/AppShell.tsx` is the composition root for the document window. It is pure layout: zero store imports, zero feature knowledge. New top-level surfaces (panels, overlays) become slot registrations, not edits to `App.tsx`.

