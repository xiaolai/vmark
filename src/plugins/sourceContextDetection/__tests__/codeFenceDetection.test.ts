/**
 * Code Fence Detection Tests
 *
 * Tests for detecting code fences in Source mode.
 * Used by Cmd+A to select content within code fences.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCodeFenceInfo } from "../codeFenceDetection";

function createView(content: string, cursorPos: number): EditorView {
  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos },
  });
  // Create a minimal view for testing
  const view = new EditorView({
    state,
    parent: document.createElement("div"),
  });
  return view;
}

describe("getCodeFenceInfo", () => {
  describe("basic detection", () => {
    it("returns null when cursor is not in a code fence", () => {
      const content = "Hello world\n\nSome text";
      const view = createView(content, 5); // cursor in "Hello"
      expect(getCodeFenceInfo(view)).toBeNull();
      view.destroy();
    });

    it("detects code fence when cursor is inside content", () => {
      const content = "```javascript\nconsole.log('hello');\n```";
      const view = createView(content, 20); // cursor inside the code
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("javascript");
      expect(info?.startLine).toBe(1);
      expect(info?.endLine).toBe(3);
      view.destroy();
    });

    it("detects code fence when cursor is on opening fence line", () => {
      const content = "```python\nprint('hi')\n```";
      const view = createView(content, 5); // cursor on "python"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("python");
      view.destroy();
    });

    it("detects code fence when cursor is on closing fence line", () => {
      const content = "```\ncode here\n```";
      const view = createView(content, 16); // cursor on closing ```
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.startLine).toBe(1);
      expect(info?.endLine).toBe(3);
      view.destroy();
    });
  });

  describe("fence without language", () => {
    it("detects fence without language identifier", () => {
      const content = "```\nplain code\n```";
      const view = createView(content, 8); // cursor in "plain"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("");
      view.destroy();
    });
  });

  describe("multiple code fences", () => {
    it("detects correct fence when multiple fences exist", () => {
      const content = "```js\nfirst\n```\n\ntext\n\n```py\nsecond\n```";
      // cursor in second fence "second"
      const view = createView(content, 30);
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("py");
      view.destroy();
    });

    it("returns null when cursor is between fences", () => {
      const content = "```\nfirst\n```\n\nbetween\n\n```\nsecond\n```";
      const view = createView(content, 18); // cursor in "between"
      expect(getCodeFenceInfo(view)).toBeNull();
      view.destroy();
    });
  });

  describe("edge cases", () => {
    it("returns null for unclosed fence", () => {
      const content = "```\nunclosed code";
      const view = createView(content, 8);
      expect(getCodeFenceInfo(view)).toBeNull();
      view.destroy();
    });

    it("handles fence with more than 3 backticks", () => {
      const content = "````\ncode\n````";
      const view = createView(content, 7);
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.startLine).toBe(1);
      expect(info?.endLine).toBe(3);
      view.destroy();
    });

    it("handles empty fence (no content lines)", () => {
      const content = "```\n```";
      const view = createView(content, 2); // cursor on opening fence
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      // endLine - startLine = 2 - 1 = 1 (adjacent lines)
      expect(info!.endLine - info!.startLine).toBe(1);
      view.destroy();
    });
  });

  describe("indented fences", () => {
    it("detects indented code fence", () => {
      const content = "  ```js\n  code\n  ```";
      const view = createView(content, 12); // cursor in "code"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("js");
      view.destroy();
    });
  });
});
