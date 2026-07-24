// WI-3.2 — re-covers useViewShortcuts' behavior after migration onto the registry:
// the 18 view mappings, input-suppression, and the terminal-toggle exemption.
import { describe, it, expect } from "vitest";
import { KEYBINDINGS } from "./keybindingDefinitions";
import type { Binding, BindingContext } from "./bindingRegistry";

function byShortcut(id: string): Binding {
  const b = KEYBINDINGS.find(
    (x) => "shortcutId" in x && x.shortcutId === id,
  );
  if (!b) throw new Error(`no binding for shortcut ${id}`);
  return b;
}

const inputCtx: BindingContext = { activeScopes: ["window", "input"] };
const windowCtx: BindingContext = { activeScopes: ["window"] };
const editorCtx: BindingContext = { activeScopes: ["window", "editor-wysiwyg"] };

// The exact useViewShortcuts action → command mapping (behavior contract).
const VIEW_MAP: Array<[string, string]> = [
  ["toggleTerminal", "view.toggleTerminal"],
  ["sourceMode", "view.toggleSourceMode"],
  ["focusMode", "view.toggleFocusMode"],
  ["typewriterMode", "view.toggleTypewriterMode"],
  ["wordWrap", "view.toggleWordWrap"],
  ["lineNumbers", "view.toggleLineNumbers"],
  ["readOnly", "view.toggleReadOnly"],
  ["fitTables", "view.toggleFitTables"],
  ["validateMarkdown", "lint.check"],
  ["lintNext", "lint.next"],
  ["lintPrev", "lint.prev"],
  ["toggleSidebar", "view.toggleSidebar"],
  ["toggleOutline", "view.toggleOutline"],
  ["fileExplorer", "view.toggleFileExplorer"],
  ["viewHistory", "view.toggleHistory"],
  ["knowledgeBase", "view.toggleKnowledgeBase"],
  ["markdownSplit", "view.toggleMarkdownSplit"],
  ["splitDocuments", "view.toggleSplitDocuments"],
];

describe("KEYBINDINGS — view shortcut migration (WI-3.2)", () => {
  it("maps every view shortcut to its exact command (1:1 contract)", () => {
    for (const [shortcutId, commandId] of VIEW_MAP) {
      const b = byShortcut(shortcutId);
      expect(b.kind).toBe("command");
      expect(b.kind === "command" && b.commandId).toBe(commandId);
      expect(b.captureOwner).toBe("window");
      expect(b.ime).toBe("chord-exempt"); // command chords, IME-false-positive-exempt
    }
  });

  it("suppresses view shortcuts in a plain input, but NOT in the editor", () => {
    const b = byShortcut("sourceMode");
    expect(b.when?.(inputCtx)).toBe(false); // suppressed while input focused
    expect(b.when?.(windowCtx)).toBe(true);
    expect(b.when?.(editorCtx)).toBe(true); // fires in the editor (editor scope, not input)
  });

  it("the terminal toggle fires everywhere, including inputs (no suppression)", () => {
    const term = byShortcut("toggleTerminal");
    expect(term.when).toBeUndefined(); // no input guard → runs even in an input
  });

  it("the 3 global overlays are present and IME-blocked", () => {
    for (const id of ["commandPalette", "contentSearch", "quickOpen"]) {
      const b = byShortcut(id);
      expect(b.ime).toBe("block");
      expect(b.when).toBeUndefined(); // global, no scope guard
    }
  });

  it("has the 3 global + 18 view + 2 explorer + 1 containment bindings", () => {
    expect(KEYBINDINGS).toHaveLength(24);
  });
});

describe("KEYBINDINGS — select-all containment (WI-3.5)", () => {
  const containment = KEYBINDINGS.find((b) => b.kind === "containment")!;

  it("is a capture-phase containment binding with no command", () => {
    expect(containment).toBeDefined();
    expect(containment.kind).toBe("containment");
    expect(containment.windowPhase).toBe("capture");
    expect("commandId" in containment).toBe(false);
    expect(containment.consumption).toBe("preventDefault"); // NOT preventAndStop
  });

  it("fires (blocks browser select-all) ONLY when focus is not text-editable", () => {
    // Bare window (nothing editable focused) → guard applies.
    expect(containment.when?.({ activeScopes: ["window"] })).toBe(true);
    // Editor / input / terminal focused → do nothing (editor's own select-all).
    for (const s of ["editor-wysiwyg", "editor-source", "input", "terminal"] as const) {
      expect(containment.when?.({ activeScopes: ["window", s] })).toBe(false);
    }
  });
});
