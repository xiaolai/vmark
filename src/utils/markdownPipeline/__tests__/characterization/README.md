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
