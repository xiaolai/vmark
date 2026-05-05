// WI-A.1 — expression-context autocomplete tests. TDD-first.

import { describe, it, expect } from "vitest";
import {
  buildExpressionContext,
  completeAtPosition,
  GITHUB_PROPERTIES,
} from "./expressionCompletion";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";

function makeIR(overrides: Partial<WorkflowIR> = {}): WorkflowIR {
  return {
    triggers: [
      {
        event: "push",
        branches: ["main"],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    permissions: undefined,
    env: {},
    jobs: [
      {
        id: "build",
        runsOn: ["ubuntu-latest"],
        needs: [],
        steps: [
          {
            id: "checkout",
            idSynthesized: false,
            uses: "actions/checkout@v4",
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          },
          {
            id: "build",
            idSynthesized: false,
            run: "make",
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          },
        ],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    positions: {},
    diagnostics: [],
    ...overrides,
  } as WorkflowIR;
}

describe("buildExpressionContext", () => {
  it("collects job ids", () => {
    const ctx = buildExpressionContext(makeIR(), null);
    expect(ctx.jobIds).toEqual(["build"]);
  });

  it("collects step ids of the active job", () => {
    const ctx = buildExpressionContext(makeIR(), "build");
    expect(ctx.stepIds).toEqual(["checkout", "build"]);
  });

  it("returns no step ids when not in a job scope", () => {
    const ctx = buildExpressionContext(makeIR(), null);
    expect(ctx.stepIds).toEqual([]);
  });

  it("collects env keys at workflow + active-job + step scope", () => {
    const ir = makeIR({
      env: { GLOBAL: "x" },
      jobs: [
        {
          id: "build",
          runsOn: ["ubuntu-latest"],
          needs: [],
          env: { JOB_ONLY: "y" },
          steps: [
            {
              id: "s1",
              idSynthesized: false,
              run: "echo",
              env: { STEP_ONLY: "z" },
              position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            },
          ],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const ctx = buildExpressionContext(ir, "build");
    expect(ctx.envKeys).toEqual(
      expect.arrayContaining(["GLOBAL", "JOB_ONLY", "STEP_ONLY"]),
    );
  });

  it("collects workflow_call inputs as inputs.* candidates", () => {
    const ir = makeIR({
      triggers: [
        {
          event: "workflow_call",
          inputs: {
            "image-tag": { type: "string", required: true },
            "node-version": { type: "string", required: false, default: "20" },
          },
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const ctx = buildExpressionContext(ir, null);
    expect(ctx.inputs).toEqual(
      expect.arrayContaining(["image-tag", "node-version"]),
    );
  });

  it("collects matrix dimensions from active job's strategy", () => {
    const ir = makeIR({
      jobs: [
        {
          id: "test",
          runsOn: ["ubuntu-latest"],
          needs: [],
          strategy: {
            matrix: {
              dimensions: { os: ["ubuntu-latest"], node: ["18", "20"] },
            },
          },
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const ctx = buildExpressionContext(ir, "test");
    expect(ctx.matrixDimensions).toEqual(
      expect.arrayContaining(["os", "node"]),
    );
  });
});

describe("completeAtPosition — context detection", () => {
  it("returns null when cursor is NOT inside a ${{ }} expression", () => {
    const result = completeAtPosition("name: ci\non: push\n", 5, makeIR());
    expect(result).toBeNull();
  });

  it("returns null at the literal text outside expression boundary", () => {
    const text = "if: ${{ steps.checkout.outputs.foo }}";
    const result = completeAtPosition(text, 0, makeIR());
    expect(result).toBeNull();
  });

  it("activates inside ${{ }} delimiters", () => {
    const text = "if: ${{  }}";
    const result = completeAtPosition(text, 8, makeIR()); // cursor between the spaces
    expect(result).not.toBeNull();
  });

  it("activates inside multi-line ${{ }}", () => {
    const text = "if: ${{\n  steps.\n}}";
    // After "steps." (line 2)
    const cursor = text.indexOf(".") + 1;
    const result = completeAtPosition(text, cursor, makeIR());
    expect(result).not.toBeNull();
  });

  it("does not activate after a closing }}", () => {
    const text = "if: ${{ steps }} foo";
    const cursor = text.indexOf("foo") + 1;
    const result = completeAtPosition(text, cursor, makeIR());
    expect(result).toBeNull();
  });
});

describe("completeAtPosition — root-level identifiers", () => {
  it("offers github / env / steps / needs / inputs / secrets / matrix at root", () => {
    const text = "if: ${{  }}";
    const result = completeAtPosition(text, 8, makeIR("build" as never));
    expect(result?.options.map((o) => o.label)).toEqual(
      expect.arrayContaining([
        "github",
        "env",
        "steps",
        "needs",
        "inputs",
        "secrets",
        "matrix",
      ]),
    );
  });

  it("filters root identifiers by typed prefix", () => {
    const text = "if: ${{ ste }}";
    const cursor = text.indexOf("ste") + 3;
    const result = completeAtPosition(text, cursor, makeIR());
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("steps");
    expect(labels).not.toContain("github");
  });
});

describe("completeAtPosition — dotted paths", () => {
  it("steps.<TAB> offers step ids of the active job", () => {
    const text = "if: ${{ steps. }}";
    const cursor = text.indexOf("steps.") + "steps.".length;
    const result = completeAtPosition(text, cursor, makeIR(), "build");
    expect(result?.options.map((o) => o.label)).toEqual(
      expect.arrayContaining(["checkout", "build"]),
    );
  });

  it("needs.<TAB> offers job ids", () => {
    const ir = makeIR({
      jobs: [
        {
          id: "lint",
          runsOn: ["ubuntu-latest"],
          needs: [],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
        {
          id: "test",
          runsOn: ["ubuntu-latest"],
          needs: ["lint"],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const text = "if: ${{ needs. }}";
    const cursor = text.indexOf("needs.") + "needs.".length;
    const result = completeAtPosition(text, cursor, ir);
    expect(result?.options.map((o) => o.label)).toEqual(
      expect.arrayContaining(["lint", "test"]),
    );
  });

  it("env.<TAB> offers env keys (workflow + job + step scope)", () => {
    const ir = makeIR({
      env: { GLOBAL: "x" },
      jobs: [
        {
          id: "build",
          runsOn: ["ubuntu-latest"],
          needs: [],
          env: { JOB_ONLY: "y" },
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const text = "if: ${{ env. }}";
    const cursor = text.indexOf("env.") + "env.".length;
    const result = completeAtPosition(text, cursor, ir, "build");
    expect(result?.options.map((o) => o.label)).toEqual(
      expect.arrayContaining(["GLOBAL", "JOB_ONLY"]),
    );
  });

  it("github.<TAB> offers static github properties", () => {
    const text = "if: ${{ github. }}";
    const cursor = text.indexOf("github.") + "github.".length;
    const result = completeAtPosition(text, cursor, makeIR());
    const labels = result?.options.map((o) => o.label) ?? [];
    // sanity check — well-known github.* names
    expect(labels).toEqual(
      expect.arrayContaining(["event_name", "actor", "ref", "sha"]),
    );
    expect(GITHUB_PROPERTIES).toContain("event_name");
  });

  it("steps.<id>.outputs.<TAB> would offer output names if outputs were known", () => {
    // Outputs aren't inferable from the IR alone (action.yml or job
    // outputs map). For now the third level returns no completions —
    // documented gap, will fill in when ContextProvider lands.
    const text = "if: ${{ steps.checkout.outputs. }}";
    const cursor =
      text.indexOf("outputs.") + "outputs.".length;
    const result = completeAtPosition(text, cursor, makeIR(), "build");
    // Empty options list, but result is not null (we matched the path).
    expect(result?.options).toEqual([]);
  });
});

describe("completeAtPosition — second-level paths", () => {
  it("steps.<id>. offers outputs/outcome/conclusion", () => {
    const text = "if: ${{ steps.checkout. }}";
    const cursor = text.indexOf("checkout.") + "checkout.".length;
    const result = completeAtPosition(text, cursor, makeIR(), "build");
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toEqual(
      expect.arrayContaining(["outputs", "outcome", "conclusion"]),
    );
  });

  it("needs.<id>. offers outputs/result", () => {
    const text = "if: ${{ needs.lint. }}";
    const cursor = text.indexOf("lint.") + "lint.".length;
    const result = completeAtPosition(text, cursor, makeIR());
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(["outputs", "result"]));
  });

  it("job.<TAB> offers container/services/status", () => {
    const text = "if: ${{ job. }}";
    const cursor = text.indexOf("job.") + "job.".length;
    const result = completeAtPosition(text, cursor, makeIR());
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toEqual(
      expect.arrayContaining(["container", "services", "status"]),
    );
  });

  it("needs.<jobId>.outputs.<TAB> offers declared job outputs", () => {
    const ir = makeIR({
      jobs: [
        {
          id: "build",
          runsOn: ["ubuntu-latest"],
          needs: [],
          outputs: { artifact: "${{ steps.x.outputs.id }}" },
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const text = "if: ${{ needs.build.outputs. }}";
    const cursor = text.indexOf("outputs.") + "outputs.".length;
    const result = completeAtPosition(text, cursor, ir);
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toContain("artifact");
  });

  it("expandRoot returns empty for unknown roots", () => {
    const text = "if: ${{ bogus. }}";
    const cursor = text.indexOf("bogus.") + "bogus.".length;
    const result = completeAtPosition(text, cursor, makeIR());
    expect(result?.options).toEqual([]);
  });

  it("expandRoot — inputs root surfaces workflow_call inputs", () => {
    const ir = makeIR({
      triggers: [
        {
          event: "workflow_call",
          inputs: {
            "image-tag": { type: "string", required: true },
          },
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const text = "if: ${{ inputs. }}";
    const cursor = text.indexOf("inputs.") + "inputs.".length;
    const result = completeAtPosition(text, cursor, ir);
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toContain("image-tag");
  });

  it("expandRoot — secrets root surfaces workflow_call secrets", () => {
    const ir = makeIR({
      triggers: [
        {
          event: "workflow_call",
          secrets: { TOKEN: { description: "auth", required: true } },
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const text = "if: ${{ secrets. }}";
    const cursor = text.indexOf("secrets.") + "secrets.".length;
    const result = completeAtPosition(text, cursor, ir);
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toContain("TOKEN");
  });

  it("expandRoot — matrix root surfaces dimensions when active job has strategy", () => {
    const ir = makeIR({
      jobs: [
        {
          id: "test",
          runsOn: ["ubuntu-latest"],
          needs: [],
          strategy: {
            matrix: {
              dimensions: { os: ["ubuntu-latest"], node: ["20"] },
            },
          },
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const text = "if: ${{ matrix. }}";
    const cursor = text.indexOf("matrix.") + "matrix.".length;
    const result = completeAtPosition(text, cursor, ir, "test");
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(["os", "node"]));
  });
});

describe("completeAtPosition — boundary edge cases", () => {
  it("handles cursor exactly at the opening ${{", () => {
    const text = "if: ${{}}";
    const cursor = text.indexOf("{{") + 2; // immediately after {{
    const result = completeAtPosition(text, cursor, makeIR());
    expect(result).not.toBeNull();
  });

  it("handles cursor at the closing }} (before)", () => {
    const text = "if: ${{ steps }}";
    const cursor = text.indexOf(" }}");
    const result = completeAtPosition(text, cursor, makeIR(), "build");
    expect(result).not.toBeNull();
  });

  it("does not crash on malformed input (unclosed expression)", () => {
    const text = "if: ${{ steps.";
    const cursor = text.length;
    expect(() => completeAtPosition(text, cursor, makeIR(), "build")).not.toThrow();
  });

  it("returns null when cursor is way past the end", () => {
    const text = "if: foo";
    const result = completeAtPosition(text, 9999, makeIR());
    expect(result).toBeNull();
  });

  it("returns null when a nested ${{ appears between cursor and closer (malformed)", () => {
    // Cursor inside the outer ${{ ... }}, but before reaching the
    // close `}}` we hit another ${{ — that's malformed and the
    // forward-walk's early bail-out should fire.
    const text = "if: ${{ foo ${{ x }} y }}";
    // Position cursor right after "foo " — backward walk finds the
    // outer opener; forward walk should hit the inner ${{ first.
    const cursor = text.indexOf("foo ") + "foo ".length;
    const result = completeAtPosition(text, cursor, makeIR());
    expect(result).toBeNull();
  });

  it("buildExpressionContext with no active job returns empty step ids", () => {
    const ctx = buildExpressionContext(makeIR(), null);
    expect(ctx.stepIds).toEqual([]);
  });

  it("hyphenated identifiers complete correctly (inputs.node-version)", () => {
    const ir = makeIR({
      triggers: [
        {
          event: "workflow_call",
          inputs: {
            "node-version": { type: "string", required: false },
          },
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    // Cursor mid-token after the hyphen.
    const text = "if: ${{ inputs.node-ver }}";
    const cursor = text.indexOf("node-ver") + "node-ver".length;
    const result = completeAtPosition(text, cursor, ir);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o: { label: string }) => o.label);
    expect(labels).toContain("node-version");
    // Replacement range covers the hyphenated prefix, not just past the dash.
    expect(text.slice(result!.from, result!.to)).toBe("node-ver");
  });

  it("hyphenated needs.<jobId>.outputs.<artifact-id>", () => {
    const ir = makeIR({
      jobs: [
        {
          id: "build",
          runsOn: ["ubuntu-latest"],
          needs: [],
          outputs: { "artifact-id": "${{ steps.x.outputs.id }}" },
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const text = "if: ${{ needs.build.outputs. }}";
    const cursor = text.indexOf("outputs.") + "outputs.".length;
    const result = completeAtPosition(text, cursor, ir);
    expect(result?.options.map((o: { label: string }) => o.label)).toContain(
      "artifact-id",
    );
  });

  it("scopes needs.* to direct deps only when activeJobId is set (Codex MED-3)", () => {
    const ir = makeIR({
      jobs: [
        {
          id: "lint",
          runsOn: ["ubuntu-latest"],
          needs: [],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
        {
          id: "build",
          runsOn: ["ubuntu-latest"],
          needs: ["lint"],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
        {
          id: "deploy",
          runsOn: ["ubuntu-latest"],
          needs: ["build"],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    // From "deploy", needs.* should ONLY offer "build" (its direct
    // dep), NOT "lint" (transitive).
    const text = "if: ${{ needs. }}";
    const cursor = text.indexOf("needs.") + "needs.".length;
    const result = completeAtPosition(text, cursor, ir, "deploy");
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toContain("build");
    expect(labels).not.toContain("lint");
    expect(labels).not.toContain("deploy");
  });

  it("workflow-level needs.* still offers all jobs (no activeJobId)", () => {
    const ir = makeIR({
      jobs: [
        {
          id: "a",
          runsOn: ["ubuntu-latest"],
          needs: [],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
        {
          id: "b",
          runsOn: ["ubuntu-latest"],
          needs: [],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const text = "if: ${{ needs. }}";
    const cursor = text.indexOf("needs.") + "needs.".length;
    const result = completeAtPosition(text, cursor, ir);
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("scopes steps.* to prior-or-current when cursorStepIndex is given", () => {
    // build job has [checkout, build] (from makeIR). cursorStepIndex
    // = 0 → only "checkout" offered (the build step is "future").
    const text = "if: ${{ steps. }}";
    const cursor = text.indexOf("steps.") + "steps.".length;
    const result = completeAtPosition(text, cursor, makeIR(), "build", 0);
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toEqual(["checkout"]);
  });

  it("scopes steps.* to prior+current when cursorStepIndex = 1", () => {
    const text = "if: ${{ steps. }}";
    const cursor = text.indexOf("steps.") + "steps.".length;
    const result = completeAtPosition(text, cursor, makeIR(), "build", 1);
    const labels = result?.options.map((o: { label: string }) => o.label) ?? [];
    expect(labels).toEqual(["checkout", "build"]);
  });

  it("buildExpressionContext when active job has no env returns workflow env only", () => {
    const ir = makeIR({
      env: { ONLY_GLOBAL: "x" },
      jobs: [
        {
          id: "lean",
          runsOn: ["ubuntu-latest"],
          needs: [],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    } as Partial<WorkflowIR>);
    const ctx = buildExpressionContext(ir, "lean");
    expect(ctx.envKeys).toEqual(["ONLY_GLOBAL"]);
  });
});
