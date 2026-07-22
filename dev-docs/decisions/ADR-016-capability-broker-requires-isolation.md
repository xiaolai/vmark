# ADR-016: A Capability Broker Requires an Isolation Boundary First

> Status: **Accepted** | Date: 2026-07-23
> Blocks: WI-0B.1, WI-0B.3, WI-0B.4, WI-5.2–WI-5.5 of
> `dev-docs/plans/20260722-extension-architecture.md`
> Depends on: ADR-015 D5 (third-party code never runs with document-window identity)

## Context

Seven work items across Phase 0B and Phase 5 were each individually blocked, and
each was re-scoped onto "the capability broker". That framing implied a single
missing component that could simply be built. Investigating it showed the
dependency is the other way round, and the reason is worth recording so nobody
re-opens these items expecting a straightforward implementation.

The four dangerous commands:

| Command | Guard today | Why an allowlist fails |
|---|---|---|
| `pty::pty_spawn` | none — arbitrary exe, args, env, cwd | The terminal spawns a **user-configured** shell (`spawnPty.ts:188` reads `settings.terminal.shell`). Any binary allowlist breaks custom shells |
| `ai_provider::run_ai_prompt` | now basename-validated (WI-0B.2) | Fixed, because `cli_path`'s legitimate use is a custom *install location* for the same binary — the only one of the four with a natural allowlist |
| `file_write::atomic_write_file` | rejects `..`, requires absolute, checks parent | Save paths come from the **native dialog** (`hooks/saveDialog.ts:14`); a user may legitimately save anywhere. A root allowlist breaks Save As |
| `secure_store::get_secret` | flat keyspace | Re-namespacing per caller strands every key users already stored |

Three of the four cannot be fixed by constraining *what* is requested. They can
only be fixed by constraining *who* is asking.

## The finding

**There is no caller principal available to a Tauri command, and there cannot be
one inside a single JavaScript context.**

- `pty_spawn` receives only `tauri::State<PtyState>`. `run_ai_prompt` receives a
  `WebviewWindow`. Both are **window** identity, not **caller** identity.
- The Tauri ACL (`capabilities/default.json`) is per-window for the same reason,
  and the 157 custom commands are not ACL-gated at all.
- `ClientIdentity` (`mcp_bridge/types.rs:88`) is the one real principal in the
  codebase — and it exists only because the MCP bridge is a **separate process**
  that performs a handshake over a socket.
- The browser broker's principal is the **origin of the page being automated**
  (`browser/authorize.rs`), i.e. what is being acted upon. It is not the identity
  of the actor.

VMark's own terminal UI and hypothetical in-webview plugin JS would share one JS
context, one window, and one command surface. Nothing at the IPC boundary can
distinguish them, because there is nothing to distinguish — they are the same
principal.

## Decision

**A capability broker for these commands is not implementable until third-party
code runs behind an isolation boundary.** Isolation is the prerequisite, not the
follow-up:

```
isolation boundary  →  caller principal  →  capability broker  →  brokered commands
   (WI-5.4 / 5.5)      (a real identity)      (generalized)        (WI-0B.1/3/4)
```

The existing broker generalizes cleanly once a principal exists — `origin_guard`
+ `one_shot` + `operation` already model default-deny, a closed capability
vocabulary, standing grants, and payload-bound one-shots. That part is sound and
reusable. What is missing is upstream of it.

## Consequences

- **WI-0B.1, 0B.3, 0B.4 are re-sequenced after WI-5.4/5.5**, not before them.
  The plan had them in Phase 0B as "mechanical hardening", which was wrong.
- **WI-5.2–5.5 additionally need a package/security contract** — key ownership,
  rotation, revocation, package identity, update policy, compatibility ranges,
  downgrade behaviour, local-development exceptions. That is a product decision.
- **The four commands stay as they are, deliberately.** They are reachable only
  by first-party code today, because no third-party code runs at all. The
  exposure is latent, not active. Shipping allowlists that break custom shells,
  Save As, and stored credentials would trade a latent risk for three certain
  regressions.
- **ADR-015 D5 is reinforced, not amended.** "Third-party code must never run
  with the document window's identity" now has a second reason: not only is that
  identity over-privileged, it is also *unbrokerable*, because it is not an
  identity at all.

## Corollary: WI-5.2–5.5 are closed as "not to be built yet"

The isolation question above has in fact already been answered. The 2026-07-21
investigation recommended **sidecar-first (Tier C)** with evidence — the MCP
bridge is ~80% of a plugin runtime, the broker is production-grade, and
`ClientIdentity` is already captured at the handshake. So the decision is not
genuinely open; what remains is a package/signing contract, which is a product
decision.

But there is a second, stronger reason not to build the remaining items now, and
it comes from ADR-015 D6:

> An acceptance gate must count **adoption**, never existence.

There are **zero** third-party plugins, and none can exist until the package
contract does. A Tier-A declarative contribution point, a dynamic tool-registration
RPC, or a generalized broker built today would each have **no consumer** — they
would be exactly the foundation-shaped dead code the 2026-07-22 ADR audit found
four times over (`useWorkspace()`, `pluginsFor()`, `EditorHost`, ADR-007's slot
seam: each shipped as an API surface, marked Accepted, never adopted).

Building them would violate the rule this re-architecture exists to establish, in
the name of completing the plan that establishes it.

**Therefore WI-5.2–5.5 are closed as deliberately-not-built.** They reopen when a
package contract creates a real consumer — at which point the design is already
recorded (ADR-015 D5 trust tiers, this ADR's dependency order) and the transport
is already ~80% built. That is the right state for them to be in: designed,
evidenced, and unbuilt.

What IS built is everything with a consumer today: the fence extension point
(six first-party renderers), lifecycle-bound registration, and the `cli_path`
guard.

## What would unblock this

One decision, then the rest is engineering:

> How does third-party code execute — out-of-process sidecar (Tier C, ~80% of the
> transport already exists in the MCP bridge), or sandboxed worker/WASM (Tier B)?

Either answer creates a real principal at a real boundary, and the broker follows
from it. Neither answer can be inferred from the code.

## Verification

- `grep -n "pub async fn pty_spawn" -A9 src-tauri/src/pty.rs` — no caller identity
  in the signature
- `grep -rn "ClientIdentity" src-tauri/src/` — confined to `mcp_bridge/`, the
  cross-process transport
- `src-tauri/src/browser/authorize.rs` — authorizes `(origin × operation)`, where
  origin is the target, not the actor
