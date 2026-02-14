# Codebase-Wide AI-Maintenance Documentation

**Date:** 2026-02-14
**Branch:** `discussion/codebase-housekeeping`
**Plan file:** `~/.claude/plans/resilient-tickling-melody.md`

## What We Did

Added structured documentation comments to ~400 source files across the entire VMark codebase so that AI coding agents can efficiently understand purpose, find bugs, and spot improvement opportunities — without reading entire files.

## Why

VMark had ~1000 source files. About 20% were well-documented, ~30% had partial comments, and ~50% had minimal or no documentation. AI agents waste significant context reading files just to understand what they do. Structured headers with `Purpose:`, `Pipeline:`, `Key decisions:`, and `@coordinates-with` markers let agents grep for exactly what they need.

## The Plan: 8-Phase Layer-by-Layer Approach

| Phase | Layer | Scope |
|-------|-------|-------|
| 1 | Stores (`src/stores/`) | ~57 files — app state, source of truth |
| 2 | Hooks (`src/hooks/`) | ~80 files — coordination layer |
| 3 | Plugins (`src/plugins/`) | ~68 directories — editor features |
| 4 | Utils (`src/utils/`, `src/lib/`) | ~130 files — pure functions |
| 5 | Components (`src/components/`, `src/contexts/`) | ~67 files — UI layer |
| 6 | Rust Backend (`src-tauri/src/`) | ~24 files — native layer |
| 7 | MCP Server (`vmark-mcp-server/src/`) | ~26 files — external tool interface |
| 8 | Other (`src/export/`) | ~20 files |

### Documentation Template

Every file gets a header block with structured fields AI agents can grep for:

```typescript
/**
 * [Name]
 *
 * Purpose: [One sentence — what problem this solves]
 *
 * Pipeline: [Where this fits in data/event flow]
 *
 * Key decisions:
 *   - [Why X pattern was chosen over Y]
 *
 * Known limitations:
 *   - [Things that could be improved]
 *
 * @coordinates-with [related-file.ts] — [how they interact]
 * @module [path/from/src]
 */
```

Rust files use `//!` module docs and `///` on pub items per RFC 505.

### Rules

- **Intent over mechanics** — comment WHY, not WHAT
- **Density follows complexity** — simple functions get header only; state machines get inline comments on transitions
- **Skip** test files, CSS files, files under 30 lines, barrel re-exports
- **Zero behavioral changes** — only add/update comments, never change code

## Execution: What Actually Happened

### Session 1: Phases 1-2 (sequential)

Phases 1 and 2 were done sequentially in a single session:

- **Phase 1** — 39 files, committed as `e445e0a`
- **Phase 2** — 94 files, committed as `450474f`

### Session 2: Phase 3 (failed)

Phase 3 was attempted with parallel subagents, but all subagents ran out of context window before completing. The changes were never committed and had to be discarded.

**Root cause:** Each subagent tried to process too many files (the entire plugins directory) in a single context, reading hundreds of files worth of code.

### Session 3: Phases 3-8 (parallel worktrees — succeeded)

The solution was to use **git worktrees** for true parallel execution with isolated file systems:

```
vmark-p3a/   ← plugins first half (34 dirs)
vmark-p3b/   ← plugins second half (34 dirs)
vmark-p4a/   ← utils first half (~50 files)
vmark-p4b/   ← utils second half (~65 files) + lib
vmark-p5/    ← components (~67 files) + contexts
vmark-p678/  ← Rust + MCP + export (~70 files)
```

Each worktree was created from the same HEAD (`450474f`), branching into its own temporary branch. Six background agents were launched in parallel, each working in its own worktree with `max_turns: 150`.

Key optimizations that prevented context overflow:
1. **Worktree isolation** — no file conflicts between agents
2. **Focused scope** — each agent had an explicit file list, not "do everything"
3. **Template inlined** — the comment template was included directly in the agent prompt, so agents didn't need to read the plan file
4. **Skip rules** — agents skipped files <30 lines, already-documented files, and test/CSS files
5. **No builds** — agents were told to only add comments and commit, never run builds or tests

### Results

All 6 agents completed successfully. One conflict (WindowContext.tsx was documented by both the p5 and p678 agents) was resolved during cherry-pick by merging both versions.

| Stream | Files Changed | Insertions | Agent Duration |
|--------|---------------|------------|----------------|
| Phase 3a (plugins first half) | 72 | +918 | ~15 min |
| Phase 3b (plugins second half) | 33 | +468 | ~10 min |
| Phase 4a (utils first half) | 11 | +178 | ~3 min |
| Phase 4b (utils second half + lib) | 63 | +883 | ~14 min |
| Phase 5 (components) | 33 | +698 | ~9 min |
| Phase 6+7+8 (Rust + MCP + export) | 10 | +172 | ~7 min |
| **Total** | **222** | **+3,332** | |

Many files (especially MCP server, export, and some utils) were already well-documented from prior work and needed no changes.

### Merge Process

1. Cherry-picked all 6 commits from worktree branches onto `discussion/codebase-housekeeping`
2. Resolved one conflict in `WindowContext.tsx` (merged both comment versions)
3. Ran `pnpm check:all` — all gates passed
4. Cleaned up all worktrees and temporary branches

## Ongoing Maintenance

Two mechanisms ensure comments stay current:

### 1. AI Agent Rule (`.claude/rules/22-comment-maintenance.md`)

Instructs all AI agents to update doc comments whenever they modify code. Covers:
- When to update (behavior changes, export changes, coordination changes)
- When NOT to update (drive-by fixes in unrelated files)
- Comment rot prevention

### 2. Git Pre-commit Hook (`scripts/check-comment-headers.sh`)

Soft warning (never blocks) when a modified file has a `Purpose:` header but the header lines weren't touched. Reminds developers to review whether docs still match code.

## Lessons Learned

1. **Parallel subagents need isolated filesystems.** Git worktrees are the right primitive — each agent gets its own working directory, no merge conflicts during work, clean cherry-pick after.

2. **Scope each agent narrowly.** An explicit file list beats "do all files in this directory." Agents that need to discover their own scope waste context on `find`/`glob` calls.

3. **Inline everything agents need.** Don't make agents read plan files or reference docs — inline the template and rules directly in the prompt. Every file read costs context.

4. **Most code is already better-documented than you think.** Out of ~400 files in scope, ~180 already had adequate headers. The agents correctly skipped these, saving significant context.

5. **Set `max_turns` conservatively.** 150 turns was enough for ~70 files per agent. Without the cap, agents could spiral into unnecessary re-reads.

## Commit History

```
e445e0a docs(phase-1): add AI-maintenance comments to stores
450474f docs(phase-2): add AI-maintenance comments to hooks
5f58517 docs(phase-3a): add AI-maintenance comments to plugins (first half)
a8194c8 docs(phase-3b): add AI-maintenance comments to plugins (second half)
3fca88e docs(phase-4a): add AI-maintenance comments to utils (first half)
c67ffac docs(phase-4b): add AI-maintenance comments to utils (second half) and lib
7b48ec6 docs(phase-5): add AI-maintenance comments to components and contexts
c67acf3 docs(phase-6-7-8): add AI-maintenance comments to Rust backend, MCP server, and export
```
