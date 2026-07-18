---
vmark:
  id: 019f7746-33cf-77c2-a56c-aae4bf076c9f
---
# Phase 3 — Design (R3/O2 · R29 · branch contexts · MCP hardening)

> Status: **APPROVED** — codex-as-human owner review 2026-07-19
> (APPROVED WITH CHANGES; all 12 required changes applied below).
> Inputs: paper v1.1 (R3, R12, R29, O2, §13 Phase 3 outline), spec
> revision 1, design-2a.md (approved model), dogfood sessions 2–3
> (PASS; findings F5/F6), owner priority stated at session-3 close.

**Owner decision record (verbatim):**

> I approve the Phase 3 direction and the order that starts with
> lazy-confirmation inference. Before this becomes the plan,
> re-emission must be a normative idempotent provenance event,
> delegation must be authenticated and expiring, and branch context
> selection must remain explicit. Keep every new surface pull-only and
> fail loud on ambiguity, stale heads, expiry, and disconnect races.

Phase 3's four concerns are one posture: **provenance for edits no
model mediated (D1), authority for actions no human performed directly
(D2), contexts that follow how creators actually branch (D3), and an
MCP surface honest enough to carry both (D4).** Only explicit human
acts may select a context, confirm provenance, grant authority, or
resolve an edge.

## D1 (R3/O2) — Human-edit input inference, lazily confirmed

Today a human edit records the prior revision exactly (R3 first half)
but carries no referenced inputs — strict liveness then correctly
suppresses the doc's superseded edges, and provenance is lost until
re-derivation. D1 restores it without breaking R4.

1. **Proposals are computed, never stored** — and they are
   **context-relative and head-safe**. For the projecting context C:
   the object must resolve to a **single head** in C; the candidate
   source is the most recent transformation in the head's **ancestry**
   that carried inputs. Direct inputs are proposed as direct;
   contextual inputs are preserved as contextual (R24 — roles never
   silently promote). Multi-head, unknown-pin, pinned-revision
   mismatch, or a head that changed since proposal time all **fail
   loud** — no proposal rather than a guessed one (R10/O2).
2. **One heuristic in Phase 3:** the prior-input-set. LLM-assisted
   inference (R3's "may") is deferred until the heuristic's dogfood
   acceptance data exists (O2 demands quality evidence first).
3. **Confirmation is a normative wire event** (spec revision 2,
   `provenance-confirmation`): the **only** transformation permitted to
   re-emit an existing revision. Rules: fresh envelope id, fresh txf
   identity, **fresh idem minted for the confirmation** (retries reuse
   that new idem, never the original transformation's); output
   revision, parents, and content hash must equal the current head
   **exactly**; confidence `inferred`; the human actor recorded. Old
   resolutions never transfer — the new txf's edges start unresolved.
   (The index already supports this: edges key by txf, applied keys by
   idem — the contract makes it explicit.)
4. **Guard:** confirmation validates against the current head at
   append time; a changed head fails loud (`stale confirmation —
   re-propose`).
5. **Lazy surface (R4/R14):** proposals appear ONLY in the breakdown —
   a per-artifact "provenance unknown" group when an object's head has
   no live edges but its ancestry had them. Checkbox list (proposed
   inputs pre-checked, removable, file picker to add), one Confirm.
   No popups, no save-time interception. In-app saves and external
   edits behave identically — this path is downstream of capture.

## D2 (R29/R12) — Delegation and the mutating MCP surface

1. **New ledger entry kind `delegation`** (spec revision 2; unknown
   kinds are preserved+ignored by older readers). Schema, normative:
   `{delegation: "<stable-grant-uuid>", actor: {type: "human", id},
   delegate: {type: "external", id: "<bridge principal>"},
   scope: ["resolve.accept-newer", "resolve.waive"],
   expires: "<RFC 3339, REQUIRED>", supersedes: "<entry-id|null>"}`.
   Lifecycle mirrors claims: stable grant id across entries; a
   superseding entry replaces the grant (empty `scope` = revocation);
   current entry = the unsuperseded one, latest in reader total order
   on concurrent supersession (deterministic, conflicts surfaced).
   The in-app UI defaults expiry to 7 days and never offers "forever".
2. **Grants are in-app explicit acts** (confirmation dialog naming
   delegate principal, scope, expiry); revocation likewise; both record
   the human actor.
3. **Identity is the authenticated bridge principal.** The bridge
   already authenticates clients (token) and records their identified
   name; the kernel receives that principal from the bridge layer —
   **never from tool arguments**. A caller-supplied `agent_id` does not
   exist in this design.
4. **MCP gains ONE mutating action:** `resolve` on the coherence tool
   (`{workspace_root, txf, input, resolution, reason?}`). Authorization
   is fail-closed: the edge must exist and be **live** (historical or
   suppressed edges are rejected); a delegation must be current,
   unexpired, unrevoked, scope-covering, and delegate-matching the
   bridge principal; waivers require a reason; Diverged edges stay
   unresolvable (D3 of design-2a). The appended resolution records the
   agent actor plus a `delegation` field referencing the grant entry id
   (additive on §5.4.3) — **required iff `actor.type` is not human**,
   and validation of that pairing is part of the entry's typed check.
5. **Claim and context mutation stay off MCP** in Phase 3 — canon
   remains human-controlled.

## D3 — Branch-mapped contexts and the post-merge surface

1. **Opt-in mapping:** a context manifest gains optional
   `git_branch: "<name>"` (additive; **exact string match** against
   `git rev-parse --abbrev-ref HEAD`, no globs). Nothing is created
   automatically; "Create context from current branch" is one explicit
   act (greenhouse context named after the branch, mapping set).
2. **No auto-selection, ever.** When the current branch maps to a
   context that is not selected, the breakdown shows a **pull-only
   candidate chip** ("branch context available: <name> — switch?");
   switching is an explicit click. Detached HEAD, no-git workspaces,
   renamed branches, or multiple contexts mapping the same branch:
   the chip is suppressed or shows an ambiguity notice — the selection
   NEVER changes on its own.
3. **Completed-merge identity + idempotent diagnostic:** gitops today
   classifies in-progress merges (MERGE_HEAD); Phase 3 adds the
   completed-merge classifier — a new head commit with **two or more
   parents** observed since the previous scan observation. The scan
   appends ONE `diagnostic` per merge commit hash (deduped against the
   ledger across repeated scans; mid-conflict merges defer until
   MERGE_HEAD clears). The breakdown header shows a dismissible,
   pull-only banner; semantic checking stays human-triggered (R15/R25
   — nothing runs in the background).

## D4 — MCP surface hardening (session-3 findings)

1. **F5 — workspace routing with precedence, fail-loud:**
   (1) explicit window argument, if the window exists — a conflict
   between an explicit window and the path's workspace is an **error**,
   not a silent choice; (2) the registered window whose open workspace
   **canonically contains** the request's path / matches
   `workspace_root` (symlinks resolved; nested workspaces pick the
   deepest containing root; two non-nested candidates = ambiguity
   error); (3) only for workspace-less requests: focused, then main.
   Workspace scope overrides focus — a workspace request never
   silently falls back to an unrelated window.
2. **F6 — ownership-scoped disconnect cleanup:** the bridge tracks
   which tabs each client session opened. On disconnect it may close
   **owned AND clean** tabs only — never dirty tabs, never tabs it did
   not open, never the workspace, and never during transient
   reconnects (cleanup runs only after the session is finally gone,
   with a short grace window).

## Consequences for the format

Spec advances to **revision 2 of format 0** — all additive, each
independently readable and fail-closed:

- `delegation` entry kind (full schema + lifecycle above), indexed for
  validation queries.
- Optional `delegation` reference on resolution records — **required
  when the actor is not human**, and typed-validated as such.
- `provenance-confirmation` as the sole re-emitting transformation
  (identity rules above; compatibility fixture: a v1 reader preserves
  and ignores nothing here — it simply sees a transformation whose
  output already exists, which §5.1 already tolerates).
- Optional `git_branch` manifest field with a **round-trip guarantee**:
  manifest writers must preserve unknown fields (the manifest struct
  carries them through rewrite); a writer that cannot must refuse the
  rewrite with a surfaced error rather than drop data.

## Phase 3 decomposition (WIs for the plan amendment — ordered)

| WI | Scope | Tests-first anchor |
|---|---|---|
| WI-3.0 | **Entry gate (R21):** spec revision 2 (all four additions, normative) + paper R3/O2/R29 resolution notes + manifest unknown-field round-trip (fix + test — precedes any manifest writer change) + gate skeleton | compatibility fixtures: v1-reader preservation, manifest round-trip |
| WI-3.1 | Kernel: context-relative head-safe proposals (single-head guard, ancestry walk, role preservation) + `confirm_inputs` (fresh id/txf/idem contract, exact head match, no resolution transfer) | proposal matrix (multi-head/unknown/mismatch fail loud), re-emission idempotency property, retry-idem property |
| WI-3.2 | Commands + breakdown UI: provenance-unknown group, checkbox confirm flow, i18n EN + ×9 | component + service tests |
| WI-3.3 | Kernel: delegation entries (stable grant id, required expiry, supersession/revocation, deterministic concurrency) + `live_delegation_for(principal, scope)` + resolution typed-validation of the delegation pairing | full authz matrix: expired/revoked/scope/principal/historical-edge |
| WI-3.4 | In-app grant/revoke UI (explicit dialog, 7-day default, no forever) + commands | store/component tests |
| WI-3.5 | MCP `resolve` behind bridge-principal authorization; F5 precedence routing (canonical containment, nested, ambiguity errors); F6 ownership-scoped cleanup with grace window | routing precedence + disconnect-race + sidecar tests |
| WI-3.6 | Branch contexts: `git_branch` field, candidate chip (pull-only, explicit switch), create-from-branch act, detached/ambiguous suppression | contexts + panel tests |
| WI-3.7 | Completed-merge classifier + per-merge-hash deduped diagnostic + dismissible banner | gitops classifier + dedupe-across-scans + panel tests |
| WI-3.8 | Website guides EN + ×9 | build + spot asserts |
| WI-3.9 | **Dogfood session 4** — O2 measured as a full record: proposal denominator, accepted-unchanged, accepted-after-edit, rejected, precision of accepted edges (owner-judged), and observed missed edges; plus delegated MCP resolve live end-to-end, branch chip + merge banner on a real branch, M1–M5 re-checked. Owner judgment is the fail-closed criterion; gate `check-coherence-phase.sh 3` completes | fail-closed gate |

## Explicitly rejected (recorded so they stay rejected)

- LLM-assisted input inference in Phase 3 (heuristic acceptance data
  first; R3's "may" is not a mandate).
- Storing proposals in the ledger; any proposal surface outside the
  breakdown.
- Confirmation minting a new revision; confirmation reusing the
  original transformation's txf or idem.
- **Silent branch auto-selection** — context selection is an explicit
  human act, always.
- **Automatic post-merge semantic checks or resolutions** — the banner
  is pull-only and dismissible; checking and resolving stay
  human-triggered (or delegated-agent-triggered under D2).
- **Self-asserted MCP identities** — authority binds to the
  authenticated bridge principal only.
- Non-expiring delegations; delegation of claim/context mutation.
- Automatic branch-context creation; focused/main fallback for
  workspace-scoped MCP requests.
