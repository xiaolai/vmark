import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The workflow port has no working default, unlike the peek and block-math
 * registries: its state is read by React panels the plugin cannot see, so an
 * in-memory stand-in would parse workflows into a void. Reaching the unbound
 * path therefore needs a fresh module instance.
 */
let bindWorkflowPort: typeof import("./workflowPort").bindWorkflowPort;
let workflowPort: typeof import("./workflowPort").workflowPort;

beforeEach(async () => {
  vi.resetModules();
  ({ bindWorkflowPort, workflowPort } = await import("./workflowPort"));
});

describe("workflowPort", () => {
  it("throws a message naming the fix when nothing was bound", () => {
    expect(() => workflowPort()).toThrow(/call bindWorkflowPort\(\)/);
  });

  it("returns the port once bound", () => {
    const port = { getState: () => ({}) } as never;
    bindWorkflowPort(port);
    expect(workflowPort()).toBe(port);
  });

  it("rebinding replaces the previous port", () => {
    const first = { getState: () => ({ id: 1 }) } as never;
    const second = { getState: () => ({ id: 2 }) } as never;
    bindWorkflowPort(first);
    bindWorkflowPort(second);
    expect(workflowPort()).toBe(second);
  });
});
