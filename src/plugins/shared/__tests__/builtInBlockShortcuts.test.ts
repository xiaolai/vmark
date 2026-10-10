// Tiptap's built-in block shortcuts must not reach the editor. VMark binds every
// one of these commands itself (shortcutDefinitions.ts, through runEditorAction,
// which refuses markdown-writing actions inside a code fence). The stock
// extensions also register their own unadvertised keys, which skip that gate and
// the user's bindings: Cmd+Opt+2 turned a fenced code block into a heading and
// lost the fence on the next save.
import { describe, it, expect, afterEach } from "vitest";
import { createTypingSession, type TypingSession } from "@/test/typingHarness";

const HIDDEN: Array<[string, KeyboardEventInit]> = [
  ...[0, 1, 2, 3, 4, 5, 6].map(
    (d) =>
      [`Mod-Alt-${d}`, { key: String(d), code: `Digit${d}`, metaKey: true, altKey: true }] as [
        string,
        KeyboardEventInit,
      ],
  ),
  ["Mod-Shift-b", { key: "b", code: "KeyB", metaKey: true, shiftKey: true }],
  ["Mod-Shift-7", { key: "7", code: "Digit7", metaKey: true, shiftKey: true }],
  ["Mod-Shift-8", { key: "8", code: "Digit8", metaKey: true, shiftKey: true }],
  ["Mod-Alt-c", { key: "c", code: "KeyC", metaKey: true, altKey: true }],
];

let session: TypingSession | null = null;
afterEach(() => {
  session?.destroy();
  session = null;
});

function press(s: TypingSession, init: KeyboardEventInit): void {
  s.editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }),
  );
}

describe("Tiptap's built-in block shortcuts are not registered", () => {
  it.each(HIDDEN)("%s leaves a fenced code block intact", (_name, init) => {
    session = createTypingSession();
    session.editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "python" },
          content: [{ type: "text", text: "# comment\nx = 1" }],
        },
      ],
    });
    const before = session.markdown();
    session.setCursor(3);
    press(session, init);
    expect(session.markdown()).toBe(before);
  });

  it.each(HIDDEN)("%s does not restyle a paragraph", (_name, init) => {
    session = createTypingSession();
    session.editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    });
    const before = session.markdown();
    session.setCursor(2);
    press(session, init);
    expect(session.markdown()).toBe(before);
  });

  it("keeps the code block's own editing keys (Enter still adds a line)", () => {
    session = createTypingSession();
    session.editor.commands.setContent({
      type: "doc",
      content: [{ type: "codeBlock", attrs: { language: "python" }, content: [{ type: "text", text: "x" }] }],
    });
    session.setCursor(2);
    session.press("Enter");
    expect(session.editor.state.doc.firstChild?.type.name).toBe("codeBlock");
    expect(session.editor.state.doc.firstChild?.textContent).toBe("x\n");
  });
});
