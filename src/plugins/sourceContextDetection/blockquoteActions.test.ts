// @vitest-environment node
/**
 * Tests for blockquoteActions — toggleBlockquote and hasBlockquote.
 */

import { describe, it, expect, vi } from "vitest";
import { Text, EditorState, EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { toggleBlockquote, hasBlockquote } from "./blockquoteActions";

function createMockView(content: string, from: number, to?: number): EditorView {
  const doc = Text.of(content.split("\n"));
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to ?? from),
  });
  return {
    state,
    dispatch: vi.fn((_spec: unknown) => {}),
    focus: vi.fn(),
  } as unknown as EditorView;
}

describe("hasBlockquote", () => {
  it("returns true when line starts with >", () => {
    const view = createMockView("> quoted line", 3);
    expect(hasBlockquote(view)).toBe(true);
  });

  it("returns false when line is not quoted", () => {
    const view = createMockView("plain line", 3);
    expect(hasBlockquote(view)).toBe(false);
  });

  it("returns true when all selected lines are quoted", () => {
    const content = "> line one\n> line two\n> line three";
    const view = createMockView(content, 0, content.length);
    expect(hasBlockquote(view)).toBe(true);
  });

  it("returns false when any selected line is not quoted", () => {
    const content = "> line one\nplain line\n> line three";
    const view = createMockView(content, 0, content.length);
    expect(hasBlockquote(view)).toBe(false);
  });

  it("returns true for single cursor on quoted line", () => {
    const view = createMockView("> hello", 0);
    expect(hasBlockquote(view)).toBe(true);
  });
});

describe("toggleBlockquote", () => {
  it("adds > prefix to unquoted line", () => {
    const view = createMockView("hello world", 3);
    toggleBlockquote(view);

    expect(view.dispatch).toHaveBeenCalled();
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.changes).toBeDefined();

    // Verify the change inserts "> " prefix
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    const change = changes[0];
    expect(change.insert).toContain("> ");
  });

  it("removes > prefix from quoted line", () => {
    const view = createMockView("> hello world", 3);
    toggleBlockquote(view);

    expect(view.dispatch).toHaveBeenCalled();
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    const change = changes[0];
    expect(change.insert).toBe("hello world");
  });

  it("adds > to multiple unquoted lines", () => {
    const content = "line one\nline two\nline three";
    const view = createMockView(content, 0, content.length);
    toggleBlockquote(view);

    expect(view.dispatch).toHaveBeenCalled();
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    expect(changes[0].insert).toContain("> line one");
    expect(changes[0].insert).toContain("> line two");
    expect(changes[0].insert).toContain("> line three");
  });

  it("removes > from all quoted lines", () => {
    const content = "> line one\n> line two";
    const view = createMockView(content, 0, content.length);
    toggleBlockquote(view);

    expect(view.dispatch).toHaveBeenCalled();
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    // Each line should have its > removed
    expect(changes.length).toBe(2);
    expect(changes[0].insert).toBe("line one");
    expect(changes[1].insert).toBe("line two");
  });

  it("keeps indentation inside the quote, with the marker leading", () => {
    const view = createMockView("  indented text", 3);
    toggleBlockquote(view);

    expect(view.dispatch).toHaveBeenCalled();
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    // The `>` leads, and the indentation is preserved INSIDE the quote. Putting
    // the marker after the indent reads as a quote nested in a list item, which
    // is the opposite structure — `  > - inner` instead of `>   - inner`.
    expect(changes[0].insert).toBe(">   indented text");
  });

  it("preserves indentation when removing blockquote", () => {
    const view = createMockView("  > indented quoted", 3);
    toggleBlockquote(view);

    expect(view.dispatch).toHaveBeenCalled();
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    expect(changes[0].insert).toBe("  indented quoted");
  });

  it("skips empty lines when adding blockquote", () => {
    const content = "line one\n\nline three";
    const view = createMockView(content, 0, content.length);
    toggleBlockquote(view);

    expect(view.dispatch).toHaveBeenCalled();
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    // Empty lines should be filtered out and only non-empty lines quoted
    expect(changes[0].insert).toContain("> line one");
    expect(changes[0].insert).toContain("> line three");
  });

  // These two used to assert that the button did NOTHING on a blank line, which
  // made it silently dead exactly where starting a quote is most natural — and
  // diverged from WYSIWYG, whose toggle wraps an empty paragraph in a
  // blockquote. No parity fixture had a blank line, so nothing caught it.
  it("opens an empty quote when the selection is all empty lines", () => {
    const view = createMockView("\n\n", 0, 2);
    toggleBlockquote(view);

    expect(view.focus).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("opens an empty quote on a single empty line", () => {
    const view = createMockView("", 0);
    toggleBlockquote(view);

    expect(view.focus).toHaveBeenCalled();
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    expect(changes[0].insert).toBe("> ");
  });

  it("does not add > to already-quoted lines in mixed selection", () => {
    const content = "> already quoted\nnot quoted";
    const view = createMockView(content, 0, content.length);
    toggleBlockquote(view);

    expect(view.dispatch).toHaveBeenCalled();
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    // The already-quoted line should be preserved as-is
    expect(changes[0].insert).toContain("> already quoted");
    expect(changes[0].insert).toContain("> not quoted");
  });

  it("always calls focus", () => {
    const view = createMockView("hello", 0);
    toggleBlockquote(view);
    expect(view.focus).toHaveBeenCalled();
  });
});

describe("toggleBlockquote on a blank line", () => {
  it("opens an empty quote instead of doing nothing", () => {
    const view = createMockView("first\n\nsecond", 6);
    toggleBlockquote(view);
    const call = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    const changes = Array.isArray(call.changes) ? call.changes : [call.changes];
    expect(changes[0].insert).toBe("> ");
  });
});
