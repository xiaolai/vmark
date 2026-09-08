// WI-FL5.3 — genieInvocation/extraction: scope extraction against a REAL
// editor document (ledger F7, genie-invocation). Which text a genie receives
// for each scope, where it came from, and how the prompt template is filled.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { taskListItemExtension } from "@/plugins/taskToggle/tiptap";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { extractContent, fillTemplate, formatContext } from "./extraction";

// VMark's own listItem (task-aware) replaces StarterKit's, as the assembly does.
const EXTENSIONS = [StarterKit.configure({ listItem: false }), taskListItemExtension];

const MARKDOWN = "# Title\n\nFirst paragraph.\n\n- one\n- two\n\nLast paragraph.";

let editors: Editor[] = [];

function mountEditor(markdown = MARKDOWN): Editor {
  const schema = getSchema(EXTENSIONS);
  const doc = parseMarkdown(schema, markdown);
  const editor = new Editor({ extensions: EXTENSIONS, content: doc.toJSON() });
  editors.push(editor);
  useEditorStore.getState().setTiptapEditor(editor);
  return editor;
}

/** Document position of the first occurrence of `text`. */
function posOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isText && node.text && node.text.includes(text)) {
      found = pos + node.text.indexOf(text);
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error(`"${text}" not in document`);
  return found;
}

function select(editor: Editor, from: number, to = from): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
}

beforeEach(() => {
  useEditorStore.getState().clearTiptap();
  useUIStore.setState({ sourceMode: false });
  useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe("extractContent — document scope", () => {
  it("returns the whole document as markdown, flagged wholeDoc, spanning the full doc", () => {
    const editor = mountEditor();
    const result = extractContent("document", 2);

    expect(result).not.toBeNull();
    expect(result?.wholeDoc).toBe(true);
    expect(result?.from).toBe(0);
    expect(result?.to).toBe(editor.state.doc.content.size);
    expect(result?.text).toContain("# Title");
    expect(result?.text).toContain("First paragraph.");
    expect(result?.text).toContain("Last paragraph.");
    // The content IS the document — surrounding context is meaningless here.
    expect(result?.contextBefore).toBeUndefined();
    expect(result?.contextAfter).toBeUndefined();
  });
});

describe("extractContent — selection scope", () => {
  it("an explicit selection yields exactly the selected text and its range", () => {
    const editor = mountEditor();
    const from = posOf(editor, "First");
    select(editor, from, from + "First".length);

    const result = extractContent("selection");

    // The serializer ends a block with a newline; the words are exactly the selection.
    expect(result?.text.trimEnd()).toBe("First");
    expect(result).toMatchObject({ from, to: from + 5 });
    expect(result?.wholeDoc).toBeUndefined();
  });

  it("an empty selection expands to the enclosing block — the WHOLE list when the caret is in an item", () => {
    const editor = mountEditor();
    select(editor, posOf(editor, "one"));

    const result = extractContent("selection");

    expect(result?.text).toContain("one");
    expect(result?.text).toContain("two");
    expect(result?.text).not.toContain("First paragraph");
    expect(result?.wholeDoc).toBeUndefined();
    expect(result && result.from < posOf(editor, "one")).toBe(true);
    expect(result && result.to > posOf(editor, "two")).toBe(true);
  });

  it("a caret in a paragraph yields that paragraph alone", () => {
    const editor = mountEditor();
    select(editor, posOf(editor, "Last"));

    const result = extractContent("selection");

    expect(result?.text.trim()).toBe("Last paragraph.");
  });
});

describe("extractContent — block scope", () => {
  it("expands to the compound block even when text is selected inside it", () => {
    const editor = mountEditor();
    const from = posOf(editor, "one");
    select(editor, from, from + 3);

    const result = extractContent("block");

    expect(result?.text).toContain("one");
    expect(result?.text).toContain("two");
  });
});

describe("extractContent — surrounding context", () => {
  it("attaches ±radius neighbouring blocks as before/after context for non-document scopes", () => {
    const editor = mountEditor();
    select(editor, posOf(editor, "First"));

    const result = extractContent("block", 1);

    expect(result?.text.trim()).toBe("First paragraph.");
    expect(result?.contextBefore).toContain("Title");
    expect(result?.contextAfter).toContain("one");
    expect(result?.contextAfter).not.toContain("Last paragraph"); // radius 1: one block each side
  });

  it("the 'before' context is the IMMEDIATE predecessor — a block range starts at the boundary and must not be counted one block early", () => {
    const editor = mountEditor();
    select(editor, posOf(editor, "two")); // caret in the list → the whole list is the block

    const result = extractContent("block", 1);

    expect(result?.text).toContain("two");
    expect(result?.contextBefore?.trim()).toBe("First paragraph.");
    expect(result?.contextBefore).not.toContain("Title"); // two blocks back is NOT the neighbour
    expect(result?.contextAfter?.trim()).toBe("Last paragraph.");
  });

  it("radius 0 attaches no context", () => {
    const editor = mountEditor();
    select(editor, posOf(editor, "First"));

    const result = extractContent("block", 0);

    expect(result?.contextBefore).toBeUndefined();
    expect(result?.contextAfter).toBeUndefined();
  });

  it("at the document edges the missing side is an empty string", () => {
    const editor = mountEditor();
    select(editor, posOf(editor, "Title"));

    const result = extractContent("block", 1);

    expect(result?.contextBefore).toBe("");
    expect(result?.contextAfter).toContain("First paragraph.");
  });
});

describe("extractContent — no editor / source mode", () => {
  it("returns null when no WYSIWYG editor is registered", () => {
    expect(extractContent("selection")).toBeNull();
    expect(extractContent("document")).toBeNull();
  });

  it("in Source mode reads the active tab's document text from the store, as a whole-doc extraction", () => {
    const tabId = useTabStore.getState().createTab("main", "/ws/note.md");
    useDocumentStore.getState().initDocument(tabId, "raw *markdown*", "/ws/note.md");
    useUIStore.setState({ sourceMode: true });

    const result = extractContent("selection");

    expect(result).toEqual({ text: "raw *markdown*", from: 0, to: "raw *markdown*".length, wholeDoc: true });
  });

  it("in Source mode with no active tab the extraction is empty rather than null", () => {
    useUIStore.setState({ sourceMode: true });
    expect(extractContent("document")).toEqual({ text: "", from: 0, to: 0, wholeDoc: true });
  });
});

describe("formatContext", () => {
  it("labels each side and joins them with a blank line", () => {
    expect(formatContext("b", "a")).toBe("[Before]\nb\n\n[After]\na");
  });

  it("omits an empty side entirely", () => {
    expect(formatContext("b", "")).toBe("[Before]\nb");
    expect(formatContext("", "a")).toBe("[After]\na");
    expect(formatContext("", "")).toBe("");
  });
});

describe("fillTemplate", () => {
  it("substitutes every {{content}} occurrence, tolerating inner whitespace", () => {
    expect(fillTemplate("A: {{content}} / B: {{ content }}", "X")).toBe("A: X / B: X");
  });

  it("substitutes {{context}} when context is provided", () => {
    expect(fillTemplate("{{content}}\n---\n{{context}}", "body", "[Before]\nprev")).toBe(
      "body\n---\n[Before]\nprev",
    );
  });

  it("strips {{context}} when no context is given, so the model never sees a raw placeholder", () => {
    expect(fillTemplate("Fix {{content}}\n{{ context }}", "text")).toBe("Fix text\n");
  });

  it("leaves unknown placeholders alone", () => {
    expect(fillTemplate("{{content}} {{tone}}", "x")).toBe("x {{tone}}");
  });

  it("carries CJK and multi-line content through byte-for-byte", () => {
    const cjk = "第一行\n第二行 — with «quotes»";
    expect(fillTemplate("{{content}}", cjk)).toBe(cjk);
  });

  it("an empty content yields the template with the slot removed", () => {
    expect(fillTemplate("Rewrite: {{content}}", "")).toBe("Rewrite: ");
  });
});
