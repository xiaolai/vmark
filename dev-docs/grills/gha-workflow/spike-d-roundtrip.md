# Spike D — `yaml` package round-trip characterization

> Status: **PASS** with refined gate (2026-05-04)
> Plan ADR: ADR-11
> Probe: `probes/spike-d-roundtrip.mjs`
> Run with: `node spike-d-roundtrip.mjs`

## Goal

Characterize what the `yaml` (eemeli, ISC) package's `parseDocument →
toString` actually does to a GitHub Actions workflow file:

1. **Identity round-trip** — `toString()` of an unmutated `Document` —
   what changes?
2. **Targeted edits** — apply 3 representative IR-level mutations
   (rename, add env var, change step name) — does the change stay
   localized? Are comments and anchors preserved? Does the output
   re-parse cleanly?

The realistic acceptance gate from ADR-11 is **not** byte identity. It
is the conjunction:

1. Comments preserved (count + position)
2. Anchors / aliases preserved
3. `parseDocument(orig).toJS()` deep-equals `parseDocument(saved).toJS()`
4. Minimal diff: edits stay near the targeted region

Spike D is what tells us whether the gate is achievable and what
`toString()` options to use.

## Method

Same 7 fixtures from Spike A (vmark's own workflows). For each:

1. Run identity round-trip and count line diffs.
2. Run 3 mutations:
   - Rename a top-level key (`name:`)
   - Add a workflow-level `env:` block with a new key
   - Modify the first job's first step's `name:`
3. After each mutation: count diff lines, count comments and anchors,
   re-parse the output and verify no errors.

`toString()` options are the variable being tuned.

## Findings

### Tested option progressions

| Stringify options | Byte-identical identity round-trips |
|---|---|
| (default) | 0 / 7 |
| `{ lineWidth: 0 }` | 2 / 7 |
| `{ lineWidth: 0, flowCollectionPadding: false }` | **4 / 7** ✓ |

Across **all** option settings:
- Comments preserved: 7 / 7
- Anchors preserved: 7 / 7
- Re-parsed output errors: 0 / 7

### What `toString` defaults change (and why)

| Default behavior | Effect on diff | Mitigation |
|---|---|---|
| Auto-wraps long lines at column 80 | Hundreds of line diffs in claude-audit.yml | `lineWidth: 0` |
| Pads flow collections: `[main]` → `[ main ]` | Several line diffs in most fixtures | `flowCollectionPadding: false` |
| Collapses plain multi-line scalars onto one logical line | 290-line diff in claude.yml's multi-line `if:` condition | None; document the limitation, see §Residual cases |

### Per-fixture results (with the chosen options)

| Fixture | Identity diff | Comments | Anchors | Edit reparsed |
|---|---|---|---|---|
| `ci.yml` | 0 lines | 5/5 ✓ | 0/0 ✓ | ✓ ✓ ✓ |
| `release.yml` | 0 lines | 47/47 ✓ | 1/1 ✓ | ✓ ✓ ✓ |
| `claude-cost-report.yml` | 0 lines | 6/6 ✓ | 2/2 ✓ | ✓ ✓ ✓ |
| `update-homebrew.yml` | 0 lines | 2/2 ✓ | 0/0 ✓ | ✓ ✓ ✓ |
| `claude-audit.yml` | 1 line (trailing newline) | 34/34 ✓ | 0/0 ✓ | ✓ ✓ ✓ |
| `deploy-website.yml` | 1 line (comment indent) | 7/7 ✓ | 0/0 ✓ | ✓ ✓ ✓ |
| `claude.yml` | 290 lines (plain multi-line scalar collapse) | 30/30 ✓ | 4/4 ✓ | ✓ ✓ ✓ |

### Residual cases that defeat byte-identity (acceptable)

1. **Trailing newline normalization** (1 line): `claude-audit.yml`. Cosmetic;
   gate condition #1 (comments) and #3 (semantic) hold.
2. **Comment indent normalization** (1 line): `deploy-website.yml` —
   a stray top-level comment after a `permissions:` block gets re-indented
   to match the surrounding context. Cosmetic.
3. **Plain multi-line scalar collapse** (290 lines): `claude.yml` has an
   `if:` condition written as a plain scalar spread across three lines via
   YAML's implicit line continuation. The library re-emits this as a
   single long line. Semantically identical; visually different.
   - **Mitigation candidate:** detect plain multi-line scalars at parse
     time and re-emit them as `>` (folded block) style. Out of v1 scope;
     filed as a Phase 8 polish item if user feedback demands it.

### Targeted edits

For all 7 fixtures × 3 edit scenarios = 21 edit cases:
- Edit applied successfully: 21 / 21
- Comments preserved post-edit: 21 / 21
- Anchors preserved post-edit: 21 / 21
- Output re-parsed without errors: 21 / 21

The "minimal diff" property held for the simple edits (rename, single
step name change → 1-2 line diff in fixtures without the multi-line
scalar issue). The "add env var" edit ran 3-5 lines because it inserts
a new top-level block.

## API summary (for Phase 8 implementation)

```ts
import { parseDocument } from "yaml";

// Parse — preserves CST including comments, anchors, key order.
const doc = parseDocument(yamlString);

// Mutate via Document/Map/Seq API.
doc.set("name", "new value");                    // top-level
const jobs = doc.get("jobs");
const buildJob = jobs.get("build");
buildJob.set("runs-on", "ubuntu-latest");

// Serialize with the project-standard options.
const STRINGIFY_OPTIONS = {
  lineWidth: 0,
  flowCollectionPadding: false,
};
const newYaml = doc.toString(STRINGIFY_OPTIONS);
```

These options are the **project standard** for Phase 8 mutators.
Documented and exported as `WORKFLOW_YAML_STRINGIFY_OPTIONS` from
`save/cstParser.ts`.

## Decision

**Adopt the four-condition gate from ADR-11 with the stringify options
above.** Specifically the gate becomes:

1. Comment count and position preserved.
2. Anchor / alias count and references preserved.
3. `parseDocument(orig).toJS()` ≡ `parseDocument(saved).toJS()` after
   identity round-trip; ≡ `parseDocument(orig).toJS() + appliedPatches`
   after edits.
4. Diff stays within the targeted region ± enclosing line, **except**
   when the targeted region itself contains a plain multi-line scalar
   (acceptable v1 limitation; documented in `cstParser.ts`).

The byte-identity goal from the original draft is dropped — verified
unattainable.

## Open follow-ups for Phase 8

1. Export `WORKFLOW_YAML_STRINGIFY_OPTIONS` constant; never call
   `toString()` without it on the save path.
2. Test `release.yml`'s `&anchor` + `*alias` references survive a real
   IR-level edit that touches the anchored node (not just identity).
3. Consider a "smart re-emit" pass that detects plain multi-line scalars
   pre-edit and re-styles them as `>` block before mutation, to make the
   diff localized in those cases. Optional enhancement; not v1 scope.
4. Add a quoted-multi-line-scalar fixture to the corpus and re-test
   (corpus currently has zero such cases; theoretical edge case).
5. Build the round-trip test harness in Vitest to enforce the gate per
   commit.
