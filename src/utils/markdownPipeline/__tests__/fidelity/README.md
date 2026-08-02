# Markdown pipeline — fidelity harness

Asks a question the other pipeline gates structurally cannot: **does opening a
document and writing it back change what the author wrote?**

The existing gates all check *stability*, never *fidelity*:

| Gate | Asserts | Blind to |
|---|---|---|
| `roundtrip.property.test.ts` | `rt(rt(x)) === rt(x)` | anything destroyed on the FIRST pass that is stable afterwards |
| `characterization/` | `rt(x)` matches a golden | whether the golden is right — it records what the pipeline *does* |
| this harness | `rt(x)` vs **the author's `x`** | — |

This matters because `useTiptapFlush` re-serializes the ProseMirror doc on every
debounced edit: whatever the pipeline changes on open is written to the user's
file the moment they type.

## The two gates

### 1. Round-trip fidelity — `roundtripFidelity.test.ts`

Per corpus document, two independent questions:

- **Semantic** — is `parse(input)` still equal to `parse(roundTrip(input))`?
  Decided by `docFingerprint`, *derived* from the parsed documents rather than
  from anyone's reading of a text diff, so a mis-named rule cannot approve
  corruption. Drift must be declared in `SEMANTIC_DEFECTS`.
- **Source** — does the emitted markdown differ from what the author wrote?
  Every difference must be explained by a named rule in `FIDELITY_LEDGER`, so
  each rewrite of a user's file is a decision on record with a stated reason.

**All 23 corpus documents are semantically stable.** Ten round-trip
byte-identical; the other thirteen differ only in spelling, each catalogued.

### 2. Reference conformance — `referenceConformance.test.ts`

The round-trip check has a blind spot *by construction*: it compares VMark's
parse of the input with VMark's parse of the output, so it cannot see a
construct the **parser** drops — both sides are equally damaged and the
round-trip looks perfectly stable.

So this gate parses the same corpus with stock `remark-parse` + `remark-gfm` —
a CommonMark/GFM baseline with none of VMark's plugins — and compares top-level
block structure. Divergences are declared with a verdict:

- `extension` — VMark sees **more** (math, frontmatter, details, TOC). Healthy.
- `defect` — VMark sees **less**. The author wrote standard markdown and VMark
  did not understand it. Ratcheted down only.

## Both ledgers ratchet in both directions

Matching the i18n, file-size and store-coupling gates: an **undeclared**
deviation fails, and a **declared entry that stops firing** also fails. Fixing
something forces its entry to be deleted rather than rotting as a false claim.
Verified by mutation: re-enabling setext parsing turns the gate red with
*"a divergence is declared, but the parses now agree. Delete the entry."*

## Current standing defect

| Verdict | Document | What breaks |
|---|---|---|
| `defect` | `23-setext-headings.md` | Setext headings (`Title` over `=====`) are not parsed as headings |

`remarkDisableSetextHeadings` disables micromark's `setextUnderline` so an empty
nested list item (`  -`) cannot misparse as a heading underline — a real
corruption it prevents. The cure was never mitigated in the other direction:
`Title\n=====` becomes a paragraph whose underline is escaped to `\=====`, and
`Title\n-----` becomes a paragraph plus a thematic break. One corruption was
closed by opening another, and only the first was measured.

Fixing it means keeping setext **on read** (special-casing the `  -` misparse)
while continuing to emit ATX **on write**. When that lands, delete the entry from
`DECLARED_DIVERGENCES`, drop `MAX_CONFORMANCE_DEFECTS` to `0`, and remove the
`setextHeadingLost` rule — the gate fails until all three are done.

## Extending

The corpus is shared with the characterization harness — one set of fixtures,
different questions. Drop a `.md` into `../characterization/corpus/`; both
harnesses discover it. A new document that round-trips cleanly needs no ledger
entry at all; silence means perfect fidelity.

For triage when populating the ledger:

```bash
VMARK_FIDELITY_REPORT=/tmp/fidelity.txt pnpm exec vitest run roundtripFidelity
```

writes every deviation — explained or not — with the rules that match it.
