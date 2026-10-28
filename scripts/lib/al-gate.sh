#!/usr/bin/env bash
#
# Shared helpers for the agent-edit-ledger gates (scripts/check-al-phase.sh,
# scripts/check-al-slice.sh). Source AFTER scripts/lib/dod-assertions.sh, with
# the working directory at the tree under test and EXEC set by the caller.
#
# Self-contained by design: the plan these gates enforce is maintainer-local
# and gitignored, so every assertion is a concrete path, symbol or command
# written here, and nothing reads the plan. When the plan's Definition of Done
# changes, this file changes with it.
#
# Tests are found by HEADER, the convention scripts/check-wi-linkage.sh reads:
# a test file of any vitest tier, or a Rust `*.test.rs`, whose first 30 lines
# cite the work-item id as a whole token (`X1.1` never links `X1.10`). That
# keeps the gates independent of file names that do not exist yet. Each linked
# file must be a test its runner collects (assert_test_file) and is then RUN —
# vitest per tier, cargo filtered to the module that mounts each Rust test —
# so "a test exists" can never stand in for "the test passes". What a slice
# must PROVE is pinned by keyword assertions over the linked files
# (al_tests_cover, al_test_has): a coverage proxy that fails when a named
# scenario has no test mentioning it. The mention must be in code a runnable
# test case REACHES — its title, its table, its body, a suite title over it, a
# hook, a fixture it reads or a helper it calls — read through
# scripts/dod-syntax.mjs `--test-reach`. Those probes recognize a documented
# subset of test registration and evidence-reference forms; unsupported or
# ambiguous paths contribute no evidence. So a comment, an unused fixture
# string, a helper nothing calls or only stores, a body nested and never
# invoked, a case registered under a branch or through a forwarded callback,
# and a skipped or compiled-out case prove nothing beside an unrelated passing
# test. It stays a proxy: reached is not asserted, which only reading the
# test refutes, and the linked tests are RUN separately.

AL_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AL_TEST_ROOTS=(src src-tauri/src scripts .claude/hooks e2e)

# One scratch directory per run, checked: an unwritable TMPDIR would otherwise
# leave empty paths behind and every later assertion would fail for a reason
# that has nothing to do with what it checks.
AL_SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/al-gate.XXXXXX" 2>/dev/null)" && [[ -d "$AL_SCRATCH" ]] || {
  echo "al-gate: cannot create a scratch directory under ${TMPDIR:-/tmp} — set TMPDIR to a writable directory" >&2
  exit 70
}
trap 'rm -rf "$AL_SCRATCH"' EXIT

# A misspelled helper used to be silent: bash printed "command not found" and
# the assertion counted as neither pass nor fail. The handler runs in a
# subshell, so the miss is recorded on disk for the summary.
AL_MISSING_MARK="$AL_SCRATCH/missing"
: >"$AL_MISSING_MARK"
command_not_found_handle() { echo "  ✗ '$1' is not a command or helper this gate defines"; echo "$1" >>"$AL_MISSING_MARK"; return 127; }

# al_parse_args <valid ERE> <usage fn> "$@" → sets AL_TARGET, ROOT, EXEC; exits 64 on misuse.
al_parse_args() {
  local valid="$1" usage="$2" arg; shift 2
  AL_TARGET=""; EXEC=1
  # shellcheck disable=SC2034  # EXEC is read by dod-assertions.sh assert_exec
  for arg in "$@"; do
    case "$arg" in
      --root=*) ROOT="${arg#--root=}" ;;
      --no-exec) EXEC=0 ;;
      -*) echo "unknown option: $arg" >&2; exit 64 ;;
      *) if [[ -n "$AL_TARGET" ]]; then echo "expected one target, got '$AL_TARGET' and '$arg'" >&2; exit 64; fi
         AL_TARGET="$arg" ;;
    esac
  done
  [[ -n "$AL_TARGET" ]] || { "$usage"; exit 64; }
  [[ "$AL_TARGET" =~ $valid ]] || { echo "unknown target: $AL_TARGET" >&2; "$usage"; exit 64; }
  [[ -d "$ROOT" ]] || { echo "--root is not a directory: $ROOT" >&2; exit 64; }
}

# Every test file in the tree, NUL-separated, listed once per run: the tree
# has thousands, and walking it per work item made a phase take a minute.
AL_TEST_LIST="$AL_SCRATCH/tests"
_AL_LISTED=0
_al_list_tests() {
  (( _AL_LISTED )) && return
  find "${AL_TEST_ROOTS[@]}" \( -name node_modules -o -name target -o -name dist \) -prune -o -type f -print 2>/dev/null \
    | grep -E '\.(test|spec)\.(js|mjs|cjs|ts|mts|cts|jsx|tsx|rs)$' | LC_ALL=C sort | tr '\n' '\0' >"$AL_TEST_LIST"
  _AL_LISTED=1
}

# Test files whose first 30 lines cite `$1` as a whole token, sorted. One awk
# pass reads at most 30 lines of each file; the regex travels through ENVIRON
# because `awk -v` would rewrite its backslashes.
al_linked_tests() {
  _al_list_tests
  [[ -s "$AL_TEST_LIST" ]] || return 0
  # shellcheck disable=SC2016  # the awk program is literal; the regex arrives via ENVIRON
  AL_RE="(^|[^A-Za-z0-9.-])$(_ere_escape "$1")([^0-9A-Za-z]|\$)" \
    xargs -0 awk 'FNR > 30 { nextfile } $0 ~ ENVIRON["AL_RE"] { print FILENAME; nextfile }' <"$AL_TEST_LIST" \
    | LC_ALL=C sort -u
}

# Sets _AL_MOD to the module path of one Rust source file, "" for the crate
# root. The file path is the module path (`a/b.rs` → `a::b`, `a/mod.rs` → `a`)
# unless a sibling mounts the file under another name with `#[path = "…"]`:
# `#[path = "writer_replay.rs"] mod replay;` in `a/writer.rs` makes
# `a/writer_replay.rs` the module `a::writer::replay`, and a filter built from
# the file name would match no test at all.
_al_module_path() {
  local file="$1" depth="${2:-0}" dir base sib name m
  _AL_MOD=""
  dir="$(dirname "$file")"; base="$(basename "$file")"
  if (( depth < 8 )); then
    for sib in "$dir"/*.rs; do
      [[ -f "$sib" && "$sib" != "$file" ]] || continue
      name="$(awk -v want="$base" '
        /^[[:space:]]*\/\// { next }
        match($0, /#\[path[[:space:]]*=[[:space:]]*"[^"]*"\]/) {
          p = substr($0, RSTART, RLENGTH); sub(/^#\[path[[:space:]]*=[[:space:]]*"/, "", p); sub(/"\]$/, "", p)
          armed = (p == want) ? 4 : 0; next
        }
        armed > 0 {
          if (match($0, /^[[:space:]]*(pub(\([^)]*\))?[[:space:]]+)?mod[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]*;/)) {
            m = substr($0, RSTART, RLENGTH); sub(/;$/, "", m); sub(/[[:space:]]*$/, "", m); sub(/.*mod[[:space:]]+/, "", m)
            print m; exit
          }
          armed--
        }' "$sib")"
      if [[ -n "$name" ]]; then
        _al_module_path "$sib" $((depth + 1))
        _AL_MOD="${_AL_MOD:+$_AL_MOD::}$name"
        return 0
      fi
    done
  fi
  m="${file#src-tauri/src/}"; m="${m%.rs}"; m="${m%/mod}"
  case "$m" in lib|main) _AL_MOD="" ;; *) _AL_MOD="${m//\//::}" ;; esac
}

# Sets _AL_FILTER to the cargo filter for one Rust test: the module path of
# the file that mounts it followed by `::`, or "" when the crate root mounts
# it (run the whole crate). Global, not printed: a command substitution would
# leave the dod-syntax probe server.
al_rust_filter() {
  local f="$1" owner=""
  if [[ -f "${f%.test.rs}.rs" ]] && rust_test_included "${f%.test.rs}.rs" "$(basename "$f")"; then owner="${f%.test.rs}.rs"
  else rust_mount_owner "$f" >/dev/null; owner="$_DOD_MOUNT"; fi
  _AL_FILTER="-"
  [[ -n "$owner" ]] || return 1
  _al_module_path "$owner"
  _AL_FILTER="${_AL_MOD:+$_AL_MOD::}"
}

# cargo test over the given filters, failing when no test ran: a filter that
# matches nothing exits 0, and a gate that read that as green would be passing
# on zero evidence.
al_cargo_test() {
  local out rc n
  out="$(cargo test --manifest-path src-tauri/Cargo.toml --lib -- "$@" 2>&1)"; rc=$?
  printf '%s\n' "$out"
  (( rc == 0 )) || return "$rc"
  n="$(sed -n 's/^test result: ok\. \([0-9][0-9]*\) passed.*/\1/p' <<<"$out" | awk '{ s += $1 } END { print s + 0 }')"
  (( n > 0 )) || { echo "cargo ran 0 tests for: ${*:-<whole crate>}"; return 1; }
}

# al_require_tests <work item>: at least one linked test, each collectable,
# and every one of them run green.
al_require_tests() {
  local wi="$1" files f n
  local app=() gates=() browser=() soak=() rust=() filters=() whole=0
  _al_list_tests   # in this shell: the substitution below cannot set the flag
  files="$(al_linked_tests "$wi")"
  if [[ -z "$files" ]]; then fail "$wi: no test file names $wi in its header (first 30 lines of a *.test.* file)"; return; fi
  n="$(wc -l <<<"$files" | tr -d ' ')"
  ok "$wi: $n linked test file(s)"
  while IFS= read -r f; do
    assert_test_file "$f" "$wi test $f"
    case "$f" in
      *.test.rs) rust+=("$f") ;;
      src/*.webkit.test.*) browser+=("$f") ;;
      src/*.soak.test.*) soak+=("$f") ;;
      src/*) app+=("$f") ;;
      *) gates+=("$f") ;;
    esac
  done <<<"$files"
  (( ${#app[@]} ))     && assert_exec "$wi: vitest app tier (${#app[@]} file(s))" pnpm vitest run "${app[@]}"
  (( ${#gates[@]} ))   && assert_exec "$wi: vitest gates tier (${#gates[@]} file(s))" pnpm vitest run --config vitest.gates.config.ts "${gates[@]}"
  (( ${#browser[@]} )) && assert_exec "$wi: vitest browser tier (${#browser[@]} file(s))" pnpm vitest run --config vitest.browser.config.ts "${browser[@]}"
  (( ${#soak[@]} ))    && assert_exec "$wi: vitest soak tier (${#soak[@]} file(s))" pnpm vitest run --config vitest.soak.config.ts "${soak[@]}"
  if (( ${#rust[@]} )); then
    for f in "${rust[@]}"; do
      al_rust_filter "$f" || continue   # unmounted: assert_test_file already failed it
      if [[ -z "$_AL_FILTER" ]]; then whole=1
      elif [[ " ${filters[*]:-} " != *" $_AL_FILTER "* ]]; then filters+=("$_AL_FILTER"); fi
    done
    (( whole )) && filters=()
    if (( whole || ${#filters[@]} )); then
      assert_exec "$wi: cargo test ${filters[*]:-<whole crate>}" al_cargo_test ${filters[@]+"${filters[@]}"}
    fi
  fi
  return 0
}

# _al_code_match <ERE> <file> [--keep-strings|--test-reach] [--ignore-case]:
# the CODE of one .rs / .ts / .tsx / .js / .mjs file matches (comments always
# blanked; literals too unless --keep-strings; with --test-reach, only what
# the file's runnable test cases reach, literals kept). A plain text grep NARROWS first — the
# probe only removes text, so a file it rejects cannot match — and the probe
# decides. The pattern is read as a JavaScript regex: the EREs written in
# these gates (alternation, `.{0,40}`, `?`, escaped dots) mean the same there.
_al_code_match() {
  local re="$1" file="$2" probe="ts-code-grep" gflags="-qE"; shift 2
  [[ " $* " == *" --ignore-case "* ]] && gflags="-qiE"
  grep "$gflags" -- "$re" "$file" 2>/dev/null || return 1
  [[ "$file" == *.rs ]] && probe="rust-code-grep"
  dod_syntax "$probe" "$@" "$re" "$file" >/dev/null 2>&1
}

# al_tests_cover "<work item> [<work item>…]" <ERE> <label>: the code some
# runnable case of a test linked to one of the work items reaches mentions the
# scenario (case-insensitive).
_AL_COVER_KEY=""; _AL_COVER_FILES=""
al_tests_cover() {
  local wis="$1" re="$2" label="$3" wi f
  if [[ "$_AL_COVER_KEY" != "$wis" ]]; then
    _al_list_tests
    _AL_COVER_FILES=""
    for wi in $wis; do _AL_COVER_FILES+="$(al_linked_tests "$wi")"$'\n'; done
    _AL_COVER_KEY="$wis"
  fi
  while IFS= read -r f; do
    [[ -n "$f" ]] && _al_code_match "$re" "$f" --test-reach --ignore-case && { ok "$label"; return; }
  done <<<"$_AL_COVER_FILES"
  fail "$label (no test linked to $wis matches /$re/i in code its runnable cases reach — comments and unused code do not count)"
}

# al_test_has <work item> <path ERE> <label> <ERE>…: the code the runnable
# cases of ONE test linked to the work item reach, its path matching, mentions
# every scenario (case-insensitive). Facts that must hold together — a live plugin change
# both warns and breaks; an IME run drives both collectors in real WebKit —
# cannot be split across files and still pass.
al_test_has() {
  local wi="$1" path_re="$2" label="$3" f re all
  shift 3
  _al_list_tests
  while IFS= read -r f; do
    [[ -n "$f" ]] && grep -qE -- "$path_re" <<<"$f" || continue
    all=1
    for re in "$@"; do _al_code_match "$re" "$f" --test-reach --ignore-case || { all=0; break; }; done
    (( all )) && { ok "$label ($f)"; return; }
  done <<<"$(al_linked_tests "$wi")"
  fail "$label (no test linked to $wi under /$path_re/ matches all of: $* — in code its runnable cases reach; comments and unused code do not count)"
}

# al_test_for_target <work item> <path ERE> <label> <target os> <ERE>…:
# al_test_has for a Rust witness this host cannot run — the cases cargo
# compiles when the crate is built for <target os> (macos, linux, windows),
# not for the host. What it verifies, statically: the witness file is mounted
# for that target (every `mod`/`#[path]` declaration from lib.rs down live
# there, scripts/rust-target-mount.mjs; a feature-gated mount fails closed)
# and a runnable #[test] built for that target reaches each ERE. It does NOT
# establish that the test ran anywhere: this gate never executes it, and the
# ok line says so. Not a substitute for al_test_has: a host requirement stays
# host-executed.
al_test_for_target() {
  local wi="$1" path_re="$2" label="$3" os="$4" f re all mount where
  shift 4
  case "$os" in
    windows) where="Windows CI only" ;;
    linux) where="Linux CI only" ;;
    macos) where="macOS CI only" ;;
    *) fail "$label — unknown target '$os' (macos, linux or windows)"; return ;;
  esac
  _al_list_tests
  while IFS= read -r f; do
    if [[ -z "$f" || "$f" != *.rs ]] || ! grep -qE -- "$path_re" <<<"$f"; then continue; fi
    if ! mount="$(node "$AL_SCRIPTS/rust-target-mount.mjs" "$os" "$f" 2>&1)"; then
      fail "$label — $os witness ($f is not compiled for $os: $mount)"; return
    fi
    all=1
    for re in "$@"; do _al_code_match "$re" "$f" --test-reach "--target=$os" --ignore-case || { all=0; break; }; done
    (( all )) && { ok "$label — $os witness (compiled for $os; NOT executed by this gate ($where)) ($f)"; return; }
  done <<<"$(al_linked_tests "$wi")"
  fail "$label — $os witness (no Rust test linked to $wi under /$path_re/ matches all of: $* — in code its cases built for $os reach)"
}

# al_code_has <ERE> <dir> <label> [--keep-strings]: the CODE of a non-test
# .ts/.tsx/.rs file under dir matches. A comment, a commented-out call or a
# doc comment naming the symbol does not; a string literal does only with
# --keep-strings, for a subject that IS a literal (a branch prefix).
al_code_has() {
  local re="$1" dir="$2" label="$3" keep="${4:-}" f
  if [[ ! -d "$dir" ]]; then fail "$label (directory missing: $dir)"; return; fi
  while IFS= read -r -d '' f; do
    _al_code_match "$re" "$f" ${keep:+--keep-strings} && { ok "$label ($f)"; return; }
  done < <(find "$dir" \( -name node_modules -o -name target \) -prune -o -type f \
             \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' \) ! -name '*.test.*' ! -name '*.d.ts' -print0 2>/dev/null \
           | xargs -0 grep -lE --null -- "$re" 2>/dev/null)
  fail "$label (no /$re/ in the code of non-test source under $dir — a comment does not count)"
}

# al_pkg_dep <package> <label>: a runtime dependency in package.json, parsed.
al_pkg_dep() {
  if node -e 'const p=JSON.parse(require("fs").readFileSync("package.json","utf8"));process.exit((p.dependencies||{})[process.argv[1]]?0:1)' "$1" 2>/dev/null
  then ok "$2"; else fail "$2 (no dependencies.$1 in package.json)"; fi
}

# One spike artifact, judged by the gate's own checker against this tree.
al_spike() {
  local msg rc
  msg="$(node "$AL_SCRIPTS/check-al-spike-results.mjs" --root="$PWD" "$1" 2>&1)"; rc=$?
  if (( rc == 0 )); then ok "spike $1: $msg"; else fail "spike $1: $msg"; fi
}

# A slow command (check:all, the whole crate, clippy) runs only while the
# phase is still green: once an assertion has failed the phase is red anyway,
# and minutes spent confirming it buy nothing.
al_exec_when_green() {
  local label="$1"; shift
  if (( FAIL > 0 )); then echo "  · $label — not run: earlier assertions failed"; return; fi
  assert_exec "$label" "$@"
}

al_summary() {
  local name="$1" missing
  echo
  missing="$(wc -l <"$AL_MISSING_MARK" | tr -d ' ')"
  if (( missing > 0 )); then
    echo "$name: $missing assertion(s) called something undefined — they checked NOTHING:"
    sort -u "$AL_MISSING_MARK" | sed 's/^/  - /'
    exit 1
  fi
  echo "$name: $PASS passed, $FAIL failed, $UNVERIFIED unverified."
  if (( FAIL > 0 || UNVERIFIED > 0 )); then
    echo "Not done:"; for d in "${FAIL_DETAIL[@]}"; do echo "  - $d"; done
    exit 1
  fi
  exit 0
}
