# Quarterly Strategic Review (T4)

**When:** the first weekend of each calendar quarter — January, April, July, October.
**Budget:** half a day (~4 hours).
**Prerequisite:** the most recent T3 monthly cleanup is complete.
**Output:** `dev-docs/audit/quarterly-YYYY-QN.md` (use [`findings-template.md`](./findings-template.md)) + ledger entry + top-10 debt list synced to GitHub issues + `dev-docs/architecture.md` updated if drift was found.

The quarterly review is the only tier that touches *strategy* rather than execution. Treat it like a board meeting: read the trend, set direction, write the decision down.

## Pre-flight

```bash
git checkout main && git pull --ff-only
pnpm install --frozen-lockfile
pnpm check:all
```

Open the last 12 ledger entries in a separate window — you'll reference them throughout.

```bash
jq '.entries[-12:]' .github/cleanup-ledger.json
```

## 1. Trend review (~30 min)

For each metric in the ledger, identify its pattern over the quarter:

| Pattern | Interpretation | Action |
|---|---|---|
| Monotonic increase | Structural debt accumulating | Promote to a focused one-shot plan in `dev-docs/plans/` |
| Monotonic decrease | Cleanup is working | Note what worked in strategy note for replication |
| Oscillating with no trend | Healthy churn | No action |
| Step jump up | Investigate commit range | If unintended, file regression issue |
| Step jump down | Identify the win | Note it; may be a candidate for another area |
| Flat at non-zero | Tolerated baseline | Confirm intentional, otherwise schedule action |

Write a 1-paragraph trend summary at the top of the strategy note. This is the most-read section of the doc.

## 2. Architecture review (~60 min)

Open `dev-docs/architecture.md` side-by-side with the actual code. For each major section:

- Do module boundaries still match?
- Are the entry points still as documented?
- Are the data flows accurate — especially Rust → Webview (`emit`/`listen`) and Webview → Rust (`invoke`), and the MCP bridge dispatcher?
- New plugins added without doc update?

If reality has drifted from the doc, **the doc loses authority**. The fix is one of two things, never both:

| Drift type | Fix |
|---|---|
| Drift is real and acceptable | Update the doc to reflect reality |
| Drift is real and harmful | File issue to revert the drift; do not update the doc |

The doc must be either accurate or actively being corrected. A doc that lies is worse than no doc.

## 3. Top-10 debt list (~45 min)

Synthesize the quarter's findings into a ranked list:

| Rank | Item | Severity | Effort | Owner | Target |
|---|---|---|---|---|---|
| 1 | … | High / Med / Low | hours / days | name | release version |

Inclusion criteria:

- Appeared in 3+ findings notes during the quarter.
- Has a concrete fix in mind (vague debt is research, not work).
- Cost-of-fix < cost-of-keeping.

Items not on the list are explicit non-priorities for next quarter. Saying "no" out loud frees attention.

For each top-10 item, create or link a GitHub issue labeled `debt-tracked` so the list survives the strategy note.

## 4. Dependency strategy (~30 min)

Review majors deferred from T2 and T3:

```bash
pnpm outdated --long
cd src-tauri && cargo outdated
```

For each major version:

1. Read the changelog (or release notes).
2. Check ecosystem adoption — is the new major used by ≥ 2 major peers in our stack?
3. Decide one of:
   - **Bump this quarter** — add to top-10 with effort estimate.
   - **Defer** — note the reason and the trigger that would change the decision.
   - **Pin permanently** — write the reason in `dev-docs/decisions/` as a brief ADR.

Same procedure for the AI provider SDK landscape and the Tauri ecosystem — those move fastest and break most.

## 5. Rule efficacy (~30 min)

```bash
# Recent rule references in commits
git log --since="3 months ago" --grep="rule\|convention" --oneline

# Active hooks
ls .claude/hooks/
cat .claude/settings.json | jq '.hooks // {}'
```

For each rule in `.claude/rules/`:

| Pattern this quarter | Action |
|---|---|
| Violated 3+ times | Edit the rule for clarity *or* enforce it with a hook |
| Never invoked, never violated | Candidate for removal — rules nobody references are noise |
| Repeated pattern with no rule | Candidate for codification — promote to a new rule file |
| Hook fires often with no false positives | Keep |
| Hook blocks legitimate work | Fix the hook; do not let people learn to bypass |

Add one line per change to the strategy note: which rule changed, why.

## 6. Capability and permission audit (~30 min)

```bash
# Tauri capabilities
jq '.permissions | length' src-tauri/capabilities/default.json
jq '.permissions' src-tauri/capabilities/default.json | less

# Claude Code permissions
cat .claude/settings.json | jq '.permissions // {}' | less
```

For each permission, ask:

- Is it still used? (A removed feature may have left its permission behind.)
- Is the scope tight? (Overbroad permissions hide risk.)
- Was it added without a corresponding feature?

The principle is *least privilege*. Every permission is a liability that must justify itself each quarter.

## 7. Cross-model audit (~30 min)

Codex has different training data and catches blind spots Claude misses (and vice versa). Worth one full-repo run per quarter.

```
/codex-toolkit:audit
```

Record findings in the strategy note. Promote any new recurring pattern to a `.claude/rules/` entry — that's how the audit improves the codebase rather than just generating reports.

## 8. Memory and AI config sanity (~15 min)

This project explicitly forbids project memory (per `CLAUDE.md`). Verify:

```bash
ls ~/.claude/projects/-Users-joker-github-xiaolai-myprojects-vmark/memory/ 2>/dev/null
```

If anything exists beyond a `MEMORY.md` that points back to `AGENTS.md`, an agent has violated the rule. Investigate and remove.

Verify `AGENTS.md`, `CLAUDE.md`, and `.claude/rules/` are still current:

```bash
git log --since="3 months ago" --oneline AGENTS.md CLAUDE.md .claude/rules/
```

If those haven't been touched in a quarter where the codebase changed substantially, they are probably stale.

## 9. Record strategy note

Create `dev-docs/audit/quarterly-YYYY-QN.md` from [`findings-template.md`](./findings-template.md), with these required sections:

1. **Trend summary** (from §1).
2. **Architecture status** (from §2 — drift found / drift fixed / no drift).
3. **Top-10 debt list** with issue links (from §3).
4. **Quarter's wins** — what got cleaner, what worked.
5. **Quarter's regressions** — what got worse, why, and the planned response.
6. **Next quarter's focus** — one sentence. Just one.

Append a `T4` entry to `.github/cleanup-ledger.json`.

```bash
git add dev-docs/audit/quarterly-*.md .github/cleanup-ledger.json
# If the architecture doc was updated:
git add dev-docs/architecture.md
git commit -m "chore(cleanup): quarterly review YYYY-QN"
```

## Acceptance

- Strategy note committed with all 6 required sections.
- Top-10 debt list synced to GitHub issues with `debt-tracked` label.
- Ledger entry recorded.
- `dev-docs/architecture.md` either matches reality or has an issue tracking the fix.
- Rule changes (if any) are committed and the rationale is in the strategy note.
- Capability/permission diff (if any) is committed and justified in the strategy note.

## After the review

The quarterly review's value compounds only if its decisions persist. Within one week:

1. Confirm every top-10 item has an owner and a target release.
2. Wire the "next quarter's focus" sentence somewhere visible — pinned issue, repo description, or README banner.
3. If the review revealed a rule change, ensure CI/hooks reflect it before the next T2 weekly runs.

Otherwise the strategy note becomes archaeology, not direction.
