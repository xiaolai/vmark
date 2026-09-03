// @vitest-environment node
// Audit 2026-09-03 W-05 / W-07 / W-09 — everything that must hold before a run
// starts: bounds, parse, inputs (own properties only, no undeclared extras), the
// one-live-run-per-tab guard, and the explicit resume contract.
import { describe, it, expect, beforeEach } from "vitest";
import { validateRunRequest } from "./workflowRunValidate";
import { __resetRunRegistry, createRun, updateRun } from "./runRegistry";
import { workflowIdentity } from "@/lib/browser/workflow/identity";

const TAB = "tab-1";
const SOURCE = ["---", "site: blog", "inputs: [title]", "---", '1. action: type {title} into "Title" (textbox)', '2. action: click "Publish" (button)'].join("\n");

const req = (over: Partial<Parameters<typeof validateRunRequest>[1]> = {}) => ({ tabId: TAB, inputs: { title: "x" }, ...over });
const errorOf = (r: ReturnType<typeof validateRunRequest>) => ("error" in r ? r.error : null);

beforeEach(() => __resetRunRegistry());

describe("validateRunRequest — bounds and parse", () => {
  it("accepts a well-formed request and returns the workflow with its identity", () => {
    const r = validateRunRequest(SOURCE, req());
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.workflow.steps).toHaveLength(2);
    expect(r.identity).toEqual(workflowIdentity(SOURCE, { title: "x" }, ["title"]));
    expect(r.resume).toBeNull();
  });

  it("refuses an oversized source, too many inputs, and an oversized value", () => {
    expect(errorOf(validateRunRequest(`${SOURCE}\n# ${"x".repeat(64 * 1024)}`, req()))).toMatch(/too large/);
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, "v"]));
    expect(errorOf(validateRunRequest(SOURCE, req({ inputs: many })))).toMatch(/too many inputs/);
    expect(errorOf(validateRunRequest(SOURCE, req({ inputs: { title: "x".repeat(4097) } })))).toMatch(/too large/);
  });

  it("reports parse diagnostics by code", () => {
    expect(errorOf(validateRunRequest("no front matter", req({ inputs: {} })))).toMatch(/parse failed: missing-front-matter/);
  });

  it("refuses more than 25 steps", () => {
    const many = ["---", "site: blog", "---", ...Array.from({ length: 26 }, (_, i) => `${i + 1}. action: click "B${i}" (button)`)].join("\n");
    expect(errorOf(validateRunRequest(many, req({ inputs: {} })))).toMatch(/too many steps/);
  });
});

describe("validateRunRequest — inputs (W-09)", () => {
  it("refuses a missing declared input", () => {
    expect(errorOf(validateRunRequest(SOURCE, req({ inputs: {} })))).toBe('missing input "title"');
  });

  it("checks inputs as OWN properties — an inherited `constructor` does not satisfy a declared input", () => {
    const src = ["---", "site: blog", "inputs: [constructor]", "---", '1. action: type {constructor} into "T" (textbox)'].join("\n");
    expect(errorOf(validateRunRequest(src, req({ inputs: {} })))).toBe('missing input "constructor"');
    expect("error" in validateRunRequest(src, req({ inputs: { constructor: "v" } }))).toBe(false);
  });

  it("refuses an undeclared extra input instead of silently ignoring it", () => {
    expect(errorOf(validateRunRequest(SOURCE, req({ inputs: { title: "x", extra: "y" } })))).toBe('undeclared input "extra"');
  });
});

describe("validateRunRequest — live run and resume (W-05)", () => {
  it("refuses a second run while one is RUNNING on the tab", () => {
    createRun({ tabId: TAB, sourceHash: "h", inputsHash: "i", stepCount: 1, firstStep: "step-1" });
    expect(errorOf(validateRunRequest(SOURCE, req()))).toMatch(/already running/);
  });

  it("allows a new run once the previous one is PAUSED (the documented resume path)", () => {
    const run = createRun({ tabId: TAB, sourceHash: "h", inputsHash: "i", stepCount: 1, firstStep: "step-1" });
    updateRun(run.runId, { status: "paused", pausedAt: "step-1" });
    expect("error" in validateRunRequest(SOURCE, req())).toBe(false);
  });

  it("resume: unknown run → RUN_NOT_FOUND", () => {
    expect(errorOf(validateRunRequest(SOURCE, req({ resumeRunId: "nope" })))).toBe("RUN_NOT_FOUND");
  });

  it("resume: only a paused run can be resumed", () => {
    const { sourceHash } = workflowIdentity(SOURCE, {}, []);
    const run = createRun({ tabId: TAB, sourceHash, inputsHash: "i", stepCount: 2, firstStep: "step-1" });
    updateRun(run.runId, { status: "completed" });
    expect(errorOf(validateRunRequest(SOURCE, req({ resumeRunId: run.runId })))).toBe("RESUME_NOT_PAUSED");
  });

  it("resume: the run must belong to the same tab and the same normalised source", () => {
    const { sourceHash } = workflowIdentity(SOURCE, {}, []);
    const other = createRun({ tabId: "tab-2", sourceHash, inputsHash: "i", stepCount: 2, firstStep: "step-1" });
    updateRun(other.runId, { status: "paused", pausedAt: "step-1" });
    expect(errorOf(validateRunRequest(SOURCE, req({ resumeRunId: other.runId })))).toBe("RESUME_TAB_MISMATCH");

    const mine = createRun({ tabId: TAB, sourceHash: "different", inputsHash: "i", stepCount: 2, firstStep: "step-1" });
    updateRun(mine.runId, { status: "paused", pausedAt: "step-1" });
    expect(errorOf(validateRunRequest(SOURCE, req({ resumeRunId: mine.runId })))).toBe("RESUME_SOURCE_MISMATCH");
  });

  it("resume: a whitespace/comment edit and different inputs still match the paused run", () => {
    const { sourceHash } = workflowIdentity(SOURCE, {}, []);
    const run = createRun({ tabId: TAB, sourceHash, inputsHash: "old", stepCount: 2, firstStep: "step-1" });
    updateRun(run.runId, { status: "paused", pausedAt: "step-2" });
    // A trailing comment, CRLF endings and trailing whitespace: the same workflow to the parser.
    const edited = `${SOURCE.replace(/\n/g, "\r\n")}   \r\n# resumed later\r\n\r\n`;
    const r = validateRunRequest(edited, req({ inputs: { title: "changed" }, resumeRunId: run.runId }));
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.resume?.runId).toBe(run.runId);
  });
});
