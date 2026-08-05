# Markdown pipeline — spec gates (exhaustive by enumeration)

Runs **every** example of the official CommonMark spec plus the GFM extension
sections through VMark's pipeline. The hand-written corpora
(`../characterization/corpus/`, `conformance/fixtures.ts`) are
representative-by-construction; these gates are exhaustive-by-enumeration — a
spec corner nobody thought to hand-write still has an example here.

Two gates share the corpus:

1. **Parse conformance** (`specConformance.test.ts`) — VMark's mdast
   deep-compared against a stock `remark-parse` + `remark-gfm` reference.
   Catches parser drift and pins every deliberate dialect divergence.
2. **Round trip** (`specRoundtrip.test.ts`) — every example through
   `markdown → ProseMirror doc → markdown`, held to two invariants:
   **stability** (the second pass must not change the first pass's output —
   an oscillation is always a real serializer bug) and **fidelity** (VMark's
   own parse of the output must match its parse of the input, by semantic
   projection). A crash is never declarable.

## Layout

| Path | Role |
|---|---|
| `corpus/commonmark-0.31.2.json` | All 652 CommonMark 0.31.2 spec examples (`cm-<n>`) |
| `corpus/gfm-extensions.json` | The GFM spec's extension-section examples: tables, task lists, strikethrough, autolinks, disallowed raw HTML (`gfm-<n>`) |
| `specDeltas.ts` | Parse-conformance ledger + `defect` ceiling (ratchets DOWN only) |
| `specRoundtripDeltas.ts` | Round-trip ledger: stability defects + fidelity verdicts (`defect` / `model-limit` / `normalization` / `policy`), ceilings ratchet DOWN only |
| `fingerprints/parse.json`, `fingerprints/roundtrip.json` | The exact divergences pinned per declared example. Generated — see `scripts/gen-spec-fingerprints.mjs` |
| `specConformance.test.ts` | Parse gate. Also runs `conformance/fixtures.ts` (`vmark-<id>`) through the same ruler |
| `specRoundtrip.test.ts` | Round-trip gate, same three corpora |

## Corpus provenance

Vendored (no network at test time), stripped to `{example, section, markdown}`
— the ruler is the reference *parser*, not the spec's HTML output.

- CommonMark: <https://spec.commonmark.org/0.31.2/spec.json>, 652 examples.
- GFM: `test/spec.txt` from <https://github.com/github/cmark-gfm>
  (0.29.0.gfm.13), extension sections only; example numbers are positions in
  that file's own enumeration. Tab placeholders (`→`) are converted back to
  real tabs.

Spec text license: CC-BY-SA 4.0. To regenerate, re-download the sources above
and re-emit the same JSON shape (a top-level `{source, version, examples}`
wrapper).

## What a failure means

- **Undeclared divergence** — behavior changed on a spec input. Either a
  regression (declare nothing; fix the pipeline) or a new deliberate behavior
  → add the id to the right ledger entry with a reason and verdict.
- **Stale declaration** — a declared example now conforms. Delete the id from
  its entry; if it counted toward a `defect` ceiling, lower the ceiling.
- **Changed divergences on a DECLARED example** — the exact set of
  divergences per declared example is pinned in `fingerprints/*.json`
  (path, kind, detail and both values, compared as an exact multiset), so a
  declaration is not a blanket licence. Review what changed, then
  regenerate with `node scripts/gen-spec-fingerprints.mjs` and read the
  diff. The fingerprint key set must match the ledger exactly — a stale pin
  or a declared-but-unpinned example fails.
- **Oscillation or crash in the round trip** — always a real bug; oscillations
  can be declared (ratcheted), crashes cannot.

Verdict meanings in the round-trip ledger:

- `defect` — fixable corruption (currently: the leading-`---` frontmatter
  trap, bracket-escape growth, entity-newline injection). Ratcheted.
- `model-limit` — the ProseMirror model cannot represent the construct
  (nested same-type emphasis, mark order around links, list looseness,
  empty-text links, link-wrapped images, code-fence `meta`). Honest,
  pinned data loss — the set cannot grow silently.
- `normalization` — the markdown changes, the rendered document does not.
- `policy` — deliberate `isSafeUrl` sanitization of unknown URL schemes to
  `about:blank`. Note: this rewrites the author's file on save; sanitizing
  at render time instead is an open design question.

## Known limits

- A node-**type** divergence compares children and the attributes BOTH
  shapes carry; keys unique to one shape stay out, since unrelated shapes
  legitimately have unrelated fields. (Skipping attributes entirely used to
  mean a declared `linkReference`→`link` flip also hid a changed `url` or
  `title` on that node.)
- The GFM corpus covers the extension *sections* only; the GFM spec's base
  examples are CommonMark 0.29 and are superseded by the 0.31.2 corpus.
- Fidelity compares mdast, which abstracts syntax: a change the renderer
  would show but mdast does not encode (none known) would pass. The
  characterization goldens remain the byte-level check for the curated
  corpus.
