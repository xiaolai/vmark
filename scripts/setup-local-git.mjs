#!/usr/bin/env node
/**
 * Local git setup — run by the root `prepare` script on `pnpm install`.
 *
 * 1. Point git at the versioned hooks dir (`.githooks`) so the `pre-push`
 *    quality gate runs (no husky dependency).
 * 2. Add an SSH keepalive to `core.sshCommand`. The `pre-push` hook runs the
 *    full `pnpm check:all` (~3 min) while git holds the SSH connection to the
 *    remote open. Without a keepalive the idle connection times out, so the
 *    subsequent pack upload dies with SIGPIPE (exit 141) on direct pushes to
 *    `main` / `v*` tags — the gate passes but the push never lands. The
 *    keepalive sends traffic every 20s so the connection survives the hook.
 *    Only set when no *effective* `core.sshCommand` exists (local, global, or
 *    system), so a custom SSH wrapper — global PuTTY/plink, a proxy command,
 *    identity routing — is never shadowed. Plain `ssh -o …` still reads
 *    `~/.ssh/config`, so identities/host settings are preserved.
 *
 * Always a no-op (never throws) outside a real work tree — a tarball/CI install
 * with no `.git` is fine, not an install failure.
 *
 * The decision logic is `setupLocalGit(git)` with an injectable git runner so
 * it is unit-tested (scripts/setup-local-git.test.mjs); the CLI block at the
 * bottom wires in the real `git`.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SSH_KEEPALIVE = "ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=20";

/**
 * @param {(args: string[]) => string} git runs `git <args>`, returns trimmed
 *   stdout, throws on non-zero exit. All writes are best-effort.
 */
export function setupLocalGit(git) {
  // Only operate inside a real work tree (not a bare repo, not a non-git dir).
  let insideWorkTree;
  try {
    insideWorkTree = git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return; // not a git checkout — nothing to configure
  }
  if (insideWorkTree !== "true") return; // bare repo / inside .git → "false"

  trySet(git, ["config", "core.hooksPath", ".githooks"]);

  // Effective (local → global → system) sshCommand — never clobber a custom one.
  let existingSsh = "";
  try {
    existingSsh = git(["config", "--get", "core.sshCommand"]);
  } catch {
    existingSsh = ""; // key not set → git config --get exits non-zero
  }
  if (!existingSsh) {
    trySet(git, ["config", "core.sshCommand", SSH_KEEPALIVE]);
  }
}

function trySet(git, args) {
  try {
    git(args);
  } catch {
    /* best-effort — a config write failure must never block install */
  }
}

function realGit(args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

// CLI entry — run only when invoked directly (`node scripts/setup-local-git.mjs`),
// never when imported by the test.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  setupLocalGit(realGit);
}
