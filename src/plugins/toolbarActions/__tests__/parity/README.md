# Toolbar adapters — behavioral parity harness

Asks whether a toolbar action produces **the same document** in WYSIWYG mode and
in Source mode, by running it against both real surfaces from the same markdown
and the same logical selection.

## Why the existing parity tests could not catch this

| Test | Asserts | Blind to |
|---|---|---|
| `adapterActionParity.test.ts` | both switches route the same action **names** (regex over `case "…"`) | what the two arms actually do |
| `toolbarParity.test.ts` | button enabled/active state, against **mocked** views | everything — it never invokes an adapter (`grep -c` for adapter calls returns 0) |
| this harness | the resulting **document** | selection-only outcomes, toolbar state |

So the two adapters could diverge in outcome indefinitely with no gate firing,
and did: `wysiwygAdapter.ts` took fixes through 2026-07-30 while
`sourceAdapter.ts` had none since 2026-02-10.

`wysiwygAdapter.test.ts` is the other half of the problem. It stubs
`expandedToggleMark` and every node action to return `true`, so its 928 lines
verify routing and not one document outcome. **This is the WYSIWYG adapter's
first behavioral test.**

## Layout

| File | Role |
|---|---|
| `surfaces.ts` | boots a real Tiptap editor (production extensions) and a real CodeMirror view; runs an action through the real adapter entry points |
| `parityFixtures.ts` | the documents, the compared action set, and the excused remainder with reasons |
| `parityLedger.ts` | known divergences, grouped by root cause, with verdicts |
| `behavioralParity.test.ts` | the outcome gate |
| `coverageContract.test.ts` | derives the real shared vocabulary from the adapter sources and enforces the coverage partition |

## How it works

Nothing is mocked.

- **Selections are substrings, not offsets.** The surfaces hold different text —
  source mode has raw markdown (`> quoted`), WYSIWYG has the parsed document
  (`quoted`, inside a blockquote node). A plain word present in both is the one
  specification both can honour. Every case runs twice, as a range and as a
  collapsed caret, because block and inline actions care about different shapes.
- **Equivalence is judged on meaning**, via `docFingerprint` over each surface's
  markdown, so the surfaces stay free to spell one document differently.
- **One shared editor** for the suite; booting the production composition costs
  ~100ms. The result matrix is computed once at module load so the per-case
  assertions and the staleness check cannot disagree about a cell. Undo history
  persists across cases, which is why `undo`/`redo` are excused rather than
  covered.
- **Layout stubs are scoped here**, not added to `src/test/setup.ts`: jsdom lacks
  `getClientRects` on `Range` and `Text`, and ProseMirror measures a `Range` when
  re-resolving a selection after a list or blockquote transform. A global stub
  would silently change what every other suite observes.

## Coverage is a checked fact, not a claim

`coverageContract.test.ts` extracts the `case "…"` labels from both adapter
sources — the same technique `adapterActionParity.test.ts` uses — and asserts
that every one of the **83 shared actions** is either compared or excused with a
structural reason, that no excuse names a covered or non-existent action, and
that the per-surface exclusives match reality. A newly added action that lands in
neither list fails the gate.

**64 of 83 compared; 19 excused.** The excused set is structural, not
convenience: selection-only actions (`selectWord`/`selectLine`/`selectBlock`/
`expandSelection`) change no document, so a document-outcome gate cannot tell
agreement from mutual no-op; `undo`/`redo` need per-case history isolation;
thirteen popup-driven actions (`link*`, media, math, diagram, footnote inserts)
complete asynchronously through a store. `MAX_UNCOVERED_ACTIONS` ratchets down.

An excuse is a claim about the code, and claims rot. `formatCJKFile` was excused
as "a whole-FILE operation routed through persistence, not a buffer edit" — which
was simply false: both adapters call `formatMarkdown` on the open buffer and
neither touches the filesystem. Covering it cost nothing and it agrees on all 18
cases. Re-read an excuse before trusting it.

## Current standing: ZERO divergences

Every one of the 64 compared actions produces the same document in both
surfaces, across all nine fixtures and both selection shapes. It started at
**31 declared divergences across 9 root causes**.

`MAX_PARITY_DIVERGENCES` is now **0**, which is the point of the mechanism
rather than the end of it: the next divergence cannot be declared away. It has
to be fixed, or the ceiling raised in a commit that argues for it.

### What actually closed them

Almost none of it was per-action patching. Neither surface had ever *chosen*
how far an action reaches — each inherited whatever its substrate made
convenient, ProseMirror addressing the enclosing node and CodeMirror the
selected characters. Writing that rule down retired most of the ledger:

> A block-level action operates on **the whole top-level blocks the selection
> touches** — never a fragment of one, never a single item of a structure.

| Shared module | Decides |
|---|---|
| `shared/blockTemplates` | what a new block contains |
| `shared/blockSpan` | how far a block action reaches (line side) |
| `shared/wrapBlocks` | the same rule, node side |
| `shared/lineContent` | which characters are markup and which are content |

The remaining fixes were each a surface disagreeing with **itself**: WYSIWYG's
range path converted the whole outer list when one word inside a nested item was
selected, though its caret path in the same position converted only the
sub-list; its blockquote wrapped the innermost list and shattered the outer one;
source's toggle-off unlisted a nested item where its own docs said outdent.

### What this work found that the ledger had mis-described

The ledger claimed the block-insert family had nothing left in it but "template
content". Behind that sat a **data-loss bug**: selecting `brown` in
`The quick brown fox` and inserting a note produced `> [!NOTE]\n> brown` and
deleted the rest of the line, because the builders folded in the selected
CHARACTERS while the insertion replaced whole LINES. The existing "no data loss"
test selects the entire document, where those two ranges coincide, so it was
structurally incapable of seeing it.

Also behind it: source's `insert*` list actions were a second, dumber
implementation of the toggles that prepended a marker without checking for one
already there — `- - two`, `1. - two`, `- [ ] - text`.

A ledger entry is a claim. Claims rot, and this file is where they rot quietly.

## Both directions ratchet

An **undeclared** divergence fails. A **declared** divergence that stops
occurring also fails, so converging a pair forces its entry's deletion instead of
leaving a false claim. Verified by mutation in all four directions: deleting a
real entry, declaring a fake one, dropping an action from coverage without
excusing it, and excusing an action that is covered.

`MAX_PARITY_DIVERGENCES` may only **rise** in a change that also **lowers**
`MAX_UNCOVERED_ACTIONS` — that is, when newly measured ground reveals pre-existing
divergence. At fixed coverage it ratchets down only. It went 12 → 31 when coverage
went 33 → 63 and the uncovered ceiling went 50 → 20, then 31 → 18 → 8 → 0 as
root causes were fixed.

## What this gate does NOT catch

Stated so nobody reads a green run as a stronger claim than it is.

| Blind spot | Consequence |
|---|---|
| **The `accepted` return value is discarded.** Only the resulting document is compared. | Two mutual **no-ops** are indistinguishable from two correct agreeing edits. If one surface silently declines an action and the other does nothing visible, this gate passes. |
| **Selection and caret position after the action are not compared.** | A surface that produces the right document but leaves the caret somewhere useless passes. |
| **One selection per fixture** (`doc.needle`), in two shapes. | A divergence that appears only at a block boundary, across three blocks, or on an empty selection is unmeasured. |
| **Undo granularity is not compared.** | One surface may need three undos where the other needs one. |
| **62 cases are skipped, not passed** — table fixtures for actions the availability policy blocks in a cell. | That policy is asserted in `actionAvailability.test.ts`; if it were wrong, this file would not notice. |
| **Equivalence is judged on `docFingerprint`**, which strips `sourceLine` and `blankLinesBefore`. | Differences the fingerprint deliberately ignores cannot fail this gate. |

The first row is the largest one. Closing it means declaring an expected
`accepted` per action per fixture, which is a bigger contract than "same
document" — it is the natural next ratchet, not a defect in this one.
