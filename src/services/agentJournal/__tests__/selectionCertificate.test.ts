// WI-AL2.1c — a Source selection.set's certificate: the exact change {from, to, insert} as a provenance payload without document, epoch and basis (the writer binds those to the parent it mints), whose map takes the preimage to the postimage; deletions, insertions at either end, CJK, emoji and RTL; an out-of-range change and a lone surrogate are refused
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { selectionCertificate } from "../selectionCertificate";
import { textHash, verifyPayloadTexts } from "../provenance/payload";

const bound = (c: object) => ({ ...c, document: "doc", epoch: "0", basis: "rev" });

describe("selectionCertificate", () => {
  it.each([
    ["a replacement", "Hello world", { from: 6, to: 11, insert: "code" }, "Hello code"],
    ["a deletion", "Hello world", { from: 5, to: 11, insert: "" }, "Hello"],
    ["an insertion at the start", "abc", { from: 0, to: 0, insert: "--" }, "--abc"],
    ["an insertion at the end", "abc", { from: 3, to: 3, insert: "!" }, "abc!"],
    ["CJK", "甲乙丙丁", { from: 1, to: 3, insert: "戊" }, "甲戊丁"],
    ["an emoji pair replaced whole", "a😀b", { from: 1, to: 3, insert: "😁😁" }, "a😁😁b"],
    ["RTL", "שלום עולם", { from: 5, to: 9, insert: "world" }, "שלום world"],
    ["an empty document", "", { from: 0, to: 0, insert: "x" }, "x"],
  ])("maps the preimage to the postimage for %s", async (_label, pre, change, post) => {
    const cert = await selectionCertificate(pre, change);
    expect(cert).not.toHaveProperty("document");
    expect(cert).not.toHaveProperty("epoch");
    expect(cert).not.toHaveProperty("basis");
    expect(cert.preHash).toBe(await textHash(pre));
    expect(cert.postHash).toBe(await textHash(post));
    // The writer binds the three ids; the map then reproduces the postimage exactly.
    await expect(verifyPayloadTexts(bound(cert), pre, post)).resolves.toBeDefined();
  });

  it("names exactly the touched range, so an unaffected older hunk can map through it", async () => {
    const cert = await selectionCertificate("--abXc", { from: 6, to: 6, insert: "Z" });
    const map = await verifyPayloadTexts(bound(cert), "--abXc", "--abXcZ");
    expect(map.L(3)).toBe(3);
    expect(map.R(3)).toBe(3);
    expect(cert.body.breaks.whole).toBeNull();
  });

  it.each([
    ["past the end", { from: 2, to: 9, insert: "x" }],
    ["reversed", { from: 3, to: 1, insert: "x" }],
    ["negative", { from: -1, to: 1, insert: "x" }],
    ["fractional", { from: 0.5, to: 1, insert: "x" }],
  ])("refuses a change %s", async (_label, change) => {
    await expect(selectionCertificate("abc", change)).rejects.toThrow();
  });

  it("refuses a lone surrogate in the inserted text", async () => {
    await expect(selectionCertificate("abc", { from: 1, to: 1, insert: "\uD800" })).rejects.toThrow();
  });
});
