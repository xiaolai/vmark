// WI-NB9.1 — the MCP docs-drift gate's own tests (node tier, gates config).
import { describe, it, expect } from "vitest";
import { extractActions, shippedActions, undocumented } from "./check-mcp-docs.mjs";

describe("extractActions", () => {
  it("pulls the action literals out of an enum declaration", () => {
    const src = `
      inputSchema: {
        action: z
          .enum(['read', 'screenshot', 'query'])
          .describe('The action to perform'),
      }`;
    expect(extractActions(src)).toEqual(["read", "screenshot", "query"]);
  });

  it("handles a multi-line enum", () => {
    const src = `action: z.enum([
      'act', 'open',
      'navigate',
    ]).describe('x')`;
    expect(extractActions(src)).toEqual(["act", "open", "navigate"]);
  });

  it("returns [] for a tool with no action enum", () => {
    expect(extractActions("export const x = 1;")).toEqual([]);
  });
});

describe("undocumented", () => {
  const actions = [
    { file: "browser.ts", action: "act" },
    { file: "browser.ts", action: "brand_new" },
  ];
  it("flags an action missing from the doc", () => {
    const doc = "The `act` action does things.";
    expect(undocumented(actions, doc)).toEqual([{ file: "browser.ts", action: "brand_new" }]);
  });
  it("passes when every action is a code span", () => {
    const doc = "`act` and `brand_new` are both here.";
    expect(undocumented(actions, doc)).toEqual([]);
  });
});

describe("the shipped surface", () => {
  it("extracts a non-trivial set of actions from the real tools", () => {
    const actions = shippedActions();
    const names = actions.map((a) => a.action);
    expect(names).toContain("act");
    expect(names).toContain("workflow_run");
    expect(names).toContain("workflow_status");
    expect(names.length).toBeGreaterThan(10);
  });
});
