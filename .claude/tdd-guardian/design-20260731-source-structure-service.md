# Design required: revision-keyed source structure service

**Status: NOT A PLAN. Design work, not work items.**

Split out of `.claude/tdd-guardian/plan-20260731-113906.md` on 2026-07-31, where
this material was Phases 4–9 — **16** of that plan's 33 work items, leaving 17.
Counted with `grep -cE '^### WI-'`, not by hand: the first draft of this line
said 20. That is the third hand-count error this plan family has produced, which
is why the count is now always mechanical.

It is here rather than in `dev-docs/plans/` because `dev-docs/` is gitignored
(maintainer-local by project convention). The point of splitting this out is
that it survives until someone returns to it, which a gitignored file on one
machine does not.

## Why it was split out

Not because the goal is wrong. Because **the work items describe an
architecture that does not exist yet**, and TDD cannot proceed against a missing
design — you would be writing RED tests to pin down decisions nobody has made.

The proof is inside the plan itself. WI-4.1's acceptance criterion reads:

> Index size for a 1 MiB document is under a **stated byte budget** measured in
> the WI-0.1 spike.

WI-0.1 ran, and what it measured was that **the obvious encoding does not fit**:

| Measured in WI-0.1 (2026-07-31) | Value | Consequence |
|---|---|---|
| Naive index size (one object per block) | **86.6% of document size** — 1117 KiB for 1.26 MiB | The stated budget is unsatisfiable by the design WI-4.1 describes. A real encoding is needed: parallel typed arrays, or a flat offset buffer with a separate type table. |
| Main-thread parse, 1.26 MiB / 19,419 blocks | **720 ms** | Worse than the ~400 ms/10K-lines the architecture doc assumed. The UI stall is real, so the worker is not optional. |
| `structuredClone` of a 19,419-entry index | **5.2 ms** | Transfer is NOT the bottleneck. The parse is. Optimising the wire format would be solving the wrong problem. |
| Vite worker under Tauri CSP | **Viable** — same-origin file worker, no blob | Unblocked. But see the CI gap below. |

So the acceptance criterion cites a measurement that refutes the design it is
attached to. That is a design gap wearing a work item's clothes.

## The unresolved questions

Each of these must have an answer before this becomes a plan. None is a
scheduling question; all are design questions.

1. **What is the index encoding, and what is the byte budget?**
   One object per block is 86.6% of document size. Parallel typed arrays and a
   flat offset buffer are the named candidates, neither costed. Until this is
   answered, WI-4.1's "versioned TypeScript interfaces" cannot be written,
   and WI-4.2/7.1/7.2 all inherit the vacuum.

2. **Is a 720 ms parse acceptable at any tier, and what happens during it?**
   The worker moves the stall off the UI thread; it does not make the answer
   arrive sooner. WI-5.5's deferral guard says a cold cache mutates nothing —
   so for 3/4 of a second on a large file, every structure-dependent action is
   silently unavailable. WI-5.6 gives that a spinner. Whether that is an
   acceptable product behaviour has not been decided, and it is the single
   biggest user-visible consequence of the whole design.

3. **How is any of this tested?**
   `pnpm check:all` runs jsdom only. A mocked message channel cannot validate
   Vite worker URLs, WebKit, CSP, module loading, termination or crash
   recovery. WI-9.2 offers "a real-browser or Tauri-runtime gate, or document
   the gap as accepted risk" — that is not a decision, it is two decisions with
   an "or" between them. WI-5.3 additionally demands a Level-3 out-of-order
   commit test with a real worker, which the current CI tier cannot host.

4. **Does the deletion in WI-8.2 survive contact with Phase 1?**
   The five grammars slated for deletion include `shared/lineContent.ts` and
   `shared/blockSpan.ts` — both written and hardened in this same branch, with
   CommonMark-correct fence pairing that took several audit rounds. Deleting
   them is right only if the index genuinely subsumes them. That is an
   assertion about a component that does not exist.

5. **What does Phase 1 change underneath all this?**
   Phase 1 is rewriting the store's content API (`setEditorContent`,
   `ingestExternalContent`, the dual-snapshot save contract). Phases 4–9 assume
   the pre-Phase-1 shape. Re-planning them before Phase 1 lands is work that
   gets thrown away.

## What a design spike must produce

Per `.claude/rules/60-ai-governance.md` §7 — a spike validates an unverified
assumption with a runnable probe *before* any phase commits. WI-0.1 was that
for the worker; this needs its own, under `dev-docs/grills/source-structure/`:

- [ ] An index encoding with a **measured** size for the 1.26 MiB corpus
      document, under a budget stated as a number and justified.
- [ ] A measured incremental-reparse cost, if incremental parsing is on the
      table — because if a 720 ms full parse per revision is the only option,
      the tiering story changes shape entirely.
- [ ] A decision on the CI tier, with the cost of standing one up. "Accepted
      risk" is a legitimate answer; leaving it ambiguous is not.
- [ ] A written statement of what the user sees while the structure is cold,
      approved as product behaviour rather than inferred from the mechanism.

Only after those does this material become work items again.

## Prior art in this repo

- `.claude/tdd-guardian/plan-20260731-113906.md` — Phase 0's WI-0.1 holds the
  measurements above, including the CSP finding and the note that the **dev
  runtime cannot answer the CSP question** and nearly gave a false pass.
- `dev-docs/plans/20260731-crlf-and-source-block-model.md` (maintainer-local) —
  the architecture doc these phases were derived from, including the rejected
  CodeMirror-syntax-tree approach and why.
- Decisions D3 (three text domains), D4 (normalised semantic projection, not
  tree equality) and D5 (Source-only; no Markdown↔ProseMirror position map)
  from the plan apply to this work and are not re-litigated here.

---

# The work items as drafted

Preserved **verbatim** from plan revision 2 so nothing is lost. They are not
executable in this state — see the questions above. Line-number citations in
the text below are from revision 2 and were never verified against the code;
the Phase-1 corrections pass found roughly one factual error per work item in
the part of the plan that *was* checked, so assume the same rate here.

## Phase 4 — Structure index

### WI-4.1: Structure index schema and builder
- **Description**: Review D4-3 — rev 1's schema was too vague for destructive actions. Versioned TypeScript interfaces come **before** the RED tests.
- **Acceptance criteria**:
  - [ ] Versioned interfaces define: block taxonomy, **range inclusivity** (half-open, over `canonicalEditorText`), document-root membership, nested containers, blank-line separators, malformed constructs, overlapping containers.
  - [ ] Worked fixture examples for frontmatter, details, nested lists, malformed fences and blank positions accompany the interfaces.
  - [ ] `structuredClone`-safe, frozen on the UI side, no MDAST references, no functions, no cycles.
  - [ ] Pure function of `(mdast, canonicalEditorText)`.
  - [ ] Index size for a 1 MiB document is under a **stated byte budget** measured in the WI-0.1 spike.
- **Required tests**:
  - **[RED]** exact index shape per fixture against hand-written expectations (an independent oracle, not the builder's own output) — Level 1
  - `structuredClone` round-trip equality — Level 1
  - Immutability; no-MDAST import gate — Level 1
  - Empty document → valid empty index, not `null` — Level 1

### WI-4.2: Third projection — index conformance
- **Description**: The half of rev 1's WI-3.2 that depends on the index. Splitting it is review D1-4's fix.
- **Acceptance criteria**:
  - [ ] Index projection agrees with the `document` semantic projection over the full corpus.
  - [ ] Index offsets are verified against `canonicalEditorText`, never `rawDiskText`.
- **Required tests**:
  - **[RED]** three-way agreement — Level 1

---

## Phase 5 — Worker, scheduling, deferral, and the large-file gate

Review D3-5: rev 1's WI-5.1 and WI-5.3 each bundled identity capture, cache,
lifecycle, scheduling, retry, seven guards, timers, UI and dispatch into one
unit — high cyclomatic complexity on a correctness-critical path, and each would
have breached the ~300-line file gate. Split into six.

### WI-5.1: Structure state machine (pure)
- **Acceptance criteria**:
  - [ ] A pure reducer over `StructureStatus = "ready" | "stale" | "parsing" | "unsupported-size" | "failed"` with a **complete transition table** (review D4-5: rev 1 named the states but never their transitions).
  - [ ] Every state reachable; every illegal transition rejected.
- **Required tests**:
  - **[RED]** full transition-table test — the reducer does not exist — Level 1

### WI-5.2: Revision cache with bounded retention
- **Description**: Review D2-3 — revision is part of the key, so keying without eviction leaks one MDAST/index **per edit**.
- **Acceptance criteria**:
  - [ ] **One-latest-revision retention per view identity**; bounded overall.
  - [ ] Eviction on tab close, window close, tab transfer, mode change, app shutdown.
  - [ ] Two windows / tabs / view instances never share an entry.
- **Required tests**:
  - **[RED]** N sequential edits retain exactly one entry per identity — Level 4
  - Each lifecycle event evicts — Level 4

### WI-5.3: Worker transport and ownership
- **Description**: Review D3-3 — "exactly one live request" is not implementable by dropping replies alone: a synchronous remark parse cannot be cancelled except by terminating the worker.
- **Acceptance criteria**:
  - [ ] "Live" is **defined**: queued / executing / eligible-to-commit are distinct, and the guarantee is **one committable result**, not one executing parse.
  - [ ] One shared worker with per-identity latest-wins queues; ownership model written down.
  - [ ] Crash → `failed` → next request recovers; termination leaks nothing.
- **Required tests**:
  - **[RED]** out-of-order replies: an older revision's result arriving after a newer one is **not committed** — Level 3 (real worker or real MessageChannel, not a call-count mock)
  - Keystroke storm → one committable result — Level 4

### WI-5.4: Tiered scheduling
- **Description**: Review D3-4 — **reuse `src/utils/fileSizeThresholds.ts`**, which already defines `SOURCE_MODE_DEFAULT_BYTES` (1 MiB), `WARN_BEFORE_OPEN_BYTES` (5 MiB) and `HARD_REFUSE_BYTES` (50 MiB). Rev 1 would have duplicated all three. Those are **byte** counts from filesystem metadata; the worker holds a JS string, and UTF-16 `.length` gives wrong boundaries for CJK and emoji.
- **Acceptance criteria**:
  - [ ] Thresholds imported, not redeclared.
  - [ ] Byte semantics defined: either carry source byte length in document state or compute UTF-8 size deliberately.
  - [ ] Debounce timings injectable for fake timers.
- **Required tests**:
  - **[RED]** a CJK document whose UTF-16 length is under 1 MiB but UTF-8 size is over it lands in the correct tier — fails under a naive `.length` — Level 1
  - Boundary matrix at each threshold ±1 — Level 1
  - 3 s cold-command timeout: document **byte-identical** before and after — Level 1

### WI-5.5: Exact-revision command deferral guard
- **Acceptance criteria**:
  - [ ] Seven guards (tab, view, epoch, revision, selection, read-only, IME), each with its own abandonment test.
  - [ ] Multi-range selections compared **in full**, not by count or first range.
  - [ ] No heuristic fallback path exists — asserted structurally.
- **Required tests**:
  - **[RED]** seven abandonment tests, document byte-identical each time — Level 1
  - Changing only the third of three ranges abandons — Level 1
  - Permanently cold cache mutates nothing, ever — Level 1

### WI-5.6: Structure status UI
- **Description**: Review D2-4 — rev 1 called these states "user-visible" but had no UI work item and no component test; it tested timers and i18n key presence, not whether a user sees an accessible status or whether it clears.
- **Acceptance criteria**:
  - [ ] Observable DOM/ARIA for delayed-busy (>100 ms), timeout, unsupported-size, failure, recovery.
  - [ ] Status clears on tab/view change; nothing is left stuck.
  - [ ] Strings are i18n keys in all locales.
- **Required tests**:
  - **[RED]** busy indicator absent at 99 ms, present at 101 ms, **queried by ARIA role** — Level 5 (component)
  - Each terminal state renders and clears — Level 5

### WI-5.7: Large-file refusal gate lands with the dispatcher
- **Description**: Review D5-5 — rev 1 deferred this to Phase 9, so structural actions could merge and silently mutate ≥5 MiB documents in the meantime.
- **Acceptance criteria**:
  - [ ] Manifest-driven: every structure-dependent action refused at `>=5 MiB`, every textual action available.
  - [ ] No structural action mutates a document at that tier.
- **Required tests**:
  - **[RED]** manifest-driven sweep — Level 1

---

## Phase 6 — Lint on the worker MDAST

### WI-6.1: Move the Markdown lint parse off the UI thread
- **Description**: `runActiveLint.ts:92` calls `runLintForFormat` **synchronously** (~400 ms at 10K lines). Review D3-7: `runActiveLint` dispatches Markdown, YAML **and** link checking through a format registry — rev 1 specified only Markdown.
- **Acceptance criteria**:
  - [ ] The worker contract is **scoped to Markdown**; YAML and link-check behaviour at every size tier is documented and tested, not left ambiguous.
  - [ ] Markdown diagnostics byte-identical to today over the corpus.
  - [ ] One worker parse serves both structure and lint for a revision.
  - [ ] Lint "unavailable" at `>=5 MiB` stays distinguishable from "no problems found".
- **Required tests**:
  - **[CHAR]** full-corpus diagnostic equality captured before the change
  - **[RED]** the lint entry point performs no synchronous parse (call-graph assertion) — fails today — Level 1
  - YAML and link-check behaviour per tier — Level 1
  - Stale diagnostics dropped — Level 4

---

## Phase 7 — Migrate actions and context

Review D5-3: rev 1 migrated destructive actions **before** cursor/context
resolution, while dispatch still builds heuristic cursor and multi-selection
context — so migrated actions could still be wrongly refused or scoped. Order
reversed.

### WI-7.1: Cursor and selection context from the index
- **Acceptance criteria**:
  - [ ] Context at every offset matches **independently written** expected fixtures (review D4-5: "matches index-derived truth" was tautological).
  - [ ] Correct inside frontmatter, math, details, alerts.
  - [ ] Lookup is binary-search over sorted block ranges — asserted structurally, plus a calibrated benchmark ceiling rather than a bare "O(log n)".
- **Required tests**:
  - **[RED]** exhaustive offset sweep against hand-written expectations — Level 1
  - Stale-index guard — Level 4

### WI-7.2: Destructive block actions read the index
- **Acceptance criteria**:
  - [ ] Scope comes from WI-2.3's migration manifest.
  - [ ] Frontmatter / details / math / alert targeting affects exactly one logical block — the measured Lezer failures as regression tests.
  - [ ] **Phase 3 fixtures return to zero parity divergence** — this is where WI-3.3's DoD lands.
  - [ ] Cold cache defers; undo restores byte-exactly.
- **Required tests**:
  - **[RED]** document-start frontmatter: an action at offset 0 does not corrupt the fence — Level 1
  - Per-action, per-fixture equality across both surfaces — Level 1
  - Selection spanning a block boundary / frontmatter into body / inside a fence — Level 1

---

## Phase 8 — Delete the duplicate grammars

### WI-8.1: Migrate remaining semantic queries
- **Acceptance criteria**:
  - [ ] Scope from the WI-2.3 manifest; zero production callers left on the five grammars.
- **Required tests**:
  - **[RED]** caller-count gate — Level 1

### WI-8.2: Delete five grammars; one delimiter veto
- **Description**: Delete `shared/lineContent.ts`, `sourceContextDetection/codeFenceDetection.ts`, `toolbarActions/multiSelectionContext.ts`, `shared/blockSpan.ts`, `utils/sourceSelection.ts`.
- **Acceptance criteria**:
  - [ ] The surviving veto's **type** makes returning a range impossible.
  - [ ] "Uncertain" is **defined** (review D4-5): no complete tree, or a fence whose closing delimiter is absent — enumerated, not adjectival.
  - [ ] Lezer barred from mutation paths by an import gate.
  - [ ] Rev 1's "nothing reimplemented elsewhere" is replaced by that gate — it was unprovable as written.
- **Required tests**:
  - **[RED]** deletion gate: the five paths do not exist — Level 1
  - Veto refuses each enumerated uncertainty case — Level 1
  - Lezer-boundary gate — Level 1

---

## Phase 9 — Release gates and docs

### WI-9.1: Re-run the complete release matrix
- **Description**: Narrowed — the ≥5 MiB gate now lands in WI-5.7. This item only re-runs everything together.
- **Acceptance criteria**:
  - [ ] Parity, fidelity, reference conformance, two- and three-projection conformance, large-file and structure gates all green together.
- **Required tests**: full matrix — Level 3

### WI-9.2: Worker CI coverage and documentation sync
- **Description**: Review D2-6 — `check:all` runs **jsdom only**; a mocked message channel cannot validate Vite worker URLs, WebKit, CSP, module loading, termination or crash. The WI-0.1 spike is not a regression test.
- **Acceptance criteria**:
  - [ ] A real-browser or Tauri-runtime worker test runs in a named gate; if that is infeasible, the gap is **documented as accepted risk**, not left implicit.
  - [ ] Review D3-6: which save tests are mocked service integration and which run through the Tauri harness is stated per test; at least one real Tauri round-trip covers CRLF + BOM + `preserve`.
  - [ ] `pnpm lint:file-size` and `lint:store-coupling` green; no baseline raised.
  - [ ] `website/guide/lint.md` and `website/guide/formats.md` updated.
  - [ ] WI-linkage script exits 0.
- **Required tests**: `pnpm check:all` green — Level 3

---

