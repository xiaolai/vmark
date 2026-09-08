// WI-FL5.2 — frontmatterPanel/nodeView: the collapsible YAML panel's contract
// (ledger F7, markdown-artifact-nodes). Driven through a real Tiptap editor
// and real DOM events, so what is asserted is the document, the undo stack
// and the panel the user sees.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { undoDepth } from "@tiptap/pm/history";
import { Node } from "@tiptap/core";
import { createFrontmatterNodeView } from "./nodeView";

// A minimal local node spec mirroring `markdownArtifacts/frontmatter.ts` (name,
// block atom, one `value` attribute) so this plugin's test does not import
// another plugin — the plugin-isolation dependency rule forbids that edge, and
// the NodeView under test only needs a node named "frontmatter" to attach to.
const FrontmatterNode = Node.create({
  name: "frontmatter",
  group: "block",
  atom: true,
  addAttributes() {
    return { value: { default: "" } };
  },
  renderHTML({ node }) {
    return ["div", { "data-type": "frontmatter", "data-value": String(node.attrs.value ?? "") }];
  },
  addNodeView() {
    return ({ node, editor, getPos }) =>
      createFrontmatterNodeView(node, editor.view, getPos as () => number | undefined);
  },
});

const YAML = "title: One";
const BLUR_COMMIT_MS = 300;

let editors: Editor[] = [];

function createEditor(value = YAML): Editor {
  const editor = new Editor({
    extensions: [StarterKit, FrontmatterNode],
    content: {
      type: "doc",
      content: [
        { type: "frontmatter", attrs: { value } },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

function panel(editor: Editor) {
  const dom = editor.view.dom.querySelector<HTMLElement>(".frontmatter-panel");
  const header = dom?.querySelector<HTMLElement>(".frontmatter-panel-header");
  const textarea = dom?.querySelector<HTMLTextAreaElement>("textarea");
  if (!dom || !header || !textarea) throw new Error("frontmatter panel not rendered");
  return { dom, header, textarea };
}

function frontmatterValue(editor: Editor): string {
  return editor.state.doc.firstChild?.attrs.value as string;
}

function isExpanded(editor: Editor): boolean {
  const { dom, header } = panel(editor);
  const cls = dom.classList.contains("expanded");
  expect(header.getAttribute("aria-expanded")).toBe(String(cls)); // a11y stays in sync
  return cls;
}

/** A real keydown: bubbles and cancelable, like the browser's. */
function keydown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function blur(target: EventTarget): void {
  target.dispatchEvent(new FocusEvent("blur"));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  vi.useRealTimers();
});

describe("frontmatter panel — collapse / expand", () => {
  it("renders collapsed, with the YAML already in the textarea", () => {
    const editor = createEditor();
    expect(isExpanded(editor)).toBe(false);
    expect(panel(editor).textarea.value).toBe(YAML);
    expect(panel(editor).dom.contentEditable).toBe("false");
  });

  it("a header click expands; a second click collapses", () => {
    const editor = createEditor();
    panel(editor).header.click();
    expect(isExpanded(editor)).toBe(true);
    panel(editor).header.click();
    expect(isExpanded(editor)).toBe(false);
  });

  it("Enter and Space on the focused header toggle too (keyboard-accessible)", () => {
    const editor = createEditor();
    const { header } = panel(editor);
    expect(header.getAttribute("role")).toBe("button");
    expect(header.getAttribute("tabindex")).toBe("0");

    const enter = keydown(header, { key: "Enter" });
    expect(enter.defaultPrevented).toBe(true);
    expect(isExpanded(editor)).toBe(true);

    keydown(header, { key: " " });
    expect(isExpanded(editor)).toBe(false);
  });
});

describe("frontmatter panel — Mod+Enter commits, Escape cancels", () => {
  it("Cmd+Enter writes the textarea into the node, collapses, and is exactly ONE undo step", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: Two";

    const event = keydown(textarea, { key: "Enter", metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(frontmatterValue(editor)).toBe("title: Two");
    expect(isExpanded(editor)).toBe(false);
    expect(undoDepth(editor.state)).toBe(1);
    // The body is untouched — StarterKit's own Mod-Enter (hard break) must not have fired.
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(1).toJSON()).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Body" }],
    });
  });

  it("Ctrl+Enter commits as well (non-macOS modifier)", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: Ctrl";

    keydown(textarea, { key: "Enter", ctrlKey: true });

    expect(frontmatterValue(editor)).toBe("title: Ctrl");
    expect(undoDepth(editor.state)).toBe(1);
  });

  it("a plain Enter inside the textarea is a newline, not a commit", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: Two";

    const event = keydown(textarea, { key: "Enter" });

    expect(event.defaultPrevented).toBe(false);
    expect(frontmatterValue(editor)).toBe(YAML);
    expect(isExpanded(editor)).toBe(true);
  });

  it("committing an unchanged value collapses without touching the document or undo history", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();

    keydown(textarea, { key: "Enter", metaKey: true });

    expect(frontmatterValue(editor)).toBe(YAML);
    expect(undoDepth(editor.state)).toBe(0);
    expect(isExpanded(editor)).toBe(false);
  });

  it("Escape reverts the textarea to the committed YAML and collapses — no transaction", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: Abandoned";

    const event = keydown(textarea, { key: "Escape" });

    expect(event.defaultPrevented).toBe(true);
    expect(textarea.value).toBe(YAML);
    expect(frontmatterValue(editor)).toBe(YAML);
    expect(undoDepth(editor.state)).toBe(0);
    expect(isExpanded(editor)).toBe(false);
  });

  it("a keystroke that belongs to an IME composition is ignored", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: 二";

    keydown(textarea, { key: "Enter", metaKey: true, isComposing: true });

    expect(frontmatterValue(editor)).toBe(YAML);
    expect(isExpanded(editor)).toBe(true);
  });

  it("one undo restores the previous YAML in the document AND in the textarea", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: Two";
    keydown(textarea, { key: "Enter", metaKey: true });
    expect(frontmatterValue(editor)).toBe("title: Two");

    editor.commands.undo();

    expect(frontmatterValue(editor)).toBe(YAML);
    expect(panel(editor).textarea.value).toBe(YAML);
    expect(undoDepth(editor.state)).toBe(0);
  });
});

describe("frontmatter panel — the 300 ms blur commit", () => {
  it("leaving the textarea commits after 300 ms, not before", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: Blurred";

    blur(textarea);
    vi.advanceTimersByTime(BLUR_COMMIT_MS - 1);
    expect(frontmatterValue(editor)).toBe(YAML);

    vi.advanceTimersByTime(1);
    expect(frontmatterValue(editor)).toBe("title: Blurred");
    expect(undoDepth(editor.state)).toBe(1);
  });

  it("blur with an unchanged value commits nothing", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();

    blur(textarea);
    vi.advanceTimersByTime(BLUR_COMMIT_MS);

    expect(undoDepth(editor.state)).toBe(0);
  });

  it("a second blur inside the window restarts the debounce and still yields ONE commit", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: Twice";

    blur(textarea);
    vi.advanceTimersByTime(200);
    blur(textarea);
    vi.advanceTimersByTime(200); // 400 ms after the first blur, 200 after the second
    expect(frontmatterValue(editor)).toBe(YAML);

    vi.advanceTimersByTime(100);
    expect(frontmatterValue(editor)).toBe("title: Twice");
    expect(undoDepth(editor.state)).toBe(1);
  });

  it("an explicit Cmd+Enter before the blur timer fires leaves no second commit behind", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: Fast";

    blur(textarea);
    keydown(textarea, { key: "Enter", metaKey: true });
    expect(undoDepth(editor.state)).toBe(1);

    vi.advanceTimersByTime(BLUR_COMMIT_MS);
    expect(undoDepth(editor.state)).toBe(1); // the timer found nothing new to commit
    expect(frontmatterValue(editor)).toBe("title: Fast");
  });

  it("destroying the view cancels a pending blur commit", () => {
    const editor = createEditor();
    const { header, textarea } = panel(editor);
    header.click();
    textarea.value = "title: Gone";

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    blur(textarea);
    const blurTimer = setTimeoutSpy.mock.results.find(
      (_r, i) => setTimeoutSpy.mock.calls[i]?.[1] === BLUR_COMMIT_MS,
    )?.value as ReturnType<typeof setTimeout> | undefined;
    expect(blurTimer).toBeDefined();

    editor.destroy();
    editors = [];

    // Tiptap's own destroy schedules and clears timers of its own, so the
    // evidence is the blur timer's id being cleared — not a raw timer count.
    expect(clearTimeoutSpy.mock.calls.some((c) => c[0] === blurTimer)).toBe(true);
    expect(() => vi.advanceTimersByTime(BLUR_COMMIT_MS)).not.toThrow();
  });
});

describe("frontmatter panel — ProseMirror NodeView contract", () => {
  it("claims events inside the textarea only while expanded; ignores DOM mutations; tracks node updates", () => {
    const editor = createEditor();
    const node = editor.state.doc.firstChild;
    if (!node) throw new Error("no frontmatter node");
    const view = createFrontmatterNodeView(node, editor.view, () => 0);
    const textarea = view.dom.querySelector<HTMLTextAreaElement>("textarea");
    const header = view.dom.querySelector<HTMLElement>(".frontmatter-panel-header");
    if (!textarea || !header) throw new Error("panel not built");

    const inside = new KeyboardEvent("keydown", { key: "a" });
    Object.defineProperty(inside, "target", { value: textarea });
    expect(view.stopEvent?.(inside)).toBe(false); // collapsed: the editor owns everything
    header.click();
    expect(view.stopEvent?.(inside)).toBe(true); // expanded: the panel owns its textarea
    const outside = new KeyboardEvent("keydown", { key: "a" });
    Object.defineProperty(outside, "target", { value: header });
    expect(view.stopEvent?.(outside)).toBe(false);

    expect(view.ignoreMutation?.({} as never)).toBe(true);

    // update(): a different node type is refused; a new value is mirrored into the textarea.
    const paragraph = editor.state.doc.child(1);
    expect(view.update?.(paragraph, [], null as never)).toBe(false);
    const changed = node.type.create({ ...node.attrs, value: "title: Fresh" });
    expect(view.update?.(changed, [], null as never)).toBe(true);
    expect(textarea.value).toBe("title: Fresh");

    view.destroy?.();
  });
});
