#!/usr/bin/env bash
# Landing differential harness (plan: 20260723-landing-refactor-to-main.md, WI-0.2).
#
# Proves what the branch changes for users vs a baseline ref, at the markdown
# round-trip level: renders `serializeMarkdown(parseMarkdown(input))` for every
# corpus fixture and diffs baseline output against the target's committed
# characterization __golden__ files.
#
# Method + honest limits:
#   - The BASELINE ref runs in a throwaway worktree using its OWN pipeline
#     (`adapter.ts`) and its OWN schema content: `productionSchema.ts` is copied
#     in, but it is a thin wrapper `getSchema(createTiptapExtensions())`, and
#     `createTiptapExtensions` resolves to the BASELINE tree, so the schema is
#     the baseline's. The wrapper file is the only copied scaffolding.
#   - The TARGET side is NOT re-rendered; it uses the committed __golden__ files.
#     Those equal the target's round-trip output ONLY when TARGET is the current
#     checkout, so this script REQUIRES target == current HEAD and refuses
#     otherwise (a non-HEAD target would compare against the wrong goldens).
#   - node_modules is shared from the current worktree; the script ABORTS if the
#     two refs' `dependencies` (the pipeline-relevant set) differ.
#
# Usage: scripts/landing-differential.sh [BASELINE_REF] [TARGET_REF]
#   defaults: BASELINE_REF=v0.9.7  TARGET_REF=HEAD
#
# Exit: nonzero on any HARNESS failure (bad refs, dep mismatch, missing/extra
# fixtures, emitter error, vitest failure). Fixture *differences* do NOT affect
# exit status — they are the result; the script prints the changed-fixture set.
# Interpret changes: they must be exactly the documented behavior changes
# (e.g. D1-D4); any other diff is an unintended regression and a landing blocker.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
BASE_REF="${1:-v0.9.7}"
TARGET_REF="${2:-HEAD}"

# Resolve refs to commit hashes (--end-of-options guards refs with leading '-';
# resolution also guards refs with '/' or typos).
BASE="$(git -C "$SRC" rev-parse --verify --quiet --end-of-options "$BASE_REF^{commit}")" \
  || { echo "FATAL: baseline ref '$BASE_REF' does not resolve to a commit" >&2; exit 2; }
TARGET="$(git -C "$SRC" rev-parse --verify --quiet --end-of-options "$TARGET_REF^{commit}")" \
  || { echo "FATAL: target ref '$TARGET_REF' does not resolve to a commit" >&2; exit 2; }
HEAD_COMMIT="$(git -C "$SRC" rev-parse --verify HEAD)"

# The target side uses committed goldens == target output ONLY at current HEAD.
if [ "$TARGET" != "$HEAD_COMMIT" ]; then
  echo "FATAL: target ref '$TARGET_REF' ($TARGET) is not the current HEAD ($HEAD_COMMIT)." >&2
  echo "       This harness compares against committed __golden__ files, which are the" >&2
  echo "       target's round-trip output only at the checked-out commit. Check out the" >&2
  echo "       target ref first, or extend the script to render the target in its own worktree." >&2
  exit 2
fi

# The target side reuses committed inputs; a dirty working tree would silently
# invalidate the "committed goldens == target output" assumption.
# `git status --porcelain` catches modified, staged, AND untracked inputs
# (`git diff` alone would miss a new untracked fixture pair).
target_inputs_dirty="$(git -C "$SRC" status --porcelain -- \
      src/utils/markdownPipeline/__tests__/characterization/corpus \
      src/utils/markdownPipeline/__tests__/characterization/__golden__ \
      src/test/productionSchema.ts)"
if [ -n "$target_inputs_dirty" ]; then
  echo "FATAL: corpus / __golden__ / productionSchema.ts are not fully committed" >&2
  echo "       (modified, staged, or untracked). The target side compares against" >&2
  echo "       COMMITTED files — commit them first:" >&2
  printf '%s\n' "$target_inputs_dirty" >&2
  exit 2
fi

# node_modules is shared; abort if pipeline deps (the `dependencies` block) differ.
deps() { git -C "$SRC" show "$1:package.json" | python3 -c \
  'import json,sys; print(json.dumps(json.load(sys.stdin).get("dependencies",{}),sort_keys=True))'; }
# Capture into vars first (set -e aborts if extraction fails) and require non-empty,
# so two failed/empty results can't compare equal and bypass the guard.
base_deps="$(deps "$BASE")"
target_deps="$(deps "$TARGET")"
{ [ -n "$base_deps" ] && [ -n "$target_deps" ]; } \
  || { echo "FATAL: could not read dependencies from package.json at one of the refs" >&2; exit 2; }
if [ "$base_deps" != "$target_deps" ]; then
  echo "FATAL: baseline and target have different runtime dependencies; a shared" >&2
  echo "       node_modules would run the baseline against incompatible deps." >&2
  echo "       Install deps per-ref instead of symlinking, then re-run." >&2
  exit 2
fi

CORPUS="$SRC/src/utils/markdownPipeline/__tests__/characterization/corpus"
GOLD="$SRC/src/utils/markdownPipeline/__tests__/characterization/__golden__"
[ -d "$CORPUS" ] || { echo "FATAL: corpus dir missing: $CORPUS" >&2; exit 2; }
[ -d "$GOLD" ]   || { echo "FATAL: golden dir missing: $GOLD" >&2; exit 2; }
# nullglob arrays distinguish "empty dir" from a real listing error (which `ls
# | sort || true` would have masked as "no fixtures").
shopt -s nullglob
corpus_files=("$CORPUS"/*.md); gold_files=("$GOLD"/*.md)
shopt -u nullglob
[ "${#corpus_files[@]}" -gt 0 ] || { echo "FATAL: no corpus fixtures" >&2; exit 2; }
corpus_set="$(printf '%s\n' "${corpus_files[@]##*/}" | sort)"
gold_set="$(printf '%s\n' "${gold_files[@]##*/}" | sort)"
if [ "$corpus_set" != "$gold_set" ]; then
  echo "FATAL: corpus and golden filename sets differ (missing/extra fixtures):" >&2
  diff <(printf '%s\n' "$corpus_set") <(printf '%s\n' "$gold_set") >&2 || true
  exit 2
fi

TMP="$(mktemp -d)"
WT="$TMP/baseline-worktree"          # ref-independent path (no ref text embedded)
cleanup() {
  git -C "$SRC" worktree remove --force "$WT" 2>/dev/null || true
  rm -rf "$TMP" 2>/dev/null || true
}
trap cleanup EXIT

echo "== baseline=$BASE_REF ($BASE)  target=$TARGET_REF ($TARGET) =="
git -C "$SRC" worktree add --detach "$WT" "$BASE" >/dev/null
ln -s "$SRC/node_modules" "$WT/node_modules"
mkdir -p "$WT/src/test" "$WT/src/utils/markdownPipeline/__diff__/corpus"
cp "$SRC/src/test/productionSchema.ts" "$WT/src/test/productionSchema.ts"
cp "$CORPUS"/*.md "$WT/src/utils/markdownPipeline/__diff__/corpus/"

cat > "$WT/src/utils/markdownPipeline/__diff__/emit.test.ts" <<'TS'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../adapter";
import { getProductionSchema } from "@/test/productionSchema";
const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, "corpus");
const outDir = join(here, "out");
it("emit baseline round-trip", () => {
  mkdirSync(outDir, { recursive: true });
  const schema = getProductionSchema();
  for (const f of readdirSync(corpusDir).filter((n) => n.endsWith(".md")).sort()) {
    const input = readFileSync(join(corpusDir, f), "utf8");
    let out: string;
    try { out = serializeMarkdown(schema, parseMarkdown(schema, input)); }
    catch (e) { out = `__ERROR__ ${e instanceof Error ? e.message : String(e)}`; }
    writeFileSync(join(outDir, f), out);
  }
});
TS

# Run the emitter; a vitest failure aborts via set -e (its output is replayed on failure).
if ! ( cd "$WT" && CI=1 node_modules/.bin/vitest run \
        src/utils/markdownPipeline/__diff__/emit.test.ts --no-coverage ) >"$TMP/vitest.log" 2>&1; then
  echo "FATAL: baseline emitter (vitest) failed:" >&2; cat "$TMP/vitest.log" >&2; exit 2
fi

OUT="$WT/src/utils/markdownPipeline/__diff__/out"
[ -d "$OUT" ] && ls "$OUT"/*.md >/dev/null 2>&1 \
  || { echo "FATAL: emitter produced no output" >&2; exit 2; }

changed=0; identical=0; errored=0
echo "-- per-fixture differential (baseline vs target golden) --"
for f in "$OUT"/*.md; do
  n="$(basename "$f")"; g="$GOLD/$n"
  [ -f "$g" ] || { echo "  $n: NO TARGET GOLDEN"; errored=$((errored+1)); continue; }
  if grep -q '^__ERROR__' "$f"; then echo "  $n: BASELINE ERRORED"; errored=$((errored+1)); continue; fi
  if diff -q "$f" "$g" >/dev/null 2>&1; then identical=$((identical+1)); else echo "  CHANGED: $n"; changed=$((changed+1)); fi
done
echo "SUMMARY: $identical identical, $changed changed, $errored errored"
[ "$errored" -eq 0 ] || { echo "FATAL: $errored fixture(s) errored — harness result invalid" >&2; exit 1; }

# GATE mode: set EXPECT_IDENTICAL=1 to turn this into a pass/fail gate that FAILS
# on ANY changed fixture. Use it for the Phase-2 nucleus differential (baseline =
# the pre-nucleus release; a behavior-preserving nucleus must produce ZERO changes).
# Leave it unset for characterization (e.g. v0.9.7 vs the D1-D4-fixed line, where
# {14,16,17} are EXPECTED to change).
if [ "${EXPECT_IDENTICAL:-0}" = "1" ] && [ "$changed" -ne 0 ]; then
  echo "GATE FAIL: EXPECT_IDENTICAL=1 but $changed fixture(s) changed — a byte-identical" >&2
  echo "           baseline was required. Any change here is an undocumented regression." >&2
  exit 1
fi
