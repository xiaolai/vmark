/**
 * Code Fence Detection Tests
 *
 * Tests for detecting code fences in Source mode.
 * Used by Cmd+A to select content within code fences.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCodeFenceInfo, getCodeFenceInfoAt } from "../codeFenceDetection";

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
    // Updated: previously pinned buggy behavior (unclosed fence returned
    // null). Per CommonMark an unterminated fence extends to end of
    // document, so content after the opener line is inside the fence.
    it("detects unclosed fence as extending to end of document", () => {
      const content = "```\nunclosed code";
      const view = createView(content, 8); // inside "unclosed"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.startLine).toBe(1);
      expect(info?.endLine).toBe(2); // last document line
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

    // Intentional deviation from strict CommonMark (which caps fence indent
    // at 3 spaces): fences nested in list items legitimately carry 4+ raw
    // spaces of indent, and a line-based detector cannot see list context.
    // A 4-space-indented run outside a list is an indented code block anyway,
    // so treating it as "code" keeps guard semantics correct either way.
    it("detects a 4-space-indented fence (permissive indent, documented)", () => {
      const content = "    ```js\n    code\n    ```";
      const view = createView(content, 14); // cursor in "code"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("js");
      view.destroy();
    });
  });

  describe("tilde fences", () => {
    it("detects cursor inside a ~~~ fence", () => {
      const content = "~~~\ncode\n~~~";
      const view = createView(content, 6); // inside "code"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("");
      expect(info?.startLine).toBe(1);
      expect(info?.endLine).toBe(3);
      view.destroy();
    });

    it("captures the language of a ~~~ fence", () => {
      const content = "~~~python\nprint('hi')\n~~~";
      const view = createView(content, 14); // inside content
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("python");
      view.destroy();
    });

    it("returns null outside a closed ~~~ fence", () => {
      const content = "~~~\ncode\n~~~\n\nafter";
      const view = createView(content, 15); // inside "after"
      expect(getCodeFenceInfo(view)).toBeNull();
      view.destroy();
    });

    it("treats ``` inside a ~~~ fence as content, not a closer", () => {
      const content = "~~~\n```\ncode\n~~~";
      const view = createView(content, 9); // inside "code" (after the ``` line)
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.startLine).toBe(1);
      expect(info?.endLine).toBe(4);
      view.destroy();
    });

    it("treats ~~~ inside a ``` fence as content, not a closer", () => {
      const content = "```\ncode\n~~~\nmore\n```";
      const view = createView(content, 14); // inside "more"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.startLine).toBe(1);
      expect(info?.endLine).toBe(5);
      view.destroy();
    });

    it("requires a tilde closer at least as long as the opener", () => {
      const content = "~~~~\ncode\n~~~\nmore\n~~~~";
      const view = createView(content, 15); // inside "more"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.startLine).toBe(1);
      expect(info?.endLine).toBe(5); // "~~~" (3 < 4) did not close it
      view.destroy();
    });

    it("accepts a closer longer than the opener", () => {
      const content = "~~~\ncode\n~~~~~";
      const view = createView(content, 5); // inside "code"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.endLine).toBe(3);
      view.destroy();
    });

    it("allows backticks in a tilde fence info string", () => {
      const content = "~~~js`x\ncode\n~~~";
      const view = createView(content, 9); // inside "code"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("js`x");
      view.destroy();
    });
  });

  describe("unterminated fences", () => {
    it("treats content after an unclosed ``` opener as inside, to EOF", () => {
      const content = "text\n```js\nline one\nline two";
      const view = createView(content, 25); // inside "line two"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("js");
      expect(info?.startLine).toBe(2);
      expect(info?.endLine).toBe(4); // last document line
      view.destroy();
    });

    it("treats content after an unclosed ~~~ opener as inside, to EOF", () => {
      const content = "~~~\nstuff";
      const view = createView(content, 6); // inside "stuff"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.startLine).toBe(1);
      expect(info?.endLine).toBe(2);
      view.destroy();
    });

    it("detects cursor at the very end of an unclosed fence", () => {
      const content = "```\ncode";
      const view = createView(content, content.length);
      expect(getCodeFenceInfo(view)).not.toBeNull();
      view.destroy();
    });

    // The opener line of an UNTERMINATED fence stays "outside": while the
    // user is still typing the opener (e.g. the third backtick of ```),
    // consumers like markdownAutoPair's fence auto-completion must not be
    // suppressed by the very fence being typed. Closed fences keep the
    // historical behavior (opener line counts as inside).
    it("returns null on the opener line of an unterminated fence", () => {
      const content = "```js\ncode";
      const view = createView(content, 3); // on the opener line
      expect(getCodeFenceInfo(view)).toBeNull();
      view.destroy();
    });

    it("detects an unclosed fence that follows a closed fence", () => {
      const content = "```\na\n```\ntext\n```\nb";
      // cursor in "b" (last line) — inside the second, unclosed fence
      const view = createView(content, 19);
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.startLine).toBe(5);
      expect(info?.endLine).toBe(6);

      // cursor in "text" — between fences, outside both
      expect(getCodeFenceInfoAt(view.state, 11)).toBeNull();
      view.destroy();
    });
  });

  describe("info string capture", () => {
    it.each([
      ["c++", "```c++\ncode\n```"],
      ["c#", "```c#\ncode\n```"],
      ["objective-c", "```objective-c\ncode\n```"],
    ])("captures %s as the full language token", (lang, content) => {
      const view = createView(content, content.indexOf("code") + 1);
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe(lang);
      view.destroy();
    });

    it("captures only the first token of a multi-word info string", () => {
      const content = "```ruby startline=3\ncode\n```";
      const view = createView(content, 22); // inside "code"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("ruby");
      view.destroy();
    });

    it("skips leading whitespace before the language token", () => {
      const content = "``` js\ncode\n```";
      const view = createView(content, 9); // inside "code"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.language).toBe("js");
      // language starts after "``` " (fence chars + one space)
      expect(info?.languageStartPos).toBe(4);
      expect(info?.languageEndPos).toBe(6);
      view.destroy();
    });

    it("reports language bounds spanning the full token", () => {
      const content = "```c++\ncode\n```";
      const view = createView(content, 9); // inside "code"
      const info = getCodeFenceInfo(view);

      expect(info).not.toBeNull();
      expect(info?.languageStartPos).toBe(3);
      expect(info?.languageEndPos).toBe(6); // covers "c++", not just "c"
      view.destroy();
    });

    it("rejects a backtick opener whose info string contains backticks", () => {
      // CommonMark: backtick-fence info strings may not contain backticks,
      // so "```js`x" is not an opening fence at all.
      const content = "```js`x\ntext";
      const view = createView(content, 10); // inside "text"
      expect(getCodeFenceInfo(view)).toBeNull();
      view.destroy();
    });
  });
});

describe("getCodeFenceInfoAt", () => {
  it("evaluates the given position, not the view selection", () => {
    const content = "text\n```js\ncode\n```";
    const state = EditorState.create({ doc: content });

    // Position inside "text" — outside the fence
    expect(getCodeFenceInfoAt(state, 2)).toBeNull();

    // Position inside "code" — inside the fence
    const info = getCodeFenceInfoAt(state, 12);
    expect(info).not.toBeNull();
    expect(info?.language).toBe("js");
  });
});

describe("language token positions — the no-info-string case", () => {
  // Re-deriving the delimiter run with `search(/[^`~]/)` returned -1 when the
  // opener carried NO info string (the whole slice is markers), and
  // `languageStartPos` collapsed onto the first backtick. Setting a language
  // would have written "js```" instead of "```js". The run comes from the
  // scanner now, which already knows it.
  const infoFor = (doc: string) =>
    getCodeFenceInfoAt(EditorState.create({ doc }), doc.indexOf("code"));

  it.each([
    { label: "backtick, no info", doc: "```\ncode\n```", start: 3 },
    { label: "tilde, no info", doc: "~~~\ncode\n~~~", start: 3 },
    { label: "longer run, no info", doc: "`````\ncode\n`````", start: 5 },
    { label: "indented, no info", doc: "  ```\ncode\n  ```", start: 5 },
  ])("$label — languageStartPos sits AFTER the run", ({ doc, start }) => {
    const info = infoFor(doc);
    expect(info?.language).toBe("");
    expect(info?.languageStartPos).toBe(start);
    expect(info?.languageEndPos).toBe(start);
  });

  it.each([
    { label: "backtick with lang", doc: "```js\ncode\n```", start: 3, lang: "js" },
    { label: "run of five with lang", doc: "`````ts\ncode\n`````", start: 5, lang: "ts" },
    { label: "space before lang", doc: "```  js\ncode\n```", start: 5, lang: "js" },
  ])("$label — unchanged", ({ doc, start, lang }) => {
    const info = infoFor(doc);
    expect(info?.language).toBe(lang);
    expect(info?.languageStartPos).toBe(start);
    expect(info?.languageEndPos).toBe(start + lang.length);
  });

  it("a language can be inserted at languageStartPos to make a valid fence", () => {
    // The end-to-end claim the positions exist for.
    const doc = "```\ncode\n```";
    const info = infoFor(doc)!;
    const withLang =
      doc.slice(0, info.languageStartPos) + "js" + doc.slice(info.languageEndPos);
    expect(withLang).toBe("```js\ncode\n```");
  });
});
