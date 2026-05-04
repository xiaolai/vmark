// WI-3.x — workflow inline preview tests.
//
// Tests the Mermaid-via-IR pipeline: parse YAML → IR → toMermaid →
// renderMermaid (mocked). Pure logic; no DOM mounting.

import { describe, expect, it, vi } from "vitest";

const renderMermaidMock = vi.hoisted(() => vi.fn());
vi.mock("@/plugins/mermaid", () => ({ renderMermaid: renderMermaidMock }));

import { workflowYamlToMermaid, updateWorkflowLivePreview } from "./renderWorkflowPreview";

describe("workflowYamlToMermaid", () => {
  it("returns a Mermaid flowchart string for a valid workflow", async () => {
    const yaml = `name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps: []
  test:
    runs-on: ubuntu-latest
    needs: build
    steps: []
`;
    const out = await workflowYamlToMermaid(yaml);
    expect(out).toMatch(/^flowchart TD/m);
    expect(out).toMatch(/build/);
    expect(out).toMatch(/test/);
    expect(out).toMatch(/build\s*-->\s*test/);
  });

  it("returns a placeholder Mermaid for empty/invalid yaml", async () => {
    const out = await workflowYamlToMermaid("");
    expect(out).toMatch(/^flowchart TD/m);
    expect(out).toMatch(/empty|no jobs/i);
  });

  it("does not throw on malformed YAML", async () => {
    await expect(workflowYamlToMermaid("not: ::: bad")).resolves.toBeDefined();
  });
});

describe("updateWorkflowLivePreview", () => {
  beforeEach(() => {
    renderMermaidMock.mockReset();
  });

  it("invokes renderMermaid with the IR-derived Mermaid string", async () => {
    renderMermaidMock.mockResolvedValue("<svg/>");
    const el = document.createElement("div");
    await updateWorkflowLivePreview(
      el,
      `on: push
jobs:
  a:
    runs-on: x
    steps: []`,
      1,
      () => 1,
    );
    expect(renderMermaidMock).toHaveBeenCalledTimes(1);
    const arg = renderMermaidMock.mock.calls[0][0];
    expect(arg).toMatch(/flowchart/);
  });

  it("renders the SVG into the element", async () => {
    renderMermaidMock.mockResolvedValue("<svg id='x'/>");
    const el = document.createElement("div");
    await updateWorkflowLivePreview(
      el,
      `on: push
jobs:
  a:
    runs-on: x
    steps: []`,
      1,
      () => 1,
    );
    expect(el.innerHTML).toContain("svg");
  });

  it("renders an error placeholder when renderMermaid returns null", async () => {
    renderMermaidMock.mockResolvedValue(null);
    const el = document.createElement("div");
    await updateWorkflowLivePreview(
      el,
      `on: push
jobs:
  a:
    runs-on: x
    steps: []`,
      1,
      () => 1,
    );
    expect(el.innerHTML).toMatch(/invalid|failed|error/i);
  });

  it("aborts if the token has been bumped (stale render guard)", async () => {
    renderMermaidMock.mockResolvedValue("<svg/>");
    const el = document.createElement("div");
    let token = 1;
    await updateWorkflowLivePreview(
      el,
      `on: push
jobs:
  a:
    runs-on: x
    steps: []`,
      1,
      () => {
        token = 2;
        return token;
      },
    );
    // Stale guard ran AFTER renderMermaid resolved; element should NOT
    // have been updated.
    expect(el.innerHTML).toBe("");
  });
});

import { beforeEach } from "vitest";
