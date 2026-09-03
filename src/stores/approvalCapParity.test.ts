// @vitest-environment node
// Audit 2026-09-03 (round 1) — the frontend mirrors of two driver caps. Each cap
// exists on both sides of the IPC; neither compiler can see the other, so a drift
// would be silent: a UI that queues approvals the driver refuses, or one-shots the
// authority has already evicted.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { MAX_ONE_SHOTS, MAX_PENDING_APPROVALS } from "./browserApprovalStore.constants";

function rustConst(file: string, name: string): number {
  const source = readFileSync(new URL(`../../src-tauri/src/browser/${file}`, import.meta.url), "utf8");
  const match = new RegExp(`const ${name}: usize = (\\d+);`).exec(source);
  if (!match) throw new Error(`${name} not found in ${file}`);
  return Number(match[1]);
}

describe("approval caps agree across languages", () => {
  it("MAX_PENDING_APPROVALS equals the driver's MAX_PENDING_PROFILE_OPENS", () => {
    expect(rustConst("commands_auth.rs", "MAX_PENDING_PROFILE_OPENS")).toBe(MAX_PENDING_APPROVALS);
  });

  it("MAX_ONE_SHOTS equals the driver's MAX_ONE_SHOTS", () => {
    expect(rustConst("mint.rs", "MAX_ONE_SHOTS")).toBe(MAX_ONE_SHOTS);
  });
});
