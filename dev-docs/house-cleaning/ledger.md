# Cleanup Ledger

Trend data lives in `.github/cleanup-ledger.json`. Snapshots are noise; deltas are signal. This file is the schema and the collection recipe.

The format mirrors `.github/cost-reports/ledger.json` — a single append-only JSON file, machine-readable, never edited in place.

## Schema

```json
{
  "version": 1,
  "entries": [
    {
      "timestamp": "2026-05-13T09:30:00Z",
      "tier": "T2",
      "trigger": "scheduled",
      "commit": "1916ad62",
      "metrics": {
        "files_over_300_lines": 12,
        "total_source_files": 487,
        "test_count": 2341,
        "test_duration_ms": 47823,
        "coverage_lines_pct": 87.4,
        "coverage_branches_pct": 81.2,
        "deps_total": 84,
        "deps_outdated": 7,
        "deps_vulnerable_high": 0,
        "deps_unused": 3,
        "rust_crates_total": 41,
        "rust_crates_unused": 0,
        "knip_unused_exports": 18,
        "locale_missing_keys_react": 0,
        "locale_missing_keys_rust": 0,
        "stale_branches_local": 4,
        "open_issues": 23,
        "open_prs": 2,
        "ui_tokenize_violations": 11,
        "ui_responsive_violations": 0,
        "audit_issues_open": 14,
        "audit_issues_fix_attempted": 3,
        "bundle_size_kb": 1247,
        "build_duration_ms": 18420
      },
      "notes": "first baseline; 3 deps removed in cycle"
    }
  ]
}
```

### Field semantics

| Field | Required | Notes |
|---|---|---|
| `timestamp` | yes | ISO 8601 UTC |
| `tier` | yes | `T2` / `T3` / `T4` |
| `trigger` | yes | `scheduled` / `override` / `manual` |
| `commit` | yes | Short SHA of `main` at the time of capture |
| `metrics` | yes | Object — subset is fine for T2; T3/T4 should fill more |
| `notes` | optional | One-line human summary; never multi-line |
| `correction_for` | optional | ISO timestamp of a prior entry being corrected; explain in `notes` |

## What to track

Track only metrics that:

1. Can be collected mechanically — no human judgment in the number.
2. Move in a meaningful direction — more "files over 300 lines" is unambiguously bad; raw lines-of-code is not.
3. Survive routine refactors — count of files, not specific filenames.

Avoid:

- Vanity counts (raw LOC, total commits).
- Numbers that swing wildly with no behavior change (e.g., `any` count fluctuating with generated types).
- Metrics no procedure acts on. If nobody's verdict depends on the number, don't collect it.

## Collection commands

Run from repo root. Each command is designed to print a single number (or a JSON value) suitable for the ledger entry. Wrap in a script later if collection becomes tedious — for now, manual run is the point.

### File and code size

```bash
# files_over_300_lines
find src src-tauri/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" \) \
  ! -name "*.test.*" -exec wc -l {} + | awk '$1 > 300 && $2 != "total"' | wc -l

# total_source_files
find src src-tauri/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" \) \
  ! -name "*.test.*" | wc -l
```

### Tests and coverage

```bash
# test_count + test_duration_ms — capture from pnpm test summary
pnpm test --reporter=verbose 2>&1 | tail -5

# coverage_lines_pct + coverage_branches_pct — from coverage-summary.json
pnpm test:coverage 2>&1 > /dev/null
jq '.total | {lines: .lines.pct, branches: .branches.pct}' coverage/coverage-summary.json
```

### Dependencies

```bash
# deps_total — from package.json
jq '(.dependencies // {} | length) + (.devDependencies // {} | length)' package.json

# deps_outdated
pnpm outdated --format json 2>/dev/null | jq 'length // 0'

# deps_vulnerable_high
pnpm audit --json 2>/dev/null | jq '.metadata.vulnerabilities.high // 0'

# deps_unused
pnpm dlx depcheck --json 2>/dev/null | jq '.dependencies | length'

# rust_crates_total
cd src-tauri && cargo tree --depth 1 --quiet 2>/dev/null | tail -n +2 | wc -l

# rust_crates_unused (requires cargo-machete: `cargo install cargo-machete`)
cd src-tauri && cargo machete --skip-target-dir 2>&1 | grep -c '^\s\+'

# knip_unused_exports
pnpm dlx knip --reporter json 2>/dev/null | jq '[.issues[]?.exports // [] | length] | add // 0'
```

### i18n

```bash
# locale_missing_keys_react — compare each locale to en
en_keys=$(jq '[paths(scalars)] | length' src/locales/en/common.json)
for f in src/locales/*/common.json; do
  if [ "$f" != "src/locales/en/common.json" ]; then
    n=$(jq '[paths(scalars)] | length' "$f")
    echo "$((en_keys - n)) missing in $f"
  fi
done | awk '{sum+=$1} END {print sum}'

# locale_missing_keys_rust — line-count proxy on en.yml top-level keys
en_keys=$(grep -c '^[a-zA-Z]' src-tauri/locales/en.yml)
for f in src-tauri/locales/*.yml; do
  if [ "$f" != "src-tauri/locales/en.yml" ]; then
    n=$(grep -c '^[a-zA-Z]' "$f")
    echo $((en_keys - n))
  fi
done | awk '{if($1>0) sum+=$1} END {print sum+0}'
```

### Repo state

```bash
# stale_branches_local — local branches not merged into main, with no remote
git branch --no-merged main | grep -v '^\*' | while read b; do
  git config --get "branch.$b.remote" >/dev/null 2>&1 || echo "$b"
done | wc -l

# open_issues
gh issue list --state open --limit 1000 --json number | jq 'length'

# open_prs
gh pr list --state open --limit 100 --json number | jq 'length'
```

### UI quality

```bash
# ui_tokenize_violations — uses the installed plugin
# (run /ui-tokenize:audit interactively; record the violation count from its report)

# ui_responsive_violations
# (run /ui-responsive:audit interactively; record the violation count from its report)
```

These two use slash commands rather than CLI tools and need a human in the loop until/unless they grow JSON output modes.

### Autonomous audit pipeline

The repo runs `claude-audit.yml` daily and autonomously fixes its issues via `claude.yml`. Capturing the pipeline's open-work backlog gives the loop a memory it otherwise lacks.

```bash
# audit_issues_open
gh issue list --state open --label audit --limit 1000 --json number | jq 'length'

# audit_issues_fix_attempted — issues the autonomous fixer gave up on
gh issue list --state open --label fix-attempted --limit 1000 --json number | jq 'length'
```

`audit_issues_open` rising means discovery is outpacing the fix throughput cap (currently 6/run in `claude.yml`). `audit_issues_fix_attempted` rising means real, hard debt — triage in T3 monthly.

### Build

```bash
# build_duration_ms + bundle_size_kb — clean build for accuracy
rm -rf dist
start=$(date +%s%3N)
pnpm build > /dev/null 2>&1
end=$(date +%s%3N)
echo "build_duration_ms: $((end - start))"
echo "bundle_size_kb: $(du -sk dist | cut -f1)"
```

## Appending an entry

The simplest correct approach until a helper script exists:

1. Read the current ledger: `jq '.' .github/cleanup-ledger.json`.
2. Construct the new entry as a JSON object.
3. Append: `jq --argjson e "$entry" '.entries += [$e]' .github/cleanup-ledger.json > tmp && mv tmp .github/cleanup-ledger.json`.
4. Commit alongside the findings note for the same cycle.

If the ledger doesn't exist yet:

```bash
echo '{"version": 1, "entries": []}' > .github/cleanup-ledger.json
```

## Reading the ledger

```bash
# Last 12 entries, key metrics only
jq '.entries[-12:] | .[] | {
  ts: .timestamp,
  tier: .tier,
  files_300: .metrics.files_over_300_lines,
  deps_outdated: .metrics.deps_outdated,
  coverage: .metrics.coverage_lines_pct
}' .github/cleanup-ledger.json
```

## Trend interpretation

| Pattern over 4+ entries | Meaning | Action |
|---|---|---|
| Monotonic increase | Structural debt accumulating | Promote to T3/T4 procedure focus |
| Monotonic decrease | Cleanup is working | Record what worked in T4 strategy note |
| Oscillating | Healthy churn | No action |
| Step jump | Investigate commit range | If unintended, file regression issue |
| Flat at non-zero | Tolerated baseline | Confirm intentional, otherwise act |

A finding is significant when it appears in 3+ consecutive entries with no improvement — that's structural, not fluctuation.

## Corrections

If a metric was collected wrong, append a new entry with `"correction_for": "<original timestamp>"` and explain in `notes`. Never edit past entries — the trend is the product.
