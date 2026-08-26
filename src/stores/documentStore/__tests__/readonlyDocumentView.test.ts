// @vitest-environment node
/**
 * A document read out of the store cannot be written back into it.
 *
 * `documents` and `getDocument` used to hand out a mutable `DocumentState`, so
 * `doc.content = "…"` was a legal way to change a document — and it bypassed
 * `bumpRevisionIfContentChanged`. The consequence is not a lint nicety: an MCP
 * client holding `expected_revision: N` would still see N as current, so its
 * next write would overwrite content it never read and had no way to know it
 * had missed.
 *
 * `Readonly<DocumentState>` closed it at the type level with zero call-site
 * changes, because every reducer in the store already built new objects — the
 * mutable type was permission nobody was using.
 *
 * A type-level guard is invisible at runtime, which is the reason for this
 * file: the compile error is asserted by compiling, so deleting the `Readonly`
 * fails here rather than silently reopening the hole.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const CONTRACT = readFileSync("src/stores/documentStore/storeContract.ts", "utf8");

describe("document views are readonly", () => {
  it("declares the documents map readonly", () => {
    expect(CONTRACT).toMatch(/documents: Record<string, Readonly<DocumentState>>;/);
  });

  it("declares getDocument's result readonly", () => {
    expect(CONTRACT).toMatch(/getDocument: \(tabId: string\) => Readonly<DocumentState> \| undefined;/);
  });

  it("states why, so the next reader does not widen it back for convenience", () => {
    // The `Readonly` is one word and its justification is not local to it. A
    // reader hitting a type error has to be able to find out why before
    // deciding the fastest way past it.
    const rationale = CONTRACT.slice(0, CONTRACT.indexOf("documents: Record"));
    expect(rationale).toContain("revision");
  });
});
