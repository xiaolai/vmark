// @vitest-environment node
// How a patch batch is checked and compiled against a workflow's text, with no tab or journal involved: the shape check names the first bad entry, a batch that changes the text yields it, one that changes nothing says so, a batch over text that does not parse is INVALID_PATCH, and a lone surrogate in a value is escaped (the INVALID_TEXT check is a backstop no patch reaches). Edge cases: an empty batch, a null entry, a missing kind, a CJK value, a lone surrogate
import { describe, it, expect } from "vitest";
import { compileWorkflowPatch, validatePatches } from "../workflowPatch";

const WORKFLOW = "name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";

describe("validatePatches", () => {
  it.each([
    ["not an array", "x", "patches must be an array"],
    ["a null entry", [null], "patches[0] must be an object"],
    ["a missing kind", [{ kind: "workflow.set" }, { path: "name" }], "patches[1].kind is missing or invalid: undefined"],
    ["an unknown kind", [{ kind: "job.delete" }], "patches[0].kind is missing or invalid: job.delete"],
  ])("refuses %s", (_name, value, message) => {
    expect(validatePatches(value)).toEqual({ error: "INVALID_PATCH", message });
  });

  it("accepts an empty batch and a well-shaped one", () => {
    expect(validatePatches([])).toEqual([]);
    const batch = [{ kind: "workflow.set", path: "name", value: "x" }];
    expect(validatePatches(batch)).toBe(batch);
  });
});

describe("compileWorkflowPatch", () => {
  it("yields the changed text", () => {
    const out = compileWorkflowPatch(WORKFLOW, [{ kind: "workflow.set", path: "name", value: "持续集成" }]);
    expect(out.status).toBe("changed");
    expect(out.status === "changed" && out.text).toMatch(/^name: 持续集成\n/);
  });

  it("says unchanged for a batch that changes nothing, and for an empty one", () => {
    expect(compileWorkflowPatch(WORKFLOW, [{ kind: "workflow.set", path: "name", value: "ci" }])).toEqual({ status: "unchanged" });
    expect(compileWorkflowPatch(WORKFLOW, [])).toEqual({ status: "unchanged" });
  });

  it("refuses a batch over text that does not parse as INVALID_PATCH", () => {
    const out = compileWorkflowPatch("name: [\n", [{ kind: "workflow.set", path: "name", value: "x" }]);
    expect(out.status).toBe("refused");
    expect(out.status === "refused" && out.error.error).toBe("INVALID_PATCH");
    expect(out.status === "refused" && out.error.message).toMatch(/^Patch application failed: /);
  });

  it("escapes a lone surrogate, so the text it yields stays well-formed", () => {
    const out = compileWorkflowPatch(WORKFLOW, [{ kind: "workflow.set", path: "name", value: "a\uD800b" }]);
    expect(out.status === "changed" && out.text).toMatch(/^name: "a\\ud800b"\n/);
  });
});
