import { describe, it, expect, beforeEach } from "vitest";
import { useSourceCursorContextStore } from "./sourceCursorContextStore";
import { createEmptyCursorContext } from "@/types/cursorContext";
import type { CursorContext } from "@/types/cursorContext";

describe("sourceCursorContextStore", () => {
  beforeEach(() => {
    useSourceCursorContextStore.setState({
      context: createEmptyCursorContext(),
      editorView: null,
    });
  });

  // ── Default state ──────────────────────────────────────────────────

  it("initializes with empty cursor context", () => {
    const state = useSourceCursorContextStore.getState();
    expect(state.context.inCodeBlock).toBeNull();
    expect(state.context.inBlockMath).toBeNull();
    expect(state.context.inTable).toBeNull();
    expect(state.context.inList).toBeNull();
    expect(state.context.inBlockquote).toBeNull();
    expect(state.context.inHeading).toBeNull();
    expect(state.context.inLink).toBeNull();
    expect(state.context.inImage).toBeNull();
    expect(state.context.inInlineMath).toBeNull();
    expect(state.context.inFootnote).toBeNull();
    expect(state.context.activeFormats).toEqual([]);
    expect(state.context.formatRanges).toEqual([]);
    expect(state.context.innermostFormat).toBeNull();
    expect(state.context.atLineStart).toBe(false);
    expect(state.context.atBlankLine).toBe(false);
    expect(state.context.inWord).toBeNull();
    expect(state.context.contextMode).toBe("inline-insert");
    expect(state.context.nearSpace).toBe(false);
    expect(state.context.nearPunctuation).toBe(false);
    expect(state.context.hasSelection).toBe(false);
    expect(state.context.selectionFrom).toBe(0);
    expect(state.context.selectionTo).toBe(0);
  });

  it("initializes with null editorView", () => {
    expect(useSourceCursorContextStore.getState().editorView).toBeNull();
  });

  // ── setContext ────────────────────────────────────────────────────

  describe("setContext", () => {
    it("sets context and editorView", () => {
      const mockView = { state: {} } as unknown as import("@codemirror/view").EditorView;
      const ctx: CursorContext = {
        ...createEmptyCursorContext(),
        inHeading: { level: 2, nodePos: 0 },
        atLineStart: true,
        contextMode: "format",
      };

      useSourceCursorContextStore.getState().setContext(ctx, mockView);

      const state = useSourceCursorContextStore.getState();
      expect(state.context.inHeading).toEqual({ level: 2, nodePos: 0 });
      expect(state.context.atLineStart).toBe(true);
      expect(state.context.contextMode).toBe("format");
      expect(state.editorView).toBe(mockView);
    });

    it("sets context with bold and italic active formats", () => {
      const mockView = { state: {} } as unknown as import("@codemirror/view").EditorView;
      const ctx: CursorContext = {
        ...createEmptyCursorContext(),
        activeFormats: ["bold", "italic"],
        hasSelection: true,
        selectionFrom: 5,
        selectionTo: 15,
      };

      useSourceCursorContextStore.getState().setContext(ctx, mockView);

      const state = useSourceCursorContextStore.getState();
      expect(state.context.activeFormats).toEqual(["bold", "italic"]);
      expect(state.context.hasSelection).toBe(true);
      expect(state.context.selectionFrom).toBe(5);
      expect(state.context.selectionTo).toBe(15);
    });

    it("sets context with code block context", () => {
      const mockView = { state: {} } as unknown as import("@codemirror/view").EditorView;
      const ctx: CursorContext = {
        ...createEmptyCursorContext(),
        inCodeBlock: { language: "typescript", nodePos: 10 },
      };

      useSourceCursorContextStore.getState().setContext(ctx, mockView);
      expect(useSourceCursorContextStore.getState().context.inCodeBlock).toEqual({
        language: "typescript",
        nodePos: 10,
      });
    });

    it("sets context with list context", () => {
      const mockView = { state: {} } as unknown as import("@codemirror/view").EditorView;
      const ctx: CursorContext = {
        ...createEmptyCursorContext(),
        inList: { type: "ordered", depth: 2, nodePos: 20 },
      };

      useSourceCursorContextStore.getState().setContext(ctx, mockView);
      expect(useSourceCursorContextStore.getState().context.inList).toEqual({
        type: "ordered",
        depth: 2,
        nodePos: 20,
      });
    });

    it("overwrites previous context", () => {
      const view1 = { state: { v: 1 } } as unknown as import("@codemirror/view").EditorView;
      const view2 = { state: { v: 2 } } as unknown as import("@codemirror/view").EditorView;

      const ctx1: CursorContext = {
        ...createEmptyCursorContext(),
        inHeading: { level: 1, nodePos: 0 },
      };
      const ctx2: CursorContext = {
        ...createEmptyCursorContext(),
        inBlockquote: { depth: 1, nodePos: 5 },
      };

      useSourceCursorContextStore.getState().setContext(ctx1, view1);
      useSourceCursorContextStore.getState().setContext(ctx2, view2);

      const state = useSourceCursorContextStore.getState();
      expect(state.context.inHeading).toBeNull();
      expect(state.context.inBlockquote).toEqual({ depth: 1, nodePos: 5 });
      expect(state.editorView).toBe(view2);
    });
  });

  // ── setContext deduplication ──────────────────────────────────────

  describe("setContext deduplication", () => {
    it("keeps the existing context reference when an equal context is set with the same view", () => {
      const view = { state: {} } as unknown as import("@codemirror/view").EditorView;
      const first = createEmptyCursorContext();
      useSourceCursorContextStore.getState().setContext(first, view);
      useSourceCursorContextStore.getState().setContext(createEmptyCursorContext(), view);
      expect(useSourceCursorContextStore.getState().context).toBe(first);
    });

    it("publishes the new context when content changes", () => {
      const view = { state: {} } as unknown as import("@codemirror/view").EditorView;
      useSourceCursorContextStore.getState().setContext(createEmptyCursorContext(), view);
      const changed: CursorContext = { ...createEmptyCursorContext(), hasSelection: true };
      useSourceCursorContextStore.getState().setContext(changed, view);
      expect(useSourceCursorContextStore.getState().context).toBe(changed);
    });

    it("publishes the new context when the editor view changes", () => {
      const view1 = { state: { v: 1 } } as unknown as import("@codemirror/view").EditorView;
      const view2 = { state: { v: 2 } } as unknown as import("@codemirror/view").EditorView;
      useSourceCursorContextStore.getState().setContext(createEmptyCursorContext(), view1);
      const same = createEmptyCursorContext();
      useSourceCursorContextStore.getState().setContext(same, view2);
      expect(useSourceCursorContextStore.getState().context).toBe(same);
      expect(useSourceCursorContextStore.getState().editorView).toBe(view2);
    });
  });

  // ── clearContext ──────────────────────────────────────────────────

  describe("clearContext", () => {
    it("resets context to empty and clears editorView", () => {
      const mockView = { state: {} } as unknown as import("@codemirror/view").EditorView;
      useSourceCursorContextStore.getState().setContext(
        { ...createEmptyCursorContext(), inHeading: { level: 3, nodePos: 0 } },
        mockView
      );

      useSourceCursorContextStore.getState().clearContext();

      const state = useSourceCursorContextStore.getState();
      expect(state.context.inHeading).toBeNull();
      expect(state.editorView).toBeNull();
      expect(state.context.contextMode).toBe("inline-insert");
    });

    it("is idempotent when already cleared", () => {
      useSourceCursorContextStore.getState().clearContext();
      const state = useSourceCursorContextStore.getState();
      expect(state.editorView).toBeNull();
      expect(state.context.activeFormats).toEqual([]);
    });
  });
});
