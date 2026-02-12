---
description: Review and merge open PRs — sequential, safe, with rebase handling
argument-hint: "[#PR ... | --mine | --pattern fix/issue-*]"
---

# Merge PRs

Safely review and merge open pull requests. Sequential processing with rebase handling between merges.

## Input

```text
$ARGUMENTS
```

## Phase 1: Discover PRs

Parse `$ARGUMENTS` to determine which PRs to process:

| Input | Scope |
|-------|-------|
| `#12 #34 #56` | Specific PR numbers |
| `--mine` | All open PRs authored by current user |
| `--pattern fix/issue-*` | PRs whose head branch matches the glob |
| (empty) | Same as `--mine` |

Fetch PR details:
```bash
gh pr list --author @me --state open --json number,title,headRefName,statusCheckRollup,reviewDecision,mergeable
```

If no open PRs found: report "No open PRs to process" and STOP.

## Phase 2: Pre-merge Review

For each PR, collect and display a status table:

```
| # | Title | Branch | Checks | Mergeable | Action |
|---|-------|--------|--------|-----------|--------|
| 12 | fix: resolve X (fixes #123) | fix/issue-123-slug | ✅ pass | ✅ yes | Ready |
| 34 | feat: add Y (fixes #456) | feat/issue-456-slug | ❌ fail | ✅ yes | Blocked |
| 56 | fix: handle Z (fixes #789) | fix/issue-789-slug | ✅ pass | ⚠️ conflict | Needs rebase |
```

### Status checks

For each PR:
```bash
gh pr checks {N}
```

### Classification

| Checks | Mergeable | Status |
|--------|-----------|--------|
| Pass | Yes | **Ready** — can merge |
| Fail | Any | **Blocked** — checks must pass first |
| Pass | Conflict | **Needs rebase** — will rebase before merge |
| Pending | Any | **Waiting** — checks still running |

**Present the table to the user and ask for confirmation before proceeding.**

Options to offer:
- Merge all ready PRs (skip blocked/waiting)
- Merge specific PRs by number
- Cancel

## Phase 3: Sequential Merge

Process PRs one at a time in the order confirmed by the user.

For each PR:

### 3a. Final check

```bash
gh pr view {N} --json mergeable,statusCheckRollup,mergeStateStatus
```

- If checks failed since Phase 2: skip, report, continue to next.
- If conflict detected: attempt rebase (Phase 3b).

### 3b. Rebase if needed

```bash
gh pr checkout {N}
git rebase main
```

- If rebase succeeds: force-push the branch, wait for checks, then merge.
  ```bash
  git push --force-with-lease
  ```
  Wait for checks:
  ```bash
  gh pr checks {N} --watch
  ```
- If rebase has conflicts: skip this PR, report conflicts to user, continue to next.

### 3c. Merge

```bash
gh pr merge {N} --squash --delete-branch
```

### 3d. Update main

After each merge, update local main so subsequent rebases are against the latest:
```bash
git checkout main
git pull origin main
```

### 3e. Report

After each merge, log the result. Continue to next PR.

## Phase 4: Summary

After all PRs are processed, display final results:

```
| # | Title | Result |
|---|-------|--------|
| 12 | fix: resolve X | ✅ Merged |
| 34 | feat: add Y | ❌ Skipped — checks failing |
| 56 | fix: handle Z | ✅ Merged (rebased) |
```

Also report:
- Number merged / skipped / failed
- Any PRs that need manual attention (conflicts, failing checks)

## Error Handling

| Scenario | Action |
|----------|--------|
| No open PRs | Report, STOP |
| Checks failing | Skip PR, report, continue |
| Rebase conflict | Skip PR, report conflict files, continue |
| Merge fails | Report error, continue to next |
| Force-push rejected | Skip PR, report, continue |
| User cancels | STOP immediately, report what was already merged |

## Safety Rules

1. **Always confirm with user** before merging anything.
2. **Never merge PRs with failing checks** — skip and report.
3. **Use `--force-with-lease`** for rebase pushes, never `--force`.
4. **Delete branch after merge** (`--delete-branch`) to keep repo clean.
5. **Sequential only** — never merge in parallel. Each merge may affect the next PR's mergeability.
6. **Squash merge** — one clean commit per PR on main.
