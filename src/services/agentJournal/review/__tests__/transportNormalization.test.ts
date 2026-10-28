// @vitest-environment node
// WI-AL2.5 — transport-only normalization (ADR-AL10): a whole-text write whose text differs from the buffer only by a leading BOM or by its line endings declares no change, so review shows no hunks; every other difference, whitespace included, is still declared and shown
import { describe, it, expect } from "vitest";
import { decodePayload } from "../../provenance/payload";
import { BudgetedDiff } from "../budgetedDiff";
import { declaredScriptCertificate } from "../declaredScript";
import { transportText } from "../transportNormalization";
import { fakeFactory } from "./fakeDiffWorker";

/** A budgeted diff whose fake workers come up ready and answer like the real one. */
function answeringDiff(): BudgetedDiff {
  const f = fakeFactory();
  f.onSpawn = (w) => {
    w.onPost = (req) => queueMicrotask(() => w.answer(req));
    queueMicrotask(() => w.ready());
  };
  return new BudgetedDiff({ factory: f.factory, warn: () => {} });
}

/** The changed runs the journal turns into hunks: deleted units and touched gaps of the declared map. */
async function hunkRuns(buffer: string, written: string) {
  const cert = await declaredScriptCertificate(buffer, written, { diff: answeringDiff() });
  if (!cert) throw new Error("no certificate");
  const p = decodePayload({ ...cert, document: "d", epoch: "0", basis: "b" });
  return [...p.deletedChars, ...p.touchedGaps];
}

const BUFFER = "# 标题\n\nline one\nline two\n";

describe("transportText", () => {
  it.each([
    ["CRLF line endings", "a\r\nb\r\n", "a\nb\n"],
    ["lone CR line endings", "a\rb\r", "a\nb\n"],
    ["a leading BOM", "\uFEFFa\nb\n", "a\nb\n"],
    ["a BOM and CRLF together", "\uFEFFa\r\nb", "a\nb"],
    ["empty text", "", ""],
    ["a lone BOM", "\uFEFF", ""],
  ])("drops %s", (_name, raw, editor) => {
    expect(transportText(raw)).toBe(editor);
  });

  it.each([
    ["a BOM inside the text (a zero-width no-break space)", "a\uFEFFb"],
    ["trailing spaces and tabs", "a  \n\tb\n"],
    ["a no-break space", "a\u00A0b"],
    ["a line separator", "a\u2028b"],
    ["CJK, emoji and RTL text", "甲😀שלום\n"],
  ])("keeps %s", (_name, text) => {
    expect(transportText(text)).toBe(text);
  });
});

describe("the declared script of a whole-text write", () => {
  it("CRLF-only and BOM-only saves show no hunks; a real whitespace edit shows one", async () => {
    const crlf = BUFFER.replace(/\n/g, "\r\n");
    expect(crlf).toContain("\r\n");
    expect(await hunkRuns(BUFFER, crlf)).toHaveLength(0);
    expect(await hunkRuns(BUFFER, `\uFEFF${BUFFER}`)).toHaveLength(0);
    expect(await hunkRuns(BUFFER, `\uFEFF${crlf}`)).toHaveLength(0);
    // Trailing whitespace is content: the edit is declared, under CRLF too.
    expect((await hunkRuns(BUFFER, BUFFER.replace("line one", "line one  "))).length).toBeGreaterThanOrEqual(1);
    expect((await hunkRuns(BUFFER, crlf.replace("line two", "line\ttwo"))).length).toBeGreaterThanOrEqual(1);
  });

  it("declares the editor-domain text, so the certificate's postimage is what the buffer will hold", async () => {
    const cert = await declaredScriptCertificate(BUFFER, `\uFEFF${BUFFER.replace(/\n/g, "\r\n")}`, { diff: answeringDiff() });
    const same = await declaredScriptCertificate(BUFFER, BUFFER, { diff: answeringDiff() });
    expect(cert).toEqual(same);
  });

  it("a BOM inside the text is a change, not transport", async () => {
    expect((await hunkRuns(BUFFER, BUFFER.replace("one", "o\uFEFFne"))).length).toBeGreaterThan(0);
  });
});
