#!/usr/bin/env bash
#
# Theme-name invariant check (Phase 5.2 of theme-unification-2026-05).
#
# Hard-coded theme-name strings ("paper", "white", "mint", "sepia",
# "night") may only appear inside the theme catalog (src/theme/themes/),
# the ThemeId union (src/theme/themes/index.ts + src/stores/settingsTypes.ts),
# and the screenshot-baseline runbook. Anywhere else and the
# single-source-of-truth promise leaks — adding a 6th theme would need
# to track down every literal.
#
# Exits 0 if clean, 1 with a list of offending locations otherwise.
#
# Allow-listed paths (these are the legitimate places to enumerate
# theme names):
#   - src/theme/themes/**                  (theme catalog itself)
#   - src/stores/settingsTypes.ts          (ThemeId TS union)
#   - src/locales/**                       (translated theme labels)
#   - src-tauri/locales/**                 (Rust-side translated labels)
#   - dev-docs/baselines/**                (PNG filenames named per theme)
#   - dev-docs/plans/**                    (plan documents describing themes)
#   - dev-docs/grills/**                   (spike/probe artifacts)
#   - dev-docs/archive/**                  (historical docs)
#   - website/**                           (user-facing docs)
#   - **/__snapshots__/**                  (test snapshot files)
#   - The check script itself.
#
# Words like "paper" that appear in unrelated prose (e.g. "white space")
# are excluded via a per-context regex — see below.

set -euo pipefail

# The theme tokens that must not leak. We treat them as identifier-like:
# bounded by non-alphanumeric chars on both sides, AND quoted (single,
# double, or backtick) — bare prose mentions don't count.
# Pattern: a quote, then the exact theme word, then a quote.
THEME_NAMES='"(paper|white|mint|sepia|night|solarized)"|'\''(paper|white|mint|sepia|night|solarized)'\''|`(paper|white|mint|sepia|night|solarized)`'

# Allow-listed paths. Listed as regex alternation for grep -E.
#   - Theme module owns the catalog + the runtime mapping.
#   - settingsStore.ts holds the default `theme: "paper"`; settingsTypes.ts has the ThemeId union.
#   - useTheme.ts / useIsDarkTheme.ts are the runtime writers; they read theme names.
#   - Tests asserting theme behavior need to name themes.
#   - i18n locale files have user-facing theme labels.
#   - Docs (dev-docs/, website/, .claude/rules/) describe themes.
#   - The export reader bundle has its own theme handling.
#   - Snapshot files contain captured theme output.
ALLOWLIST='^src/theme/|^src/stores/settingsTypes\.ts$|^src/stores/settingsStore\.ts$|^src/hooks/useTheme\.ts$|^src/hooks/useIsDarkTheme\.ts$|^src/locales/|^src-tauri/locales/|^src/export/reader/|^dev-docs/|^website/|^\.claude/rules/|/__snapshots__/|\.test\.(ts|tsx)$|^scripts/check-theme-names\.sh$'

cd "$(git rev-parse --show-toplevel)"

# Find every file that contains a quoted theme name, then filter the
# allow-list, then print the offenders. Use git ls-files so we ignore
# build output, node_modules, etc.
offenders=$(
  git ls-files \
    | grep -vE "$ALLOWLIST" \
    | xargs grep -lE "$THEME_NAMES" 2>/dev/null \
    || true
)

if [[ -z "${offenders}" ]]; then
  echo "✔ check-theme-names: no theme-name leaks (paper/white/mint/sepia/night outside catalog)"
  exit 0
fi

echo "✘ check-theme-names: theme-name strings leaked outside the catalog"
echo
echo "The following files contain a quoted theme name (\"paper\", 'mint',"
echo "etc.) but are outside the allow-listed directories. The single-"
echo "source-of-truth invariant (ADR-014 / theme-unification-2026-05)"
echo "requires theme-name strings to live only in:"
echo "  - src/theme/themes/        (catalog)"
echo "  - src/stores/settingsTypes.ts  (ThemeId)"
echo "  - src/locales/             (i18n labels)"
echo "  - src-tauri/locales/       (i18n labels, Rust side)"
echo "  - dev-docs/{baselines,plans,grills,archive}/"
echo "  - website/                 (user docs)"
echo "  - **/__snapshots__/        (test snapshots)"
echo
echo "Offending files:"
echo "$offenders" | sed 's/^/  /'
echo
echo "If a new location is legitimately needed, add it to the ALLOWLIST"
echo "in scripts/check-theme-names.sh with a comment explaining why."
exit 1
