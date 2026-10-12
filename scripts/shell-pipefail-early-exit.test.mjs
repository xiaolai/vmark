/**
 * No tracked shell script that sets `pipefail` may pipe into `grep -q`.
 *
 * `grep -q` exits on its first match. If the writer at the other end of the
 * pipe (`echo "$big"`, `printf`, `rustup …`) has not finished, it dies of
 * SIGPIPE (status 141) and pipefail reports the whole pipeline as FAILED — a
 * match read as a miss. Whether the writer finishes first is a scheduling race,
 * so the bug only shows under load: `pnpm check:predelta` running 49 gates in
 * parallel made `check-comment-headers.sh` report a header with `Purpose:` as
 * missing it, and `check-new-deps.sh` misfile an npm E404 as "lookup failed".
 *
 * The fix is to capture first and grep a here-string (`grep -q x <<<"$var"`),
 * which has no pipe to break — the form `verify-macos-bundle-entitlements.sh`
 * already used. Scripts are found by extension and by shebang, as in
 * shell-script-eol.test.mjs, so the extensionless `.githooks/` are covered.
 *
 * @coordinates-with scripts/shell-script-eol.test.mjs — same script discovery
 * @module scripts/shell-pipefail-early-exit.test
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SHELL_EXTENSION = /\.(sh|bash|zsh)$/;
/** `#!/bin/bash`, `#!/usr/bin/env bash`, `#!/bin/sh -e`, … */
const SHELL_SHEBANG = /^#!.*[/\s](?:ba|z|da|k)?sh(?:\s|$)/;

/** A pipe into grep with `-q` among its short flags, or `--quiet`. */
const PIPE_INTO_QUIET_GREP = /\|\s*grep\s+(?:[^|;&]*\s)?(?:-[A-Za-z]*q[A-Za-z]*|--quiet|--silent)(?:\s|$)/;

/** Offending `file:line` entries for one script's text (comments skipped). */
function findPipesIntoQuietGrep(file, text) {
  if (!/\bpipefail\b/.test(text)) return [];
  return text
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !line.trimStart().startsWith("#") && PIPE_INTO_QUIET_GREP.test(line))
    .map(({ line, n }) => `${file}:${n}: ${line.trim()}`);
}

function trackedShellScripts() {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
  const scripts = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(path.join(REPO, file), "utf8");
    } catch {
      continue; // tracked but absent from the working tree (sparse checkout)
    }
    if (SHELL_EXTENSION.test(file) || SHELL_SHEBANG.test(text.split("\n", 1)[0] ?? "")) {
      scripts.push({ file, text });
    }
  }
  return scripts;
}

describe("shell scripts under pipefail never pipe into grep -q", () => {
  it.each([
    ['if echo "$META" | grep -q "E404"; then'],
    ["if ! printf '%s\\n' \"$CONTENT\" | grep -q \"Purpose:\"; then"],
    ['if ! rustup target list --installed | grep -qx "$TARGET"; then'],
    ['if printf "%s" "$body" | grep -qE -- "$want"; then'],
    ['cmd | grep -E -q pattern'],
    ['cmd | grep --quiet pattern'],
  ])("detects %s", (line) => {
    expect(findPipesIntoQuietGrep("x.sh", `set -o pipefail\n${line}\n`)).toHaveLength(1);
  });

  it.each([
    ['if grep -q "E404" <<<"$META"; then'],
    ['echo "$x" | grep -c pattern'],
    ['grep -q pattern file.txt'],
    ['# a comment about `echo | grep -q`'],
    ['echo "$x" | grep pattern | wc -l'],
  ])("allows %s", (line) => {
    expect(findPipesIntoQuietGrep("x.sh", `set -o pipefail\n${line}\n`)).toEqual([]);
  });

  it("ignores scripts that do not set pipefail", () => {
    expect(findPipesIntoQuietGrep("x.sh", 'echo "$x" | grep -q y\n')).toEqual([]);
  });

  it("finds the repo's shell scripts (the scan is not vacuous)", () => {
    const files = trackedShellScripts().map((s) => s.file);
    expect(files).toContain("scripts/check-new-deps.sh");
    expect(files).toContain(".githooks/commit-msg");
  });

  it("no tracked script has the pattern", () => {
    const offenders = trackedShellScripts().flatMap(({ file, text }) => findPipesIntoQuietGrep(file, text));
    expect(offenders, "capture first, then `grep -q … <<<\"$var\"`").toEqual([]);
  });
});
