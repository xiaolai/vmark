# GHA Workflow Viewer — Phase 0 Feasibility Spikes

> Plan: `dev-docs/plans/20260504-github-actions-workflow-viewer.md`
> Spikes are throwaway probes that validate ADRs before Phase 1 commits code.

## Status

| Spike | Goal | Status | Write-up |
|---|---|---|---|
| A | Verify `@actions/workflow-parser` exposes positions for every IR node | **PASS** (100% coverage) | `spike-a-parser.md` |
| B | Verify `html-to-image` + `@xyflow/react` v12 export pipeline | **PASS** (44-75 ms / export) | `spike-b-export.md` |
| C | Verify static-mode `@xyflow/react` inside ProseMirror NodeView | **PASS** (9/10, mitigation identified) | `spike-c-prosemirror.md` |
| D | Characterize `yaml` package round-trip behavior | **PASS** (refined gate; 4/7 byte-identical, 7/7 comment+anchor preserved) | `spike-d-roundtrip.md` |

**Phase 0 verdict: GREEN.** All four spikes pass; no fallback paths required.
Plan ADRs 3, 4, 8, 11 are validated against real package shapes and runtime
behavior. Phase 1 may proceed.

## Layout

```
dev-docs/grills/gha-workflow/
  README.md                  this file
  fixtures/                  real workflow YAML, kept under version control
  probes/                    isolated package — own package.json, npm-installed
    package.json
    spike-a-parser.mjs
    spike-d-roundtrip.mjs
    spike-b-export.html      static probe for image export
    spike-c-prosemirror.html static probe for PM integration
  spike-a-parser.md          findings + decisions
  spike-b-export.md
  spike-c-prosemirror.md
  spike-d-roundtrip.md
```

## Running

From repo root:
```bash
cd dev-docs/grills/gha-workflow/probes
pnpm install
node spike-a-parser.mjs
node spike-d-roundtrip.mjs
```

Spikes B and C require browser/DOM and a separate setup — see those files.

## Disposal

After Phase 0 acceptance, the fixture corpus moves to `dev-docs/fixtures/gha-workflows/`
(production location), the `probes/` package is deleted, and the spike write-ups
remain as reference under `dev-docs/grills/gha-workflow/` (per the existing grill
report convention).
