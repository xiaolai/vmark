/**
 * Re-export shim — the clipboard bridge moved to services/editor/ in the
 * #1354 fix (it is service-shaped; services/commands must reach it without
 * an upward components import). Context-menu callers and the codemirror
 * plugin keep this path so their import graph — and the per-channel plugin
 * coupling baseline keyed on it — stays unchanged.
 *
 * @module components/Editor/EditorContextMenu/clipboardBridge
 */
export {
  runClipboardCommand,
  focusEditorSurface,
  setContextMenuSourceView,
  clearContextMenuSourceView,
} from "@/services/editor/clipboardBridge";
