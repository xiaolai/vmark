#!/usr/bin/env bash
#
# Slopsquatting gate: scan ALL npm manifests (root, server/mcp,
# server/content, website) for newly-added dependencies and report metadata (creation
# date, weekly downloads). Fails CLOSED on any metadata failure. Flags
# any package that's:
#   - non-existent on npm or unqueryable (likely hallucinated)
#   - created less than $MIN_AGE_DAYS ago (default 30)
#   - has fewer than $MIN_WEEKLY_DL weekly downloads (default 1000)
#   - installed from somewhere the registry cannot vouch for (git, URL, tarball)
#
# The package that is CHECKED is the package that is INSTALLED. An alias
# (`"lodash": "npm:something-else@1"`) is looked up by its target, and
# re-pointing an existing name at a different package counts as new — otherwise
# a healthy-looking key would launder whatever it resolves to.
#
# `npm` and `curl` are found on PATH, which is how the self-test swaps in a
# stub registry.
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
#  64  bad invocation, or a base ref that does not resolve
#
# @coordinates-with scripts/check-new-deps.test.mjs — runs this against a stub registry

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
# A ref that names nothing would make every `git show` below fail, and a failed
# `git show` is also what a manifest that is new on this branch looks like.
# Tell the two apart here, once, rather than guessing per manifest.
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null 2>&1; then
  echo "base ref '$BASE' does not resolve to a commit"
  exit 64
fi

# All shipped npm manifests — the sidecar is compiled into release
# binaries and the website deploys publicly, so a hallucinated package
# in either is just as dangerous as in the root.
# Rust deps are covered separately: cargo-audit in CI + Dependabot's
# cargo ecosystem (see .claude/rules/60-ai-governance.md §4).
MANIFESTS=("package.json" "server/mcp/package.json" "server/content/package.json" "website/package.json")

# Diff dependency OBJECTS via JSON parsing, not grep over diff lines —
# the old grep matched script entries like "e2e:smoke" and fed npm
# unparseable names, which then failed open.
NEW_PKGS=""
for mf in "${MANIFESTS[@]}"; do
  [[ -f "$mf" ]] || continue
  BASE_JSON=$(git show "$BASE:$mf" 2>/dev/null || echo '{}')
  ADDED=$(BASE_JSON="$BASE_JSON" node -e '
    const fs = require("fs");
    const cur = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let base = {};
    try { base = JSON.parse(process.env.BASE_JSON || "{}"); } catch {}
    // The package an override selector names: the last `>` segment of a
    // parent path, without its version range (`undici@<6`, `a>@s/b@2`,
    // yarn `**/lodash`).
    const overridden = (selector) => {
      const last = selector.split(">").pop().split("/**/").pop().replace(/^\*\*\//, "");
      const at = last.indexOf("@", last.startsWith("@") ? 1 : 0);
      return at === -1 ? last : last.slice(0, at);
    };
    // Overrides redirect what a dependency installs without touching a
    // dependency map, so each is read as a [package, spec] entry. npm nests
    // them (`{ foo: { ".": spec, bar: spec } }`); `.` is the parent itself.
    const overrideEntries = (map, parent) => Object.entries(map || {}).flatMap(([sel, spec]) => {
      if (spec !== null && typeof spec === "object") return overrideEntries(spec, overridden(sel));
      return [[sel === "." ? parent : overridden(sel), spec]];
    });
    const entries = (o) => [
      ...Object.entries({
        ...(o.dependencies || {}),
        ...(o.devDependencies || {}),
        ...(o.optionalDependencies || {}),
      }),
      ...overrideEntries((o.pnpm || {}).overrides),
      ...overrideEntries(o.overrides),
      ...overrideEntries(o.resolutions),
    ];
    // What a dependency entry actually installs, as one tab-separated line:
    //   R <package>        a registry package (an alias resolves to its target)
    //   U <name> <spec>    a spec the registry cannot vouch for
    //   null               a local reference, not a package at all
    const resolve = (name, rawSpec) => {
      const spec = String(rawSpec).trim();
      if (/^(workspace:|link:|file:)/.test(spec)) return null;
      // Override-only forms: `$name` reuses the spec of a direct dependency and
      // `-` removes the package; neither installs anything new.
      if (spec.startsWith("$") || spec === "-") return null;
      if (spec.startsWith("npm:")) {
        const target = spec.slice(4);
        const at = target.indexOf("@", target.startsWith("@") ? 1 : 0);
        return "R\t" + (at === -1 ? target : target.slice(0, at));
      }
      // A registry range or dist-tag has no path separator and no protocol.
      // Everything that does (git, github shorthand, http tarball) installs
      // code no registry lookup describes.
      if (/[\/:]/.test(spec) && !spec.startsWith("catalog:")) return "U\t" + name + "\t" + spec;
      return "R\t" + name;
    };
    const installed = (o) => new Set(
      entries(o).map(([name, spec]) => resolve(name, spec)).filter(Boolean),
    );
    const before = installed(base);
    for (const line of installed(cur)) {
      if (!before.has(line)) console.log(line);
    }
  ' "$mf" 2>/dev/null) || {
    echo "  ✗ failed to parse $mf — failing closed"
    exit 1
  }
  if [[ -n "$ADDED" ]]; then
    echo "new dependencies in $mf:"
    echo "$ADDED" | cut -f2- | tr '\t' ' ' | sed 's/^/    /'
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

while IFS=$'\t' read -r kind pkg spec; do
  [[ -z "$kind" ]] && continue

  if [[ "$kind" != "R" ]]; then
    # Not a registry version: there is no creation date or download count to
    # read, so nothing can vouch for it. Fail closed.
    echo "  ✗ $pkg — not a registry version ($spec); nothing vouches for what it installs"
    FLAGGED=$((FLAGGED+1))
    continue
  fi

  # Fetch metadata. `npm view <pkg> --json` returns full registry doc.
  # Fail CLOSED: any error — 404, invalid name, network failure — flags
  # the package. A gate that can't see the registry must not pass.
  META=$(npm view "$pkg" --json 2>&1) || {
    # Here-string, not a pipe: under pipefail an `echo | grep -q` fails when
    # grep exits on its first match and echo dies of SIGPIPE.
    if grep -q "E404" <<<"$META"; then
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
  # Only a plain non-negative integer is a count. Bash arithmetic would read
  # any other token as a variable NAME, so a stray word either aborts the run
  # or compares some unrelated value against the threshold.
  [[ "$WEEKLY" =~ ^[0-9]+$ ]] || WEEKLY="?"

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
    # `IFS=', '` would join on its FIRST character only.
    JOIN=$(printf '%s, ' "${REASONS[@]}")
    JOIN="${JOIN%, }"
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
