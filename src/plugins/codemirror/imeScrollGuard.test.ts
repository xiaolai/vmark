/**
 * Tests for IME Scroll Guard (CodeMirror)
 *
 * Verifies that the transactionFilter strips `scrollIntoView` from
 * `input.type.compose*` transactions and leaves everything else alone.
 * This is the root-cause fix for issue #814 (viewport jitter during
 * pinyin / CJK IME composition in the source editor).
 */

import { describe, it, expect } from "vitest";
import {
  Annotation,
  EditorState,
  StateEffect,
  Transaction,
} from "@codemirror/state";

import { imeScrollGuard } from "./imeScrollGuard";

function createState() {
  return EditorState.create({
    doc: "hello world",
    extensions: [imeScrollGuard],
  });
}

describe("imeScrollGuard", () => {
  it("strips scrollIntoView from input.type.compose transactions", () => {
    const state = createState();
    const tr = state.update({
      changes: { from: 5, to: 5, insert: "x" },
      scrollIntoView: true,
      userEvent: "input.type.compose",
    });

    expect(tr.isUserEvent("input.type.compose")).toBe(true);
    expect(tr.scrollIntoView).toBe(false);
  });

  it("strips scrollIntoView from input.type.compose.start transactions", () => {
    const state = createState();
    const tr = state.update({
      changes: { from: 5, to: 5, insert: "n" },
      scrollIntoView: true,
      userEvent: "input.type.compose.start",
    });

    expect(tr.isUserEvent("input.type.compose.start")).toBe(true);
    expect(tr.scrollIntoView).toBe(false);
  });

  it("preserves scrollIntoView for non-compose input transactions", () => {
    const state = createState();
    const tr = state.update({
      changes: { from: 5, to: 5, insert: "y" },
      scrollIntoView: true,
      userEvent: "input.type",
    });

    expect(tr.scrollIntoView).toBe(true);
  });

  it("preserves scrollIntoView for select transactions", () => {
    const state = createState();
    const tr = state.update({
      selection: { anchor: 3 },
      scrollIntoView: true,
      userEvent: "select.pointer",
    });

    expect(tr.scrollIntoView).toBe(true);
  });

  it("leaves compose transactions without scrollIntoView untouched", () => {
    const state = createState();
    const tr = state.update({
      changes: { from: 5, to: 5, insert: "z" },
      userEvent: "input.type.compose",
    });

    expect(tr.scrollIntoView).toBe(false);
    expect(tr.changes.empty).toBe(false);
  });

  it("preserves document changes while stripping scrollIntoView", () => {
    const state = createState();
    const tr = state.update({
      changes: { from: 5, to: 5, insert: "好" },
      scrollIntoView: true,
      userEvent: "input.type.compose",
    });

    expect(tr.newDoc.toString()).toBe("hello好 world");
    expect(tr.scrollIntoView).toBe(false);
  });

  it("preserves user-defined annotations on compose transactions", () => {
    const testAnno = Annotation.define<string>();
    const state = createState();
    const tr = state.update({
      changes: { from: 5, to: 5, insert: "a" },
      scrollIntoView: true,
      userEvent: "input.type.compose",
      annotations: testAnno.of("marker"),
    });

    expect(tr.annotation(testAnno)).toBe("marker");
    expect(tr.annotation(Transaction.userEvent)).toBe("input.type.compose");
    expect(tr.scrollIntoView).toBe(false);
  });

  it("preserves state effects on compose transactions", () => {
    const testEffect = StateEffect.define<string>();
    const state = createState();
    const tr = state.update({
      changes: { from: 5, to: 5, insert: "b" },
      scrollIntoView: true,
      userEvent: "input.type.compose",
      effects: testEffect.of("payload"),
    });

    const matching = tr.effects.filter((e) => e.is(testEffect));
    expect(matching).toHaveLength(1);
    expect(matching[0].value).toBe("payload");
    expect(tr.scrollIntoView).toBe(false);
  });

  it("preserves selection on compose transactions", () => {
    const state = createState();
    const tr = state.update({
      selection: { anchor: 2, head: 4 },
      scrollIntoView: true,
      userEvent: "input.type.compose",
    });

    expect(tr.newSelection.main.anchor).toBe(2);
    expect(tr.newSelection.main.head).toBe(4);
    expect(tr.scrollIntoView).toBe(false);
  });
});
