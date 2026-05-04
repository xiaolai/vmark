// Audit follow-up — split target for lazy-loading xyflow.
//
// WorkflowCanvasInner is the xyflow subtree extracted from WorkflowCanvas.
// The behaviorally-meaningful tests live in WorkflowCanvas.test.tsx (job
// id reaches DOM, JobNode type registers). This file confirms the
// module's default export still works under React.lazy expectations.

import { describe, expect, it } from "vitest";
import { WorkflowCanvasInner } from "../WorkflowCanvasInner";
import WorkflowCanvasInnerDefault from "../WorkflowCanvasInner";

describe("WorkflowCanvasInner module shape", () => {
  it("exports the named WorkflowCanvasInner component", () => {
    expect(typeof WorkflowCanvasInner).toBe("function");
  });

  it("provides a default export so React.lazy can resolve it", () => {
    expect(WorkflowCanvasInnerDefault).toBe(WorkflowCanvasInner);
  });
});
