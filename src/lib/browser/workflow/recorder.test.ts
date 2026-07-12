// WI-4.3 / R10 — recorder: action trace → parseable workflow, secrets redacted
import { describe, it, expect } from "vitest";
import { traceToWorkflow, type RecordedEvent } from "./recorder";
import { parseWorkflow } from "./parser";

describe("traceToWorkflow", () => {
  it("converts a recorded trace into a workflow the parser accepts", () => {
    const trace: RecordedEvent[] = [
      { type: "navigate", url: "https://blog.example.com/new" },
      { type: "type", role: "textbox", name: "Title", text: "My Post" },
      { type: "click", role: "button", name: "Publish" },
    ];
    const src = traceToWorkflow(trace, { site: "example" });
    const parsed = parseWorkflow(src);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workflow.site).toBe("example");
      expect(parsed.workflow.steps).toHaveLength(3);
      expect(parsed.workflow.steps.every((s) => s.kind === "action")).toBe(true);
      expect(parsed.workflow.steps[2].text).toContain("Publish");
    }
  });

  it("never captures a secret — sensitive values are redacted (R10)", () => {
    const trace: RecordedEvent[] = [
      { type: "type", role: "textbox", name: "Password", text: "hunter2", sensitive: true },
    ];
    const src = traceToWorkflow(trace, { site: "x" });
    expect(src).not.toContain("hunter2");
    expect(src).toContain("Password");
    expect(parseWorkflow(src).ok).toBe(true);
  });

  it("declares inputs in the front-matter", () => {
    const src = traceToWorkflow([{ type: "navigate", url: "https://x.test/" }], {
      site: "x",
      inputs: ["title", "body"],
    });
    const parsed = parseWorkflow(src);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.inputs).toEqual(["title", "body"]);
  });

  it("emits extract steps as `extract:`", () => {
    const src = traceToWorkflow([{ type: "extract", name: "the article title" }], { site: "x" });
    const parsed = parseWorkflow(src);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workflow.steps[0].kind).toBe("extract");
      expect(parsed.workflow.steps[0].text).toContain("article title");
    }
  });

  it("emits front-matter for an empty trace (which the parser flags as step-less)", () => {
    const src = traceToWorkflow([], { site: "x" });
    expect(src).toContain("site: x");
    // An empty recording has no steps — not a runnable workflow; the parser says so.
    expect(parseWorkflow(src).ok).toBe(false);
  });
});
