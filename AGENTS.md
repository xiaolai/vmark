# AGENTS.md

Shared instructions for all AI agents (Claude, Codex, etc.) working on VMark.
Rules only. The reasoning behind each gate lives in the header of the script
that enforces it; the pre-cleanup long form is `git show 12c98051e:AGENTS.md`.

## Working agreement

- Use English regardless of the language xiaolai writes in.
- Run `git status -sb` at session start. Read relevant files before editing.
- Keep diffs focused; no drive-by refactors. Do not commit unless explicitly asked.
- Keep code files under ~300 lines (`pnpm lint:file-size` ratchets down only).
- Zustand: never destructure stores in components; use selectors. Use `useXStore.getState()` inside callbacks.
- Keep features local; avoid cross-feature imports unless truly shared.
- **Research before building**: look for established patterns and prior art before inventing.
- **Edge cases are not optional**: empty/null input, max values, concurrency, Unicode/CJK, RTL, rapid repeats, network failure, permission denial — test each.
- **Test-first is mandatory** for new behavior (RED → GREEN → REFACTOR). Coverage floors are enforced. Exempt: CSS-only, docs, config. See `.claude/rules/10-tdd.md`.
- `dev-docs/` and `.vmark/` are maintainer-local (gitignored); skip references to them when absent. Archive finished deep research to `dev-docs/deep-researches/YYYYMMDD-topic.md` and link it from `dev-docs/README.md`.
- Never bypass a hook or gate (`--no-verify`, removing hooks, loosening a gate) without explicit authorization. Fix the gate instead.

## Gates — what to run

`check:all` (~15 min) is the final gate, not the feedback loop.

| What you changed | Run |
|---|---|
| One app `.ts`/`.tsx` | `pnpm test:changed`, or `pnpm vitest related <file>` |
| Inner loop generally | `pnpm check:fast` (typecheck + cached lint + related tests) |
| A lint gate under `scripts/` | that gate, plus its `scripts/*.test.*` |
| Locale JSON | `pnpm lint:i18n && pnpm vitest run src/locales` |
| CSS only | visual QA (no tests required) |
| Rust | `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --all-targets -- -D warnings` |
| Rust, adding a `tauri::test` mock-runtime test | the row above, plus `bash scripts/check-cross-target.sh` |
| Before pushing | `pnpm check:predelta` (every static gate in parallel, all failures at once), then one `pnpm check:all` |

`check:all` needs `zsh`, `python3` and `tokei` on PATH (gates-tier tests execute them and fail rather than skip); pushing a `v*` tag needs an authenticated `gh`. Environment variables (`VMARK_CHANGED_BASE`, `VMARK_GH_TIMEOUT`, …) are tabled in `CONTRIBUTING.md`.

`check:fast` cannot see: tests that read their subject at runtime (baselines, `ci.yml`), coverage, `check:servers`/`check:build`/size-limit, WebKit, Rust, soak. `test:changed` diffs against `origin/main` — `git fetch` first.

## Testing infrastructure

- **Four vitest tiers must partition the test files**: app (`vitest.config.ts`, jsdom), gates (`vitest.gates.config.ts`, `scripts/**` + `.claude/hooks/**`), browser (`*.webkit.test.ts`, real WebKit via `pnpm test:browser`), soak. `check-scripts-parity.test.mjs` asserts it. Shared settings live in `vitest.shared.ts`.
- Vite configs must load under `configLoader: 'native'`: no `__dirname`/`__filename` (use `import.meta.dirname`), explicit extensions on relative imports.
- **Node environment**: most app tests start with `// @vitest-environment node`. Decide by running the file under node, never by reading it. Never quote that token in a header comment — the docblock parser treats it as the setting.
- Test files are type-checked by `pnpm lint:test-types` (per-file baseline, ratchets down); `pnpm typecheck` excludes them.
- **Growth tests** (cost at n vs k·n) measure with `measureGrowth`/`growthExponent` from `src/test/cpuClock.ts`, which times the test thread's own CPU clock. Never `process.cpuUsage()` (it bills V8's background threads) or `performance.now()` directly.
- **Windows**: `tauri::test` does not exist there. Gate every `tauri::test::` item with `#[cfg(not(target_os = "windows"))]`; see `fs_scope.test.rs`. Do not bind commands as function pointers in lib tests (`src-tauri/src/window_manager/mod.test.rs` explains).
- **E2E** (guide: `e2e/README.md`): needs a running `pnpm tauri:dev`. AI features are tested through VMark MCP (`mcp__vmark__*`) only; non-AI UI/plumbing through Tauri MCP (`mcp__tauri__*`, `127.0.0.1:9323`, debug builds only). Never Chrome DevTools MCP. The VMark bridge port is dynamic (read from `mcp-port`). After sidecar changes: `pnpm --dir server/mcp build:sidecar`, reconfigure the client, restart it.
- `tauri dev` runs as identifier `app.vmark.dev` — separate settings, session, logs and `mcp-port` from the release app. Point an AI client at dev with `VMARK_APP_IDENTIFIER=app.vmark.dev`.

## Git, CI, and pushing

- **Never let a shell parse a commit message.** Use `git commit -F <file>` or a heredoc with a QUOTED delimiter (`<<'EOF'`). `-m` only for one-line subjects without punctuation. `.githooks/commit-msg` refuses credential/env-dump content (`scripts/check-commit-message.mjs`).
- `main` requires a PR with green `frontend` + `rust` (branch protection, `enforce_admins`). `v*` tag pushes are verified by `.githooks/pre-push` → `scripts/check-tag-green.sh`. `VMARK_OFFLINE_GATE=1` runs the full local gate instead.
- CI is `pull_request`-only; docs-only PRs skip the app tiers (allowlist in `ci.yml`, pinned by `scripts/check-ci-docs-filter.test.mjs`).
- Every ratcheting baseline is re-checked against the merge base (`scripts/check-baseline-ratchet.mjs`); registering a new baseline in its manifest is part of adding it.
- PRs over the change-size thresholds need a `CHANGE-SIZE-ACK:` line (`scripts/check-change-size.mjs`).
- No raw NUL bytes in text files — write `\u0000` (`pnpm lint:no-nul-bytes`).

## Gates worth knowing before you hit them

Each script's header explains its rules and exemption markers.

- `lint:ipc-contract` — every `invoke("x")` resolves to a registered `#[command] fn x`. Zero tolerance.
- `lint:window-thread` — a Tauri command that creates a window MUST be `async` (WebView2 deadlocks otherwise). When a command goes async, re-read it for check-then-act races the blocking IPC loop used to serialize.
- `lint:type-aware` — floating/misused promises, base-to-string. Slow; in `check:static`, not `check:fast`.
- `lint:theme-contrast`, `lint:ui-consistency`, `lint:bespoke-buttons`, `lint:design-tokens` — UI gates; see `.claude/rules/3*.md`.
- `lint:command-errors` — new Rust commands return `CommandError`; see `.claude/rules/50-codebase-conventions.md`.
- `lint:store-coupling` — plugins must not import app stores/services/hooks/components; see `.claude/rules/00-engineering-principles.md`.
- `lint:feature-map` — every production source file is owned by exactly one feature in `scripts/feature-map.json` (or its `infrastructure.paths`). A new module must be assigned in the same change. It also joins the tracked ledger `.claude/feature-ledger.md` to the map (every block names a feature, every cited path exists) — when a feature ships, moves or dies, edit its block in the same change. `pnpm gen:feature-ledger` regenerates the untracked `dev-docs/feature-metrics.md`.
- `lint:file-headers`, `lint:provenance-ids` — every production `.ts`/`.tsx` under `src/` opens with its `/** … @module */` header; production comments carry no calendar date, no `dev-docs/` document path, and only WI/audit ids a tracked file resolves. See `.claude/rules/22-comment-maintenance.md`.
- `lint:rust-deps` (`cargo machete`) runs in CI, not `check:all`.
- Markdown parser hostile-input cost is linear: fast paths in `parser/fastPaths/`, `pnpm` patches in `patches/` (a Dependabot bump of micromark or mdast-util-to-markdown fails install until the patch is re-made — that is intended), and `pathologicalScaling.test.ts`.
- Decoration-set cost is linear through `patches/prosemirror-view@1.42.6.patch` (#1565). A `prosemirror-view` bump fails install until the patch is re-made; `src/plugins/shared/__tests__/decorationSet.*` hold it to the unpatched algorithm and pin the version.

## i18n

- All user-facing strings use `t()` (React) or `t!()` (Rust). Never hardcode English in UI. Keys are flat dot-separated camelCase (`sidebar.newFile`); add them to `src/locales/en/*.json` or `src-tauri/locales/en.yml`.
- Locale bundles are FLAT — never nested objects (`localeShape.test.ts`).
- `pnpm lint:i18n` checks key presence AND that values are translated. The untranslated baseline is empty — translate, never re-add. Truly untranslatable strings go in `scripts/i18nIdenticalAllowlist.ts` with a reason.

## Tech stack and patterns

- Tauri v2, React 19, Zustand v5, shadcn/ui v4, Tailwind v4, Vite v7, Vitest v4, pnpm.
- Rust → webview: `emit()` → `listen()`. Webview → Rust: `invoke()`.
- Three-tier source layout (ADR-013; decision records live in `.claude/adr/`, and `pnpm lint:adr-refs` resolves every cited id): `src/utils/` is leaf-pure (no stores, no `@tauri-apps/*`); `src/services/` (domain folders) may use utils, stores, Tauri; `src/hooks/` are React adapters over services.
- `src/shell/AppShell.tsx` is pure layout. Surfaces are mounted by editing App.tsx's `<AppShell>`; `pnpm lint:shell-slots` holds the identity list.
- Menus: `menu/events.rs` emits `menu:{id}` generically; `menu/localized.rs` `create_localized_menu` is the single builder (labels in `src-tauri/locales/en.yml`). Every menu item needs a real SF Symbol in `macos_menu.rs` `MENU_ICONS`.
- Shortcuts: see `.claude/rules/41-keyboard-shortcuts.md`.
- Settings store uses plain `.subscribe()` with manual prev-value tracking, not `subscribeWithSelector`.
- Tauri plugin: add to `Cargo.toml`, register `.plugin()` in `src-tauri/src/app_plugins.rs`, add permission to `src-tauri/capabilities/default.json`.

## Styling (details in `.claude/rules/3*.md`)

- Tokens only — never hardcode colors, shadows, or radii. Dark theme via `.dark-theme`.
- Selected: `--accent-bg` background, `--text-color` text, `--accent-primary` icons.
- Focus must be visible: flat 2px bar for buttons, bottom border for inputs; popup inputs are caret-only.
- Editor popups live inside the editor container, not `document.body`.
- English copy: spaces around em-dashes (`word — word`; `lint:emdash` checks Markdown, `lint:i18n` checks UI strings).

## Mermaid

- VMark uses Mermaid v12. Validate diagrams with the `mermaid-validator` MCP tool (it tracks v11, so it is a lower bound).
- Prefer `flowchart`, quote labels with special characters, no trailing semicolons.
- `plugins/mermaid/constants.ts` `MERMAID_V11_RENDERING` pins `dagre` + `classic`; it is spread into both `initialize()` calls.

## Cross-platform

- macOS is primary; never break it to fix Windows/Linux (best effort). Isolate platform code with `cfg`.
- Never bare `Command::new("tool")`: use `ai_provider::build_command()` and `ai_provider::login_shell_path()`.

## GitHub

- Reply to issues in the reporter's language. Use `Closes #N` in PRs; close issues once fixed.

## Plans and governance (full rules: `.claude/rules/60-ai-governance.md`)

- Long-running work (>1 day or >5 files) needs a plan `YYYYMMDD-name.md` in `dev-docs/plans/` (local) or `.claude/tdd-guardian/` (tracked, when CI or the history must see it).
- Namespace work-item IDs per plan (`WI-AF1.2`). Every WI in a complete phase is linked by a commit tag `(WI-1.2)` or a test-file header (`scripts/check-wi-linkage.sh`).
- New npm deps are checked for hallucination (`scripts/check-new-deps.sh`). Cross-model review (Codex) is mandatory for plans >500 lines or >3 phases.
- High-risk paths are guarded by `.claude/hooks/gha-tdd-guard.mjs` (no production edit without a sibling test).
