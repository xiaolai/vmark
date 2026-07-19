---
vmark:
  id: 019f75b7-74d9-7590-a5ee-5ed7db5f108b
---
# Phase 2a — Semantic-Model Design (O1 · O5 · O8 · R33)

> Status: **APPROVED** — codex-as-human owner review 2026-07-18
> (APPROVED WITH CHANGES; all 11 required changes applied below).
> Inputs: paper v1.1 (+ session-2 narrow-waiver amendment), spec v0
> (§5.4.4/5.4.5 fixed schemas, §6 manifests, §9.2 projection), dogfood
> session 2 (M2 5/5, M4 at budget, F2 fixed + verified), owner
> preferences stated 2026-07-18 (decisions thread + session close).

**Owner decision record (verbatim):**

> I approve the Phase 2a direction: contexts remain named single-parent
> scopes, canon is greenhouse-first and human-promoted, waivers remain
> narrow per edge and upstream revision, and only established claims in
> enforcing contexts constrain. Before Phase 2b is planned, the draft
> must make claim identity, retirement, divergence, and context-specific
> check-result validity executable, including the required additive wire
> fields. The implementation gate must also preserve explicit human
> authority and close Session 2's MCP and ninth-edge reservations.

The four open decisions are one model: **contexts select what is true
(O1), claims say what is true (O5), waivers record accepted divergence
(O8), and maturity × enforcement decides what may constrain (R33).**
The only wire change is two additive fields on `check-result` (D5.6);
`format` stays `0` under the additive-field policy.

## D1 (O1) — Context composition: single-inheritance overlay, frozen

1. A context has at most one `parent`. The chain must terminate within
   16 hops; a cycle or overflow is a **config error surfaced in the
   breakdown header** (the context degrades to the implicit default —
   fail loud, never guess).
2. `effective_selection(C, obj)`: walk child → parent; the first
   explicit entry in `selections` wins; absent everywhere → `live`.
   Deterministic, no merging, no arithmetic on revisions.
3. `effective_claims(C)`: **additive union** along the chain, deduped by
   **claim id** (D2.1). Inheritance is strictly additive: **a child
   context cannot hide a parent's claim** — visibility is removed at the
   claim's home context or the claim is superseded. Duplicates are one
   claim: the same claim id appearing at several chain levels
   contributes once. Sibling contexts are independent — no cross-sibling
   visibility, no ordering relation between siblings; only the
   child→parent chain is consulted.
4. `enforcement` is **not inherited**. Every manifest states its own;
   a missing field means `greenhouse`. A child of an enforcing context
   is greenhouse unless it says otherwise — constraint is always an
   explicit local choice.
5. The implicit default context stays exactly as spec §6 ships it:
   all-live, greenhouse, no claims, no manifest file.

## D2 (O5) — Canon lifecycle: explicit acts only, greenhouse-first

Claims are ledger entries (spec §5.4.5). **Claim identity is separate
from entry identity**: the body's `claim` field is the stable
claim-object id; every lifecycle act appends a **new entry with the same
claim id** whose `supersedes` names the prior entry's id.

1. **Current-entry resolution (deterministic across merged writers):**
   the current entry for a claim id is the entry not named by any other
   entry's `supersedes`, resolved in the reader's total order
   (`(time, entry-id)`, spec §5.1). Concurrent supersessions of the same
   entry converge like all merged-writer appends: both are preserved;
   the latest in reader order is current; the breakdown surfaces the
   conflict rather than hiding it (same fail-loud posture as Diverged).
   Manifests scope by **claim id**, so no lifecycle act can orphan a
   context's `visible_claims`.
2. **Extract.** From a text selection in a tracked doc: statement
   prefilled from the selection, editable before commit;
   `established_by` = that object + its current revision; `valid_at`
   defaults to now (event time, editable); `maturity: draft`. The claim
   id is added to the **current context's** `visible_claims` — one act
   covers birth and scoping. In the default context, extraction
   materializes `contexts/default.json` (spec §6 already allows this).
3. **Promote** (draft → established). A new entry, same claim id,
   `supersedes` the draft, `maturity: "established"`, statement and
   `valid_at` carried over, provenance preserved. Promotion is a
   transformation (R33) — history shows who promoted what, when.
4. **Scope.** Add/remove the claim id in a context's `visible_claims`.
   Scoping is a **reversible visibility change and nothing more** — it
   is never retirement, and a claim scoped out of every context remains
   a live claim.
5. **Retire — explicit supersession only.** Two forms: *in-world end* —
   superseding entry sets `invalid_at` (the fact stopped holding at an
   event time); *correction* — superseding entry carries the corrected
   statement. Deletion does not exist (I5).
6. **Authority (R29-aligned):** every claim lifecycle entry records the
   human `actor` (same identity rule as resolutions, spec §5.4.3); in
   Phase 2b the only mutating surface is the in-app UI — agent- or
   MCP-performed claim mutation waits for Phase 3's delegation model.
   AI may *suggest* a claim in-session, but nothing persists without
   the explicit human accept act.

## D3 (O8) — Waiver scope: the session-2 narrow baseline, formalized

1. Scope is **per-edge, per-upstream-revision** (`resolved_against`),
   with a **required reason** — exactly what paper (session-2 amendment),
   spec §5.4.3, and the shipped breakdown UI already do. Per-object and
   per-claim waivers are **rejected** for v1.
2. `expires` (already in the schema and honored by projection) gets UI:
   an optional expiry on the waive flow (Phase 2b). An expired waiver is
   absent for projection; the record stays in history.
3. **Re-prompt policy is the §9.2 projection, unchanged and fail-closed:**
   when the context's selection advances *linearly* past
   `resolved_against`, the edge reopens as VersionStale. When the
   selection is incomparable with the pin or the upstream has multiple
   heads, the edge is **Diverged** — and Diverged edges cannot be
   ratified or waived until a defined revision exists (the shipped UI
   already disables both; revising is the only way out). A waiver never
   converts divergence into acceptance.
4. The breakdown row shows an informational **"previously waived ×N"**
   badge (count of historical waivers on that edge) so repeat divergence
   is visible without nagging.
5. A semantic **contradiction is waived with the same mechanism** — an
   ordinary edge waiver while the check-result stays in history. No new
   record kind; one resolution model everywhere.

## D4 (R33) — Maturity × enforcement: the constraint matrix

A claim is **fed to a check** if and only if ALL hold:

| Condition | Source |
|---|---|
| `maturity = established` | claim entry (D2.3 promotion) |
| claim ∈ `effective_claims(C)` | D1.3 |
| claim transaction-current (not superseded) | D2.1 |
| **not invalidated**: current entry's `invalid_at` is null | D4.2 |

1. **Enforcement decides presentation, not the feed:** in an
   *enforcing* context, a fed claim **constrains** — a contradiction
   against it is labeled a violation of canon. In a *greenhouse*
   context, the same fed claims are **advisory** — verdicts are shown
   as "tension noted", never as violations (I4 preserved). Draft
   claims are never fed anywhere; they exist only in claim views.
2. **`invalid_at` semantics for 2b:** a current claim entry with
   `invalid_at` set is **non-constraining and non-fed** (it is an
   in-world-ended fact). Story-time filtering — feeding a claim only
   when the checked document's in-world "now" falls inside
   [`valid_at`, `invalid_at`) — is per-vertical semantics and is
   **deferred**; 2b uses the binary rule only.
3. Flipping a context to `enforcing` requires an **explicit in-app human
   confirmation** (it changes how every future verdict is labeled);
   greenhouse is always the default (D1.4).

## D5 — Semantic checking mechanics (R11/R25, Phase 2b)

1. **Pull-only.** Checks run when the human asks (per-edge "Check" in
   the breakdown, or per-artifact "Check all inputs"). No background
   checking in 2b — advisory (I3), cost-bounded, and M5 stays snappy.
2. **Claims are inputs to edge checks, not a parallel check stream.**
   The checker prompt receives: pinned upstream revision, current
   upstream revision, the downstream excerpt around the dependency, and
   the fed claims per D4. A claim-vs-document check with no edge to
   anchor on is Phase 3 (needs its own record anchor).
3. **Verdict discipline (S4 findings):** confidence < τ → `unknown`
   (τ = 0.9 as **tunable policy**, recorded per result, not a wire
   rule); provider error/timeout → `unknown`; `contradiction` requires
   at least one `evidence` quote with location. `unknown` is surfaced
   as its own badge, never merged (R25).
4. Results expire when either endpoint advances (already spec'd);
   expired results leave the badge, the row returns to plain
   VersionStale/Fresh.
5. Provider: the app's configured AI provider (`ai_provider` dispatch),
   `prompt_version: "check-v1"` recorded on every result.
6. **Context-snapshot binding (the one wire change — additive, format
   stays 0):** every new `check-result` carries two additional fields:
   `context` (the context id the check ran under; the implicit default
   context has a fixed nil-namespace id) and `claims_fingerprint`
   (SHA-256 over the sorted `(claim-id, current-entry-id)` pairs fed,
   `sha256:` prefixed; empty feed hashes the empty string). A result is
   **live** for projection only when its (`pinned`,
   `checked_against`) pair matches §9.2's comparison AND its `context`
   matches the projecting context AND its `claims_fingerprint` equals
   the fingerprint of the claims that would be fed now. Results lacking
   the fields (pre-v1 history) are **historical only** — never
   projected. A result computed under one context's claims can never
   be reused under another's.

## Consequences for the format

Two **additive** fields on `check-result` (D5.6); everything else fills
in semantics already reserved in v0. The spec document advances to
**revision 1 of format 0** (same file, same `format: 0` on the wire;
readers are unaffected — v0 readers already preserve unknown fields).
Per **R21 (contract before implementation)**, the spec and paper
amendments land **before** any Phase 2b implementation WI — they are
WI-2b.0, the phase's entry gate.

## Phase 2b decomposition (WIs for the plan amendment — ordered)

| WI | Scope | Tests-first anchor |
|---|---|---|
| WI-2b.0 | **Entry gate:** spec revision 1 (D1–D5 semantics, additive check-result fields) + paper §O amendments + `check-coherence-phase.sh 2` skeleton asserting the contract text exists | gate asserts (fail-closed) |
| WI-2b.1 | Context manifest load/validate (chain, cycle guard → default + surfaced error, atomic write) as a **delta over the Phase 1 projection** — `effective_selection` extends `dag::resolve`/`project_edge`, no reimplementation | overlay precedence, cycle, live-default, Phase 1 tests still green |
| WI-2b.2 | Claim entries: create/promote/supersede/retire/scope commands (human actor recorded, in-app-only surface), index table keyed by claim id, `effective_claims`, current-entry resolution incl. concurrent-supersession convergence | D2.1 determinism, bi-temporal chains, D4 feed matrix |
| WI-2b.3 | check-result indexing + context-aware projection: axis-2 states (StaleValid / Contradicted / Unknown), endpoint-advance expiry, `context` + `claims_fingerprint` liveness, waiver precedence, pre-v1 results historical | spec §9.2 completion + D5.6 |
| WI-2b.4 | Checker service: provider dispatch, tunable τ gate, timeout→unknown, evidence extraction, `coherence_check` command persisting D5.6-complete results | mocked provider, every verdict path, fingerprint mismatch |
| WI-2b.5 | Breakdown UI: axis-2 badges, Check action, waiver expiry input, "previously waived ×N", enforcement-aware labeling (violation vs tension) | component tests |
| WI-2b.6 | Claim UI (minimal): extract-from-selection, per-context claim list, promote/supersede/retire/scope with explicit confirmations | store + component tests |
| WI-2b.7 | Context UI (minimal): picker, create, enforcement toggle **with explicit confirmation dialog**, visible-claims management | store tests |
| WI-2b.8 | MCP `coherence` tool: read-only `claims` / `contexts` actions (R23 intact) | bridge tests |
| WI-2b.9 | i18n ×10 locales for all new UI strings + website guide updates | translation pass |
| WI-2b.10 | **Dogfood session 3** (self-hosted): M3 ≥ 70% target AND closure of Session 2 reservations — the ninth edge (`phase1-e2e.md`), a live MCP-funnel run, F2 fix re-verified at scale — gated on M1/M2/M4/M5 re-measurement + the qualitative gate, not M3 alone | fail-closed gate `check-coherence-phase.sh 2` complete |

Order is dependency order; the gate grows per-WI assertions as each WI
lands (rule 60 §3) and runs the suites it names.

## Explicitly rejected (recorded so they stay rejected)

- General composition algebra / multi-parent contexts / child-side claim
  hiding (O1) — no use case; additive-only inheritance.
- **Automatic claim acceptance, persistence, or promotion** (O5) —
  silent canon creation stays rejected. A future AI *proposal* workflow
  behind an explicit human accept act is compatible with this decision
  and remains open for Phase 3+.
- Per-object / per-claim waivers; waiving Diverged edges (O8).
- Enforcement inheritance; enforcement without explicit confirmation
  (R33).
- Background/scheduled semantic checking (D5) — advisory only, pull only.
- Story-time claim filtering in 2b (D4.2) — deferred with the binary
  `invalid_at` rule in its place.
