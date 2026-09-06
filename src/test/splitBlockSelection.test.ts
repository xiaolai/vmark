/**
 * Audit 20260906 F5 — Enter threw when the selection spanned two empty
 * paragraphs.
 *
 * `TransformError: Inserted content deeper than insertion position`. Tiptap's
 * `splitBlock` computes `canSplit` against the PRE-deletion document, then
 * calls `tr.deleteSelection()`, then splits at the mapped position without
 * recomputing eligibility. Deleting a selection that spans two empty
 * paragraphs changes the insertion depth, so the earlier check no longer
 * describes the document being split.
 *
 * Selecting backward or forward across two empty paragraphs and pressing
 * Enter is ordinary keyboard editing, and the exception aborts that edit.
 *
 * Reproduced by the audit on the full VMark stack AND on vanilla StarterKit,
 * so it is an upstream defect this suite pins rather than a VMark plugin bug.
 * These tests are the ratchet on it: if a dependency bump regresses it, they
 * fail here rather than in a user's document.
 */
import { describe, expect, it } from "vitest";
import { captureDispatchError, withTypingSession } from "./typingHarness";

describe("Enter across a selection spanning two empty paragraphs (F5)", () => {
  it("does not throw when the selection is made forward", () => {
    withTypingSession({}, (session) => {
      // Two empty paragraphs: positions 1 and 3 are their content positions.
      session.press("Enter");
      session.select(1, 3);

      expect(captureDispatchError(() => session.press("Enter"))).toBeNull();
    });
  });

  it("does not throw when the selection is made backward", () => {
    withTypingSession({}, (session) => {
      session.press("Enter");
      // A backward selection is what dragging or Shift+ArrowUp produces.
      session.select(3, 1);

      expect(captureDispatchError(() => session.press("Enter"))).toBeNull();
    });
  });

  it("leaves the document structurally valid afterwards", () => {
    withTypingSession({}, (session) => {
      session.press("Enter");
      session.select(1, 3);
      session.press("Enter");

      expect(() => session.editor.state.doc.check()).not.toThrow();
    });
  });

  it("keeps the selection inside the document afterwards", () => {
    withTypingSession({}, (session) => {
      session.press("Enter");
      session.select(1, 3);
      session.press("Enter");

      const { doc, selection } = session.editor.state;
      expect(selection.from).toBeGreaterThanOrEqual(0);
      expect(selection.to).toBeLessThanOrEqual(doc.content.size);
    });
  });

  it("does not throw across three empty paragraphs", () => {
    withTypingSession({}, (session) => {
      session.press("Enter");
      session.press("Enter");
      session.select(1, 5);

      expect(captureDispatchError(() => session.press("Enter"))).toBeNull();
    });
  });

  // The adjacent shapes, so a fix cannot pass by special-casing one case.
  it("does not throw when one side of the selection has text", () => {
    withTypingSession({ markdown: "a\n\n\n" }, (session) => {
      const size = session.editor.state.doc.content.size;
      session.select(1, Math.min(4, size));

      expect(captureDispatchError(() => session.press("Enter"))).toBeNull();
    });
  });

  it("still splits an ordinary paragraph on Enter", () => {
    withTypingSession({ markdown: "hello world" }, (session) => {
      session.setCursor(6);
      session.press("Enter");

      expect(session.editor.state.doc.childCount).toBe(2);
    });
  });

  it("still replaces a selection inside one paragraph on Enter", () => {
    withTypingSession({ markdown: "abcdef" }, (session) => {
      session.select(2, 5);
      session.press("Enter");

      expect(() => session.editor.state.doc.check()).not.toThrow();
      expect(session.editor.state.doc.textContent).toBe("aef");
    });
  });
});
