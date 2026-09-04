// The decision behind the stale-binary preflight (2026-09-04): a running app
// whose executable was REPLACED on disk (a new inode under its path) is refused;
// the same inode — untouched, or relinked in place with identical bytes — is not.
import { describe, expect, it } from "vitest";
import { staleBinaryVerdict } from "./staleBinary.mjs";

const EXE = "/repo/src-tauri/target/debug/vmark";

describe("staleBinaryVerdict", () => {
  it("proceeds when the process runs the inode that is on disk", () => {
    expect(staleBinaryVerdict({ pid: 1, executable: EXE, runningInode: "100", diskInode: "100" })).toBe("");
  });

  it("refuses when the file at the executable's path is a different inode, and says why", () => {
    const verdict = staleBinaryVerdict({ pid: 42, executable: EXE, runningInode: "100", diskInode: "200" });
    expect(verdict).toMatch(/pid 42/);
    expect(verdict).toMatch(/replaced on disk/);
    expect(verdict).toMatch(/running inode 100, on disk 200/);
    expect(verdict).toMatch(/keychain/);
    expect(verdict).toMatch(/pnpm tauri:dev/);
  });

  it("proceeds when either inode cannot be read — the caller reports the skip", () => {
    expect(staleBinaryVerdict({ pid: 1, executable: EXE, runningInode: null, diskInode: "100" })).toBe("");
    expect(staleBinaryVerdict({ pid: 1, executable: EXE, runningInode: "100", diskInode: null })).toBe("");
  });
});
