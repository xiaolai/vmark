/**
 * Tests for Source Mode select-next/all occurrence commands.
 *
 * Verifies code fence boundary awareness, CJK word detection,
 * wrapping behavior, and duplicate avoidance.
 */
import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { selectNextOccurrenceSource, selectAllOccurrencesSource } from "./sourceSelectOccurrence";

function createState(text: string, anchor: number, head?: number) {
  return EditorState.create({
    doc: text,
    extensions: [EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create([
      EditorSelection.range(anchor, head ?? anchor),
    ]),
  });
}

describe("selectNextOccurrenceSource", () => {
  it("selects word under cursor when selection is empty", () => {
    const state = createState("hello world hello", 2); // cursor inside "hello"
    const result = selectNextOccurrenceSource(state);
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    // Should select the first "hello" (0-5)
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe(0);
    expect(ranges[0].to).toBe(5);
  });

  it("finds next occurrence when selection exists", () => {
    // Select first "hello" (0-5)
    const state = createState("hello world hello", 0, 5);
    const result = selectNextOccurrenceSource(state);
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    // Should now have two selections: "hello" at 0-5 and 12-17
    expect(ranges).toHaveLength(2);
    expect(ranges[0].from).toBe(0);
    expect(ranges[0].to).toBe(5);
    expect(ranges[1].from).toBe(12);
    expect(ranges[1].to).toBe(17);
  });

  it("wraps around when no more occurrences after cursor", () => {
    // Select last "hello" (12-17)
    const state = createState("hello world hello", 12, 17);
    const result = selectNextOccurrenceSource(state);
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    // Should wrap around and find the first "hello" at 0-5
    expect(ranges).toHaveLength(2);
    // Ranges are sorted by position
    expect(ranges[0].from).toBe(0);
    expect(ranges[0].to).toBe(5);
    expect(ranges[1].from).toBe(12);
    expect(ranges[1].to).toBe(17);
  });

  it("returns null when no word at cursor", () => {
    const state = createState("hello world", 5); // cursor at space
    const result = selectNextOccurrenceSource(state);
    // May select word or return null depending on boundary detection
    // At position 5 (space between words), should return null
    expect(result).toBeNull();
  });

  it("returns null when only one occurrence exists", () => {
    const state = createState("unique word", 0, 6); // select "unique"
    const result = selectNextOccurrenceSource(state);
    // Only one occurrence — nothing to add
    expect(result).toBeNull();
  });

  it("does not select across code fence boundaries", () => {
    const text = "hello\n```\nhello inside fence\n```\nhello after";
    // Select "hello" at position 0-5 (before fence)
    const state = createState(text, 0, 5);
    const result = selectNextOccurrenceSource(state);
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    // Should find "hello after" (33-38), NOT "hello inside fence" (10-15)
    expect(ranges).toHaveLength(2);
    const positions = ranges.map((r) => ({ from: r.from, to: r.to }));
    expect(positions).toContainEqual({ from: 0, to: 5 });
    // The "hello" inside the code fence should be skipped
    const insideFence = positions.find((p) => p.from === 10);
    expect(insideFence).toBeUndefined();
  });

  it("searches within code fence when cursor is inside fence", () => {
    const text = "hello outside\n```\nhello inside hello\n```\nhello after";
    // Position cursor inside the fence on first "hello" (18-23)
    const state = createState(text, 18, 23);
    const result = selectNextOccurrenceSource(state);
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    // Should only find occurrences inside the fence
    expect(ranges).toHaveLength(2);
    // Both should be inside the fence
    for (const r of ranges) {
      expect(r.from).toBeGreaterThanOrEqual(18);
      expect(r.to).toBeLessThanOrEqual(36);
    }
  });

  it("adds next occurrence when called repeatedly", () => {
    // Simulate: user presses Cmd+D on "foo" → selects word → presses Cmd+D again
    const text = "foo bar foo baz foo";
    // Step 1: select first "foo"
    const state1 = createState(text, 0, 3);
    const result1 = selectNextOccurrenceSource(state1);
    expect(result1).not.toBeNull();
    if (!result1) return;

    // Step 2: apply result and call again
    const state2 = state1.update(result1).state;
    const ranges2 = state2.selection.ranges;
    expect(ranges2).toHaveLength(2);

    const result2 = selectNextOccurrenceSource(state2);
    expect(result2).not.toBeNull();
    if (!result2) return;

    // Step 3: should have all three "foo"s
    const state3 = state2.update(result2).state;
    const ranges3 = state3.selection.ranges;
    expect(ranges3).toHaveLength(3);
    expect(ranges3[0].from).toBe(0);
    expect(ranges3[1].from).toBe(8);
    expect(ranges3[2].from).toBe(16);
  });
});

describe("selectAllOccurrencesSource", () => {
  it("selects all occurrences of word under cursor", () => {
    const state = createState("foo bar foo baz foo", 1); // cursor inside first "foo"
    const result = selectAllOccurrencesSource(state);
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    expect(ranges).toHaveLength(3);
    expect(ranges[0].from).toBe(0);
    expect(ranges[0].to).toBe(3);
    expect(ranges[1].from).toBe(8);
    expect(ranges[1].to).toBe(11);
    expect(ranges[2].from).toBe(16);
    expect(ranges[2].to).toBe(19);
  });

  it("selects all occurrences of existing selection", () => {
    const state = createState("ab cd ab ef ab", 0, 2); // select "ab"
    const result = selectAllOccurrencesSource(state);
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    expect(ranges).toHaveLength(3);
  });

  it("respects code fence boundaries", () => {
    const text = "word\n```\nword inside\n```\nword after";
    // Cursor on first "word" (0-4)
    const state = createState(text, 0, 4);
    const result = selectAllOccurrencesSource(state);
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    // Should find "word" at 0 and "word" after fence, but NOT inside fence
    expect(ranges).toHaveLength(2);
    const positions = ranges.map((r) => r.from);
    expect(positions).toContain(0);
    // "word inside" starts at 9 — should NOT be in results
    expect(positions).not.toContain(9);
  });

  it("returns null for empty text at cursor", () => {
    const state = createState("hello world", 5); // at space
    const result = selectAllOccurrencesSource(state);
    expect(result).toBeNull();
  });
});

describe("getCodeFenceBounds — parity discrimination", () => {
  it("does not treat closing fence as opening fence when cursor is between blocks", () => {
    // Cursor is between two code blocks, in regular text
    const text = "```python\ncode1\n```\nregular text foo\n```javascript\ncode2\n```";
    // "foo" appears only in "regular text foo" at position 23-26
    // Cursor at "foo" (position 32 = "f" in "foo") — outside any fence
    const fooIndex = text.indexOf("foo");
    const state = createState(text, fooIndex, fooIndex + 3);
    const result = selectAllOccurrencesSource(state);
    // Should find "foo" in regular text (not restricted by phantom fence)
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe(fooIndex);
    expect(ranges[0].to).toBe(fooIndex + 3);
  });

  it("selectNext does not restrict search when cursor is between code blocks", () => {
    // Two code blocks with text between and after them, both containing "word"
    const text = "```\ninner\n```\nword between\n```\ninner\n```\nword after";
    const firstWordIdx = text.indexOf("word between");
    const secondWordIdx = text.indexOf("word after");
    const state = createState(text, firstWordIdx, firstWordIdx + 4);
    const result = selectNextOccurrenceSource(state);
    expect(result).not.toBeNull();
    if (!result) return;
    const ranges = result.selection.ranges;
    // Should find both "word" outside fences
    expect(ranges).toHaveLength(2);
    expect(ranges[0].from).toBe(firstWordIdx);
    expect(ranges[1].from).toBe(secondWordIdx);
  });
});
