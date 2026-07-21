# Plan: Preserve blank-line runs through the WYSIWYG round trip

**Status:** DRAFT — not started. Needs Codex cross-model review (rule 60 §6:
>3 phases) before Phase 1 commits.

**Owner:** TBD · **Branch:** TBD (`feat/blank-line-preservation`)

**Origin:** User bug report — "I toggled off Collapse-multiple-spaces and
Collapse-newlines in Settings, but every save still deletes runs of >2 blank
lines." Investigation (this session) found the report's framing is wrong in an
important way, which this plan corrects.

---

## Problem statement (verified)

Saving a document in **WYSIWYG mode** collapses any run of more than one blank
line between blocks down to a single blank line. This is **structural**, not a
toggle that misfires:

- The save path is `useFileSave.ts:82 → flushActiveWysiwygNow →
  useTiptapFlush.ts:77 serializeMarkdown → adapter.ts:84 proseMirrorToMdast →
  serializer.ts:336 (remark-stringify)`.
- The blank-line information is **already gone before serialization**: on
  load/parse, `remark-parse` produces an MDAST with no node representing the
  count of blank lines between blocks. `parseMarkdownToMdast("A\n\n\n\n\nB")`
  yields two paragraphs and nothing else. remark-stringify then emits exactly
  one blank line between blocks.
- **Source mode does NOT collapse** — raw CodeMirror text is written directly
  (`SourcePane.tsx:142`), no MDAST round trip.

The two toggles the user turned off — `cjkFormatting.newlineCollapsing`
(`cjk.ts:28`) and `spaceCollapsing` (`cjk.ts:39`) — gate **only** the explicit
"Format CJK" / "Collapse Blank Lines" commands (`cjkFormatter/rules/universal.ts:38`),
which are **not in the save path**. And `markdown.preserveLineBreaks`
(`defaults.ts:97`, `EditorSettings.tsx:283`) — whose description promises "keep
multiple blank lines as-is" — only enables `remark-breaks` (soft-break →
hard-break *within* a paragraph, `parser/processorFactory.ts:87`) and is **not
read on the serialize path at all**. It is a mislabeled setting.

## Verifiable success criteria (plan level)

1. Load `A\n\n\n\n\nB`, make an unrelated WYSIWYG edit elsewhere, save →
   round-trips as `A\n\n\n\n\nB` (blank-line run preserved), when the feature is
   enabled.
2. With the feature **disabled** (default), behavior is byte-identical to today
   (regression-free): the existing serializer tests still pass unchanged.
3. Source mode behavior is untouched.
4. No misleading setting: either `preserveLineBreaks` actually does what its
   label says, or its label/description is corrected and a correctly-scoped new
   setting drives this behavior.
5. New content authored in WYSIWYG produces a sane, documented default (1 blank
   line between blocks) — no crash, no runaway blank-line growth on repeated
   round trips (idempotent: save twice → identical output).

---

## ADRs

### ADR-1 — Preserve via a position-derived block attribute (chosen)

MDAST nodes carry `position: { start: { line }, end: { line } }`. The number of
blank lines before a top-level block N is
`block[N].position.start.line - block[N-1].position.end.line - 1`. Capture that
count at parse time into a ProseMirror **block-node attribute**
(`blankLinesBefore`), thread it through the MDAST↔PM adapters, and re-emit it at
serialize time.

- **Rejected — represent blanks as empty-paragraph nodes:** PM and
  remark-stringify both collapse consecutive empty paragraphs, so this fights
  the document model and does not survive its own round trip.
- **Rejected — preserve unchanged regions verbatim (skip the round trip):**
  requires region-diffing the source against the doc; far more complex and
  fragile than an attribute.

**Consequence / risk:** every block node type in the schema must accept and
default the attribute, and BOTH adapters (`proseMirrorToMdast` and the
markdown→PM direction) plus the serializer must thread it. remark-stringify
emits one blank line regardless, so the serializer needs a post-stringify
injection step OR a custom join — Phase 0 spike decides which.

### ADR-2 — Setting semantics

Repurpose or replace the mislabeled `markdown.preserveLineBreaks`. Two options,
decided in Phase 0 after the spike:

- **(a)** Rename its label/description to describe what it actually does
  (soft-break preservation), and add a NEW setting `markdown.preserveBlankLines`
  (default **false**) that drives ADR-1.
- **(b)** Redefine `preserveLineBreaks` to ALSO preserve blank-line runs (single
  setting), accepting a semantics change for existing users.

Default **false/off** either way, so the shipped default behavior is unchanged
(success criterion 2).

### ADR-3 — v1 scope: round-trip preservation, not WYSIWYG authoring

v1 preserves blank-line runs that EXISTED in the loaded document across the
load→edit→save round trip. Authoring an arbitrary >1 blank-line run *inside*
WYSIWYG (there is no cursor position "between blocks" for extra blanks) is
deferred — it needs a dedicated affordance and is a separate UX problem. New
blocks default to 1 blank line before. This must be stated in the setting's help
text so the feature isn't oversold (the original bug was a mislabeled promise).

---

## Phase 0 — Spike + decisions (gate before Phase 1)

DoD: `scripts/check-blank-lines-phase.sh 0` asserts the spike artifacts exist
and their recorded results read PASS.

| WI | Description | Criteria |
|---|---|---|
| WI-0.1 | Spike: prototype parse→attribute→serialize for a representative doc covering paragraph, heading, list, blockquote, code block, table, thematic break. Confirm MDAST `position` gaps are reliable across all block types (incl. after fenced code and lists). Record failures. | SC1 |
| WI-0.2 | Spike: determine the serialize-side injection mechanism — custom `join` in remark-stringify vs. post-stringify text pass keyed off the attribute. Prove idempotency (save twice → identical). | SC5 |
| WI-0.3 | Decide ADR-2 (a vs b). Record in this plan. Enumerate every block node type in the schema that needs the `blankLinesBefore` attribute. | ADR-2 |
| WI-0.4 | Create `scripts/check-blank-lines-phase.sh` (template `check-gha-phase.sh`) with Phase 0/1/2 assertions. | — |
| WI-0.5 | Codex cross-model review of this plan (rule 60 §6). Record disposition table. | rule 60 §6 |

## Phase 1 — Capture + serialize (feature-flagged, default off)

Build order: schema attr → parse capture → serialize emit → wire the setting →
tests. Vertical slice (`A\n\n\n\n\nB` round trip) before broad block coverage.

| WI | Description | Traceability |
|---|---|---|
| WI-1.1 | Add `blankLinesBefore` attribute (default `1`, clamped to a sane max) to every block node type identified in WI-0.3. Type-only + schema tests. | ADR-1 |
| WI-1.2 | Parse capture: in the markdown→PM adapter, compute the blank-line gap from MDAST `position` and set `blankLinesBefore` on each block. Gated on the setting (off → always default). Table-driven tests per block type. | ADR-1, SC1 |
| WI-1.3 | Serialize emit: in `proseMirrorToMdast`/serializer, emit `blankLinesBefore` blank lines before each block via the WI-0.2 mechanism. Idempotency test (save twice). Gated on the setting (off → today's output byte-identical). | ADR-1, SC2, SC5 |
| WI-1.4 | Regression guard: with the flag off, the full existing serializer/parser test suite passes unchanged; add an explicit "flag off = legacy output" test. | SC2 |

## Phase 2 — Setting, UX honesty, docs

| WI | Description | Traceability |
|---|---|---|
| WI-2.1 | Implement ADR-2 decision: correct `preserveLineBreaks` label/description and/or add `markdown.preserveBlankLines` with accurate help text stating v1 scope (round-trip preservation, not authoring). i18n keys in all locales. | SC4, ADR-3 |
| WI-2.2 | Settings UI wiring (`EditorSettings.tsx`), no store destructuring (selectors). Behavior test. | SC4 |
| WI-2.3 | Docs: `website/guide/settings.md` + `website/guide/features.md` describing the setting and its v1 scope; `dev-docs/README.md` link to this plan. | rule 21 |

## Open questions

- **OQ-1:** Does WYSIWYG editing invalidate captured `blankLinesBefore` on
  blocks adjacent to an edit? (e.g. splitting a paragraph.) Decide default
  propagation rules in WI-1.2.
- **OQ-2:** Clamp value for `blankLinesBefore` (protect against a pathological
  1000-blank-line file). Propose max 10, recorded in WI-1.1.
- **OQ-3:** Interaction with the CJK "Collapse Blank Lines" command — that
  command should still collapse on demand regardless of this setting (it is an
  explicit user action). Confirm no conflict.

## Risks

- **R1 (high):** Editor-core change touching the schema + both adapters + the
  serializer. Broad blast radius. Mitigated by the default-off flag and the
  Phase 1 regression guard (SC2).
- **R2 (med):** MDAST `position` data may be unreliable after certain
  constructs (nested lists, HTML blocks). WI-0.1 spike de-risks; any block type
  that fails falls back to the default.
- **R3 (low):** Non-idempotent serialization causing blank-line growth on
  repeated saves. WI-0.2 + WI-1.3 idempotency tests guard it.
