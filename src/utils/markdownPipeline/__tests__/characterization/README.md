# Markdown pipeline — corpus characterization harness

A refactor-safety net for `src/utils/markdownPipeline`. It locks the
**whole-document** behavior of the round-trip
`markdown → ProseMirror doc → markdown`, so a refactor of the pipeline is
provably behavior-preserving.

This is the corpus-level complement to the unit-level fixed-point tests in
`../serializer-idempotency.test.ts` and `../backslash-roundtrip.test.ts`.

## Layout

| Path | Role |
|---|---|
| `corpus/*.md` | Input documents. Each targets a feature family or edge case. |
| `__golden__/*.md` | Committed canonical outputs — the "approved" serializer result. Auto-generated; reviewed as part of the diff. |
| `roundtrip.characterization.test.ts` | The harness. Auto-discovers every `corpus/*.md`. |

## The two invariants (per document)

1. **Idempotence** — `serialize(parse(x))` must be a fixed point: feeding the
   canonical output back in must not change it again. A hard failure is a real
   serializer bug (the #1102 asterisk-growth / entity-injection class).
2. **Golden approval** — the canonical output must match its committed
   `__golden__/` snapshot. Any change to canonical markdown shows up as a
   golden diff in the normal `pnpm test` run — pipeline drift can't land
   silently.

## Refactor workflow

```bash
# 1. Seed: drop representative real-world documents into corpus/, then capture
#    their current (pre-refactor) canonical output as goldens.
pnpm exec vitest run roundtrip.characterization      # first run writes goldens

# 2. Refactor src/utils/markdownPipeline/…

# 3. Re-run. Green = byte-for-byte-identical output (behavior preserved).
#    A golden diff = the exact behavior change to review.
pnpm exec vitest run roundtrip.characterization

# 4. If the change is intentional and correct, accept the new goldens:
pnpm exec vitest run roundtrip.characterization -u
```

The goldens capture the serializer's **actual** output, not the input — e.g.
alert blocks gain internal `>` spacing, some inputs are normalized. That is the
point: whatever the pipeline does today is frozen, and a refactor must reproduce
it exactly (or the diff must be consciously approved).

## Extending coverage

Drop a `.md` file into `corpus/`. No code change — the harness discovers it on
the next run and generates its golden. To characterize a real bug or document
class before touching the pipeline, add the offending document here first.

## Known defects encoded in the goldens (2026-07-23)

A golden records what the pipeline **does**, not what it **should** do. Phase 0A
(`dev-docs/plans/20260722-extension-architecture.md`) widened the corpus from 12
to 22 fixtures and switched the harness from the hand-mirrored `testSchema` to a
projection of the real editor schema (`src/test/productionSchema.ts`). That
immediately surfaced four **pre-existing** round-trip defects. Their goldens
encode the broken output deliberately, so a future fix shows up as a reviewable
diff rather than passing unnoticed.

**Do not treat these four goldens as correct output.**

| # | Fixture | Input | Round-trips to | Cause |
|---|---|---|---|---|
| D1 | `14-media.md` | `![A short clip](clip.mp4)` | `![](clip.mp4)` | `block_video`/`block_audio` declare `src`/`title`/`poster`/`controls` but **no `alt`** (`plugins/blockVideo/tiptap.ts:36`), so alt text has nowhere to live |
| D2 | `16-inline-marks.md` | `[link with title](url "Title")` | `[link with title](url)` | The `link` mark declares **no `title` attribute**, so the title cannot survive a WYSIWYG round-trip |
| D3 | `16-inline-marks.md` | `==highlight with **bold**==` | `\==highlight with **bold**==` | The opening `==` is escaped when the highlight contains a nested mark — the highlight is **destroyed**, not merely reformatted |
| D4 | `17-escaped-markers.md` | `x\^2\^` (literal) | `x^2^` (real superscript) | The escape is stripped, changing meaning on the next parse — the H7 bug class from `dev-docs/audit/20260612-full-improvement-audit.md` |

D1 and D2 are silent data loss. D3 and D4 are silent semantic corruption: the
output re-parses to a *different document* than the input. All four are
autosave-persisted, since `useTiptapFlush` serializes on every edit.

Changes that are **cosmetic normalization**, not defects: table cell padding and
alignment (`22`), blank-line collapsing inside `<details>` and lists (`18`, `19`)
— blank-line preservation is opt-in — `>` continuation lines added inside alerts
(`21`), and `youtube.com` → `youtube-nocookie.com` plus default `width`/`height`
on provider embeds (`15`), which is the deliberate privacy-enhanced path.
