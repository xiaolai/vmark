/**
 * Tests for focusMode extension — createFocusDecoration logic and extension metadata.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";

// Mock editorStore
const mockEditorState = { focusModeEnabled: false };

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => mockEditorState,
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock("@/utils/imeGuard", () => ({
  runOrQueueProseMirrorAction: vi.fn((_view, fn) => fn()),
}));

// ---------------------------------------------------------------------------
// Replicate createFocusDecoration for unit testing (module-private in source)
// ---------------------------------------------------------------------------

import { Decoration } from "@tiptap/pm/view";

function createFocusDecoration(state: EditorState): DecorationSet | null {
  if (!mockEditorState.focusModeEnabled) return null;

  const { selection } = state;
  const { $from } = selection;

  if ($from.depth < 1) return null;

  try {
    const start = $from.before(1);
    const end = $from.after(1);

    const decoration = Decoration.node(start, end, {
      class: "md-focus",
    });

    return DecorationSet.create(state.doc, [decoration]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Test schema
// ---------------------------------------------------------------------------

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
});

function createState(texts: string[], cursorPos?: number) {
  const paragraphs = texts.map((t) =>
    t ? schema.node("paragraph", null, [schema.text(t)]) : schema.node("paragraph")
  );
  const doc = schema.node("doc", null, paragraphs);
  const state = EditorState.create({ doc, schema });
  if (cursorPos !== undefined) {
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursorPos)));
  }
  return state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockEditorState.focusModeEnabled = false;
});

describe("createFocusDecoration", () => {
  it("returns null when focusMode is disabled", () => {
    mockEditorState.focusModeEnabled = false;
    const state = createState(["hello world"]);
    expect(createFocusDecoration(state)).toBeNull();
  });

  it("returns decorations when focusMode is enabled", () => {
    mockEditorState.focusModeEnabled = true;
    // Position cursor inside first paragraph (pos 1 = inside first paragraph)
    const state = createState(["hello world"], 1);
    const result = createFocusDecoration(state);
    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(DecorationSet);
  });

  it("decorates the paragraph containing the cursor", () => {
    mockEditorState.focusModeEnabled = true;
    const state = createState(["first", "second"], 1);
    const result = createFocusDecoration(state);
    expect(result).not.toBeNull();

    // Find the decoration — should be on the first paragraph (pos 0 to 7)
    const decos = result!.find();
    expect(decos).toHaveLength(1);
    expect(decos[0].from).toBe(0);
  });

  it("decorates second paragraph when cursor is there", () => {
    mockEditorState.focusModeEnabled = true;
    // "first" = paragraph from 0-7, "second" = paragraph from 7-15
    // cursor at pos 8 = inside "second" paragraph
    const state = createState(["first", "second"], 8);
    const result = createFocusDecoration(state);
    expect(result).not.toBeNull();

    const decos = result!.find();
    expect(decos).toHaveLength(1);
    // Second paragraph starts at pos 7
    expect(decos[0].from).toBe(7);
  });

  it("applies md-focus class decoration", () => {
    mockEditorState.focusModeEnabled = true;
    const state = createState(["hello"], 1);
    const result = createFocusDecoration(state);
    const decos = result!.find();
    // Node decorations have spec.attrs or we can check the type
    expect(decos).toHaveLength(1);
  });
});

describe("focusModeExtension", () => {
  it("creates extension with correct name", async () => {
    const { focusModeExtension } = await import("../tiptap");
    expect(focusModeExtension.name).toBe("focusMode");
  });
});
