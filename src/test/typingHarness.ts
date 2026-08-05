/**
 * Production-stack typing harness (WI-1.2, plan ADR-3).
 *
 * Purpose: drive a REAL Tiptap Editor — built from the production extension
 * factory (`createTiptapExtensions`), so the production schema, input rules,
 * keymaps, `handleDOMEvents` and history are all live — with simulated
 * typing, in jsdom, with no React and no mount.
 *
 * Why this exists: unit tests that call plugin handlers directly, or build
 * private mini-schemas, prove nothing about the shipped wiring — the autoPair
 * `code_block`/`codeBlock` defect (WI-1.1) lived exactly in that gap, and
 * `detailsBlock.test.ts` documents an input-rule return-value contract bug
 * that direct handler calls could not catch. This harness routes input the
 * way the editor does:
 *   - each typed character first fires a real keydown on `view.dom` (the
 *     browser's order — autoPair's closing-bracket type-over lives there),
 *     then goes through `view.someProp("handleTextInput")` (the path Tiptap
 *     input rules and autoPair hook), falling back to a plain
 *     `tr.insertText` — the default the browser would produce — when no
 *     handler claims the character;
 *   - keys are dispatched as real `KeyboardEvent`s on `view.dom`, so keymaps
 *     AND `handleDOMEvents.keydown` plugins (listBackspace) both see them;
 *     `keyboardShortcut()` would bypass the latter (its own test says so).
 *
 * Limits (deliberate): jsdom has no real composition or DOM mutation
 * observation — IME belongs to the WebKit tier (WI-1.4) and the app journey
 * (WI-1.5), not here.
 *
 * @coordinates-with src/services/assembly/tiptapExtensions.ts — the stack under test
 * @coordinates-with src/test/productionSchema.ts — same factory, schema-only
 * @coordinates-with src/plugins/autoPair/backtickToggle.ts — module state reset per session
 * @module test/typingHarness
 */
import { Editor, type Extensions } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { createTiptapExtensions } from "@/services/assembly/tiptapExtensions";
import { resetBacktickState } from "@/plugins/autoPair/backtickToggle";
import { serializeMarkdown, parseMarkdown } from "@/utils/markdownPipeline/adapter";

/** Named keys the harness can press, with their DOM event fields. */
const KEYS: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Space: { key: " ", code: "Space", keyCode: 32 },
};

type HarnessKey = keyof typeof KEYS;

export interface TypingSession {
  readonly editor: Editor;
  /** Feed text character-by-character through the production input path.
   *  Returns how many characters an input handler claimed. */
  type(text: string): number;
  /** Dispatch a real KeyboardEvent for `key` (optionally shift) on the view.
   *  Returns true when something handled it (preventDefault was called). */
  press(key: HarnessKey, mods?: { shift?: boolean }): boolean;
  /** Place the caret at an absolute ProseMirror position. */
  setCursor(pos: number): void;
  /** Select an absolute ProseMirror range. */
  select(from: number, to: number): void;
  /** Caret (head) position. */
  caret(): number;
  /** Serialize the current doc with the production serializer. */
  markdown(): string;
  /** History undo/redo through the editor's own commands. */
  undo(): boolean;
  redo(): boolean;
  destroy(): void;
}

export interface SessionOptions {
  /** Markdown to load as the initial document (via the production parser). */
  markdown?: string;
  /** Extension override — tests of a reduced stack must say so explicitly. */
  extensions?: Extensions;
}

/** Reset cross-editor module state that plugins keep at module scope. */
function resetPluginModuleState(): void {
  // autoPair's consecutive-backtick machine is module-global; without this a
  // previous session's backtick count leaks into the next editor instance.
  resetBacktickState();
}

export function createTypingSession(options: SessionOptions = {}): TypingSession {
  resetPluginModuleState();
  const editor = new Editor({
    extensions: options.extensions ?? createTiptapExtensions(),
  });
  if (options.markdown !== undefined) {
    const doc = parseMarkdown(editor.schema, options.markdown);
    editor.commands.setContent(doc.toJSON());
  }

  const view = () => editor.view;

  const session: TypingSession = {
    editor,

    type(text: string): number {
      let handledCount = 0;
      for (const ch of text) {
        // Browser order: keydown fires BEFORE any text input, and a handler
        // that preventDefault()s it (autoPair's closing-bracket type-over
        // lives there, via keyHandler.ts) consumes the character entirely.
        const keydown = new KeyboardEvent("keydown", {
          key: ch,
          bubbles: true,
          cancelable: true,
        });
        view().dom.dispatchEvent(keydown);
        if (keydown.defaultPrevented) {
          handledCount += 1;
          continue;
        }
        const { from, to } = view().state.selection;
        const handled = Boolean(
          view().someProp("handleTextInput", (f) => f(view(), from, to, ch)),
        );
        if (handled) {
          handledCount += 1;
        } else {
          // The browser default for unclaimed text input: insert at the
          // selection, carrying stored marks — same as ProseMirror's own
          // DOM-change path.
          view().dispatch(view().state.tr.insertText(ch, from, to));
        }
      }
      return handledCount;
    },

    press(key: HarnessKey, mods: { shift?: boolean } = {}): boolean {
      const spec = KEYS[key];
      if (!spec) throw new Error(`typingHarness: unknown key "${String(key)}"`);
      const event = new KeyboardEvent("keydown", {
        key: spec.key,
        code: spec.code,
        keyCode: spec.keyCode,
        shiftKey: Boolean(mods.shift),
        bubbles: true,
        cancelable: true,
      });
      view().dom.dispatchEvent(event);
      if (!event.defaultPrevented && (key === "Backspace" || key === "Delete")) {
        // Faithful to the real pipeline: ProseMirror's keymap deliberately
        // does NOT claim plain character deletion — the BROWSER mutates the
        // DOM and the DOMObserver reconciles. jsdom has no such default, so
        // the harness supplies it, code-point-aware (never split a surrogate
        // pair).
        applyDeletionDefault(view(), key);
      }
      return event.defaultPrevented;
    },

    setCursor(pos: number): void {
      const state = view().state;
      view().dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    },

    select(from: number, to: number): void {
      const state = view().state;
      view().dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    },

    caret(): number {
      return view().state.selection.head;
    },

    markdown(): string {
      return serializeMarkdown(editor.schema, view().state.doc);
    },

    undo(): boolean {
      return editor.commands.undo();
    },

    redo(): boolean {
      return editor.commands.redo();
    },

    destroy(): void {
      editor.destroy();
      resetPluginModuleState();
    },
  };
  return session;
}

/** The browser's default for an unclaimed Backspace/Delete keydown. */
function applyDeletionDefault(view: Editor["view"], key: "Backspace" | "Delete"): void {
  const { state } = view;
  const { from, to, empty } = state.selection;
  if (!empty) {
    view.dispatch(state.tr.delete(from, to));
    return;
  }
  const $pos = state.doc.resolve(from);
  if (key === "Backspace") {
    if ($pos.parentOffset === 0) return; // block-boundary deletes are keymap territory
    const before = $pos.parent.textBetween(
      Math.max(0, $pos.parentOffset - 2),
      $pos.parentOffset,
      " ",
    );
    const width = /[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(before) ? 2 : 1;
    view.dispatch(state.tr.delete(from - width, from));
  } else {
    if ($pos.parentOffset >= $pos.parent.content.size) return;
    const after = $pos.parent.textBetween(
      $pos.parentOffset,
      Math.min($pos.parent.content.size, $pos.parentOffset + 2),
      " ",
    );
    const width = /^[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(after) ? 2 : 1;
    view.dispatch(state.tr.delete(from, from + width));
  }
}

/** Run `fn` with a session, guaranteeing teardown — the common test shape.
 *  Async-aware: a promise-returning callback keeps its editor alive until it
 *  settles (a synchronous `finally` destroyed the editor while async work
 *  was still using it — audit round 1). */
export function withTypingSession<T>(
  options: SessionOptions,
  fn: (session: TypingSession) => T,
): T {
  const session = createTypingSession(options);
  let result: T;
  try {
    result = fn(session);
  } catch (error) {
    session.destroy();
    throw error;
  }
  if (result instanceof Promise) {
    return result.finally(() => session.destroy()) as T;
  }
  session.destroy();
  return result;
}
