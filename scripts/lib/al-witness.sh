#!/usr/bin/env bash
#
# Named witnesses for the agent-edit-ledger phase gate: every Definition-of-
# Done row of a phase maps to ONE test that proves it, listed in
# scripts/al-witnesses.json (row, work item, file, exact title, runner and the
# regexes its own code must match). Source after scripts/lib/al-gate.sh and
# scripts/lib/dod-assertions.sh, with the working directory at the tree under
# test.
#
# Two lines per row:
#   `phase N witness — <row>`      static, always: the file exists and names
#     the work item in its header, exactly one plain runnable case carries the
#     title, and the code that case reaches matches every regex
#     (scripts/al-witness.mjs).
#   `phase N witness run — <row>`  that one test, run alone (assert_exec, so
#     `--no-exec` reports it UNVERIFIED): exactly one pass and the witness not
#     skipped, read from vitest's JSON report, cargo's per-test lines or the
#     e2e journey runner's PASS/FAIL/SKIP lines (a live debug build). A row
#     whose static check failed is not run.
# A keyword pre-check (al_tests_cover) is cheaper and coarser; these rows are
# what a phase is accepted on.

AL_WITNESS_CLI="$AL_SCRIPTS/al-witness.mjs"
AL_WITNESS_MANIFEST="$AL_SCRIPTS/al-witnesses.json"

# _al_vitest_witness <config or ""> <file> <title> <-t pattern>
_al_vitest_witness() {
  local cfg="$1" file="$2" title="$3" pattern="$4" json rc args=()
  json="$(mktemp "$AL_SCRATCH/witness.XXXXXX")" || return 70
  rm -f "$json"   # vitest must write it: an existing empty file would read as a report
  [[ -n "$cfg" ]] && args=(--config "$cfg")
  pnpm vitest run "${args[@]}" "$file" -t "$pattern" --reporter=json "--outputFile=$json" >/dev/null 2>&1; rc=$?
  node "$AL_WITNESS_CLI" vitest-report "$json" "$title" "$rc"
}

# _al_cargo_witness <module prefix> <fn>
_al_cargo_witness() {
  local prefix="$1" fn="$2" out rc status
  out="$(mktemp "$AL_SCRATCH/witness.XXXXXX")" || return 70
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- "$fn" >"$out" 2>&1; rc=$?
  node "$AL_WITNESS_CLI" cargo-report "$out" "$prefix" "$fn" "$rc" >"$out.verdict"; status=$?
  (( status == 0 )) || tail -n 5 "$out"
  cat "$out.verdict"
  return "$status"
}

# _al_e2e_witness <journey name>: the journey alone (`--only` is a substring
# filter, so the report demands exactly one PASS for this name and no FAIL),
# against the live debug build e2e/README.md describes. With no build running
# the runner exits non-zero and the row is red.
_al_e2e_witness() {
  local name="$1" out rc status
  out="$(mktemp "$AL_SCRATCH/witness.XXXXXX")" || return 70
  pnpm e2e:journeys --only "$name" >"$out" 2>&1; rc=$?
  node "$AL_WITNESS_CLI" e2e-report "$out" "$name" "$rc" >"$out.verdict"; status=$?
  (( status == 0 )) || tail -n 5 "$out"
  cat "$out.verdict"
  return "$status"
}

# al_witnesses <phase>: both lines for every row the manifest lists for it.
al_witnesses() {
  local phase="$1" out rc verdict row a b c d cfg
  echo "  — named witnesses (scripts/al-witnesses.json)"
  out="$(node "$AL_WITNESS_CLI" check "$AL_WITNESS_MANIFEST" "$phase" 2>&1)"; rc=$?
  if (( rc != 0 && rc != 1 )) || [[ -z "$out" ]]; then
    fail "phase $phase witnesses: scripts/al-witnesses.json was not checked (exit $rc)"
    printf '%s\n' "$out" | sed 's/^/      | /'
    return
  fi
  while IFS=$'\t' read -r -u 3 verdict row a b c d; do
    case "$verdict" in
      ok)   # a=runner b=file c=title d=-t pattern
        if [[ "$a" == cargo ]]; then
          if ! al_rust_filter "$b"; then
            fail "phase $phase witness — $row: $b is not mounted by any module, so cargo never compiles it"
            echo "  · phase $phase witness run — $row — not run: its static witness failed"
            continue
          fi
          ok "phase $phase witness — $row ($b: $c)"
          assert_exec "phase $phase witness run — $row" _al_cargo_witness "$_AL_FILTER" "$c"
        elif [[ "$a" == e2e ]]; then
          ok "phase $phase witness — $row ($b: $c)"
          assert_exec "phase $phase witness run — $row" _al_e2e_witness "$c"
        else
          ok "phase $phase witness — $row ($b: $c)"
          cfg=""
          [[ "$a" == webkit ]] && cfg=vitest.browser.config.ts
          assert_exec "phase $phase witness run — $row" _al_vitest_witness "$cfg" "$b" "$c" "$d"
        fi ;;
      fail)
        fail "phase $phase witness — $row: $a"
        echo "  · phase $phase witness run — $row — not run: its static witness failed" ;;
      *)
        fail "phase $phase witnesses: unreadable line from al-witness.mjs: $verdict $row $a" ;;
    esac
  done 3<<<"$out"
}
