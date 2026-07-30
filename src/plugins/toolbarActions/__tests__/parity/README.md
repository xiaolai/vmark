# Toolbar adapters — behavioral parity harness

Asks whether a toolbar action produces **the same document** in WYSIWYG mode and
in Source mode, by running it against both real surfaces from the same markdown
and the same logical selection.

## Why the existing parity tests could not catch this

| Test | Asserts | Blind to |
|---|---|---|
| `adapterActionParity.test.ts` | both switches route the same action **names** (regex over `case "…"`) | what the two arms actually do |
| `toolbarParity.test.ts` | button enabled/active state, against **mocked** views | everything — it never invokes an adapter (`grep -c` for adapter calls returns 0) |
| this harness | the resulting **document** | — |

So the two adapters could diverge in outcome indefinitely with no gate firing,
and did: `wysiwygAdapter.ts` took fixes through 2026-07-30 while
`sourceAdapter.ts` had none since 2026-02-10.

`wysiwygAdapter.test.ts` is the other half of the problem. It stubs
`expandedToggleMark` and every node action to return `true`, so its 928 lines
verify routing and not one document outcome. **This is the WYSIWYG adapter's
first behavioral test.**

## How it works

Nothing is mocked. `surfaces.ts` boots a real Tiptap editor from the production
extension set (77 extensions) and a real CodeMirror view, and runs the action
through the actual `performWysiwygToolbarAction` / `performSourceToolbarAction`
entry points.

- **Selections are substrings, not offsets.** The surfaces hold different text —
  source mode has raw markdown (`> quoted`), WYSIWYG has the parsed document
  (`quoted`, inside a blockquote node). A plain word present in both is the one
  specification both can honour. Each case runs twice: as a range and as a
  collapsed caret, because block actions and inline actions care about different
  selection shapes.
- **Equivalence is judged on meaning**, via `docFingerprint` over each surface's
  markdown, so the two surfaces stay free to spell the same document differently.
- **One shared editor** for the suite. Booting the production composition costs
  ~100ms; per-case boots made the run 13.4s versus 2.2s shared. Undo history
  persists across cases, which is safe only because no case exercises undo/redo.
- **Layout stubs are scoped here**, not added to `src/test/setup.ts`: jsdom lacks
  `getClientRects` on `Range` and `Text`, and ProseMirror measures a `Range` when
  re-resolving a selection after a list or blockquote transform. A global stub
  would silently change what every other suite observes.

## Current standing: 12 divergences

The ledger's `12` is the **first measurement** of a surface nothing had measured,
not an allowance that grew. It ratchets down only.

| Verdict | Actions | Substance |
|---|---|---|
| `source-bug` | `heading:1`, `heading:3`, `heading:6` | `setSourceHeadingLevel` prepends `#` without stripping the existing block marker: a list item becomes `# - text`, and a blockquote becomes `# > text` — **the quote is destroyed** |
| `source-bug` | `bulletList`, `orderedList`, `taskList` | the marker is written **at the caret** instead of at the line start, so `The quick - brown fox` |
| `source-bug` | `insertDivider` | `---` inserted inline, producing a paragraph ending in three hyphens rather than a thematic break |
| `both-defensible` | `increaseHeading`, `decreaseHeading` | opposite conventions for the word: WYSIWYG walks the level DOWN (`level - 1`, "more prominent"), Source walks it UP (`level + 1`, "higher number"). From H3 the same button gives H2 in one mode and H4 in the other |
| `both-defensible` | `insertCodeBlock` | WYSIWYG converts the block to code; Source inserts a new empty fence |
| `both-defensible` | `outdent` | WYSIWYG lifts a top-level list item out of the list; Source leaves it |
| `wysiwyg-bug` | `duplicateLine` | WYSIWYG duplicates the whole **block** (two paragraphs); Source duplicates a **line**, which is what the action is named |

Note `increaseHeading`/`decreaseHeading` are one inverted convention and must be
decided together; the three `heading:N` entries share one root cause, so a single
fix retires three entries.

## Both directions ratchet

An **undeclared** divergence fails. A **declared** divergence that stops
occurring also fails, so converging a pair forces its entry's deletion instead of
leaving a false claim. Verified by mutation: deleting the `outdent` entry turns
the gate red on the specific case, and declaring a fake divergence for `bold`
turns it red with *"bold no longer diverge(s). Delete the entry."*

## Coverage

Covered: actions that mutate the document without opening a popup, touching the
clipboard, or needing a table/async context — inline marks, headings, lists,
blockquotes, dividers, code blocks, case transforms, line operations, cleanup.

Not yet covered: `link*`/`unlink`, `insertImage`/`Video`/`Audio`, `insertFootnote`,
math and diagram inserts, `insertDetails`, `insertAlert*`, table operations,
`align*`, `undo`/`redo`, `select*`/`expandSelection`, `formatCJK*`. These need
popup-store, clipboard or table-context setup. `PARITY_DIVERGENCES` may only name
actions in `ACTIONS`, so a claim about an unexercised action fails the gate rather
than sitting unverified.
