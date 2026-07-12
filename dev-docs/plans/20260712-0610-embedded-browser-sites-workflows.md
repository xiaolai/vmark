# Embedded Browser, Site Plugin System & Web Workflows

> Created: 2026-07-12
> Revised: 2026-07-12 (post-Codex review — **architecture change**: the browser is a
>   **raw native webview owned by VMark, NOT a Tauri-created webview**. Codex refuted
>   the original R3 by showing Tauri unconditionally injects its IPC bridge into every
>   webview it creates (`tauri-2.11.5/src/manager/webview.rs:166-224`), verified in
>   this repo's dependency tree. Also: tab model becomes a discriminated union;
>   `add_child`/`unstable` dropped; async eval via `callAsyncJavaScript`; concurrency
>   arbitration, browser-UX completeness (downloads/popups/dialogs/permissions), and
>   operation-based approval added; Phase 0 re-spiked. See §17 for the full
>   review-response ledger.)
> Status: DRAFT (revised) — Phase 0 scaffolding + pure security/parsing core landed on
>   `feature/embedded-browser`; native Phase 0 spikes are the blocking next step (human-run).
>   Governance §6 cross-model review DONE twice (Codex: MAJOR GAPS → NEEDS REVISION).
> Updated: 2026-07-12 — On branch `feature/embedded-browser`, built the parts of the plan
>   that are pure, testable, and NOT gated by the native halt-gate, TDD-first:
>   - **Origin guard** (`src/lib/browser/origin/originGuard.ts`) — R4/I3/R7a enforcement
>     core: canonicalization (IDN→punycode, port/dot normalization, opaque-origin +
>     empty-label rejection) + grant matching (no implicit wildcarding, no apex/look-alike
>     match). Hardened against a real userinfo-authority bypass (`https://*.x.com@evil.com`)
>     found by the audit.
>   - **Site registry** (`src/lib/sites/registry.ts`) — WI-3.1: origin-dispatch, frozen
>     manifests, specificity-ranked wildcard precedence, full validation.
>   - **Workflow parser** (`src/lib/browser/workflow/parser.ts`) — WI-4.1: front-matter +
>     typed steps → IR with coded, line-located diagnostics.
>   - **Phase-0 infra**: `scripts/check-browser-phase.sh` (fail-closed) + 7 spike stubs
>     under `dev-docs/grills/embedded-browser/` (all NOT_RUN — they need a live Tauri
>     session + accounts, so a human runs them), + §13 TDD-hook scope extension.
>   114 tests, 100% line / 96% branch coverage; tsc + eslint clean. Ran `/audit-fix`
>   (Codex auditor, Claude fixer) — 2 fix rounds, final verify **ACCEPTED**. NOT built:
>   all native/Rust/GUI WIs (Phases 1-2 surface/driver, 3 publishers, 4 engine, 5) —
>   they are gated behind the Phase 0 spikes per §7 and cannot be verified autonomously.
>   No commits made (awaiting explicit request).
> Updated: 2026-07-12 — **Phase 0: the two highest-risk assertions retired with empirical
>   evidence** via a real objc2 probe (`dev-docs/grills/embedded-browser/spike1-probe/`,
>   standalone crate, isolated from the app — no workspace membership, cannot affect app
>   build/gates):
>   - **SPIKE-1 no-bridge (the BLOCKING halt-condition, R3/I1): PASS.** A VMark-constructed
>     `WKWebView` (fresh `WKWebViewConfiguration`) evaluates to
>     `{__TAURI_INTERNALS__, __TAURI__, ipc} all "undefined"`. The core security invariant
>     is confirmed at runtime, not just from source — the plan is **not** halted.
>   - **SPIKE-2 async eval (ADR-B3, publishing primitive): PASS.** `callAsyncJavaScript`
>     awaits a real Promise and returns the resolved value (42) in `WKContentWorld.pageWorld`.
>     The macOS dependency matrix (objc2 0.6.4 / web-kit 0.3.2 / block2 0.6.2) **compiles**.
>   Both spikes remain **PARTIAL** overall (SPIKE-1's embedding-into-the-Tauri-window half
>   and SPIKE-2's Windows/Linux matrix still need a live session), so the Phase 0 gate stays
>   correctly red. SPIKE-3/4/5/6/7 are NOT_RUN (GUI/accounts/other-OS). See SPIKE-1.md,
>   SPIKE-2.md for the probe output. Net: the architecture's make-or-break risk (Tauri
>   bridge injection) is empirically cleared.
> Updated: 2026-07-12 — **SPIKE-1 now FULLY PASS (both halves), with visual proof.** Ran
>   `pnpm tauri dev`, connected via the Tauri automation MCP (port 9323), added a
>   debug-only throwaway command (`src-tauri/src/spike_embed.rs`) that embeds a
>   VMark-constructed `WKWebView` as a subview of the REAL main window's content view,
>   invoked it via `__TAURI_INTERNALS__.invoke`, and captured the window by id. Result:
>   the embedded webview renders visibly on top of the editor
>   (`dev-docs/grills/embedded-browser/spike1-embedded-evidence.png`), and **wry does not
>   reclaim the content view** — closing the exact risk Codex round-2 flagged. The
>   Phase-0 gate now shows SPIKE-1 PASS. ADR-B2's embedding path is validated in situ, not
>   just by source reading. **Leftover state (uncommitted, feature branch):** the
>   debug-only `spike_embed` command + its `lib.rs` registration + the `NSArray`
>   `objc2-foundation` feature in `src-tauri/Cargo.toml` remain in the tree as a working
>   reference for WI-1.2; they are `#[cfg(all(debug_assertions, target_os="macos"))]` and
>   marked throwaway. A `pnpm tauri dev` instance is still running with the red probe
>   webview overlaying the editor — restart it to clear.
> Updated: 2026-07-12 — **Phase 0 driven to its environmental limit — all architectural
>   questions resolved favorably.** Ran the remaining spikes live via the automation MCP +
>   debug probe commands in `src/spike_embed.rs`:
>   | Spike | Result | Evidence |
>   |---|---|---|
>   | 1 owned webview + no-bridge (BLOCKING) | **PASS** | globals undefined; embedded render screenshot |
>   | 2 sync/async eval + macOS dep matrix | **PASS** | `callAsyncJavaScript`→42; real fetch awaited |
>   | 3 trusted NSEvent input (Q6) | **REFUTED** (design-consistent) | `received:false`; macOS = synthetic tier, trusted = Windows/CDP |
>   | 4 profile persistence/isolation | **PASS** | macOS 26; identifier store no-crash; default persistent |
>   | 5 occlusion `takeSnapshot` | **PASS** | 14ms capture, full-size image |
>   | 6 Windows+Linux embedding | **BLOCKED** | needs those OSes — macOS-only env |
>   | 7 publishing mechanism (ADR-S4) | **PASS (mechanism)** | in-page credentialed fetch carried the session cookie; real draft/CSRF need a target |
>   Gate shows 4/7 PASS. The 3 non-PASS are NOT architecture risks: SPIKE-3 is a confirmed
>   limitation the design already handles, SPIKE-6 needs other hardware, SPIKE-7's mechanism
>   is proven and only the real-platform draft/CSRF remain. **Every make-or-break question
>   (bridge injection, embedding, async eval for publishing, occlusion latency, session
>   persistence, credentialed same-origin fetch) is answered with runtime evidence.** The
>   architecture is validated; Phase 1 can begin. Remaining Phase-0-gate-green items are
>   environment-dependent (hardware, a publish target), not design-dependent.
>   Debug probe commands (`spike_embed_browser/snapshot/datastore/trusted_input/fetch`) +
>   their `Cargo.toml` deps (block2, several objc2 features) remain as validated WI-1.2/1.4/
>   3.4 reference recipes — all `#[cfg(debug_assertions, macos)]`, removable.
> Updated: 2026-07-12 — **Phase 1 started: WI-1.1 (tab discriminated union + versioned
>   persistence) landed, TDD-first, `pnpm tsc` + all unit/Rust tests green.**
>   - `Tab` is now `DocumentTab | BrowserTab` (`src/stores/tabStoreTypes.ts`) with
>     `isDocumentTab`/`isBrowserTab`/`tabFilePath` guards. `DocumentTab` keeps the historical
>     contract (only a `kind:"document"` discriminant added); `BrowserTab` carries
>     `{kind,url,title,isPinned,scrollY?}` and has **no** `filePath`/`formatId`.
>   - Store: `createBrowserTab` (canonical-URL dedup via new `src/lib/browser/url.ts`) +
>     `updateBrowserTab`; `createTransferredTab` is now document-only.
>   - `Editor.tsx` branches on `isBrowserTab` **before** `dispatchEditor` (R1 core). The
>     whole-app narrowing sweep (~25 files, 49 sites) is complete and type-green; browser
>     tabs are correctly excluded from path queries, save, transfer, hot-exit, crash
>     recovery, and the legacy MCP session (D1-7).
>   - Transfer of a browser tab is an explicit, user-visible no-op
>     (`dialog:toast.cannotMoveBrowserTab`).
>   - **Persistence deviation (recorded, with rationale):** the plan said "retype
>     `lastOpenTabs` → versioned record." That would break a real *downgrade* — the Rust
>     `WorkspaceConfig.last_open_tabs: Vec<String>` on an older binary would serde-choke on a
>     JSON object, contradicting the WI-1.1 acceptance "browser tab in a downgraded build is
>     skipped, not a crash." Implemented the **downgrade-safe additive** design instead:
>     `lastOpenTabs` stays `string[]` (document paths → old binaries still restore docs) and a
>     new additive `sessionTabs` versioned record (`services/persistence/sessionTabs.ts`, opaque
>     `Option<serde_json::Value>` in Rust) carries the full ordered list incl. browser tabs.
>     New builds prefer `sessionTabs`; unknown record kinds / future versions / malformed
>     records are skipped with a warn (forward tolerance). Write + read paths wired
>     (`workspaceSession.ts`, `useWorkspaceBootstrap.ts`, workspace open/recent commands).
>     Browser-tab *restore into a live surface* is intentionally deferred to WI-1.3/1.10
>     (needs the surface + feature flag); the records round-trip now.
>   - Remaining Phase 1: WI-1.2 (native WKWebView surface) … WI-1.10. WI-1.2 is the
>     native halt-gate item (human-run verification).
> Branch (proposed): `feature/embedded-browser`
> Related: `20260331-workflow-engine.md` (Genie/internal workflow engine — distinct;
>   see §1.5), `decisions/ADR-002-mcp-sidecar-architecture.md` (MCP bridge reused here)

---

## 1. Executive summary

Add a **real, visible, AI-drivable web browser inside VMark**, plus the two
systems that make it useful for a writer: a **site plugin system** (per-platform
read + publish adapters) and a **web workflow engine** (user-defined automations
authored as markdown documents).

The browser is a genuine native webview embedded in the VMark window — not an
external Chrome, not an iframe, and **not a Tauri webview**. VMark creates the
platform webview itself (`WKWebView` via `objc2-web-kit` on macOS; `WebView2` via
`webview2-com` on Windows; `webkit2gtk` on Linux) and adds it as a **native child
view** of the Tauri window's content view. It uses the OS webview, so VMark ships
**no bundled browser engine**.

**Why VMark owns the webview instead of asking Tauri for one** (the central
correction from the Codex review): Tauri unconditionally prepends
`__TAURI_INTERNALS__`, the invoke bridge, and plugin init scripts to *every*
webview it creates — `add_child` included (`manager/webview.rs:166-224`,
verified in `tauri-2.11.5`). A capability file restricts *authorization*, not
*injection*. So a Tauri-created browser webview would hand every hostile page a
live IPC object to probe. Owning the webview directly makes the security
invariant **structural rather than configured**, and it costs nothing: `objc2`,
`objc2-app-kit` (`NSView`/`NSWindow`), and `objc2-web-kit` (`WKWebView`,
`WKWebViewConfiguration`, `WKNavigationDelegate`, `block2`) are **already direct
dependencies of this repo** (`src-tauri/Cargo.toml:65-70`).

Owning the webview also buys, for free, the things the original design lacked:
`WKContentWorld` (run the automation agent in an **isolated JS world** the page
cannot see or tamper with), `callAsyncJavaScript` (**await** `fetch()` — the
original `evaluateJavaScript` cannot await a Promise, which the publishing
mechanism depends on), `WKWebsiteDataStore` (profiles), and the `WKUIDelegate` /
`WKNavigationDelegate` / `WKDownloadDelegate` hooks needed for dialogs, popups,
downloads, and TLS errors. It also **removes the dependency on Tauri's `unstable`
`add_child`** and its open rendering/positioning/user-agent bugs entirely.

The page is driven strictly one-directionally (Rust → page). A hostile page has
no channel into VMark because no bridge is ever injected.

Three pillars, delivered in order:

1. **Embedded browser** — a browser page is a first-class *tab* (new `kind:
   "browser"` on the existing `Tab`), rendered as a native webview positioned over
   a reserved rect in the pane. Reuses VMark's tab strip, pane splitting, and
   workspace-rail grouping wholesale. Sessions persist per-profile so the user
   logs into each platform once, visibly (QR scans "just work").
2. **Site plugin system** — a registry (`src/lib/sites/`) that mirrors the format
   adapter registry, dispatching on **origin**. Each plugin declares its origins
   (the security boundary), an in-page module (DOM extraction + same-origin
   `fetch()` publishing), and a host orchestrator implementing `SiteReader` /
   `SitePublisher`. A generic Readability+Turndown reader makes *every* site
   readable with zero plugins.
3. **Web workflow engine** — user automations authored as markdown files with
   typed steps executed across **four tiers**: same-origin API replay, semantic
   DOM locators, AI goal loops, and vision+native-input fallback. A recorder in
   the visible pane captures action + network traces; a self-healing loop repairs
   broken steps and proposes file patches.

**What this is NOT:** a headless scraper, a bundled Chromium, a bot farm, or a
credential store. It is a browser the human can also use by hand, that the AI can
drive under an origin allowlist and per-action approval, with the user's own
sessions.

### 1.1 Why it's feasible in this codebase

VMark already runs the exact machinery each pillar needs:

- **Sidecar/child-process pattern** proven twice (`vmark-mcp-server` externalBin;
  the Node content server in `src-tauri/src/content_server/spawn.rs` with
  login-shell PATH resolution + supervision + bounded restart).
- **Tab/pane/workspace model** is already generic: `Tab` is renderer-agnostic
  (`Editor.tsx` branches on `formatId.kind`); `DocumentSplitContainer` + `paneStore`
  give two-pane splits; `workspaceInstancesStore` + WorkspaceRail already give
  "grouped tab sets" (the "dedicated browser workspace" falls out for free).
- **Registry pattern** proven in `src/lib/formats/registry.ts` (validated
  `registerFormat`, `dispatchEditor` resolution, settings-gated bootstrap).
- **MCP bridge v2** (`src/hooks/mcpBridge/v2/`) with a pruned tool surface, an
  origin/path guard (`mcp_bridge_path_guard.rs`), read-only guards, and an
  approval-gate precedent. A `vmark.browser` domain slots in beside the existing 5.
- **reqwest** singleton, real outbound fetch (`gha_workflow/action_fetch.rs`), and
  a per-platform `#[cfg(target_os)]` isolation discipline already mandated.

### 1.2 The load-bearing security decision

The embedded browser is a high-privilege capability: an AI driving a browser that
holds the user's logged-in sessions. The design rests on one invariant, now stated
precisely (the Codex review correctly flagged that "no IPC" was three different
claims wearing one name):

> **I1 — No bridge object exists.** The browser webview is created by VMark, not by
> Tauri. Its `WKWebViewConfiguration` / `CoreWebView2` is constructed from scratch;
> no Tauri init script, no `__TAURI_INTERNALS__`, no `window.ipc`, no plugin API is
> ever injected. This is verifiable at runtime by a probe (see WI-0.1) and is
> structural — it cannot be misconfigured away by editing a capability file.
>
> **I2 — The automation agent is unreachable from page JS.** The agent runs in an
> isolated world (`WKContentWorld::world(name)` on macOS; a dedicated
> `AddScriptToExecuteOnDocumentCreated` world / `ExecuteScriptInIsolatedWorld` on
> WebView2). Page script cannot read, call, or shim it.
>
> **I3 — The driver can only touch origins that are explicitly granted.** Enforced
> in Rust before any eval/navigate/inject, over a canonicalized origin (scheme +
> host + port, IDN→punycode, default-port normalization). Grants come from a site
> plugin's declared origins, or a per-tab user-approved generic-read grant (R7a).

Everything else (approval gates, flags, draft-first publishing) is defense in depth
layered on top of these three. Defaulted off; write-class operations gated per
action. This is the MCP path-guard philosophy applied to origins.

### 1.3 Non-goals

- No bundled/embedded Chromium (CEF). System webview only. (ADR-B1.)
- No remote/auto-updating third-party plugin marketplace in v1. (ADR-S3.)
- No headless mode in v1 — the browser is always the visible pane. (Headless is a
  v2 consideration for unattended workflows.)
- No credential storage by VMark. Sessions live in the OS webview data store only.
- No defeating of anti-automation (CAPTCHA solving, fingerprint spoofing). Hostile
  targets stay manual-in-the-pane.

### 1.4 Platform reality

VMark constructs and owns the webview on every platform. The embedding mechanism and
the driver primitives differ per platform; the injected agent (JS) and the publishing
adapters (same-origin fetch) are engine-neutral.

| Concern | macOS (**primary**) | Windows (best-effort) | Linux (best-effort) |
|---|---|---|---|
| Engine | WKWebView (WebKit) | WebView2 (Chromium) | webkit2gtk |
| Embed as | `NSView` subview of the window's content view (`objc2-app-kit`) | `CoreWebView2Controller` bounded to the parent `HWND` (`webview2-com`) | `GtkWidget` in the window's GTK container |
| Sync eval | `evaluateJavaScript:completionHandler:` | `ExecuteScript` | `evaluate_javascript` |
| **Async eval (await fetch)** | **`callAsyncJavaScript:` (macOS 11+)** — required; `evaluateJavaScript` does **not** await Promises | `ExecuteScript` returns a JSON promise result | `evaluate_javascript` + explicit promise-resolution shim |
| Isolated world (I2) | `WKContentWorld::world(name)` ✅ verified | **UNRESOLVED** — `ExecuteScriptInIsolatedWorld` does **not** exist in the checked `webview2-com` bindings; the likely path is a **CDP-based isolated world** (`Page.createIsolatedWorld` + `Runtime.evaluate` with the context id). **Must be spiked (WI-0.6).** | `webkit_web_view_run_javascript_in_world` / `call_async_javascript_function(..., world_name)` ✅ **named worlds DO exist** (record the WebKitGTK version floor) |
| Screenshot | `takeSnapshotWithConfiguration:` | CDP `Page.captureScreenshot` | `get_snapshot` |
| Trusted input | NSEvent synthesis (**unproven — see Q6**) | **CDP `Input.dispatchMouseEvent` (genuinely trusted)** | synthetic only (X11/Wayland injection out of scope v1) |
| Network recording | fetch/XHR interception only (**partial — see R10**) | **CDP Network domain (complete)** | fetch/XHR interception only (partial) |
| Dialogs/popups/downloads | `WKUIDelegate`, `WKDownloadDelegate` | `CoreWebView2` events | webkit2gtk signals |

Asymmetries stated as first-class limitations rather than assumptions:

- **Windows has the strongest automation substrate** (CDP gives trusted input *and*
  complete network capture). macOS trusted input is unproven (Q6); Linux has none.
- **WebKit cannot fully record network traffic** — it misses service workers, WebSockets,
  beacons, native form posts, and anything before injection. This **bounds** the recorder
  (R10), it does not merely inconvenience it.
- **Isolated worlds are NOT uniformly available, and my first two guesses were both
  wrong** (Codex round-2 checked the actual bindings): Linux **does** have named worlds;
  Windows **does not** have the API I originally named and likely needs a CDP-created
  isolated world. The one platform I was right about is macOS. **WI-0.6 must resolve
  Windows before I2 can be claimed cross-platform** — until then, I2 is a macOS+Linux
  guarantee and a Windows *intention*.

Per project policy macOS is primary and must never regress; but because the *embedding
mechanism itself* is now platform-specific rather than delegated to Tauri, Windows and
Linux embedding are **spiked in Phase 0** (WI-0.6) rather than deferred to Phase 5 —
deferring them would let a macOS-shaped abstraction harden and then break.

### 1.5 Relationship to the existing workflow engine

`20260331-workflow-engine.md` is a **VMark-internal Genie workflow engine** (a
constrained YAML subset orchestrating AI genies over documents). This plan's
**web workflow engine** (Pillar 3) automates *websites in the embedded browser*.
They share the "workflow = authored file, executed step-by-step" philosophy and
should share the approval-gate and run-log UX, but they operate on different
substrates (genies+documents vs. browser+sites). Unification is out of scope; §6
notes the seams to keep compatible.

---

## 2. Outcomes

- **Desired behavior:**
  - A user opens a web page as a tab inside VMark, splits it beside a markdown
    draft, and reads/writes in one window.
  - The user logs into content platforms once, visibly, and sessions persist.
  - An AI (internal genie or external client) can read the current page, extract
    it to clean markdown, and — with per-action approval — create drafts / publish
    to supported platforms using the user's own sessions.
  - The user authors a workflow as a markdown file and runs it against a site;
    steps execute across four tiers; broken steps self-heal with an approved patch.
- **Constraints:**
  - System webview only; no bundled engine; no macOS regression.
  - Browsed pages get zero IPC; driver confined to declared origins.
  - Writes/publishes gated by per-action approval; feature default-off.
  - Under VMark's TDD gate, i18n (`t()`/`t!()`), file-size (<300 LOC), and
    `pnpm check:all` throughout.
- **Non-goals:** see §1.3.

## 3. Constraints & Dependencies

- **Runtime/toolchain:** Tauri v2 (`features = ["protocol-asset"]`). The **`unstable`
  feature is NOT needed** — the revised design does not use `add_child`. React 19,
  Zustand v5, CodeMirror 6, Vitest v4, pnpm.
- **OS/platform:** macOS min is **10.15** (`tauri.conf.json` `minimumSystemVersion`).
  Two version floors bite and must be handled, not assumed away:
  - `callAsyncJavaScript` (async eval — **load-bearing for publishing**) is **macOS 11+**.
    Below 11: no async eval ⇒ publishing/workflows disabled (read-only browser). Decide
    in WI-0.2 whether to raise the app floor to 11 instead (Q7).
  - `WKWebsiteDataStore(identifier:)` (profile isolation) is **macOS 14+**. Below 14:
    fall back to the default persistent store — **persistence is preserved, isolation
    is lost** (verified against `wry-0.55.1/src/wkwebview/mod.rs:221-243`, which does
    exactly this). This is a documented degradation, not a silent one (ADR-B4).
  - Windows WebView2 runtime assumed present (Win 11 ships it); detect + surface a
    clear error if missing.
- **Rust deps — already direct in this repo** (`src-tauri/Cargo.toml:65-70`): `objc2`,
  `objc2-app-kit` (has `NSView`/`NSWindow`), `objc2-web-kit` (has `WKWebView`,
  `WKWebViewConfiguration`, `WKNavigationDelegate`, `block2`), `objc2-foundation`.
  **To add (feature flags on existing crates, plus new targets):**
  - macOS: `objc2-web-kit` features `WKUIDelegate`, `WKDownloadDelegate`,
    `WKContentWorld`, `WKWebsiteDataStore`, `WKUserContentController`,
    `WKUserScript`, `WKPreferences`; `objc2-app-kit` feature `NSEvent` (trusted input).
  - Windows: `webview2-com` + `windows` crate (verify exact versions; wry pulls
    `webview2-com` transitively but a direct dep is required).
  - Linux: `webkit2gtk` + `gtk` (direct).
  - **Action:** WI-0.2 produces an exact target-specific dependency matrix that
    compiles under both the release profile and `pnpm check:cross`. (The original
    plan listed objc2 as "new" — it is not; that section was stale. Codex caught this.)
- **New npm deps (candidates):** `@mozilla/readability` + `turndown` (generic
  reader, in-webview). Both mature, high-download — but MUST pass
  `scripts/check-new-deps.sh` (governance §4) and be acknowledged in the PR.
- **Feature flags:** all behavior behind `settings.browser.enabled` (default
  **false**) and sub-flags per §12. Third-party plugins behind a further flag.
- **Capabilities:** a new `src-tauri/capabilities/browser.json` scopes the *Rust
  driver commands* (invoked by VMark's own React webview) to document windows. The
  **browser webview needs no capability at all** — it is not a Tauri webview and has
  no IPC surface (I1). This is the point of the redesign.

## 4. Current Behavior Inventory

- **Entry points:** `Editor.tsx` resolves the active tab's `FormatConfig` via
  `dispatchEditor(filePath)` and renders with `key={tabId}-${formatConfig.id}`
  (remount-on-switch, ADR-10). Branches on `kind`: `wysiwyg` | `media` | else
  SplitPane. No non-document tab kind exists today.
- **Tab model:** `Tab` (`src/stores/tabStoreTypes.ts`) = `{id, filePath|null,
  title, isPinned, formatId, viewMode?, ...}`. `tabStore` keyed by window label.
- **Layout:** `AppShell` (4 slots) → `EditorArea` (editor + 40px bottom bar +
  optional edge panel) → `DocumentSplitContainer` (1 or 2 `PaneProvider` panes via
  `paneStore`) → `Editor`. `TerminalPanel` is an in-window dockable edge panel, not
  a window. Overlays (QuickOpen, CommandPalette, dialogs) render in AppShell
  `overlays` slot as z-stacked portals.
- **Windows:** native Tauri windows (`window_manager.rs`): `main`, `doc-*`
  (document windows) + `settings`, `pdf-export` (router routes). Workspace =
  opened folder root (`workspaceStore`); one window hosts multiple workspace
  *instances* (`workspaceInstancesStore`, kinds `placeholder|loose|folder-backed`),
  switched via WorkspaceRail; each instance owns a `tabIds` set.
- **Registry precedent:** `src/lib/formats/` — `registerFormat`/`dispatchEditor`/
  `bootstrapFormats`; `FormatConfig` reserves an unrendered `sidePanelComponent`
  slot.
- **MCP flow:** external client → stdio → sidecar → WS → Rust bridge
  (`mcp_bridge/`) → Tauri event `mcp-bridge:request` → `useMcpBridge` →
  `handleRequest` → read-only guard → `dispatchV2` over 5 tools
  (`vmark.session/workspace/document/workflow/selection`). Path confinement:
  `mcp_bridge_path_guard.rs` + `bridgePathGuard.ts` + `mcpBridgePathPolicy.ts`.
- **Process spawn:** `content_server/spawn.rs` (`resolve_node` via
  `login_shell_path`, piped stdio → `tauri-plugin-log`, `monitor_child` + bounded
  frontend restart on `content-server:exited`). `ai_provider/spawn.rs`
  (`build_command`, Windows `.cmd` shim, `CREATE_NO_WINDOW`). `pty.rs`
  (`portable-pty`, per-session channel).
- **Known invariants:** no Zustand destructuring in components (selectors only);
  `getState()` in callbacks; features local; files <300 LOC; tokens-first CSS;
  three-tier `utils/services/hooks` import rule (ADR-013); shell layer store-free
  (ADR-007).

## 5. Target Rules (with precedence)

**R1 — Tab is a discriminated union; a browser tab is not a document.**
`Tab` becomes `DocumentTab | BrowserTab` discriminated on `kind`. `DocumentTab` keeps
today's contract unchanged (`filePath`, `formatId` — both effectively mandatory;
`tabStore` derives `formatId` on every create/update). `BrowserTab` carries
`{kind:"browser", url, title, scrollY}` and has **no** `filePath`/`formatId`.
- `Editor.tsx` MUST branch on `tab.kind` **before** calling `dispatchEditor(filePath)`
  — otherwise a browser tab (`filePath: null`) resolves as an untitled markdown doc.
- Browser tabs need their own create / restore / close / hibernate paths, and
  `WorkspaceConfig.lastOpenTabs` (today `string[]` of paths) must become a versioned
  record type.
- Browser tabs do **not** get workspace transfer (detach-to-window, duplicate) in v1 —
  the transfer payload requires document content, saved content, dirty state, and
  `formatId`. Transfer of a browser tab is an explicit no-op with a user-visible reason.
- *Correction from v1 of this plan:* "participates wholesale, no special-casing" was
  wrong. The tab strip, pane splitting, and workspace-instance grouping do compose for
  free; **persistence, dispatch, and transfer do not**. (Codex D1-2/3/4/5.)

**R2 — Native view floats above ALL DOM; overlays must freeze it.**
The native webview is a sibling native view over the React webview, so it paints above
every DOM element regardless of z-index. Any overlay (AppShell `overlays` slot, popups,
context menus, split-drag) intersecting the browser rect MUST freeze-to-snapshot:
capture → swap in an `<img>` in-rect → hide the native view → restore on close.
Requirements this rule carries, all testable: capture is **async and may fail** (fall
back to hiding the view, never show a stale frame); hide/show is race-free under rapid
open/close (generation counter); focus and **IME composition** state restored on thaw;
scroll preserved; no visible flicker at 1× and 2× DPI. *Failure mode if skipped:*
overlays are invisible under the browser. (Codex D3-4/D5-3.)

**R3 — No bridge object exists in the browsed page.**
The browser webview is **created by VMark, not Tauri** (ADR-B2), so Tauri's
unconditional IPC injection (`manager/webview.rs:166-224`) never runs for it. The page
has no `__TAURI_INTERNALS__`, no `window.ipc`, no plugin API. The automation agent runs
in an **isolated content world** (I2) that page script cannot see or shim. The driver is
strictly one-directional (Rust → page); results return as eval values, never as
page-initiated messages.
- *Verification is part of the rule:* WI-0.1 ships a runtime probe asserting those
  globals are absent on a hostile test page; it is a **blocking Phase 0 gate** and a
  permanent regression test. An invariant this load-bearing is not allowed to be
  assumed. (Codex D1-1/D3-1/D5-1 — this refuted v1 and drove the redesign.)

**R3a — Negative capability: do not re-create the bridge we just removed.**
Owning the webview removes *Tauri's* injected bridge; it does not stop VMark from
building a new one by accident. The following are **forbidden** in the browser webview
and enforced by test + code review (Codex round-2, High):
- **No page-world `WKScriptMessageHandler`** (or WebView2 `WebMessageReceived` / webkit2gtk
  script-message handler) — a message handler *is* an IPC bridge, and one registered in
  the page world hands it straight to every hostile page. The agent's channel, if it needs
  one at all, must be **world-scoped** (`addScriptMessageHandler:contentWorld:`) and
  proven unreachable from page JS by the same probe that checks the Tauri globals.
- **No custom `WKURLSchemeHandler`** on the browser webview (a custom scheme reachable
  from page JS is an exfiltration channel with a friendly name).
- **A freshly constructed `WKWebViewConfiguration` / `WKUserContentController` only** —
  never reuse, clone, or inherit Tauri's. Reuse silently re-imports the injected scripts.
- Preference for the strongest form: results come back as **eval return values**, so the
  browser webview needs **no** message handler at all. Default to zero channels.

**R4 — Origin grants enforced in Rust over what VMark actually controls (and NOT over
what it cannot).**
The driver refuses eval/navigate/inject for any origin without a grant. Canonicalization
is specified, not implied: scheme + host + port; IDN → punycode; default ports
normalized; trailing dots stripped; **no implicit subdomain wildcarding** (a plugin must
declare `*.example.com` explicitly to get it).

**Scope of enforcement — stated honestly** (Codex round-2 Critical; v2 of this plan
over-claimed here and the over-claim mattered):

| Surface | Enforceable? | Mechanism |
|---|---|---|
| Driver-initiated eval / inject / async-call | **Yes** | Rust checks the target webview's *committed* origin before dispatch |
| Top-level navigation | **Yes** | `WKNavigationDelegate` `decidePolicyForNavigationAction` (and the WebView2/webkit2gtk equivalents) |
| `fetch` issued **by the driver's own injected code** | **Yes** | The driver constructs the request; the URL is checked in Rust before the call is made |
| Page-initiated subresource loads, page-world `fetch`/XHR, form posts, beacons, service-worker traffic, iframe subresources | **NO — WKWebView exposes no general network-interception API** | Not enforceable. Do not claim it. |

The security model therefore rests on: **VMark never issues a request to a non-granted
origin, and never evaluates code in a non-granted page.** It does **not** and cannot mean
"a granted page cannot talk to the internet" — a page does that anyway, exactly as it
would in Safari. That is the correct boundary: we are constraining *our automation*, not
sandboxing *the web*. A reader who assumed the latter would be misled, so this table is
normative. (If per-request enforcement is ever genuinely required, it needs a local
proxy or `WKURLSchemeHandler`-based interposition — a separate project, explicitly out
of scope. See Q8.)

**R5 — Approval is per-operation, not per-HTTP-method.**
HTTP method is not a reliable mutation signal (a GET can mutate; one `browser.act` can
perform several writes). The unit of approval is a **declared operation with a target**:
"publish draft to <site> titled <X>", "submit form on <origin>", "click <element>".
- Reads (snapshot, extract, navigate within granted origins) proceed under enablement.
- Writes require approval; a standing grant is scoped to (workflow-id + site-id), never
  global; grants are revocable and expire.
- **Retries and self-heals re-confirm** — a repaired write is a *new* operation (R8a).
  (Codex D4-5.)

**R6 — Session hibernation bounds memory.**
Only the active browser tab per pane keeps a live native webview; background browser
tabs collapse to `{url, title, scrollY, snapshot}`. Exception: tabs with a keep-alive
flag (AI actively driving). Hard cap (default 3) live webviews per window; LRU-evict
beyond. *Failure mode if skipped:* N tabs × tens of MB → memory blowout.

**R7 — Generic reader is the floor; plugins override.**
`dispatchSite(url)` returns a plugin if an origin matches, else the generic
Readability+Turndown reader. Publishing has **no** generic fallback — unsupported sites
cannot be published to (correct: never guess at a write API).

**R7a — Generic reading needs its own grant, with a specified navigation lifecycle.**
The generic reader declares no origin, so R4 would forbid it. Reading a page the *user
themselves navigated to* is granted per-tab. The lifecycle is specified, not implied
(Codex round-2, Medium):
- The grant attaches to the **committed** top-level origin (`didCommitNavigation`), never
  to a *provisional* one — otherwise a redirect chain briefly grants the wrong origin.
- It is **revoked the moment a new provisional navigation starts**, and re-granted only on
  the next commit.
- **Opaque origins get nothing**: `about:blank`, `data:`, `blob:`, and sandboxed frames
  are never granted. An `about:blank` inheriting a parent origin is treated as ungranted.
- iframes are **not** covered by the tab grant — only the top-level committed origin is.
- The grant exposes a **fixed, closed set of read operations** (`snapshot`, `extract`,
  `screenshot`) — **never arbitrary eval**. Arbitrary eval on a user-navigated page would
  make the grant equivalent to full site access, defeating its own purpose.
- It never grants writes and never reaches other tabs. Plugin origin grants remain the
  only path to write/publish. (Codex D1-6 + round-2.)

**R8 — Workflow steps are typed; the engine picks the execution tier.**
Steps carry `api|action|goal|confirm|extract`. Broken `action`/`api` steps escalate to
`goal` for repair and propose a file patch (never auto-written). `confirm` blocks on a
human regardless of standing grants.

**R8a — Never auto-escalate a write; repairs are re-approved; outcomes are three-valued.**
A failed write step may have **partially succeeded** (request landed, response lost).
Auto-retrying or auto-repairing it can double-post. Therefore:
- Every write step declares a **typed postcondition** — not a prose sentence. Minimum
  shape: `{check: "exists"|"absent"|"equals", selector|endpoint, correlationKey}`. A
  title-based check is **not sufficient**: "a draft titled X exists" matches a draft the
  user wrote last week. The step must carry a **correlation key** (a value the write
  itself injects and the postcondition looks for — a nonce in the draft body, a returned
  id persisted to the run record, or a platform idempotency key where offered).
- Step outcomes are **three-valued: `success` | `failed` | `unknown`.** `unknown` is the
  case that matters (request sent, response lost, postcondition inconclusive).
  **On `unknown` the engine never retries, never repairs, and never escalates — it stops
  and asks the human.** Collapsing `unknown` into `failed` is precisely how a double-post
  happens. (Codex round-2, Medium.)
- Escalation to `goal` is **automatic for reads, never automatic for writes**; a
  self-healed write is re-presented for approval as a new operation.
(Codex D5-7 — the most dangerous gap in v1.)

**R9 — Everything observable.**
Every driver action, workflow run, and plugin health check emits a structured log
(`browserLog`/`siteLog`/`workflowLog` per `50-codebase-conventions.md` §9); runs persist
a record. Failures name the step, origin, and reason.

**R10 — The recorder runs in the PAGE world, is a separate component from the agent, and
its capture guarantee is platform-bounded.**

*This rule was internally contradictory in v2 and the contradiction was load-bearing:*
the agent runs in an **isolated world** (I2), but an isolated-world patch of `fetch`/XHR
**cannot observe page-world calls at all** — the page has its own `fetch`. A recorder
built that way would have captured **nothing**. (Codex round-2, High.) The resolution:

- **The agent (isolated world) and the recorder (page world) are different components
  with different trust levels, and the plan must never conflate them.**
- The **recorder's interception script is injected into the page world**, where it *can*
  see page `fetch`/XHR — and where the page can, in principle, see and tamper with it.
  That is an accepted and bounded trade: recording is **user-initiated, transient,
  explicitly indicated in the UI, and produces a file the user reviews before it ever
  runs**. It is not a security boundary and must never be described as one.
- The **agent stays isolated** and is never used for recording. I2 is preserved.

**Capture guarantee by platform** (no silent partial capture):

| Platform | Mechanism | Captures | Misses |
|---|---|---|---|
| Windows (WebView2) | **CDP Network domain** | Essentially the full request surface | — |
| macOS / Linux (WebKit) | page-world `fetch`/XHR patch + navigation delegate | page-world `fetch`/XHR; top-level navigations | service-worker traffic, WebSockets, beacons, `<form>` native posts, anything fired before injection |

The recorder therefore: (a) records its **capture mode** in the generated workflow's
front-matter; (b) marks generated `api:` steps **unverified until one successful replay**;
(c) degrades anything it could not observe to `action:`/`goal:` steps rather than dropping
it; and (d) on WebKit, states plainly in the generated file that its network view is
partial. If SPIKE-7 finds page-world patching too lossy on real targets, the honest
fallback is **`action:`/`goal:` workflows only on WebKit**, with `api:` tier being a
Windows-and-verified-replay capability. That is an acceptable product; a recorder that
silently records half a login flow is not.

**R11 — The AI and the human cannot drive the page at the same time.**
Each browser tab has a single **automation lease**. While the AI holds it, the tab shows
a visible "AI is controlling this page" state; human input **takes the lease back and
cancels the AI's in-flight step**. Every driver command carries the tab's **navigation
generation**; a command whose generation is stale (page navigated, human intervened,
lease changed) is **rejected**, not applied to a page the AI never reasoned about.

Mechanism, specified rather than assumed (Codex round-2, Medium):
- **Human input is observed natively**, not in JS: on macOS the browser view's
  first-responder / `NSEvent` monitor on the view; WebView2 and webkit2gtk have the
  equivalent. A JS-level listener cannot be trusted here (the AI's own synthetic events
  would trip it, and page script can suppress it).
- **AI-vs-human discrimination:** driver-synthesized input is tagged at dispatch, so the
  lease monitor ignores the AI's own events and reacts only to genuine user input.
- **Atomicity:** the lease + navigation-generation check happens on the **UI thread,
  immediately before dispatch**, in the same critical section as the dispatch itself —
  not in an earlier async validation step, which would leave a race window exactly where
  it hurts (between "checked" and "clicked").
*Failure mode if skipped:* the AI clicks "Publish" on a page the human just navigated
away from. (Codex D2-8 — genuinely missing from v1.)

**R12 — Browser UX surfaces are a decided matrix, not a checklist.**
"Implemented where cheap, otherwise unsupported" is not a specification — it defers the
decision to the implementer and makes the estimate meaningless (Codex round-2, Medium).
Every surface below has a **decided v1 disposition**; WI-1.7 fills in the exact delegate
and test per row and may not add "TBD".

| Surface | v1 disposition | macOS mechanism |
|---|---|---|
| `alert` / `confirm` / `prompt` | **Implement** — native VMark dialog | `WKUIDelegate` runJavaScript*Panel |
| `window.open` / `target=_blank` | **Implement** — open as a new VMark browser tab (origin re-checked) | `createWebViewWithConfiguration` → return nil, open tab |
| Downloads | **Implement** — user-confirmed destination, progress, cancel; never auto-write | `WKDownloadDelegate` |
| `<input type=file>` upload | **Implement, human-only** — native picker; **the AI may never choose a file** (an AI-chosen upload is an exfiltration path) | `WKUIDelegate` openPanel |
| HTTP basic auth | **Implement** — native prompt | `didReceiveAuthenticationChallenge` |
| TLS / cert errors | **Deny, hard** — no click-through in v1 | reject the challenge |
| Camera / mic / geolocation / notifications | **Deny, silently, always** in v1 | delegate → deny |
| Back / forward / reload / stop | **Implement** | `goBack`/`goForward`/`reload` |
| Find-in-page | **Implement** (reuse VMark's find UI over the agent) | agent-side |
| Zoom | **Implement** | `pageZoom` |
| Context menu | **Implement** — minimal (copy, copy link, open in system browser, reload) | `WKUIDelegate` |
| Print | **Defer** — visible "not supported in v1" | — |
| Devtools | **Debug builds only** | `isInspectable = true` under `#[cfg(debug_assertions)]` |
| PDF / media / fullscreen | **Inherit engine default**; document what works | — |

Webview crash/hang is recovered (WI-1.8), never left to hang the app. (Codex D2-1..7.)

## 6. Decision Log (ADRs)

**ADR-B1 — System webview, not bundled Chromium (CEF).**
- Options: (a) embed CEF/Chromium; (b) drive user's external Chrome via CDP; (c)
  system webview per platform.
- Decision: **(c)**.
- Rationale: (b) can't be displayed inside the VMark window (macOS can't reparent
  another process's window) — the user explicitly requires in-app display. (a) makes
  VMark a browser vendor (weekly Chromium CVEs to patch in an app holding login
  sessions), adds 150–300 MB/platform, fights Tauri's process/window model, and buys
  nothing here (CDP already available on Windows via WebView2; extensions run in no
  embedded engine). System webviews are OS-patched.
- Rejected: (a) security+size+integration cost with no offsetting benefit; (b)
  fails the display requirement.

**ADR-B2 (REVISED post-Codex) — VMark creates and owns a raw native webview; it is
NOT a Tauri webview and does NOT use `add_child`.**
- Options: (a) Tauri `window.add_child()` multi-webview (`unstable`); (b) separate
  Tauri `WebviewWindow` companion; (c) **VMark constructs the platform webview itself
  (`WKWebView` / `CoreWebView2` / `WebKitWebView`) and adds it as a native child view of
  the Tauri window's content view**, obtained through `with_webview`; (d) screenshot
  streaming into a canvas.
- Decision: **(c)**.
- Rationale (this is the plan's most important change):
  1. **Security, decisively.** Tauri prepends `__TAURI_INTERNALS__`, the invoke bridge,
     and plugin init scripts to *every* webview it creates — `add_child` included
     (`tauri-2.11.5/src/manager/webview.rs:166-224`, verified). A capability file
     restricts authorization, **not injection**. Under (a) or (b), every hostile page
     gets a live IPC object to probe. Under (c) no bridge is ever injected — R3 becomes
     structural instead of configured.
  2. **Capability.** Owning `WKWebViewConfiguration` unlocks exactly what the feature
     needs and (a)/(b) cannot give: `WKContentWorld` (isolated agent world, I2),
     `callAsyncJavaScript` (**await `fetch()`** — `evaluateJavaScript` cannot await a
     Promise, so publishing is impossible without it), `WKWebsiteDataStore` (profiles),
     and the `WKUIDelegate`/`WKNavigationDelegate`/`WKDownloadDelegate` hooks required
     for dialogs, popups, downloads, and TLS errors (R12).
  3. **Cost is near zero.** `objc2`, `objc2-app-kit` (`NSView`/`NSWindow`), and
     `objc2-web-kit` (`WKWebView`, `WKWebViewConfiguration`, `WKNavigationDelegate`,
     `block2`) are **already direct dependencies** (`src-tauri/Cargo.toml:65-70`).
  4. **Drops the `unstable` feature and its bug class entirely** (rendering #11376,
     positioning #10420, user-agent #9492 no longer apply).
- Cost accepted: VMark now owns webview lifecycle, bounds, focus, and z-order on three
  platforms — real work, and the reason Windows/Linux embedding is spiked in Phase 0
  (WI-0.6) rather than deferred.
- Rejected: (a)/(b) break the core security invariant and cannot provide isolated
  worlds or async eval; (d) high latency, not a real browser.

**ADR-B3 (REVISED) — One-directional driver; isolated agent world; async eval.**
- Decision: drive the owned webview via native eval; run the agent in an isolated
  content world (I2); use **`callAsyncJavaScript`** (macOS 11+) wherever a result
  depends on a Promise (`fetch`, waits) and `evaluateJavaScript` only for synchronous
  reads. Results flow Rust ← page as return values; the page never initiates a message.
- Rationale: `evaluateJavaScript` returning a `Promise` yields an opaque object, not the
  resolved value — the v1 plan's publishing and wait primitives would have silently
  failed on it. (Codex D3-3.)
- Consequence: **macOS 11 is the effective floor for publishing/workflows.** On 10.15
  the browser is read-only (see Q7).

**ADR-B4 — Profile isolation via `data_store_identifier`, degrade below macOS 14.**
- Decision: use `data_store_identifier` for a VMark-owned browser profile; on
  macOS <14 (or if the documented crash #12843 reproduces) fall back to the default
  persistent store (still persists cookies; just not isolated from other webviews).
- Rationale: isolation is desirable, not load-bearing; persistence is load-bearing.

**ADR-B6 — No supervised daemon; state splits app-support vs workspace by *authority*,
not by convenience.**
- Context: v1 of this design (Playwright-MCP sidecar) implied a supervised child process
  with a port file, like `content_server`. **The revised design has no daemon at all** —
  the webview is created in-process by the Tauri core (ADR-B2). No child process, no
  supervision, no port file, no `login_shell_path`. `content_server/spawn.rs` remains a
  *pattern* reference only; the browser does not reuse it.
- Decision: the state that *does* need a home splits on one rule — **user-authored intent
  lives in the workspace; machine identity, session state, and anything conferring
  authority lives in app-support.**

| State | Location | Rationale |
|---|---|---|
| `data_store_identifier` (profile UUID) | `app_data/browser/profile` | Sessions are per-user-per-app. Per-workspace would force re-login per folder. (The cookie jar itself is **not ours** — WebKit owns `~/Library/WebKit/<bundle-id>/WebsiteDataStore/<uuid>`; we persist only the UUID.) |
| Approval standing grants (R5) | `app_data/browser/grants.json` | **Security-critical.** A grant confers publish authority. In the workspace, a `git clone` / Dropbox sync would carry a standing publish grant to another machine or person |
| Run records / logs (R9) | `app_data/browser/runs/<workspace-hash>/` | Per-workspace **scope**, app-support **storage** — the `content_server` pattern (keyed by root, stored centrally). They contain page content and URLs; they must not be committable by accident |
| Hibernation snapshots (R6) | `app_cache/browser/snapshots/` | Regenerable and large; the OS may reclaim them. **Deliberately diverges** from `workflow-snapshots/` (which sits in `app_data`) — snapshots are a cache, and treating them as one is correct even though the local precedent differs |
| Site enablement, ad-hoc origins | settings store (app-support) | Configuration, not content |
| **Workflow `.md` files** | **workspace root** | The *only* thing that belongs there. They are user-authored documents — edited in VMark, diffed in git, shared. This is the point of ADR-W1 |

- **Rule (normative):** nothing that grants authority or holds session identity may live
  in a directory a user might copy, sync, or commit. If a future feature wants to put a
  grant or a session in the workspace, that is a red flag, not a convenience.
- **Privacy consequence:** run logs and snapshots contain page content, so the "clear
  browsing data" UX (R12/WI-1.5) must clear **all three** of the WebKit data store, the
  run records, and the snapshot cache — not just cookies.
- **Rejected: per-workspace browser profiles.** Tempting (work identity vs personal
  identity per project), but implicit binding of identity to folder produces the worst
  class of surprise ("why am I logged out in this folder?") and silently multiplies live
  session stores. If multi-profile ships in v2, a profile is a **user-selected identity**,
  never an implicit function of the workspace. (Q10.)

**ADR-B5 — Two interaction tiers: synthetic DOM, then native input.**
- Decision: default to synthetic events (`isTrusted:false`, works on most sites);
  escalate to native input where needed. **Native trusted input is a Windows/CDP
  capability, NOT a macOS one** (revised per SPIKE-3).
- Rationale: native input is the reliable path but platform-specific and heavier;
  synthetic covers the common case cheaply.
- **SPIKE-3 finding (2026-07-12):** synthesizing an `NSEvent` mouse click (both
  `sendEvent` and queue-`postEvent`, app activated + webview first responder) delivered
  **no** click to the embedded WKWebView's DOM (`received:false`) — not even an untrusted
  one. WebKit accepts input through the real window-server/HID path, not app-level
  `NSEvent` posting. So on macOS the interaction tier is **synthetic DOM events only**;
  genuinely-trusted input is Windows-via-CDP. (CGEvent HID injection is out of scope —
  needs Accessibility permission and still wouldn't guarantee `isTrusted`.) This is
  design-consistent — the plan's platform table already flagged macOS trusted input as
  unproven; it is now confirmed unavailable-via-NSEvent.

**ADR-S1 — Site registry dispatches on origin, mirrors format registry.**
- Decision: `src/lib/sites/registry.ts` with `registerSite(manifest+orchestrator)`,
  `dispatchSite(url)`, settings-gated `bootstrapSites()`. Rationale: proven pattern,
  keeps per-site mess out of the AI tool layer (as `dispatchEditor` keeps format mess
  out of `Editor.tsx`).

**ADR-S2 — In-page module ≠ host orchestrator.**
- Decision: split each plugin into (1) an injected in-page JS bundle (DOM +
  same-origin fetch, namespaced global, no Tauri) and (2) a host-side typed
  orchestrator (sequences via the driver). Rationale: only the in-page half can do
  same-origin fetch/DOM; keeping it minimal and Tauri-free preserves R3.

**ADR-S3 — Built-in plugins compiled in-repo; third-party sandboxed, no marketplace.**
- Decision: built-ins live in `src/lib/sites/adapters/` (reviewed, i18n'd, tested).
  Third-party plugins (post-v1) run their host layer in a Web Worker behind a
  message-channel facade. No remote auto-updating registry in v1.
- Rationale: avoids opening a supply-chain door; matches governance §4 stance.

**ADR-S4 — Publishing = same-origin fetch (Wechatsync mechanism), reimplemented.**
- Decision: publish by executing `fetch()` in the page context against the platform's
  own web APIs with the user's cookies. Reimplement the mechanism; do **not** copy
  Wechatsync's GPL-3.0 code into VMark (integrate by mechanism, not by linking).
- Rationale: indistinguishable from the user's own editor; DOM puppeteering is the
  fragile fallback only.

**ADR-W1 — Workflow file is markdown with typed steps.**
- Decision: workflows are `.md` files (front-matter + step list) in the workspace,
  editable in VMark, git-diffable. Rationale: VMark is a markdown editor; reuse the
  editor, versioning, and sharing for free.

**ADR-W2 — Four execution tiers with escalation + self-healing.**
- Decision: `api` (recorded same-origin fetch replay) → `action` (semantic locator)
  → `goal` (AI loop) → vision (screenshot+coords+native input). Broken deterministic
  steps escalate to `goal`, complete the run, and propose a patch. Rationale: "no
  DOM" is not a wall — it's tier selection; recording lifts DOM actions to API tier.

**ADR-W3 — Recorder captures dual trace (actions + network).**
- Decision: the recorder logs semantic actions AND the network requests they fire
  (injected fetch/XHR interception on WebKit; CDP Network domain on WebView2), then
  generates a workflow file preferring the API representation. Rationale: replaying
  requests is more stable than replaying clicks.

## 7. Open Questions

- **Q1 — RESOLVED by the Codex review.** ("Is `add_child` stable enough?") Moot: the
  revised ADR-B2 does not use `add_child` at all. VMark owns the webview.
- **Q2 — Exact dependency matrix per target.** The v1 plan wrongly listed objc2 as a new
  dep (it is already direct). What is genuinely needed: extra `objc2-web-kit`/
  `objc2-app-kit` features (macOS), `webview2-com` + `windows` (Windows), `webkit2gtk` +
  `gtk` (Linux). Decides: SPIKE-2 (WI-0.2), which must **compile** the matrix, not just
  list it. Default if unresolved: macOS-only Phase 1, other targets gated off.
- **Q3 — RESOLVED.** Profile isolation is macOS 14+; below that wry itself falls back to
  the default persistent store (`wry-0.55.1/src/wkwebview/mod.rs:221-243`). Persistence
  is kept, isolation is lost. Documented in ADR-B4; SPIKE-4 confirms on real hardware.
- **Q4 — Google-OAuth-in-webview refusal — scope of impact?** Some IdPs reject
  embedded-webview sign-in by UA. QR logins (Chinese platforms) unaffected. Default:
  document as a known limitation; offer "log in via the system browser, then import
  cookies" only if a target platform actually requires Google OAuth.
- **Q5 — Should web workflows and Genie workflows (20260331) share a run-log/approval
  store now or later?** Default: separate stores in v1, identical approval-gate *shape*
  so a later merge is mechanical.
- **Q6 — RESOLVED (SPIKE-3, 2026-07-12): NO.** NSEvent synthesis does not deliver input
  to an embedded WKWebView's DOM at all (`received:false` via both `sendEvent` and
  `postEvent`). Trusted input is **Windows-via-CDP only**; macOS uses the synthetic tier
  (ADR-B5, revised). Not a blocker — the design already routes around it.
- **Q7 — NEW: Raise the macOS floor from 10.15 to 11?** `callAsyncJavaScript` (macOS 11+)
  is load-bearing for publishing and waits. Options: (a) raise
  `minimumSystemVersion` to 11 — simplest, and 10.15 is long out of support; (b) keep
  10.15 and ship a **read-only browser** below 11 (no publishing, no workflows).
  Who decides: **Xiaolai** (product call, not a technical one), informed by SPIKE-2.
  Default if unresolved: (b) — degrade rather than drop users.
- **Q8 — NEW: is per-request origin enforcement ever actually required?** R4 now states
  plainly that WKWebView offers **no general network-interception API**, so VMark can
  constrain *its own automation* but cannot police a granted page's own traffic. If a
  future requirement genuinely needs per-request policy, the only real mechanisms are a
  **local proxy** or `WKURLSchemeHandler` interposition — both are separate projects.
  Default: **out of scope**; the boundary in R4's table is the shipped security model,
  and no document may describe it as more than that.
- **Q10 — NEW: should a browser profile ever be per-workspace?** Real use case: publish to
  a company account from one project, a personal account from another. **Default (v1): no**
  — one app-global profile (ADR-B6). If multi-profile ships, a profile must be a
  **user-selected identity**, never implicitly bound to the workspace folder. Who decides:
  Xiaolai, post-v1, informed by whether the "wrong account" failure actually shows up.
- **Q9 — NEW: does the WebKit page-world recorder capture enough to be worth shipping?**
  (R10.) If SPIKE-7 shows page-world `fetch`/XHR patching is too lossy on real targets,
  the `api:` tier becomes **Windows-only + verified-replay-only**, and macOS/Linux
  workflows are `action:`/`goal:` tier. Who decides: SPIKE-7. Default: ship the honest
  degradation; never ship a recorder that silently captures half a flow.

## 8. API / Contract Changes

- **New MCP v2 domain `vmark.browser`** (added to `src/hooks/mcpBridge/v2/`), tools:
  - `browser.open({url})` → tab id (read; requires enablement)
  - `browser.read({tabId?})` → `{title, url, markdown, images[], meta}` (read)
  - `browser.snapshot({tabId?})` → aria snapshot JSON (read)
  - `browser.act({tabId?, action})` → result (write-class → approval)
  - `browser.listSites()` → registered site ids + capabilities (read)
  - `browser.publish({siteId, doc, options})` → draft/publish result (write → approval)
  - `browser.runWorkflow({path, inputs})` → run record (mixed → per-step approval)
  - All confined by R4 (origin) + R5 (action class). Versioned `browser_v1`.
- **Backward compatibility:** additive only. Existing 5 tools unchanged. Feature
  default-off means zero behavior change for current users/clients.
- **New Rust Tauri commands** (registered in `lib.rs`, scoped by `browser.json`
  capability): `browser_surface_create/destroy/set_bounds/navigate`,
  `browser_driver_eval/snapshot/screenshot/dispatch_input`,
  `browser_freeze/thaw` (occlusion). All return `Result<T, String>` (§10 rule).

## 9. Data Model / Persistence

- **Browser tab persistence:** extend per-tab session restore (`lastOpenTabs`) to
  store `{kind:"browser", url, title, scrollY}`. No webview state persisted (the OS
  data store holds cookies/localStorage). Version the tab record (`tabSchema: 2`)
  with a migration that defaults missing `kind` to `"document"`.
- **Storage locations: see ADR-B6** — it is the normative table. Summary: **no daemon
  exists**; `data_store_identifier`, approval grants, run records, and site config live in
  **app-support** (`app_paths::app_data_dir()`, the repo's canonical helper); hibernation
  snapshots live in **app-cache**; and **workflow `.md` files are the only browser state
  in the workspace**, because they are user-authored documents.
- **Browser profile:** OS webview data store, keyed by a VMark-owned
  `data_store_identifier` (16-byte UUID) persisted in app-support; **single identifier in
  v1** (multi-profile is v2, and would be a user-selected identity — never implicitly
  per-workspace; see Q10). VMark stores the UUID, **not** the cookies — WebKit owns those.
- **Site plugin config:** per-site enablement + any user-declared ad-hoc origins in
  `settings.browser.sites`. **No credentials stored, ever.**
- **Run records:** ring buffer (last N runs per workflow) under
  `app_data/browser/runs/<workspace-hash>/` — per-workspace scope, app-support storage.
  They contain page content, so they are covered by "clear browsing data" (R12).
- **Migration/rollback:** all new persisted keys are additive and default-off;
  rollback = disable the flag; tab-schema migration is forward-only with a safe
  default, no destructive rewrite.

## 10. Observability

- **Metrics:** live-webview count per window (assert ≤ cap), driver eval latency,
  snapshot size, workflow step durations, plugin healthcheck pass/fail.
- **Logs:** named debug loggers (`browserLog`, `siteLog`, `workflowLog` in
  `src/utils/debug.ts`); Rust driver logs via `tauri-plugin-log`. Run records viewable
  in a Run Log panel.
- **Debug toggles:** `settings.browser.verboseLogging`; a dev-only "driver console"
  showing eval round-trips.
- **Acceptance thresholds:** ≤3 live webviews/window enforced (test); generic read of
  a 100 KB article < 500 ms after load (bench); memory of 10 hibernated tabs within
  budget of 1 live tab + 10 × snapshot size (bench).

---

## 11. Phases & Work Items

Ordering is strict: Phase 0 gates everything (governance §7). Each phase has a
machine-checkable DoD via `scripts/check-browser-phase.sh <N>` (to be authored in
WI-0.5 as a copy of `check-gha-phase.sh`). Every WI's tests are written **first**
(RED) per `10-tdd.md`. Every WI links via commit message `(WI-N.M)` or test-file
header per governance §2. High-risk paths added to the TDD hook scope (§13).

### Phase 0 — Feasibility spikes (governance §7; no product code)

Spikes live in `dev-docs/grills/embedded-browser/` with runnable probes and a
PASS/FAIL write-up each. No other phase commits until all are PASS (or an ADR is
revised to route around a FAIL).

#### WI-0.1: SPIKE-1 — Owned native webview + **security-invariant probe** (macOS)
- Goal: prove VMark can construct its own `WKWebView` (`objc2-web-kit`), add it as an
  `NSView` subview of the Tauri window's content view (via `with_webview` →
  `ns_window`/`content_view`), position it to a rect, and navigate it — **and prove no
  Tauri bridge exists inside it**.
- Acceptance (**the security assertion is the point of this spike**):
  1. A live remote page renders in a sub-rect of the main window and tracks a DOM
     element's bounds across window resize and 1×/2× DPI.
  2. **Probe asserts, on a hostile test page: `window.__TAURI_INTERNALS__ === undefined`,
     `window.ipc === undefined`, `window.__TAURI__ === undefined`, no plugin globals,
     and `invoke()` is unreachable.** Any of these present ⇒ **FAIL**, and the whole
     plan halts pending redesign (I1 is non-negotiable).
  3. An agent script installed into an isolated `WKContentWorld` is **invisible** to page
     script (page cannot enumerate or shim it), while the driver can still call it.
- Tests (first): probe under `dev-docs/grills/embedded-browser/spike1-owned-webview/` +
  `SPIKE-1.md`; the globals assertion is lifted verbatim into a permanent regression
  test in Phase 1 (WI-1.2).
- Touched areas: throwaway probe; no product code.
- Dependencies: none. Risks: `with_webview` may not expose the content view usefully →
  mitigation: fall back to `ns_window` + `contentView` traversal; record the exact path.
- Estimate: L. *(Was M; owning the webview is more work than asking Tauri for one —
  and it is the correct trade.)*

#### WI-0.2: SPIKE-2 — Sync + **async** eval, init scripts, dependency matrix (macOS)
- Goal: prove `evaluateJavaScript:completionHandler:` returns a value from a *remote*
  page, **and that `callAsyncJavaScript` awaits a real `fetch()` and returns its resolved
  result** (the primitive publishing depends on); prove a `WKUserScript` at
  `atDocumentStart` runs on every navigation in the isolated world.
- Acceptance: sync eval returns `document.title`; **async eval performs a cross-page
  `fetch()` and returns the parsed JSON body**; injected agent present after each
  navigation; a written **target-specific dependency matrix** (exact crates + features
  for macOS/Windows/Linux) compiles under the release profile and `pnpm check:cross`.
- Tests (first): probe + `SPIKE-2.md` + the dependency matrix committed to the plan §3.
- Dependencies: WI-0.1. Risks: `callAsyncJavaScript` is macOS 11+ (see Q7) →
  mitigation: the spike records the behavior on the 10.15 floor and the write-up
  recommends either raising the floor or gating publishing.
- Estimate: M.

#### WI-0.3: SPIKE-3 — Screenshot + **trusted input reality check** (macOS)
- Goal: determine whether NSEvent synthesis actually produces `isTrusted` input in a
  WKWebView we own, on a **real site that rejects untrusted events** — not just a
  fixture; and prove `takeSnapshotWithConfiguration:` yields a PNG.
- Acceptance: screenshot works; the trusted-input question is answered **definitively
  PASS or FAIL on a real target**. If FAIL, ADR-B5 is revised (synthetic-only on macOS;
  trusted input becomes a Windows-only capability) and the plan records the limitation
  rather than assuming a workaround. Also record whether NSEvent needs Accessibility
  permission or window focus.
- Tests (first): probe + `SPIKE-3.md`.
- Dependencies: WI-0.1. Risks: this may simply not work on macOS — that is an
  acceptable spike outcome and must not be papered over. (Codex D3-4.)
- Estimate: M.

#### WI-0.4: SPIKE-4 — Profile persistence + isolation floor
- Goal: verify `WKWebsiteDataStore(identifier:)` isolates and persists on macOS 14+, and
  that the <14 fallback (default persistent store) still **persists** sessions.
- Acceptance: log into a test site → quit → relaunch → session persists (both on 14+ and
  on the fallback path); two identifiers are mutually isolated on 14+; write-up records
  the exact version boundary and states plainly that **isolation is lost below 14 while
  persistence is kept**.
- Dependencies: WI-0.1. Estimate: M.

#### WI-0.5: SPIKE-5 — **Occlusion** (freeze-to-snapshot) reality check
- Goal: R2 is a core architectural constraint, not polish — spike it before committing
  to native-view-over-DOM. Measure snapshot capture latency; verify hide/show is
  race-free; verify focus and **IME composition** survive a freeze/thaw; verify no
  flicker at 1×/2× and during a split-drag resize.
- Acceptance: an overlay opens over the browser and renders **above** a frozen snapshot;
  capture latency recorded (target < 100 ms; if it is far worse, the design needs a
  different overlay strategy — e.g. relocating overlays outside the browser rect);
  IME composition (Chinese/Japanese input) is not corrupted by a freeze/thaw cycle.
- Dependencies: WI-0.1. Risks: if capture is slow or flickers, the whole
  overlay-over-native approach needs rethinking — **which is exactly why this is now a
  Phase 0 spike** rather than a Phase 1 WI. (Codex D5-3.)
- Estimate: M.

#### WI-0.6: SPIKE-6 — Windows + Linux embedding **and the Windows isolated world**
- Goal: because VMark now owns the webview, the *embedding mechanism itself* is
  platform-specific. Prove a `CoreWebView2Controller` can be parented to the Tauri
  window's `HWND` and bounded to a rect (Windows), and a `WebKitWebView` added to the
  GTK container (Linux).
- Acceptance:
  - A page renders in a sub-rect on each platform; z-order, focus, resize, and teardown
    behave.
  - **Windows I2 is resolved.** `ExecuteScriptInIsolatedWorld` does **not** exist in the
    checked `webview2-com` bindings (Codex round-2). The spike must determine the real
    mechanism — most likely CDP `Page.createIsolatedWorld` + `Runtime.evaluate` against
    the returned execution-context id — **or** conclude that WebView2 gets no isolated
    world, in which case I2 is a macOS+Linux guarantee and Windows ships the weaker
    namespaced-global form **with that stated in the docs**.
  - **Linux I2 is confirmed** via `webkit_web_view_run_javascript_in_world` /
    `call_async_javascript_function(..., world_name)` (these **do** exist — my original
    table was wrong); record the WebKitGTK version floor.
- Dependencies: WI-0.1 (trait shape). Risks: deferring this to Phase 5 would let a
  macOS-only abstraction harden and then shatter. (Codex D5-5 + round-2 High.)
- Estimate: L.

#### WI-0.7: SPIKE-7 — One publishing probe + **CSRF/session reality** + phase-gate script
- Goal: prove the publishing mechanism end-to-end against a **self-hosted, TOS-safe
  target** (WordPress) — navigate, `callAsyncJavaScript` an authenticated same-origin
  `fetch()`, create a draft — and document how the CSRF token / nonce is acquired, how
  auth expiry is detected, and how binary image upload works.
- Acceptance: a draft appears in the target; the write-up records the **full request
  shape including CSRF acquisition**, an auth-expiry detection strategy, and a
  redaction rule for any token observed. Also delivers `scripts/check-browser-phase.sh`
  with Phase 0 assertions (all 7 spike write-ups exist and say PASS).
- Dependencies: WI-0.2 (async eval). Risks: **do not probe against a commercial platform
  account** — TOS/anti-automation/account-safety exposure. Self-hosted only at spike
  stage; commercial-platform plugins get a legal/TOS + account-safety review in Phase 3.
  (Codex D5-6.)
- Estimate: L.

**Phase 0 DoD:** `bash scripts/check-browser-phase.sh 0` exits 0 (7 PASS write-ups);
**WI-0.1's no-bridge assertion PASSES (hard halt if not)**; the dependency matrix
compiles on all three targets; ADR-B2/B3/B4/B5 finalized (or revised) from spike results;
Q6 (trusted input) and Q7 (macOS floor) answered; **second Codex review of this revised
plan complete** (governance §6).

### Phase 1 — Browser surface (visible, manual-use tab)

Goal: a human can open, view, and manually use web pages as tabs inside VMark.
No AI driving yet.

#### WI-1.1: Tab discriminated union + versioned persistence (R1)
- Goal: convert `Tab` to `DocumentTab | BrowserTab`; add browser create/restore/close
  paths; migrate `WorkspaceConfig.lastOpenTabs` from `string[]` to a **versioned record**
  type that can express both kinds.
- Acceptance: `DocumentTab` behavior is bit-for-bit unchanged (existing tabStore suite
  stays green); browser tabs create/dedupe by canonicalized URL; a legacy `string[]`
  `lastOpenTabs` migrates forward to records with `kind:"document"`; a browser tab in a
  **downgraded** build is skipped with a warning, not a crash; workspace transfer of a
  browser tab is an explicit, user-visible no-op.
- Tests (first): `src/stores/__tests__/tabStore.browser.test.ts` — union type-narrowing,
  create/dedupe/restore, **legacy `string[]` → record migration**, downgrade tolerance,
  transfer no-op, hot-exit restore. Existing tabStore tests must remain green (regression
  guard).
- Touched areas: `src/stores/tabStoreTypes.ts`, `tabStore.ts`, `workspaceStore.ts`
  (`lastOpenTabs` type), `restoreWorkspaceTabs.ts`, `WindowContext.tsx`, workspace
  transfer services (exclusion path).
- Dependencies: none (pure store). Risks: this touches the persistence spine of the app —
  a bad migration loses a user's open tabs. Mitigation: forward-only migration, defensive
  skip on unknown records, and a fixture corpus of real `lastOpenTabs` payloads.
- Estimate: **L** *(was M — Codex correctly showed this is not a small extension:
  persistence, restore, hot-exit, transfer, and split-layout all encode the document
  assumption).*

#### WI-1.2: Rust browser surface — VMark-owned native webview (ADR-B2, macOS)
- Goal: create/destroy/bounds/navigate a **VMark-constructed `WKWebView`** added as an
  `NSView` subview of the Tauri window's content view; own its `WKWebViewConfiguration`
  (data store, isolated content world, user scripts, preferences).
- Acceptance:
  - Commands registered + capability-scoped (the *driver commands* are scoped; the
    browser webview itself has **no** capability because it has no IPC).
  - Bounds command repositions the native view; navigate loads a URL; destroy tears down
    cleanly with no leaked observers.
  - **The no-bridge assertion from SPIKE-1 ships as a permanent regression test** —
    `__TAURI_INTERNALS__`/`ipc`/`__TAURI__` absent, `invoke` unreachable (R3/I1).
  - A stable identity map exists: `tabId ↔ webview handle ↔ pane ↔ window ↔ navigation
    generation` (needed by R11 and hibernation).
- Tests (first): `src-tauri/src/browser/surface.rs` tests — input validation, lifecycle
  (create→navigate→destroy), identity-map invariants, **and the no-bridge assertion**.
- Touched areas: `src-tauri/src/browser/{mod,surface,config}.rs`; `lib.rs` registration;
  `capabilities/browser.json`. **No `unstable` feature; no `add_child`.**
- Dependencies: WI-0.1, WI-0.2. Risks: VMark now owns webview lifecycle/focus/z-order —
  mitigation: the identity/lifecycle state machine is specified before coding (WI-1.2a
  design note in the plan's appendix), not discovered.
- Estimate: **L→XL** (the largest single WI in Phase 1).

#### WI-1.3: BrowserSurface React component + bounds reporting
- Goal: `<BrowserSurface tabId>` renders chrome (URL bar, back/forward/reload,
  loading state) and a reserved rect; reports rect bounds to Rust via `invoke` on
  layout/resize (ResizeObserver); `Editor.tsx` branches on `kind==="browser"`.
- Acceptance: opening a browser tab shows a live page in the pane; resizing the
  window/splitter keeps the native view aligned; URL bar navigates.
- Tests (first): `src/components/Browser/BrowserSurface.test.tsx` — renders chrome,
  fires bounds invoke on resize (mock invoke), URL submit calls navigate; behavior not
  pixels.
- Touched areas: `src/components/Browser/` (BrowserSurface, BrowserChrome), wire in
  `src/components/Editor/Editor.tsx`. Follow selectors-only, <300 LOC, tokens-first.
- Dependencies: WI-1.1, WI-1.2. Estimate: L.

#### WI-1.4: Occlusion service (freeze-to-snapshot) — R2
- Goal: when any AppShell overlay opens or a split drag begins over the browser rect,
  freeze the webview to a snapshot image and hide the native view; thaw on close/end.
- Acceptance: opening CommandPalette/QuickOpen/dialog over a browser tab shows the
  overlay above a frozen snapshot (not under a live view); thaw restores interactivity;
  split-drag is smooth.
- Tests (first): `src/services/browser/occlusion.test.ts` — subscribe to overlay-open
  events → calls freeze; close → thaw; drag start/end toggles. Mock the driver.
- Touched areas: `src/services/browser/occlusion.ts` (service tier, ADR-013), hooks
  into overlay mount + `paneStore` drag state; Rust `browser_freeze/thaw` (WI-1.2 cmds).
- Dependencies: WI-1.2, WI-1.3. Risks: missed overlay sources → mitigation: centralize
  overlay registration so every overlay flows through one freeze trigger. Estimate: L.

#### WI-1.5: Sessions + profile
- Goal: apply the VMark browser `data_store_identifier` (ADR-B4) with the
  <macOS-14 fallback; persist the identifier.
- Acceptance: log into a site, quit, relaunch, session persists; below the OS
  threshold the default-store path is used and still persists; verified on macOS.
- Tests (first): Rust test for identifier selection logic (version gate → identifier
  vs default); `src/services/browser/profile.test.ts` for the TS side.
- Touched areas: `src-tauri/src/browser/profile.rs`, store key.
- Dependencies: WI-0.4, WI-1.2. Estimate: M.

#### WI-1.6: Hibernation — R6
- Goal: only the active browser tab per pane keeps a live webview; background browser
  tabs collapse to `{url,title,scrollY,snapshot}`; cap live views/window (LRU).
- Acceptance: opening 5 browser tabs keeps ≤3 (or configured cap) live webviews
  (asserted); switching to a hibernated tab restores it (re-navigate + restore scroll);
  keep-alive flag exempts AI-driven tabs.
- Tests (first): `src/stores/__tests__/browserHibernation.test.ts` — live-count cap,
  LRU eviction order, keep-alive exemption, restore path.
- Touched areas: `src/stores/browserStore.ts` (or slice of tabStore), occlusion+surface
  integration. Estimate: L.

#### WI-1.7: Browser UX surfaces — dialogs, popups, downloads, uploads, permissions (R12)
- Goal: implement the delegate surface a real browser needs, or deny it **explicitly and
  visibly**. Nothing in R12's list may be left undefined.
- Acceptance (each is either implemented or denied-with-a-message, and tested):
  - `alert`/`confirm`/`prompt` → native VMark dialogs (`WKUIDelegate`), never silent.
  - `window.open` / `target=_blank` → **open as a new VMark browser tab** (origin
    re-checked); popups that request a real window are denied with a visible notice.
  - Downloads → `WKDownloadDelegate` → VMark save dialog; destination confirmed by the
    user; progress + cancel; never auto-write to disk.
  - `<input type=file>` upload → native file picker; **the AI cannot select files**
    (upload targets are human-chosen in v1 — an AI-chosen upload is an exfiltration path).
  - HTTP basic auth → native prompt; TLS/cert errors → **hard block with a clear reason**
    (no click-through-to-insecure in v1).
  - Permission prompts (camera, mic, geolocation, notifications) → **default deny**, no
    prompt, in v1.
  - History (back/forward), reload, stop; find-in-page, zoom, print, context menu,
    devtools → implemented where cheap, otherwise **explicitly listed as unsupported**
    in the docs and the UI (no silent dead buttons).
- Tests (first): `src/components/Browser/__tests__/browserUx.test.tsx` + Rust delegate
  unit tests — each surface's allow/deny path, including the AI-cannot-upload rule.
- Touched areas: `src-tauri/src/browser/delegates.rs`, `src/components/Browser/*`.
- Dependencies: WI-1.2. Risks: this is a large surface that v1 of the plan omitted
  entirely; underestimating it is how "a browser" becomes a six-month project.
  Mitigation: deny-by-default is an acceptable, shippable answer for most of the list.
  (Codex D2-1..7.)
- Estimate: **L**.

#### WI-1.8: Crash / hang recovery + eval watchdog
- Goal: survive the browser webview crashing (WebKit content-process termination;
  WebView2 process failure) and hanging (a page that never yields).
- Acceptance: a killed content process is detected and the tab shows a "page crashed —
  reload" state rather than a blank/frozen view or a hung app; an eval that exceeds its
  timeout is abandoned **and its result rejected** (a late result must not be applied to a
  page that has since navigated — enforced by the navigation generation from WI-1.2);
  stale/queued driver commands for a dead webview are dropped, not replayed.
- Tests (first): `src-tauri/src/browser/recovery.rs` tests — crash event → state
  transition; eval timeout → command abandoned; stale-generation command → rejected.
- Touched areas: `src-tauri/src/browser/recovery.rs`, delegates, browserStore.
- Dependencies: WI-1.2. Risks: an eval timeout does **not** stop the page's JS from
  running — the watchdog abandons the *result*, it cannot cancel the *work*. Documented
  as a limitation. (Codex D2-6.)
- Estimate: M.

#### WI-1.9: Automation lease — AI vs human arbitration (R11)
- Goal: a single lease per browser tab; visible "AI is controlling this page" state;
  human input reclaims the lease and cancels the AI's in-flight step; every driver
  command is tagged with the navigation generation and rejected if stale.
- Acceptance: while the AI drives, the tab shows the controlled state; a human click or
  keypress **immediately** reclaims the lease and the AI's next command is rejected with
  a clear "lease lost" error rather than being applied; navigating the page invalidates
  in-flight commands; a workflow whose lease is lost pauses and reports, it does not
  silently continue.
- Tests (first): `src/services/browser/lease.test.ts` — grant/reclaim/expire, stale
  generation rejection, cancellation of an in-flight step, workflow pause-on-lease-loss.
- Touched areas: `src/services/browser/lease.ts`, driver command envelope (Rust), the
  browser tab chrome (controlled-state indicator).
- Dependencies: WI-1.2, WI-1.8. Risks: **this is the difference between "the AI clicked
  Publish" and "the AI clicked Publish on a page the human had navigated away from."**
  It is a correctness rule, not UX polish. (Codex D2-8 — missing entirely from v1.)
- Estimate: M.

#### WI-1.10: i18n + settings toggle + docs
- Goal: `settings.browser.enabled` (default false) + basic settings UI; all strings via
  `t()`; add `website/guide/browser.md` (new guide) + settings.md section; register in
  website nav.
- Acceptance: feature hidden when disabled; enabling shows "New Browser Tab" in the
  command palette/menu; en locale keys added; website builds.
- Tests (first): settings store test for the flag default + gating; command
  availability test.
- Touched areas: `src/stores/settingsStore/`, settings page, `src/locales/en/*.json`,
  `website/guide/browser.md`, `.vitepress` nav, `21-website-docs.md` mapping row.
- Dependencies: WI-1.3. Estimate: M.

**Phase 1 DoD:** `check-browser-phase.sh 1` verifies: tab-union + **`lastOpenTabs`
migration** tests green and the pre-existing tabStore suite still green; **the no-bridge
regression test (I1) is in CI and passing**; open/view/navigate works in live Tauri
(manual); occlusion test green incl. IME round-trip; sessions persist across restart
(manual); live-webview cap enforced (test); **every R12 surface is either implemented or
explicitly denied with a visible message** (test per surface); crash-recovery + eval
watchdog tests green; **automation-lease tests green**; flag default-off; `pnpm
check:all` green; website build green; WI-linkage 1.x passes.

*Phase 1 is now substantially larger than v1 of this plan implied.* That is the honest
consequence of owning a real browser: the tab-model surgery, the delegate surface (R12),
crash recovery, and the lease are not optional extras — they are what separates "a
webview that renders a page" from "a browser a user can trust." Sequencing them here,
rather than discovering them in Phase 5, is the point of having done the review.

### Phase 2 — Driver + automation agent (AI can read & act, no publishing)

Goal: the AI can snapshot, read, and interact with the current page under the origin
guard. No site plugins or publishing yet.

#### WI-2.1: Rust driver — eval/snapshot/screenshot + origin guard (R3/R4)
- Goal: `browser_driver_eval/snapshot/screenshot`; origin allowlist enforced in Rust
  before any eval/navigate; per-platform backend behind a trait
  (`#[cfg(target_os)]`), macOS first.
- Acceptance: eval returns values only for allowlisted origins (else `Err`);
  screenshot returns PNG bytes; a denied origin is logged + rejected; trait has a macOS
  impl and stub Windows/Linux impls returning `unimplemented`-class errors cleanly.
- Tests (first): `src-tauri/src/browser/driver.rs` tests — origin guard allow/deny
  matrix (empty allowlist, subdomain, scheme mismatch, exact match, punycode/IDN),
  input validation.
- Touched areas: `src-tauri/src/browser/driver.rs`, `origin_guard.rs`; capability.
- Dependencies: WI-0.2, WI-0.3, WI-1.2. Risks: IDN/origin-normalization bugs →
  mitigation: exhaustive table test incl. Unicode/punycode. Estimate: L.

#### WI-2.2: Injected automation agent — aria snapshot + locators + waits
- Goal: a bundled TS agent injected into every page: `snapshot()` (accessibility tree:
  role/name/state), `resolve(locator)` (role+name → element), `waitFor(predicate)`
  (MutationObserver). Namespaced global, zero Tauri.
- Acceptance: snapshot of a fixture page yields a stable role/name tree; locator
  resolves by accessible name; waitFor resolves on DOM mutation and times out cleanly.
- Tests (first): `src/lib/browser/agent/__tests__/agent.test.ts` — run agent functions
  against jsdom fixtures (empty page, deeply nested, CJK/RTL labels, duplicate names,
  shadow DOM boundary, iframe boundary).
- Touched areas: `src/lib/browser/agent/` (built to an injectable bundle). Leaf-pure
  where possible (utils tier). Estimate: L.

#### WI-2.3: Interaction tiers — synthetic + native (R5/ADR-B5)
- Goal: `browser.act` supporting click/type/select/scroll via synthetic events; escalate
  to native input (NSEvent macOS / CDP Windows) when a `trusted:true` hint is set;
  Linux synthetic-only.
- Acceptance: synthetic click works on a normal fixture; native path clicks a
  trusted-only control on macOS (manual/integration); action results report success +
  post-action snapshot.
- Tests (first): agent interaction unit tests (synthetic dispatch) + Rust native-input
  command validation test.
- Touched areas: agent + `src-tauri/src/browser/input.rs`.
- Dependencies: WI-2.1, WI-2.2. Estimate: L.

#### WI-2.4: Minimal generic reader (**pulled forward from Phase 3**)
- Goal: `browser.read` has no implementation owner unless a reader exists in this phase.
  Ship the generic Readability+Turndown reader here (it is also the R7a grant's only
  consumer), and let Phase 3 *improve* on it rather than *introduce* it.
- Acceptance: reads a fixture article to clean markdown (title, body, images resolved to
  absolute URLs, CJK preserved); non-article pages return best-effort + a flag.
- Tests (first): `src/lib/sites/generic/reader.test.ts` against saved HTML fixtures
  (long article, image-heavy, CJK, RTL, empty, no-article).
- Touched areas: `src/lib/sites/generic/`. Deps: `@mozilla/readability`, `turndown`
  (must pass `check-new-deps.sh`).
- Dependencies: WI-2.2. (Codex D5-4 — sequencing bug in v1.) Estimate: M.

#### WI-2.5: MCP v2 `vmark.browser` read/act tools + approval gate (R5)
- Goal: add `browser.open/read/snapshot/act` to v2 dispatch; wire the operation-based
  approval gate; read-only guard integration.
- Acceptance: read tools work without approval; `act` (write class) blocks on the
  approval gate and proceeds only on grant; **approval is by declared operation + target,
  not HTTP method** (R5); origin denials surface as errors; **a command whose automation
  lease or navigation generation is stale is rejected** (R11); external client + internal
  genie both reach the tools.
- **Not purely additive** (Codex D1-7): the MCP **sidecar** has a closed `BridgeRequest`
  union and a fixed tool registry (`vmark-mcp-server/src/bridge/core-types.ts`,
  `index.ts`), and `session.get_state` exposes a **document-only tab shape** that a
  browser tab breaks. This WI must therefore also: extend the sidecar schema + tool
  registry, version the session protocol, and define what an *old* sidecar sees when it
  meets a browser tab (answer: browser tabs are omitted from the legacy tab shape).
- Tests (first): `src/hooks/mcpBridge/v2/browser.test.ts` — dispatch each tool, approval
  required for act, read allowed, origin-denied path, stale-lease rejection, dedup/App-Nap
  re-emit; **sidecar contract test**: old-shape `session.get_state` omits browser tabs.
- Touched areas: `src/hooks/mcpBridge/v2/browser.ts`, dispatcher, approval store,
  `vmark-mcp-server/src/bridge/*`, `website/guide/mcp-tools.md`.
- Dependencies: WI-2.1..2.4, WI-1.9 (lease). Estimate: L.

#### WI-2.6: Approval UI + standing grants (scoped)
- Goal: an approval dialog (what action, what origin, what data) with allow-once /
  allow-for-this-workflow-and-site / deny; standing grants scoped, never global.
- Acceptance: publishing/act prompts; a scoped grant suppresses re-prompts for the same
  workflow+site only; grants are revocable in settings; dark-theme + focus-visible per
  rules 33/34.
- Tests (first): approval store tests (grant scoping, expiry, revoke) + dialog behavior
  test (ARIA roles, keyboard).
- Touched areas: `src/stores/browserApprovalStore.ts`, `src/components/Browser/ApprovalDialog/`.
- Dependencies: WI-2.4. Estimate: M.

**Phase 2 DoD:** origin-guard table test green (incl. Unicode); agent snapshot/locator/
wait tests green; synthetic interaction green + native verified on macOS (manual);
`browser.read`/`act` reachable via MCP with approval enforced; `pnpm check:all` green;
WI-linkage 2.x passes.

### Phase 3 — Site plugin system

Goal: per-site read + publish, with a generic reader floor.

#### WI-3.1: Site registry + manifest (ADR-S1)
- Goal: `src/lib/sites/registry.ts` — `registerSite`, `dispatchSite(url)`,
  `bootstrapSites(toggles)`; zod-validated manifest (`id`, `nameI18nKey`, `origins[]`,
  `capabilities`, `minAgentApi`).
- Acceptance: registration validates id/origins; dispatch returns the origin-matching
  plugin or null; invalid/version-mismatched manifests rejected loudly; origins feed the
  driver allowlist (R4).
- Tests (first): `src/lib/sites/__tests__/registry.test.ts` — register/dispatch,
  origin-precedence (most specific), invalid manifest, version gate, allowlist wiring.
- Touched areas: `src/lib/sites/registry.ts`, `types.ts`, `registryBootstrap.ts`.
- Dependencies: WI-2.1 (allowlist). Estimate: M.

#### WI-3.2: Reader hardening + fixture corpus (the reader itself shipped in WI-2.4)
- Goal: the generic reader was pulled forward to Phase 2 (Codex D5-4). This WI hardens
  it: paywall stubs, infinite-scroll/lazy-loaded content, `<article>`-less layouts,
  image lazy-load (`data-src`), and same-origin image fetching for the publish pipeline.
- Acceptance: the fixture corpus grows to cover the hard cases; each failure mode returns
  a *flagged* best-effort result rather than a confident wrong one.
- Tests (first): extend `src/lib/sites/generic/reader.test.ts` with the hard-case corpus.
- Touched areas: `src/lib/sites/generic/`.
- Dependencies: WI-2.4. Estimate: M.

#### WI-3.3: `SiteReader`/`SitePublisher` interfaces + one built-in reader plugin
- Goal: define the capability interfaces; implement ONE built-in site reader that
  overrides the generic reader (candidate: 知乎 or 公众号 article extraction).
- Acceptance: the built-in extracts a target page better than generic (measured on
  fixtures: correct title/author/body, no nav chrome); interfaces documented.
- Tests (first): plugin contract test vs recorded fixtures; interface type tests.
- Touched areas: `src/lib/sites/adapters/<site>/` (manifest, in-page module, orchestrator).
- Dependencies: WI-3.1, WI-3.2. Estimate: L.

#### WI-3.4: One built-in publisher plugin (draft-first) + `browser.publish` tool
- Goal: implement ONE publisher end-to-end (candidate from SPIKE-5: WordPress or 公众号
  draft), wired to `browser.publish`; draft-first with preview URL + explicit confirm
  before final publish (R5/ADR-S4).
- Acceptance: `browser.publish({siteId, doc})` uploads images, creates a draft, returns
  a preview URL; final publish requires a second explicit confirm; auth-missing path
  prompts login-in-pane.
- Tests (first): publisher contract test (mock in-page fetch: image upload → draft →
  publish sequence, auth-missing branch, error surfaces); tool dispatch + approval test.
- Touched areas: `src/lib/sites/adapters/<site>/publisher`, `browser.ts` tool.
- Dependencies: WI-3.1, WI-2.4, WI-2.5. Estimate: L.

#### WI-3.5: Plugin health checks + status panel + `browser.listSites`
- Goal: each plugin ships `healthCheck()` (auth probe + fixture extraction); a status
  panel surfaces pass/fail; `browser.listSites` returns ids + capabilities + health.
- Acceptance: health panel shows per-site status; a deliberately broken fixture flags
  the plugin; `listSites` reflects health; mirrors MCP sidecar health-check philosophy.
- Tests (first): healthcheck runner test (pass/fail classification), listSites test.
- Touched areas: `src/lib/sites/health.ts`, `src/components/Browser/SiteStatus/`.
- Dependencies: WI-3.1, WI-3.3. Estimate: M.

**Phase 3 DoD:** registry + origin-precedence tests green; generic reader handles the
fixture matrix; one reader + one publisher plugin pass contract tests; publish is
draft-first + double-confirm; health panel live; docs updated (`formats.md`-style
`sites` doc + mcp-tools.md); `pnpm check:all` green; WI-linkage 3.x passes.

### Phase 4 — Web workflow engine

Goal: user-authored markdown workflows execute across four tiers, with recording and
self-healing.

#### WI-4.1: Workflow file format + parser (ADR-W1)
- Goal: parse a workflow `.md` (front-matter: `site`, `inputs`, `trigger`; body: typed
  steps `api|action|goal|confirm|extract`) into a typed `WebWorkflow` IR.
- Acceptance: valid files parse; malformed steps produce precise diagnostics (line +
  reason); unknown step kind rejected; round-trips (parse→serialize) preserve author text
  for hand-written steps.
- Tests (first): `src/lib/browser/workflow/parser.test.ts` — fixture workflows (all step
  kinds, missing front-matter, unknown kind, empty body, CJK content, variable refs).
- Touched areas: `src/lib/browser/workflow/parser.ts`, `types.ts`.
- Dependencies: none (pure). Estimate: M.

#### WI-4.2: Execution engine — tiers, escalation, **and write safety** (ADR-W2/R8/R8a)
- Goal: execute steps: `api` (replay recorded fetch), `action` (semantic locator via
  agent), `goal` (genie loop: snapshot→decide→act→verify), `confirm` (block on human),
  `extract` (reader). Reads escalate automatically; **writes never do**.
- Acceptance:
  - A mixed-tier workflow runs end-to-end on a **local fixture site** (not a commercial
    platform — avoids TOS/rate-limit coupling in CI).
  - A broken *read* locator escalates to `goal`, completes, and yields a proposed patch.
  - A broken *write* step **does not auto-retry and does not auto-escalate** (R8a):
    the engine first evaluates the step's **postcondition** ("does a draft titled X now
    exist?"); if the postcondition holds, the step is marked succeeded-despite-error
    (**no double-post**); if it does not, the repair is surfaced for **re-approval as a
    new operation**.
  - `confirm` blocks regardless of standing grants; a lost automation lease (R11) pauses
    the run rather than continuing against a page the AI no longer owns.
  - Every step emits a run-log entry (R9); the genie loop has explicit timeout,
    cancellation, max-iteration, and screenshot-resolution bounds (Codex D4-7).
- Tests (first): `src/lib/browser/workflow/engine.test.ts` — per-tier execution (mock
  driver + mock genie), read-escalation, **write-no-auto-escalate**, **postcondition
  short-circuit prevents double-post**, confirm-blocks, lease-loss pause, run-record
  shape, genie-loop bounds.
- Touched areas: `src/lib/browser/workflow/engine.ts`; genie integration (reuse the
  `20260331` approval-gate shape, Q5).
- Dependencies: WI-2.x (driver/agent/act), WI-2.4 (extract), WI-1.9 (lease).
- Risks: **partial-write double-posting is the single most user-visible failure this
  feature can produce** (publishing the same article twice). The postcondition mechanism
  is the mitigation and is non-optional. (Codex D5-7.)
- Estimate: **XL** (was L).

#### WI-4.3: Recorder — dual trace → workflow file, with **honest capture bounds** (ADR-W3/R10)
- Goal: a Record toggle in the BrowserPanel; capture semantic actions AND network
  requests; generate a draft workflow preferring the API representation.
- **Capture is not equivalent across platforms** (Codex D3-7) and the recorder must say so:
  - WebView2: CDP Network domain → full request surface.
  - WebKit (macOS/Linux): `fetch`/XHR interception from the isolated world **only** —
    misses navigations, form posts, service workers, WebSockets, beacons, and anything
    fired before injection.
- Acceptance: recording a manual flow produces a runnable draft workflow; the file's
  front-matter records the **capture mode** and every generated `api:` step is marked
  **unverified until one successful replay**; anything the recorder could not observe
  degrades to an `action:`/`goal:` step rather than being silently dropped; **secrets
  (passwords, tokens, cookies, CSRF nonces) are redacted** and auth-endpoint bodies are
  never recorded; the generated file opens in the editor for review.
- Tests (first): `src/lib/browser/workflow/recorder.test.ts` — trace→file generation,
  API-preference, **secret redaction (table-driven: password field, bearer token, cookie
  header, CSRF nonce)**, unverified-marking, degradation-to-action for unobserved steps,
  replayability of generated api steps.
- Touched areas: agent (interception), `recorder.ts`, BrowserPanel toolbar.
- Dependencies: WI-2.2, WI-4.1.
- Risks: **secret leakage into a git-tracked workflow file** is the worst outcome here —
  redaction is allowlist-based (record only what is recognized as safe), not
  denylist-based. Estimate: L.

#### WI-4.4: Self-healing patch proposal + run log UI
- Goal: when escalation repairs a step, present a diff patch to the workflow file for
  approval (never auto-write); a Run Log panel shows past runs (steps, failures,
  snapshots-on-failure, proposed patches).
- Acceptance: a repaired run offers an approvable patch that, when accepted, updates the
  file and makes the next run deterministic; run log persists last N runs; rejecting a
  patch leaves the file untouched.
- Tests (first): patch-proposal test (repair→diff→apply/reject), run-log store test
  (ring buffer, persistence).
- Touched areas: `src/stores/webWorkflowStore.ts`, `src/components/Browser/RunLog/`.
- Dependencies: WI-4.2. Estimate: M.

#### WI-4.5: `browser.runWorkflow` tool + command palette + docs
- Goal: expose `browser.runWorkflow({path, inputs})`; run from command palette / genie;
  document the workflow file format and tiers.
- Acceptance: a workflow runs via MCP and via palette; inputs bind to front-matter;
  per-step approval enforced; `website/guide/` workflow doc added; strings i18n'd.
- Tests (first): tool dispatch test (input binding, per-step approval, error surface);
  palette command test.
- Touched areas: `browser.ts` tool, command registry, `website/guide/web-workflows.md`.
- Dependencies: WI-4.2..4.4. Estimate: M.

**Phase 4 DoD:** parser fixture matrix green; engine runs all tiers + escalation +
confirm-block (tests); recorder produces replayable files with secret redaction; self-heal
proposes (never auto-applies) patches; run log persists; docs added; `pnpm check:all`
green; WI-linkage 4.x passes.

### Phase 5 — Polish, hardening, cross-platform, a11y

#### WI-5.1: Windows driver backend (WebView2 + CDP)
- Goal: implement the driver trait for WebView2: `ExecuteScript` for eval, CDP
  `Input.*` for trusted input, CDP `Page.captureScreenshot`, CDP Network for recording.
- Acceptance: read/act/snapshot/record work on Windows; macOS unaffected; cross-target
  compile check green.
- Tests (first): Rust backend unit tests (mockable where possible); manual Windows E2E.
- Dependencies: Phase 2–4 macOS paths. Estimate: L.

#### WI-5.2: Linux driver backend (webkit2gtk, synthetic-only)
- Goal: `evaluate_javascript` eval, `get_snapshot` screenshot, synthetic input only;
  document native-input as unsupported on Linux v1.
- Acceptance: read/snapshot/synthetic-act work; native-input path returns a clear
  "unsupported on Linux" error; documented. Estimate: M.

#### WI-5.3: a11y + dark theme + focus audit
- Goal: audit BrowserChrome, ApprovalDialog, SiteStatus, RunLog per rules 33/34;
  keyboard nav; dark-theme parity; occlusion snapshot has an accessible label.
- Acceptance: focus-visible on every interactive surface; VoiceOver labels; dark-theme
  parity verified against css-reference; manual a11y checklist (human items enumerated).
- Tests (first): focus/ARIA behavior tests per component. Estimate: M.

#### WI-5.4: Performance + memory bench + limits doc
- Goal: `src/bench/browser.bench.ts` — generic read latency, snapshot size, hibernation
  memory ratio, live-webview cap enforcement; document limits + known limitations
  (Q4 Google OAuth, Linux input, engine=WebKit no extensions).
- Acceptance: thresholds in §10 met with headroom; known-limitations doc published.
- Estimate: M.

**Phase 5 DoD:** Windows + Linux backends land without macOS regression; cross-target
check green; a11y + dark-theme audited; benches meet §10 thresholds; known limitations
documented; full `pnpm check:all` + website build green; WI-linkage 5.x passes.

---

## 12. Rollout Plan

- **Feature flags (all default-off):**
  - `browser.enabled` — master switch (Phase 1).
  - `browser.ai` — allow AI driving (Phase 2). Off ⇒ manual-use browser only.
  - `browser.publishing` — allow write/publish tools (Phase 3).
  - `browser.workflows` — enable the workflow engine (Phase 4).
  - `browser.thirdPartyPlugins` — allow sandboxed non-built-in plugins (post-v1).
- **Staged enablement:** ship Phase 1 (manual browser) to users first; gate AI/publish
  behind separate flags so the high-privilege surface enables independently.
- **Kill switch:** disabling `browser.enabled` destroys all browser webviews, unregisters
  the `vmark.browser` tools, and no-ops workflow runs. Disabling `browser.publishing`
  hard-blocks all write-class actions regardless of grants.
- **Revert:** every phase is behind its flag; reverting = flip flag + (if needed) revert
  the phase branch. Tab-schema migration is forward-safe; a browser tab in a downgraded
  build renders as an unknown-kind placeholder, not a crash (add a guard).

## 13. Governance & Enforcement

- **TDD hook scope (§5 of 60-ai-governance):** add to `.claude/hooks/gha-tdd-guard.mjs`
  `SCOPED`: `src/lib/browser/**`, `src/lib/sites/**`, `src/components/Browser/**`,
  `src/services/browser/**`, `src/stores/browserStore.ts`,
  `src/stores/webWorkflowStore.ts`, `src/stores/browserApprovalStore.ts`.
- **Phase gate:** `scripts/check-browser-phase.sh <N>` (authored WI-0.5) — copy of
  `check-gha-phase.sh`, per-phase assertions above; must exit 0 before Status ticks.
- **WI linkage:** `bash scripts/check-wi-linkage.sh <this-plan> --phase=N` green per phase.
- **New deps:** `@mozilla/readability`, `turndown` (npm) run `check-new-deps.sh` +
  PR acknowledgment; objc2 crates get a manual repo/download review (governance §4).
- **Cross-model review:** `cc-suite:review-plan` on this plan BEFORE Phase 1 (mandatory,
  §6 — >500 lines, >3 phases, new deps).
- **Security review:** run the `security-review` / `owasp-security` pass on the driver +
  origin guard + approval gate before Phase 2 merges (this is the threat-model core).
- **No bypass:** `--no-verify` / hook removal forbidden without authorization (§9).

## 14. Testing Procedures

- **Fast checks (per WI, RED first):** `pnpm test:watch <file>`; Rust
  `cargo test --manifest-path src-tauri/Cargo.toml <module>`.
- **Per-phase:** `bash scripts/check-browser-phase.sh <N>`; `bash
  scripts/check-wi-linkage.sh dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md --phase=<N>`.
- **Full gate (before any push to main/tag):** `pnpm check:all` (lint + coverage +
  build); `pnpm check:cross` (Windows cross-compile) once Rust driver lands.
- **E2E (Tauri MCP, port 9323 — never Chrome DevTools MCP):** live open/navigate/occlusion/
  session-persist/interaction flows, driven per `tauri-mcp-testing` skill.
- **When to run:** fast on every WI; phase scripts at phase close; full gate before
  merge to main and in CI (`frontend` required check).

## 15. Plan → Verify Handoff

Evidence to collect per WI:
- **Phase 0:** **7** spike write-ups in `dev-docs/grills/embedded-browser/` each ending in
  an explicit PASS/FAIL + reproduction; screenshots for SPIKE-1/3/5/6. The
  **no-bridge/no-message-handler probe (WI-0.1, R3/R3a) is the blocking one** — if it
  fails, the plan halts rather than proceeds.
- **Phase 1:** tabStore migration test output; live screenshot of a browser tab split
  beside a markdown doc; occlusion before/after screenshots; session-persist manual log.
- **Phase 2:** origin-guard table-test output (incl. Unicode/punycode rows); agent
  snapshot JSON of a fixture; native-input trusted-click evidence (macOS).
- **Phase 3:** generic-reader fixture outputs; one reader + one publisher contract-test
  logs; a real draft created in a test account (screenshot).
- **Phase 4:** a recorded workflow file (secrets redacted) + a successful replay run log;
  a self-heal patch diff + post-heal deterministic run.
- **Phase 5:** Windows + Linux run logs; bench numbers vs §10 thresholds; a11y checklist.

Required fixtures: saved HTML for the reader matrix (`src/lib/sites/**/__fixtures__/`);
a throwaway WordPress (or equivalent) target for publishing probes; a fixture site (local
static server) for workflow E2E to avoid platform TOS/rate-limit coupling.

## 16. Manual Test Checklist

- [ ] Open a URL as a browser tab; it renders live in the pane.
- [ ] Split: browser tab left, `draft.md` right; resize splitter — native view tracks.
- [ ] Open CommandPalette over the browser — palette is ABOVE a frozen snapshot (R2).
- [ ] Log into a platform (QR or password); quit; relaunch — session persists (R6/ADR-B4).
- [ ] Open 5 browser tabs — ≤ cap live webviews; switching restores a hibernated tab.
- [ ] AI `browser.read` returns clean markdown of the current article.
- [ ] AI `browser.act` (a form submit) triggers the approval dialog; deny blocks it.
- [ ] A cross-origin eval attempt is rejected and logged (R4).
- [ ] `browser.publish` creates a DRAFT + preview URL; final publish needs a 2nd confirm.
- [ ] Record a manual flow → generated workflow file has no secrets and replays.
- [ ] Break a locator → run escalates, completes, proposes an approvable patch.
- [ ] Disable `browser.enabled` — all browser webviews torn down; tools gone (kill switch).
- [ ] (Windows) read/act/record work via WebView2+CDP; macOS unaffected.
- [ ] Known limitation: a Google-OAuth-in-webview site behaves per Q4 documentation.
- [ ] **No-bridge probe**: on a hostile test page, `__TAURI_INTERNALS__`, `window.ipc`,
      `__TAURI__` are all `undefined` and `invoke` is unreachable (I1/R3).
- [ ] **Agent invisibility**: page script cannot enumerate or shim the agent (I2).
- [ ] **Lease**: while the AI drives, clicking in the page reclaims control and the AI's
      next command is rejected — not applied (R11).
- [ ] **Double-post guard**: kill the network mid-publish; the retry detects the draft
      already exists (postcondition) and does NOT publish twice (R8a).
- [ ] **Recorder redaction**: record a login flow; the generated file contains no
      password, token, cookie, or CSRF nonce (R10/WI-4.3).
- [ ] **Overlay + IME**: open the command palette over the browser while composing
      Chinese text; composition is not corrupted on thaw (R2).
- [ ] **Crash recovery**: kill the webview content process; the tab shows a reload state
      and the app does not hang (WI-1.8).
- [ ] **R12 sweep**: a download, a file-upload input, a `target=_blank` link, an
      `alert()`, a bad TLS cert, and a geolocation request each behave as specified
      (implemented or explicitly denied) — none silently do nothing.

---

## 17. Codex review-response ledger (2026-07-12)

Cross-model review per governance §6. Codex verdict on v1: **MAJOR GAPS** — correct, and
the review paid for itself: it refuted the plan's central security invariant with a source
citation, which I independently verified before redesigning.

**Findings accepted and structurally addressed:**

| Codex finding | Disposition in this revision |
|---|---|
| D1-1 / D3-1 / D5-1 — **R3 is false**: Tauri injects `__TAURI_INTERNALS__` + IPC into every webview it creates, `add_child` included (`manager/webview.rs:166-224`); capabilities gate *authorization*, not *injection* | **Verified in `tauri-2.11.5` myself. Architecture changed**: ADR-B2 revised — VMark now creates and owns a raw `WKWebView`/`CoreWebView2`/`WebKitWebView` as a native child view; no Tauri webview, no `unstable`, no `add_child`. R3 restated as I1/I2/I3 and made a **blocking Phase 0 probe** (WI-0.1) plus a permanent regression test |
| D3-3 — `evaluateJavaScript` **cannot await a Promise**, so `fetch`-based publishing would have silently failed | ADR-B3 revised: `callAsyncJavaScript` (macOS 11+) for all promise-dependent results. Raised **Q7** (raise the macOS floor to 11, or ship read-only below it) |
| D1-2/3/4/5 — the tab model is **not** a small extension: `filePath`/`formatId` are effectively mandatory, `lastOpenTabs` is `string[]`, transfer needs document content, `Editor.tsx` dispatches before any branch | R1 rewritten as a **discriminated union**; WI-1.1 upgraded M→L and now owns the `lastOpenTabs` migration, downgrade tolerance, and an explicit transfer no-op; `Editor.tsx` must branch **before** `dispatchEditor` |
| D1-6 — R4 (origin allowlist) and R7 (read any site) **contradict** | New **R7a**: navigating a tab grants read-only access to that tab's current origin, revoked on navigation; write still requires a plugin's declared origin |
| D2-8 — **no AI/human concurrency arbitration** | New **R11** + new **WI-1.9**: single automation lease per tab, visible controlled state, human input reclaims and cancels, navigation-generation stamping rejects stale commands |
| D5-7 — self-healing can **double-post** a partially-succeeded write | New **R8a**: writes never auto-escalate; **postcondition check before any retry**; idempotency keys; repairs re-approved as new operations. WI-4.2 upgraded L→XL |
| D2-1..7 — downloads, uploads, popups, dialogs, basic auth, TLS errors, permissions, history, find, zoom, print, devtools, **crash/hang recovery** all missing | New **R12** + new **WI-1.7** (delegate surface, deny-by-default where appropriate; **the AI may never choose an upload file**) and **WI-1.8** (crash recovery + eval watchdog with stale-result rejection) |
| D2-9 — origin check covered only the top-level URL | R4 now covers the **request surface**: injected fetch targets, redirects re-checked per hop, form posts, iframe origins, beacons; canonicalization (IDN→punycode, ports, no implicit subdomain wildcard) specified |
| D3-7 — WebKit **cannot** match WebView2's CDP network capture | New **R10**: capture mode recorded in the workflow front-matter; `api:` steps marked *unverified* until first successful replay; unobservable steps degrade to `action:`/`goal:` — no silent partial capture |
| D5-4 — `browser.read` promised in Phase 2, its reader only built in Phase 3 | Generic reader **pulled forward** to WI-2.4; Phase 3's WI-3.2 becomes reader *hardening* |
| D5-3 — occlusion is a core constraint, not polish, and wasn't spiked | **New Phase 0 spike WI-0.5**: capture latency, race-free hide/show, focus + **IME** restoration, DPI/flicker |
| D5-5 — cross-platform deferred to Phase 5, but embedding is now platform-specific | **New Phase 0 spike WI-0.6**: Windows + Linux embedding pulled forward so the driver trait isn't macOS-shaped |
| D3-4 / Q6 — **NSEvent trusted input is unproven** (wry's own synthetic path is untrusted) | SPIKE-3 must answer **definitively against a real hostile site**. If FAIL: trusted input becomes **Windows-only** and macOS is synthetic-only — stated as a limitation, not worked around |
| D3-6 — dependency section was **stale** (objc2 already direct) | §3 corrected; WI-0.2 must **compile** an exact per-target matrix, not just list one |
| D1-7 — MCP change is **not** purely additive (closed sidecar `BridgeRequest` union; document-only `session.get_state` tab shape) | WI-2.5 now owns the sidecar schema/tool-registry change, session-protocol versioning, and defines that legacy `get_state` **omits** browser tabs |
| D4-5 — approval keyed on HTTP method is unsound | R5 rewritten: approval is **per declared operation + target**, and retries/self-heals re-confirm |
| D5-6 — publishing probe against a commercial platform is a TOS/account-safety risk | WI-0.7 restricted to a **self-hosted** target; commercial-platform plugins get a legal/TOS + account-safety review in Phase 3 |
| D2-5 / D4-6/7/8 — media/PDF, workflow grammar, genie-loop bounds, plugin contract details underspecified | R12 covers media; WI-4.1 must ship a **formal grammar + fixtures**; WI-4.2 bounds the genie loop (timeout/cancel/max-iter); WI-3.4 writes **one concrete publisher contract before generalizing** |

**Findings noted but deliberately not adopted:**

- *"Split the browser, publishing, and workflow projects" (D3-8).* Accepted in spirit —
  the phases are already independently flag-gated and independently shippable (Phase 1
  alone is a usable manual browser). Formally splitting into three plan files would break
  the shared ADR/rule set that makes the security invariants coherent. Revisit if Phase 1
  overruns.
- *"The companion `WebviewWindow` fallback is not an equivalent fallback" (D5-2).*
  Agreed — and it is now **removed entirely** rather than downgraded, because the revised
  ADR-B2 doesn't need it and it wouldn't have solved the IPC-injection problem anyway.

**Net effect of the review:** one architecture reversal (own the webview), three new
correctness rules (R8a write safety, R10 recorder bounds, R11 concurrency lease), one
new UX-completeness rule (R12), three new Phase 0 spikes (occlusion, cross-platform
embedding, and the security probe that would have caught the original flaw), and a
realistic re-estimate of Phase 1. **The plan is materially safer and materially bigger.
Both were true before the review; only one was visible.**

---

## 18. Codex round-2 review of the revision (2026-07-12)

Second pass, run against the revised plan. **Verdict: NEEDS REVISION** (up from MAJOR
GAPS). On the central question — *did the redesign fix the core flaw?* — **YES**:

| Claim | Round-2 verdict | Evidence |
|---|---|---|
| ADR-B2 — VMark can own a native webview as a subview of the Tauri window | **VERIFIED** | tao creates the `NSView` content view; wry replaces it with `WryWebViewParent`; the Tauri `WKWebView` is a child of that; `ns_view()` returns the content view and `addSubview` adds VMark's webview as a sibling above it. wry does not reclaim it post-init. Windows HWND path likewise feasible |
| I1 — no bridge object follows from owning the webview | **VERIFIED, conditionally** | A freshly constructed webview receives no Tauri injection. **But VMark can re-create a bridge itself** → drove new **R3a** (no page-world message handlers, no custom schemes, fresh configuration only) |
| I2 — isolated world | **macOS VERIFIED; Linux my table was WRONG (named worlds DO exist); Windows my table was WRONG (`ExecuteScriptInIsolatedWorld` does not exist in the bindings)** | → corrected table + WI-0.6 must resolve Windows via CDP or ship the weaker form |
| `callAsyncJavaScript` awaits promises, accepts a `WKContentWorld`, macOS 11+ | **VERIFIED** (confirmed in the objc2 binding) — unblocks fetch-based publishing as a *primitive*; publishing still needs CSRF/CORS/upload work (WI-0.7) | |

**New round-2 findings, all applied to this revision:**

| Severity | Finding | Fix applied |
|---|---|---|
| **Critical** | **R4 over-claimed.** WKWebView has **no public general network-interception API**; navigation delegates don't cover subresources or page-world fetch. VMark cannot enforce origin policy over a granted page's own traffic | R4 rewritten with a **normative scope table**: we constrain *our automation* (driver eval/inject/navigate + driver-issued fetch + top-level navigation), **not** the page's own network. Q8 records that per-request policy would need a proxy — out of scope. The old wording would have shipped a security claim the code could not keep |
| **High** | **R10 was self-contradictory and would have captured nothing.** The agent runs in an *isolated world* (I2), but an isolated-world `fetch` patch **cannot see page-world `fetch`** | R10 rewritten: **recorder ≠ agent.** The recorder's interceptor is injected into the **page world** (necessarily tamperable — an accepted, bounded, user-initiated trade, never a security boundary); the agent stays isolated. Q9 records the honest fallback: if page-world capture is too lossy, `api:` tier becomes Windows-only |
| **High** | I2 platform matrix factually wrong on **both** non-macOS platforms | Corrected (see table above); WI-0.6 owns resolving Windows |
| **High** | Nothing forbade re-creating a bridge via `WKScriptMessageHandler` / `WKURLSchemeHandler` / reused configuration | New **R3a** negative-capability rule, probe-enforced |
| **High** | Phase 0 spikes rendering but not the hard native lifecycle (main-thread ownership, handle retention, focus handoff, z-order, DPI, process death); the "WI-1.2a appendix" I referenced **does not exist** | WI-0.6 acceptance expanded; the lifecycle state machine is now an explicit WI-1.2 deliverable rather than a phantom cross-reference |
| Medium | R8a postconditions were prose; a title-based check matches last week's draft; `unknown` outcomes collapsed into `failed` | R8a now requires a **typed postcondition + correlation key** and **three-valued outcomes** — on `unknown` the engine **stops and asks**, never retries |
| Medium | R11 didn't say how human input is observed or how the check is made atomic | R11 now specifies **native** event observation, AI-vs-human event tagging, and a **UI-thread check in the same critical section as dispatch** |
| Medium | R12 was a checklist, not a contract | R12 is now a **decided per-surface matrix** (implement / deny / defer, with the macOS mechanism named); WI-1.7 may not add "TBD" |
| Medium | R7a lacked a navigation lifecycle | R7a now specifies **committed-only** grants, revocation on provisional navigation, **no opaque origins** (`about:blank`/`data:`/`blob:`), no iframe coverage, and a **closed read-op set — never arbitrary eval** |
| Low | Phase-gate script assigned to two WIs; "5 spikes" stale | Fixed |

**Codex's single most likely failure mode for this project**, quoted because it is the
right thing to keep in view:

> "The team will successfully render a raw native browser view, then discover that the
> stated security and workflow guarantees do not follow from it: WebKit cannot enforce
> the claimed request-level origin policy, and isolated-world monkey-patching cannot
> record normal page traffic. The result would be a convincing browser surface with an
> unreliable recorder and publishing engine — exactly where the plan currently relies on
> prose instead of enforceable platform contracts."

Both halves of that sentence are now **fixed in the plan rather than fixed in prose**:
R4's scope table says what is and isn't enforceable, and R10 says what the recorder can
and cannot see. The remaining risk is that Phase 0 confirms them and the *product* is
smaller than hoped — which is the correct thing to learn in Phase 0 rather than Phase 4.

**Status: two review passes complete. Remaining before Phase 1** — (1) run the 7 Phase-0
spikes; (2) a third, *narrow* Codex pass on the native lifecycle state machine (WI-1.2)
once it is written, since that is now the biggest un-reviewed surface.
