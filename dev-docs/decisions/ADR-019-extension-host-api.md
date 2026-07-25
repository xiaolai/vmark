# ADR-019: Extension Host API — the runtime contract

> Status: **Proposed** | Date: 2026-07-25
> Extends: ADR-015 (extension model — *composition*). This ADR covers the
> *runtime*: what a feature is handed, and how features talk.
> Depends on: ADR-017 (command registry unification), ADR-007 (shell as
> composition root — its slot seam does not exist and is built here)
> Explicitly does **not** depend on: ADR-016 (capability broker). See Non-goals.

## Context

The goal is that markdown, terminal, MCP and every other feature are
**extensions to VMark**, not hardwired parts of it.

ADR-015 built *composition*: a resolver, ordering constraints, a claim
protocol. But `Contribution` admits only four kinds — `tiptap`, `codemirror`,
`markdown`, `pmAdapter` — all editor-node concerns. Nothing a *feature* is made
of can be contributed.

### What the code actually says (measured 2026-07-25)

The features are already modular. The host has nowhere to plug them in.

| Feature | Own size | Files outside it that import it |
|---|--:|--:|
| Terminal | 5,067 TS + 631 Rust | **3** (`App.tsx`, `StatusBarRight.tsx`, `viewCommands.ts`) |
| MCP | 4,400 Rust + bridge | **2** |

Three import sites for a 5,700-line feature is good modularity. Terminal is
hand-wired at those 3 mount points plus 6 registries (React i18n ×5, Rust i18n,
keybindings ×6, commands, menu ×2, settings ×5).

Existing channels, for reference:

| Channel | Count | Nature |
|---|--:|---|
| `invoke()` | 209 | webview → Rust, request/response |
| `listen()` | 70 | Rust → webview, events |
| Tauri commands | 148 | Rust handlers |
| Zustand stores | 59 | cross-feature state (the coupling `lint:store-coupling` freezes at 98 files) |
| `CommandBus` | 57 registrations | register / execute / search |

`AppShell` is genuinely feature-free — four `ReactNode` slots (`chrome`,
`sidebar`, `primary`, `overlays`), zero store imports. `App.tsx` (296 lines,
~37 top-level surfaces) hardcodes what fills them. `SlotDescriptor` **no longer
exists**; the only trace is a comment in `lib/extensions/types.ts` noting its
absence.

So the work is not untangling features. It is building seams.

## Decisions

### D1 — Four mechanisms, not one bus

A "message bus" is the wrong shape for three of the four things extensions need.

| Need | Mechanism | Shape |
|---|---|---|
| What an extension *has* | **Contributions** | declarative, resolved at composition |
| Make something happen | **Commands** | imperative, typed, request/response |
| Learn something happened | **Events** | pub/sub, fire-and-forget |
| Read current state | **Context state** | read-only selectors |

**Rule: commands for "do X", events for "X happened", context for "what is X
now."** If a message doesn't clearly belong to one, the design is wrong — do not
add it.

*Why not one generic bus:* it erases control flow. This codebase already has the
cautionary evidence — `useUnifiedMenuCommands.ts:350` dispatches through a
**variable** event id over an 88-entry map, an entire second router that
ADR-012's textual gate structurally could not see, which is how ADR-012 drifted
to near-false while reporting green. A generic `bus.send(string, any)` is that
failure mode as an architecture. Untyped buses cannot be statically checked,
cannot be enumerated, and therefore cannot be gated — which collides with
ADR-015 D6.

### D2 — `ExtensionContext` is the *only* way an extension reaches the host

An extension imports nothing from `@/stores`, `@/hooks`, or another extension.
It receives a context at activation.

```ts
export interface ExtensionContext {
  readonly id: ExtensionId;
  readonly commands: CommandsApi;   // register / execute
  readonly events: EventsApi;       // on / emit (typed map, D3)
  readonly state: StateApi;         // read-only shared state (D7)
  readonly ui: UiApi;               // slots, status items (D4)
  readonly settings: SettingsApi;   // declare + read own settings
  readonly backend: BackendApi;     // scoped invoke (D6)
  readonly t: TranslateFn;          // namespaced i18n
  readonly subscriptions: Disposable[];  // teardown (D5)
}
```

This is what makes the `lint:store-coupling` gate *satisfiable* rather than
merely punitive: today a plugin reaching state has no alternative to
`@/stores/*`. After D2 it has one, and the baseline of 98 can actually ratchet
toward zero.

### D3 — Events are a typed, host-owned keyed map — this is the "bus", and it stays narrow

```ts
export interface VMarkEvents {
  "workspace:rootChanged": { root: string | null };
  "tab:activated": { tabId: string };
  "tab:closed": { tabId: string };
  "document:saved": { tabId: string; path: string };
  "document:changed": { tabId: string };
  "mode:changed": { tabId: string; mode: "wysiwyg" | "source" };
}

ctx.events.on("workspace:rootChanged", ({ root }) => { /* payload inferred */ });
```

Constraints, each load-bearing:

- **Keyed map, not `string`.** The full event surface is enumerable, so it can be
  documented, diffed, and gated. This is the same "host-owned flat keyed
  registry with peer contributors" shape the Zed research confirmed
  (`20260723-zed-architecture-lessons.md`).
- **Extensions may not invent event keys.** A new key is a host change, reviewed
  like an API change. Third-party-style namespacing is a Non-goal here.
- **Events are notifications, never requests.** No return value, no await on
  handlers. If a caller needs an answer, it is a command.
- **Handlers must not emit synchronously.** Re-entrant emission is the classic
  bus deadlock/cycle; the host asserts against it in dev builds.

Start with the smallest set that terminal and MCP actually need. Every key added
without a consumer is the foundation-shaped dead code ADR-015 D6 forbids.

### D4 — Surfaces register into host-owned named slots; extensions cannot invent slots

`AppShell` keeps its four `ReactNode` props. A `SlotRegistry` sits **above** it
and collects contributions, so `App.tsx` stops hardcoding and instead renders
what is registered.

Slot keys are a closed, host-owned set:

| Family | Keys |
|---|---|
| Shell | `chrome`, `sidebar`, `overlays` |
| Editor area | `panel.bottom`, `panel.right`, `panel.left` |
| Status bar | `statusbar.left`, `statusbar.right` |
| Toolbar | `toolbar.primary` |

Terminal registers into `panel.bottom` / `panel.right` (matching today's
`effectiveTerminalPosition`), plus one `statusbar.right` item — replacing its
hardcoding in `App.tsx` and `StatusBarRight.tsx`.

Slot contributions are **lazy by default** (`() => Promise<Component>`),
preserving today's `lazy(() => import("@/components/Terminal"))` behaviour. A
feature that is never opened is never loaded.

### D5 — Lifecycle: `activate(ctx)`, dispose to deactivate

```ts
interface ExtensionRuntime {
  activate(ctx: ExtensionContext): void | Promise<void>;
  // deactivation = dispose everything in ctx.subscriptions, LIFO
}
```

Every `register*` call returns a `Disposable`. Teardown is designed in, not
retrofitted — WI-5.6 already established this for `registerFenceRenderer`
precisely because retrofitting teardown after an ecosystem exists makes every
existing extension leak.

**Activation is lazy where a trigger exists** (command invoked, slot first
rendered, file type opened). Eager activation is opt-in and must be justified,
because eager-everything reproduces today's `tiptapExtensions.ts` — a 59-import
central file that costs full price at boot.

### D6 — An extension is a TS unit *plus optionally a Rust unit*, and only the TS half composes

This asymmetry is stated rather than hidden. Terminal is 5,067 TS **and** 631
Rust; MCP is mostly Rust. There is no Rust-side extension registry, and building
one is not required for first-party extensions.

For now: Rust handlers stay registered in `lib.rs`; the TS extension **declares**
which backend commands it uses, and `ctx.backend.invoke` is scoped to that
declaration. That declaration is documentation and a lint target today; it
becomes an enforcement point only if third-party ever arrives (ADR-016).

Honest consequence: **a first-party extension is not relocatable to a separate
package while it has a Rust half.** Do not claim otherwise in the plan.

### D7 — Feature state moves *into* the extension; `ctx.state` exposes only genuinely shared state

Of 59 stores, most are one feature's private state. `uiStore/terminalSlice.ts`
belongs to the terminal extension, not to the app.

`ctx.state` exposes only what is truly cross-cutting — active tab, workspace
root, settings, theme — as **read-only selectors**. Mutation happens through
commands, so writes remain traceable.

This is the decision that makes 59 stores tractable, and it is the one most
likely to be got wrong by moving state to `ctx.state` wholesale, which would
rebuild `@/stores` behind a new name.

### D8 — Every seam ships with its first consumer and a gate

Four foundations died unadopted (`useWorkspace()`, `pluginsFor()`, `EditorHost`,
ADR-007's slots). The `createExportExtensions.ts` blind spot in
`adoption.test.ts` shows even the anti-drift gate can be born narrow.

So: **no seam is built before the migration that consumes it.** Each ships with

1. its first real consumer (terminal, not a demo), and
2. a gate that fails when the seam is bypassed — dep-cruiser rule or adoption
   count, never a grep.

New gates this ADR implies: extensions must not import `@/stores` (exists,
`lint:store-coupling`, baseline 98); the app must not import extension
internals; every registered slot key must have a host; every contribution kind
must have ≥1 consumer.

## Non-goals

- **Third-party extensions.** Everything here is first-party. No isolation
  boundary, no caller principal, no capability broker — ADR-016's chain is not
  on this path, which is what makes the goal reachable now.
- **A marketplace, signing, or SDK versioning.**
- **A Rust-side extension registry** (D6).
- **Namespaced third-party event keys or slot keys** (D3, D4).

## Migration order (dependency-driven)

1. **Commands** (ADR-017). Unblocks keybindings, menu, and palette at once.
2. **Slot host** (D4, from zero). Unblocks panels, status items, overlays.
3. **Settings + i18n contributions.** Largely mechanical.
4. **Terminal as first migration.** The proof: 5,700 lines, only 3 import sites.
   If terminal cannot register cleanly, the seams are wrong.
5. **MCP, then markdown.** Markdown is furthest along — `lib/formats/registry.ts`
   already carries lint, outline, language.

## Open questions

1. **Does `ctx.state` need reactivity, or are selectors + events enough?** React
   components need to re-render on change. Either `ctx.state` returns hooks
   (couples extensions to React) or events drive local state (more boilerplate).
   **Unresolved — decide before D2 ships.**
2. **What is the settings-contribution shape?** Per-extension schema with
   host-rendered UI, or a contributed component? Host-rendered gives consistency
   and validation; contributed gives flexibility.
3. **Do menu items contribute from TS, given the menu is built in Rust?** Likely
   a TS-declared manifest serialized to Rust at boot; unverified.
4. **Multi-window.** Each document window has its own context today
   (`WindowContext`). Is an extension activated per-window or per-app, and where
   does per-window state live?
5. **Native surfaces break D4, and the browser proves it.** D4 assumes surfaces
   are `ReactNode`s composited by the DOM. The embedded browser's native
   `WKWebView` is layered **above** the Tauri webview and paints over all React
   DOM in its rect — *z-index cannot reach it* (`hooks/useBrowserOccluder.ts`).
   So it is not a slot contribution, and its coupling is **inverted**: every
   other overlay must know the browser exists, declare a policy in
   `services/browser/overlayPolicies.ts`, and call the occluder — enforced by a
   build-failing test. That is why browser has **15** external importers against
   terminal's 3.
   The host therefore needs a surface *kind* (`dom` vs `native`) with
   host-mediated occlusion, generalising `overlayPolicies` inward — or the
   browser stays core. **Unresolved.** Either way the browser is the LAST
   migration, not the first: it is 78% Rust (9,100 of 11,703 lines), so D6's
   non-composing half dominates it.

## Verification

This ADR is unusually load-bearing and no part of it has run yet. Before Phase 1
commits it should go through `/cc-suite:review-plan` (Codex, per
`.claude/rules/60-ai-governance.md` §6) — a different model catches API
assumptions a single-model design will not.
