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
 *    Only set when the user has no `core.sshCommand` of their own, so a custom
 *    SSH wrapper is never clobbered. Plain `ssh -o …` still reads `~/.ssh/config`,
 *    so identities/host settings are preserved — we only add keepalive options.
 *
 * Always exits 0: a non-git checkout (e.g. a tarball install) is a no-op, not
 * an install failure.
 */
import { execFileSync } from "node:child_process";

const SSH_KEEPALIVE = "ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=20";

function gitRead(args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

function gitSet(args) {
  try {
    execFileSync("git", args, { stdio: "ignore" });
  } catch {
    /* not fatal — never block install */
  }
}

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
} catch {
  process.exit(0); // not a git work tree — nothing to configure
}

gitSet(["config", "core.hooksPath", ".githooks"]);

let existingSsh = "";
try {
  existingSsh = gitRead(["config", "--local", "--get", "core.sshCommand"]);
} catch {
  existingSsh = "";
}
if (!existingSsh) {
  gitSet(["config", "core.sshCommand", SSH_KEEPALIVE]);
}
