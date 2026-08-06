import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import {
  NEW_TABLE,
  NEW_DETAILS_OPEN,
  newTableMarkdown,
  newDetailsSummary,
  newDetailsMarkdown,
} from "./blockTemplates";

describe("blockTemplates", () => {
  describe("newTableMarkdown", () => {
    it("renders exactly the shape NEW_TABLE declares", () => {
      const lines = newTableMarkdown().trimEnd().split("\n");
      // header + delimiter + body rows
      expect(lines).toHaveLength(NEW_TABLE.rows + 1);
      for (const line of lines) {
        // `| a | b |` splits to ["", " a ", " b ", ""]
        expect(line.split("|")).toHaveLength(NEW_TABLE.cols + 2);
      }
    });

    it("has a delimiter row directly under the header", () => {
      expect(newTableMarkdown().split("\n")[1]).toMatch(/^\|(\s*---\s*\|)+$/);
    });

    it("leaves every cell EMPTY rather than seeding placeholder text", () => {
      // Placeholder text is content the user did not ask for and must delete —
      // and if they don't notice, `Header 1` ships in a real document. The empty
      // table is the thing actually requested.
      const cells = newTableMarkdown()
        .split("\n")
        .filter((l, i) => i !== 1 && l.trim() !== "")
        .flatMap((l) => l.split("|").slice(1, -1));
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) expect(cell.trim()).toBe("");
    });

    it("ends with a newline so it forms whole lines", () => {
      expect(newTableMarkdown().endsWith("\n")).toBe(true);
    });
  });

  describe("newDetailsSummary", () => {
    it("is translated, not a hardcoded English literal", () => {
      // Source mode used to hardcode "Details" while WYSIWYG translated the same
      // string, so the summary text depended on which surface inserted it — and
      // in source it was English regardless of the user's locale.
      expect(newDetailsSummary()).toBe(i18n.t("editor:plugin.detailsDefaultSummary"));
    });
  });

  describe("newDetailsMarkdown", () => {
    it("starts OPEN, so the content area is visible on insert", () => {
      expect(NEW_DETAILS_OPEN).toBe(true);
      expect(newDetailsMarkdown("")).toContain("<details open>");
    });

    it("carries the translated summary", () => {
      expect(newDetailsMarkdown("")).toContain(`<summary>${newDetailsSummary()}</summary>`);
    });

    it("folds a selection into the body", () => {
      expect(newDetailsMarkdown("kept text")).toContain("kept text");
    });

    it("closes the tag", () => {
      expect(newDetailsMarkdown("x").trimEnd().endsWith("</details>")).toBe(true);
    });
  });
});
