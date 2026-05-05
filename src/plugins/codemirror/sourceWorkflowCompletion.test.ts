// WI-A.1 — CodeMirror integration tests for workflow expression
// completion. Tests the wiring (state sync, activation regions),
// not the inner logic (covered by expressionCompletion.test.ts).

import { describe, it, expect, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";
import { workflowCompletionSource } from "./sourceWorkflowCompletion";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";

function makeIR(): WorkflowIR {
  return {
    triggers: [
      {
        event: "push",
        branches: ["main"],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    permissions: undefined,
    env: { DEPLOY_ENV: "prod" },
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
        ],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    positions: {},
    diagnostics: [],
  } as WorkflowIR;
}

beforeEach(() => {
  useGhaWorkflowPanelStore.setState({ workflow: null, parseError: null });
});

describe("workflowCompletionSource — gating", () => {
  it("returns null when no workflow IR is available in the store", () => {
    const text = "if: ${{ ste }}";
    const state = EditorState.create({ doc: text });
    const ctx = mkContext(state, text.indexOf("ste") + 3);
    expect(workflowCompletionSource(ctx)).toBeNull();
  });

  it("returns null when cursor is outside any ${{ }} expression", () => {
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    const text = "name: ci\n";
    const state = EditorState.create({ doc: text });
    const ctx = mkContext(state, 5);
    expect(workflowCompletionSource(ctx)).toBeNull();
  });

  it("returns completions inside ${{ }} when IR is available", () => {
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    const text = "if: ${{ ste }}";
    const state = EditorState.create({ doc: text });
    const ctx = mkContext(state, text.indexOf("ste") + 3);
    const result = workflowCompletionSource(ctx);
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("steps");
  });
});

describe("workflowCompletionSource — explicit-only honoured outside expressions", () => {
  it("does not produce results without explicit completion outside ${{ }}", () => {
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    const text = "name: ci\n";
    const state = EditorState.create({ doc: text });
    const ctx = mkContext(state, 5, /* explicit */ false);
    expect(workflowCompletionSource(ctx)).toBeNull();
  });
});

describe("workflowCompletionSource — option mapping", () => {
  it("maps context-category items to 'namespace' type icon", () => {
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    const text = "if: ${{  }}";
    const state = EditorState.create({ doc: text });
    const ctx = mkContext(state, 8);
    const result = workflowCompletionSource(ctx);
    const githubItem = result?.options.find((o) => o.label === "github");
    expect(githubItem?.type).toBe("namespace");
  });

  it("maps github-property items to 'constant' type icon", () => {
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    const text = "if: ${{ github. }}";
    const cursor = text.indexOf("github.") + "github.".length;
    const state = EditorState.create({ doc: text });
    const ctx = mkContext(state, cursor);
    const result = workflowCompletionSource(ctx);
    const eventNameItem = result?.options.find(
      (o) => o.label === "event_name",
    );
    expect(eventNameItem?.type).toBe("constant");
  });

  it("maps identifier items (env keys) to 'variable' type icon", () => {
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    const text = "if: ${{ env. }}";
    const cursor = text.indexOf("env.") + "env.".length;
    const state = EditorState.create({ doc: text });
    const ctx = mkContext(state, cursor);
    const result = workflowCompletionSource(ctx);
    const deployEnvItem = result?.options.find(
      (o) => o.label === "DEPLOY_ENV",
    );
    expect(deployEnvItem?.type).toBe("variable");
  });

  it("returns null when result has zero options (avoids empty popup)", () => {
    // steps.<id>.outputs.<TAB> returns empty options per WI-A.1 risk
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    const text = "if: ${{ steps.checkout.outputs. }}";
    const cursor = text.indexOf("outputs.") + "outputs.".length;
    const state = EditorState.create({ doc: text });
    const ctx = mkContext(state, cursor);
    expect(workflowCompletionSource(ctx)).toBeNull();
  });
});

describe("workflowCompletionExtension — factory", () => {
  it("returns a CodeMirror Extension array (does not throw on construction)", async () => {
    const mod = await import("./sourceWorkflowCompletion");
    expect(typeof mod.workflowCompletionExtension).toBe("function");
    const ext = mod.workflowCompletionExtension();
    expect(ext).toBeDefined();
  });
});

describe("workflowCompletionSource — job-scope detection from cursor", () => {
  it("scopes steps.* completions to the job whose position contains the cursor", () => {
    // Two jobs; cursor on a line inside the SECOND job. The IR
    // position ranges declare which job each line belongs to.
    const text = [
      "name: ci",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - id: checkout",
      "        uses: actions/checkout@v4",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - id: install",
      "        run: ${{ steps. }}",
      "      - id: pytest",
      "        run: pytest",
    ].join("\n");
    const ir: WorkflowIR = {
      triggers: [
        {
          event: "push",
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
              position: { startLine: 7, startCol: 1, endLine: 8, endCol: 30 },
            },
          ],
          position: { startLine: 4, startCol: 1, endLine: 8, endCol: 30 },
        },
        {
          id: "test",
          runsOn: ["ubuntu-latest"],
          needs: [],
          steps: [
            {
              id: "install",
              idSynthesized: false,
              run: "echo",
              position: { startLine: 12, startCol: 1, endLine: 13, endCol: 30 },
            },
            {
              id: "pytest",
              idSynthesized: false,
              run: "pytest",
              position: { startLine: 14, startCol: 1, endLine: 15, endCol: 12 },
            },
          ],
          position: { startLine: 9, startCol: 1, endLine: 15, endCol: 12 },
        },
      ],
      positions: {},
      diagnostics: [],
    } as WorkflowIR;
    useGhaWorkflowPanelStore.setState({ workflow: ir, parseError: null });

    const state = EditorState.create({ doc: text });
    // Cursor on line 13 (1-based) at "${{ steps. " position.
    const lineStart = state.doc.line(13).from;
    const cursor = lineStart + text.split("\n")[12].indexOf("steps.") + "steps.".length;
    const ctx = mkContext(state, cursor);

    const result = workflowCompletionSource(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    // Should see only PRIOR steps (install) per GHA semantics — pytest
    // hasn't run yet at the cursor location. Codex MED-3 fix.
    expect(labels).toContain("install");
    expect(labels).not.toContain("pytest");
    // build job's steps must not leak across job boundaries.
    expect(labels).not.toContain("checkout");
  });
});

// Minimal CompletionContext stub — the source signature uses only
// `state.doc` and `pos`. Avoids pulling in the full `@codemirror/view`
// dependency just for testing.
function mkContext(state: EditorState, pos: number, explicit = true) {
  return {
    state,
    pos,
    explicit,
    matchBefore() {
      return null;
    },
    aborted: false,
    tokenBefore() {
      return null;
    },
  } as never;
}
