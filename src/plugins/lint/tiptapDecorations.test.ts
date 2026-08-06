/**
 * Decoration-building tests for the lint extension.
 *
 * Split out of `tiptap.test.ts`, which had grown past 1000 lines. These two
 * suites exercise one thing — turning diagnostics into decorations, including
 * the line-to-block mapping — while the parent file covers the plugin's
 * lifecycle, subscriptions and guards.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./lint.css", () => ({}));

const mockRunOrQueue = vi.fn((_: unknown, action: () => void) => action());
vi.mock("@/utils/imeGuard", () => ({
  runOrQueueProseMirrorAction: (...args: unknown[]) =>
    (mockRunOrQueue as unknown as (...a: unknown[]) => void)(...args),
}));

import type { Node as PMNode } from "@tiptap/pm/model";
import { DecorationSet } from "@tiptap/pm/view";
import { useLintStore } from "@/stores/documentStore";
import type { LintDiagnostic } from "@/lib/lintEngine/types";
import { bindPluginHostSettings } from "@/services/assembly/bindHostSettings";
import {
  makePara,
  makeHeading,
  makeCode,
  makeDoc,
  makeDiagnostic,
  getPlugins,
  setLintEnabled,
} from "./__tests__/testHarness";

describe("LintExtension decorations", () => {
  beforeEach(() => {
    bindPluginHostSettings();
    useLintStore.setState({ diagnosticsByTab: {}, selectedIndexByTab: {} });
    setLintEnabled(true);
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // buildDecorations — via plugin state.init (tests the private function)
  // -----------------------------------------------------------------------
  describe("buildDecorations (via state.init)", () => {
    function getDecorations(doc: PMNode, diagnostics: LintDiagnostic[]) {
      useLintStore.setState({
        diagnosticsByTab: { "tab-1": diagnostics },
      });
      const plugins = getPlugins("tab-1");
      return plugins[0].spec.state!.init!({} as never, { doc } as never);
    }

    it("returns empty for null/undefined diagnostics", () => {
      useLintStore.setState({ diagnosticsByTab: {} });
      const doc = makeDoc(makePara("hello"));
      const plugins = getPlugins("tab-1");
      const result = plugins[0].spec.state!.init!({} as never, { doc } as never);
      expect(result).toBe(DecorationSet.empty);
    });

    it("returns empty for empty diagnostics array", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, []);
      expect(result).toBe(DecorationSet.empty);
    });

    it("skips sourceOnly diagnostics", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ uiHint: "sourceOnly", line: 1 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });

    it("creates lint-block-error class for error severity", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ severity: "error", line: 1 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      // Decoration.node stores spec in the decoration
      expect((decos[0] as unknown as { type: { attrs: { class: string } } }).type.attrs.class).toBe(
        "lint-block-error"
      );
    });

    it("creates lint-block-warning class for warning severity", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ severity: "warning", line: 1 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      expect((decos[0] as unknown as { type: { attrs: { class: string } } }).type.attrs.class).toBe(
        "lint-block-warning"
      );
    });

    it("skips diagnostics with line beyond document range", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 99 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });

    it("maps diagnostics to correct blocks in multi-block doc", () => {
      const doc = makeDoc(
        makeHeading("Title"),
        makePara("paragraph one"),
        makePara("paragraph two")
      );
      // Serialized source: "# Title\n\nparagraph one\n\nparagraph two\n"
      // → true source lines are 1, 3, and 5 (2 and 4 are blank separators).
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 3, severity: "warning" }),
        makeDiagnostic({ line: 5, severity: "error", id: "E02-5-1" }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(2);
      expect(decos[0].from).toBe(doc.child(0).nodeSize);
      expect(decos[1].from).toBe(doc.child(0).nodeSize + doc.child(1).nodeSize);
    });

    it("handles mixed diagnostics (valid, sourceOnly, out-of-range)", () => {
      const doc = makeDoc(makePara("hello"), makePara("world"));
      // Serialized source: "hello\n\nworld\n" → blocks on lines 1 and 3.
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 1, severity: "warning" }),
        makeDiagnostic({ line: 1, uiHint: "sourceOnly", id: "E08-1-1" }),
        makeDiagnostic({ line: 99, id: "W01-99-1" }),
        makeDiagnostic({ line: 3, severity: "error", id: "E02-3-1" }),
      ]);
      const decos = result.find();
      // Only line 1 warning and line 3 error should produce decorations
      expect(decos).toHaveLength(2);
    });

    it("handles exact and block uiHints the same way", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 1, uiHint: "exact" }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Line-to-block mapping — via buildDecorations (tested indirectly)
  // -----------------------------------------------------------------------
  describe("line-to-block mapping (indirect via buildDecorations)", () => {
    function getDecorations(doc: PMNode, diagnostics: LintDiagnostic[]) {
      useLintStore.setState({
        diagnosticsByTab: { "tab-1": diagnostics },
      });
      const plugins = getPlugins("tab-1");
      return plugins[0].spec.state!.init!({} as never, { doc } as never);
    }

    it("maps line 1 to first block", () => {
      const doc = makeDoc(makePara("first"), makePara("second"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 1 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      // First paragraph starts at pos 0 (doc offset)
      expect(decos[0].from).toBe(0);
    });

    it("maps the second block via its true source line (after the blank separator)", () => {
      const doc = makeDoc(makePara("first"), makePara("second"));
      // Serialized source: "first\n\nsecond\n" → second paragraph is line 3.
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 3 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      // Second paragraph starts after first paragraph's nodeSize
      const firstBlockSize = doc.child(0).nodeSize;
      expect(decos[0].from).toBe(firstBlockSize);
    });

    it("does not decorate a blank separator line", () => {
      const doc = makeDoc(makePara("first"), makePara("second"));
      // Line 2 is the blank line between the paragraphs — no block owns it.
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 2 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });

    it("handles code block with multi-line content (fence lines included)", () => {
      // Serialized source:
      //   1: intro
      //   2: (blank)
      //   3: ```
      //   4: line1
      //   5: line2
      //   6: line3
      //   7: ```
      const doc = makeDoc(
        makePara("intro"),
        makeCode("line1\nline2\nline3")
      );
      const firstBlockSize = doc.child(0).nodeSize;
      for (const line of [3, 4, 5, 6, 7]) {
        const result = getDecorations(doc, [
          makeDiagnostic({ line }),
        ]);
        const decos = result.find();
        expect(decos).toHaveLength(1);
        expect(decos[0].from).toBe(firstBlockSize);
      }
    });

    it("offsets blocks after a code fence by the fence's real line count", () => {
      // Serialized source: intro(1), blank(2), ```(3), a(4), b(5), ```(6),
      // blank(7), after(8).
      const doc = makeDoc(
        makePara("intro"),
        makeCode("a\nb"),
        makePara("after")
      );
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 8 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
      expect(decos[0].from).toBe(doc.child(0).nodeSize + doc.child(1).nodeSize);
    });

    it("returns no decoration for line 0 (invalid)", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 0 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });

    it("returns no decoration for negative line number", () => {
      const doc = makeDoc(makePara("hello"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: -1 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });

    it("handles single-block document correctly", () => {
      const doc = makeDoc(makePara("only block"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 1 }),
      ]);
      const decos = result.find();
      expect(decos).toHaveLength(1);
    });

    it("returns no decoration when target line exceeds block count (no newlines)", () => {
      const doc = makeDoc(makePara("a"), makePara("b"));
      const result = getDecorations(doc, [
        makeDiagnostic({ line: 5 }),
      ]);
      expect(result).toBe(DecorationSet.empty);
    });
  });
});
