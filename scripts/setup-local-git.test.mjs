import { describe, it, expect } from "vitest";
import { setupLocalGit } from "./setup-local-git.mjs";

const KEEPALIVE = "ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=20";

/**
 * Fake git runner. `responses` maps joined args → a string (returned) or an
 * Error (thrown). Unmapped reads (`--get`) throw like a missing key; unmapped
 * writes succeed. Records every call for assertions.
 */
function makeGit(responses = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    const r = responses[args.join(" ")];
    if (r instanceof Error) throw r;
    if (r !== undefined) return r;
    if (args[0] === "config" && args.includes("--get")) throw new Error("missing key");
    return ""; // a write — succeeds
  };
  git.calls = calls;
  return git;
}

function didSetSshCommand(git) {
  return git.calls.some(
    (a) => a[0] === "config" && a[1] === "core.sshCommand" && a.length === 3,
  );
}

describe("setupLocalGit", () => {
  it("sets hooksPath and the keepalive in a fresh work tree with no sshCommand", () => {
    const git = makeGit({ "rev-parse --is-inside-work-tree": "true" });
    setupLocalGit(git);
    expect(git.calls).toContainEqual(["config", "core.hooksPath", ".githooks"]);
    expect(git.calls).toContainEqual(["config", "core.sshCommand", KEEPALIVE]);
  });

  it("never clobbers an existing effective sshCommand (e.g. a global wrapper)", () => {
    const git = makeGit({
      "rev-parse --is-inside-work-tree": "true",
      "config --get core.sshCommand": "ssh -o ProxyCommand=corp-proxy",
    });
    setupLocalGit(git);
    expect(git.calls).toContainEqual(["config", "core.hooksPath", ".githooks"]);
    expect(didSetSshCommand(git)).toBe(false);
  });

  it("is a no-op outside a git work tree (rev-parse throws)", () => {
    const git = makeGit({ "rev-parse --is-inside-work-tree": new Error("not a git repo") });
    expect(() => setupLocalGit(git)).not.toThrow();
    expect(git.calls).toEqual([["rev-parse", "--is-inside-work-tree"]]);
  });

  it("is a no-op when rev-parse reports a non-worktree (bare repo → 'false')", () => {
    const git = makeGit({ "rev-parse --is-inside-work-tree": "false" });
    setupLocalGit(git);
    expect(git.calls).toEqual([["rev-parse", "--is-inside-work-tree"]]);
  });

  it("is idempotent — re-running with the keepalive already set never re-sets it", () => {
    // Models a second `pnpm install`: the prior run already set sshCommand, so
    // `git config --get` reports it and the keepalive must not be written again.
    const git = makeGit({
      "rev-parse --is-inside-work-tree": "true",
      "config --get core.sshCommand": KEEPALIVE,
    });
    setupLocalGit(git);
    setupLocalGit(git);
    expect(didSetSshCommand(git)).toBe(false);
    // hooksPath is re-asserted each run — harmless and idempotent.
    const hooksWrites = git.calls.filter(
      (a) => a[0] === "config" && a[1] === "core.hooksPath",
    ).length;
    expect(hooksWrites).toBe(2);
  });

  it("never throws when config writes fail (must not break pnpm install)", () => {
    const git = makeGit({
      "rev-parse --is-inside-work-tree": "true",
      "config core.hooksPath .githooks": new Error("config locked"),
      [`config core.sshCommand ${KEEPALIVE}`]: new Error("config locked"),
    });
    expect(() => setupLocalGit(git)).not.toThrow();
  });
});
