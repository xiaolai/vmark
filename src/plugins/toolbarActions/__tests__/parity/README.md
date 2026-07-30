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

**63 of 83 compared; 20 excused.** The excused set is structural, not
convenience: selection-only actions (`selectWord`/`selectLine`/`selectBlock`/
`expandSelection`) change no document, so a document-outcome gate cannot tell
agreement from mutual no-op; `undo`/`redo` need per-case history isolation;
thirteen popup-driven actions (`link*`, media, math, diagram, footnote inserts)
complete asynchronously through a store; `formatCJKFile` acts on the file, not the
buffer. `MAX_UNCOVERED_ACTIONS` ratchets down.

## Current standing: 31 divergences across 9 root causes

31 entries is far fewer than 31 fixes.

| Root cause | Actions | Verdict | Substance |
|---|---|---|---|
| `source-inserts-block-at-caret` | 12 — `insertDivider`, `insertBulletList`/`OrderedList`/`TaskList`, 5× `insertAlert*`, `insertDetails`, `insertTable`, `insertTableBlock` | `source-bug` | block markdown is spliced in **at the caret**, so a divider gives `The quick ---` (a paragraph ending in hyphens), an alert splits the sentence, a table opens inside a paragraph |
| `source-list-marker-at-caret` | 3 — `bulletList`, `orderedList`, `taskList` | `source-bug` | marker at the cursor: `The quick - brown fox` |
| `source-heading-keeps-block-marker` | 3 — `heading:1/3/6` | `source-bug` | list item → `# - text`; blockquote → `# > text`, **destroying the quote** |
| `inverted-heading-direction` | 2 — `increaseHeading`, `decreaseHeading` | `both-defensible` | opposite readings of "increase". From H3 the same button gives **H2 in one mode, H4 in the other** |
| `source-line-ops-table-unaware` | 3 — `moveLineUp`/`Down`, `joinLines` | `source-bug` | rows hoisted above the `\| --- \|` delimiter, or two rows fused into one line |
| `wysiwyg-deleteline-deletes-table` | 1 — `deleteLine` | `wysiwyg-bug` | **the worst one**: caret in a table cell → the entire table is deleted, and `useTiptapFlush` persists it |
| `source-alignleft-omits-colon` | 2 — `alignLeft`, `alignAllLeft` | `source-bug` | no `:` written, so the column carries no explicit alignment (center/right agree) |
| `source-formatcjk-noop-on-range` | 1 — `formatCJK` | `source-bug` | WYSIWYG inserts CJK/Latin boundary spaces; source does nothing |
| `blockquote-in-table-unhandled` | 1 — `insertBlockquote` | `both-wrong` | WYSIWYG clears the cell text; source breaks the table. Should be disabled there — an `enableRules.ts` fix |
| independent | 3 — `duplicateLine`, `insertCodeBlock`, `outdent` | mixed | block-vs-line duplication; convert-vs-insert; outdent at the outermost level |

## Both directions ratchet

An **undeclared** divergence fails. A **declared** divergence that stops
occurring also fails, so converging a pair forces its entry's deletion instead of
leaving a false claim. Verified by mutation in all four directions: deleting a
real entry, declaring a fake one, dropping an action from coverage without
excusing it, and excusing an action that is covered.

`MAX_PARITY_DIVERGENCES` may only **rise** in a change that also **lowers**
`MAX_UNCOVERED_ACTIONS` — that is, when newly measured ground reveals pre-existing
divergence. At fixed coverage it ratchets down only. It went 12 → 31 when coverage
went 33 → 63 and the uncovered ceiling went 50 → 20.
