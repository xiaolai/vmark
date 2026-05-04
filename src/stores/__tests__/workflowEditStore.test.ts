// Phase 8 WI-8.3 — workflowEditStore + save pipeline tests.
//
// Covers:
//   1. Patch queue mechanics (queue, clear, dirty selector).
//   2. Hot-swap save path (apply queued patches → CST round-trip → string).
//   3. preserveYamlFormatting toggle (CST path vs reformat path).
//   4. ADR-11 gate compliance for the queued multi-patch case (comments
//      preserved across multiple sequential edits in one save).

import { beforeEach, describe, expect, it } from "vitest";
import {
  selectWorkflowEditDirty,
  useWorkflowEditStore,
} from "../workflowEditStore";
import type { IRPatch } from "@/lib/ghaWorkflow/save/mutators";

const SAMPLE = `# Top comment
name: ci
on: push
env:
  NODE_ENV: production # inline env
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test # inline run
`;

function commentSet(yaml: string): Set<string> {
  const out = new Set<string>();
  for (const line of yaml.split("\n")) {
    let inS = false, inD = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inD) inS = !inS;
      else if (ch === '"' && !inS) inD = !inD;
      else if (ch === "#" && !inS && !inD) {
        const t = line.slice(i + 1).trim();
        if (t) out.add(t);
        break;
      }
    }
  }
  return out;
}

beforeEach(() => {
  useWorkflowEditStore.setState({
    pendingPatches: [],
    preserveYamlFormatting: true,
  });
  // Reset settings store to a known default so the per-session override
  // resolution is deterministic. The store-level override of
  // `true` above already wins, but tests that flip to null exercise the
  // fall-through to settings.
});

describe("workflowEditStore — queue mechanics", () => {
  it("starts clean", () => {
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([]);
    expect(selectWorkflowEditDirty(useWorkflowEditStore.getState())).toBe(false);
  });

  it("queues patches in order", () => {
    const s = useWorkflowEditStore.getState();
    s.queuePatch({ kind: "workflow.set", path: "name", value: "a" });
    s.queuePatch({ kind: "workflow.set", path: "name", value: "b" });
    expect(useWorkflowEditStore.getState().pendingPatches.length).toBe(2);
    expect(selectWorkflowEditDirty(useWorkflowEditStore.getState())).toBe(true);
  });

  it("clearPatches empties the queue", () => {
    const s = useWorkflowEditStore.getState();
    s.queuePatch({ kind: "workflow.set", path: "name", value: "a" });
    s.clearPatches();
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([]);
    expect(selectWorkflowEditDirty(useWorkflowEditStore.getState())).toBe(false);
  });
});

describe("workflowEditStore — applyAndSerialize", () => {
  it("returns original verbatim when queue is empty", () => {
    const out = useWorkflowEditStore.getState().applyAndSerialize(SAMPLE);
    expect(out).toBe(SAMPLE);
  });

  it("applies a single queued patch and serializes", () => {
    const s = useWorkflowEditStore.getState();
    s.queuePatch({ kind: "workflow.set", path: "name", value: "renamed" });
    const out = s.applyAndSerialize(SAMPLE);
    expect(out).toMatch(/name: renamed/);
    expect(out).not.toMatch(/^name: ci$/m);
  });

  it("applies multiple queued patches in order (last-write-wins per path)", () => {
    const s = useWorkflowEditStore.getState();
    s.queuePatch({ kind: "workflow.set", path: "name", value: "first" });
    s.queuePatch({ kind: "workflow.set", path: "name", value: "second" });
    s.queuePatch({
      kind: "job.set",
      jobId: "build",
      path: "runs-on",
      value: "macos-latest",
    });
    const out = s.applyAndSerialize(SAMPLE);
    expect(out).toMatch(/name: second/);
    expect(out).not.toMatch(/name: first/);
    expect(out).toMatch(/runs-on: macos-latest/);
  });

  it("does NOT mutate the queue (caller clears after disk write)", () => {
    const s = useWorkflowEditStore.getState();
    s.queuePatch({ kind: "workflow.set", path: "name", value: "renamed" });
    s.applyAndSerialize(SAMPLE);
    expect(useWorkflowEditStore.getState().pendingPatches.length).toBe(1);
  });

  it("preserves all original comments across multiple queued edits (ADR-11 gate)", () => {
    const s = useWorkflowEditStore.getState();
    const patches: IRPatch[] = [
      { kind: "workflow.set", path: "name", value: "renamed" },
      { kind: "workflow.set", path: "env.NODE_ENV", value: "test" },
      {
        kind: "job.set",
        jobId: "build",
        path: "runs-on",
        value: "macos-latest",
      },
    ];
    for (const p of patches) s.queuePatch(p);
    const out = s.applyAndSerialize(SAMPLE);
    const before = commentSet(SAMPLE);
    const after = commentSet(out);
    for (const c of before) {
      expect(after.has(c), `lost comment: ${c}`).toBe(true);
    }
  });
});

describe("workflowEditStore — preserveYamlFormatting toggle", () => {
  it("session-level override defaults to true (set by beforeEach)", () => {
    expect(useWorkflowEditStore.getState().preserveYamlFormatting).toBe(true);
  });

  it("setPreserveYamlFormatting flips the override (boolean)", () => {
    useWorkflowEditStore.getState().setPreserveYamlFormatting(false);
    expect(useWorkflowEditStore.getState().preserveYamlFormatting).toBe(false);
  });

  it("setPreserveYamlFormatting(null) drops the override → falls through to settings", () => {
    useWorkflowEditStore.getState().setPreserveYamlFormatting(null);
    expect(useWorkflowEditStore.getState().preserveYamlFormatting).toBeNull();
  });

  it("with preserve=false, comments are dropped (reformat path)", () => {
    const s = useWorkflowEditStore.getState();
    s.setPreserveYamlFormatting(false);
    s.queuePatch({ kind: "workflow.set", path: "name", value: "renamed" });
    const out = s.applyAndSerialize(SAMPLE);
    // Reformat path round-trips via yaml.stringify; comments are lost.
    expect(commentSet(out).size).toBe(0);
    // But the data change still applies.
    expect(out).toMatch(/name: renamed/);
  });

  it("with preserve=true, comments survive", () => {
    const s = useWorkflowEditStore.getState();
    s.queuePatch({ kind: "workflow.set", path: "name", value: "renamed" });
    const out = s.applyAndSerialize(SAMPLE);
    expect(commentSet(out).size).toBeGreaterThan(0);
  });

  it("with override=null, falls through to settings store (default true)", () => {
    const s = useWorkflowEditStore.getState();
    s.setPreserveYamlFormatting(null);
    s.queuePatch({ kind: "workflow.set", path: "name", value: "renamed" });
    const out = s.applyAndSerialize(SAMPLE);
    // Default settings.workflowEditorPreserveYamlFormatting is true.
    expect(commentSet(out).size).toBeGreaterThan(0);
  });
});
