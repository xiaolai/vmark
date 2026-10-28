#!/usr/bin/env bash
#
# Shared assertion helpers for the plan DoD checkers (scripts/check-*-phase.sh).
# Source it AFTER `set -uo pipefail` and after `cd`-ing to the tree under test:
# it defines the PASS/FAIL/UNVERIFIED counters, the ok/fail/unverified
# reporters, and one assert_* per assertion kind.
#
# Text assertions match FIXED STRINGS (`grep -F`): callers pass filenames and
# code fragments, where `.`, `(` and `+` are literals and a regex near-miss
# (`baselineXjson` for `baseline.json`) must not pass. Regex is the explicit
# `_E` / `_Ei` variants, written in POSIX ERE (`[[:space:]]`, never `\s`), so
# the result does not depend on which grep is installed.
#
# @coordinates-with scripts/check-feature-ledger-phase.sh — the first consumer
# @coordinates-with scripts/check-repo-audit-phase.sh — asserts the audit plan's tests through assert_test_file

PASS=0; FAIL=0; UNVERIFIED=0; FAIL_DETAIL=()
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); FAIL_DETAIL+=("$1"); }
unverified() { echo "  ? $1 (UNVERIFIED — not executed under --no-exec)"; UNVERIFIED=$((UNVERIFIED+1)); FAIL_DETAIL+=("$1 [unverified]"); }

assert_file()     { if [[ -f "$1" ]]; then ok "${2:-$1} exists"; else fail "${2:-$1} missing: $1"; fi; }
assert_no_file()  { if [[ ! -e "$1" ]]; then ok "${2:-$1} removed"; else fail "${2:-$1} still present: $1"; fi; }
# ONE matcher for the whole grep family — fixed or regex, present or absent.
#
# grep exits 0 for a match, 1 for none, and >1 when it could not LOOK: an
# unreadable file, a missing one, an invalid regex. Six wrappers branching on
# `if grep` gave that third status three different answers: the NEGATIVE ones
# read it as "the stale text is gone" and passed the phase on evidence never
# gathered, while the POSITIVE ones reported "text not in
# <file>" for a file that does not exist — a true verdict with a false reason,
# which is what sends a reader looking in the wrong place. One matcher, one
# answer per status.
#
# _grep_match <present|absent> <grep flags> <rendered pattern> <pattern> <target> <label>
_grep_match() {
  local want="$1" flags="$2" desc="$3" pattern="$4" target="$5" label="$6" rc
  if [[ ! -e "$target" ]]; then fail "$label (target missing: $target)"; return; fi
  grep "$flags" -- "$pattern" "$target" >/dev/null 2>&1; rc=$?
  if (( rc > 1 )); then fail "$label (grep could not look: exit $rc on $target)"
  elif [[ "$want" == present ]]; then
    if (( rc == 0 )); then ok "$label"; else fail "$label ($desc not in $target)"; fi
  else
    if (( rc == 1 )); then ok "$label"; else fail "$label (stale $desc still in $target)"; fi
  fi
}
assert_grep()     { _grep_match present -qF  "text '$1'"    "$1" "$2" "$3"; }
assert_grep_E()   { _grep_match present -qE  "regex /$1/"   "$1" "$2" "$3"; }
assert_grep_Ei()  { _grep_match present -qiE "regex /$1/i"  "$1" "$2" "$3"; }
assert_not_grep()   { _grep_match absent -qF "text '$1'"  "$1" "$2" "$3"; }
assert_not_grep_E() { _grep_match absent -qE "regex '$1'" "$1" "$2" "$3"; }
assert_grep_dir() { _grep_match present -rqF "text '$1'" "$1" "$2" "$3"; }
# assert_grep_in_section <heading ERE> <content ERE> <file> <label>
# The content must appear INSIDE the named section, which two document-wide
# greps cannot show: one proves a heading exists and the other that the text
# exists somewhere, never that the text is in that section. The section runs
# from its heading to the next heading of ANY level.
assert_grep_in_section() {
  local heading="$1" want="$2" file="$3" label="$4" body
  if [[ ! -f "$file" ]]; then fail "$label (file missing: $file)"; return; fi
  body="$(awk -v h="$heading" '/^#+[[:space:]]/ { if (inside) exit; if ($0 ~ h) { inside = 1; next } } inside { print }' "$file")"
  if [[ -z "$body" ]]; then fail "$label (no section matching /$heading/ in $file)"; return; fi
  # Here-string, not a pipe: under pipefail a `printf | grep -q` fails when
  # grep exits on its first match and printf dies of SIGPIPE.
  if grep -qE -- "$want" <<<"$body"; then ok "$label"
  else fail "$label (no /$want/ INSIDE the /$heading/ section of $file — it may be elsewhere on the page)"; fi
}

# Syntax-aware probes (scripts/dod-syntax.mjs): grep sees text, these see CODE.
# TS/JS goes through the TypeScript parser, Rust through a lexer that blanks
# comments and literals — a `#[path]` in a block comment, an `it(` inside a
# template literal, a call site in a doc comment satisfied the greps these
# replaced (audit 20260907 #26/#27/#31/#32) and satisfy nothing now.
DOD_SYNTAX="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dod-syntax.mjs"
# Every probe goes through `dod_syntax`, which answers from ONE long-lived
# `dod-syntax.mjs --serve` per shell instead of a node per probe: loading the
# TypeScript compiler costs ~0.36s, and a phase issues dozens of probes (the
# feature-ledger phase 5 spent 11s starting processes, and its self-test took
# eleven minutes).
#
# The transport is one request/reply stream with no request ids, so it is
# correct only while ONE process talks to it. Four rules keep it that way, and
# each is a way it used to return a wrong answer:
#   - Only the shell that started the server (BASH_SUBSHELL 0) uses it.
#     Subshells inherit the descriptors, and a pipeline stage or background job
#     runs CONCURRENTLY with its parent — two callers on one stream consumed
#     each other's replies, or deadlocked. Every subshell takes a fresh process.
#   - A working directory or argument holding LF, CR or U+001F cannot ride the
#     line protocol (node's readline ends a line at a lone CR too); it takes a
#     fresh process rather than splitting into two requests and leaving a
#     stale reply to poison the next probe.
#   - The server must answer a `--ping` before it is trusted, and one that dies
#     is closed and never used again: that probe, and every later one, runs in
#     a fresh process. Probes are read-only, so the retry is safe.
#   - The descriptors are the first free ones at or above 10 (where bash's own
#     `{var}` allocation starts — unavailable in the bash 3.2 macOS ships), not
#     a fixed 7/8 that silently took over a caller's own.
#
# And no open of the reply FIFO may BLOCK, on either end (#1473). A plain
# open of a FIFO waits for the other end, and in bash 3.2 the reader's wait
# fails with EINTR whenever a child exits meanwhile — measured at 7 of 120
# runs under 8-way load, 0 of 60 with bash 5.3. The server's write-only open
# then waited FOREVER for a reader that had given up, and the shell forked for
# it held every descriptor it inherited: the caller's own stdout and stderr,
# which bash parks at fd 10+ while a function such as `has_test_case … >/dev/null
# 2>&1` runs. So the checker exited, yet whoever read its output (a test's
# spawnSync) never saw end-of-file and hung. Now the READER opens first, and
# neither of its opens can wait: read-write returns at once (Linux and macOS
# both define it for a FIFO), and read-only then has that writer. The server's
# write-only open then finds readers already there and cannot wait either. The
# server stays WRITE-ONLY: one that could read its own reply FIFO never got
# EPIPE, so when its caller left mid-reply it blocked for ever on a full pipe.
_DOD_STATE=""   # "" not tried · up · off (unavailable, or died: fresh processes from here on)
_DOD_IN=""; _DOD_OUT=""; _DOD_PID=""; _DOD_CODE=""; _DOD_STDOUT=""; _DOD_STDERR=""
_dod_free_fd() {
  local fd="$1"
  while (( fd < 250 )); do
    if ! { true >&"$fd"; } 2>/dev/null; then echo "$fd"; return 0; fi
    fd=$((fd + 1))
  done
  return 1
}
_dod_stop() {
  [[ -n "$_DOD_IN" ]] && eval "exec ${_DOD_IN}>&-"
  [[ -n "$_DOD_OUT" ]] && eval "exec ${_DOD_OUT}<&-"
  _DOD_IN=""; _DOD_OUT=""; _DOD_STATE=off
}
# One reply, buffered until its `X` line so a server that dies mid-reply prints
# nothing half-told. `$1` is a read timeout in seconds, or empty for none.
_dod_read_reply() {
  local line
  _DOD_CODE=""; _DOD_STDOUT=""; _DOD_STDERR=""
  while :; do
    if [[ -n "$1" ]]; then IFS= read -r -t "$1" line <&"$_DOD_OUT" || return 1
    else IFS= read -r line <&"$_DOD_OUT" || return 1; fi
    case "$line" in
      O$'\t'*) _DOD_STDOUT+="${line#??}"$'\n' ;;
      E$'\t'*) _DOD_STDERR+="${line#??}"$'\n' ;;
      X$'\t'*) _DOD_CODE="${line#??}"; return 0 ;;
    esac
  done
}
_dod_start() {
  [[ "$BASH_SUBSHELL" -eq 0 && -z "$_DOD_STATE" ]] || return 1
  _DOD_STATE=off   # until the handshake proves otherwise
  local d in out hold
  in="$(_dod_free_fd 10)" && out="$(_dod_free_fd $((in + 1)))" && hold="$(_dod_free_fd $((out + 1)))" || return 1
  d="$(mktemp -d "${TMPDIR:-/tmp}/dod-serve.XXXXXX")" || return 1
  if ! mkfifo "$d/out"; then rm -rf "$d"; return 1; fi
  # The reader's end, before the server exists (see above). Checked — an
  # unchecked failure here left `_DOD_OUT` naming a descriptor never opened.
  if ! eval "exec ${hold}<>\"\$d/out\""; then rm -rf "$d"; return 1; fi
  if ! eval "exec ${out}<\"\$d/out\""; then eval "exec ${hold}<&-"; rm -rf "$d"; return 1; fi
  _DOD_OUT="$out"
  # Requests travel over an anonymous PIPE (process substitution), never a
  # FIFO: on macOS node never sees end-of-file on a FIFO stdin, so a FIFO-fed
  # server outlived every shell that started it. Over a pipe, the shell's exit
  # closes the descriptor and the server ends with it.
  # node is BACKGROUNDED inside the substitution, which then exits at once:
  # bash 5.2 has a bare `wait` also wait for a live process substitution, so a
  # server running as one hung any caller that waited on its own jobs. `<&0`
  # keeps the pipe as node's stdin (a background job would get /dev/null).
  # It starts as `sh -c 'echo $$ >pid; exec node …'` whose redirections are
  # applied FIRST, so the pid file appears only once the server's end of the
  # reply FIFO is open — and names the server, since `exec` keeps the pid. It
  # closes the inherited `hold` and `out`, so it can never read its own reply
  # FIFO (see above). The answered ping below proves node started and loaded.
  # `--owner $$` (this shell, as `_dod_start` runs only at BASH_SUBSHELL 0):
  # the server exits when this shell does, even while a background job the
  # shell left behind still holds the request pipe open.
  eval "exec ${in}> >(sh -c 'echo \$\$ >\"\$0\"; exec node \"\$1\" --serve --owner \"\$2\"' \"\$d/pid\" \"\$DOD_SYNTAX\" $$ <&0 >\"\$d/out\" 2>/dev/null ${hold}<&- ${out}<&- &)"
  _DOD_IN="$in"
  # `hold` is dropped once the server's end is open — never before: a read
  # that beat the server's open found no writer at all and ended at once (6 of
  # 120 runs) — so the server is the only writer and its death reads as
  # end-of-file. The wait is on the pid file, NEVER on a timed read of the
  # FIFO: bash's `read` takes a pipe a byte at a time, and a timeout firing
  # mid-line hands back half a reply and leaves the stream out of step.
  local waited=0
  until [[ -s "$d/pid" ]] || (( waited >= 1200 )); do sleep 0.05; waited=$((waited + 1)); done
  eval "exec ${hold}<&-"
  if [[ -s "$d/pid" ]] && ( printf '/\x1f--ping\n' ) >&"$_DOD_IN" 2>/dev/null && _dod_read_reply 60 && [[ "$_DOD_CODE" == 0 ]]; then
    _DOD_PID="$(cat "$d/pid" 2>/dev/null)"; rm -rf "$d"
    _DOD_STATE=up; return 0
  fi
  rm -rf "$d"; _dod_stop; return 1
}
dod_syntax() {
  local a
  case "$PWD" in *$'\n'*|*$'\r'*|*$'\x1f'*) node "$DOD_SYNTAX" "$@"; return ;; esac
  for a in "$@"; do
    case "$a" in *$'\n'*|*$'\r'*|*$'\x1f'*) node "$DOD_SYNTAX" "$@"; return ;; esac
  done
  if [[ "$BASH_SUBSHELL" -ne 0 ]]; then node "$DOD_SYNTAX" "$@"; return; fi
  if [[ "$_DOD_STATE" != up ]] && ! _dod_start; then node "$DOD_SYNTAX" "$@"; return; fi
  if ( IFS=$'\x1f'; printf '%s\n' "$PWD"$'\x1f'"$*" ) >&"$_DOD_IN" 2>/dev/null && _dod_read_reply ""; then
    printf '%s' "$_DOD_STDOUT"; printf '%s' "$_DOD_STDERR" >&2
    return "$_DOD_CODE"
  fi
  # A server that died is loud, and is never the answer: close it, and let a
  # fresh process answer this probe and every later one.
  echo "dod-syntax: --serve stopped answering; continuing with one process per probe" >&2
  _dod_stop
  node "$DOD_SYNTAX" "$@"
}
# A Rust test file cargo will compile: an ACTIVE `#[path = "<base>"]` attribute
# in CODE (not inside a raw string), followed — other attributes only — by the
# `mod x;` it decorates, under no `cfg` gate but `cfg(test)`.
rust_test_included() { dod_syntax rust-mod-include "$1" "$2" >/dev/null 2>&1; }
# A TS/mjs test that DECLARES a case: an `it(`/`test(` call with a title (or
# the call `it.each(…)` returns), outside comments and strings and not under
# `skip`/`todo`. This does not prove vitest RUNS the file — check:all does —
# only that the file declares one.
has_test_case() { dod_syntax ts-has-test-case "$1" >/dev/null 2>&1; }
# Non-test .rs files under `dir` (minus the `exclude` bash regex) whose CODE
# matches `re` — a mention in a comment or a string literal does not. Prints
# the matching files.
rust_code_grep() {
  local re="$1" dir="$2" exclude="${3:-^$}" f files=()
  for f in "$dir"/*.rs; do [[ -f "$f" && "$f" != *.test.rs && ! "$f" =~ $exclude ]] && files+=("$f"); done
  (( ${#files[@]} > 0 )) && dod_syntax rust-code-grep "$re" "${files[@]}" 2>/dev/null
}
# assert_rust_code_grep <JS regex> <file.rs> <label> [--keep-strings]
# The CODE of one Rust file must match. `grep` is satisfied by a doc comment
# naming the symbol, by a `//`-commented-out call, and by the symbol quoted in
# a string — none of which the compiler sees, and each of which let a phase
# report a platform or security assertion as met.
# Pass --keep-strings when the SUBJECT is a literal (a menu id, an env-var
# name); the default blanks literals as well as comments.
assert_rust_code_grep() {
  local re="$1" file="$2" label="$3" keep="${4:-}"
  if [[ ! -f "$file" ]]; then fail "$label (file missing: $file)"; return; fi
  if dod_syntax rust-code-grep ${keep:+--keep-strings} "$re" "$file" >/dev/null 2>&1; then ok "$label"
  else fail "$label (no /$re/ in the CODE of $file — a comment, a commented-out call or a quoted mention does not count)"; fi
}
# assert_ts_code_grep <JS regex> <file.ts(x)> <label> [--keep-strings]
# The CODE of one TypeScript file must match — same contract as
# assert_rust_code_grep, through the TypeScript parser. Pass
# --keep-strings when the SUBJECT is a literal (an event name, a menu id).
assert_ts_code_grep() {
  local re="$1" file="$2" label="$3" keep="${4:-}"
  if [[ ! -f "$file" ]]; then fail "$label (file missing: $file)"; return; fi
  if dod_syntax ts-code-grep ${keep:+--keep-strings} "$re" "$file" >/dev/null 2>&1; then ok "$label"
  else fail "$label (no /$re/ in the CODE of $file — a comment or a commented-out line does not count)"; fi
}
# Which `.rs` beside `$1` includes it with an active `#[path = "<basename>"]`?
# Prints the path, or nothing. `grep -l` NARROWS the candidates first — the
# decision still comes from the syntax probe, which is what tells a live
# attribute from one inside a comment or a raw string — because spawning node
# once per `.rs` in a directory of eighty is minutes, not seconds.
# Also leaves the path in `_DOD_MOUNT`, so a caller can read it without a
# command substitution — a subshell would not use the probe server.
# The 2018-edition directory-module file `<dir>.rs`, one level up, mounts a
# test inside `<dir>/` as `#[path = "<dir>/<basename>"]` (a top-level `#[path]`
# is relative to the directory of the file that carries it): `pty.rs` mounts
# `pty/commands.test.rs` that way, and looking only beside the test reported
# those tests as included by nothing.
# A module one level down mounts a test beside its directory as
# `#[path = "../<basename>"]`: `agent_journal/admission/mod.rs` mounts the
# admission, request and page tests in `agent_journal/` that way.
rust_mount_owner() {
  local file="$1" dir base cand up; dir="$(dirname "$file")"; base="$(basename "$file")"
  _DOD_MOUNT=""
  while IFS= read -r cand; do
    [[ -n "$cand" && "$cand" != "$file" ]] || continue
    if rust_test_included "$cand" "$base"; then _DOD_MOUNT="$cand"; printf '%s\n' "$cand"; return 0; fi
  done < <(grep -lF -- "\"$base\"" "$dir"/*.rs 2>/dev/null)
  up="$(basename "$dir")/$base"
  if [[ -f "$dir.rs" ]] && grep -qF -- "\"$up\"" "$dir.rs" 2>/dev/null && rust_test_included "$dir.rs" "$up"; then
    _DOD_MOUNT="$dir.rs"; printf '%s\n' "$dir.rs"; return 0
  fi
  while IFS= read -r cand; do
    [[ -n "$cand" ]] || continue
    if rust_test_included "$cand" "../$base"; then _DOD_MOUNT="$cand"; printf '%s\n' "$cand"; return 0; fi
  done < <(grep -lF -- "\"../$base\"" "$dir"/*/*.rs 2>/dev/null)
  return 1
}
# Is `mod <stem>;` declared, in CODE, by a mod.rs/lib.rs/main.rs beside `$1`?
# A DIRECTORY module (`mod.rs`/`lib.rs`/`main.rs`) is declared by its parent
# directory instead, which needs a full walk; those return true rather than
# reporting a level this probe deliberately does not climb.
rust_module_declared() {
  local file="$1" dir stem base parent cand
  dir="$(dirname "$file")"; stem="$(basename "$file" .rs)"; base="$(basename "$file")"
  case "$stem" in mod|lib|main) return 0 ;; esac
  # `$dir.rs` is the 2018-edition directory module — the form this crate
  # actually uses: `menu/localized.rs` declares `mod export_menu;` for
  # `menu/localized/`, and `pty.rs` declares `mod session;` for `pty/`. Looking
  # only INSIDE the directory reported both as uncompiled.
  for parent in "$dir/mod.rs" "$dir/lib.rs" "$dir/main.rs" "$dir.rs"; do
    [[ -f "$parent" ]] || continue
    dod_syntax rust-code-grep "(^|[^A-Za-z0-9_])mod\\s+${stem}\\s*;" "$parent" >/dev/null 2>&1 && return 0
  done
  # A `#[path = "<base>"] mod x;` mount is a declaration too, and a file
  # mounted that way carries no `mod <stem>;` anywhere — `nav_payloads_macos.rs`
  # is mounted from `nav_delegate_macos.rs`, so a test it includes was reported
  # as an uncompiled module. Same one-level
  # posture as above: whether the MOUNTING file is itself in the crate needs the
  # full walk this probe deliberately does not do.
  rust_mount_owner "$file" >/dev/null
}
# A test that vitest or cargo will actually run.
assert_test_file() {
  local f="$1" label="$2"
  # A TypeScript test that renders JSX carries the .tsx extension; the plan
  # names tests by their .test.ts form, so accept the sibling spelling.
  if [[ ! -f "$f" && "$f" == *.test.ts && -f "${f}x" ]]; then f="${f}x"; fi
  if [[ ! -f "$f" ]]; then fail "$label missing: $f"; return; fi
  case "$f" in
    *.test.rs)
      # The OWNER is whichever module in the directory actually includes the
      # file, not the sibling stem. 13 of this crate's 229 `*.test.rs` files
      # have no `X.rs` beside them at all — they are mounted from `mod.rs` or a
      # differently-named module — and every one of them was reported as "not
      # included". The sibling is tried first because it is the
      # convention in the other 216 cases; the scan is the fallback.
      local mod base; base="$(basename "$f")"; mod=""
      if [[ -f "${f%.test.rs}.rs" ]] && rust_test_included "${f%.test.rs}.rs" "$base"; then
        mod="${f%.test.rs}.rs"
      else
        rust_mount_owner "$f" >/dev/null; mod="$_DOD_MOUNT"
      fi
      if [[ -z "$mod" ]]; then
        fail "$label present but no .rs beside it includes it (an active #[path = \"$base\"] followed by mod …;)"
      elif ! rust_module_declared "$mod"; then
        # One level further out: the including module must itself be part of
        # the crate. A `.rs` file that no `mod x;` declares is not compiled, so
        # the include inside it reaches nothing.
        fail "$label is included by $(basename "$mod"), but nothing beside it declares \`mod $(basename "$mod" .rs)\` (a mod.rs/lib.rs/main.rs statement, or a #[path] mount) — an undeclared module is not compiled, so cargo never runs the test"
      else
        ok "$label (included from $(basename "$mod"))"
      fi ;;
    *)
      if has_test_case "$f"; then ok "$label (has cases)"; else fail "$label present but declares no it()/test() case (outside comments, strings, skip and todo)"; fi ;;
  esac
}
# A journey e2e/run-journeys.mjs would DISCOVER: the DEFAULT EXPORT is an
# object with a non-empty string `name` and a function `run` (parsed, so three
# separate matches in unrelated places cannot add up to one journey).
assert_journey() {
  local f="$1" label="$2" why
  if [[ ! -f "$f" ]]; then fail "$label missing: $f"; return; fi
  if why=$(dod_syntax journey-shape "$f" 2>&1 >/dev/null); then ok "$label (default { name, run })"
  else fail "$label present but not a runner-discoverable journey (${why:-needs \`export default { name, run }\`})"; fi
}
# `$1` as a LITERAL inside a POSIX ERE. Work-item and decision ids carry dots
# (`D1.2`), and interpolated raw a dot matches ANY character — so a plan
# recording `D1X2 outcome:` satisfied the assertion for `D1.2`. `]` and `}`
# are ordinary outside their constructs and
# escaping them is undefined in POSIX, so they are left alone — the same set
# scripts/check-deleted-names.mjs escapes.
_ere_escape() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//./\\.}"; s="${s//\[/\\[}"; s="${s//\(/\\(}"
  s="${s//\)/\\)}"; s="${s//\{/\\{}"; s="${s//\*/\\*}"; s="${s//+/\\+}"
  s="${s//\?/\\?}"; s="${s//^/\\^}"; s="${s//\$/\\$}"; s="${s//|/\\|}"
  printf '%s' "$s"
}
# Evidence and decisions live in the checker's plan file — `$PLAN`, set by the
# caller — as `- <work-item id> evidence: <ref>` / `- Dn outcome: <text>` lines.
assert_evidence() { if grep -qE -- "^- $(_ere_escape "$1") evidence: [^[:space:]]+" "$PLAN" 2>/dev/null; then ok "$2 (evidence recorded)"; else fail "$2 (no '- $1 evidence: <ref>' line in $PLAN)"; fi; }
assert_decision() { if grep -qE -- "^- $(_ere_escape "$1") outcome: [^[:space:]]+" "$PLAN" 2>/dev/null; then ok "$2 (decision recorded)"; else fail "$2 (no '- $1 outcome: <text>' line in $PLAN)"; fi; }
# package.json joins, parsed — never a one-line grep.
assert_pkg_script() {
  local name="$1" label="$2"
  if node -e 'const s=JSON.parse(require("fs").readFileSync("package.json","utf8")).scripts||{};process.exit(s[process.argv[1]]?0:1)' "$name" 2>/dev/null; then ok "$label (pnpm $name registered)"; else fail "$label (no scripts.$name in package.json)"; fi
}
# check:static is a `&&` chain of `pnpm <script>` steps: the script must be one
# of its EXACT steps — not a substring of another, not a check:all reference.
assert_in_static() {
  local name="$1" label="$2"
  if node -e 'const s=JSON.parse(require("fs").readFileSync("package.json","utf8")).scripts||{};const steps=(s["check:static"]||"").split("&&").map((x)=>x.trim());process.exit(steps.includes("pnpm "+process.argv[1])?0:1)' "$name" 2>/dev/null; then ok "$label (wired into check:static)"; else fail "$label ($name is not a step of check:static)"; fi
}
# A ratchet that reached zero. A JSON or schema error is REPORTED, not folded
# into the entry count: `|| echo "?"` swallowed the parser's message and the
# phase then said "baseline has ? entries", which describes neither the failure
# nor where to look. Still fails closed either way.
assert_baseline_empty() {
  local f="$1" label="$2"
  if [[ ! -f "$f" ]]; then fail "$label (baseline missing: $f)"; return; fi
  local n rc
  n=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const e=j.entries||j.files||j;if(typeof e!=="object"||e===null)throw new Error("neither an entries array nor a files/keys object");console.log(Array.isArray(e)?e.length:Object.keys(e).filter(k=>k!=="//").length)' "$f" 2>&1); rc=$?
  if (( rc != 0 )); then fail "$label (cannot read $f: $(printf '%s' "$n" | head -n 1))"
  elif [[ "$n" == "0" ]]; then ok "$label (baseline empty)"
  else fail "$label (baseline has $n entries)"; fi
}
# Run a gate for real. Skipped (and counted as unverified) under --no-exec.
#
# EXEC belongs to the CALLER (the checker's argument parsing) and is not
# defaulted here. Under `set -u` an unset one used to abort the whole run from
# inside an assertion with a bare "EXEC: unbound variable" and no label; a
# `${EXEC:-0}` default would be worse still — every gate would quietly become
# "unverified", which is the silent-skip this file exists to prevent. A
# missing EXEC is a wiring bug in the caller, named as one.
#
# The gate's own output IS the diagnostic. Discarding it left "exited non-zero:
# pnpm lint:x" and nothing to act on.
ASSERT_EXEC_TAIL=20
assert_exec() {
  local label="$1"; shift
  if [[ -z "${EXEC:-}" ]]; then
    fail "$label (EXEC is not set by this checker — assert_exec cannot tell a real run from --no-exec)"
    return
  fi
  if [[ "$EXEC" == 0 ]]; then unverified "$label"; return; fi
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if (( rc == 0 )); then ok "$label (ran green)"; return; fi
  fail "$label (exit $rc: $*)"
  printf '%s\n' "$out" | tail -n "$ASSERT_EXEC_TAIL" | sed 's/^/      | /'
}
# Either named outcome of a maintainer decision. Spec: kind|arg[|arg] with kinds file, nofile, grep, nogrep (fixed strings).
#
# The FILE is taken after the LAST `|`, not the first. A fixed-string pattern
# may legitimately contain a pipe — a markdown table row, an alternation
# written into prose, a `Result<T, String> | CommandError` — and splitting at
# the first separator made the pattern everything before it and the "file"
# everything after, so the probe reported "no match" for a file it never
# opened. A path containing a pipe is still not expressible; that is
# reported by `assert_any` rather than guessed at.
#
# `nogrep` branches on grep's STATUS: shell negation turns an execution error
# (exit 2 — unreadable file, no grep) into a PASS, so `assert_any` would accept
# evidence it never gathered. Only exit 1, the explicit
# "no match", is the absence this probe claims.
probe() {
  local kind="${1%%|*}" rest="${1#*|}" pattern file rc
  case "$kind" in
    file)   [[ -f "$rest" ]] ;;
    nofile) [[ ! -e "$rest" ]] ;;
    grep|nogrep)
      pattern="${rest%|*}"; file="${rest##*|}"
      [[ -f "$file" ]] || return 1
      grep -qF -- "$pattern" "$file" >/dev/null 2>&1; rc=$?
      if [[ "$kind" == grep ]]; then (( rc == 0 )); else (( rc == 1 )); fi ;;
    *) return 1 ;;
  esac
}
# Every spec is validated BEFORE any is probed, and a malformed one fails the
# assertion outright rather than merely not matching. A typo'd kind used to
# return 1 like an honest "no", so a sibling probe that happened to pass hid it
# — the same silence `command_not_found_handle` exists to break for a misspelt
# helper.
assert_any() {
  local label="$1"; shift
  local spec kind
  for spec in "$@"; do
    kind="${spec%%|*}"
    case "$kind" in
      file|nofile) [[ "$spec" == "$kind|"?* ]] || { fail "$label (malformed probe spec '$spec' — expected $kind|<path>)"; return; } ;;
      grep|nogrep) [[ "${spec#"$kind|"}" == *"|"?* && "$spec" == "$kind|"?* ]] || { fail "$label (malformed probe spec '$spec' — expected $kind|<pattern>|<file>)"; return; } ;;
      *) fail "$label (unknown probe kind '$kind' in '$spec' — expected file, nofile, grep or nogrep)"; return ;;
    esac
  done
  for spec in "$@"; do if probe "$spec"; then ok "$label"; return; fi; done
  fail "$label (none of: $*)"
}
