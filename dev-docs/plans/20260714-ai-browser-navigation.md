# AI Browser Automation Through VMark MCP

> Created: 2026-07-14
> Revised: 2026-07-15 — comprehensive implementation contract and review remediation.
> Status: **IMPLEMENTED — Phases 1–5 automated gates and review remediation pass; Phase 0 native evidence remains pending.**
> The source implementation is complete enough for local verification, but release
> enablement and any implementation commit remain gated on the live macOS cookie-isolation
> and redirect-policy probes described in Phase 0.
> This plan supersedes the navigation-specific sketch that previously occupied this file.
> It also supersedes the older `browser.ai` rollout wording in
> `20260712-0610-embedded-browser-sites-workflows.md`; this plan's `browser.enabled`
> master switch is the authoritative decision for the MCP browser surface.
> WI-IDs use the `WI-N*` namespace.

## Outcomes

### Desired behavior

VMark exposes one visible, native embedded browser through the existing MCP sidecar.
The browser tool supports five actions:

- `read` — return the current page's ARIA snapshot.
- `act` — click or type by ARIA role and accessible name.
- `open` — create and load an AI-owned browser tab.
- `navigate` — navigate an AI-owned tab to an HTTP(S) URL.
- `wait` — wait for a specific navigation to finish, fail, or time out.

The AI can discover browser tabs through `session.get_state`, target tabs by stable id,
and receive bounded, structured results. The human can see the same page in VMark and
can co-drive it after granting access where required.

### Security outcome

The implementation must make these statements true:

1. AI-created sandbox tabs use one shared, app-lifetime, non-persistent WebKit data
   store. They never share cookies, local storage, cache, or other website data with
   human/persistent tabs.
2. A sandbox tab cannot be silently converted into a human-store tab when it is
   remounted, restored, moved, or targeted by another MCP request.
3. AI navigation is validated in Rust before it starts and again for every candidate
   top-level redirect/commit. Human navigation keeps its existing, more permissive
   behavior.
4. Human-created tabs are not implicitly attachable by an AI. The first AI use of a
   human tab requires an explicit, ephemeral human attachment approval bound to that
   tab and current navigation generation.
5. Shared-mode navigation is destination-origin approved and remains approved only
   for the destination actually committed. Redirects to a different origin require
   a fresh decision or are blocked.
6. Rust is the authoritative enforcement point for policy, tab provenance, navigation
   approval, committed origin, generation, and one-shot consumption. Frontend checks
   are advisory UX only.
7. Disabling `browser.enabled` makes every browser MCP action fail closed and tears
   down AI browser state without leaving an orphaned native view or stale authority.

### Non-goals

- No headless browser, separate automation daemon, bundled Chromium, or CLI browser.
- No automatic CAPTCHA solving, anti-automation bypass, trusted-input simulation, or
  file upload chosen by the AI.
- No DNS-rebinding claim that WebKit cannot enforce. The residual limitation is
  documented, tested where possible, and never described as complete SSRF prevention.
- No persistent AI grants, attachment approvals, one-shots, or sandbox cookies.
- No Windows/Linux native browser implementation in this plan. Their stubs must fail
  clearly and preserve cross-target compilation.

## Constraints & Dependencies

- **Runtime:** Tauri v2, React 19, Zustand v5, Vite v7, Vitest v4, pnpm, Rust.
- **Native surface:** VMark-owned `WKWebView` on macOS. The browser is not a Tauri
  webview and must not receive Tauri IPC globals.
- **macOS threading:** AppKit/WebKit objects are main-thread-only. Tauri-managed
  `BrowserSurface` state remains `Send + Sync`; native retained objects stay in
  macOS thread-local storage or another main-thread-only owner.
- **Existing browser invariants:** committed URL, navigation generation, lifecycle
  registry, isolated agent content world, operation grants, one-shot target binding,
  window-routed browser events, and native-view lifecycle must remain intact.
- **Timeouts:** `open`, `navigate`, and `wait` use a default 12,000 ms timeout and a
  hard maximum below the Rust 20 s and sidecar 25 s request limits. Every timeout is
  measured with a monotonic clock and is validated at the boundary.
- **Feature gate:** `browser.enabled` remains default-off and gates both manual browser
  UI and the full MCP browser namespace. No second undocumented gate may exist.
- **Cross-platform policy:** macOS behavior is primary. Non-macOS command stubs return
  a stable unsupported error and never create a tab record that appears usable.
- **i18n:** new React-visible strings use `t()` and new Rust-visible strings use `t!()`;
  English locale keys are added with every UI change.
- **Testing:** RED → GREEN → REFACTOR is mandatory. Tauri E2E uses the Tauri MCP
  automation port 9323, never Chrome DevTools MCP. No dev server is started by Codex.
- **Governance:** every completed WI is linked by commit message or test header;
  every phase has a fail-closed `scripts/check-ai-nav-phase.sh` gate; cross-model
  review is required before Phase 1 implementation commits.

### Research and prior art

- Apple requires a `WKWebsiteDataStore` to be assigned to the configuration before the
  `WKWebView` is created; the default store is persistent and the non-persistent store
  is the private-browsing primitive: [WKWebViewConfiguration.websiteDataStore](https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/websitedatastore).
- Apple exposes navigation-policy callbacks before content is loaded, which is the
  native enforcement seam for candidate redirects: [WKNavigationDelegate navigation policy](https://developer.apple.com/documentation/webkit/wknavigationdelegate/webview(_:decidepolicyfor:decisionhandler:)).
- OWASP calls out unsafe redirects, alternate IP forms, and DNS rebinding/pinning as
  SSRF bypass classes: [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_ForgERY_Prevention_Cheat_Sheet.html).
- Existing VMark prior art: `origin_guard.rs`, `registry.rs`, `one_shot.rs`,
  `grantSync.ts`, `browserApprovalStore.ts`, `browserUiStore.ts`, and the Tauri-MCP
  wait-for-load pattern referenced by the original navigation sketch.

## Current Behavior Inventory

### Native browser lifecycle

- `BrowserSurface` owns a platform-independent registry, crash state, standing grants,
  and one-shots in `src-tauri/src/browser/surface.rs`.
- macOS native webviews and delegates are held in thread-local maps in
  `src-tauri/src/browser/surface_macos.rs`.
- `browser_create` and `browser_navigate` currently serve the human path and use the
  permissive `validate_navigation_url`.
- `BrowserSurface` is mounted for the active browser tab and the native view is
  destroyed on unmount. The current `useBrowserNativeView` call does not carry an
  automation posture.
- Navigation events include `navigated`, `loaded`, `load-failed`, crash, popup, and
  dialog events, but `load-failed` has no navigation request identity.

### Existing MCP path

- `vmark.browser.read` and `vmark.browser.act` are routed by
  `src/hooks/mcpBridge/v2/dispatch.ts` and implemented in `v2/browser.ts`.
- The sidecar exposes one `browser` tool with `read` and `act` actions.
- Rust treats `read` as automatically allowed on any committed navigable origin under
  the old R7a assumption that only a human/frontend can navigate.
- `act` uses operation-scoped grants and target-bound one-shots. Upload is hard-denied.
- `session.get_state` currently filters browser tabs out and returns a document-only
  `SessionTab` shape.

### Settings and gates

- `settings.browser.enabled` exists, defaults to `false`, and currently gates the
  browser command registration/menu behavior.
- MCP dispatch still recognizes browser routes regardless of that setting.
- `grantSync.ts` mirrors frontend standing grants into Rust, but policy, tab attachment,
  and automation posture are not yet mirrored.

### Persistence and tab identity

- `BrowserTab` stores id, title, URL, scroll position, and generation, but not whether
  the tab is human, sandbox-AI, or shared-AI.
- Browser tabs can be deduplicated by URL, which is unsafe when two tabs have different
  data-store postures.
- Existing session/hot-exit restoration has no AI-posture migration because AI
  navigation does not yet exist.

## Gaps This Plan Closes

| Gap | Consequence | Closing WI |
|---|---|---|
| No tab provenance | Sandbox tabs can be remounted on the human store | WI-N1.1, WI-N1.2, WI-N2.1 |
| URL-only browser deduplication | AI `open` can reuse a human tab | WI-N1.1, WI-N2.2 |
| R7a auto-read assumes human-only navigation | AI navigation can expose authenticated content | WI-N1.4, WI-N3.3 |
| SSRF checks only initial input | Redirects can reach internal hosts | WI-N0.3, WI-N1.3 |
| `WKWebsiteDataStore` proposed in `BrowserSurface` | Main-thread ownership/compile failure | WI-N0.2, WI-N1.5 |
| No navigation request identity | Wait/failure races and stale results | WI-N0.4, WI-N2.1, WI-N4.1 |
| Active-tab-only native lifecycle | `navigate`/`wait` on inactive tabs is undefined | WI-N2.3, WI-N4.2 |
| Browser tabs omitted from session state | AI cannot discover targets | WI-N2.4 |
| No destination approval operation | Shared mode cannot authorize navigation correctly | WI-N3.2 |
| Feature gate only covers menu | MCP remains callable while disabled | WI-N2.6 |
| Phase gate is only prose | Security work can be called complete accidentally | WI-N0.5 and all phase gates |
| Old `browser.ai` rollout conflicts with this plan | Two incompatible enablement models | WI-N0.1, WI-N2.6 |

## Target Rules

### R1 — Browser tab provenance is authoritative

Every browser tab has one immutable current automation mode:

- `human` — created/remounted by the human browser path; uses the human/persistent
  store and cannot be AI-navigated.
- `ai-sandbox` — created by the AI path; uses the shared non-persistent AI store.
- `ai-shared` — created by the AI path; uses the human store and is subject to
  destination approval.

The mode is stored in the frontend tab model for rendering and in the Rust registry
for enforcement. A frontend-supplied mode is never sufficient to authorize a Rust
operation; the command family determines the mode and the registry checks it.

URL deduplication is allowed only when URL and automation mode match. A sandbox AI
open must never activate or reuse a human tab at the same URL.

### R2 — Store isolation is app-lifetime and explicit

The sandbox store is created lazily on the macOS main thread, retained in a native
thread-local owner, and reused by all `ai-sandbox` webviews. It is discarded when the
AI surface is disabled or the app exits. It is never persisted.

Human tabs use the existing human store. The eventual persistent profile implementation
must be abstracted as `humanStore`, not assumed to be WebKit's default store.

The webview configuration receives its selected store before `WKWebView` creation.
The implementation must prove both directions:

- human cookie/local storage is not visible in an AI sandbox tab;
- an AI sandbox cookie/local storage value is not visible in a human tab;
- two AI sandbox tabs do share the intended AI session store.

### R3 — AI navigation has a separate Rust path

Human commands remain permissive within their existing contract. AI commands are
separate (`browser_ai_create`, `browser_ai_navigate`) so a future caller cannot pass
an `isolated: bool` flag and accidentally select a weaker path.

The Rust path validates the requested URL, checks feature policy, checks the tab mode,
checks destination approval when required, creates a navigation ticket, and only then
dispatches to WebKit.

### R4 — SSRF policy applies to the actual top-level navigation

AI targets must use HTTP or HTTPS and reject at minimum:

- loopback, including `127.0.0.0/8`, `::1`, `localhost`, trailing-dot/case variants,
  IPv4-mapped loopback, and WHATWG alternate IPv4 spellings;
- RFC1918 private IPv4, ULA IPv6, link-local IPv4/IPv6, metadata addresses, unspecified
  addresses, multicast/broadcast/reserved ranges, and IPv4-mapped private addresses;
- malformed authorities, empty hosts, userinfo authority tricks, backslashes, and
  unsupported schemes.

`aiAllowLoopback=false` rejects loopback. If it is explicitly enabled, only loopback
is relaxed; private LAN, link-local, metadata, multicast, and unspecified ranges remain
blocked.

The validator runs at request time and at each top-level redirect/navigation-policy
decision. If WebKit reports an unsafe committed URL despite policy callbacks, the Rust
registry marks the page unusable, cancels or replaces it, clears authority, and emits a
failed navigation. AI `read` and `act` cannot operate on that page.

DNS rebinding where the committed URL remains a public hostname is a documented residual
limitation because WebKit owns DNS. The plan must not claim to eliminate that risk.

### R5 — AI access to human tabs requires explicit attachment

The existing R7a rule is narrowed: human navigation is evidence that the human selected
the page, but it is not by itself an AI authorization.

When AI `read` or `act` targets a `human` tab, the first request raises an ephemeral
“Allow AI to use this tab” approval. The approval is bound to `(tabId, generation)` and
expires on navigation, close, disable, or app exit. “Allow once” and “allow for this
tab until navigation” are supported; no persistent attachment is stored.

AI-created sandbox tabs do not need attachment approval. AI-created shared tabs need
destination approval for navigation and normal operation approval for mutating actions.

### R6 — Shared-mode navigation is destination-scoped

In `ai-shared` mode, every `open` and `navigate` destination requires either a matching
standing `navigate` grant or a fresh approval. Approval is against the canonical
destination origin, not the current page URL.

The approval is bound to the tab, current generation/navigation ticket, destination
origin, and operation `navigate`. A one-shot is consumed atomically by the Rust
navigation command. A redirect to another origin is blocked or requires a new approval;
it never inherits the original destination approval.

### R7 — Operation vocabulary is closed

The shared Rust/TypeScript vocabulary is:

`read`, `attach`, `click`, `type`, `navigate`, `publish`, `upload`.

`upload` remains never automatable. `attach` is a tab-access authorization and is not
treated as a page mutation. Unknown, case-variant, or whitespace-variant operations
are denied at every boundary.

### R8 — Every navigation has a ticket

Each native load receives a monotonic per-tab `navigationId`/sequence. Events include:

`tabId`, `navigationId`, `generation` when committed, URL where safe, and lifecycle
state.

`browser://load-failed` must carry the navigation identity. Generation alone is not
enough because provisional failures do not commit and therefore do not bump generation.

Late events are dropped by ticket, generation, and tab lifecycle. A newer navigation
supersedes an older one and resolves the older waiter as `superseded`, never as success.

### R9 — Wait is deterministic and bounded

`wait` accepts an optional tab id, optional navigation id, and bounded `timeoutMs`.

- If a matching navigation is already loaded, return its current result immediately.
- If it is in flight, resolve on its matching `loaded` event.
- If it fails, return a structured load failure.
- If it is superseded, return a structured stale/superseded error.
- If it exceeds the cap, return a timeout without claiming success.
- If no navigation is in flight and no ticket was supplied, return the current stable
  tab state.

The frontend uses one window-level browser event broker with buffering, not a new
listener per request that can miss an event during React/native mounting.

### R10 — Targeting and inactive tabs are explicit

An omitted `tabId` means the focused browser tab in the owning window. An explicit id
must resolve to exactly one browser tab; invalid ids never fall back to the active tab.

An inactive target is activated in its owning window before navigation or waiting. If
the owning window cannot be focused or mounted, the operation returns a structured
`WINDOW_UNAVAILABLE` error and performs no navigation.

Cross-window routing uses the Rust registry's authoritative owner label. No browser
event is broadcast to unrelated windows.

### R11 — Feature-off is fail-closed

When `browser.enabled` is false:

- MCP `read`, `act`, `open`, `navigate`, and `wait` all return `BROWSER_DISABLED`;
- no new native browser view is created;
- existing browser webviews are destroyed and AI approvals/one-shots are cleared;
- in-flight AI navigation waiters resolve as disabled/cancelled;
- the sidecar may keep its stable schema, but calls fail deterministically so clients
  do not observe a phantom tool surface.

### R12 — Results redact secrets and stale state

URLs crossing into MCP responses use `urlForAgent` and never expose embedded credentials.
Session state and approval descriptors show committed/canonical origins and never show
passwords or full sensitive query values in logs. Tool results never claim a load or
action succeeded solely because an IPC call completed.

### R13 — Human and AI UI remain visible and accessible

The native browser remains in the existing shell pane. Approval prompts and failure
states must occlude the native view correctly, use visible focus indicators, use tokens
instead of hardcoded colors, and add all strings to locale files.

## Decision Log

### D1 — One MCP browser tool with five actions

- **Options:** five separate tools; one composite browser tool; add a second navigation
  tool alongside the existing browser tool.
- **Decision:** retain one composite `browser` tool with five actions.
- **Rationale:** preserves the existing sidecar contract and keeps discovery compact;
  action-specific schemas remain explicit.
- **Rejected:** separate tools would duplicate tab targeting, approval, and timeout
  semantics and increase the public surface.

### D2 — Sandbox is the default AI posture

- **Options:** shared human store by default; separate store per AI tab; one shared
  ephemeral store for all AI tabs.
- **Decision:** one shared ephemeral store for all AI sandbox tabs.
- **Rationale:** prevents human-cookie exfiltration while allowing a login/session in
  one AI tab to be reused by another AI tab. It also matches the requested automation
  workflow.
- **Rejected:** per-tab stores prevent useful multi-tab workflows; shared human store
  makes accidental authenticated access too easy.

### D3 — Dedicated AI commands, not an `isolated` boolean

- **Options:** add `isolated: bool` to human commands; infer mode from frontend tab data;
  add separate AI commands.
- **Decision:** separate AI command family with Rust-side provenance checks.
- **Rationale:** a boolean flag is easy to omit, spoof, or lose during remount; command
  names make security review and phase gates mechanical.

### D4 — Explicit human-tab attachment

- **Options:** preserve automatic R7a read for every human tab; add a global AI consent
  toggle; require an ephemeral per-tab attachment.
- **Decision:** ephemeral per-tab attachment, with once/until-navigation choices.
- **Rationale:** preserves human/AI co-driving while preventing an AI from enumerating
  every authenticated tab merely because browser MCP is enabled.
- **Rejected:** a global toggle is too broad for multiple accounts/windows.

### D5 — Navigation ticket plus generation

- **Options:** generation only; event timestamps; navigation ticket plus generation.
- **Decision:** use a ticket for each requested load and generation for committed-page
  identity.
- **Rationale:** generation cannot identify a provisional failure; timestamps do not
  provide ordering across windows or IPC queues.

### D6 — Active-tab mounting remains the native lifecycle model

- **Options:** keep every browser webview alive; reject inactive targets; activate and
  mount inactive targets on demand.
- **Decision:** activate/mount on demand, subject to the owning-window availability
  error.
- **Rationale:** preserves the existing live-webview cap and avoids hidden native views
  while keeping tab-id targeting useful.

### D7 — DNS-rebinding is a residual limitation

- **Options:** claim hostname validation is complete; add a local proxy; document the
  WebKit DNS limitation and enforce all checks available at the navigation boundary.
- **Decision:** document and test the residual risk; do not add a proxy in this plan.
- **Rationale:** a proxy is a separate high-risk networking project and WebKit does not
  expose enough DNS control through the current surface.

### D8 — No persistent AI tabs or approvals in the first implementation

- **Options:** persist AI posture and restore it; convert AI tabs to human tabs on restart;
  do not restore AI tabs.
- **Decision:** AI-created tabs and their ephemeral state are not persisted across app
  restart. Existing human browser tabs remain human tabs.
- **Rationale:** converting a sandbox tab to the human store would be a security
  downgrade; persisting the AI store would violate the ephemeral posture.

## Open Questions

These do not block the safe default implementation unless a product decision changes.

### Q1 — Should “allow for this tab” survive a same-document navigation?

- **Why it matters:** URL/generation signals cannot observe every DOM replacement.
- **Who decides:** security/product owner.
- **Default:** attachment expires on every committed navigation and on any detected
  same-document URL change; DOM-level element binding remains a follow-up.

### Q2 — What should macOS 10.15 do if a required WebKit API is unavailable?

- **Why it matters:** the project minimum is below some newer WebKit capabilities.
- **Who decides:** product owner after Phase 0 native probe.
- **Default:** browser AI automation remains disabled on unsupported macOS versions;
  human browser behavior is unchanged.

### Q3 — Should a user-visible “AI attached” badge be added to browser chrome?

- **Why it matters:** attachment is security-relevant and should be observable.
- **Who decides:** product owner.
- **Default:** show a compact status/badge in the bottom browser lane; no hidden state.

## Data Model

### Frontend `BrowserTab`

Add fields to the existing discriminated union:

```text
automationMode: "human" | "ai-sandbox" | "ai-shared"
persistPolicy: "restore-human" | "transient-ai"
```

AI tabs are transient and are excluded from hot-exit persistence. Existing serialized
browser tabs with no new field migrate to `human` / `restore-human`.

### Rust `BrowserRegistry::Entry`

The authoritative entry contains:

```text
tab_id
window_label
automation_mode
lifecycle
generation
committed_url
navigation_sequence
active_navigation: Option<NavigationTicket>
attached_human_generation: Option<u64>
```

`NavigationTicket` contains a monotonic per-tab sequence, requested canonical URL,
requested operation, and the policy epoch used at request time. It is not exposed with
credentials.

### Rust AI policy

```text
AiBrowserPolicy {
  enabled: bool,
  session: "sandbox" | "shared",
  allow_loopback: bool,
  epoch: u64,
}
```

The policy defaults to disabled/sandbox/no-loopback in Rust. Frontend sync is a desired
state; Rust validates values and remains authoritative. Changing session posture or
disabling the feature invalidates AI tabs and pending AI navigation tickets.

### Ephemeral authorization

Keep three separate concepts:

- standing origin grants for operations such as click/type/publish/navigate;
- tab/generation-bound human attachments;
- one-shot approvals bound to tab, generation, navigation ticket, origin, operation,
  and target descriptor.

None are persisted. Navigation one-shots are consumed by the Rust navigation command,
not by the frontend eval path.

### Session state union

Replace the document-only session tab shape with a discriminated union:

```text
DocumentSessionTab {
  id, kind: "document", filePath, title, dirty, revision, documentKind
}

BrowserSessionTab {
  id, kind: "browser", title, url, loading, generation, automationMode
}
```

`url` is redacted for MCP. `loading` comes from the authoritative browser lifecycle
broker; inactive tabs report `false` or a documented `unknown` state, never stale
transient state from an unmounted React surface.

### Migration plan

1. Bump the browser/session persistence schema only when AI tabs are actually persisted
   by an implementation decision; the default implementation does not persist AI tabs.
2. Migrate every existing browser tab without `automationMode` to `human`.
3. Drop transient AI tabs during restore rather than converting them to human tabs.
4. Keep existing grants/approval storage behavior unchanged: in-memory only.
5. Rollback to a build without this feature must render no AI tab as a human tab. Unknown
   transient AI records are discarded by the restore parser.

## API / Contract Changes

### MCP browser tool

The sidecar schema remains one tool named `browser`:

```text
browser({
  action: "read",
  tabId?: string
})

browser({
  action: "act",
  tabId?: string,
  operation: "click" | "type",
  role: string,
  name: string,
  text?: string
})

browser({
  action: "open",
  url: string,
  timeoutMs?: number
})

browser({
  action: "navigate",
  tabId?: string,
  url: string,
  timeoutMs?: number
})

browser({
  action: "wait",
  tabId?: string,
  navigationId?: string,
  timeoutMs?: number
})
```

Required validation:

- `url` must be a non-empty string; AI URL policy is enforced in Rust.
- `tabId` must be a non-empty string when supplied.
- `timeoutMs` must be a finite integer from 1 to 12,000; default 12,000.
- `navigationId` must be a non-empty string when supplied.
- `act` keeps its current non-empty role/name and explicit type-text rules.

Success payloads use structured JSON:

```text
{
  tabId,
  url,
  title,
  generation,
  navigationId,
  loading: false
}
```

`open` and `navigate` start a ticket and wait for that ticket's terminal outcome up
to `timeoutMs`. On success they return `loading: false`. On `TIMEOUT`, the response
must still include the `tabId` and `navigationId` when those values are known, so the
caller can issue `wait` later. `wait` never starts a new navigation. A successful
`open` returns the newly created AI tab id; it does not activate or reuse a human tab.

Failures use stable codes alongside human-readable messages:

`BROWSER_DISABLED`, `UNSUPPORTED_PLATFORM`, `INVALID_URL`, `SSRF_BLOCKED`,
`TAB_NOT_FOUND`, `TAB_NOT_AI_OWNED`, `ATTACHMENT_REQUIRED`, `APPROVAL_REQUIRED`,
`STALE_NAVIGATION`, `NAVIGATION_FAILED`, `NAVIGATION_SUPERSEDED`, `TIMEOUT`,
`WINDOW_UNAVAILABLE`, `INTERNAL`.

Approval failures include `{needsApproval, operation, url, tabId, generation}` without
credentials or sensitive query values.

### Frontend bridge routes

Add:

- `vmark.browser.open`
- `vmark.browser.navigate`
- `vmark.browser.wait`

Keep:

- `vmark.browser.read`
- `vmark.browser.act`

The exact route list is locked in `dispatch.test.ts`, not represented only by the
namespace wildcard in `SUPPORTED_TOOL_PREFIXES`.

### Native command surface

Add or update commands as needed by the implementation, with the following security
seams:

- `browser_ai_create(tab_id, url)` — creates an AI-owned tab according to Rust policy.
- `browser_ai_navigate(tab_id, url)` — validates destination, approval, ticket, and mode.
- `browser_ai_policy(policy)` — validates and replaces policy atomically.
- `browser_ai_attach(tab_id, generation)` — mints a human-tab attachment after a UI
  decision; Rust verifies current generation.
- `browser_ai_state(tab_id)` — returns authoritative lifecycle/ticket state for wait and
  inactive-tab activation.

Existing human commands remain separate and do not gain an untrusted posture argument.
All new commands are registered in the command registry, capability configuration, and
non-macOS stubs.

## Observability

Add a browser security logger with redaction:

- AI navigation request: tab id, mode, policy epoch, navigation sequence, redacted
  origin, decision, and elapsed time.
- SSRF rejection: category only — never full credential-bearing URL.
- Approval request/decision: operation, tab id, generation, redacted origin, outcome.
- Navigation completion/failure/supersession: ticket and elapsed time.
- Feature-off teardown: number of destroyed AI views, cleared tickets, and pending waiters.

Metrics/debug counters:

- AI open/navigate success, rejection, timeout, redirect-block, and superseded counts.
- active AI sandbox webview count and shared-store lifetime.
- wait latency percentiles and event-broker buffer drops.
- approval/attachment allow-once, allow-until-navigation, deny counts.

Never log page snapshots, cookies, credentials, full query strings, or raw approval
descriptors. Add a developer-only verbose toggle if needed, still redacted.

## Work Items

Ordering is strict. Tests are written first for every behavior WI. A phase is not complete
until its gate and WI-linkage check pass.

### Phase 0 — Security contract and native feasibility

#### WI-N0.1: Freeze the security contract and supersession map

- **Goal:** reconcile this plan with the embedded-browser and browser-shell plans,
  explicitly superseding the old `browser.ai` wording and recording R1–R13 as the
  implementation contract.
- **Acceptance:** this plan names every security invariant, has no “block-all” ambiguity,
  maps every identified gap to a WI, and `check-wi-linkage.sh` can parse all WIs.
- **Tests first:** `scripts/check-ai-nav-plan.sh` (new shell self-check); assert required
  headings, unique WI IDs, all phases, and no stale `browser.ai` authority claim.
- **Touched areas:** this plan; `dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md`
  only if a supersession note is required; `scripts/check-ai-nav-plan.sh`.
- **Dependencies:** none.
- **Risks + mitigations:** plan drift; make the phase gate fail when required sections or
  invariants disappear.
- **Rollback:** documentation-only revert.
- **Estimate:** S.

#### WI-N0.2: Spike main-thread AI store ownership

- **Goal:** prove `WKWebsiteDataStore::nonPersistentDataStore` can be created, retained,
  reused by multiple webviews, and assigned before webview creation without placing a
  main-thread-only object in `BrowserSurface`.
- **Acceptance:** runnable macOS probe records PASS/FAIL; two AI webviews share a cookie,
  human and AI webviews do not; disable/drop releases the AI store; macOS minimum-version
  behavior is recorded.
- **Tests first:** `dev-docs/grills/ai-browser/spike-store/` probe and `SPIKE-STORE.md`;
  failing cookie-isolation assertions precede the probe implementation.
- **Touched areas:** spike directory; likely `src-tauri/src/browser/surface_macos.rs`
  only after the probe passes.
- **Dependencies:** objc2-web-kit feature already present; real macOS runtime.
- **Risks + mitigations:** API availability or ownership mismatch; keep the plan halted
  until the native owner is proven.
- **Rollback:** delete the throwaway probe; no product code is accepted on a failed spike.
- **Estimate:** M.

#### WI-N0.3: Spike redirect and navigation-policy enforcement

- **Goal:** verify the native delegate can observe and deny unsafe top-level redirects
  before AI content becomes readable.
- **Acceptance:** a fixture redirecting public → loopback/private is denied; a public
  redirect staying public succeeds; blocked commits clear Rust authority and emit a
  ticket-correlated failure.
- **Tests first:** macOS fixture page/server plus native policy probe; tests cover direct
  navigation, HTTP redirect, HTTPS redirect, meta refresh, and failed provisional load.
- **Touched areas:** `src-tauri/src/browser/nav_delegate_macos.rs`, navigation payloads,
  `dev-docs/grills/ai-browser/spike-redirect/`.
- **Dependencies:** WI-N0.2 native probe environment.
- **Risks + mitigations:** WebKit callback differences; use a fail-closed committed-page
  guard even if preflight policy is incomplete.
- **Rollback:** keep AI navigation disabled if the probe cannot prove the boundary.
- **Estimate:** M.

#### WI-N0.4: Spike navigation tickets and event buffering

- **Goal:** prove a global frontend event broker can correlate create, commit, load,
  failure, supersession, timeout, and unmount without losing events during React mount.
- **Acceptance:** deterministic tests pass for event-before-waiter, waiter-before-event,
  duplicate events, stale generation, provisional failure with no generation, concurrent
  navigations, and tab destruction.
- **Tests first:** `src/services/browser/browserEventBroker.test.ts`; Rust payload tests
  in `src-tauri/src/browser/nav_payloads.test.rs`.
- **Touched areas:** new `src/services/browser/browserEventBroker.ts`; navigation payloads;
  `src/components/Browser/useBrowserNavEvents.ts`.
- **Dependencies:** existing browser event contract.
- **Risks + mitigations:** singleton listener leaks; explicit start/stop ownership and
  bounded per-tab buffers.
- **Rollback:** retain current surface listeners while AI routes remain disabled.
- **Estimate:** M.

#### WI-N0.5: Add fail-closed phase gates and fixtures

- **Goal:** create `scripts/check-ai-nav-phase.sh <0|1|2|3|4|5>` and the fixture inventory
  required by later phases.
- **Acceptance:** unknown phases, missing files, missing assertions, and zero WIs fail;
  each phase checks both positive and negative security properties; the script invokes
  `check-wi-linkage.sh` for its phase.
- **Tests first:** `scripts/check-ai-nav-phase.test.sh` or executable shell assertions;
  deliberately remove/rename each required symbol and verify non-zero exit.
- **Touched areas:** `scripts/check-ai-nav-phase.sh`; `dev-docs/grills/ai-browser/fixtures/`.
- **Dependencies:** WI-N0.1.
- **Risks + mitigations:** grep-only false greens; require file existence, exact route
  lists, negative assertions, and runtime/unit test commands where practical.
- **Rollback:** phase gates remain required; do not weaken them to unblock implementation.
- **Estimate:** M.

#### WI-N0.6: Cross-model and security review before Phase 1

- **Goal:** obtain the mandated independent review of this plan and the Phase 0 probe
  results before any Phase 1 product commit.
- **Acceptance:** review records disposition for every Critical/High finding; no
  unresolved security assumption is silently marked complete.
- **Tests first:** `bash scripts/check-ai-nav-phase.sh 0`; review evidence and probe PASS
  reports are required artifacts.
- **Touched areas:** plan review record under `dev-docs/grills/ai-browser/`; no product
  code unless a review-approved change is required.
- **Dependencies:** WI-N0.2–WI-N0.5.
- **Risks + mitigations:** review discovers a design-blocking native limitation; keep
  Phase 1 gated and revise the ADR rather than bypassing it.
- **Rollback:** remain at Phase 0.
- **Estimate:** M.

### Phase 1 — Authoritative state, SSRF, and isolation foundation

#### WI-N1.1: Add browser automation provenance to the data model

- **Goal:** add `automationMode` and transient-AI persistence rules to `BrowserTab`,
  restore migration, tab helpers, and browser-tab tests.
- **Acceptance:** human/sandbox/shared tabs are type-safe; URL deduplication never merges
  different modes; old records migrate to human; AI records are discarded on restore;
  a remount preserves the mode.
- **Tests first:** `src/stores/__tests__/tabStore.browser.test.ts`; persistence/restore
  migration tests; cases for same URL across modes, malformed mode, duplicate ids, and
  restart behavior.
- **Touched areas:** `src/stores/tabStoreTypes.ts`, `tabStore.ts`, `tabStoreBrowser.ts`,
  hot-exit/session restore modules, related tests.
- **Dependencies:** WI-N0.1.
- **Risks + mitigations:** persisted schema drift; default unknown values to human and
  never upgrade authority during migration.
- **Rollback:** remove transient AI records; existing human tabs remain usable.
- **Estimate:** M.

#### WI-N1.2: Make Rust registry provenance and attachment authoritative

- **Goal:** extend `BrowserRegistry` and `BrowserSurface` with automation mode, active
  navigation ticket, policy epoch, and generation-bound human attachment state.
- **Acceptance:** Rust rejects AI navigation on human tabs, rejects human operations
  against AI-owned state where inappropriate, clears attachments on navigation/close,
  and remains correct under duplicate destroy and late native callbacks.
- **Tests first:** `src-tauri/src/browser/registry.test.rs`, `surface.test.rs`, and a new
  attachment policy test; table-driven lifecycle and stale-callback cases.
- **Touched areas:** `registry.rs`, `surface.rs`, `commands_auth.rs`, `one_shot.rs`,
  `operation.rs`, command registry, non-macOS stubs.
- **Dependencies:** WI-N1.1.
- **Risks + mitigations:** lock-order or stale-callback regressions; keep registry
  mutations atomic and preserve existing terminal-state rules.
- **Rollback:** fields default to human/no attachment; old human commands remain available.
- **Estimate:** L.

#### WI-N1.3: Implement the AI SSRF validator and committed-page guard

- **Goal:** add `is_ai_navigable` plus committed/redirect validation without changing
  human navigation policy.
- **Acceptance:** Rust and TypeScript parity tests cover every R4 range, alternate IP
  spelling, IDN/Unicode, localhost variants, malformed authorities, loopback relaxation,
  direct targets, redirects, blocked commits, and DNS-rebinding documentation.
- **Tests first:** `src-tauri/src/browser/origin_guard.test.rs`; new TS origin-guard tests;
  redirect/commit policy tests from WI-N0.3.
- **Touched areas:** `src-tauri/src/browser/origin_guard.rs`, navigation delegate/payloads,
  `src/lib/browser/origin/originGuard.ts`, browser redaction/error helpers.
- **Dependencies:** WI-N0.3, WI-N1.2.
- **Risks + mitigations:** parser divergence and incomplete IP ranges; use the existing
  URL parser, test Rust/WHATWG parity, and fail closed on unknown host forms.
- **Rollback:** AI navigation remains disabled; human validation is untouched.
- **Estimate:** L.

#### WI-N1.4: Separate operation and AI-access policy decisions

- **Goal:** update the closed vocabulary and Rust/TS policy decision functions for
  `attach` and `navigate`, while distinguishing human-tab attachment from page actions.
- **Acceptance:** unknown operations, upload, wrong mode, missing attachment, wrong
  generation, wrong origin, wrong destination, and stale policy epoch all deny; sandbox
  AI read/act works only on sandbox tabs; shared AI navigation is destination-scoped.
- **Tests first:** `operation.test.rs`, `origin_guard.test.rs`, `grants.test.ts`,
  `browserApprovalStore.test.ts`, and new AI policy matrix tests.
- **Touched areas:** `operation.rs`, `origin_guard.rs`, `one_shot.rs`,
  `src/lib/browser/approval/grants.ts`, `browserApprovalStore.ts`, `commands_auth.rs`.
- **Dependencies:** WI-N1.2, WI-N1.3.
- **Risks + mitigations:** accidentally restoring R7a blanket read; test every mode and
  provenance combination, including a human tab with the same URL as an AI tab.
- **Rollback:** default deny all new AI operations; existing human browser remains manual.
- **Estimate:** L.

#### WI-N1.5: Wire the macOS shared sandbox store

- **Goal:** implement the main-thread store owner proven by WI-N0.2 and select it from
  the dedicated AI create path.
- **Acceptance:** no `WKWebsiteDataStore` is stored in `BrowserSurface`; configuration
  store selection occurs before webview creation; cookie probe passes; disabling the AI
  surface drops the store and clears AI views.
- **Tests first:** native probe regression plus Rust/native lifecycle tests; compile test
  confirms the non-macOS stub remains valid.
- **Touched areas:** `surface_macos.rs`, a new macOS-only store owner module,
  `surface.rs`, `commands.rs`, `command_registry.rs`, Cargo feature wiring if required.
- **Dependencies:** WI-N0.2, WI-N1.1.
- **Risks + mitigations:** main-thread ownership and store lifetime; retain the store in
  the same thread-local owner as webviews and test teardown/recreation.
- **Rollback:** sandbox AI commands return unsupported/disabled; human store path remains.
- **Estimate:** L.

### Phase 2 — Sandbox open, navigate, wait, and discovery

#### WI-N2.1: Add native AI create/navigation tickets

- **Goal:** implement `browser_ai_create` and `browser_ai_navigate` with ticket creation,
  mode checks, SSRF checks, committed-origin clearing, generation stamping, and event
  emission.
- **Acceptance:** AI create returns/announces a unique ticket; navigation starts only
  after policy checks; every terminal event carries ticket identity; late events cannot
  mutate a destroyed/reused tab; human commands cannot create an AI-mode tab.
- **Tests first:** `commands.test.rs`, `registry.test.rs`, `nav_payloads.test.rs`, and
  native lifecycle tests for success/failure/redirect/cancel.
- **Touched areas:** `commands.rs`, new AI command module if needed, registry, nav delegate,
  payloads, `command_registry.rs`, `capabilities/default.json`, platform stubs.
- **Dependencies:** WI-N1.2–WI-N1.5, WI-N0.4.
- **Risks + mitigations:** duplicate native views or double generation bumps; reuse the
  existing lifecycle coordinator and make ticket creation one-shot per request.
- **Rollback:** AI routes return `UNSUPPORTED` while human navigation remains unchanged.
- **Estimate:** L.

#### WI-N2.2: Build the window-level browser event broker

- **Goal:** create a bounded, testable frontend broker that subscribes once to browser
  lifecycle events and supports ticket-correlated waiters.
- **Acceptance:** no event is lost during React mount; waiters resolve only for matching
  tab/ticket; cleanup removes listeners and timers; buffer size and waiter count are
  bounded; events for other windows/tabs are ignored.
- **Tests first:** `src/services/browser/browserEventBroker.test.ts`; hook integration
  tests for subscription/cleanup and stale events.
- **Touched areas:** new broker service; `useBrowserNavEvents.ts`; `BrowserSurface.tsx`;
  `browserUiStore.ts` only for stable loading projection.
- **Dependencies:** WI-N0.4, WI-N2.1.
- **Risks + mitigations:** singleton lifecycle leaks; expose explicit `start`, `stop`,
  and `resetForTests`, and assert listener counts.
- **Rollback:** AI wait remains disabled while existing per-surface events continue.
- **Estimate:** M.

#### WI-N2.3: Implement AI frontend handlers and inactive-tab activation

- **Goal:** add `handleBrowserOpen`, `handleBrowserNavigate`, and `handleBrowserWait`,
  including tab creation, mode preservation, owner-window activation, and bounded wait.
- **Acceptance:** open never reuses a human tab; navigate/wait on an inactive tab mounts
  the correct surface or returns `WINDOW_UNAVAILABLE`; explicit invalid ids never fall
  back; repeated requests produce deterministic superseded/stale results.
- **Tests first:** `src/hooks/mcpBridge/v2/__tests__/browser.test.ts`, activation/router
  tests, and `BrowserSurface`/native-view lifecycle tests.
- **Touched areas:** `src/hooks/mcpBridge/v2/browser.ts`, `dispatch.ts`, tab operations,
  `useBrowserNativeView.ts`, browser event broker, window-routing helpers.
- **Dependencies:** WI-N1.1, WI-N2.1, WI-N2.2.
- **Risks + mitigations:** React effect/native command race; wait on brokered start ticket,
  not on component mount timing.
- **Rollback:** open/navigate/wait return a structured unsupported error; read/act remain.
- **Estimate:** L.

#### WI-N2.4: Add browser tabs to session state

- **Goal:** expose a discriminated document/browser session union with redacted URL,
  title, loading, generation, and automation mode.
- **Acceptance:** every window lists browser tabs; document fields never appear on browser
  entries; inactive tabs have defined loading semantics; credentials never cross MCP;
  session output remains backward-compatible for document consumers.
- **Tests first:** `src/hooks/mcpBridge/v2/__tests__/session.test.ts` with human,
  sandbox, shared, inactive, loading, malformed, and credential-bearing URL fixtures.
- **Touched areas:** `v2/session.ts`, `v2/types.ts`, `url.ts`/redaction, browser UI/lifecycle
  state source.
- **Dependencies:** WI-N1.1, WI-N2.2.
- **Risks + mitigations:** transient store missing for inactive tabs; derive from stable
  tab/registry metadata, not from a mounted surface only.
- **Rollback:** continue document-only session output while the route is disabled.
- **Estimate:** M.

#### WI-N2.5: Extend the sidecar browser contract

- **Goal:** add the three actions, schemas, bridge union variants, response typing,
  approval/error rendering, descriptions, and action count updates.
- **Acceptance:** sidecar rejects malformed args locally; forwards exact flat bridge
  requests; returns typed JSON; renders approval, timeout, stale, disabled, and SSRF
  failures without losing structured data; tool/category counts are correct.
- **Tests first:** `vmark-mcp-server/__tests__/unit/tools/browser.test.ts`, core-types
  tests, server/tool-count tests, and bridge mock tests.
- **Touched areas:** `vmark-mcp-server/src/tools/browser.ts`, `bridge/core-types.ts`,
  `bridge/types.ts`, `index.ts`, related tests and README if generated.
- **Dependencies:** WI-N2.3, public contract in this plan.
- **Risks + mitigations:** sidecar/frontend schema drift; use discriminated request types
  and exact route fixtures in both repositories.
- **Rollback:** hide new actions from the schema while old read/act remain compatible.
- **Estimate:** M.

#### WI-N2.6: Gate the complete browser MCP surface

- **Goal:** make `browser.enabled` authoritative for manual browser creation and every
  MCP browser action, including teardown and in-flight cancellation.
- **Acceptance:** toggling off destroys native views, clears AI state, rejects all five
  actions with `BROWSER_DISABLED`, prevents new mounts, and re-enabling starts cleanly;
  feature-off tests cover startup, hydration, rapid toggle, and multiple windows.
- **Tests first:** settings store tests, dispatch/browser handler tests, native teardown
  tests, and sidecar feature-off contract tests.
- **Touched areas:** settings subscriber/service, `dispatch.ts`, browser handlers,
  `useBrowserNativeView.ts`, `BrowserSurface`, Rust policy command/state.
- **Dependencies:** WI-N1.2, WI-N2.3.
- **Risks + mitigations:** stale frontend setting versus Rust state; Rust defaults deny
  and policy sync is serialized/coalesced like grants.
- **Rollback:** leave the gate default-off and return disabled for all AI routes.
- **Estimate:** M.

### Phase 3 — Shared posture and human co-driving approvals

#### WI-N3.1: Add persisted AI posture settings

- **Goal:** add `browser.aiSession` (`sandbox` default, `shared`) and
  `browser.aiAllowLoopback` (`false` default), including validation, migration, settings
  UI, locale keys, and policy sync.
- **Acceptance:** malformed persisted values sanitize to safe defaults; settings changes
  are serialized to Rust; changing posture invalidates existing AI tabs/tickets rather
  than silently changing their data store; loopback requires an explicit user action.
- **Tests first:** settings type/default/persistence tests, policy-sync tests, and
  `AdvancedSettings.test.tsx` for labels, warnings, focus, and i18n keys.
- **Touched areas:** `src/stores/settingsTypes/workspace.ts`, defaults/store persistence,
  `AdvancedSettings.tsx`, locale files, new `useBrowserAiPolicySync`, Rust policy command.
- **Dependencies:** WI-N2.6, WI-N1.5.
- **Risks + mitigations:** settings windows have separate JS stores; use a single serialized
  policy sync and show effective Rust policy on failure.
- **Rollback:** force sandbox/no-loopback in Rust and hide advanced controls.
- **Estimate:** M.

#### WI-N3.2: Implement shared destination approval

- **Goal:** add destination-origin `navigate` approval, standing grants, and atomic
  navigation one-shot consumption.
- **Acceptance:** shared open/navigate prompts before any request starts; allow-once binds
  to tab/generation/ticket/destination; remember grants only that origin/operation;
  redirect to a new origin is denied or re-prompts; no approval can be replayed on a
  different tab, generation, target, or URL class.
- **Tests first:** Rust navigation-approval matrix tests, frontend approval-store tests,
  destination redirect tests, and sidecar `needsApproval` response tests.
- **Touched areas:** `operation.rs`, `one_shot.rs`, `commands_auth.rs`, origin guard,
  `browserApprovalStore.ts`, `grantSync.ts`, browser handler.
- **Dependencies:** WI-N1.4, WI-N2.1, WI-N3.1.
- **Risks + mitigations:** current approval store is action-oriented and assumes eval;
  introduce an explicit navigation pending shape rather than overloading target fields.
- **Rollback:** shared mode returns disabled/unsupported; sandbox remains available.
- **Estimate:** L.

#### WI-N3.3: Implement human-tab attachment approval

- **Goal:** add the visible UI and authoritative state for allowing AI use of a human
  tab without introducing a new MCP action.
- **Acceptance:** first human-tab read/act raises a descriptor showing tab, committed
  origin, and expiry; allow-once and until-navigation work; deny never evaluates; the
  attachment disappears on navigation, close, disable, restart, or window teardown.
- **Tests first:** `BrowserApprovalDialog.test.tsx`, new attachment-store tests,
  Rust attachment command tests, and browser handler tests for pending/allow/deny.
- **Touched areas:** `browserApprovalStore.ts` or a dedicated attachment store,
  `BrowserApprovalDialog.tsx`, browser components/styles, Rust attachment commands.
- **Dependencies:** WI-N1.2, WI-N1.4, WI-N2.3.
- **Risks + mitigations:** approval UI could be occluded by the native view; route through
  the existing occlusion controller and verify focus/keyboard behavior manually.
- **Rollback:** require attachment for every human-tab AI request; never fall back to
  automatic R7a read.
- **Estimate:** L.

#### WI-N3.4: Make shared-mode read/act policy redirect-safe

- **Goal:** ensure an AI-navigated shared tab cannot inherit the old R7a automatic read
  grant after a redirect or same-document authority change.
- **Acceptance:** read/act on a shared AI tab is allowed only for the currently approved
  committed origin and generation; redirect to an unapproved origin clears authority;
  human manual navigation can reclassify the page only through an explicit state change.
- **Tests first:** Rust driver policy tests, nav delegate integration tests, and browser
  handler tests for redirect, same-document, crash, and manual handoff.
- **Touched areas:** registry provenance, `origin_guard.rs`, `commands_auth.rs`, nav
  events, browser handler and approval store.
- **Dependencies:** WI-N3.2, WI-N3.3, WI-N0.3.
- **Risks + mitigations:** same-document DOM changes are not fully observable; keep the
  known limitation explicit and use target/generation binding as the primary control.
- **Rollback:** shared mode disabled; sandbox and explicitly attached human tabs remain.
- **Estimate:** L.

### Phase 4 — Concurrency, windows, persistence, and hardening

#### WI-N4.1: Harden navigation concurrency and TOCTOU behavior

- **Goal:** serialize or arbitrate per-tab AI navigation and make stale results fail
  closed under rapid repeated calls, approval races, timeout races, and destruction.
- **Acceptance:** only the winning ticket can update current state; an approval arriving
  after navigation is stale; timeout does not cancel a later navigation accidentally;
  one-shot consumption is atomic; duplicate responses cannot double-apply navigation.
- **Tests first:** `registry.test.rs`, command tests, event-broker tests, browser MCP
  tests with fake timers and deferred promises.
- **Touched areas:** registry/ticket coordinator, native driver loop, event broker,
  browser handlers, sidecar timeout mapping.
- **Dependencies:** WI-N2.1, WI-N2.2, WI-N3.2.
- **Risks + mitigations:** deadlocks from blocking main-thread waits; use monotonic caps,
  per-tab state machines, and never hold Rust mutexes while pumping WebKit.
- **Rollback:** reject concurrent AI navigations with `NAVIGATION_IN_FLIGHT` rather than
  attempting arbitration.
- **Estimate:** L.

#### WI-N4.2: Complete multi-window routing and native teardown

- **Goal:** route AI commands/events to the registry owner and clean all browser state
  when a window closes or a tab is destroyed.
- **Acceptance:** two windows with browser tabs do not cross-update URLs, loading, prompts,
  history, or approvals; a closed owner drops native views, delegates, tickets,
  attachments, and waiters; late callbacks are dropped without broadcast.
- **Tests first:** Rust window teardown tests, payload routing tests, frontend two-window
  browser handler tests, and Tauri MCP manual verification.
- **Touched areas:** `registry.rs`, `nav_emit_macos.rs`, teardown modules, event broker,
  window-routing helpers, browser stores.
- **Dependencies:** WI-N1.2, WI-N2.2, WI-N2.3.
- **Risks + mitigations:** frontend windows have separate JS contexts; Rust owner labels
  remain the source of truth and unavailable owners return structured errors.
- **Rollback:** restrict MCP browser targets to the focused window and fail explicit
  cross-window ids rather than risk cross-wiring.
- **Estimate:** L.

#### WI-N4.3: Finalize persistence and restore safety

- **Goal:** ensure hot exit, workspace restore, closed-tab reopen, and tab transfer do
  not persist or silently downgrade AI state.
- **Acceptance:** AI tabs are absent after restart; human tabs restore as human; closed
  AI tabs cannot be reopened into the human store; tab transfer either rejects AI tabs or
  preserves mode with a fresh sandbox creation according to the chosen contract.
- **Tests first:** workspace/session restore tests, closed-tab tests, transfer tests,
  malformed persisted input tests, and downgrade compatibility tests.
- **Touched areas:** tab persistence/schema migration, workspace transfer/restore services,
  browser tab helpers.
- **Dependencies:** WI-N1.1, D8.
- **Risks + mitigations:** existing restore code may assume every browser URL is restorable;
  add an explicit transient-AI filter and fail-closed parser branch.
- **Rollback:** discard all AI records during restore.
- **Estimate:** M.

#### WI-N4.4: Add redacted observability and diagnostics

- **Goal:** implement the metrics, structured errors, redacted logs, and developer
  diagnostics defined above.
- **Acceptance:** every AI request has a correlation/ticket id; logs contain no password,
  cookie, snapshot, or full sensitive query; failures distinguish disabled, denied,
  stale, timeout, redirect-block, and unsupported platform.
- **Tests first:** redaction tests, error-code serialization tests, log fixture tests,
  and metrics counter tests.
- **Touched areas:** browser logging helpers, Rust `redact.rs`, bridge error types,
  sidecar error rendering, debug settings if used.
- **Dependencies:** WI-N2.5, WI-N4.1.
- **Risks + mitigations:** logging page-controlled titles or URLs; sanitize all fields at
  the trust boundary and use origin-only logs by default.
- **Rollback:** retain only counters and generic errors; never restore raw logging.
- **Estimate:** M.

#### WI-N4.5: Complete non-macOS stubs and cross-target checks

- **Goal:** keep all new commands, types, and feature gates compiling on non-macOS
  targets while returning a stable unsupported result.
- **Acceptance:** `pnpm check:cross`/cross-target Rust compilation passes; invoking any
  AI browser command on non-macOS returns `UNSUPPORTED_PLATFORM` without tab residue.
- **Tests first:** Rust stub tests under cfg guards and cross-target compile check.
- **Touched areas:** `surface.rs` stubs, command modules, command registry, capabilities,
  platform conditionals.
- **Dependencies:** WI-N2.1, WI-N2.6.
- **Risks + mitigations:** macOS-only imports leaking into shared modules; keep pure
  validators/registry logic platform-neutral and native ownership behind cfg.
- **Rollback:** compile-time disable all AI browser routes off macOS.
- **Estimate:** M.

### Phase 5 — Documentation, E2E, performance, and release readiness

#### WI-N5.1: Document the public MCP and security model

- **Goal:** update user and AI-facing documentation with the five actions, schemas,
  tab targeting, sandbox/shared posture, approvals, SSRF policy, limitations, and
  feature-off behavior.
- **Acceptance:** docs contain no claim that sandbox eliminates network SSRF or DNS
  rebinding; examples show approval/error handling; old `browser.ai` wording is removed
  or explicitly marked superseded.
- **Tests first:** documentation link/build checks; no runtime test required for prose.
- **Touched areas:** `website/guide/browser.md`, `website/guide/mcp-tools.md`, shortcut
  or settings docs, sidecar README/generated descriptions.
- **Dependencies:** all behavior WIs complete.
- **Risks + mitigations:** docs drift from schema; derive examples from contract fixtures
  and update docs in the same WI as final schema changes.
- **Rollback:** revert docs with the feature disabled; do not leave stale action claims.
- **Estimate:** M.

#### WI-N5.2: Add Tauri MCP end-to-end coverage

- **Goal:** verify the real visible flows on macOS through Tauri MCP port 9323.
- **Acceptance:** manual/E2E evidence covers sandbox open/login reuse across two AI tabs,
  human-cookie isolation, shared destination approval, redirect blocking, wait success/
  failure/timeout, inactive-tab activation, feature-off teardown, two windows, and
  visible human co-driving approval.
- **Tests first:** Tauri MCP flow definitions under the repository's browser/Tauri test
  skill references; use a fixture site with deterministic redirects and cookies.
- **Touched areas:** E2E fixtures and test documentation; no Chrome DevTools MCP.
- **Dependencies:** WI-N0.5, WI-N2.5, WI-N3.4, WI-N4.2.
- **Risks + mitigations:** flaky external sites; use local fixture pages and only use
  public sites for optional smoke checks.
- **Rollback:** keep feature default-off if any security flow is flaky or ambiguous.
- **Estimate:** L.

#### WI-N5.3: Establish performance and resource limits

- **Goal:** measure native creation, event wait, sandbox store reuse, teardown, and
  bounded live-webview counts.
- **Acceptance:** open/navigate/wait stay within the documented timeout; no unbounded
  event buffer or waiter leak; disabling the feature releases AI native views; memory
  behavior is recorded for the configured live-tab cap.
- **Tests first:** browser lifecycle/resource tests and a repeatable macOS benchmark or
  diagnostic script.
- **Touched areas:** browser metrics, native lifecycle, event broker, docs.
- **Dependencies:** WI-N4.1, WI-N4.4, WI-N5.2.
- **Risks + mitigations:** machine-dependent timings; assert bounds and leak absence rather
  than one absolute latency number.
- **Rollback:** lower the live AI-tab cap or disable AI open/navigate while read/act remain.
- **Estimate:** M.

#### WI-N5.4: Final gates and staged rollout

- **Goal:** close all phase gates, run the full project gate, and prepare default-off
  release behavior.
- **Acceptance:** `check-ai-nav-phase.sh 0..5`, WI linkage, `pnpm check:all`, and
  `pnpm check:cross` pass; no bypassed hooks; release notes and kill-switch instructions
  exist; no phase status is advanced without evidence.
- **Tests first:** release checklist and gate-failure tests; final full suite is the
  implementation verification step.
- **Touched areas:** phase script, plan status, release/docs files, CI if required.
- **Dependencies:** every prior WI.
- **Risks + mitigations:** green unit tests hiding native failure; require Tauri MCP
  evidence and native probe artifacts in addition to code gates.
- **Rollback:** leave `browser.enabled=false`, force Rust AI policy disabled, and revert
  only the release-enablement commit.
- **Estimate:** M.

## Phase Definition of Done

`scripts/check-ai-nav-phase.sh` must fail closed and check both positive and negative
assertions.

### Phase 0

- All four native/contract spikes have PASS evidence.
- Plan lint and WI linkage pass.
- Cross-model security review is recorded.
- No Phase 1 implementation WIs are linked as complete.

### Phase 1

- Provenance fields and Rust registry authority exist and are tested.
- AI SSRF validator and committed-page guard exist and are tested.
- Dedicated AI command path exists; no AI path uses an untrusted isolation boolean.
- Main-thread sandbox store is wired; no store is placed in `BrowserSurface`.
- Human-tab attachment and old blanket R7a behavior cannot bypass Rust policy.

### Phase 2

- All five frontend routes and sidecar actions exist with exact route-lock tests.
- Navigation tickets and failure payload identities are wired.
- Event broker wait tests cover race, failure, timeout, stale, and unmount paths.
- Browser tabs appear in session state with redacted URLs and defined loading semantics.
- Feature-off tests cover all five actions and teardown.

### Phase 3

- Sandbox/shared settings sync to Rust with safe defaults and migration tests.
- Shared destination approval and navigation one-shots are authoritative in Rust.
- Human-tab attachment UI and expiry are visible and tested.
- Redirects cannot inherit approval across origins.

### Phase 4

- Concurrency, multi-window, teardown, restore, redaction, diagnostics, and non-macOS
  gates pass.
- No stale native callback can mutate a reused tab id.

### Phase 5

- Docs, fixture-based Tauri MCP flows, performance/resource evidence, full gates, and
  rollback instructions are complete.

## Testing Procedures

### Test-first sequence

For every WI:

1. Add the failing unit/integration/native test or fixture assertion.
2. Implement the smallest behavior that makes it pass.
3. Refactor only after the focused test and neighboring tests pass.

### Fast checks

- TypeScript/frontend focused test: `pnpm test -- <test-file>`.
- Sidecar focused test: `pnpm --dir vmark-mcp-server test -- <test-file>`.
- Rust focused test: `cargo test --manifest-path src-tauri/Cargo.toml <module>`.
- Plan/gate check: `bash scripts/check-ai-nav-phase.sh <phase>`.

### Full checks

- `pnpm check:all` before phase completion and before any main/tag push.
- `pnpm check:cross` after native Rust changes and before release readiness.
- `bash scripts/check-wi-linkage.sh dev-docs/plans/20260714-ai-browser-navigation.md --phase=N<phase>`
  at every phase boundary (`N0` through `N5`, matching the `WI-N*` namespace).
- Tauri MCP E2E through port 9323 for native lifecycle, security, visibility, and
  multi-window behavior. Do not use Chrome DevTools MCP.

### Required edge-case matrix

- Empty/whitespace/null/malformed URL, credentials, userinfo authority tricks, Unicode,
  IDN, CJK names, trailing dots, alternate IPv4, IPv4-mapped IPv6, IPv6 ranges.
- Direct private target, public-to-private redirect, redirect chain, failed provisional
  load, TLS/DNS failure, slow load, timeout, cancellation, reload, same-document URL.
- Duplicate open, same URL across modes, rapid repeated navigation, approval during
  navigation, timeout racing with loaded, destroy racing with callback, reused tab id.
- Inactive tab, missing tab, foreign-window tab, closed window, second window, feature
  toggle during load, app restart, malformed persisted tab state.
- Sandbox cookie isolation, shared cookie behavior, human attachment allow/deny/expiry,
  credentials redaction, page-controlled title/URL/log injection.

## Rollout Plan

### Default state

- `browser.enabled=false`.
- Rust AI policy disabled, sandbox, no loopback.
- No AI tabs or approvals persisted.
- Existing human browser behavior remains available only when the user enables the
  browser feature.

### Staging

1. Phase 0 probes and review only.
2. Ship sandbox open/navigate/wait behind the default-off gate.
3. Verify isolation and fixture-site E2E before exposing shared mode.
4. Add shared mode and human attachment UI only after destination approval and redirect
   tests are green.
5. Document the residual DNS-rebinding limitation and supported macOS versions.

### Kill switch

If any of these occur, disable AI navigation immediately in Rust and keep the setting
default-off:

- a human tab is reachable from sandbox AI without attachment;
- a redirect reaches a blocked committed origin and remains readable;
- a stale approval is consumed on a different tab/generation/ticket;
- feature-off leaves a native view, waiter, or authority behind;
- a native probe or Tauri MCP E2E contradicts the stated store isolation.

## Plan → Verify Handoff

Evidence required before marking each WI complete:

- **Phase 0:** four PASS/FAIL spike reports, fixture sources, plan-lint output, phase
  gate output, and cross-model review disposition.
- **Phase 1:** registry/policy test output, SSRF parity matrix, redirect/commit evidence,
  native store cookie probe, and a compile artifact proving main-thread ownership.
- **Phase 2:** exact MCP route/sidecar schema tests, event-broker race tests, session
  payload examples with redacted URLs, inactive-tab activation log, and feature-off test.
- **Phase 3:** settings migration output, approval UI recordings/screenshots, shared-mode
  destination/redirect tests, and Rust authority tests.
- **Phase 4:** concurrent-navigation test output, two-window teardown evidence, restore
  migration results, redaction fixtures, and cross-target compile output.
- **Phase 5:** Tauri MCP run log/screenshots, performance/resource measurements, website
  build output, final gate output, and rollback rehearsal notes.

Required fixtures:

- local deterministic HTTP(S) fixture site with cookies, local storage, ARIA controls,
  slow endpoints, public redirects, private-target redirects, same-document changes,
  and configurable failure responses;
- macOS native probe harness for two data stores and navigation policy;
- two-window Tauri fixture flow;
- malformed persisted-tab/settings fixtures;
- redaction fixtures containing credentials and sensitive query values.

## Manual Test Checklist

- [ ] With `browser.enabled=false`, all five MCP actions fail with `BROWSER_DISABLED` and
      no native browser view is created.
- [ ] Enable the browser and open a human tab; it uses the human store and remains
      human-owned.
- [ ] AI `open` creates a separate sandbox tab even when the same URL is already open in
      a human tab.
- [ ] A cookie set in a human tab is absent from the sandbox tab.
- [ ] Two sandbox AI tabs share an intentionally created AI-session cookie.
- [ ] Switching away and back to a sandbox tab does not convert it to the human store.
- [ ] AI `read`/`act` on a human tab raises visible attachment approval; deny blocks it;
      allow-once expires on navigation.
- [ ] Shared mode requires destination approval before the first network request.
- [ ] A public-to-private redirect is blocked and cannot be read by MCP.
- [ ] Loopback remains blocked until the explicit setting is enabled; LAN/link-local/
      metadata remain blocked afterward.
- [ ] `open`, `navigate`, and `wait` return correct success, failure, stale, superseded,
      and timeout results.
- [ ] Rapid consecutive navigations do not let an older event overwrite the newer tab.
- [ ] An inactive tab is activated in the owning window or returns a structured window
      error without navigating the wrong tab.
- [ ] `session.get_state` lists document and browser tabs with correct discriminators,
      loading state, mode, generation, and redacted URLs.
- [ ] Two windows do not receive each other's browser events or approval prompts.
- [ ] Closing a window or disabling the feature removes native views, tickets, waiters,
      attachments, and one-shots.
- [ ] Non-macOS builds compile and return `UNSUPPORTED_PLATFORM` without residue.
- [ ] `pnpm check:all`, `pnpm check:cross`, all phase gates, and WI linkage pass.
