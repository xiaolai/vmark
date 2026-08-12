# [AGENTS.md](http://AGENTS.md)

Shared instructions for all AI agents (Claude, Codex, etc.).

- You are an AI assistant working on the VMark project.

- Use English regardless what languages xiaolai uses.

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

  - **Archive finished deep researches**: When a deep-research run finishes, write its full  
    cited report (verdict, findings, refuted claims, caveats, sources) to  
    `dev-docs/deep-researches/YYYYMMDD-topic.md` and link it from `dev-docs/README.md`.  
    Don't leave finished research only in chat transcripts or task output files.

  - **`dev-docs/` and `.vmark/` are maintainer-local (gitignored)**: they exist on  
    maintainer machines, not in the public repo. References to `dev-docs/` in these  
    rules apply when the folder is present; skip them otherwise.

  - **Edge cases are not optional**: Brainstorm as many edge cases as possible — empty input,  
    null/undefined, max values, concurrent access, Unicode/CJK, RTL text, rapid repeated  
    actions, network failures, permission denials. Write tests for every one.

  - **Test-first is mandatory** for new behavior:

    - Write a failing test (RED), implement minimally (GREEN), refactor (REFACTOR).

    - Coverage thresholds are enforced — `pnpm check:all` fails if coverage drops.

    - Exceptions: CSS-only, docs, config. See `.claude/rules/10-tdd.md` for full scope.

  - Run `pnpm check:all` for gates.

  - **`check:all` is the gate, not the loop.** It runs ~1,465 test files, 25
    lint gates and three builds; measured locally it is a ~15-minute round
    trip, which makes it useless as feedback while you work. Use
    `pnpm check:fast` (`typecheck` + cached `lint` + tests related to your
    changes) as the inner loop, and run `pnpm check:all` once before you push.

    What to run after a change:

    | What you changed | Run |
    |---|---|
    | One app `.ts`/`.tsx` | `pnpm test:changed`, or `pnpm vitest related <file>` |
    | A store/service with many importers | `pnpm test:changed` — the import graph handles the fan-out |
    | A lint gate under `scripts/` | that gate, plus its own `scripts/*.test.*` file |
    | Locale JSON | `pnpm lint:i18n && pnpm vitest run src/locales` |
    | CSS only | Nothing — visual QA instead (`.claude/rules/10-tdd.md` exempts CSS) |
    | Rust | `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --all-targets -- -D warnings` |
    | Anything, before pushing | `pnpm check:all` |

    **What `check:fast` does not see** — it is an incremental loop, and these
    gaps are why it can never replace `check:all`:

    - `vitest --changed` follows the **static import graph only**. Around 35
      test files read their subject at runtime with `readFileSync` — the
      baseline ratchets, the shell-slots identity list, the byte-identity
      check on `ci.yml` — so editing a baseline JSON or a workflow file
      changes nothing the graph can see and selects no tests at all.
    - **Test files are never typechecked, by anything.** `tsconfig.json`
      excludes `*.test.ts(x)`, `__tests__/**`, `src/test/**` and `src/bench/**`,
      and ESLint here is not type-aware — so ~388k lines of test code have no
      type checking. `pnpm typecheck` covers production source only.
    - It skips coverage thresholds, `check:servers`, `check:build` and
      size-limit, the WebKit tier, all of Rust, and the soak tier.
    - `test:changed` runs the app tier's changed set, and adds the WHOLE gate
      tier when a `scripts/` or `.claude/hooks/` file changed (those gates are
      exercised through spawned subprocesses, which no import graph can see).
      It runs both tiers if the base ref cannot be resolved, rather than
      guessing.
    - It compares against `origin/main`, so `git fetch` first or it will
      select against a stale base.

  - **There are FOUR vitest tiers, and they must partition the test files.**
    `vitest.config.ts` runs the app (`src/**`, jsdom). `vitest.gates.config.ts`
    runs the gate self-tests (`scripts/**`, `.claude/hooks/**`, node, no
    `setup.ts`) via `pnpm test:gates`, which lives in `check:static` — so CI's
    required `frontend` job still blocks on every one of them. They spawn the
    lint scripts as subprocesses and were the slowest files in the repo (34s,
    27s, 26s…) against a ~100ms median app file. `vitest.browser.config.ts`
    (real WebKit) and `vitest.soak.config.ts` are the other two tiers.

    `scripts/check-scripts-parity.test.mjs` asserts the partition in both
    directions, **repository-wide**: a test file matched by no tier, or by two,
    fails. That assertion is the point — a dropped test file does not fail, it
    just stops running, and everything stays green. Roots whose tests belong to
    another runner (`server/`, `website/`) are exempted by name, and an
    exemption that no longer covers any test is itself a failure.

    Shared settings — worker count and the test-file extension set — live in
    `vitest.shared.ts`. Both existed as copies before, and the copies had
    already drifted: the app include accepted eight extensions while its
    webkit/soak excludes listed only `ts,tsx`, so a `*.webkit.test.mjs` would
    have run under jsdom and still looked correctly owned.

  - **jsdom is the default environment, not the rule.** A jsdom document costs
    ~3.3s of worker time per file and was 60% of the suite's total worker time.
    Most app-tier files carry `// @vitest-environment node` on line 1 and skip
    it — 834 of 1,439 at the time of writing, taking the environment phase from
    5216s to 1904s and the full coverage run from 832s to 536s.

    **Decide this by running the file, never by reading it.** The set was built
    by running the whole tier under `--environment=node` and marking every file
    that passed. A directory that reads as DOM-free is not: a 289-file sample
    chosen that way still had 28 files needing a real document. To mark a new
    file, add the docblock and run it — if it needs a DOM it fails immediately
    and says so. `src/test/nodeEnvironmentDirective.test.ts` guards the
    mechanism itself, because if Vitest ever stops honouring the docblock every
    marked file falls back to jsdom silently, and the only symptom is a slower
    run.

  - **Pushes to `main` and `v*` tags are gated at push time.** A versioned
    `pre-push` hook (`.githooks/pre-push`) gates release tags by verifying —
    via `gh api` (`scripts/check-tag-green.sh`, seconds per tag) — that the
    required CI checks (`frontend`, `rust`) are `completed`+`success` on the
    exact tagged commit; pending, failed, or missing checks refuse the push,
    and so does an unreachable `gh` (fail closed, never a silent pass).
    Direct pushes to `main` get an informational message only: branch
    protection (required checks + `enforce_admins`, since 2026-07-27) makes
    the remote authoritative there. `VMARK_OFFLINE_GATE=1` runs the full
    legacy local gate instead — a Windows cross-target compile check
    (`pnpm check:cross`; soft-skips if mingw-w64 isn't installed), then
    `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`
    (which `pnpm check:all`, frontend-only, never runs), then
    `pnpm check:all` — refusing the push if any is red. Timing for both
    modes lives in the hook's header (the authoritative claim).
    Feature-branch pushes are not
    gated locally — CI gates those via the PR's required `frontend` check. The hook is auto-enabled by the root
    `prepare` script (`git config core.hooksPath .githooks`) on `pnpm install`;
    if a fresh clone hasn't run install yet, enable it manually with the same
    command. Bypassing (`git push --no-verify`) requires explicit
    authorization — see `.claude/rules/60-ai-governance.md` §9.

  - **Commit MESSAGES are gated too — never compose one through a shell.**
    `.githooks/commit-msg` runs `scripts/check-commit-message.mjs` against the
    final message text and refuses an environment dump or a credential.

    It exists because commit `c506e3ff` put the entire exported environment —
    ~20 live credentials plus the sudo password — into a commit message that
    reached the public repo. The cause was **shell command substitution**: the
    message was built in an UNQUOTED heredoc and contained the markdown code
    span `` `export` ``, so zsh ran `export` and spliced its stdout into the
    text before git ever saw it. GitHub secret scanning does not list commit
    messages among the locations it scans, so nothing downstream caught it.

    **Write the message so no shell parses it**: `git commit -F message.txt`
    (file written by a file-write tool or an editor), or `<<'EOF'` with the
    delimiter QUOTED. `-m` is for one-line subjects with no punctuation.
    Single-quoting `-m` is **not** a fallback — an apostrophe ("the file's
    name") closes the quote and re-exposes the rest of the line to
    substitution; with two apostrophes the quotes rebalance and the backtick
    executes with no error at all.

    The gate is shape-based, not vendor-based, so an unknown provider's token
    inside a dump still trips it. Thresholds were **measured, not guessed**:
    replayed over all 4,533 commit messages in this repo's history it flags
    exactly one — the real leak. Keep it that way; if it ever fires on honest
    prose, rephrase the line rather than loosening the rule. **Changing a
    detector means re-measuring**: the module exports `findings(lines)`, so
    replaying it over `git log --all --format=%B` reproduces the number in
    seconds — do that instead of reasoning about whether a rule "looks" safe.
    It fails closed (no node → refuse), and `--no-verify` falls under
    `.claude/rules/60-ai-governance.md` §9.

  - **Real-WebKit tier (`pnpm test:browser`).** `pnpm check:all` is jsdom-only.
    The `*.webkit.test.ts` files run in real WebKit via Playwright and guard the
    CJK IME composition gate, whose premise jsdom cannot reproduce: real WebKit
    drains a microtask **between** capture listeners. `test:browser` installs
    the browser itself (`playwright install webkit`) — it used to fail on a
    fresh clone with "Executable doesn't exist", so the documented escape hatch
    was unusable. CI runs it as the `webkit` job, and the required `frontend`
    check fails if it does. On Linux the install needs `--with-deps`; the local
    script omits that because macOS has the libraries and asking for sudo on a
    dev machine is worse than a clear error.

  - **E2E testing:** see `dev-docs/e2e-testing.md` for the full guide (the two MCP
    bridges, the dev-mode reconfigure procedure, and the gotchas). Key rules:

    - E2E needs a running debug app (`pnpm tauri:dev`) — launch it or ask the user; unit
      tests and `pnpm check:all` do **not**.

    - **AI-driven features** (embedded browser automation, the `browser`/`document`/
      `selection`/`workspace` MCP tools, approval flows) are tested through **VMark MCP
      (`mcp__vmark__*`) exclusively** — that is the surface that ships. Do not fake an AI
      flow through the Tauri harness.

    - **Non-AI UI/plumbing** (menus, shortcuts, window/tab lifecycle, Tauri IPC,
      screenshots, logs) uses the **Tauri MCP** (`mcp__tauri__*`) — a debug-only harness,
      pinned to `127.0.0.1:9323` (`src-tauri/src/lib.rs`); connect with
      `tauri_driver_session` `start`, `port: 9323`. It is **absent in release builds**.

    - The VMark bridge port is **dynamic** (OS-assigned) — never point at a fixed port
      (9223 is discarded); the sidecar auto-discovers it from
      `~/Library/Application Support/app.vmark/mcp-port`. In dev, **rebuild the sidecar**
      (`pnpm --dir server/mcp build:sidecar`), reconfigure the client to the dev
      binary (Integrations settings / `mcp_config_install`), then **restart the AI
      client** — MCP servers bind at startup.

    - **Never use Chrome DevTools MCP** — VMark is a Tauri app, not a browser app.

  - **i18n gate has two halves.** `pnpm lint:i18n` checks that every key exists in
    every locale AND that values were actually translated. The second half exists
    because the first cannot see a key copied over with its English value — ~1,160
    of them had accumulated invisibly. That debt is now **paid: the baseline
    (`scripts/i18n-untranslated-baseline.json`) is empty.** Keep it empty — a new
    entry means a real regression, so translate the string instead of re-adding a
    line. It still ratchets: a new English-looking value fails, and so does a
    baselined entry you have since translated (record a win with
    `pnpm lint:i18n --update-untranslated`). A value counts only at ≥3 words and
    ≥15 characters, so `JSON`, `CLI`, `Markdown` and `VMark` are not flagged.

    Strings that can **never** be translated — a literal path, GitHub Actions
    runner labels, a bare `{{index}} / {{count}}` — do not belong in the baseline
    either. They go in `scripts/i18nIdenticalAllowlist.ts` **with a stated
    reason**, and are checked for staleness in both directions: translating an
    exempted string fails the gate until its dead exemption is deleted. Adding an
    entry there is a claim that the string is untranslatable, not that
    translating it is inconvenient.

  - **Locale bundles are FLAT — no nested objects, ever.** Every key in every
    `src/locales/*/*.json` is a flat literal containing dots
    (`"terminal.maxSessions": "…"`), never `{"terminal": {"maxSessions": …}}`.
    `src/locales/__tests__/localeShape.test.ts` fails on any nested object, on a
    key stored at two paths, and on a path English does not use.

    This is not a style preference. i18next resolves the **nested** form before
    a flat literal, so a bundle carrying both spellings of one key silently
    serves the nested one — a translation written to the flat key is dead and
    the user still sees English, while every key-presence check passes because
    flattening the two produces the same name. 747 such duplicates had
    accumulated, 14 actively hiding a translation. Banning nesting outright kills
    the bug class rather than detecting it: with no objects in the bundle,
    i18next's nested branch cannot match. Converging the other way would not
    have worked — a flat key added later would still be shadowed.

    The jsdom test mock (`src/test/setup.ts`) resolves flat-before-nested, the
    opposite of real i18next. That disagreement is only harmless while bundles
    stay flat, which is what the test enforces.

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

  - Plans are named `YYYYMMDD-name.md` and live in **one of two homes**: `dev-docs/plans/`
    (gitignored, maintainer-local) or `.claude/tdd-guardian/` (tracked — for a plan that must
    ship with the repo, e.g. one whose DoD script CI runs). See `60-ai-governance.md` §1 for
    which to pick; a rule naming only the gitignored home would have required deleting the two
    largest plans here to comply.

  - **Namespace a plan's WI-IDs** (`WI-AF1.2`, `WI-VC0.1`) whenever it coexists with other
    plans. Test-header linkage searches the whole repo, so a bare `WI-5.2` is satisfied by any
    test citing another plan's `WI-5.2` — a 19-item plan once reported every item linked with
    nothing implemented.

  - Every WI in a "complete" phase must be linked via a commit-message tag `(WI-1.2)` or a
    test-file header — checked by `scripts/check-wi-linkage.sh`. A bare mention in prose does
    not count, on either side: a commit that *describes* a work item is not evidence the work
    happened.

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

  - **Shell layer** (ADR-007): `src/shell/AppShell.tsx` is the composition root for the document window. It is pure layout: zero store imports, zero feature knowledge. ADR-007 calls for new top-level surfaces to be "slot registrations, not edits to `App.tsx`", but **no registration mechanism was ever built** — every surface is mounted by editing App.tsx's `<AppShell>` composition. `pnpm lint:shell-slots` enforces the checkable half instead: the identity list of mounted surfaces in `scripts/shell-slots-baseline.json`, failing both on an unlisted mount and on a listed surface that is gone. See `.claude/rules/32-component-patterns.md`.

