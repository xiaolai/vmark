#!/usr/bin/env bash
# Landing differential harness (plan: 20260723-landing-refactor-to-main.md, WI-0.2).
#
# Proves what the branch changes for users vs a baseline ref, at the markdown
# round-trip level: renders `serializeMarkdown(parseMarkdown(input))` for every
# corpus fixture using EACH ref's OWN pipeline + schema, and diffs per fixture.
# The baseline ref runs in a throwaway worktree (its own code); the target ref's
# output is its committed characterization __golden__ files.
#
# Usage: scripts/landing-differential.sh [BASELINE_REF] [TARGET_REF]
#   defaults: BASELINE_REF=v0.9.7  TARGET_REF=HEAD
#
# Exit 0 always; prints the changed-fixture set. Interpret the changes: they must
# be exactly the documented behavior changes (e.g. D1-D4) — any other diff is an
# unintended regression and a landing blocker.
set -euo pipefail

BASE="${1:-v0.9.7}"
TARGET="${2:-HEAD}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
CORPUS="$SRC/src/utils/markdownPipeline/__tests__/characterization/corpus"
GOLD="$SRC/src/utils/markdownPipeline/__tests__/characterization/__golden__"
WT="$(mktemp -d)/landing-diff-$BASE"

cleanup() { git -C "$SRC" worktree remove --force "$WT" 2>/dev/null || true; }
trap cleanup EXIT

echo "== baseline=$BASE  target=$TARGET =="
git -C "$SRC" worktree add --detach "$WT" "$BASE" >/dev/null
ln -s "$SRC/node_modules" "$WT/node_modules"           # pipeline deps are ref-stable; verify if this ever changes
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

( cd "$WT" && CI=1 node_modules/.bin/vitest run src/utils/markdownPipeline/__diff__/emit.test.ts --no-coverage >/dev/null 2>&1 )

OUT="$WT/src/utils/markdownPipeline/__diff__/out"
changed=0; identical=0; errored=0
echo "-- per-fixture differential (baseline vs target golden) --"
for f in "$OUT"/*.md; do
  n="$(basename "$f")"; g="$GOLD/$n"
  [ -f "$g" ] || { echo "  $n: NO TARGET GOLDEN"; continue; }
  if grep -q '^__ERROR__' "$f"; then echo "  $n: BASELINE ERRORED"; errored=$((errored+1)); continue; fi
  if diff -q "$f" "$g" >/dev/null 2>&1; then identical=$((identical+1)); else echo "  CHANGED: $n"; changed=$((changed+1)); fi
done
echo "SUMMARY: $identical identical, $changed changed, $errored errored"
