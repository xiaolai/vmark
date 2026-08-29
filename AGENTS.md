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

  - **`pnpm check:predelta` bridges the two — run it before the confirming
    `check:all`.** `check:all` exits on the FIRST failure, so a batch of
    independent `check:all`-only problems surfaces one per 15-minute run — using
    a slow gate for discovery, which this file forbids ("never use a slow gate as
    an instrument of discovery"). `check:predelta` runs **every**
    `check:static` leaf, plus `check:servers` and `check:build` and the
    runtime-file app tests — **in parallel, collecting EVERY failure at
    once** — and skips only the full instrumented app suite (`test:coverage`)
    and `test:changed`, which is a subset of it.

    The property it now guarantees, pinned by `check-predelta.test.mjs`: **a
    green `check:predelta` means `check:all` cannot die in a gate predelta
    could have run.** `lint` used to be excluded on the reasoning that
    `check:fast` covers it — true only if you happen to have run `check:fast`
    since your last edit, which a pre-push gate cannot assume. On 2026-08-21
    predelta reported all 38 gates green and the confirming `check:all` died
    ~40 seconds later on five eslint errors: one full cycle spent discovering
    what a cached, seconds-long gate already knew. eslint is `--cache`d and
    runs in parallel here, so including it costs nothing.

    `typecheck` has no gate of its own and is not skipped either — `check:build`
    → `build` → `typecheck`, so a type error surfaces as a `check:build`
    failure. Measured **1m41s vs ~15min** (2026-08-21, 40 gates;
    it was ~40s before `lint:type-aware` and `lint:test-types` joined
    `check:static` — both are ~95s and run in PARALLEL with each other, so they
    set the floor together rather than adding up). It finds the whole batch in
    one pass (the six issues the "does not see" list below can produce: a
    baseline ratchet, a knip finding, a corpus-enumerating test, a sidecar
    ESM/coverage break, a `size-limit` overflow). The gate list is DERIVED from
    `package.json`, so it cannot drift; `scripts/check-predelta.test.mjs` pins the
    derivation, the collect-all behaviour, and that it stays out of `check:all`
    (it is a pre-push helper, not a CI gate). It does NOT replace `check:all` —
    the full app coverage suite still runs there.

    What to run after a change:

    | What you changed | Run |
    |---|---|
    | One app `.ts`/`.tsx` | `pnpm test:changed`, or `pnpm vitest related <file>` |
    | A store/service with many importers | `pnpm test:changed` — the import graph handles the fan-out |
    | A lint gate under `scripts/` | that gate, plus its own `scripts/*.test.*` file |
    | Locale JSON | `pnpm lint:i18n && pnpm vitest run src/locales` |
    | CSS only | Nothing — visual QA instead (`.claude/rules/10-tdd.md` exempts CSS) |
    | Rust | `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --all-targets -- -D warnings` |
    | Rust, adding a `tauri::test` mock-runtime test | the row above, **plus** `bash scripts/check-cross-target.sh` |
    | Anything, before pushing | `pnpm check:predelta` (finds the batch in ~40s), then one `pnpm check:all` |

    **What `check:fast` does not see** — it is an incremental loop, and these
    gaps are why it can never replace `check:all`:

    - `vitest --changed` follows the **static import graph only**. Around 35
      test files read their subject at runtime with `readFileSync` — the
      baseline ratchets, the shell-slots identity list, the byte-identity
      check on `ci.yml` — so editing a baseline JSON or a workflow file
      changes nothing the graph can see and selects no tests at all.
    - **Test files are outside `pnpm typecheck`, and are covered by a separate
      gate.** `tsconfig.json` excludes `*.test.ts(x)`, `__tests__/**`,
      `src/test/**` and `src/bench/**`, vitest transpiles without checking
      types, and ESLint here is not type-aware — so ~404k lines across ~1,537
      files were checked by NOTHING. The failure mode is silent:
      `sourceCjkActions.test.ts` built its settings mock from three keys
      `CJKFormattingSettings` has never had and passed for months, because a
      mock that does not match its subject still satisfies a test written
      against the mock.

      `pnpm lint:test-types` (`tsconfig.test.json` +
      `scripts/check-test-types.mjs`, in `check:static`) closes it. Measured on
      adoption: **2,503 errors in 376 files**, all pre-existing, so it ships
      with a per-file baseline rather than at zero — fixing them is a real
      project and an unrelated one. The baseline ratchets DOWN two-way like
      every other one here, and the half that matters is immediate: a NEW test
      file, or a newly-broken one, fails from day one.

      It costs CI ~95s in the serial `check:static` chain, alongside
      `lint:type-aware`'s ~93s. That is the price of the only thing that reads
      404k lines of test code; pay it, or the class comes back silently.

      A COUNT rather than an identity list is a deliberate weakening: two
      errors on different lines of one file are indistinguishable without
      pinning line numbers, and a baseline that churns on every edit above a
      frozen error is a baseline people delete. The unit that matters — this
      file is dirty, and by how much — survives. `noUnusedLocals` and
      `noUnusedParameters` are off there: an unused fixture in a test is
      usually deliberate, and flagging it would bury the errors that matter
      under noise the linter already owns.
    - It skips coverage thresholds, `check:servers`, `check:build` and
      size-limit, the WebKit tier, all of Rust, and the soak tier.
    - `test:changed` runs the app tier's changed set, and adds the WHOLE gate
      tier when a `scripts/` or `.claude/hooks/` file changed (those gates are
      exercised through spawned subprocesses, which no import graph can see).
      It runs both tiers if the base ref cannot be resolved, rather than
      guessing.
    - It compares against `origin/main`, so `git fetch` first or it will
      select against a stale base.

  - **A docs-only PR skips the app tiers in CI.** `fe-test` (×4), `fe-coverage`,
    `fe-servers`, `fe-build`, `webkit` and `bench` are gated on a `code` output
    from the `changes` job, which is false when every changed file is prose.
    `fe-static` is deliberately NOT gated — it runs `lint:emdash` (scans every
    `*.md`) and `lint:keybinding-manifest` (reads `website/guide/shortcuts.md`),
    so prose is still verified by the gates that read prose. Measured: ~12
    runner-minutes down to ~3.

    Three things about it are load-bearing, and each fails SILENTLY:

    - **The prose list is an allowlist, never `!**/*.md`.** 50 markdown files
      live under `src/`, including the markdown-pipeline characterization corpus
      that round-trip tests read at RUNTIME. A blanket exclusion would skip the
      whole suite on exactly the change most able to break it, and every check
      would stay green.
    - **The `frontend` aggregate treats `skipped` as a pass.** It is a required
      check under `enforce_admins`, so without that clause every docs PR is
      unmergeable by anyone, including the owner. `rust` has always had it.
    - **`predicate-quantifier: some-with-excludes`.** Under dorny's default
      (`some`) a file counts if it matches ANY pattern, so `'**'` matches
      everything, `code` is always true, and the filter is a no-op that still
      looks wired up.

    `scripts/check-ci-docs-filter.test.mjs` pins all three; each was verified by
    mutation. Note the filter cannot be exercised by a PR that edits `ci.yml` —
    such a PR is not docs-only — so it is confirmed on the next prose-only PR.

  - **`tauri::test` does not exist on Windows, and only the Windows target can
    tell you.** `Cargo.toml` scopes tauri's `test` feature to
    `cfg(not(target_os = "windows"))` because the MockRuntime test binary dies at
    startup on windows-latest with `STATUS_ENTRYPOINT_NOT_FOUND` (0xc0000139).
    So every `tauri::test::` caller carries `#[cfg(not(target_os = "windows"))]`
    per item — `fs_scope.test.rs` and `mcp_bridge/*.test.rs` are the worked
    examples. An ungated one compiles and passes everywhere you can run it, and
    fails only on CI's Windows leg.

    `mod.test.rs` records the same class one step further out: merely binding a
    command as a FUNCTION POINTER emits a runtime symbol reference that drags
    WebView2 loader entry points into the lib test binary and reproduces the
    identical failure. It uses `use` instead, deliberately.

    `bash scripts/check-cross-target.sh` reproduces both in ~1 minute against
    `x86_64-pc-windows-gnu`. Run it whenever a Rust change adds a mock-runtime
    test; the alternative is finding out from a CI round trip.

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

    **Every config must stay loadable by Vite's `configLoader: 'native'`**, which
    is slated to become the default: no CJS `__dirname`/`__filename` (use
    `import.meta.dirname`), and a real file extension on every relative import
    (`"./vitest.shared.ts"`, not `"./vitest.shared"`). All five configs violated
    both, and the only symptom was a warning on every `pnpm dev` / `pnpm test` /
    `pnpm tauri dev` — read past until the default flips and configs stop
    loading. `src/test/viteConfigNativeLoader.test.ts` asserts the property
    (discovering the configs rather than listing them, so a new one is covered
    on creation). `tsconfig.node.json` carries the matching
    `allowImportingTsExtensions`; note it is NOT built by `pnpm typecheck`
    (`tsc --noEmit` does not build project references), so check it directly
    with `tsc -p tsconfig.node.json` — four real errors had accumulated there
    unseen.

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

  - **A raw NUL byte in a source file makes it invisible to grep.** `pnpm
    lint:no-nul-bytes` (`scripts/check-no-nul-bytes.mjs`, in `check:static`)
    refuses one in any tracked text file. A NUL is what every content sniffer
    uses to decide a file is BINARY, and each of them then fails SILENTLY:
    `grep -I` (and the ugrep/ripgrep shims built on it) skips the file and exits
    1 — indistinguishable from "no match" — while `git diff` prints "Binary
    files differ" and GitHub refuses to render the blob.

    Eleven files had one, including `scripts/check-commit-message.mjs` — the
    leak gate above. Grepping that file for its own exported `findings` returned
    nothing, with no error. Every site was a deliberate NUL used as a key
    separator or as test data, and none needed to be a raw byte: `\u0000` is the
    identical string value and leaves the file plain text.

    Two properties are load-bearing. **Unknown extensions are treated as text
    and therefore checked** — skipping by default is how a gate goes quiet; a
    genuinely binary new type fails loudly once and is added to
    `BINARY_EXTENSIONS` deliberately. And **binary files are identified by
    extension, never by asking git**: git's own text/binary detection keys on
    the presence of a NUL, so `git ls-files --eol` would classify exactly the
    offending files as binary and skip them, a circular test that always passes.
    Measured clean on adoption (92 binaries: 87 `.png`, 3 `.ico`, 2 `.icns`), so
    it ships zero-tolerance with **no baseline** — a baseline here would list
    files known to be invisible to grep.

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
      `~/Library/Application Support/<identifier>/mcp-port`. In dev, **rebuild the sidecar**
      (`pnpm --dir server/mcp build:sidecar`), reconfigure the client to the dev
      binary (Integrations settings / `mcp_config_install`), then **restart the AI
      client** — MCP servers bind at startup.

    - **`tauri dev` runs under its OWN identifier, `app.vmark.dev`.** Tauri derives
      `app_data_dir()`, `app_log_dir()` and the webview's `localStorage` from the
      bundle identifier and nothing else, so the identifier IS the profile. Until
      2026-08-25 `tauri.dev.conf.json` overrode only `bundle.icon`, and a debug
      build therefore shared one hot-exit session, one `workspaces/` directory and
      one `mcp-port` file with the VMark in `/Applications`. Two processes
      read-modify-writing one session is what it sounds like: a window whose tab
      strip stopped reflecting its own store, and stray tabs left in the
      maintainer's real app. The `mcp-port` half was worse and quieter — the dev
      app overwrote the port and token the release app had published, so a client
      configured for the release app talked to the dev build, then dialled a dead
      port when it exited.

      Consequences to know: dev has its OWN settings and session (empty on first
      launch — which is what CI sees, so local dev now matches it), its own logs
      under `~/Library/Logs/app.vmark.dev/`, and its own port file. To point an AI
      client at the DEV app, set `VMARK_APP_IDENTIFIER=app.vmark.dev`; the sidecar
      and `e2e/lib/vmarkMcp.mjs` both honour it, and e2e DERIVES it from
      `tauri.dev.conf.json` because e2e only ever drives a debug build. The
      keychain services (`app.vmark.secrets`, `app.vmark.browser.storagestate`)
      are deliberately NOT split: they are keyed atomic writes rather than a
      shared mutable session, so they were never part of the corruption, and
      splitting them would make dev lose the API keys that make it useful.
      `src/test/devProfileIsolation.test.ts` fails if the two identifiers ever
      converge again.

    - **Never use Chrome DevTools MCP** — VMark is a Tauri app, not a browser app.

  - **Theme contrast is measured from the catalog, not eyeballed.** `pnpm
    lint:theme-contrast` (`scripts/check-theme-contrast.ts`, in `check:static`)
    IMPORTS `src/theme/themes` via tsx and computes WCAG ratios for every
    colour token against every background its theme puts it on — text tokens at
    4.5:1, boundary/icon tokens at 3:1, rgba tokens COMPOSITED over the page
    first, the terminal's 16 ANSI slots, and (once WI-UI1.5 lands) the syntax
    palette. It imports rather than parses because `semantic: semanticLight` /
    `...sharedPrimitives` mean a text parser sees no literal for half of each
    theme; and it measures the EMITTED `--bg-tertiary`/`--contrast-text`
    through the same adapter the runtime uses, so what it checks is what
    renders. `scripts/theme-contrast-baseline.json` freezes today's failing
    pairs per theme (identity, ratchets down only — Phase 1 of
    `dev-docs/plans/20260829-ui-consistency.md` empties it); `ansiFloor`/
    `exempt` entries are permanent exceptions and REQUIRE a reason (D10:
    canonical Solarized bright slots are base tones, lifted at paint time by
    xterm's `minimumContrastRatio`, whose default the gate pins ≥ 4.5).

  - **UI consistency is one gate over CSS and JSX together.** `pnpm
    lint:ui-consistency` (`scripts/check-ui-consistency.mjs`, in `check:static`)
    walks every stylesheet on the shared `scripts/lib/cssRules.mjs` grammar AND
    every `.tsx` through the TypeScript AST, because half the drift lives in
    `className` strings no CSS gate can see. Eight checks: chrome type scale
    (C3), overlay shells composing a canonical panel (C4), `--font-sans` only
    under document selectors (C5), lucide icon sizes (C7), 24px hit targets
    (C8), hover/active/selected state vocabulary (C9), visible keyboard focus
    on every focusable element (C10), and bar-height/z-index literals (C11).
    `scripts/ui-consistency-baseline.json` holds one identity list per check
    (ratchets down; C4 alone reports additions). Permanent exceptions carry a
    `ui-ok(<check>): <reason>` marker — the reason is REQUIRED — and C10
    honours the existing `focus: caret-only — <reason>` grammar. This gate
    replaced `check-selection-styles.mjs` (registered in
    `check-deleted-names.mjs`): that script only scanned four selector name
    fragments and only against literals, so a wrong TOKEN passed.

  - **The IPC seam is checked across languages.** `pnpm lint:ipc-contract`
    (`scripts/check-ipc-contract.mjs`, in `check:static`) is the only gate that
    reads TypeScript and Rust together. `invoke("foo")` and `#[command] fn foo`
    are joined by the Tauri runtime on a STRING, so neither compiler can see the
    seam: a renamed command, or one dropped from `generate_handler!`, compiles on
    both sides and fails when a user clicks it. Two properties, both **measured
    at zero** on adoption (169 invoked commands resolve; 179 defined = 179
    registered), so it ships zero-tolerance with **no baseline** — do not add
    one, since a baseline here would list commands known to be broken at runtime.

    It parses a TS AST rather than grepping, for the reason
    `.claude/rules/50-codebase-conventions.md` already records: `invoke(` has 224
    call sites, **99 of them generic**, and both a hand-written regex and
    `ast-grep -p 'invoke($$$)'` find ~112 of 224 because nested generics
    (`invoke<Record<string, unknown>>(`) defeat them. On the Rust side it strips
    comments before matching and anchors the attribute to line start — its first
    run flagged `pty.rs`'s private `session_gone` helper because the string
    `#[tauri::command]` appears in that file's `//!` module doc. It matches both
    `#[tauri::command]` and the imported `#[command]`; matching only the
    qualified form reports 17 phantom findings. All three traps are pinned in
    `scripts/check-ipc-contract.test.mjs`.

    A command no literal `invoke()` names is **not** a failure — 5 call sites
    resolve the name from a `const`/`as const` map, and MCP and e2e paths reach
    others. `--report` lists them as information.

  - **A Tauri command that creates a window MUST be `async`** — `pnpm
    lint:window-thread` (`scripts/check-window-creation-thread.mjs`, in
    `check:static`). A command without `async` is `ExecutionContext::Blocking`,
    so Tauri runs the body inline on the thread that delivered the IPC message;
    on Windows that thread is inside WebView2's `WebMessageReceived` COM
    callback, and building a webview there is the reentrancy case WebView2
    forbids. Tauri says so in its own docs (`WebviewWindowBuilder::new`:
    "deadlocks when used in a synchronous command") and tauri-runtime-wry says
    it again at `create_webview` ("must be called from a separate thread,
    otherwise the channel will introduce a deadlock").

    **There is no macOS symptom, so nothing run locally can see it.** #1301 and
    #1302 are the bill: the Settings window opened from the status bar froze
    VMark 0.9.44 on Windows 11 and left a process Task Manager could not end,
    while the SAME window opened from the native menu worked — a menu click
    arrives through tao's event loop, not a WebView2 callback. That asymmetry is
    the fingerprint. Seven commands had it (`open_settings_window`, the three
    `open_*_in_new_window`, `hot_exit_restore_multi_window` — which runs at
    startup — and both `detach_*_to_new_window`).

    Measured at zero after the fix, so it ships zero-tolerance with **no
    baseline** — a baseline here would list commands known to hang Windows.
    Reachability is **visibility-aware**, and that is not tidiness: resolving
    calls by bare name reports 15 findings, 8 of them false, because the seed set
    holds two private helpers named `start` and two named `start_print`, and
    those names are written all over the crate. A
    private `fn` is callable only from its own file; with that one rule the same
    scan reports 7, all real. A command that hands creation to a spawned task is
    exempt via `// window-thread-ok: <reason>` — the reason is required.

    **Going async removes serialization the blocking IPC loop used to provide**,
    and two orderings had been relying on it. The Settings singleton's
    check-then-create became a real race, so creation is now IDEMPOTENT: the
    `build()` that loses focuses the winner's window instead of surfacing
    `WindowLabelAlreadyExists` as a failed open. A mutex would have been the
    obvious fix and is wrong — the non-macOS branch calls `Menu::new`, which
    blocks on the main thread, so a worker holding the lock while the main
    thread runs the menu's own Preferences handler deadlocks from the other
    side. And `detach_tab_to_new_window` now registers the tab payload BEFORE
    creating the window (with rollback), the ordering `workspace_transfer.rs`
    already documents: the target claims on mount, and a claim that beats the
    insert opens an empty window with the user's tab nowhere.

    The rule this leaves behind: **when a command goes async, re-read it for
    check-then-act.** A blocking command was serialized by the IPC loop for
    free, and that guarantee is invisible in the code that depended on it.

  - **Type-aware lint is a separate, slower gate.** `pnpm lint:type-aware`
    (`eslint.typeaware.config.mjs` + `scripts/check-type-aware.mjs`) is the only
    config here that builds a TypeScript `Program`, so it is the only one that
    can reason across files. It costs ~1–4 min against `pnpm lint`'s seconds, so
    it lives in `check:static` and deliberately **not** in `check:fast` — a slow
    inner loop is a disabled gate.

    Rule choice was **measured, not tasteful**: `recommendedTypeChecked` reports
    420 findings, 183 of them `no-unnecessary-type-assertion`, which would bury
    the rest. The six enabled rules are the ones whose violations are runtime
    defects — `no-floating-promises` and `no-misused-promises` dominate at 132 of
    152, and in an app where every backend call is `invoke()` an unawaited
    promise is a rejection nobody sees. `no-base-to-string` is the
    `"[object Object]"` class that already shipped to users four times (see
    §"Why `CommandError`"); the bespoke ratchet catches it only at command
    boundaries, this catches it everywhere.

    The baseline is per-file-per-rule and ratchets DOWN two-way, like every other
    ratchet here. **The gate filters eslint's report to the rules its config
    exports** (`TYPE_AWARE_RULES`): running that config still reports 76
    `react-hooks/*` findings at severity 2 that `pnpm lint` already owns, and
    baselining them would double-count one violation under two gates.

  - **Unused Cargo deps are checked in CI, not `check:all`.** `cargo machete`
    runs on the Linux leg of `rust-test` (`pnpm lint:rust-deps` locally). It is
    NOT in `check:all` because `check:all` never invokes cargo at all — the
    frontend runner has no Rust toolchain, and installing one to lint a TOML
    file would be minutes for nothing. Measured clean on adoption, so it is a
    hard failure with no allowlist.

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

  - **Selection states**: `--accent-bg` background, `--text-color` text, `--accent-primary` icons and indicators (R6 — accent-on-accent-tint text fails AA on paper, which is why text keeps its ink).

  - **Focus indicators**: MUST be visible (accessibility). Use the flat 2px bar (D4, rule 33 §1) for buttons, bottom-border for inputs.

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

