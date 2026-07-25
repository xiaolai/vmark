# Zed Architecture — Lessons for VMark's Extension & Command Redesigns

**Date:** 2026-07-23
**Scope:** Zed editor (`zed-industries/zed`, v1.14.0, shallow clone at `~/github/zed`,
outside this repo) read as primary-source prior art for VMark's two live redesigns:
the extension model (ADR-015) + capability broker (ADR-016), and the command-surface
unification (ADR-017).
**Method:** structural survey (tokei / cargo workspace / docs) plus two independent,
file-anchored code dives — one on the extension cluster (`crates/extension*`), one on
the action / command-palette / keymap system (`crates/gpui`, `command_palette`,
`zed_actions`). Every claim below traces to a `file:line` in the Zed tree.
**Related:** `deep-researches/20260721-extension-architecture-investigation.md`,
`deep-researches/20260722-extension-architecture-prior-art.md`,
`decisions/ADR-015-extension-model.md`, `decisions/ADR-016-capability-broker-requires-isolation.md`,
`decisions/ADR-017-command-bus-absorbs-the-action-registry.md`.

## Verdict

**Zed independently converged on the same *invariants* VMark's two redesigns propose** —
though not the same *machinery*. For commands: one action identity and one dispatch path
shared by keymap + palette + menu, availability decided against a live context — the
invariant behind ADR-017. For extensions: host-owned flat keyed registries with peer
contributors, and an isolation-boundary → per-principal capability broker — the invariant
behind ADR-015/016. Both shipping. This *supports* those invariants; it is not proof
VMark's specific mechanism (a static bus + derived context; a TS/worker isolate) is right,
because Zed's mechanism (a per-frame native focus/dispatch tree; a WASM-component sandbox)
is not VMark's. Treat it as a strong prior, calibrated by the "does NOT transfer" section
below.

> **Post-review calibration (Codex, 2026-07-23).** The three corrections this doc feeds
> into the ADRs were then cross-model-reviewed and **narrowed** before landing: the
> command-palette *filter seam* was **cut** (Zed's standalone-crate rationale is a
> cross-crate-cycle problem a single React app doesn't have, and the examples were already
> availability-descriptor axes); the extension *collision policy* became **per-extension-
> point** rather than a global "builtin wins" (Zed's evidence is LSP-specific); and the
> `when(ctx)` refinement is a **closed structured record**, not a predicate DSL (Zed's
> serialized-keymap rationale doesn't apply to first-party compiled TS). The calibrated
> decisions live in the ADR amendments; this doc records the raw analysis.

**But Zed also corrects three VMark assumptions** (detailed below): (1) "extensions
are values, not manifests" is over-committed — Zed is **manifest-first**, code only for
dynamic hooks; (2) the capability model must be **two-sided** (author declares needs +
operator grants), not broker-only; (3) the contract must be a **frozen, versioned wire
artifact**, not just a shared TypeScript type.

**Honest boundary:** Zed is native Rust/GPUI; VMark is Tauri + React + Tiptap. The
*architecture* transfers; the *machinery* (WASM component sandbox, `inventory`
link-time registration, `TypeId` identity, per-frame native dispatch tree, chord
engine) does not. Sections below separate the two deliberately.

## What Zed is, measured

- v1.14.0; ~1.3M lines of Rust across **239 crates** in one Cargo workspace, members
  listed explicitly as path deps, one shared `[workspace.dependencies]` version table
  (`Cargo.toml`). Biggest crate `editor` (140k LOC); framework `gpui` (56k).
- Extensions are a first-class subsystem: a crate cluster (`extension`, `extension_api`,
  `extension_host`, `language_extension`, `theme_extension`, `debug_adapter_extension`,
  `extensions_ui`, `extension_cli`) plus a user-facing docs tree
  (`docs/src/extensions/`), and most first-party extensions have been **physically
  extracted** out of the monorepo into their own repos (`extensions/EXTRACTION.md`).

---

## A. Extension model → ADR-015 / ADR-016

### How it works (one paragraph)

An extension is a directory: a declarative `extension.toml` manifest plus, *optionally*,
a compiled `extension.wasm` (WASM **Component Model**, not a plain module). The manifest
declares contributions (languages, grammars, themes, LSP adapters, context servers, slash
commands, debug adapters, model providers) and the host **capabilities** it needs. At load
the host reads the manifest, registers each contribution into flat host-owned keyed
registries via per-kind `*Proxy` traits, and — only if the extension ships code —
instantiates the WASM component in a `wasmtime` sandbox whose WASI context preopens *only*
the extension's own work dir. The guest compiles against a separate crate
(`zed_extension_api`) whose contract is frozen as versioned `.wit` files; privileged host
imports (spawn process, download, npm-install) are gated by a per-extension
`CapabilityGranter`.

### Confirmed (Zed matches VMark's decisions)

1. **Isolation → caller-principal → broker order** is exactly Zed's. The
   `CapabilityGranter` is built *per extension*, embedded in that extension's sandbox
   `WasmState` (`wasm_host.rs:667-670`), and every privileged host call reads the
   principal as `self` (e.g. `process::run_command` → `self.capability_granter.grant_exec`,
   `wit/since_v0_8_0.rs:895-896`). ADR-016's ordering matches a shipping design.
2. **Host-owned, flat, keyed registry with peer contributors — no hierarchy.** One
   `ExtensionHostProxy` of per-kind slots (`extension_host_proxy.rs:26-35`); contributions
   land in flat name-keyed maps (`theme/registry.rs:160-163`,
   `language_registry.rs:49-52`). This is precisely ADR-015's model — and matches the
   prior-art finding (`20260722-extension-architecture-prior-art.md`) that *every* mature
   system flattens and none nests.
3. **Third-party code behind an isolation boundary + capability broker** — confirmed and
   strongly enforced (wasmtime + WASI preopen + `CapabilityGranter`).

### Corrected (Zed contradicts / improves VMark's plan)

4. **"Extensions are values, not manifests" is over-committed. Zed is manifest-first.**
   All *static* contributions (themes, languages, grammars, snippets, LSP wiring) are pure
   declarative TOML needing **zero code** (`extension_manifest.rs:83-123`; host reads the
   manifest and registers directly, `extension_host.rs:1305-1575`). Code (WASM) is reserved
   for genuinely *dynamic* hooks (LSP command resolution, slash commands, DAP binaries). The
   payoff: the host can list, validate, cache, and garbage-collect the large static subset
   **without executing extension code**. VMark should split its contribution surface into a
   declarative data tier (validatable offline) and an imperative tier (behind isolation),
   not force everything through "values."
5. **The capability model is two-sided; ADR-016 describes only the broker.** Zed requires
   the extension to *declare* needed capabilities in its own manifest
   (`capabilities.rs:11-20`; `allow_exec` checks the extension's own declaration,
   `extension_manifest.rs:164-183`) **and** the host operator to *grant* an allow-list
   (`extension_settings.rs:17`); a call succeeds only if both agree
   (`capability_granter.rs:28-46`). The declared-needs side gives an **auditable** manifest
   ("this extension asks to exec `node` and reach `github.com`") and a user-tightenable
   policy. ADR-016 should add the author-declaration half.
6. **The contract must be frozen as a versioned wire artifact, not a shared type.** Zed
   keeps every historical WIT interface as an immutable directory
   (`extension_api/wit/since_v0.0.1 … since_v0.8.0`), links all versions at once
   (`wasm_host/wit.rs` version-dispatch ladder), and stamps the API version into the wasm
   binary itself (`extension_api.rs:350-353`, read back at `wasm_host.rs:807-844`). A single
   `nodeSafe.ts` interface is a *compile-time* boundary only — it cannot keep an old
   third-party extension working across a host upgrade the way a copied-and-frozen contract
   + embedded version stamp does. If VMark wants a durable third-party ecosystem, it needs
   an explicit versioned contract artifact and a per-extension version tag.

### Three extra defenses VMark's plan doesn't name

- **Filesystem sandbox by preopen, not policy:** the guest physically cannot see paths
  outside its work dir (`wasm_host.rs:729-751`), with symlink/`..` escape rejection on
  writes (`wasm_host.rs:753-804`, tested `:1017-1109`). A broker alone does not stop path
  traversal.
- **CPU/liveness containment:** epoch interruption forces the guest to yield ~every 100ms
  (`wasm_host.rs:578-585, 674-675`) — a buggy/hostile extension can't hang the host. A JS
  isolate needs the equivalent (worker termination / execution deadline).
- **Builtin-wins collision rule:** an extension LSP adapter is *refused* if a builtin owns
  that name (`language_registry.rs:302-311`). VMark must decide whether third-party
  contributors may shadow host-owned keys; Zed's answer for the sensitive case is "no."

### What does NOT transfer

- WASM Component Model + `wasmtime` + WASI is a Rust-native isolation stack. VMark's
  equivalent isolation boundary (if it pursues untrusted third-party code) would be a
  Web Worker / separate context with **no ambient `fetch` or filesystem** — every
  capability brokered through host messages. Note also that Zed's *shipped default* grant
  list is wide-open wildcards (`assets/settings/default.json:2149-2153`); its real security
  comes from the sandbox defenses + the audit trail, not the default policy. VMark could
  choose **deny-by-default** and be stricter than Zed ships.

---

## B. Action / command-palette / keymap → ADR-017

### How it works (one paragraph)

An action is a Rust **type** (unit struct, or a struct carrying data) made by
`actions!`/`#[derive(Action)]`, auto-registered before `main` into **one** global
`ActionRegistry` keyed by string name `namespace::TypeName` (`action.rs:233-333`, via the
`inventory` crate). The registry knows how to *build* an action from name+JSON — it holds
**no handlers**. Handlers live on the **dispatch tree**: a per-frame tree of focusable
nodes, each carrying a `KeyContext` and listeners the rendering view registered
(`key_dispatch.rs:71-91, 333-344`). Availability is resolved by walking the focus path and
collecting action types with a listener on it (`available_actions`,
`key_dispatch.rs:363-380`). A keymap binds a keystroke to an action *name* + a **context
predicate** over the context stack (`keymap/context.rs:171-324`). Keybinding, palette, and
menu all call the **same** `Window::dispatch_action_on_node` (`window.rs:5321`).

### Confirmed (Zed matches VMark's decisions — strongly)

1. **Single dispatch path is real and load-bearing.** Keybinding, palette, and native menu
   all funnel through one function; the palette's `confirm` re-focuses the prior element and
   calls the *same* `dispatch_action` a keystroke uses (`command_palette.rs:620-622` →
   `window.rs:2158-2170` → `window.rs:5321`). This validates ADR-017's guiding constraint —
   palette and menu must run an action *identically* through one executor. There is **no
   separate palette executor** in Zed. Adopt without reservation.
2. **The palette enumerates from the same source of truth dispatch uses.** It asks the
   dispatch tree what's available *now* (`window.available_actions` → `key_dispatch.rs:363`)
   — it does not maintain a second "CommandBus" list. This is the exact cure for VMark's
   "two disjoint surfaces / palette can't find bold" bug: enumeration surface == execution
   surface.
3. **`when(ctx)` is confirmed.** Zed's `KeyBindingContextPredicate` over a live `KeyContext`
   (`context.rs`) is a direct analog; `Editor::key_context_internal`
   (`editor.rs:2641-2764`) is nearly a spec for what VMark's `ctx` should carry — mode,
   menu-open, selection boundaries, node/file type, editability.

### Refinements worth stealing

- **Context as a stack of named scopes with a small predicate language**
  (`Editor && mode == full && !menu`, operators `&& || ! > !=`, `context.rs:171-324`). This
  is more expressive, more *testable*, and *data-loadable* than an imperative
  `when(ctx) => bool` closure per action. VMark could express availability declaratively.
- **Two-layer visibility.** Beyond implicit focus-path availability, a global
  `CommandPaletteFilter` (`command_palette_hooks/…:19-93`) lets other subsystems hide/show
  actions by namespace/type — driven by context (vim mode: `vim/src/state.rs:787`; agent UI:
  `agent_ui.rs:827`). Notably it lives in a **standalone crate** so the palette never
  depends on feature crates — features push filters *up* into the shared filter. For VMark
  ("hide table actions unless inside a table") a filter layer keyed by mode is cleaner than
  cramming everything into per-action `when`.
- **Typed parameterized actions.** `SelectNext { replace_newest: bool }`
  (`editor/src/actions.rs:9-15`) builds from JSON. This is exactly how `setHeading(level)`
  should work: **one** action type parameterized by data, buildable from a serialized
  menu/keymap entry — *not* N separate actions. (Contrast ADR-017/plan WI-3.1, which expands
  `setHeading` to six discrete commands. Zed's model suggests keeping one parameterized
  identity and expanding only at the *palette-presentation* layer.)
- **Shadowing + explicit unbind + effective-binding display.** Deeper context wins; at equal
  depth later-loaded wins; `NoAction` unbinds; `bindings_for_action` returns only the
  *effective* (non-shadowed) shortcut for display (`key_dispatch.rs:401-446, 667-785`). If
  VMark shows shortcuts in the palette, compute the effective binding the same way.

### What does NOT transfer (VMark is React/DOM, not native Rust)

- **Link-time registration via `inventory`** (`action.rs:282-291`) has no JS equivalent —
  VMark registers explicitly at module load and must check name collisions **at runtime**,
  not via the linker. (This is already the CommandBus's world; ADR-017 WI-3.3's owner-token
  registration is the right shape.)
- **`TypeId` + `Box<dyn Action>` dual identity** (`window.rs:5367`) is a Rust artifact. In
  JS the action's identity is just its **string id** (`editor::toggleBold`) — VMark already
  has this; use one canonical string id across all surfaces.
- **Per-frame native dispatch tree + capture/bubble routing** (`key_dispatch.rs:71-91`,
  `window.rs:5359-5399`) matters because many nested native views compete for a key. VMark
  realistically has one editor handler surface, so multi-level bubbling is unnecessary — a
  **flat registry + a `when(ctx)` guard derived on demand from Tiptap state** (selection,
  active marks, node at cursor, `editor.isEditable`) suffices. Zed's split of "handler
  present?" vs "predicate matches?" collapses acceptably to one `when(ctx)` for VMark.
- **Chord matching, pending-input timeouts, keyboard-layout mapping, cross-crate
  `zed_actions`** — subsystems VMark doesn't need at that fidelity (browser + a light hotkey
  lib covers it; a single React app has no dependency-cycle to break).

---

## C. Cross-cutting: the 239-crate decomposition

Zed's discipline for a very large codebase is worth noting even though VMark won't
Cargo-split a React app:

- **Explicit path members + one shared version table** (`[workspace.dependencies]`) keeps
  239 crates on aligned dependency versions — the moral equivalent of VMark's dependency
  hygiene gate (`scripts/check-new-deps.sh`), enforced structurally.
- **Contract/impl/SDK are separate crates, not just separate files.** Extensions split into
  `extension` (shared value types), `extension_api` (frozen guest SDK), `extension_host`
  (runtime) — three layers where VMark's `nodeSafe.ts` draws one. The lesson isn't "make
  more files"; it's that a *durable* boundary is enforced by a separate compilation unit +
  a versioned wire format, not by convention.
- **"Hooks" crates break dependency cycles** (`command_palette_hooks`): when a shared
  surface must be extended by features it can't depend on, extract the extension seam into
  its own unit that both sides depend on. VMark's analog: keep the CommandBus + its
  filter/registration seam free of feature imports; features register *into* it.

## D. Git-history lessons (39,205 commits, 2021-02 → 2026-07)

The shallow clone was unshallowed and the full history mined for scars — reverts, deleted
crates, rewrites. Every claim below is a real commit (`hash`, subject, date).

### What to BORROW

1. **Version the extension contract from day one — the taxonomy is *never* complete.** The
   `.wit` contract went 122 → 633 lines across **10 frozen versions**; v0.0.1
   (`since_v0.0.1/extension.wit`) was **language-server-only** (npm, GitHub release,
   download-file, `language-server-command`). Themes, slash commands, DAP, context servers,
   and model providers each forced a later version. Starting minimal was right; assuming the
   first contribution set was final was not. (Reinforces ADR-015 Correction 2.)
2. **Parallel-rewrite-then-atomic-swap is their standard play for foundation changes (the
   `X2` pattern).** `gpui2` was built alongside `gpui` from 2023-08-30 (`Checkpoint`); on
   **2024-01-03, ~22 crates were renamed `X2`→`X` in a single 2.5-hour sweep**
   (`editor`, `project`, `workspace`, `client`, `command_palette`, `assistant`… all between
   10:38 and 13:12). `main` stayed shippable the whole time — the old crate worked until the
   new one fully replaced it. And it is **institutionalized, not a one-off**: the AI
   subsystem was rebuilt the same way years later (`assistant2` → `agent`, `#27887`
   2025-04-02; old `assistant` crate removed `#30168` 2025-05-07).
3. **Dedicated migration infrastructure for anything user-facing.** Zed keeps a `migrator`
   crate; settings changes ship with migrations; even *removing* a feature shipped a
   migration (`Migration to remove dev servers #19639`). They **migrate users, not break
   them** — a discipline VMark should copy for document/config format changes.
4. **Two independent version axes**, confirmed in code: manifest `schema_version`
   (`extension_manifest.rs:88`) *and* the WIT api-version stamped into each binary. (Backs
   the package-vs-contract-version split in ADR-015 Correction 2.)
5. **Revert density ~1.1%** (439 / 39,205) — modest and healthy; they back changes out
   readily but not chaotically. A reasonable target, not a red flag.

### What to AVOID (the expensive scars)

1. **Do NOT hand-roll a bespoke plugin ABI / binding layer.** This is the strongest signal
   in the whole history. Zed's **first** plugin runtime (`plugin_runtime`, born 2022-07,
   `f6a9558c5c`) was a **~1,800-line bespoke investment** — a custom `plugin_macros`
   binding generator, a hand-rolled ABI (`plugin.rs`, 584 lines), an `OPAQUE.md` design doc,
   a 320-line README, all on hand-driven `wasmtime 2.0`. It was **deleted wholesale**
   2024-02-24 (`Remove unused plugin crates #8350`) with the epitaph: *"We're currently
   exploring Wasm-based extensions, and it's unlikely that we'll be reusing any of this
   existing work."* ~1.5 years of custom ABI work discarded once the **WASM Component Model
   + WIT standard** (`wit-bindgen`) matured. → Lean on standards for the boundary: MCP for
   the sidecar tier, JSON Schema for declarative contributions, Web Workers /
   structured-clone for a worker isolate — do **not** invent a binding/ABI/serialization
   layer. This directly **validates ADR-016's sidecar-first (MCP) recommendation** and the
   decision **not** to build bespoke Tier-B/D machinery now.
2. **Do NOT retrofit capabilities onto a live extension surface.** v0.0.1 shipped
   `npm-install-package` and `download-file` as **ungated imports**; the `CapabilityGranter`
   came later, so every early extension predates the policy. Retrofitting a security
   boundary is far harder than designing it in — which is exactly why ADR-016 makes
   isolation → principal → broker a *precondition*, not a follow-up.
3. **Do NOT over-scope a feature a simpler architecture will obsolete.** `dev_server_projects`
   (hosted remote-dev intermediary) was built 2024-05 and **killed 2024-10** (`#19638`),
   replaced by direct SSH remoting — 5 months, then removed with a migration. Betting on a
   heavier intermediary when a lighter primitive suffices is a recurring, costly mistake.

### The honest read for VMark's *current* refactor

Zed's foundation-change discipline is **build-alongside-then-swap on a shippable `main`**
(the `X2` pattern). VMark's active extension re-architecture is the *opposite bet*: `main`
was reset to v0.9.7 and all work lives on a long-divergent `refactor/vmark-core` branch.
That is defensible **because the work is surgical** — in-place switch deletion + registry
adoption, not a framework swap — and a big branch is manageable at that scope. But if any
VMark change ever becomes genuinely foundational (swapping the whole markdown pipeline, or
the editor framework), Zed's evidence argues for the `X2` parallel-and-swap approach over a
long divergent branch, precisely to keep `main` releasable throughout. Name the tension
rather than assume the current branch model scales to a foundation swap — it is the one
place VMark's process currently diverges from what Zed learned the hard way.

## Concrete recommendations for VMark

1. **ADR-017 (adopt as-is, with two refinements):** keep the single-executor + palette-as-
   single-surface decision — Zed confirms it. Refine: (a) express availability as a small
   declarative predicate over a typed `ctx` rather than ad-hoc closures where practical;
   (b) reconsider expanding `setHeading` into six commands — Zed keeps one parameterized
   action and expands only for presentation.
2. **ADR-016 (amend):** add the **author-declared capability manifest** half so the policy
   is two-sided and auditable; consider **deny-by-default** (stricter than Zed ships).
3. **ADR-015 (amend):** soften "extensions are values, not manifests" to a **two-tier**
   model — declarative data for static contributions (host-validatable without execution),
   imperative code only for dynamic hooks behind isolation. Add a **versioned, frozen
   contract artifact** + per-extension version tag if a third-party ecosystem is the goal.
   Decide the **builtin-vs-third-party override** policy for host-owned keys.
4. **If/when VMark runs untrusted third-party code:** the broker is necessary but not
   sufficient — pair it with a sandbox that denies ambient filesystem/network and a
   liveness/timeout kill, mirroring Zed's preopen + epoch defenses.

## Caveats / honesty

- Zed's shipped **default** capability policy is wide-open wildcards
  (`default.json:2149-2153`); its security value is the sandbox + audit trail, not the
  default grant. Don't cite Zed as evidence for "brokers restrict by default."
- All lessons are **architecture-level**. No Zed code is portable to VMark's stack; the
  WASM/wasmtime/`inventory`/`TypeId`/native-dispatch-tree machinery is explicitly out of
  scope. Where a lesson depends on that machinery (durable contract freezing, link-time
  registration), the transfer is "achieve the same *property* by other means," not "copy
  the mechanism."
- Evidence base is a **shallow single-commit clone** (v1.14.0); historical rationale
  (why-they-changed) was not traced. Claims are about the code as it stands, file-anchored.

## Key sources (Zed tree, `~/github/zed`)

Extension: `crates/extension/src/extension_manifest.rs:83-123` (manifest schema),
`crates/extension/src/capabilities.rs:11-20` + `crates/extension_host/src/capability_granter.rs:7-84`
(two-sided broker), `crates/extension_host/src/wasm_host/wasm_host.rs:546-751`
(wasmtime + WASI preopen), `crates/extension_api/wit/since_v0.8.0/extension.wit`
(frozen contract), `crates/extension/src/extension_host_proxy.rs:26-35` (flat keyed
registries), `crates/language/src/language_registry.rs:302-311` (builtin-wins),
`extensions/EXTRACTION.md` (extraction procedure).

Commands: `crates/gpui/src/action.rs:233-369` (single registry, name+JSON build),
`crates/gpui_macros/src/derive_action.rs:106-128` (namespacing + parameterized build),
`crates/gpui/src/keymap/context.rs:171-324` (context predicate language),
`crates/editor/src/editor.rs:2641-2764` (live `ctx` construction),
`crates/gpui/src/window.rs:5321-5399` (the one dispatch path),
`crates/command_palette/src/command_palette.rs:114-127, 575-623` (context-scoped
enumeration + same-path execution),
`crates/command_palette_hooks/src/command_palette_hooks.rs:19-93` (filter-as-crate),
`crates/gpui/src/key_dispatch.rs:363-446, 667-785` (availability, shadowing, unbind).
