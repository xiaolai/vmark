# SP4 — merge-diff → object → edge mapping (Phase 5 gate)

> **Status: OBJECT→EDGE HALF PROVEN (2026-07-20); GIT→FILE half is a named API,
> pending a git fixture.** Resolves the G-B round-2 finding that the merge
> auditor is *not* "mostly wiring": `merge_surface` stores only a merge SHA and
> git-attributed transformations have empty input sets, so the affected-edge set
> can't be read off directly. This records the deterministic mapping chain and
> the exact APIs Phase 5 adds.

## The mapping chain

A completed merge's touched edges are recovered in three deterministic steps:

```
merge SHA ──(git)──▶ changed files ──(registry)──▶ changed objects ──(index)──▶ affected edges
```

1. **merge SHA → changed files.** `gitops::merge_commit_sha(root)` already gives
   the concluded merge's SHA (`gitops.rs:74`). **New git API Phase 5 adds:**
   `merge_changed_files(root, sha) -> Vec<PathBuf>` — the union of files the merge
   introduced relative to *both* parents (`git diff --name-only <sha>^1 <sha>` ∪
   `<sha>^2 <sha>`, so a change from either side is caught). Mapping classes to
   handle explicitly (G-B round-2 completeness #6): renames/deletes (map the old
   path to its object, mark the object changed), unregistered files (skip with a
   diagnostic — not silently dropped), binaries (mapped by path like any object;
   uncheckable downstream), and blob-read failures (surface, never drop).

2. **changed files → changed objects.** Invert the registry's `path_of`
   (`index_row.rs:59`, object→path) to path→object. A changed file with no
   registered object is emitted as an **unmapped diagnostic**, not dropped
   (totality: every changed file is either mapped or diagnosed).

3. **changed objects → affected edges.** `CoherenceIndex::edges_affected_by(&objects)`
   — the union of each object's incident edges, **deduplicated by physical
   identity** and deterministically ordered. **This half is built and proven**
   (`read_view.test.rs::edges_affected_by_unions_and_dedups`): it unions U→A and
   U→B for changed `{U, A}` without double-counting U→A, is empty for an unedged
   object, and is order-independent in the changed-object set.

## What this closes

- **"Not mostly wiring."** The merge surface stores only a SHA; the affected-edge
  set is *derived* through this chain, of which step 3 is now a committed,
  deterministic, total index query. Steps 1–2 are the named git + registry APIs
  Phase 5's WI-5.1 implements.
- **Git-attributed transformations have empty inputs** (G-B): irrelevant here —
  the mapping keys on *changed objects* (from the diff), not on the git
  transformation's input set, so the empty-input problem never enters.

## Phase-5 decomposition (under this design)

- **WI-5.0 (this spike):** object→edge mapping proven; git+registry APIs named.
- **WI-5.1:** `merge_changed_files` (git) + registry inversion + `edges_affected_by`
  → the merge-affected edge set (per-merge-SHA, deduped as in `design-3.md` D3).
  A git-repo fixture with a real merge is the remaining test.
- **WI-5.2:** run the **existing** Phase-2b checker over those edges (the
  `check_sweep` governance already built in Phase 1 applies), emitting advisory
  check-results. No new algorithm (ADR-P4).
- **WI-5.3:** breakdown surface groups merge-origin contradictions; human
  resolves accept-newer / revise / waive; **never auto-reconciles** (§14).

## Verdict

**Object→edge half PROVEN and committed; git→file half is a named, decomposed
API.** SP4 clears the "is this even a deterministic mapping?" question — it is —
and identifies exactly what Phase 5 builds. The remaining test is a git-merge
fixture, which needs a real repo (the integration WI-5.1 owns it).

## Run

```
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  coherence::read_view::edges_affected_by_unions_and_dedups
```
