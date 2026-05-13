# Weekly Cleanup (T2)

**When:** every Monday morning.
**Budget:** 30 minutes — if a step blows past its allotment, stop and file an issue.
**Output:** `dev-docs/audit/weekly-YYYY-MM-DD.md` (use [`findings-template.md`](./findings-template.md)) + one entry appended to `.github/cleanup-ledger.json`.

## Pre-flight

```bash
git checkout main
git pull --ff-only
git status -sb   # must be clean
pnpm install --frozen-lockfile
```

If `main` is dirty or the lockfile drifted, stop and resolve before running any procedure. Cleanup operates on a clean baseline only.

Quickly confirm the daily gate still passes — if CI is red, weekly cleanup waits:

```bash
pnpm check:all
```

## 1. Dependency freshness (~5 min)

```bash
# Outdated packages
pnpm outdated

# Security advisories
pnpm audit --audit-level=high

# Rust crates (install cargo-audit once: `cargo install cargo-audit`)
cd src-tauri && cargo audit
```

**Action:**

| Severity | Decision |
|---|---|
| Patch bump (X.Y.Z → X.Y.Z+1) | Bump immediately if `pnpm check:all` still passes |
| Minor bump | Bump in batches of ≤ 3, run `pnpm check:all` between batches |
| Major bump | Defer to T3 monthly (read changelog) or T4 quarterly (strategic) |
| High/critical CVE | Bump now regardless of cadence; this is an override trigger |

**Stop condition:** if a bump breaks tests, revert and file an issue. Do not chase the breakage during weekly cleanup.

## 2. Unused code (~10 min)

```bash
# Unused TypeScript exports
pnpm dlx knip

# Unused dependencies
pnpm dlx depcheck --ignore-bin-package

# Unused Rust crates
cd src-tauri && cargo machete
```

**Action:**

- Delete confirmed-unused exports. Keep an export if:
  - It is invoked by Tauri (frontend can't statically see this).
  - It is invoked by MCP handlers (same reason).
  - It is loaded by dynamic import.
  - In all three cases, add a one-line comment explaining why static analysis flagged it.
- Remove confirmed-unused deps. Run `pnpm check:all` after each batch.
- Remove confirmed-unused Rust crates. Run `cargo check` after each batch in `src-tauri/`.

**Stop condition:** if removing something breaks a test, restore it and file an issue. Investigation is out of scope for weekly.

## 3. File size (~3 min)

```bash
find src src-tauri/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" \) \
  ! -name "*.test.*" -exec wc -l {} + | sort -rn | awk '$1 > 300 && $2 != "total"' | head -20
```

**Action:**

| Situation | Action |
|---|---|
| New file > 300 lines this cycle | Split now — small surface, easy to reason about |
| Existing file grew past 300 this cycle | Investigate cause; revert if the growth is incidental, split if it's structural |
| Stable > 300 for 4+ weeks | Promote to T3 monthly split candidate |
| File past 600 lines (2× cap) | Override trigger — split now, do not wait |

Splits follow `dev-docs/plans/20260418-housecleaning.md` Phase B: behavior-preserving only, one responsibility per file, tests travel with code, no API renames.

## 4. Locale parity (~3 min)

```bash
# React locales — show count of keys per locale
echo "=== React locales ==="
for f in src/locales/*/common.json; do
  echo "$(jq '[paths(scalars)] | length' "$f") — $f"
done

# Rust locales
echo "=== Rust locales ==="
for f in src-tauri/locales/*.yml; do
  echo "$(grep -c '^[a-zA-Z]' "$f") — $f"
done
```

**Action:**

- Any locale shorter than `en` → missing keys. Either:
  - Run the `/translate-docs` skill for the affected locale.
  - File an issue if a translation review by a native speaker is needed.
- New keys added without translations → check `git log` for the introducing commit; the author owns the translation follow-up.

## 5. Token and responsive violations (~5 min)

```
/ui-tokenize:audit
/ui-responsive:audit
```

**Action:**

- Treat every suggestion as a *candidate*, not an answer. The token audit's false-positive rate on this repo is ~58% (per `31-design-tokens.md`). Verify the CSS property → token mapping before applying any change.
- Fix verified violations on lines that *changed this week* (i.e. landed in `main` since last Monday).
- Pre-existing violations: leave alone unless you're already editing the file for an unrelated reason.

**Never run `/ui-tokenize:fix` on this repo.** The rule is documented in `31-design-tokens.md` — it will silently insert wrong tokens.

## 6. Stale branches, PRs, issues (~3 min)

```
/repo-clean-up
```

Or manually:

```bash
# Local branches merged into main → safe to delete
git branch --merged main | grep -vE '^\*|^\s*main$'

# Local branches with no remote and no activity in 30 days
for b in $(git branch --no-merged main | grep -v '^\*'); do
  age_days=$(( ( $(date +%s) - $(git log -1 --format=%ct "$b") ) / 86400 ))
  remote=$(git config --get "branch.$b.remote" 2>/dev/null || echo "—")
  [ "$age_days" -gt 30 ] && [ "$remote" = "—" ] && echo "$age_days days: $b"
done

# Stale GitHub PRs (no activity in 14 days)
gh pr list --state open --json number,title,updatedAt \
  --jq '.[] | select(((now - (.updatedAt | fromdateiso8601)) / 86400) > 14) | "\(.number) \(.title)"'

# Stale issues (no activity in 90 days)
gh issue list --state open --json number,title,updatedAt \
  --jq '.[] | select(((now - (.updatedAt | fromdateiso8601)) / 86400) > 90) | "\(.number) \(.title)"'
```

**Action:**

- Merged local branches: delete.
- Old unmerged local branches with no remote: confirm with owner before deleting; otherwise leave.
- Open PRs idle > 14 days: ping author or close.
- Open issues idle > 90 days: triage — close, label, or assign.

## 7. Wire-in to the autonomous audit pipeline (~2 min)

The repo already runs `claude-audit.yml` daily (3 of 19 dimensions, random rotation) and `claude.yml` autonomously fixes its `audit`-labeled issues. That pipeline has no memory across runs — this step gives it one by capturing its rate-of-discovery into the ledger.

```bash
# Count of open audit-labeled issues
gh issue list --state open --label audit --limit 1000 --json number | jq 'length'

# Breakdown by category label (everything besides "audit")
gh issue list --state open --label audit --limit 1000 --json labels \
  --jq '[.[] | .labels[] | .name | select(. != "audit" and . != "fix-attempted")] \
        | group_by(.) | map({key: .[0], count: length}) | from_entries'

# Issues the autonomous fixer gave up on
gh issue list --state open --label fix-attempted --limit 1000 --json number | jq 'length'
```

Record `audit_issues_open` and `audit_issues_fix_attempted` into the ledger entry. The category breakdown goes in the findings note (not the ledger — it's too dimensional for trend math).

**Trend signals to watch:**

| Pattern | Meaning |
|---|---|
| `audit_issues_open` climbing weekly | Discovery outpaces fix throughput — raise the `max_issues` cap in `claude.yml` or fix manually |
| `audit_issues_fix_attempted` climbing | Real debt the AI loop can't dissolve — promote triage to T3 |
| One category dominating | That dimension is producing low-value findings or hiding a structural issue — flag for T4 rule-efficacy review |

Do **not** delete or close `audit` issues during this step. Triage of `fix-attempted` happens in T3 monthly.

## 8. Record findings and metrics (~1 min)

Create `dev-docs/audit/weekly-YYYY-MM-DD.md` from [`findings-template.md`](./findings-template.md). Append one entry to `.github/cleanup-ledger.json` using the field set from [`ledger.md`](./ledger.md).

Commit:

```bash
git add dev-docs/audit/weekly-*.md .github/cleanup-ledger.json
git commit -m "chore(cleanup): weekly cycle YYYY-MM-DD"
```

If any in-cycle fixes landed (dep bumps, dead-code removals, etc.), they go in **separate** logical commits — do not bundle them with the findings note.

## Acceptance

- `pnpm check:all` passes on `main`.
- Findings note exists with per-area status (clean / N findings / deferred).
- Ledger entry recorded.
- Every finding has a verdict: fixed in cycle, issue filed with owner, or marked intentional.

## When weekly doesn't finish in 30 minutes

The first run will overshoot — that's expected. After 2–3 weeks, if the budget is still blown:

1. Identify which step is the consistent overshooter.
2. Either move it to T3 monthly, or carve it into smaller weekly sub-procedures.

Do not silently extend the budget. Time discipline is the only thing protecting weekly from becoming yet another "I'll do it later" backlog.
