// Audit follow-up — split target for lazy-loading xyflow.
//
// WorkflowCanvasInner is the xyflow subtree extracted from WorkflowCanvas.
// The behaviorally-meaningful tests live in WorkflowCanvas.test.tsx (job
// id reaches DOM, JobNode type registers). This file confirms the named
// export the lazy call site resolves (via .then(m => ({ default: m.X }))).

import { describe, expect, it } from "vitest";
import { WorkflowCanvasInner } from "../WorkflowCanvasInner";

describe("WorkflowCanvasInner module shape", () => {
  it("exports the named WorkflowCanvasInner component", () => {
    expect(typeof WorkflowCanvasInner).toBe("function");
  });
});
