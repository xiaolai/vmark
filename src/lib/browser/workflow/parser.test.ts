// Web-workflow file parser (ADR-W1, WI-4.1). Pure: markdown workflow file → typed IR.
// Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "./parser";

const wf = (body: string) => parseWorkflow(body);

describe("parseWorkflow — happy path", () => {
  it("parses front-matter and typed steps", () => {
    const r = wf(
      [
        "---",
        "site: zhihu",
        "inputs: [article_path]",
        "---",
        "1. goal: open my creator dashboard",
        "2. extract: new comments since last run",
        "3. confirm: show me the drafts",
        "4. action: click 回复 and submit",
      ].join("\n"),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workflow.site).toBe("zhihu");
    expect(r.workflow.inputs).toEqual(["article_path"]);
    expect(r.workflow.steps).toHaveLength(4);
    expect(r.workflow.steps[0]).toMatchObject({ index: 1, kind: "goal", text: "open my creator dashboard" });
    expect(r.workflow.steps[3]).toMatchObject({ kind: "action", text: "click 回复 and submit" });
    expect(r.warnings).toEqual([]);
  });

  it("accepts steps with `-` list markers and no marker", () => {
    const r = wf(["---", "site: x", "---", "- goal: a", "goal: b"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workflow.steps.map((s) => s.text)).toEqual(["a", "b"]);
  });

  it("defaults inputs to [] when omitted", () => {
    const r = wf(["---", "site: x", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workflow.inputs).toEqual([]);
  });

  it("preserves CJK and skips blank lines and comments", () => {
    const r = wf(["---", "site: x", "---", "", "# a comment", "goal: 打开知乎专栏"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workflow.steps).toHaveLength(1);
    expect(r.workflow.steps[0].text).toBe("打开知乎专栏");
  });

  it("records the source line of each step for diagnostics", () => {
    const r = wf(["---", "site: x", "---", "goal: a", "", "action: b"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workflow.steps[0].line).toBe(4);
    expect(r.workflow.steps[1].line).toBe(6);
  });
});

describe("parseWorkflow — errors", () => {
  it("errors when front-matter is missing", () => {
    const r = wf("goal: do a thing");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/front-matter/i);
  });

  it("errors when front-matter is unterminated", () => {
    const r = wf(["---", "site: x", "goal: a"].join("\n"));
    expect(r.ok).toBe(false);
  });

  it("keeps errors accumulated before EOF when the front-matter is unterminated (collect-all)", () => {
    // A duplicate key seen before the missing `---` must not be discarded — one pass
    // shows every diagnostic, terminated or not.
    const r = wf(["---", "site: a", "site: b", "goal: x"].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "unterminated-front-matter")).toBe(true);
    expect(r.errors.some((e) => e.code === "duplicate-front-matter-key")).toBe(true);
  });

  it("does not catastrophically backtrack on a whitespace-heavy malformed step line (ReDoS guard)", () => {
    const line = `x:${" ".repeat(50_000)}`;
    const start = performance.now();
    const r = wf(["---", "site: x", "---", "goal: ok", line].join("\n"));
    const elapsed = performance.now() - start;
    expect(r.ok).toBe(false); // empty text after the colon → malformed
    expect(elapsed).toBeLessThan(1000); // linear parse, not seconds of backtracking
  });

  it("treats a step with only whitespace after the colon as malformed", () => {
    const r = wf(["---", "site: x", "---", "action:   "].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "malformed-step")).toBe(true);
  });

  it("errors when `site` is missing", () => {
    const r = wf(["---", "inputs: [a]", "---", "goal: a"].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /site/i.test(e.message))).toBe(true);
  });

  it("errors on an unknown step kind, naming the line", () => {
    const r = wf(["---", "site: x", "---", "goal: a", "frobnicate: b"].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const err = r.errors.find((e) => /frobnicate|unknown step/i.test(e.message));
    expect(err?.line).toBe(5);
  });

  it("errors when a step line has no `kind:` prefix", () => {
    const r = wf(["---", "site: x", "---", "just some prose"].join("\n"));
    expect(r.ok).toBe(false);
  });

  it("errors when the body has no steps", () => {
    const r = wf(["---", "site: x", "---", "", "# only a comment"].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /no steps/i.test(e.message))).toBe(true);
  });

  it("collects multiple errors rather than stopping at the first", () => {
    const r = wf(["---", "site: x", "---", "bogus: a", "alsobad: b"].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("parseWorkflow — front-matter fields", () => {
  it("parses an optional `trigger` field into the IR", () => {
    const r = wf(["---", "site: x", "trigger: manual", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workflow.trigger).toBe("manual");
  });

  it("leaves trigger undefined when absent", () => {
    const r = wf(["---", "site: x", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workflow.trigger).toBeUndefined();
  });

  it("warns on an unknown front-matter key", () => {
    const r = wf(["---", "site: x", "colour: blue", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => /colour|unknown/i.test(w.message))).toBe(true);
  });

  it("errors on a duplicated front-matter key", () => {
    const r = wf(["---", "site: a", "site: b", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it("warns on an unknown HYPHENATED front-matter key (not silently skipped)", () => {
    const r = wf(["---", "site: x", "some-key: v", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => w.code === "unknown-front-matter-key" && /some-key/.test(w.message))).toBe(true);
  });

  it("attaches a stable diagnostic code (for later i18n) to every diagnostic", () => {
    const r = wf("goal: no front-matter");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBeTruthy();
  });

  it("ERRORS on a malformed front-matter line — a typo must not silently drop a field", () => {
    // `inputs [title]` (missing colon) used to be skipped in silence: the workflow
    // then parsed fine with NO inputs, quietly changing what it executes.
    const r = wf(["---", "site: x", "inputs [title]", "---", "goal: post {title}"].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const e = r.errors.find((d) => d.code === "malformed-front-matter");
    expect(e?.line).toBe(3);
  });

  it("still tolerates blank lines and `#` comments inside front-matter", () => {
    const r = wf(["---", "", "# what this does", "site: x", "  ", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(true);
  });

  it("keeps warnings alongside errors so one pass shows every diagnostic", () => {
    const r = wf(["---", "site: x", "colour: blue", "---", "bogus: step"].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "unknown-step-kind")).toBe(true);
    expect(r.warnings.some((w) => w.code === "unknown-front-matter-key")).toBe(true);
  });

  it("parses a file that begins with a UTF-8 BOM", () => {
    const r = wf(["\uFEFF---", "site: x", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workflow.site).toBe("x");
  });
});

describe("parseWorkflow — inputs validation", () => {
  it.each([
    ["inputs: [a, b"],
    ["inputs: a, b]"],
    ["inputs: ]"],
  ])("errors on malformed bracket syntax (%s)", (line) => {
    const r = wf(["---", "site: x", line, "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(false);
  });

  it("errors on an invalid variable name", () => {
    const r = wf(["---", "site: x", "inputs: [1bad, ok]", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(false);
  });

  it("errors on a duplicated input name", () => {
    const r = wf(["---", "site: x", "inputs: [a, a]", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(false);
  });

  it("errors on an empty entry (e.g. [a,,b])", () => {
    const r = wf(["---", "site: x", "inputs: [a,,b]", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(false);
  });

  it("reports the ACTUAL inputs line, not the front-matter header line", () => {
    const r = wf(["---", "site: x", "trigger: t", "inputs: [1bad]", "---", "goal: go"].join("\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const e = r.errors.find((d) => d.code === "invalid-input-name");
    expect(e?.line).toBe(4);
  });
});

describe("parseWorkflow — every step kind (incl. api, which replays authenticated requests)", () => {
  it.each(["api", "action", "goal", "confirm", "extract"])("accepts the '%s' step kind", (kind) => {
    const r = wf(["---", "site: x", "---", `${kind}: do the thing`].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workflow.steps[0].kind).toBe(kind);
  });

  it.each(["API", "Api", "gaol", "extractt"])("rejects the near-miss step kind '%s'", (kind) => {
    const r = wf(["---", "site: x", "---", `${kind}: x`].join("\n"));
    expect(r.ok).toBe(false);
  });
});

describe("parseWorkflow — variable references", () => {
  it("warns (not errors) on a {var} not declared in inputs", () => {
    const r = wf(["---", "site: x", "inputs: [a]", "---", "goal: use {a} and {b}"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toMatch(/\bb\b/);
    expect(r.warnings[0].line).toBe(5);
  });

  it("does not warn when every {var} is declared", () => {
    const r = wf(["---", "site: x", "inputs: [a, b]", "---", "goal: use {a} then {b}"].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
  });
});
