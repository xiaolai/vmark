/**
 * Type-safety tests for EditorViewLike.
 *
 * Verifies that EditorViewLike uses proper ProseMirror types
 * instead of `any` for state and dispatch.
 */

import { describe, it, expect } from "vitest";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorViewLike } from "../types";

describe("EditorViewLike type safety", () => {
  // Compile-time assertion: if state is `any`, assigning to number would
  // silently succeed — and `@ts-expect-error` would be flagged as unused.
  // With `EditorState`, the assignment errors as expected.
  // @ts-expect-error state is EditorState, not assignable to number
  const _stateNotAny: number = {} as EditorViewLike["state"];
  void _stateNotAny;

  // Same for dispatch parameter
  // @ts-expect-error Transaction is not assignable to number
  const _dispatchParamNotAny: number = {} as Parameters<
    EditorViewLike["dispatch"]
  >[0];
  void _dispatchParamNotAny;

  it("EditorViewLike is structurally compatible with EditorView", () => {
    // Runtime check: a properly-shaped object can satisfy EditorViewLike
    const mockView: EditorViewLike = {
      dom: document.createElement("div"),
      state: {} as EditorState,
      dispatch: (_tr: Transaction) => {},
      focus: () => {},
    };

    expect(mockView.dom).toBeInstanceOf(HTMLElement);
    expect(typeof mockView.dispatch).toBe("function");
    expect(typeof mockView.focus).toBe("function");
  });
});
