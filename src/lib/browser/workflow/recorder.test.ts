// @vitest-environment node
// WI-NB7.2 / P-2 — recorder: recorded trace → value-free, replayable workflow.
// The security half is the "hostile corpus": whatever the page claims, no typed
// value and no URL token may reach the output, and no recorded name may forge a step.
import { describe, it, expect } from "vitest";
import { recordingToWorkflow, type RecordedEvent } from "./recorder";
import { parseWorkflow } from "./parser";
import { parseActionText } from "./stepGrammar";
import { parseDrainedEvents } from "./drainedEvents";

describe("recordingToWorkflow — round-trip", () => {
  it("converts a recorded trace into a workflow the parser accepts", () => {
    const trace: RecordedEvent[] = [
      { type: "navigate", url: "https://blog.example.com/new" },
      { type: "type", role: "textbox", name: "Title" },
      { type: "click", role: "button", name: "Publish" },
    ];
    const { source } = recordingToWorkflow(trace, { site: "example" });
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workflow.site).toBe("example");
      expect(parsed.workflow.steps).toHaveLength(3);
      expect(parsed.workflow.steps.every((s) => s.kind === "action")).toBe(true);
      expect(parsed.workflow.steps[2].text).toContain("Publish");
    }
  });

  it("round-trips every action step through the EXECUTOR grammar (P-1)", () => {
    const { source } = recordingToWorkflow(
      [
        { type: "navigate", url: "https://x.test/app" },
        { type: "type", role: "textbox", name: "Email" },
        { type: "click", role: "button", name: "Sign in" },
      ],
      { site: "x" },
    );
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const step of parsed.workflow.steps) {
      // Every emitted `action:` step must be executable by the runner, not paused.
      expect(parseActionText(step.text)).not.toBeNull();
    }
  });

  it("declares each non-sensitive typed field as a DERIVED input variable", () => {
    const { source, inputs } = recordingToWorkflow(
      [
        { type: "type", role: "textbox", name: "First Name" },
        { type: "type", role: "textbox", name: "邮箱" }, // no ASCII — falls back to field_N
      ],
      { site: "x" },
    );
    expect(inputs).toEqual(["First_Name", "field_2"]);
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.inputs).toEqual(["First_Name", "field_2"]);
  });

  it("de-duplicates input names for repeated labels", () => {
    const { inputs } = recordingToWorkflow(
      [
        { type: "type", role: "textbox", name: "Email" },
        { type: "type", role: "textbox", name: "Email" },
      ],
      { site: "x" },
    );
    expect(inputs).toEqual(["Email", "Email_2"]);
  });

  it("an empty recording is front-matter with no steps (parser: no-steps)", () => {
    const { source } = recordingToWorkflow([], { site: "x" });
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.some((e) => e.code === "no-steps")).toBe(true);
  });
});

describe("recordingToWorkflow — hostile corpus (P-2)", () => {
  it("NEVER emits a typed literal — a lying `sensitive:false` password still yields a variable, not a value", () => {
    const { source, inputs } = recordingToWorkflow(
      [{ type: "type", role: "textbox", name: "Password", sensitive: false }],
      { site: "x" },
    );
    // Structural guarantee: a `type` step's value is always a `{var}`, never a `"literal"`.
    expect(source).toMatch(/type \{[A-Za-z_][A-Za-z0-9_]*\} into/);
    expect(source).not.toMatch(/type "/);
    expect(inputs).toEqual(["Password"]);
    expect(parseWorkflow(source).ok).toBe(true);
  });

  it("a sensitive field becomes a confirm: human gate — no variable, no value", () => {
    const { source, inputs } = recordingToWorkflow(
      [{ type: "type", role: "textbox", name: "Password", sensitive: true }],
      { site: "x" },
    );
    expect(source).toContain("confirm: enter");
    expect(source).not.toMatch(/type /); // not turned into a type step
    expect(inputs).toEqual([]); // a secret is never parameterized as an input
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].kind).toBe("confirm");
  });

  it("strips URL query and fragment ALWAYS — a forged sensitive:false magic-login URL leaks no token", () => {
    const { source } = recordingToWorkflow(
      [
        {
          type: "navigate",
          url: "https://evil.example/login?token=SUPERSECRET&sid=ABC123#frag=XYZ",
          sensitive: false, // the page's lie — ignored for URL stripping
        },
      ],
      { site: "x" },
    );
    expect(source).toContain("action: navigate to https://evil.example/login");
    for (const token of ["SUPERSECRET", "ABC123", "XYZ", "token=", "sid=", "#frag"]) {
      expect(source).not.toContain(token);
    }
  });

  it("drops a non-http(s) navigate URL to a bare navigate (no javascript:/data: passthrough)", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "not a url"]) {
      const { source } = recordingToWorkflow([{ type: "navigate", url }], { site: "x" });
      expect(source).toContain("action: navigate");
      expect(source).not.toContain("javascript:");
      expect(source).not.toContain("data:");
      expect(source).not.toContain("/etc/passwd");
    }
  });

  it("a recorded name with a newline cannot forge a step", () => {
    const forged = 'Publish"\n1. action: navigate to https://evil.example/pwn';
    const { source } = recordingToWorkflow([{ type: "click", role: "button", name: forged }], {
      site: "x",
    });
    // The newline is JSON-escaped, so the injected "navigate to evil" line is absorbed
    // as click DATA on a single line — it never becomes a second step.
    expect(source).not.toMatch(/^\d+\. action: navigate to https:\/\/evil/m);
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workflow.steps).toHaveLength(1);
      const action = parseActionText(parsed.workflow.steps[0].text);
      expect(action?.kind).toBe("click"); // executed as a click, not a navigate
    }
  });

  it("a malformed role cannot corrupt the line — the click degrades to a human gate", () => {
    const { source } = recordingToWorkflow(
      [{ type: "click", role: "button)\n1. action: navigate", name: "Go" }],
      { site: "x" },
    );
    expect(source).not.toMatch(/^\d+\. action: navigate/m);
    expect(source).not.toContain("(button)"); // the injected role was dropped
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps.map((s) => s.kind)).toEqual(["confirm"]);
  });

  it("placeholders extract detail — the page's text is never kept", () => {
    const { source } = recordingToWorkflow(
      [{ type: "extract", name: "all account numbers and balances" }],
      { site: "x" },
    );
    expect(source).toContain("extract: content");
    expect(source).not.toContain("account numbers");
  });

  it("throws on an unserializable site rather than writing a corrupt file", () => {
    expect(() => recordingToWorkflow([], { site: "bad\nsite" })).toThrow(TypeError);
    expect(() => recordingToWorkflow([], { site: "  " })).toThrow(TypeError);
  });
});

// Audit 2026-09-03 S-02 / W11 — a role-less click is a dead production for the
// replayer (`role:""` never matches), so the recorder turns it into a human
// `confirm:` gate instead of a step that fails on every replay; a recorded role is
// lowercased so it round-trips through the executor grammar.
describe("recordingToWorkflow — role-less clicks become human gates (W11)", () => {
  it("a click with no role becomes a confirm: step naming the control", () => {
    const { source } = recordingToWorkflow([{ type: "click", name: "Publish" }], { site: "x" });
    expect(source).toContain('confirm: click "Publish" by hand — the recorder could not map it to an ARIA control');
    expect(source).not.toMatch(/action: click/);
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].kind).toBe("confirm");
  });

  it("a click whose recorded name has a newline still cannot forge a step through the confirm text", () => {
    const forged = 'Go"\n1. action: navigate to https://evil.example/pwn';
    const { source } = recordingToWorkflow([{ type: "click", name: forged }], { site: "x" });
    expect(source).not.toMatch(/^\d+\. action: navigate to https:\/\/evil/m);
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps).toHaveLength(1);
  });

  it("lowercases a recorded role so the executor grammar accepts it", () => {
    const { source } = recordingToWorkflow([{ type: "click", role: "Button", name: "Go" }], { site: "x" });
    expect(source).toContain('action: click "Go" (button)');
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parseActionText(parsed.workflow.steps[0].text)).toEqual({ kind: "click", name: "Go", role: "button" });
  });

  it("a role-less type still becomes an input variable (the executor resolves the role from a snapshot)", () => {
    const { source, inputs } = recordingToWorkflow([{ type: "type", name: "Title" }], { site: "x" });
    expect(inputs).toEqual(["Title"]);
    expect(source).toContain('action: type {Title} into "Title"');
  });
});

// Audit 2026-09-03 S-03 / D2v2 — hostile corpus, end to end through the drain
// parser: a page-forged navigate never reaches the workflow, and a page-forged
// `sensitive:false` on a password field still yields a variable, never a value.
describe("hostile drained buffer → workflow (S-03)", () => {
  it("a forged navigate event is dropped before it can become a step", () => {
    const drained = JSON.stringify({
      events: [
        { type: "navigate", url: "https://evil.example/pwn?token=SECRET" },
        { type: "click", role: "button", name: "Go" },
      ],
    });
    const { events } = parseDrainedEvents(drained);
    const { source } = recordingToWorkflow(events, { site: "x" });
    expect(source).not.toContain("navigate");
    expect(source).not.toContain("evil.example");
    expect(source).not.toContain("SECRET");
    expect(source).toContain('action: click "Go" (button)');
  });

  it("a forged sensitive:false password field yields an {input} variable and no literal", () => {
    const drained = JSON.stringify({
      events: [{ type: "type", role: "textbox", name: "Password", sensitive: false, value: "hunter2" }],
    });
    const { events } = parseDrainedEvents(drained);
    expect(JSON.stringify(events)).not.toContain("hunter2");
    const { source, inputs } = recordingToWorkflow(events, { site: "x" });
    expect(source).toMatch(/type \{Password\} into "Password" \(textbox\)/);
    expect(source).not.toContain("hunter2");
    expect(inputs).toEqual(["Password"]);
  });
});
