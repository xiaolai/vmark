/**
 * Multi-cursor keymap for ProseMirror
 *
 * Rebindable chords (resolved live from the shortcuts store via getShortcut, so
 * Settings rebinds take effect without a restart — the keymap rebuilds on every
 * store change, mirroring `editorKeymapExtension`):
 * - addCursorAbove  (default Mod-Alt-Up  → Mod-Alt-ArrowUp)
 * - addCursorBelow  (default Mod-Alt-Down → Mod-Alt-ArrowDown)
 * - skipOccurrence  (default Mod-Shift-d)
 * - softUndoCursor  (default Alt-Mod-z)
 *
 * Fixed chords (no rebindable Settings row — selectNextOccurrence /
 * selectAllOccurrences are command names, not shortcut ids):
 * - Mod-d: Select next occurrence
 * - Mod-Shift-l: Select all occurrences
 * - Escape: Collapse to single cursor
 *
 * @coordinates-with shortcutsStore.ts (reads current shortcut bindings)
 * @coordinates-with utils/keybinding/proseMirrorKey.ts (toProseMirrorKey helper)
 */
import { keydownHandler } from "@tiptap/pm/keymap";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction, EditorState } from "@tiptap/pm/state";
import { useShortcutsStore } from "@/stores/settingsStore";
import { toProseMirrorKey } from "@/utils/keybinding/proseMirrorKey";
import {
  selectNextOccurrence,
  selectAllOccurrences,
  collapseMultiSelection,
  skipOccurrence,
  softUndoCursor,
  addCursorAbove,
  addCursorBelow,
} from "./commands";
import type { EditorView } from "@tiptap/pm/view";

type Command = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  view?: EditorView
) => boolean;

/**
 * Wrap a state-only transaction command into a ProseMirror command.
 */
export function wrapCommand(
  fn: (state: EditorState) => Transaction | null
): Command {
  return (state, dispatch) => {
    const tr = fn(state);
    if (tr) {
      if (dispatch) dispatch(tr);
      return true;
    }
    return false;
  };
}

/**
 * Wrap a command that requires the EditorView into a ProseMirror command.
 */
export function wrapViewCommand(
  fn: (state: EditorState, view: EditorView) => Transaction | null
): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    const tr = fn(state, view);
    if (tr) {
      if (dispatch) dispatch(tr);
      return true;
    }
    return false;
  };
}

const multiCursorKeymapPluginKey = new PluginKey("multiCursorKeymap");

/**
 * Build the multi-cursor keymap bindings from the current shortcuts store.
 *
 * The four rebindable chords are resolved via `getShortcut(id)` so a Settings
 * rebind flows through here; an empty (unbound) chord is skipped, matching
 * `bindIfKey`. The three fixed chords have no rebindable Settings row and stay
 * hardcoded.
 */
export function buildMultiCursorKeymapBindings(): Record<string, Command> {
  const shortcuts = useShortcutsStore.getState();
  const bindings: Record<string, Command> = {};

  const bindIfKey = (key: string, command: Command) => {
    // Guard against an empty/unbound chord — skip binding, like the WYSIWYG
    // keymap's bindIfKey does.
    if (!key) return;
    bindings[toProseMirrorKey(key)] = command;
  };

  // Fixed chords: no rebindable Settings row exists for these commands
  // (selectNextOccurrence / selectAllOccurrences are command names, not
  // shortcut ids).
  bindings["Mod-d"] = wrapCommand(selectNextOccurrence);
  bindings["Mod-Shift-l"] = wrapCommand(selectAllOccurrences);
  bindings.Escape = wrapCommand(collapseMultiSelection);

  // Rebindable chords: resolved live from the shortcuts store so Settings
  // rebinds take effect. The literal ids here are what the reverse-closure gate
  // (shortcutConsumerClosure.test.ts) scans for to prove these rows are consumed.
  bindIfKey(shortcuts.getShortcut("skipOccurrence"), wrapCommand(skipOccurrence));
  bindIfKey(shortcuts.getShortcut("softUndoCursor"), wrapCommand(softUndoCursor));
  bindIfKey(shortcuts.getShortcut("addCursorAbove"), wrapViewCommand(addCursorAbove));
  bindIfKey(shortcuts.getShortcut("addCursorBelow"), wrapViewCommand(addCursorBelow));

  return bindings;
}

/**
 * Create the multi-cursor keymap plugin.
 *
 * The keymap rebuilds whenever the shortcuts store changes, so rebinding one of
 * the four rebindable chords in Settings takes effect live — the same mechanism
 * `editorKeymapExtension` uses for the WYSIWYG keymap.
 */
export function multiCursorKeymap(): Plugin {
  let handler = keydownHandler(buildMultiCursorKeymapBindings());
  const unsubscribe = useShortcutsStore.subscribe(() => {
    handler = keydownHandler(buildMultiCursorKeymapBindings());
  });

  return new Plugin({
    key: multiCursorKeymapPluginKey,
    props: {
      handleKeyDown(view, event) {
        return handler(view, event);
      },
    },
    /* v8 ignore start -- @preserve reason: ProseMirror Plugin view() lifecycle only runs inside a live Tiptap editor; not instantiated in unit tests */
    view() {
      return {
        destroy() {
          unsubscribe();
        },
      };
    },
    /* v8 ignore stop */
  });
}
