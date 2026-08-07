// @vitest-environment node
/**
 * Capability-scope regression guard for the shared rename service (#1146).
 *
 * renameFile() stats the old path before renaming it:
 *
 *     const isFolder = options.isFolder ?? (await stat(oldPath)).isDirectory;
 *
 * That call needs `fs:allow-stat` scoped to the same paths as `fs:allow-rename`.
 * v0.9.8 shipped `fs:allow-rename` (and `fs:allow-exists`) without a matching
 * `fs:allow-stat`, so the metadata lookup was rejected before rename() was ever
 * reached and renaming silently failed for callers that don't pass `isFolder`.
 *
 * These tests pin the invariant rather than the literal path list: every
 * filesystem operation renameFile performs must be granted over exactly the
 * same scope, in both the default (macOS/Linux) and Windows capability files.
 * Adding a drive/root to one permission and forgetting the others fails here.
 */
import { describe, it, expect } from "vitest";
import defaultCapabilities from "../../../src-tauri/capabilities/default.json";
import windowsCapabilities from "../../../src-tauri/capabilities/windows.json";

type Permission = string | { identifier: string; allow?: { path: string }[] };
type Capability = { permissions: Permission[] };

/** Scoped paths granted for `identifier`, or null when it isn't granted at all. */
function scopeFor(capability: Capability, identifier: string): string[] | null {
  const entry = capability.permissions.find(
    (p): p is { identifier: string; allow?: { path: string }[] } =>
      typeof p === "object" && p.identifier === identifier,
  );
  if (!entry) return null;
  return (entry.allow ?? []).map((a) => a.path).sort();
}

// Every fs operation renameFile() performs — see services/persistence/renameFile.ts.
const RENAME_FS_PERMISSIONS = ["fs:allow-rename", "fs:allow-stat", "fs:allow-exists"];

describe.each([
  ["default (macOS/Linux)", defaultCapabilities as Capability],
  ["windows", windowsCapabilities as Capability],
])("%s capabilities — rename service fs scopes", (_label, capability) => {
  it.each(RENAME_FS_PERMISSIONS)("grants %s", (identifier) => {
    expect(scopeFor(capability, identifier)).not.toBeNull();
  });

  it("grants stat over exactly the same paths as rename", () => {
    expect(scopeFor(capability, "fs:allow-stat")).toEqual(
      scopeFor(capability, "fs:allow-rename"),
    );
  });

  it("grants exists over exactly the same paths as rename", () => {
    expect(scopeFor(capability, "fs:allow-exists")).toEqual(
      scopeFor(capability, "fs:allow-rename"),
    );
  });
});
