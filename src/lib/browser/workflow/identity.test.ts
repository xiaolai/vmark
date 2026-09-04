// @vitest-environment node
// Audit 2026-09-03 W-07 / r3 #135 — the completed-write ledger is keyed on the
// PARSED workflow IR plus the declared inputs' values: two sources that parse to
// the same steps share a ledger, an edit the parser ignores cannot fork it, and a
// re-run with different inputs runs every write again.
import { describe, expect, it } from "vitest";
import { canonicalWorkflowHash, hashText, workflowIdentity } from "./identity";
import { parseWorkflow } from "./parser";
import type { WebWorkflow } from "./types";

const LINES = ["---", "site: blog", "inputs: [title]", "---", '1. action: type {title} into "Title"', '2. action: click "Publish" (button)'];
const SRC = LINES.join("\n");

function parsed(source: string): WebWorkflow {
  const result = parseWorkflow(source);
  if (!result.ok) throw new Error(result.errors.map((e) => e.code).join(", "));
  return result.workflow;
}

describe("canonicalWorkflowHash", () => {
  it("is a function of the IR's semantic fields, not of source positions", () => {
    const a = parsed(SRC);
    const shifted = parsed([...LINES.slice(0, 4), "# a comment first", "", ...LINES.slice(4)].join("\n"));
    expect(shifted.steps[0].line).not.toBe(a.steps[0].line); // the IRs differ ONLY in source positions
    expect(canonicalWorkflowHash(shifted)).toBe(canonicalWorkflowHash(a));
  });

  it("changes when a step's text, kind or order, the site, the trigger, or the step count changes", () => {
    const base = canonicalWorkflowHash(parsed(SRC));
    const variants = [
      SRC.replace("Publish", "Save"), // step text
      SRC.replace("2. action:", "2. goal:"), // step kind
      [...LINES.slice(0, 4), LINES[5], LINES[4]].join("\n"), // step order
      SRC.replace("site: blog", "site: shop"), // site
      SRC.replace("inputs: [title]", "inputs: [title]\ntrigger: manual"), // trigger
      `${SRC}\n3. confirm: looks right?`, // an added step
    ];
    const hashes = variants.map((v) => canonicalWorkflowHash(parsed(v)));
    for (const h of hashes) expect(h).not.toBe(base);
    expect(new Set(hashes).size).toBe(variants.length);
  });

  it("treats the declared-input SET as identity, not its declaration order", () => {
    const ab = parsed(SRC.replace("inputs: [title]", "inputs: [a, b]"));
    const ba = parsed(SRC.replace("inputs: [title]", "inputs: [b, a]"));
    expect(canonicalWorkflowHash(ab)).toBe(canonicalWorkflowHash(ba));
    expect(canonicalWorkflowHash(ab)).not.toBe(canonicalWorkflowHash(parsed(SRC)));
  });
});

describe("workflowIdentity — sourceHash is the parsed IR", () => {
  it("equals the canonical hash of the parsed workflow", () => {
    expect(workflowIdentity(SRC, { title: "Hi" }, ["title"]).sourceHash).toBe(canonicalWorkflowHash(parsed(SRC)));
  });

  it("is stable across every edit the parser ignores", () => {
    const a = workflowIdentity(SRC, { title: "Hi" }, ["title"]);
    const rewrites: Record<string, string> = {
      "BOM, CRLF, trailing whitespace, trailing comment": `\u{FEFF}${SRC.replace(/\n/g, "\r\n")}   \r\n# tail\r\n\r\n`,
      "comments inside the front matter and between steps": ["---", "# fm comment", "site: blog", "inputs: [title]", "---", "# between", LINES[4], "   # indented", LINES[5]].join("\n"),
      "step indentation": [...LINES.slice(0, 4), ...LINES.slice(4).map((l) => `    ${l}`)].join("\n"),
      "interior blank lines": ["---", "site: blog", "", "inputs: [title]", "---", "", LINES[4], "", "", LINES[5]].join("\n"),
      "list markers": SRC.replace("1. action", "- action").replace("2. action", "action"),
      "list renumbering": SRC.replace("1. action", "7. action").replace("2. action", "3. action"),
      "unknown front-matter key": SRC.replace("inputs: [title]", "inputs: [title]\nowner: me"),
      "front-matter field order": SRC.replace("site: blog\ninputs: [title]", "inputs: [title]\nsite: blog"),
      "spacing around markers, colons and values": SRC.replace("site: blog", "site:    blog")
        .replace("1. action: type", "1.action :   type")
        .replace("2. action: click", "2.   action:click"),
    };
    for (const [label, text] of Object.entries(rewrites)) {
      const b = workflowIdentity(text, { title: "Hi" }, ["title"]);
      expect(b.sourceHash, label).toBe(a.sourceHash);
      expect(b.ledgerId, label).toBe(a.ledgerId);
    }
  });

  it("changes with a step (text, kind, order) and with the site", () => {
    const a = workflowIdentity(SRC, {}, []);
    expect(workflowIdentity(SRC.replace("Publish", "Save"), {}, []).sourceHash).not.toBe(a.sourceHash);
    expect(workflowIdentity(SRC.replace("2. action:", "2. goal:"), {}, []).sourceHash).not.toBe(a.sourceHash);
    expect(workflowIdentity([...LINES.slice(0, 4), LINES[5], LINES[4]].join("\n"), {}, []).sourceHash).not.toBe(a.sourceHash);
    expect(workflowIdentity(SRC.replace("site: blog", "site: shop"), {}, []).ledgerId).not.toBe(a.ledgerId);
  });

  it("REFUSES an unparseable source rather than inventing a key", () => {
    // The validator parses before it asks for an identity, so this is an invariant,
    // not a user path. A text-hash fallback would resurrect the class this module
    // removed: one workflow, two possible ledgers, depending on which path ran.
    expect(() => workflowIdentity("no front matter", {}, [])).toThrow(TypeError);
    expect(() => workflowIdentity("---\nsite: x\n---\n", {}, [])).toThrow(/no-steps/);
    expect(() => workflowIdentity(`${SRC}\nbogus line`, {}, [])).toThrow(/malformed-step/);
  });
});

describe("workflowIdentity — inputsHash", () => {
  it("same source + different inputs → same sourceHash, different ledgerId", () => {
    const a = workflowIdentity(SRC, { title: "Hi" }, ["title"]);
    const b = workflowIdentity(SRC, { title: "Bye" }, ["title"]);
    expect(b.sourceHash).toBe(a.sourceHash);
    expect(b.inputsHash).not.toBe(a.inputsHash);
    expect(b.ledgerId).not.toBe(a.ledgerId);
  });

  it("only the DECLARED inputs feed the hash, order-independently", () => {
    const a = workflowIdentity(SRC, { title: "Hi", extra: "1" }, ["title"]);
    const b = workflowIdentity(SRC, { title: "Hi" }, ["title"]);
    expect(a.inputsHash).toBe(b.inputsHash);
    const c = workflowIdentity(SRC, { b: "2", a: "1" }, ["a", "b"]);
    const d = workflowIdentity(SRC, { a: "1", b: "2" }, ["b", "a"]);
    expect(c.inputsHash).toBe(d.inputsHash);
  });

  it("distinguishes a value moved between two inputs", () => {
    const a = workflowIdentity(SRC, { a: "1", b: "2" }, ["a", "b"]);
    const b = workflowIdentity(SRC, { a: "2", b: "1" }, ["a", "b"]);
    expect(a.inputsHash).not.toBe(b.inputsHash);
  });

  it("ignores inherited object keys — a `constructor` input is read as an own property only", () => {
    const declared = ["constructor"];
    const own = workflowIdentity(SRC, { constructor: "x" }, declared);
    const absent = workflowIdentity(SRC, {}, declared);
    expect(own.inputsHash).not.toBe(absent.inputsHash);
  });
});

describe("hashText", () => {
  it("is deterministic and separates near-identical inputs", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("")).not.toBe(hashText(" "));
    // Two independent 32-bit mixes, so a collision needs both to agree.
    expect(hashText("abc")).toMatch(/^[0-9a-z]+:[0-9a-z]+$/);
  });
});
