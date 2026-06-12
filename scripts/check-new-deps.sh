#!/usr/bin/env bash
#
# Slopsquatting gate: scan ALL npm manifests (root, vmark-mcp-server,
# website) for newly-added dependencies and report metadata (creation
# date, weekly downloads). Fails CLOSED on any metadata failure. Flags
# any package that's:
#   - non-existent on npm or unqueryable (likely hallucinated)
#   - created less than $MIN_AGE_DAYS ago (default 30)
#   - has fewer than $MIN_WEEKLY_DL weekly downloads (default 1000)
#
# Background: USENIX Security 2025 (Spracklen et al.) measured 5.2-21.7%
# package hallucination rate in LLM-generated code, with 43% of names
# repeating across runs — actively weaponized as "slopsquatting" supply-
# chain attacks. Pinning lockfiles isn't enough; new package additions
# need eyes.
#
# Usage:
#   bash scripts/check-new-deps.sh [base-ref]
#
# Default base-ref is `origin/main` for PR/CI use; on main branch we
# compare against the previous tag.
#
# Exit codes:
#   0  no new deps, OR every new dep passes flag thresholds
#   1  one or more new deps flagged for human review (CI fails)
#  64  bad invocation

set -uo pipefail
cd "$(dirname "$0")/.."

MIN_AGE_DAYS="${MIN_AGE_DAYS:-30}"
MIN_WEEKLY_DL="${MIN_WEEKLY_DL:-1000}"
BASE="${1:-}"

if [[ -z "$BASE" ]]; then
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    BASE="origin/main"
  elif git rev-parse --verify main >/dev/null 2>&1; then
    BASE="main"
  else
    BASE=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  fi
fi
if [[ -z "$BASE" ]]; then
  echo "could not determine base ref; pass one explicitly"
  exit 64
fi

# All shipped npm manifests — the sidecar is compiled into release
# binaries and the website deploys publicly, so a hallucinated package
# in either is just as dangerous as in the root (audit 20260612 H26).
# Rust deps are covered separately: cargo-audit in CI + Dependabot's
# cargo ecosystem (see .claude/rules/60-ai-governance.md §4).
MANIFESTS=("package.json" "vmark-mcp-server/package.json" "website/package.json")

# Diff dependency OBJECTS via JSON parsing, not grep over diff lines —
# the old grep matched script entries like "e2e:smoke" and fed npm
# unparseable names, which then failed open (audit 20260612 H26).
NEW_PKGS=""
for mf in "${MANIFESTS[@]}"; do
  [[ -f "$mf" ]] || continue
  BASE_JSON=$(git show "$BASE:$mf" 2>/dev/null || echo '{}')
  ADDED=$(BASE_JSON="$BASE_JSON" node -e '
    const fs = require("fs");
    const cur = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let base = {};
    try { base = JSON.parse(process.env.BASE_JSON || "{}"); } catch {}
    const entries = (o) => Object.entries({
      ...(o.dependencies || {}),
      ...(o.devDependencies || {}),
      ...(o.optionalDependencies || {}),
    });
    const baseNames = new Set(entries(base).map(([n]) => n));
    for (const [name, spec] of entries(cur)) {
      if (baseNames.has(name)) continue;
      // Local references are not registry packages.
      if (/^(workspace:|link:|file:)/.test(String(spec))) continue;
      console.log(name);
    }
  ' "$mf" 2>/dev/null) || {
    echo "  ✗ failed to parse $mf — failing closed"
    exit 1
  }
  if [[ -n "$ADDED" ]]; then
    echo "new dependencies in $mf:"
    echo "$ADDED" | sed 's/^/    /'
    NEW_PKGS+="$ADDED"$'\n'
  fi
done
NEW_PKGS=$(printf '%s' "$NEW_PKGS" | sort -u)

if [[ -z "$NEW_PKGS" ]]; then
  echo "no new dependencies vs $BASE — clean"
  exit 0
fi

echo "Inspecting newly-added dependencies (vs $BASE):"
echo

FLAGGED=0
NOW_EPOCH=$(date +%s)
SECS_PER_DAY=86400

while IFS= read -r pkg; do
  [[ -z "$pkg" ]] && continue

  # Fetch metadata. `npm view <pkg> --json` returns full registry doc.
  # Fail CLOSED: any error — 404, invalid name, network failure — flags
  # the package. A gate that can't see the registry must not pass
  # (audit 20260612 H26).
  META=$(npm view "$pkg" --json 2>&1) || {
    if echo "$META" | grep -q "E404"; then
      echo "  ✗ $pkg — NOT FOUND on npm (likely hallucinated)"
    else
      echo "  ✗ $pkg — npm metadata lookup failed (failing closed): $(echo "$META" | head -1)"
    fi
    FLAGGED=$((FLAGGED+1))
    continue
  }
  if [[ -z "$META" ]]; then
    echo "  ✗ $pkg — empty npm metadata (failing closed)"
    FLAGGED=$((FLAGGED+1))
    continue
  fi

  # Created date.
  CREATED=$(echo "$META" | node -e "
    let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{
      try{const d=JSON.parse(s);
        const t=d.time && d.time.created;
        process.stdout.write(t||'');}catch(e){}})
  " 2>/dev/null)

  AGE_DAYS="?"
  if [[ -n "$CREATED" ]]; then
    CREATED_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${CREATED%.*}" +%s 2>/dev/null \
      || date -d "$CREATED" +%s 2>/dev/null || echo 0)
    if (( CREATED_EPOCH > 0 )); then
      AGE_DAYS=$(( (NOW_EPOCH - CREATED_EPOCH) / SECS_PER_DAY ))
    fi
  fi

  # Weekly downloads (separate API).
  ENC_PKG=$(printf '%s' "$pkg" | sed 's:/:%2F:g')
  DL_JSON=$(curl -fsSL --max-time 10 "https://api.npmjs.org/downloads/point/last-week/${ENC_PKG}" 2>/dev/null || echo "")
  WEEKLY="?"
  if [[ -n "$DL_JSON" ]]; then
    WEEKLY=$(echo "$DL_JSON" | node -e "
      let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{
        try{const d=JSON.parse(s);
          process.stdout.write(String(d.downloads ?? '?'));}catch(e){}})
    " 2>/dev/null || echo "?")
  fi

  # Flag conditions. Unknown metadata ("?") flags too — fail closed
  # rather than passing a package the registry can't describe.
  REASONS=()
  if [[ "$AGE_DAYS" == "?" ]]; then
    REASONS+=("creation date unavailable (fail closed)")
  elif (( AGE_DAYS < MIN_AGE_DAYS )); then
    REASONS+=("created ${AGE_DAYS}d ago (<${MIN_AGE_DAYS})")
  fi
  if [[ "$WEEKLY" == "?" ]]; then
    REASONS+=("download count unavailable (fail closed)")
  elif (( WEEKLY < MIN_WEEKLY_DL )); then
    REASONS+=("$WEEKLY dl/week (<${MIN_WEEKLY_DL})")
  fi

  if (( ${#REASONS[@]} > 0 )); then
    JOIN=$(IFS=', '; echo "${REASONS[*]}")
    echo "  ⚠ $pkg — flagged: $JOIN  (age=${AGE_DAYS}d, dl/wk=${WEEKLY})"
    FLAGGED=$((FLAGGED+1))
  else
    echo "  ✓ $pkg — age=${AGE_DAYS}d, dl/wk=${WEEKLY}"
  fi
done <<< "$NEW_PKGS"

echo
if (( FLAGGED > 0 )); then
  echo "$FLAGGED new dependency(ies) flagged for review."
  echo "If a flag is a false positive, document why in the PR description."
  echo "If a flag is real, consider it a possible LLM hallucination or slopsquat."
  exit 1
fi
echo "All new dependencies pass slopsquatting heuristics."
exit 0
