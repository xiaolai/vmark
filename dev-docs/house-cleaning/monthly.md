# Monthly Deep Clean (T3)

**When:** the first Saturday of each calendar month.
**Budget:** 2 hours.
**Prerequisite:** the most recent T2 weekly cleanup is complete; `main` is green.
**Output:** `dev-docs/audit/monthly-YYYY-MM.md` (use [`findings-template.md`](./findings-template.md)) + one entry appended to `.github/cleanup-ledger.json` + issues filed for everything deferred.

## Pre-flight

```bash
git checkout main && git pull --ff-only
git status -sb        # clean
pnpm install --frozen-lockfile
pnpm check:all        # baseline green
```

## 1. Architecture drift (~25 min)

```bash
# Cross-plugin imports — plugins should be self-contained
for p in src/plugins/*/; do
  name=$(basename "$p")
  count=$(grep -rn 'from "@/plugins/' "$p" 2>/dev/null \
    | grep -v "from \"@/plugins/$name" | wc -l)
  [ "$count" -gt 0 ] && echo "$count cross-plugin imports — $name"
done

# Cross-feature imports outside plugins
grep -rn 'from "@/components/' src/components/ 2>/dev/null \
  | grep -v 'from "\./\|from "@/components/ui\|test\.' | head -20

# Circular dependencies
pnpm dlx madge --circular --extensions ts,tsx src/

# Module size — directories with many files may have grown beyond one responsibility
find src -type d -not -path '*/node_modules*' -not -path '*/__tests__*' \
  -exec sh -c 'echo "$(find "$1" -maxdepth 1 -type f \( -name "*.ts" -o -name "*.tsx" \) | wc -l) $1"' _ {} \; \
  | sort -rn | head -10
```

**Action:**

- Circular dependency: file P1 issue with the cycle; do not break in cycle.
- Cross-plugin import: file issue with proposed shared-lib promotion target (`src/lib/` or `src/utils/`).
- Module > 30 files in one directory: candidate for split if it has distinct responsibilities; leave alone if cohesive.

## 2. Documentation sync (~20 min)

```
/docs-guardian:audit
```

Also manually verify the website mapping from `.claude/rules/21-website-docs.md`:

```bash
# Pages updated in code in the last 30 days
git log --since="30 days ago" --name-only --pretty=format: src/ src-tauri/ \
  | grep -E '\.(ts|tsx|rs)$' | sort -u | head -50

# Cross-check against website/guide/ — has the doc been touched?
git log --since="30 days ago" --name-only --pretty=format: website/guide/ \
  | grep -E '\.md$' | sort -u
```

**Action:**

- Stale docs (source code changed, doc didn't): update or file an issue tagged `docs-sync`.
- Public exports without docs: add brief TSDoc/`///` comments or file issue.
- `dev-docs/` topics whose code was removed: move to `dev-docs/archive/`.
- Website `website/guide/` pages whose source changed: cross-check per `21-website-docs.md`. Test the build:

  ```bash
  cd website && pnpm build
  ```

## 3. Mutation testing (~25 min)

```
/tdd-guardian:audit-mutation
```

If `requireMutation=false` in `.claude/tdd-guardian/config.json`, skip this section and reconsider at T4 quarterly.

**Hot paths to prioritize when surviving mutants need triage:**

| Path | Why it matters |
|---|---|
| `src/lib/cjkFormatter/` | Text-mutating logic; regressions visible to users |
| `src/utils/markdownPipeline/` | Parser correctness; downstream of everything |
| `src/utils/closeDecision.ts` | User-visible save semantics |
| `src/stores/*Store.ts` | State mutation safety; persistence implications |
| `src-tauri/src/menu/localized.rs` | i18n labels and accelerators |

**Action:**

- Surviving mutant on a hot path: write a boundary test, fix in cycle.
- Surviving mutant on cold path: file issue, defer to next month.
- Mutation tool not installed: install or formally decide to keep `requireMutation=false`. Record decision.

## 4. Bundle and build performance (~15 min)

```bash
# Clean build for accurate timing
rm -rf dist node_modules/.vite
start=$(date +%s%3N)
pnpm build
end=$(date +%s%3N)
echo "Build duration: $((end - start)) ms"

# Bundle size by chunk
du -sk dist/assets/* 2>/dev/null | sort -rn | head -10

# Total bundle
du -sh dist/
```

Compare to the last 3 entries in `.github/cleanup-ledger.json`.

**Action:**

| Signal | Action |
|---|---|
| Bundle jumped > 5% | Identify the new dep or asset; check necessity |
| Build time jumped > 20% | Investigate Vite config, new transforms, oversized files |
| Both stable | Just record |

## 5. Accessibility pass (~20 min)

Open `dev-docs/css-reference.md` in VMark and manually verify:

| Check | Pass criteria | Source |
|---|---|---|
| Tab order through editor | Focus visible at each stop | `33-focus-indicators.md` |
| Toolbar buttons | U-shape underline on focus | `33-focus-indicators.md` §1 |
| Popup inputs | Caret as the only focus indicator | `33-focus-indicators.md` §2 |
| Dialog inputs | Bottom-border highlight | `33-focus-indicators.md` §3 |
| Context menus | Reachable by keyboard, Escape closes | `32-component-patterns.md` |
| Color contrast | WCAG AA (4.5:1) for body text | `30-ui-consistency.md` |
| Dark theme parity | Every check above also passes in dark | `34-dark-theme.md` |

**Action:**

- Missing focus indicator: P1 issue (accessibility is not optional).
- Contrast violation: file issue, schedule fix this month.
- Dark theme regression: same severity as light.

## 6. Cross-platform smoke (~15 min)

macOS is primary, but Linux and Windows must still build. The rule: never break macOS to fix Windows; always allow Windows/Linux a best-effort path.

```bash
# Trigger Linux + Windows builds via existing workflows
gh workflow run release-linux.yml --ref main
gh workflow run release-windows.yml --ref main

# Wait for results
gh run list --limit 4
```

Lint for known cross-platform pitfalls:

```bash
# Bare Command::new — should always use ai_provider::build_command
grep -rn 'Command::new(' src-tauri/src/ \
  | grep -v 'ai_provider::build_command\|test\|#\[cfg'

# Hardcoded path separators
grep -rn '/Users/\|C:\\\\' src/ src-tauri/src/ --include="*.ts" --include="*.tsx" --include="*.rs"
```

**Action:**

- Build failure on Linux/Windows: file P1 issue (not P0 — macOS is primary, but P1 because users on those platforms break silently).
- Bare `Command::new`: fix per `AGENTS.md` rule.
- Hardcoded paths: replace with `path.join()` / `PathBuf` constructions.

## 7. Triage `fix-attempted` audit issues (~15 min)

The `claude.yml` audit-fix pipeline labels an issue `fix-attempted` when the autonomous fixer fails — and **never retries it**. Those issues are the hardest debt in the repo: the AI loop saw the spec, tried, and gave up. They accumulate silently between weekly runs.

```bash
# All open fix-attempted issues, oldest first
gh issue list --state open --label fix-attempted \
  --json number,title,labels,createdAt,updatedAt \
  --jq 'sort_by(.createdAt)'
```

For each, pick exactly one verdict:

| Verdict | Action |
|---|---|
| **Fix manually** | Address in cycle if scoped, file as monthly debt item if larger |
| **Reframe** | Rewrite the issue body with a better fix spec; remove `fix-attempted` so the autonomous loop retries |
| **Won't do** | Close with a one-line reason (e.g., "intentional: see ADR-N") |
| **Stale** | The code has moved past it; close as outdated |

**Stop condition:** never leave a `fix-attempted` issue open with no verdict. Three months of accumulated unread `fix-attempted` is a P1 quality signal — record it in the strategy note if you see it.

If the *rate* of `fix-attempted` is climbing in the ledger (check `audit_issues_fix_attempted` over the last 4 weekly entries), that's a signal the audit prompt is generating specs the fixer can't honor. Promote to T4 rule-efficacy review.

## 8. Plan hygiene (~10 min)

```bash
ls -la dev-docs/plans/*.md | sort -k9
```

For each plan, open and check the `Status:` header:

| Status | Action |
|---|---|
| All phases complete | Move to `dev-docs/archive/plans/` (locally; not tracked in git) |
| Active, last update < 30 days | Leave alone |
| Active, last update 30–60 days | Ping owner |
| Active, last update > 60 days | Mark `Status: Abandoned` or resume |
| No status header | Add one |

Verify the WI-linkage script still passes:

```bash
bash scripts/check-wi-linkage.sh dev-docs/plans/<active-plan>.md
```

## 9. Record findings and metrics

Create `dev-docs/audit/monthly-YYYY-MM.md` from [`findings-template.md`](./findings-template.md). Append a `T3` entry to `.github/cleanup-ledger.json` with the full metric set. The findings note must include a one-paragraph **comparison to the previous monthly entry** — that's the trend signal.

```bash
git add dev-docs/audit/monthly-*.md .github/cleanup-ledger.json
git commit -m "chore(cleanup): monthly cycle YYYY-MM"
```

## Acceptance

- `pnpm check:all` passes.
- All P1 findings have issues filed with owners.
- Ledger entry recorded with the T3 metric set.
- Comparison to last month's entry is in the findings note.
- Anything deferred has an issue, not a TBD.

## When monthly doesn't finish in 2 hours

After 2–3 cycles, if the budget consistently blows:

1. Look at which section ate the time.
2. Move it to a focused mid-month one-shot using the `20260418-housecleaning.md` template.
3. Or: split the monthly into two 1-hour windows on different weekends.

Do not silently extend the budget. Two-hour discipline is what makes monthly different from "another one-shot plan".
