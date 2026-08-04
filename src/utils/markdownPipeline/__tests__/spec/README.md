# Markdown pipeline — spec gates (exhaustive by enumeration)

Runs **every** example of the official CommonMark spec, the GFM extension
sections, and the VMark dialect manifest through the pipeline. The
hand-written corpora (`../characterization/corpus/`,
`../../conformance/fixtures.ts`) are representative-by-construction; these
gates are exhaustive-by-enumeration — a spec corner nobody thought to
hand-write still has an example here.

Two gates share one corpus registry:

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
| `corpusRegistry.ts` | THE corpus list: files, provenance, licenses, digests, per-gate routes. Both gates load only through it. |
| `corpus/commonmark-0.31.2.json` | All 652 CommonMark 0.31.2 examples (`cm-<n>`) |
| `corpus/gfm-extensions.json` | The GFM spec's extension-section examples (`gfm-<n>`, numbered by position in that file's own enumeration) |
| `specDeltas.json` | Conformance ledger — JSON so the merge-base ratchet can read it at a historical ref (ADR-5) |
| `specRoundtripDeltas.json` | Roundtrip ledger: stability records (sha-pinned pass outputs) + fidelity records with verdicts |
| `specLedgers.ts` | Typed ledger access + full-signature matching |
| `specConformance.test.ts` | Parse gate (also runs the `vmark-*` fixture manifest) |
| `specRoundtrip.test.ts` | Round-trip gate, same three corpora |
| `specTriage.dump.test.ts` | Re-triage tool: `SPEC_TRIAGE_DUMP=<path> vitest run …` dumps every observed divergence for ledger authoring; inert otherwise |
| `specTxtConverter.test.ts` | Unit tests for `scripts/vendor-spec-corpus.mjs` |

## Declarations are exact signatures, never example IDs

A ledger record pins example id, **path, kind, detail, and both observed
values**. An id-only declaration is a wildcard — once declared, any different
or larger future divergence on that example would pass silently, which is the
suppression-file decay `../../conformance/expectedDeltas.ts` documents from
experience. The gates fail in both directions: an undeclared divergence, and
a declared record that no longer matches anything (stale — fixing a defect
forces its record's deletion). Stability records pin the sha256 of BOTH
serializer passes, so any output change forces re-triage.

Records are MEASURED, not written from expectation: run the triage dump,
classify, generate. `JSON` cannot spell `undefined`, so the sentinel
`"__undefined__"` stands for it in record values (`specLedgers.reviveValue`).

## Verdicts

Conformance: `extension` (deliberate dialect structure) / `defect`
(corruption of standard input). Roundtrip fidelity: `defect` (fixable
corruption — currently the leading-`---` frontmatter trap, bracket-escape
growth, entity-newline injection, bare-list-marker escape, caret escape
asymmetry), `model-limit` (the ProseMirror model cannot represent the
construct: nested same-type emphasis, marks across hard breaks, list
looseness, empty-text links, code-fence meta), `normalization` (markdown
changes, rendered document does not), `policy` (deliberate `isSafeUrl`
rewriting — note it edits the author's file on save; render-time
sanitization is an open design question).

There are no numeric ceilings: the records themselves are the identity, and
`scripts/check-baseline-ratchet.mjs` refuses new `defect` records and
removed corpus examples at the merge base (ADR-5, WI-0.3).

## Corpus provenance

Vendored — no network at test time; registry digests fail on silent
mutation. Regenerate with `scripts/vendor-spec-corpus.mjs` (provenance via
`CORPUS_*` env, see its header):

- CommonMark: <https://spec.commonmark.org/0.31.2/spec.json>, 652 examples.
- GFM: `test/spec.txt` from <https://github.com/github/cmark-gfm> at
  `0.29.0.gfm.13`, extension sections only; `→` placeholders become real
  tabs. Spec text license: CC-BY-SA 4.0.

## Known limits

- In the parse gate, a node-**type** divergence compares children but skips
  attributes (unrelated shapes have unrelated fields); the roundtrip gate's
  fidelity invariant covers resolved values on the same corpus.
- The GFM corpus covers the extension *sections* only; the GFM spec's base
  examples are CommonMark 0.29 and are superseded by the 0.31.2 corpus.
- Fidelity compares mdast, which abstracts syntax — WI-2.2 adds the
  independent stock-remark ruler for the correlated-blind-spot direction.
  The characterization goldens remain the byte-level check for the curated
  corpus.
