# Extension Architecture Investigation — "Minimal Core, Everything an Extension"

> Date: 2026-07-21 | Type: codebase investigation note (not a decision) |
> Scope: feasibility of re-architecting VMark toward a minimal core with a
> **third-party extension ecosystem** as the stated goal.
> Method: six parallel read-only code audits (dependency-cruiser import graph,
> per-feature coupling, god-file composition tax, ADR-011/012 adoption reality,
> MCP-bridge-as-plugin-protocol, capability/security surface). All findings are
> grep/read-verified with file:line anchors.

## The question

Can VMark keep a minimal necessary kernel and make everything else an
extension, specifically to support **third-party** plugins? What is the honest
current state, what is the real blocker, and what is the lowest-risk path?

## Headline verdict — readiness is *inverted*

The intuitive plan ("finish the internal seams ADR-011/ADR-012, then expose a
subset as a public SDK") does not survive contact with the code. **The parts
assumed easy are hollow; the part assumed hardest is already built to audited
quality.**

- The plugin-manifest registry (ADR-011) and the command bus (ADR-012) — the
  two seams a public SDK would sit on — are effectively **not built**
  (~stub / ~15-20 %).
- The **security capability broker** — normally the hardest, most dangerous
  part of any plugin system — **already ships**, production-grade and
  security-reviewed, inside the browser subsystem.
- The **sidecar process runtime** (MCP bridge) is **~80 %** of a plugin
  runtime — process isolation, auth, routing, concurrency — but has **zero
  extension point**.

Therefore the recommended thesis flips: **do not route the ecosystem through
the editor-plugin monolith. Route it through the MCP sidecar (isolation) and
the browser-style capability broker (security).** That sidesteps the hollow
registry, 170 cross-plugin violations, and the serialization wall below.

Corollary calibration on the framing itself: "everything is an extension" via
the editor path is a trap (evidence below). The achievable version is
**"everything that can be a sidecar or a declarative contribution is an
extension; the editor core stays first-party"** and earns a serialization
registry only if third-party editor *nodes* become a real product goal.

## ADR aspiration vs. measured reality

| Seam a third-party SDK needs | ADR claims | Measured reality |
|---|---|---|
| Plugin manifest registry (ADR-011) | "manifest exports complete" | **Hollow.** 77/79 plugins export a manifest, but they are 3-field stubs — only **2** carry a `tiptap()`/`codemirror()` factory, **0** declare `slots`/`commands`/`dependsOn`. `registry.pluginsFor()` is **dead metadata** (used only in tests); composition is 100 % hand-wired. The cross-plugin-import ban has **170 violations**. `/debug/plugins` route never built. |
| Command bus (ADR-012) | "all 6 hooks routed" | **~15-20 % done.** ~**21+** independent intent routers vs. target of 1. VMark's actual editing surface (**87** actions: bold/tables/headings/undo) is entirely *outside* the bus — the Command Palette cannot find "bold". MCP's 30 handlers are a wholly separate path. CommandBus API itself is sound; gap is call-site migration + no `plugin:` id-namespace scheme. |
| Shell slots (ADR-007) | Accepted | **Genuinely landed** — `AppShell` is pure layout, zero feature knowledge. The one clean seam. |
| Capability/permission broker | (no ADR) | **Production-grade, already shipping** — browser subsystem (`origin_guard.rs` + `one_shot.rs` + `operation.rs`): default-deny, closed capability vocabulary with 3 tiers, standing grants + SHA-256-payload-bound one-shots, Rust-authoritative with advisory UI. |
| Sidecar runtime | ADR-002 (AI only) | **~80 % of a plugin runtime.** MCP bridge = process isolation, token auth, port discovery, reconnect, concurrency control, typed request/response. **No extension point:** 7 tools compiled in, 3 closed routing switches, `ClientIdentity` captured but not used as a security principal. |

Fact corrections logged during the audit (earlier figures were stale): **157**
custom Tauri commands (not 163); the real Tiptap composition root is
`src/services/assembly/tiptapExtensions.ts` (78 extensions), **not**
`editorPlugins.tiptap.ts` (that file is only the 30-entry keymap).

## The serialization wall (deepest finding)

Schema nodes **do not carry their own markdown serialization.** It lives in a
centralized, name-keyed `switch` in the markdown pipeline
(`src/utils/markdownPipeline/proseMirrorToMdast.ts:135`, mirrored in
`mdastToProseMirror.ts` + a micromark tokenizer in `parser/`). A third-party
node named `acme_callout` is not merely unsandboxed — it **round-trips to
empty/garbage markdown** because the central serializer has never heard of its
name. Safely exposing schema extensions requires **first inverting** this into
a per-node `{ toMdast, fromMdast, tokenizer }` registry — a first-party
refactor, not an API addition. Third-party editor *nodes* are the last thing to
ship, if ever.

## Security surface a plugin would inherit *today*

The Tauri ACL (`src-tauri/capabilities/default.json`) is the **wrong layer**
for a plugin broker: it is per-**window**, not per-**caller**, and the 157
custom commands are **not ACL-gated at all**. In-webview plugin JS inherits the
`doc-*` window's entire command surface with zero mediation.

| Hole | Command (file:line) | Gate today | Blast radius |
|---|---|---|---|
| **RCE** | `pty::pty_spawn` (`pty.rs:62-81`) | **none** — arbitrary exe + args + env + cwd | full RCE |
| **RCE** | `ai_provider::run_ai_prompt` cli_path (`ai_provider/cli.rs:99-113`) | **none** on `cli_path` | `cli_path="/bin/sh"` → RCE |
| **Persistence** | `file_write::atomic_write_file` (`file_write.rs:26-94`) | only rejects `..` | overwrite `~/.ssh/authorized_keys`, shell rc, git hooks |
| **Secret theft** | `secure_store::get_secret` (`secure_store.rs:72-99`) | flat keyspace, no caller scope | read every stored API key |

Decisive architectural consequence: **third-party code must never run with the
document window's identity.** It runs out-of-process (sidecar, Tier C) or in an
isolated worker/iframe (Tier B), never as in-webview JS. This is a primary
argument *for* the sidecar-first path — a sidecar reaches VMark only through the
bridge, where the broker can mediate.

## Trust tiers, grounded in evidence

| Tier | Mechanism | Measured readiness | Verdict |
|---|---|---|---|
| **A — Declarative** (themes, snippets, keybindings, menu/command entries) | signed JSON manifest, no code execution | greenfield but trivial; caveat: shortcuts bind to `menuId`s not command-ids; no `plugin:` namespace yet | **Fast first win** — real ecosystem in weeks, teaches signing/distribution at zero risk |
| **C — Sidecar process** | generalized MCP bridge + capability broker | **transport ~80 % built; broker production-grade** — but **0 extension point** | **Primary path**, highest leverage |
| **B — Sandboxed logic** + the *safe editor subset* | WASM/worker + message-passing | greenfield; safe subset is real: **decorations, code-fence renderers** (mermaid/graphviz already fit), **declarative input rules** | Second track |
| **D — Schema nodes / Rust commands** | in-webview / compiled-in | blocked by serialization inversion + Rust compile-time + RCE inheritance | First-party / signed-partner only; **not soon** |

What Tier C needs (small, reuses the strong parts): a dynamic tool-registration
RPC (sidecar declares `{namespace, actions, schema}` at connect); prefix
routing to replace the 3 closed switches; namespace-ownership arbitration keyed
on the already-captured `ClientIdentity`; generalize `authorize_driver_op` from
`(origin × operation)` to `(plugin-principal × capability-scope)`. Consent UI
(`ApprovalDialog` + siblings) and the fail-now→approve→retry pattern are already
the right shape.

## Coupling findings (internal-modularity track)

- **Best pilot: Content Server** — extractability 5/5. 3 FE files, zero
  core-store imports, zero sibling imports; Rust `content_server` touches only
  `app_paths` + one `ai_provider` call. It is depended-upon, not depending.
  **Terminal** is runner-up (4/5): self-contained Rust PTY, only read-only core
  config coupling.
- **Two concrete refactors unblock the worst-coupled features:**
  1. Break the **coherence ↔ workflow Rust cycle**
     (`coherence/check_commands.rs:177` ⟷ `workflow/coherence_capture.rs:15-18`;
     runner reaches `crate::genies` ×9 + `crate::coherence` ×10).
  2. Fix **`bookmarkStore` mis-ownership** (`stores/bookmarkStore.ts:25` depends
     on Browser internals while Browser UI imports it back → bidirectional
     Browser ↔ Coherence link). Reassign the store to Browser.
- **Reclassify Genies / `ai_provider` as a platform service**, not a removable
  extension — workflow (Rust), coherence (Rust), and the workflow FE runner all
  depend *into* it.
- **Split the GHA workflow *viewer* from the *runner*.** The viewer
  (`gha_workflow`, `ai_provider` ×2 only) is ~4/5 extractable; the runner is the
  most-coupled module in the tree and drags the whole feature to 2/5.
- **God-file tax:** worst offender is the Tiptap extension cluster
  (`tiptapExtensions.ts` 78-entry hand-ordered array + `editorPlugins.tiptap.ts`
  already at the file-size baseline cap + `sourceEditorExtensions.ts` parity
  mirror). `command_registry.rs` (157 cmds) and the T03 lifecycle composites are
  already well-contained by design. `browser` + `coherence` alone are 46/157
  commands (29 %).

## Recommended sequence (each phase de-risks the next)

0. **Security pre-req (do regardless of plugins):** broker the two RCE commands
   (`pty_spawn`, `run_ai_prompt` cli_path) as deny-by-default, one-shot-only;
   confine `atomic_write_file` through the existing `mcp_bridge_path_guard`;
   namespace the keychain per-caller.
1. **Tier A** — signed declarative manifests (themes/snippets/keybindings).
2. **Generalize the broker** — lift `origin_guard`/`one_shot`/`operation` into a
   plugin-principal capability broker (the load-bearing security work; ~half
   built).
3. **Tier C** — dynamic tool registration + prefix routing on the MCP bridge,
   gated by the broker; distribution via generalized `mcp_config`.
4. **Tier B** — WASM/worker host + the safe editor subset.
5. **Internal cleanup in parallel** — ContentServer pilot → the god files. Now a
   maintainability win, **no longer a blocker** for the ecosystem (the key
   reprioritization).
6. **Tier D / serialization inversion** — only if editor nodes become a goal.

Next formal artifacts if pursued: **ADR-015 ("Extension model: trust tiers,
sidecar-first, capability broker")** + a Phase-0 spike (rule 60 §7) validating
that `authorize_driver_op` generalizes to plugin principals and that the MCP
bridge accepts dynamic tool registration.

## Key file anchors

| Concern | Anchor |
|---|---|
| Dead plugin registry | `src/plugins/registry.ts`, `src/plugins/manifests.ts` |
| Real editor composition roots | `src/services/assembly/tiptapExtensions.ts`, `sourceEditorExtensions.ts` |
| Serialization wall | `src/utils/markdownPipeline/proseMirrorToMdast.ts:135`, `mdastToProseMirror.ts` |
| Command bus + palette | `src/services/commands/CommandBus.ts`, `src/components/CommandPalette/CommandPalette.tsx:57` |
| God files | `src-tauri/src/command_registry.rs:15-181`, `src/App.tsx:243`, `src/hooks/lifecycle/*` |
| Capability broker (reuse) | `src-tauri/src/browser/{authorize.rs,origin_guard.rs,one_shot.rs,operation.rs}`, `commands_auth.rs:146-234` |
| MCP bridge / extension point | `vmark-mcp-server/src/{server.ts:84,index.ts:81}`, `src-tauri/src/mcp_bridge/{routing.rs:117,types.rs:23}`, `src/hooks/mcpBridge/v2/dispatch.ts:69` |
| RCE / unconfined holes | `src-tauri/src/pty.rs:62`, `ai_provider/cli.rs:99`, `file_write.rs:26`, `secure_store.rs:37` |
| Path-guard / SSRF (reuse for scopes) | `src-tauri/src/mcp_bridge_path_guard.rs:78`, `browser/ai_policy.rs:54` |
| Tauri ACL (coarse outer fence only) | `src-tauri/capabilities/default.json` |

## Caveats / not examined

- No third-party plugin system exists today — every "plugin" is a compiled-in
  Tauri plugin or a first-party ProseMirror editor plugin.
- Distribution/marketplace, signing infrastructure, SDK versioning policy, and
  the contract-freeze governance cost (conflicts with the repo's aggressive
  internal-refactor culture) are named but not designed here.
- Effort not estimated; this note is a direction/feasibility record, not a plan.
