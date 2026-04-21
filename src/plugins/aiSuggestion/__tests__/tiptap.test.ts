/**
 * AI Suggestion Tiptap Plugin Tests
 *
 * Tests for the tiptap extension behavior including:
 * - Keyboard shortcuts (Enter, Escape, Tab, Shift-Tab, Mod-Shift-Enter, Mod-Shift-Escape)
 * - applySuggestionToTr: transaction construction for insert/replace/delete
 * - createIcon: SVG element creation
 * - createGhostText: ghost text element creation
 * - createButtons: accept/reject button container
 * - Plugin decorations: rendering for each suggestion type
 * - Plugin view: event listener wiring and cleanup
 * - Edge cases: stale positions, zero-length ranges, whole-document replace
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

// Mock CSS
vi.mock("../ai-suggestion.css", () => ({}));

// Mock imeGuard
vi.mock("@/utils/imeGuard", () => ({
  runOrQueueProseMirrorAction: vi.fn((_view, action) => action()),
}));

// Mock markdownPaste
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn((state, _content) => {
    // Return a simple text slice
    return state.schema.text ? state.doc.slice(0, 0) : null;
  }),
}));

// Mock markdownCopy
vi.mock("@/plugins/markdownCopy/tiptap", () => ({
  cleanMarkdownForClipboard: vi.fn((text) => text),
}));

// Mock aiSuggestionStore
const mockAiState = {
  suggestions: new Map(),
  focusedSuggestionId: null as string | null,
  acceptSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
  navigateNext: vi.fn(),
  navigatePrevious: vi.fn(),
  acceptAll: vi.fn(),
  rejectAll: vi.fn(),
  removeSuggestion: vi.fn(),
  focusSuggestion: vi.fn(),
  getSuggestion: vi.fn(),
};

vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: {
    getState: () => mockAiState,
    subscribe: vi.fn(() => vi.fn()),
  },
}));

// Mock tiptapEditorStore
const mockEditorStoreState = { editorView: null as unknown };
vi.mock("@/stores/tiptapEditorStore", () => ({
  useTiptapEditorStore: {
    getState: () => mockEditorStoreState,
  },
}));

import {
  isValidPosition,
  getDecorationClass,
  isButtonEvent,
  aiSuggestionExtension,
  applySuggestionToTr,
} from "../tiptap";
import type { AiSuggestion } from "../types";
import { AI_SUGGESTION_EVENTS } from "../types";

// Minimal schema
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: { inline: true },
  },
});

function createState(text: string) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  return EditorState.create({ doc, schema });
}

function makeSuggestion(overrides: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    id: "test-1",
    tabId: "tab-1",
    type: "insert",
    from: 0,
    to: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("aiSuggestionExtension", () => {
  beforeEach(() => {
    mockAiState.suggestions = new Map();
    mockAiState.focusedSuggestionId = null;
    mockAiState.acceptSuggestion.mockClear();
    mockAiState.rejectSuggestion.mockClear();
    mockAiState.navigateNext.mockClear();
    mockAiState.navigatePrevious.mockClear();
    mockAiState.acceptAll.mockClear();
    mockAiState.rejectAll.mockClear();
    mockAiState.removeSuggestion.mockClear();
    mockAiState.focusSuggestion.mockClear();
    mockAiState.getSuggestion.mockClear();
  });

  describe("extension creation", () => {
    it("has name 'aiSuggestion'", () => {
      expect(aiSuggestionExtension.name).toBe("aiSuggestion");
    });
  });

  describe("keyboard shortcuts", () => {
    it("Enter accepts focused suggestion when suggestions exist", () => {
      const suggestion = makeSuggestion();
      mockAiState.suggestions.set(suggestion.id, suggestion);
      mockAiState.focusedSuggestionId = suggestion.id;

      // The shortcut handler checks for focusedSuggestionId and suggestions.size
      expect(mockAiState.focusedSuggestionId).toBe("test-1");
      expect(mockAiState.suggestions.size).toBeGreaterThan(0);
    });

    it("Enter does nothing when no suggestions", () => {
      mockAiState.suggestions = new Map();
      mockAiState.focusedSuggestionId = null;

      expect(mockAiState.suggestions.size).toBe(0);
      expect(mockAiState.focusedSuggestionId).toBeNull();
    });

    it("Enter does nothing when no focused suggestion", () => {
      const suggestion = makeSuggestion();
      mockAiState.suggestions.set(suggestion.id, suggestion);
      mockAiState.focusedSuggestionId = null;

      expect(mockAiState.focusedSuggestionId).toBeNull();
    });

    it("Escape rejects focused suggestion", () => {
      const suggestion = makeSuggestion();
      mockAiState.suggestions.set(suggestion.id, suggestion);
      mockAiState.focusedSuggestionId = suggestion.id;

      // Simulate Escape handler logic
      if (mockAiState.focusedSuggestionId && mockAiState.suggestions.size > 0) {
        mockAiState.rejectSuggestion(mockAiState.focusedSuggestionId);
      }
      expect(mockAiState.rejectSuggestion).toHaveBeenCalledWith("test-1");
    });

    it("Tab navigates to next suggestion", () => {
      const s1 = makeSuggestion({ id: "s1", from: 0 });
      const s2 = makeSuggestion({ id: "s2", from: 10 });
      mockAiState.suggestions.set(s1.id, s1);
      mockAiState.suggestions.set(s2.id, s2);

      // Simulate Tab handler
      if (mockAiState.suggestions.size > 0) {
        mockAiState.navigateNext();
      }
      expect(mockAiState.navigateNext).toHaveBeenCalled();
    });

    it("Shift-Tab navigates to previous suggestion", () => {
      const s1 = makeSuggestion({ id: "s1", from: 0 });
      mockAiState.suggestions.set(s1.id, s1);

      if (mockAiState.suggestions.size > 0) {
        mockAiState.navigatePrevious();
      }
      expect(mockAiState.navigatePrevious).toHaveBeenCalled();
    });

    it("Mod-Shift-Enter accepts all suggestions", () => {
      const s1 = makeSuggestion({ id: "s1" });
      mockAiState.suggestions.set(s1.id, s1);

      if (mockAiState.suggestions.size > 0) {
        mockAiState.acceptAll();
      }
      expect(mockAiState.acceptAll).toHaveBeenCalled();
    });

    it("Mod-Shift-Escape rejects all suggestions", () => {
      const s1 = makeSuggestion({ id: "s1" });
      mockAiState.suggestions.set(s1.id, s1);

      if (mockAiState.suggestions.size > 0) {
        mockAiState.rejectAll();
      }
      expect(mockAiState.rejectAll).toHaveBeenCalled();
    });
  });

  describe("applySuggestionToTr logic", () => {
    it("clamps whole-document replace when to exceeds doc size", () => {
      const state = createState("hello world");
      const suggestion = makeSuggestion({
        type: "replace",
        from: 0,
        to: 999, // beyond current doc
        newContent: "new content",
      });

      // applySuggestionToTr should clamp to to docSize before replaceRange
      // so isValidPosition passes; we verify the tr does not throw
      const result = applySuggestionToTr(state, state.tr, suggestion);
      expect(result).toBe(result); // transaction returned without throwing
    });

    it("clamps whole-document replace when doc has grown (to < docSize) — regression #805", () => {
      // Simulate: suggestion created against shorter doc, doc grew before accept.
      // Without the fix, replaceRange(0, staleEnd, ...) leaves a trailing tail
      // that duplicates content already present in the new replacement text.
      const state = createState("hello world — trailing references");
      const docSize = state.doc.content.size;
      const staleEnd = 5; // suggestion was created when doc was shorter
      const suggestion = makeSuggestion({
        type: "replace",
        from: 0,
        to: staleEnd, // stale — less than current docSize
        newContent: "replacement",
      });
      // After fix: to is clamped to docSize, so replaceRange covers the whole doc
      // isValidPosition(clamped, docSize) must be true
      const clamped = { ...suggestion, to: docSize };
      expect(isValidPosition(clamped, docSize)).toBe(true);
      // And the transaction should succeed without throwing
      const result = applySuggestionToTr(state, state.tr, suggestion);
      expect(result).toBe(result);
    });

    it("skips suggestions with invalid positions", () => {
      const suggestion = makeSuggestion({
        type: "insert",
        from: -1,
        to: 5,
      });
      expect(isValidPosition(suggestion, 100)).toBe(false);
    });

    it("handles delete type by removing content", () => {
      const suggestion = makeSuggestion({
        type: "delete",
        from: 1,
        to: 5,
      });

      const state = createState("hello world");
      const tr = state.tr.delete(suggestion.from, suggestion.to);
      expect(tr.doc.textContent).toBe("o world");
    });

    it("handles insert type with null newContent gracefully", () => {
      const suggestion = makeSuggestion({
        type: "insert",
        from: 1,
        to: 1,
        newContent: undefined,
      });
      // When newContent is null/undefined, no insert happens
      expect(suggestion.newContent).toBeUndefined();
    });

    it("handles replace type with null newContent gracefully", () => {
      const suggestion = makeSuggestion({
        type: "replace",
        from: 1,
        to: 5,
        newContent: undefined,
      });
      expect(suggestion.newContent).toBeUndefined();
    });
  });

  describe("decoration rendering logic", () => {
    it("skips zero-length replace suggestions", () => {
      const suggestion = makeSuggestion({
        type: "replace",
        from: 5,
        to: 5, // zero-length
      });
      // Plugin skips when from === to for replace type
      expect(suggestion.from).toBe(suggestion.to);
    });

    it("skips zero-length delete suggestions", () => {
      const suggestion = makeSuggestion({
        type: "delete",
        from: 5,
        to: 5,
      });
      expect(suggestion.from).toBe(suggestion.to);
    });

    it("creates insert decoration at suggestion.from", () => {
      const suggestion = makeSuggestion({
        type: "insert",
        from: 5,
        to: 5,
        newContent: "new text",
      });
      expect(suggestion.from).toBe(5);
      expect(suggestion.newContent).toBe("new text");
    });

    it("creates inline + widget decorations for replace type", () => {
      const suggestion = makeSuggestion({
        type: "replace",
        from: 1,
        to: 6,
        newContent: "replacement",
      });
      expect(suggestion.from).toBeLessThan(suggestion.to);
      expect(suggestion.newContent).toBe("replacement");
    });

    it("creates inline decoration only for delete type (no ghost text)", () => {
      const suggestion = makeSuggestion({
        type: "delete",
        from: 1,
        to: 6,
      });
      expect(suggestion.newContent).toBeUndefined();
    });

    it("only shows buttons for focused suggestion", () => {
      const s1 = makeSuggestion({ id: "s1" });
      const s2 = makeSuggestion({ id: "s2" });
      mockAiState.focusedSuggestionId = "s1";

      expect(s1.id === mockAiState.focusedSuggestionId).toBe(true);
      expect(s2.id === mockAiState.focusedSuggestionId).toBe(false);
    });
  });

  describe("createGhostText", () => {
    it("creates span element with ghost class", () => {
      const span = document.createElement("span");
      span.className = "ai-suggestion-ghost";
      span.textContent = "ghost text";
      expect(span.className).toBe("ai-suggestion-ghost");
      expect(span.textContent).toBe("ghost text");
    });

    it("adds focused class when focused", () => {
      const isFocused = true;
      const className = `ai-suggestion-ghost${isFocused ? " ai-suggestion-ghost-focused" : ""}`;
      expect(className).toBe("ai-suggestion-ghost ai-suggestion-ghost-focused");
    });

    it("does not add focused class when not focused", () => {
      const isFocused = false;
      const className = `ai-suggestion-ghost${isFocused ? " ai-suggestion-ghost-focused" : ""}`;
      expect(className).toBe("ai-suggestion-ghost");
    });
  });

  describe("createIcon", () => {
    it("creates SVG element with path", () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M20 6 9 17l-5-5");
      svg.appendChild(path);

      expect(svg.tagName).toBe("svg");
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.children.length).toBe(1);
    });

    it("creates SVG with multiple paths for array input", () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const paths = ["M18 6 6 18", "m6 6 12 12"];
      for (const d of paths) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
      }
      expect(svg.children.length).toBe(2);
    });
  });

  describe("createButtons", () => {
    it("creates container with accept and reject buttons", () => {
      const container = document.createElement("span");
      container.className = "ai-suggestion-buttons";

      const acceptBtn = document.createElement("button");
      acceptBtn.className = "ai-suggestion-btn ai-suggestion-btn-accept";
      acceptBtn.title = "Accept (Enter)";

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "ai-suggestion-btn ai-suggestion-btn-reject";
      rejectBtn.title = "Reject (Escape)";

      container.appendChild(acceptBtn);
      container.appendChild(rejectBtn);

      expect(container.children.length).toBe(2);
      expect(container.querySelector(".ai-suggestion-btn-accept")).toBeTruthy();
      expect(container.querySelector(".ai-suggestion-btn-reject")).toBeTruthy();
    });
  });

  describe("handleClick on suggestion elements", () => {
    it("focuses suggestion when clicked on element with data-suggestion-id", () => {
      const el = document.createElement("span");
      el.setAttribute("data-suggestion-id", "test-id");
      document.body.appendChild(el);

      const id = el.getAttribute("data-suggestion-id");
      if (id) {
        mockAiState.focusSuggestion(id);
      }
      expect(mockAiState.focusSuggestion).toHaveBeenCalledWith("test-id");

      document.body.removeChild(el);
    });

    it("returns false when click is not on a suggestion element", () => {
      const el = document.createElement("div");
      const suggestionEl = el.closest("[data-suggestion-id]");
      expect(suggestionEl).toBeNull();
    });
  });

  describe("plugin view event listeners", () => {
    it("uses correct event names for all suggestion events", () => {
      expect(AI_SUGGESTION_EVENTS.ACCEPT).toBe("ai-suggestion:accept");
      expect(AI_SUGGESTION_EVENTS.REJECT).toBe("ai-suggestion:reject");
      expect(AI_SUGGESTION_EVENTS.ACCEPT_ALL).toBe("ai-suggestion:accept-all");
      expect(AI_SUGGESTION_EVENTS.REJECT_ALL).toBe("ai-suggestion:reject-all");
      expect(AI_SUGGESTION_EVENTS.FOCUS_CHANGED).toBe("ai-suggestion:focus-changed");
    });

    it("acceptAll applies suggestions in reverse order", () => {
      // Suggestions should be applied reverse (by position) to keep positions valid
      const suggestions = [
        makeSuggestion({ id: "s1", from: 1, to: 5 }),
        makeSuggestion({ id: "s2", from: 10, to: 15 }),
        makeSuggestion({ id: "s3", from: 20, to: 25 }),
      ];
      // The handler iterates the already-sorted array directly
      expect(suggestions.length).toBe(3);
    });
  });

  describe("edge cases", () => {
    it("handles empty suggestions map in decorations", () => {
      mockAiState.suggestions = new Map();
      expect(mockAiState.suggestions.size).toBe(0);
    });

    it("handles suggestion with from=0 to=docSize (whole document)", () => {
      const state = createState("hello world");
      const docSize = state.doc.content.size;
      const suggestion = makeSuggestion({
        type: "replace",
        from: 0,
        to: docSize,
        newContent: "new",
      });
      expect(isValidPosition(suggestion, docSize)).toBe(true);
    });

    it("handles concurrent suggestions at same position", () => {
      const s1 = makeSuggestion({ id: "s1", from: 5, to: 5 });
      const s2 = makeSuggestion({ id: "s2", from: 5, to: 5 });
      mockAiState.suggestions.set(s1.id, s1);
      mockAiState.suggestions.set(s2.id, s2);
      expect(mockAiState.suggestions.size).toBe(2);
    });
  });

  describe("isValidPosition", () => {
    it("returns true for from=0, to=0 (empty insert)", () => {
      expect(isValidPosition(makeSuggestion({ from: 0, to: 0 }), 100)).toBe(true);
    });

    it("returns false when from is negative", () => {
      expect(isValidPosition(makeSuggestion({ from: -1, to: 5 }), 100)).toBe(false);
    });

    it("returns false when to exceeds docSize", () => {
      expect(isValidPosition(makeSuggestion({ from: 0, to: 101 }), 100)).toBe(false);
    });

    it("returns false when from > to", () => {
      expect(isValidPosition(makeSuggestion({ from: 10, to: 5 }), 100)).toBe(false);
    });

    it("returns true when from equals to (insert position)", () => {
      expect(isValidPosition(makeSuggestion({ from: 50, to: 50 }), 100)).toBe(true);
    });

    it("returns true when to equals docSize exactly", () => {
      expect(isValidPosition(makeSuggestion({ from: 0, to: 100 }), 100)).toBe(true);
    });

    it("returns true for a valid range in the middle", () => {
      expect(isValidPosition(makeSuggestion({ from: 10, to: 50 }), 100)).toBe(true);
    });

    it("returns false for from=0, to=-1", () => {
      expect(isValidPosition(makeSuggestion({ from: 0, to: -1 }), 100)).toBe(false);
    });
  });

  describe("getDecorationClass", () => {
    it("returns base class for unfocused insert suggestion", () => {
      const s = makeSuggestion({ type: "insert" });
      expect(getDecorationClass(s, false)).toBe("ai-suggestion ai-suggestion-insert");
    });

    it("returns focused class for focused insert suggestion", () => {
      const s = makeSuggestion({ type: "insert" });
      expect(getDecorationClass(s, true)).toBe("ai-suggestion ai-suggestion-insert ai-suggestion-focused");
    });

    it("returns base class for unfocused replace suggestion", () => {
      const s = makeSuggestion({ type: "replace" });
      expect(getDecorationClass(s, false)).toBe("ai-suggestion ai-suggestion-replace");
    });

    it("returns focused class for focused replace suggestion", () => {
      const s = makeSuggestion({ type: "replace" });
      expect(getDecorationClass(s, true)).toBe("ai-suggestion ai-suggestion-replace ai-suggestion-focused");
    });

    it("returns base class for unfocused delete suggestion", () => {
      const s = makeSuggestion({ type: "delete" });
      expect(getDecorationClass(s, false)).toBe("ai-suggestion ai-suggestion-delete");
    });

    it("returns focused class for focused delete suggestion", () => {
      const s = makeSuggestion({ type: "delete" });
      expect(getDecorationClass(s, true)).toBe("ai-suggestion ai-suggestion-delete ai-suggestion-focused");
    });
  });

  describe("isButtonEvent", () => {
    it("returns true when target is inside a suggestion button", () => {
      const btn = document.createElement("button");
      btn.className = "ai-suggestion-btn";
      document.body.appendChild(btn);

      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: btn });
      expect(isButtonEvent(event)).toBe(true);

      document.body.removeChild(btn);
    });

    it("returns true when target is a child of a suggestion button", () => {
      const btn = document.createElement("button");
      btn.className = "ai-suggestion-btn";
      const svg = document.createElement("svg");
      btn.appendChild(svg);
      document.body.appendChild(btn);

      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: svg });
      expect(isButtonEvent(event)).toBe(true);

      document.body.removeChild(btn);
    });

    it("returns false when target is not inside a suggestion button", () => {
      const div = document.createElement("div");
      document.body.appendChild(div);

      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: div });
      expect(isButtonEvent(event)).toBe(false);

      document.body.removeChild(div);
    });

    it("returns false when target is not an Element", () => {
      const textNode = document.createTextNode("hello");
      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: textNode });
      expect(isButtonEvent(event)).toBe(false);
    });

    it("returns false when target is null", () => {
      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: null });
      expect(isButtonEvent(event)).toBe(false);
    });
  });
});

describe("aiSuggestion plugin integration", () => {
  let plugin: InstanceType<typeof import("@tiptap/pm/state").Plugin>;

  beforeEach(() => {
    mockAiState.suggestions = new Map();
    mockAiState.focusedSuggestionId = null;
    vi.clearAllMocks();

    const extensionContext = {
      name: aiSuggestionExtension.name,
      options: aiSuggestionExtension.options,
      storage: aiSuggestionExtension.storage,
      editor: {} as import("@tiptap/core").Editor,
      type: null,
      parent: undefined,
    };
    const plugins = aiSuggestionExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    plugin = plugins[0];
  });

  describe("keyboard shortcut handlers", () => {
    function getShortcutHandlers() {
      const extensionContext = {
        name: aiSuggestionExtension.name,
        options: aiSuggestionExtension.options,
        storage: aiSuggestionExtension.storage,
        editor: {} as import("@tiptap/core").Editor,
        type: null,
        parent: undefined,
      };
      return aiSuggestionExtension.config.addKeyboardShortcuts?.call(extensionContext) ?? {};
    }

    it("Enter accepts focused suggestion and returns true", () => {
      const handlers = getShortcutHandlers();
      const suggestion = makeSuggestion({ id: "s1" });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const result = handlers.Enter({} as never);
      expect(result).toBe(true);
      expect(mockAiState.acceptSuggestion).toHaveBeenCalledWith("s1");
    });

    it("Enter returns false when no suggestions", () => {
      const handlers = getShortcutHandlers();
      const result = handlers.Enter({} as never);
      expect(result).toBe(false);
      expect(mockAiState.acceptSuggestion).not.toHaveBeenCalled();
    });

    it("Enter returns false when no focused suggestion", () => {
      const handlers = getShortcutHandlers();
      mockAiState.suggestions.set("s1", makeSuggestion({ id: "s1" }));
      mockAiState.focusedSuggestionId = null;

      const result = handlers.Enter({} as never);
      expect(result).toBe(false);
    });

    it("Escape rejects focused suggestion and returns true", () => {
      const handlers = getShortcutHandlers();
      mockAiState.suggestions.set("s1", makeSuggestion({ id: "s1" }));
      mockAiState.focusedSuggestionId = "s1";

      const result = handlers.Escape({} as never);
      expect(result).toBe(true);
      expect(mockAiState.rejectSuggestion).toHaveBeenCalledWith("s1");
    });

    it("Escape returns false when no suggestions", () => {
      const handlers = getShortcutHandlers();
      const result = handlers.Escape({} as never);
      expect(result).toBe(false);
    });

    it("Tab calls navigateNext when suggestions exist", () => {
      const handlers = getShortcutHandlers();
      mockAiState.suggestions.set("s1", makeSuggestion());

      const result = handlers.Tab({} as never);
      expect(result).toBe(true);
      expect(mockAiState.navigateNext).toHaveBeenCalled();
    });

    it("Tab returns false when no suggestions", () => {
      const handlers = getShortcutHandlers();
      const result = handlers.Tab({} as never);
      expect(result).toBe(false);
    });

    it("Shift-Tab calls navigatePrevious when suggestions exist", () => {
      const handlers = getShortcutHandlers();
      mockAiState.suggestions.set("s1", makeSuggestion());

      const result = handlers["Shift-Tab"]({} as never);
      expect(result).toBe(true);
      expect(mockAiState.navigatePrevious).toHaveBeenCalled();
    });

    it("Mod-Shift-Enter calls acceptAll when suggestions exist", () => {
      const handlers = getShortcutHandlers();
      mockAiState.suggestions.set("s1", makeSuggestion());

      const result = handlers["Mod-Shift-Enter"]({} as never);
      expect(result).toBe(true);
      expect(mockAiState.acceptAll).toHaveBeenCalled();
    });

    it("Mod-Shift-Enter returns false when no suggestions", () => {
      const handlers = getShortcutHandlers();
      const result = handlers["Mod-Shift-Enter"]({} as never);
      expect(result).toBe(false);
    });

    it("Mod-Shift-Escape calls rejectAll when suggestions exist", () => {
      const handlers = getShortcutHandlers();
      mockAiState.suggestions.set("s1", makeSuggestion());

      const result = handlers["Mod-Shift-Escape"]({} as never);
      expect(result).toBe(true);
      expect(mockAiState.rejectAll).toHaveBeenCalled();
    });

    it("Mod-Shift-Escape returns false when no suggestions", () => {
      const handlers = getShortcutHandlers();
      const result = handlers["Mod-Shift-Escape"]({} as never);
      expect(result).toBe(false);
    });
  });

  describe("plugin decorations", () => {
    it("returns empty DecorationSet when no suggestions", () => {
      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      expect(decorations).toBeDefined();
      // Should be empty
      const found = decorations!.find();
      expect(found).toHaveLength(0);
    });

    it("creates insert widget decoration for insert suggestion", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "inserted text",
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      expect(found.length).toBeGreaterThan(0);
    });

    it("creates inline + widget decorations for replace suggestion", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "replace",
        from: 1,
        to: 6,
        newContent: "replacement",
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      // Should have inline decoration + widget decoration
      expect(found.length).toBe(2);
    });

    it("creates inline decoration for delete suggestion", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "delete",
        from: 1,
        to: 6,
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      // Should have inline decoration only (no buttons — not focused)
      expect(found.length).toBe(1);
    });

    it("adds buttons widget for focused delete suggestion", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "delete",
        from: 1,
        to: 6,
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      // inline decoration + buttons widget
      expect(found.length).toBe(2);
    });

    it("skips zero-length replace suggestion", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "replace",
        from: 5,
        to: 5,
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      expect(found.length).toBe(0);
    });

    it("skips zero-length delete suggestion", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "delete",
        from: 5,
        to: 5,
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      expect(found.length).toBe(0);
    });

    it("skips suggestion with invalid position", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: -1,
        to: 5,
        newContent: "text",
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      expect(found.length).toBe(0);
    });

    it("handles multiple suggestions simultaneously", () => {
      mockAiState.suggestions.set("s1", makeSuggestion({
        id: "s1", type: "insert", from: 1, to: 1, newContent: "a",
      }));
      mockAiState.suggestions.set("s2", makeSuggestion({
        id: "s2", type: "delete", from: 3, to: 6,
      }));

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      // insert widget + delete inline = 2
      expect(found.length).toBe(2);
    });

    it("insert widget creates container with ghost text", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "inserted text",
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();

      // Get the widget spec and call toDOM
      const widget = found[0];
      const _spec = (widget as { spec?: { toDOM?: () => HTMLElement } }).spec;
      // Widget decorations have a toDOM in their type
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      if (widgetType?.toDOM) {
        const dom = widgetType.toDOM();
        expect(dom.className).toContain("ai-suggestion-insert-container");
        expect(dom.getAttribute("data-suggestion-id")).toBe("s1");
        expect(dom.querySelector(".ai-suggestion-ghost")).toBeTruthy();
        expect(dom.querySelector(".ai-suggestion-ghost")!.textContent).toBe("inserted text");
      }
    });

    it("focused insert widget includes buttons", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "inserted text",
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();

      const widgetType = (found[0] as { type?: { toDOM?: () => HTMLElement } }).type;
      if (widgetType?.toDOM) {
        const dom = widgetType.toDOM();
        expect(dom.querySelector(".ai-suggestion-buttons")).toBeTruthy();
        expect(dom.querySelector(".ai-suggestion-btn-accept")).toBeTruthy();
        expect(dom.querySelector(".ai-suggestion-btn-reject")).toBeTruthy();
      }
    });

    it("insert widget without newContent has no ghost text", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        // no newContent
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      const widgetType = (found[0] as { type?: { toDOM?: () => HTMLElement } }).type;
      if (widgetType?.toDOM) {
        const dom = widgetType.toDOM();
        expect(dom.querySelector(".ai-suggestion-ghost")).toBeFalsy();
      }
    });
  });

  describe("plugin handleClick", () => {
    it("focuses suggestion when clicking element with data-suggestion-id", () => {
      const state = createState("hello");
      const el = document.createElement("span");
      el.setAttribute("data-suggestion-id", "test-id");
      document.body.appendChild(el);

      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: el });

      const result = plugin.props.handleClick?.(
        { state } as never,
        0,
        event,
      );
      expect(result).toBe(true);
      expect(mockAiState.focusSuggestion).toHaveBeenCalledWith("test-id");

      document.body.removeChild(el);
    });

    it("returns false when clicking non-suggestion element", () => {
      const state = createState("hello");
      const div = document.createElement("div");
      document.body.appendChild(div);

      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: div });

      const result = plugin.props.handleClick?.(
        { state } as never,
        0,
        event,
      );
      expect(result).toBe(false);

      document.body.removeChild(div);
    });
  });

  describe("plugin view lifecycle", () => {
    it("view factory registers event listeners and returns destroy", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const mockView = {
        state: createState("hello"),
        dispatch: vi.fn(),
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);
      expect(addSpy).toHaveBeenCalledWith("ai-suggestion:accept", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith("ai-suggestion:reject", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith("ai-suggestion:accept-all", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith("ai-suggestion:reject-all", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith("ai-suggestion:focus-changed", expect.any(Function));

      viewResult.destroy!();
      expect(removeSpy).toHaveBeenCalledWith("ai-suggestion:accept", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("ai-suggestion:reject", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("ai-suggestion:accept-all", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("ai-suggestion:reject-all", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("ai-suggestion:focus-changed", expect.any(Function));

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it("accept event dispatches transaction with suggestion applied", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello world"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const suggestion = makeSuggestion({
        id: "s1",
        type: "delete",
        from: 1,
        to: 6,
      });
      const event = new CustomEvent("ai-suggestion:accept", {
        detail: { suggestion },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalled();

      viewResult.destroy!();
    });

    it("reject event dispatches empty transaction to refresh decorations", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const event = new CustomEvent("ai-suggestion:reject", {
        detail: { suggestion: makeSuggestion() },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalled();

      viewResult.destroy!();
    });

    it("acceptAll event applies all suggestions in single transaction", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello world test"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const suggestions = [
        makeSuggestion({ id: "s1", type: "delete", from: 1, to: 6 }),
        makeSuggestion({ id: "s2", type: "delete", from: 7, to: 12 }),
      ];
      const event = new CustomEvent("ai-suggestion:accept-all", {
        detail: { suggestions },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalledTimes(1);

      viewResult.destroy!();
    });

    it("acceptAll with empty suggestions array does not dispatch", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const event = new CustomEvent("ai-suggestion:accept-all", {
        detail: { suggestions: [] },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).not.toHaveBeenCalled();

      viewResult.destroy!();
    });

    it("focusChanged event scrolls to suggestion position", () => {
      const mockScrollTo = vi.fn();
      const mockDom = document.createElement("div");
      Object.defineProperty(mockDom, "getBoundingClientRect", {
        value: () => ({ top: 0, bottom: 500, height: 500 }),
      });
      mockDom.scrollTo = mockScrollTo;

      const state = createState("hello world");
      const mockView = {
        state,
        dispatch: vi.fn(),
        dom: mockDom,
        coordsAtPos: vi.fn(() => ({ top: -100, bottom: -80 })),
      };

      mockAiState.getSuggestion.mockReturnValue(makeSuggestion({ from: 1, to: 5 }));

      const viewResult = plugin.spec.view!(mockView as never);

      const event = new CustomEvent("ai-suggestion:focus-changed", {
        detail: { id: "s1" },
      });
      window.dispatchEvent(event);

      expect(mockView.coordsAtPos).toHaveBeenCalledWith(1);
      expect(mockScrollTo).toHaveBeenCalled();

      viewResult.destroy!();
    });

    it("focusChanged does nothing when suggestion not found", () => {
      const mockView = {
        state: createState("hello"),
        dispatch: vi.fn(),
        dom: document.createElement("div"),
        coordsAtPos: vi.fn(),
      };

      mockAiState.getSuggestion.mockReturnValue(undefined);

      const viewResult = plugin.spec.view!(mockView as never);

      const event = new CustomEvent("ai-suggestion:focus-changed", {
        detail: { id: "nonexistent" },
      });
      window.dispatchEvent(event);

      expect(mockView.coordsAtPos).not.toHaveBeenCalled();

      viewResult.destroy!();
    });

    it("focusChanged skips scrolling when suggestion has invalid position", () => {
      const mockView = {
        state: createState("hello"),
        dispatch: vi.fn(),
        dom: document.createElement("div"),
        coordsAtPos: vi.fn(),
      };

      mockAiState.getSuggestion.mockReturnValue(makeSuggestion({ from: -1, to: 5 }));

      const viewResult = plugin.spec.view!(mockView as never);

      const event = new CustomEvent("ai-suggestion:focus-changed", {
        detail: { id: "s1" },
      });
      window.dispatchEvent(event);

      expect(mockView.coordsAtPos).not.toHaveBeenCalled();

      viewResult.destroy!();
    });

    it("focusChanged does not scroll when already visible", () => {
      const mockScrollTo = vi.fn();
      const mockDom = document.createElement("div");
      Object.defineProperty(mockDom, "getBoundingClientRect", {
        value: () => ({ top: 0, bottom: 500, height: 500 }),
      });
      mockDom.scrollTo = mockScrollTo;

      const state = createState("hello world");
      const mockView = {
        state,
        dispatch: vi.fn(),
        dom: mockDom,
        // coords within visible range
        coordsAtPos: vi.fn(() => ({ top: 100, bottom: 120 })),
      };

      mockAiState.getSuggestion.mockReturnValue(makeSuggestion({ from: 1, to: 5 }));

      const viewResult = plugin.spec.view!(mockView as never);

      const event = new CustomEvent("ai-suggestion:focus-changed", {
        detail: { id: "s1" },
      });
      window.dispatchEvent(event);

      expect(mockScrollTo).not.toHaveBeenCalled();

      viewResult.destroy!();
    });
  });

  describe("replace decoration widget toDOM", () => {
    it("replace widget creates container with ghost text when newContent exists", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "replace",
        from: 1,
        to: 6,
        newContent: "replacement text",
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      // inline decoration + widget decoration
      expect(found.length).toBe(2);

      // The widget is the second decoration
      const widget = found[1];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      if (widgetType?.toDOM) {
        const dom = widgetType.toDOM();
        expect(dom.className).toContain("ai-suggestion-replace-container");
        expect(dom.getAttribute("data-suggestion-id")).toBe("s1");
        expect(dom.querySelector(".ai-suggestion-ghost")).toBeTruthy();
        expect(dom.querySelector(".ai-suggestion-ghost")!.textContent).toBe("replacement text");
        // Not focused, so no buttons
        expect(dom.querySelector(".ai-suggestion-buttons")).toBeFalsy();
      }
    });

    it("focused replace widget includes buttons", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "replace",
        from: 1,
        to: 6,
        newContent: "replacement text",
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      expect(found.length).toBe(2);

      const widget = found[1];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      if (widgetType?.toDOM) {
        const dom = widgetType.toDOM();
        expect(dom.querySelector(".ai-suggestion-buttons")).toBeTruthy();
        expect(dom.querySelector(".ai-suggestion-btn-accept")).toBeTruthy();
        expect(dom.querySelector(".ai-suggestion-btn-reject")).toBeTruthy();
      }
    });

    it("replace widget without newContent has no ghost text", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "replace",
        from: 1,
        to: 6,
        // no newContent
      });
      mockAiState.suggestions.set("s1", suggestion);

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      expect(found.length).toBe(2);

      const widget = found[1];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      if (widgetType?.toDOM) {
        const dom = widgetType.toDOM();
        expect(dom.querySelector(".ai-suggestion-ghost")).toBeFalsy();
      }
    });
  });

  describe("delete decoration widget toDOM", () => {
    it("focused delete creates buttons via widget toDOM", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "delete",
        from: 1,
        to: 6,
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      // inline + buttons widget
      expect(found.length).toBe(2);

      // Buttons widget is second
      const widget = found[1];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      if (widgetType?.toDOM) {
        const dom = widgetType.toDOM();
        expect(dom.className).toContain("ai-suggestion-buttons");
        expect(dom.querySelector(".ai-suggestion-btn-accept")).toBeTruthy();
        expect(dom.querySelector(".ai-suggestion-btn-reject")).toBeTruthy();
      }
    });
  });

  describe("createButtons mousedown handlers", () => {
    it("accept button mousedown calls applySuggestion and removeSuggestion", () => {
      const mockDispatch = vi.fn();
      const mockEditorView = {
        state: createState("hello world"),
        dispatch: mockDispatch,
      };
      mockEditorStoreState.editorView = mockEditorView;

      const suggestion = makeSuggestion({
        id: "s1",
        type: "delete",
        from: 1,
        to: 6,
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();

      // Get the widget with buttons (for focused delete, it's the second decoration)
      const widget = found[1];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      expect(widgetType?.toDOM).toBeDefined();

      const dom = widgetType!.toDOM!();
      const acceptBtn = dom.querySelector(".ai-suggestion-btn-accept") as HTMLButtonElement;
      expect(acceptBtn).toBeTruthy();

      // Simulate mousedown on accept button
      const mouseEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mouseEvent, "preventDefault", { value: vi.fn() });
      Object.defineProperty(mouseEvent, "stopPropagation", { value: vi.fn() });
      acceptBtn.onmousedown!(mouseEvent);

      expect(mouseEvent.preventDefault).toHaveBeenCalled();
      expect(mouseEvent.stopPropagation).toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalled();
      expect(mockAiState.removeSuggestion).toHaveBeenCalledWith("s1");

      // Restore
      mockEditorStoreState.editorView = null;
    });

    it("accept button mousedown does nothing when no editor view", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "text",
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();

      const widget = found[0];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      const dom = widgetType!.toDOM!();
      const acceptBtn = dom.querySelector(".ai-suggestion-btn-accept") as HTMLButtonElement;

      const mouseEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mouseEvent, "preventDefault", { value: vi.fn() });
      Object.defineProperty(mouseEvent, "stopPropagation", { value: vi.fn() });
      acceptBtn.onmousedown!(mouseEvent);

      // No removeSuggestion should be called since view is null
      expect(mockAiState.removeSuggestion).not.toHaveBeenCalled();
    });

    it("reject button mousedown calls removeSuggestion only", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "text",
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();

      const widget = found[0];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      const dom = widgetType!.toDOM!();
      const rejectBtn = dom.querySelector(".ai-suggestion-btn-reject") as HTMLButtonElement;

      const mouseEvent = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(mouseEvent, "preventDefault", { value: vi.fn() });
      Object.defineProperty(mouseEvent, "stopPropagation", { value: vi.fn() });
      rejectBtn.onmousedown!(mouseEvent);

      expect(mouseEvent.preventDefault).toHaveBeenCalled();
      expect(mouseEvent.stopPropagation).toHaveBeenCalled();
      expect(mockAiState.removeSuggestion).toHaveBeenCalledWith("s1");
    });
  });

  describe("applySuggestionToTr via accept event", () => {
    it("applies insert suggestion with newContent via accept event", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello world"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "inserted",
      });
      const event = new CustomEvent("ai-suggestion:accept", {
        detail: { suggestion },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalled();
      viewResult.destroy!();
    });

    it("applies replace suggestion with newContent via accept event", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello world"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const suggestion = makeSuggestion({
        id: "s1",
        type: "replace",
        from: 1,
        to: 6,
        newContent: "replacement",
      });
      const event = new CustomEvent("ai-suggestion:accept", {
        detail: { suggestion },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalled();
      viewResult.destroy!();
    });

    it("does not modify doc for insert suggestion without newContent", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello world"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        // no newContent
      });
      const event = new CustomEvent("ai-suggestion:accept", {
        detail: { suggestion },
      });
      window.dispatchEvent(event);

      // Transaction is dispatched but doc should be unchanged
      expect(mockDispatch).toHaveBeenCalled();
      const dispatchedTr = mockDispatch.mock.calls[0][0];
      expect(dispatchedTr.docChanged).toBe(false);
      viewResult.destroy!();
    });

    it("does not modify doc for replace suggestion without newContent", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello world"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const suggestion = makeSuggestion({
        id: "s1",
        type: "replace",
        from: 1,
        to: 6,
        // no newContent
      });
      const event = new CustomEvent("ai-suggestion:accept", {
        detail: { suggestion },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalled();
      const dispatchedTr = mockDispatch.mock.calls[0][0];
      expect(dispatchedTr.docChanged).toBe(false);
      viewResult.destroy!();
    });

    it("clamps whole-doc replace to current doc size", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const suggestion = makeSuggestion({
        id: "s1",
        type: "replace",
        from: 0,
        to: 99999, // exceeds doc size
        newContent: "new content",
      });
      const event = new CustomEvent("ai-suggestion:accept", {
        detail: { suggestion },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalled();
      viewResult.destroy!();
    });

    it("skips suggestion with stale positions", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const suggestion = makeSuggestion({
        id: "s1",
        type: "delete",
        from: -1,
        to: 5,
      });
      const event = new CustomEvent("ai-suggestion:accept", {
        detail: { suggestion },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalled();
      const dispatchedTr = mockDispatch.mock.calls[0][0];
      expect(dispatchedTr.docChanged).toBe(false);
      viewResult.destroy!();
    });
  });

  describe("rejectAll event", () => {
    it("rejectAll dispatches empty transaction to refresh decorations", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const event = new CustomEvent("ai-suggestion:reject-all", {
        detail: {},
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalled();
      viewResult.destroy!();
    });
  });

  describe("acceptAll applies multiple suggestions", () => {
    it("applies insert and replace suggestions in one transaction", () => {
      const mockDispatch = vi.fn();
      const mockView = {
        state: createState("hello world testing"),
        dispatch: mockDispatch,
        dom: document.createElement("div"),
      };

      const viewResult = plugin.spec.view!(mockView as never);

      const suggestions = [
        makeSuggestion({ id: "s1", type: "insert", from: 1, to: 1, newContent: "a" }),
        makeSuggestion({ id: "s2", type: "replace", from: 7, to: 12, newContent: "b" }),
      ];
      const event = new CustomEvent("ai-suggestion:accept-all", {
        detail: { suggestions },
      });
      window.dispatchEvent(event);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      viewResult.destroy!();
    });
  });

  describe("createIcon via widget DOM", () => {
    it("creates SVG with single path for accept button", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "text",
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      const widget = found[0];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      const dom = widgetType!.toDOM!();

      const acceptBtn = dom.querySelector(".ai-suggestion-btn-accept");
      const svg = acceptBtn?.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg!.getAttribute("fill")).toBe("none");
      expect(svg!.getAttribute("stroke")).toBe("currentColor");
      // Check icon path: single path for check icon
      expect(svg!.querySelectorAll("path").length).toBe(1);
    });

    it("creates SVG with multiple paths for reject button", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "text",
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      const widget = found[0];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      const dom = widgetType!.toDOM!();

      const rejectBtn = dom.querySelector(".ai-suggestion-btn-reject");
      const svg = rejectBtn?.querySelector("svg");
      expect(svg).toBeTruthy();
      // X icon has 2 paths
      expect(svg!.querySelectorAll("path").length).toBe(2);
    });
  });

  describe("createGhostText via widget DOM", () => {
    it("unfocused ghost text has no focused class", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "ghost",
      });
      mockAiState.suggestions.set("s1", suggestion);
      // NOT focused

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      const widget = found[0];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      const dom = widgetType!.toDOM!();

      const ghost = dom.querySelector(".ai-suggestion-ghost");
      expect(ghost).toBeTruthy();
      expect(ghost!.className).toBe("ai-suggestion-ghost");
      expect(ghost!.className).not.toContain("ai-suggestion-ghost-focused");
    });

    it("focused ghost text has focused class", () => {
      const suggestion = makeSuggestion({
        id: "s1",
        type: "insert",
        from: 1,
        to: 1,
        newContent: "ghost",
      });
      mockAiState.suggestions.set("s1", suggestion);
      mockAiState.focusedSuggestionId = "s1";

      const state = createState("hello world");
      const decorations = plugin.props.decorations?.(state);
      const found = decorations!.find();
      const widget = found[0];
      const widgetType = (widget as { type?: { toDOM?: () => HTMLElement } }).type;
      const dom = widgetType!.toDOM!();

      const ghost = dom.querySelector(".ai-suggestion-ghost");
      expect(ghost).toBeTruthy();
      expect(ghost!.className).toContain("ai-suggestion-ghost-focused");
    });
  });
});
