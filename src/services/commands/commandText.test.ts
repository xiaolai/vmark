// @vitest-environment node
/**
 * The two pure matching rules behind the command palette (audit #882).
 *
 * The canonical-equivalence case is the one that was live: a query and a title
 * that are the SAME TEXT in two Unicode spellings did not match, silently.
 */
import { describe, expect, it } from "vitest";

import { foldForSearch, scoreCommand } from "./commandText";

const COMPOSED = "Exporter"; // plain ASCII control
const NFC_ACCENT = "R\u00e9initialiser"; // e-acute as ONE code point
const NFD_ACCENT = "Re\u0301initialiser"; // e + COMBINING ACUTE

describe("foldForSearch", () => {
  it("folds case", () => {
    expect(foldForSearch(COMPOSED)).toBe("exporter");
  });

  it("makes the two canonical spellings of one string equal", () => {
    expect(NFC_ACCENT).not.toBe(NFD_ACCENT); // the premise: they differ as JS strings
    expect(foldForSearch(NFC_ACCENT)).toBe(foldForSearch(NFD_ACCENT));
  });

  it("is locale-INDEPENDENT: a dotted capital I still folds to ASCII i", () => {
    // toLocaleLowerCase under a Turkish locale would produce "ı" (U+0131) and
    // stop matching the ASCII command ids this registry is full of.
    expect(foldForSearch("Insert")).toBe("insert");
    expect(foldForSearch("Insert").charCodeAt(0)).toBe("i".charCodeAt(0));
  });

  it("leaves CJK alone", () => {
    expect(foldForSearch("导出文件")).toBe("导出文件");
  });

  it("handles the empty string", () => {
    expect(foldForSearch("")).toBe("");
  });
});

describe("scoreCommand", () => {
  const command = { title: "save file", id: "file.save", description: "write to disk" };

  it.each([
    ["save", 100],
    ["ave", 50],
    ["file.sa", 25],
    ["disk", 10],
    ["nothing here", 0],
  ])("query %j scores %i", (query, expected) => {
    expect(scoreCommand(query, command)).toBe(expected);
  });

  it("prefers a title prefix over an id substring", () => {
    expect(scoreCommand("save", command)).toBeGreaterThan(
      scoreCommand("file.sa", command),
    );
  });

  it("matches a decomposed query against a composed title once both are folded", () => {
    const folded = {
      title: foldForSearch(NFC_ACCENT),
      id: foldForSearch("edit.reset"),
      description: "",
    };
    expect(scoreCommand(foldForSearch(NFD_ACCENT), folded)).toBe(100);
  });
});
