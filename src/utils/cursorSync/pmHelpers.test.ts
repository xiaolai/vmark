// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import {
  END_OF_LINE_THRESHOLD,
  MIN_CONTEXT_PATTERN_LENGTH,
  getSourceLineFromPos,
  estimateSourceLine,
  findClosestSourceLine,
  findColumnInLine,
} from "./pmHelpers";
import type { CursorInfo } from "@/types/cursorSync";

// Minimal schema for testing
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "text*",
      group: "block",
      attrs: { sourceLine: { default: null } },
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return ["p", 0];
      },
    },
    heading: {
      content: "text*",
      group: "block",
      attrs: { sourceLine: { default: null }, level: { default: 1 } },
      parseDOM: [{ tag: "h1" }],
      toDOM() {
        return ["h1", 0];
      },
    },
    text: { inline: true },
  },
});

function createDoc(...children: ReturnType<typeof schema.node>[]) {
  return schema.node("doc", null, children);
}

function para(text: string, sourceLine: number | null = null) {
  const content = text ? [schema.text(text)] : [];
  return schema.node("paragraph", { sourceLine }, content);
}

function _heading(text: string, sourceLine: number | null = null) {
  const content = text ? [schema.text(text)] : [];
  return schema.node("heading", { sourceLine, level: 1 }, content);
}

describe("constants", () => {
  it("END_OF_LINE_THRESHOLD is 0.99", () => {
    expect(END_OF_LINE_THRESHOLD).toBe(0.99);
  });

  it("MIN_CONTEXT_PATTERN_LENGTH is 3", () => {
    expect(MIN_CONTEXT_PATTERN_LENGTH).toBe(3);
  });
});

describe("getSourceLineFromPos", () => {
  it("returns sourceLine from the node at the current depth", () => {
    const doc = createDoc(para("hello", 1), para("world", 3));
    // Position inside first paragraph: doc(0) > para(1) > text starts at 1
    const $pos = doc.resolve(2); // inside "hello"
    expect(getSourceLineFromPos($pos)).toBe(1);
  });

  it("returns sourceLine from second paragraph", () => {
    const doc = createDoc(para("hello", 1), para("world", 3));
    // First para takes: 1 (open) + 5 (text) + 1 (close) = 7. Second para opens at 7, text at 8
    const $pos = doc.resolve(8);
    expect(getSourceLineFromPos($pos)).toBe(3);
  });

  it("returns null when no node has sourceLine", () => {
    const doc = createDoc(para("hello"), para("world"));
    const $pos = doc.resolve(2);
    expect(getSourceLineFromPos($pos)).toBeNull();
  });

  it("walks up ancestor chain to find sourceLine", () => {
    // When the text node has no sourceLine, walks to parent paragraph
    const doc = createDoc(para("text", 5));
    const $pos = doc.resolve(2); // inside text node
    expect(getSourceLineFromPos($pos)).toBe(5);
  });
});

describe("estimateSourceLine", () => {
  it("returns 1 for document with no sourceLine attributes", () => {
    const doc = createDoc(para("hello"), para("world"));
    expect(estimateSourceLine(doc, 2)).toBe(1);
  });

  it("returns last sourceLine before position", () => {
    const doc = createDoc(para("hello", 1), para("middle", 5), para("end", 10));
    // Position inside "middle" (after first para)
    const middlePos = 8; // inside second para
    expect(estimateSourceLine(doc, middlePos)).toBe(5);
  });

  it("returns sourceLine from first paragraph for position at start", () => {
    const doc = createDoc(para("hello", 3), para("world", 7));
    expect(estimateSourceLine(doc, 2)).toBe(3);
  });

  it("returns 1 for empty-ish document", () => {
    const doc = createDoc(para(""));
    expect(estimateSourceLine(doc, 1)).toBe(1);
  });
});

describe("findClosestSourceLine", () => {
  it("returns exact match textblock", () => {
    const doc = createDoc(para("hello", 5));
    const result = findClosestSourceLine(doc, 5);
    expect(result.pos).not.toBeNull();
    expect(result.node).not.toBeNull();
    expect(result.node!.textContent).toBe("hello");
  });

  it("returns closest node before target when no exact match", () => {
    const doc = createDoc(para("line1", 1), para("line10", 10));
    const result = findClosestSourceLine(doc, 5);
    // Should prefer line 1 (before target)
    expect(result.node!.textContent).toBe("line1");
  });

  it("returns after node when before is much farther (>10 lines)", () => {
    const doc = createDoc(para("early", 1), para("late", 50));
    // Target line 48: before is line 1 (47 away), after is line 50 (2 away)
    const result = findClosestSourceLine(doc, 48);
    expect(result.node!.textContent).toBe("late");
  });

  it("returns before node when both are close", () => {
    const doc = createDoc(para("before", 3), para("after", 7));
    // Target line 5: before is line 3 (2 away), after is line 7 (2 away)
    const result = findClosestSourceLine(doc, 5);
    expect(result.node!.textContent).toBe("before");
  });

  it("returns null pos and node for document with no sourceLine", () => {
    const doc = createDoc(para("hello"), para("world"));
    const result = findClosestSourceLine(doc, 5);
    expect(result.pos).toBeNull();
    expect(result.node).toBeNull();
  });

  it("returns after node when no before node exists", () => {
    const doc = createDoc(para("later", 20));
    const result = findClosestSourceLine(doc, 5);
    expect(result.node!.textContent).toBe("later");
  });
});

describe("findClosestSourceLine — container types", () => {
  // Schema with alertBlock container that has sourceLine + nested paragraphs
  const containerSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: {
        content: "text*",
        group: "block",
        attrs: { sourceLine: { default: null } },
        parseDOM: [{ tag: "p" }],
        toDOM() { return ["p", 0]; },
      },
      alertBlock: {
        content: "paragraph+",
        group: "block",
        attrs: { sourceLine: { default: null }, type: { default: "note" } },
        parseDOM: [{ tag: "div.alert" }],
        toDOM() { return ["div", { class: "alert" }, 0]; },
      },
      detailsBlock: {
        content: "paragraph+",
        group: "block",
        attrs: { sourceLine: { default: null } },
        parseDOM: [{ tag: "details" }],
        toDOM() { return ["details", 0]; },
      },
      text: { inline: true },
    },
  });

  function containerPara(text: string, sourceLine: number | null = null) {
    const content = text ? [containerSchema.text(text)] : [];
    return containerSchema.node("paragraph", { sourceLine }, content);
  }

  it("handles alertBlock container — finds first textblock child (before target)", () => {
    const alertNode = containerSchema.node("alertBlock", { sourceLine: 5, type: "note" }, [
      containerPara("alert content"),
    ]);
    const doc = containerSchema.node("doc", null, [
      containerPara("intro", 1),
      alertNode,
      containerPara("outro", 20),
    ]);

    // Target line 7: alertBlock at line 5 is before, outro at line 20 is after
    const result = findClosestSourceLine(doc, 7);
    expect(result.pos).not.toBeNull();
    expect(result.node).not.toBeNull();
    expect(result.node!.textContent).toBe("alert content");
  });

  it("handles alertBlock container — uses after node when before is far away", () => {
    const alertNode = containerSchema.node("alertBlock", { sourceLine: 50, type: "tip" }, [
      containerPara("later alert"),
    ]);
    const doc = containerSchema.node("doc", null, [
      containerPara("early", 1),
      alertNode,
    ]);

    // Target line 48: early is line 1 (47 away), alertBlock is line 50 (2 away)
    // beforeDiff=47 > 10, afterDiff=2 < 47, so should prefer after
    const result = findClosestSourceLine(doc, 48);
    expect(result.node).not.toBeNull();
    expect(result.node!.textContent).toBe("later alert");
  });

  it("handles detailsBlock container", () => {
    const detailsNode = containerSchema.node("detailsBlock", { sourceLine: 10 }, [
      containerPara("details content"),
    ]);
    const doc = containerSchema.node("doc", null, [detailsNode]);

    const result = findClosestSourceLine(doc, 10);
    expect(result.pos).not.toBeNull();
    expect(result.node!.textContent).toBe("details content");
  });

  it("skips container without textblock children", () => {
    // Create alertBlock with no real textblock content (empty paragraph)
    const alertNode = containerSchema.node("alertBlock", { sourceLine: 5, type: "note" }, [
      containerPara(""),
    ]);
    const doc = containerSchema.node("doc", null, [alertNode]);

    // Empty paragraph IS a textblock, so it should still be found
    const result = findClosestSourceLine(doc, 5);
    expect(result.pos).not.toBeNull();
  });

  it("handles container after target line", () => {
    const alertNode = containerSchema.node("alertBlock", { sourceLine: 15, type: "warning" }, [
      containerPara("warning text"),
    ]);
    const doc = containerSchema.node("doc", null, [alertNode]);

    // Target line 5: alertBlock at line 15 is after target
    const result = findClosestSourceLine(doc, 5);
    expect(result.node).not.toBeNull();
    expect(result.node!.textContent).toBe("warning text");
  });

  it("early-exit guard fires when container has multiple children (line 105: firstTextblockPos !== null)", () => {
    // A container with TWO paragraph children: the first child sets firstTextblockPos,
    // and when descendants visits the second child, `if (firstTextblockPos !== null) return false`
    // fires to stop traversal early. The first textblock is still used as the result.
    const alertNode = containerSchema.node("alertBlock", { sourceLine: 5, type: "note" }, [
      containerPara("first child"),
      containerPara("second child"),
    ]);
    const doc = containerSchema.node("doc", null, [alertNode]);

    const result = findClosestSourceLine(doc, 5);
    expect(result.pos).not.toBeNull();
    expect(result.node).not.toBeNull();
    // Should return the FIRST textblock child, not the second
    expect(result.node!.textContent).toBe("first child");
  });
});

describe("findColumnInLine", () => {
  function makeCursorInfo(overrides: Partial<CursorInfo>): CursorInfo {
    return {
      sourceLine: 1,
      wordAtCursor: "",
      offsetInWord: 0,
      nodeType: "paragraph",
      percentInLine: 0,
      contextBefore: "",
      contextAfter: "",
      ...overrides,
    };
  }

  describe("strategy 1: context match", () => {
    it("finds column by context match", () => {
      const info = makeCursorInfo({
        contextBefore: "hel",
        contextAfter: "lo world",
      });
      const col = findColumnInLine("hello world", info);
      expect(col).toBe(3); // "hel" length
    });

    it("skips context match when pattern too short", () => {
      const info = makeCursorInfo({
        contextBefore: "h",
        contextAfter: "e",
        wordAtCursor: "hello",
        offsetInWord: 1,
      });
      // Pattern "he" is length 2, below MIN_CONTEXT_PATTERN_LENGTH (3)
      // Should fall through to word match
      const col = findColumnInLine("hello world", info);
      expect(col).toBe(1); // word "hello" at idx 0 + offsetInWord 1
    });
  });

  describe("strategy 2: word match", () => {
    it("finds column by word match when context fails", () => {
      const info = makeCursorInfo({
        contextBefore: "xyz", // won't match
        contextAfter: "abc", // won't match
        wordAtCursor: "world",
        offsetInWord: 2,
      });
      const col = findColumnInLine("hello world", info);
      expect(col).toBe(8); // "world" at idx 6 + offset 2
    });

    it("finds first occurrence of word", () => {
      const info = makeCursorInfo({
        wordAtCursor: "the",
        offsetInWord: 1,
      });
      const col = findColumnInLine("the cat and the dog", info);
      expect(col).toBe(1); // first "the" at idx 0 + offset 1
    });
  });

  describe("strategy 3: percentage fallback", () => {
    it("uses percentage when word and context both fail", () => {
      const info = makeCursorInfo({
        contextBefore: "xyz",
        contextAfter: "abc",
        wordAtCursor: "notfound",
        percentInLine: 0.5,
      });
      const col = findColumnInLine("hello world", info);
      expect(col).toBe(6); // round(0.5 * 11) = 6
    });

    it("returns 0 for empty line", () => {
      const info = makeCursorInfo({ percentInLine: 0.5 });
      const col = findColumnInLine("", info);
      expect(col).toBe(0);
    });

    it("returns full length for percentInLine=1", () => {
      const info = makeCursorInfo({ percentInLine: 1.0 });
      const col = findColumnInLine("hello", info);
      expect(col).toBe(5);
    });
  });

  describe("edge cases", () => {
    it("handles empty lineText with all strategies", () => {
      const info = makeCursorInfo({
        contextBefore: "abc",
        contextAfter: "def",
        wordAtCursor: "word",
        percentInLine: 0,
      });
      expect(findColumnInLine("", info)).toBe(0);
    });

    it("handles CJK text", () => {
      const info = makeCursorInfo({
        wordAtCursor: "", // CJK won't match \w word
        percentInLine: 0.5,
      });
      const text = "你好世界测试";
      const col = findColumnInLine(text, info);
      expect(col).toBe(Math.round(0.5 * text.length));
    });
  });
});
