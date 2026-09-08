/**
 * Clipboard CommandBus commands (#1354).
 *
 * Purpose: the Edit-menu Cut/Copy/Paste/Select-All CLICK path on Windows.
 * muda's predefined clipboard items were removed there — their built-in
 * Ctrl+C/X/V/A accelerators entered the Win32 accelerator table, which
 * intercepted the user's PHYSICAL keystroke before WebView2 saw it and
 * re-emitted it via SendInput. That synthetic sequence ends with a Ctrl-up
 * while the user still holds Ctrl, desyncing Chromium's modifier state:
 * subsequently typed characters arrive as phantom-Ctrl chords and vanish
 * (issue #1354's 吞字), paste mistargets, and IME composition breaks — until
 * a focus cycle resets the webview. With the accelerators gone, physical
 * shortcuts flow natively to WebView2 (full fidelity, IME-safe); these
 * commands serve only actual menu CLICKS, routed per menu:edit-* event
 * through the same clipboardBridge the editor context menu uses.
 *
 * Key decisions:
 *   - Surface comes from the live mode (source pane vs WYSIWYG), the same
 *     signal the status-bar mode toggle shows. A menu click targets the
 *     editing surface; the terminal keeps its own native shortcuts and
 *     context menu (a menu-click paste into the terminal was already not a
 *     path predefined items served well — SendInput went to whatever
 *     focused — and is out of scope here).
 *   - macOS keeps PredefinedMenuItems (the responder chain is correct
 *     there), so these commands are never reached from its menu; they stay
 *     registered on every platform for the palette and for symmetry.
 *
 * @coordinates-with src-tauri/src/menu/localized/edit_menu.rs — emits menu:edit-*
 * @coordinates-with services/editor/clipboardBridge.ts — the executor
 * @module services/commands/clipboardCommands
 */
import i18n from "@/i18n";
import { registerCommands, type CommandDefinition } from "./CommandBus";
import {
  runClipboardCommand,
  type ClipboardCommand,
} from "@/services/editor/clipboardBridge";
import { useUIStore } from "@/stores/uiStore";
import { useEditorStore } from "@/stores/editorStore";
import type { EditorMenuSurface } from "@/types/editorContextMenu";

/**
 * The editing surface a menu-bar clipboard click should target.
 *
 * Known gap (audit #888): a SplitPaneEditor source pane runs with
 * `sourceMode === false`, so a menu click while it holds the caret resolves to
 * `"wysiwyg"`. It cannot be fixed here — that pane registers itself with
 * NOTHING this function can read (`setActiveSourceView` is the markdown
 * SourceEditor's, and `setContextMenuSourceView` fires on right-click, not on
 * focus), so closing it means giving `SplitPaneEditor/SourcePane.tsx` a focus
 * registration first.
 */
export function resolveClipboardSurface(): EditorMenuSurface {
  return useUIStore.getState().sourceMode ? "source" : "wysiwyg";
}

/**
 * Whether the resolved surface has an editor to act on (audit #891).
 *
 * Without it these commands were unconditionally available, and the non-mac
 * fallback is `document.execCommand` — which acts on whatever DOM node happens
 * to hold focus. With no editor mounted at all (the Welcome screen, a browser
 * tab), an Edit-menu Cut therefore operated on some other element, or
 * Select-All selected the whole page. A `when` answers both halves, the same
 * shape `paneCommands` uses (#924): the palette hides them, and a menu click is
 * refused rather than misdirected.
 *
 * The surface's own view is the right question, not "any editor exists": the
 * bridge focuses THAT surface and its fallbacks dispatch into THAT view.
 */
function clipboardTargetExists(): boolean {
  const editors = useEditorStore.getState();
  return resolveClipboardSurface() === "source"
    ? editors.source.editorView !== null
    : editors.tiptap.editorView !== null;
}

/**
 * The four commands. The i18n key is DERIVED from the id (audit #889) — it was
 * a second copy of the same string on every row, so the palette label and the
 * command it runs could drift apart four independent ways for nothing.
 */
const COMMANDS: ReadonlyArray<{ id: string; command: ClipboardCommand }> = [
  { id: "edit.cut", command: "cut" },
  { id: "edit.copy", command: "copy" },
  { id: "edit.paste", command: "paste" },
  { id: "edit.selectAll", command: "selectAll" },
];

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const CLIPBOARD_COMMANDS_OWNER = "clipboard-commands";

/** Build the clipboard command specs (pure — no registration). */
function buildClipboardCommandSpecs(): CommandDefinition[] {
  return COMMANDS.map(({ id, command }) => ({
    id,
    title: () => i18n.t(`commands:${id}`),
    category: "edit",
    when: clipboardTargetExists,
    run: async () => {
      await runClipboardCommand(command, resolveClipboardSurface());
    },
  }));
}

/**
 * Register the four clipboard commands as ONE owner batch (audit #890).
 *
 * `hasCommand("edit.copy")` could not tell a complete owned batch from a
 * foreign registrar holding that one id, nor recover a batch that failed
 * part-way; `registerCommands` preflights all four and replaces its own
 * previous batch under HMR (#459).
 */
export function registerClipboardCommands(): void {
  registerCommands(CLIPBOARD_COMMANDS_OWNER, buildClipboardCommandSpecs());
}
