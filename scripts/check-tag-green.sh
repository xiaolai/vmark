#!/usr/bin/env bash
#
# check-tag-green.sh <commit-sha> — verify that CI's required checks are green
# on the given commit before a release tag is allowed to leave this machine.
#
# Called by the `.githooks/pre-push` tag leg (WI-7). Queries
#   gh api repos/xiaolai/vmark/commits/<sha>/check-runs
# and requires BOTH required branch-protection checks — `frontend` and `rust`
# (the same two `main` requires) — to be `completed` + `success` on the exact
# SHA the tag names.
#
# Semantics (pinned by scripts/check-tag-green.test.mjs):
#   - Only `frontend` and `rust` gate; other red checks (e.g. webkit) are
#     ignored — they are not required checks.
#   - A check-run counts only when its `app.slug` is `github-actions`. A
#     check-run NAME is not an identity: any GitHub App the repo has installed
#     with `checks: write` can publish a run called `frontend` or `rust`, and
#     matching by name alone would let it vouch for the release. Runs from any
#     other app (or with no app attribution) are refused, naming the app seen.
#   - Duplicate check-runs per name → the highest check-run `id` wins, so a
#     re-run-to-green passes. `id` and not `started_at`: ids are monotonic and
#     always present, whereas a missing `started_at` used to parse to epoch 0
#     and ties fell back to the array's arrival order — a red re-run could be
#     masked by a stale green. A run with no numeric id fails closed.
#   - A pending/in_progress required check refuses with a distinct
#     "not finished" message; an absent one with a distinct "missing" message.
#   - `gh` missing from PATH, a network/auth error, a timeout, or malformed
#     JSON all FAIL CLOSED with a message pointing at VMARK_OFFLINE_GATE=1
#     (which makes the pre-push hook run the full legacy local gate instead).
#     This script never silently passes.
#   - The gh call is wrapped in `timeout` (VMARK_GH_TIMEOUT seconds, default
#     30) where timeout(1) exists, so a hung network cannot hang the push
#     forever; without timeout(1) a gh failure still fails closed.
#
# Only bash builtins are used for I/O (printf/echo/read) — no cat/sed/jq —
# so the script runs under the minimal PATH its tests impose. JSON parsing
# is delegated to node (always present in this repo's toolchain).

set -euo pipefail

REPO_SLUG="xiaolai/vmark"
sha="${1:-}"

if [ -z "$sha" ]; then
  echo "✖ check-tag-green: usage: check-tag-green.sh <commit-sha>" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "✖ check-tag-green: \`gh\` CLI not found on PATH — cannot verify CI check-runs." >&2
  echo "  Failing closed (a tag must never ship unverified). Install GitHub CLI" >&2
  echo "  (https://cli.github.com), or run the full local gate instead:" >&2
  echo "    VMARK_OFFLINE_GATE=1 git push …" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "✖ check-tag-green: node not found on PATH — cannot parse check-runs." >&2
  echo "  Failing closed. Run the full local gate instead: VMARK_OFFLINE_GATE=1 git push …" >&2
  exit 1
fi

api_path="repos/${REPO_SLUG}/commits/${sha}/check-runs?per_page=100"
timeout_s="${VMARK_GH_TIMEOUT:-30}"

set +e
if command -v timeout >/dev/null 2>&1; then
  json=$(timeout "$timeout_s" gh api "$api_path")
else
  json=$(gh api "$api_path")
fi
gh_status=$?
set -e

if [ "$gh_status" -ne 0 ]; then
  echo "✖ check-tag-green: \`gh api ${api_path}\` failed (exit ${gh_status})." >&2
  echo "  Network/auth error or timeout — failing closed, never treated as green." >&2
  echo "  Check \`gh auth status\` and connectivity, or run the full local gate" >&2
  echo "  instead: VMARK_OFFLINE_GATE=1 git push …" >&2
  exit 1
fi

# JSON evaluation in node: highest-id-per-name over the required checks,
# restricted to runs the `github-actions` App published.
read -r -d '' PARSE_JS <<'JSEOF' || true
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const sha = process.argv[1];
  const failClosed = (why) => {
    console.error(`✖ check-tag-green: could not parse check-runs JSON (${why}) — failing closed.`);
    console.error("  Re-run, or use the full local gate instead: VMARK_OFFLINE_GATE=1 git push …");
    process.exit(1);
  };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    failClosed("invalid JSON");
    return;
  }
  const runs = data && Array.isArray(data.check_runs) ? data.check_runs : null;
  if (!runs) {
    failClosed("no check_runs array");
    return;
  }
  const required = ["frontend", "rust"];
  // A check-run name is not an identity — only this App's runs may vouch.
  const REQUIRED_APP = "github-actions";
  const appOf = (r) => (r && r.app && typeof r.app.slug === "string" ? r.app.slug : "<no app>");
  const problems = [];
  for (const name of required) {
    const named = runs.filter((r) => r && r.name === name);
    if (named.length === 0) {
      problems.push(
        `required check "${name}" is missing on ${sha} — no check-run with that name (has CI run on this commit?)`,
      );
      continue;
    }
    const trusted = named.filter((r) => appOf(r) === REQUIRED_APP);
    if (trusted.length === 0) {
      const seen = [...new Set(named.map(appOf))].join(", ");
      problems.push(
        `required check "${name}" on ${sha} has no run from the "${REQUIRED_APP}" GitHub App ` +
          `(saw: ${seen}) — a check-run name is not an identity; failing closed`,
      );
      continue;
    }
    if (trusted.some((r) => !Number.isInteger(r.id))) {
      problems.push(
        `required check "${name}" on ${sha} has a check-run with no numeric id — the latest run ` +
          "cannot be determined; failing closed",
      );
      continue;
    }
    // Highest id wins: a re-run-to-green must pass, an old green must not mask a new red.
    const latest = trusted.reduce((a, b) => (b.id > a.id ? b : a));
    if (latest.status !== "completed") {
      problems.push(
        `required check "${name}" has not finished on ${sha} (status: ${latest.status}) — wait for CI, then push the tag again`,
      );
    } else if (latest.conclusion !== "success") {
      problems.push(
        `required check "${name}" is red on ${sha} (conclusion: ${latest.conclusion})`,
      );
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ check-tag-green: ${p}`);
    process.exit(1);
  }
  console.log(`✔ check-tag-green: frontend and rust are green on ${sha}`);
  process.exit(0);
});
JSEOF

if printf '%s' "$json" | node -e "$PARSE_JS" "$sha"; then
  exit 0
else
  exit 1
fi
