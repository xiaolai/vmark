/**
 * Type-level tests for EditorViewLike.
 *
 * Verifies that state and dispatch use proper ProseMirror types
 * instead of `any`, catching type misuse at compile time.
 */

import { describe, it, expectTypeOf } from "vitest";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorViewLike } from "./types";

describe("EditorViewLike type safety", () => {
  it("state is not any", () => {
    expectTypeOf<EditorViewLike["state"]>().not.toBeAny();
  });

  it("dispatch parameter is not any", () => {
    type DispatchParam = Parameters<EditorViewLike["dispatch"]>[0];
    expectTypeOf<DispatchParam>().not.toBeAny();
  });

  it("state is assignable to EditorState", () => {
    expectTypeOf<EditorViewLike["state"]>().toMatchTypeOf<EditorState>();
  });

  it("dispatch accepts Transaction", () => {
    expectTypeOf<EditorViewLike["dispatch"]>().toMatchTypeOf<
      (tr: Transaction) => void
    >();
  });
});
