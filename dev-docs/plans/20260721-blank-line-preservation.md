# Plan: Preserve blank-line runs through the WYSIWYG round trip

**Status:** DRAFT — Codex-reviewed (NEEDS AMENDMENT → amended below; disposition
table records every finding). Still needs a re-read of the amended Phase 0 spike
results before Phase 1 commits.

**Owner:** TBD · **Branch:** TBD (`feat/blank-line-preservation`)

**Origin:** User bug report — "I toggled off Collapse-multiple-spaces and
Collapse-newlines in Settings, but every save still deletes runs of >2 blank
lines." Investigation (this session) found the report's framing is wrong in an
important way, which this plan corrects.

---

## Problem statement (verified, corrected per Codex F-01/F-02/F-04)

In **WYSIWYG mode**, any run of more than one blank line between blocks collapses
to a single blank line. This is **structural**, not a misfiring toggle.

- **Where the loss actually happens (F-01):** the parser preserves MDAST
  positional data (`markdownPipeline/parser.ts:69`), and gaps are visible there.
  The loss is in the **MDAST→PM→MDAST adapter**: PM nodes carry only a
  `sourceLine` (`mdastBlockConverters.ts:55`), and the back-conversion builds
  **new, positionless** MDAST nodes (`proseMirrorToMdast.ts:95`,
  `pmBlockConverters.ts:62`). So the fix is in the adapter/serializer, not the
  parser.
- **The trigger is broader than Save (F-02):** every WYSIWYG update schedules a
  debounced PM→Markdown serialization (`TiptapEditor.tsx:267`); manual save just
  forces that flush (`useTiptapFlush.ts:70`). Autosave, unmount flush, and store
  sync all hit the same path. **Source mode writes raw text directly**
  (`SourceEditor.tsx:146`) and never round-trips.
- The two toggles the user turned off — `cjkFormatting.newlineCollapsing`
  (`cjk.ts:28`) and `spaceCollapsing` (`cjk.ts:39`) — gate **only** the explicit
  CJK formatting rules (`cjkFormatter/rules/applyRules.ts:140`), not the flush
  path. (The dedicated "Collapse Blank Lines" command deliberately bypasses even
  those settings — `wysiwygAdapterCjk.ts:120` — and must stay working; see
  WI-2.x tests.)
- `markdown.preserveLineBreaks` is **passed to the serializer but not read there**
  (`adapter.ts:84`, `serializer.ts:336` only consult `hardBreakStyle`); it only
  toggles `remarkBreaks` at parse (`processorFactory.ts:47`), i.e. paragraph-
  internal soft→hard breaks. It is mislabeled.

## Verifiable success criteria (plan level)

1. Load `A\n\n\n\n\nB`, make an unrelated WYSIWYG edit, let it serialize →
   round-trips as `A\n\n\n\n\nB`, when the feature is enabled.
2. Feature **disabled** (default) → byte-identical to today; the existing
   serializer/parser suites pass unchanged.
3. Source mode untouched.
4. No misleading setting (label/help corrected; a correctly-scoped setting drives
   the behavior).
5. **Idempotent and non-corrupting:** save twice → identical output; **tight
   lists stay tight** (no spurious blank lines inside lists — Codex F-05).
6. Edit operations (split/join/paste/convert) do not duplicate a captured
   blank-line run (Codex F-11).

---

## ADRs (amended per Codex review)

### ADR-1 — Position-derived block attribute, **nullable / inherit** default (was: default 1)

Capture the inter-block blank-line count from MDAST positions into a PM block
attribute `blankLinesBefore`. **Default `null` = "inherit the serializer's
normal join"**, NOT `1`. Codex F-05: `mdast-util-to-markdown` emits **0**
separating blank lines for tight-list children and **1** for spread children;
a universal `1` would loosen every tight list. So: capture an explicit `0..N`
**only** for parsed source nodes with reliable positions; emit a custom join
**only** when the attribute is a number AND the feature is enabled; otherwise
return no custom result and let the serializer's default join stand.

- **Rejected — empty-paragraph nodes:** collapse on their own round trip.
- **Rejected — post-stringify text pass (Codex F-10):** custom converters
  synthesize/reshape nodes (alerts add a marker paragraph `pmBlockConverters.ts:111`;
  media promote to paragraph/HTML), so a text rewrite can't reliably locate
  block boundaries. Use a **metadata-driven custom `join`** instead
  (`mdast-util-to-markdown` join returns the number of blank lines —
  `types.d.ts:509`; serializer already passes options — `serializer.ts:54`).

### ADR-1a — Serializer enablement without mutable cached state (Codex F-10)

The serializer is **statically cached** (`serializer.ts:50,84`), so a `join`
callback must NOT close over a per-call setting. Enablement is expressed in the
DATA: when disabled, `blankLinesBefore` is simply absent/null on the nodes, so
the join returns its default. No per-call serializer variants, no mutable global.

### ADR-2 — Setting semantics

Correct `markdown.preserveLineBreaks`'s label/description (it does soft→hard
break conversion) and add `markdown.preserveBlankLines` (default **false**)
driving ADR-1. Help text states the v1 scope (round-trip preservation, not
authoring; inter-block only — see ADR-5).

### ADR-3 — v1 scope

v1 preserves blank-line runs that EXISTED between blocks in the loaded document,
across load→edit→serialize. **Excludes** leading/trailing document whitespace
(Codex F-14: the inter-block model has no join boundary there) and authoring new
runs inside WYSIWYG. New blocks get `null` (inherit). Cap captured runs at a
disclosed maximum (**ADR-6**).

### ADR-4 — Capture unconditionally, gate only serialization (Codex F-12)

Do NOT gate metadata **capture** on the setting. Content sync reacts only to
`content`/`editor`, not setting changes (`useTiptapContentSync.ts:54`), so if a
doc is parsed while disabled, the gaps are gone from PM and toggling on later
can't recover them. Therefore: **always capture** `blankLinesBefore` at parse;
gate only whether the serializer **emits** it. Toggling the setting then needs no
reparse.

### ADR-5 — Edit propagation (Codex F-11 — must be resolved, not deferred)

PM's mid-block split copies node attributes to BOTH halves
(`prosemirror-transform structure.ts:213`); a paragraph with `blankLinesBefore=4`
would give the new second paragraph `4` too → four spurious blank lines. Rule:
**`blankLinesBefore` is cleared to `null` on any node created by an edit**
(split, paste, block conversion, list-item split). Only nodes that came directly
from a parse retain a captured value. Implemented via an appended ProseMirror
step/appendTransaction that nulls the attribute on newly-created blocks. Behavior
enumerated for split-at-start/middle/end, join/backspace, lift/sink, convert,
move, paste, undo/redo (WI-1.5).

### ADR-6 — Max-run cap + whitespace scope

Cap `blankLinesBefore` at **10** (disclosed in help text; runs >10 clamp to 10).
Leading/trailing document whitespace is out of scope for v1 (ADR-3).

---

## Phase 0 — Spike + decisions (gate before Phase 1)

DoD: `scripts/check-blank-lines-phase.sh 0` asserts the spike artifacts exist and
their recorded results read PASS. Spikes must cover the **non-trivial** node
classes, not just paragraphs.

| WI | Description | Traceability |
|---|---|---|
| WI-0.1 | Spike: parse→attribute→serialize for paragraph, heading, blockquote, code, table, thematic break. Confirm MDAST position gaps + the custom-`join` emit path round-trip. | SC1, F-10 |
| WI-0.2 | Spike: **list normalization** (Codex F-07) — the parser inserts a *synthetic* blank line before bare nested-list markers (`listNormalization.ts:54`). Prove capture does NOT preserve the synthetic line (original-source offset mapping OR a normalization-aware rule). Include tight vs. spread lists (F-05). | SC5, F-05, F-07 |
| WI-0.3 | Spike: **`<details>`** (Codex F-06) — the plugin synthesizes positionless `details` nodes and reparses the body (`detailsBlock.ts:97,214`), with hardcoded separators (`:244`). Decide: map original offsets through, or explicitly scope-out gaps inside `<details>`. | F-06 |
| WI-0.4 | **MDAST↔PM mapping matrix** (Codex F-09): enumerate every block mapping incl. non-1:1 — math sentinel `codeBlock` (`pmBlockConverters.ts:73`), media promoted to paragraph/HTML (`:267`), alert synthetic marker paragraph (`:111`), frontmatter, definitions, footnotes, TOC. For each: can `blankLinesBefore` attach, and where. Prototype the custom-handler nodes here, not after. | F-09 |
| WI-0.5 | Idempotency proof: save twice → identical for every class above. | SC5 |
| WI-0.6 | Create `scripts/check-blank-lines-phase.sh` (template `check-gha-phase.sh`) with Phase 0/1/2 assertions incl. WI-linkage + `pnpm check:all`. | F-15 |
| WI-0.7 | Record ADR-2 label decision; update this plan; **Codex re-review of the amended plan** if Phase 0 changes any ADR. | rule 60 §6 |

## Phase 1 — Capture + serialize (RED→GREEN, feature-flagged, default off)

**Test-first (Codex F-15):** each behavioral WI is written RED (failing test)
→ GREEN (minimal impl). DoD: `check-blank-lines-phase.sh 1` = targeted tests
green + WI-linkage + `pnpm check:all`.

| WI | Description | Traceability |
|---|---|---|
| WI-1.1 | Add nullable `blankLinesBefore` attr (default `null`, clamp 0..10) to the block nodes from WI-0.4, reusing the `sourceLine` extension pattern (`sourceLineAttr.ts:8`). **Update the reduced pipeline `testSchema.ts:3`** to carry the attr. Schema tests. | ADR-1, F-08, F-15 |
| WI-1.2 | Parse capture (RED first): set `blankLinesBefore` from MDAST position gaps in the MDAST→PM adapter, normalization-aware (WI-0.2) and skipping details-internal (WI-0.3). **Unconditional** (ADR-4). Table-driven per node class. | ADR-1, ADR-4, SC1 |
| WI-1.3 | Serialize emit (RED first): metadata-driven custom `join` emitting `blankLinesBefore` when present AND the setting is on; no mutable cached state (ADR-1a). Idempotency test. Flag-off ⇒ legacy output byte-identical. | ADR-1, ADR-1a, SC2, SC5 |
| WI-1.4 | Tight-list guard (RED first): tight lists stay tight; spread lists keep one blank line; a doc mixing both round-trips unchanged. | SC5, F-05 |
| WI-1.5 | Edit-propagation (RED first): appendTransaction nulls `blankLinesBefore` on edit-created blocks; tests for split(start/mid/end), join/backspace, convert, list-item split, paste, undo/redo. | ADR-5, SC6, F-11 |
| WI-1.6 | Regression guard: flag off → full existing parser/serializer suites pass unchanged; explicit "flag off = legacy" test. | SC2 |

## Phase 2 — Setting, caller coverage, docs

| WI | Description | Traceability |
|---|---|---|
| WI-2.1 | ADR-2: correct `preserveLineBreaks` help; add `markdown.preserveBlankLines` (help states v1 scope + cap). i18n all locales. Settings UI (selectors, no destructuring). | SC4, ADR-3, ADR-6 |
| WI-2.2 | **Pipeline caller inventory + integration tests (Codex F-13):** the round trip runs from more than save — full-doc CJK format/collapse (`wysiwygAdapterUtils.ts:73`), markdown paste (`markdownPaste/tiptap.ts:186`), HTML paste (`htmlPaste/tiptap.ts:105`), source peek (`sourcePeekActions.ts:47`), autosave (`useAutoSave.ts:72`), external reload (`reloadFromDisk.ts:21`), MCP document edits, source↔WYSIWYG switching, split/keep-alive modes, unmount flush. Test each preserves-or-ignores correctly. | F-13, F-03 |
| WI-2.3 | Docs: `website/guide/settings.md` + `features.md` (behavior + v1 scope); README link (already present — update the entry). | rule 21 |
| WI-2.4 | Phase 2 DoD in `check-blank-lines-phase.sh 2`. | F-15 |

---

## Cross-model review (rule 60 §6) — Codex disposition

Reviewer: `gpt-5.6-sol` (high effort, read-only, verified against the codebase).
Verdict: **NEEDS AMENDMENT** → amended above.

| Codex | Sev | Disposition |
|---|---|---|
| F-01 | MAJOR | Accepted — root cause rewritten: loss is in the MDAST→PM→MDAST adapter, not the parser. |
| F-02 | MINOR | Accepted — trigger broadened to all WYSIWYG serialization (debounce/autosave/unmount/save). |
| F-03 | CONFIRM | Accepted — the unconditional "Collapse Blank Lines" command called out as a separate tested interaction (WI-2.2). |
| F-04 | CONFIRM | Accepted — `preserveLineBreaks` re-described as "passed but not read by serializer". |
| F-05 | MAJOR | Accepted — default changed `1`→`null`/inherit; tight-list guard WI-1.4. |
| F-06 | MAJOR | Accepted — `<details>` spike WI-0.3. |
| F-07 | MAJOR | Accepted — list-normalization synthetic-blank spike WI-0.2. |
| F-08 | CONFIRM | Accepted — reuse `sourceLine` extension pattern; update `testSchema.ts` (WI-1.1). |
| F-09 | MAJOR | Accepted — MDAST↔PM mapping matrix WI-0.4 (math/media/alert/etc.). |
| F-10 | CONFIRM | Accepted — metadata-driven custom `join`, no cached-state closure (ADR-1a). |
| F-11 | MAJOR | Accepted — edit propagation resolved (ADR-5, WI-1.5), not deferred. |
| F-12 | MAJOR | Accepted — capture unconditionally, gate only serialization (ADR-4). |
| F-13 | MAJOR | Accepted — pipeline caller inventory + integration tests (WI-2.2). |
| F-14 | MINOR | Accepted — cap 10 disclosed; leading/trailing whitespace out of scope (ADR-6). |
| F-15 | MAJOR | Accepted — Phase 1 rewritten RED→GREEN; machine-checkable DoDs added; `testSchema.ts` update. |

## Risks

- **R1 (high):** Editor-core change across schema + adapter + serializer. Mitigated
  by default-off flag + WI-1.6 regression guard.
- **R2 (high — Codex):** Corruption via wrong default/propagation (loose tight
  lists, duplicated runs on split). Mitigated by ADR-1 null default, ADR-5, WI-1.4/1.5.
- **R3 (med — Codex):** Untrustworthy positions after normalization / in
  `<details>`. Mitigated by WI-0.2/0.3 spikes (fall back to inherit).
