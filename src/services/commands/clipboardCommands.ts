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
import { hasCommand, registerCommand } from "./CommandBus";
import {
  runClipboardCommand,
  type ClipboardCommand,
} from "@/services/editor/clipboardBridge";
import { useUIStore } from "@/stores/uiStore";
import type { EditorMenuSurface } from "@/types/editorContextMenu";

/** The editing surface a menu-bar clipboard click should target. */
export function resolveClipboardSurface(): EditorMenuSurface {
  return useUIStore.getState().sourceMode ? "source" : "wysiwyg";
}

const COMMANDS: ReadonlyArray<{ id: string; key: string; command: ClipboardCommand }> = [
  { id: "edit.cut", key: "edit.cut", command: "cut" },
  { id: "edit.copy", key: "edit.copy", command: "copy" },
  { id: "edit.paste", key: "edit.paste", command: "paste" },
  { id: "edit.selectAll", key: "edit.selectAll", command: "selectAll" },
];

let registered = false;

/** Register the four clipboard commands (idempotent under HMR). */
export function registerClipboardCommands(): void {
  if (registered || hasCommand("edit.copy")) return;
  registered = true;

  for (const { id, key, command } of COMMANDS) {
    registerCommand({
      id,
      title: () => i18n.t(`commands:${key}`),
      category: "edit",
      run: async () => {
        await runClipboardCommand(command, resolveClipboardSurface());
      },
    });
  }
}
