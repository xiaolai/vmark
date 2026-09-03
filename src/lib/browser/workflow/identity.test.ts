// @vitest-environment node
// Audit 2026-09-03 W-07 — the completed-write ledger is keyed on the NORMALISED
// source plus the declared inputs' values, so a whitespace/comment edit keeps the
// ledger while a re-run with different inputs runs every write again.
import { describe, expect, it } from "vitest";
import { hashText, normalizeWorkflowSource, workflowIdentity } from "./identity";

const SRC = ["---", "site: blog", "inputs: [title]", "---", '1. action: type {title} into "Title"', '2. action: click "Publish" (button)'].join("\n");

describe("normalizeWorkflowSource", () => {
  it("strips a leading BOM", () => {
    expect(normalizeWorkflowSource(`\uFEFF${SRC}`)).toBe(normalizeWorkflowSource(SRC));
  });

  it("converts CRLF and bare CR line endings to LF", () => {
    expect(normalizeWorkflowSource(SRC.replace(/\n/g, "\r\n"))).toBe(normalizeWorkflowSource(SRC));
    expect(normalizeWorkflowSource(SRC.replace(/\n/g, "\r"))).toBe(normalizeWorkflowSource(SRC));
  });

  it("trims trailing whitespace on every line and trailing blank lines", () => {
    const padded = SRC.split("\n").map((l) => `${l}   \t`).join("\n") + "\n\n\n";
    expect(normalizeWorkflowSource(padded)).toBe(normalizeWorkflowSource(SRC));
  });

  it("removes comment lines but keeps a `#` inside a step's text", () => {
    const withComments = ["# top comment", ...SRC.split("\n"), "   # indented comment"].join("\n");
    expect(normalizeWorkflowSource(withComments)).toBe(normalizeWorkflowSource(SRC));
    const hashInText = ["---", "site: x", "---", 'action: click "#1 fan" (button)'].join("\n");
    expect(normalizeWorkflowSource(hashInText)).toContain('click "#1 fan"');
  });

  it("keeps interior blank lines and leading indentation (they are not trailing whitespace)", () => {
    const src = ["---", "site: x", "---", "", "  goal: a", "", "goal: b"].join("\n");
    expect(normalizeWorkflowSource(src)).toBe(["---", "site: x", "---", "", "  goal: a", "", "goal: b"].join("\n"));
  });
});

describe("workflowIdentity", () => {
  it("is stable across whitespace, EOL, BOM and comment edits", () => {
    const a = workflowIdentity(SRC, { title: "Hi" }, ["title"]);
    const b = workflowIdentity(`\uFEFF# c\r\n${SRC.replace(/\n/g, "\r\n")}   \r\n`, { title: "Hi" }, ["title"]);
    expect(b.sourceHash).toBe(a.sourceHash);
    expect(b.ledgerId).toBe(a.ledgerId);
  });

  it("changes with the source text", () => {
    const a = workflowIdentity(SRC, {}, []);
    const b = workflowIdentity(SRC.replace("Publish", "Save"), {}, []);
    expect(b.sourceHash).not.toBe(a.sourceHash);
    expect(b.ledgerId).not.toBe(a.ledgerId);
  });

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
