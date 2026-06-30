/**
 * Editor
 *
 * Purpose: Format-registry dispatcher (WI-1A.5). Reads the active tab's
 *   filePath, calls dispatchEditor() to resolve a FormatConfig, and mounts
 *   either the format's wysiwygComponent (markdown today) or the generic
 *   <SplitPaneEditor> for split-pane / viewer kinds.
 *
 * Pipeline: useActiveTabId → useTabStore.findTabById → dispatchEditor →
 *   FormatConfig.kind === "wysiwyg" ? <wysiwygComponent /> : <SplitPaneEditor />
 *
 * Key decisions:
 *   - Markdown rendering surface lives in src/lib/formats/adapters/markdown.tsx
 *     as MarkdownEditorSurface; this dispatcher pulls the component reference
 *     out of the FormatConfig so the registry is the single source of truth.
 *   - Tab kind change (markdown → txt → json …) triggers an automatic
 *     remount because Tab.formatId is part of editorKey (ADR-10 / WI-1A.12).
 *   - No active tab → the empty-workspace window: render <WelcomeScreen />
 *     instead of an editor bound to no document. The window stays open after
 *     the last tab is closed (VSCode-style); this is what fills the editor area.
 *   - Failure-open: when a tab IS active but no format resolves, the dispatcher
 *     still falls back to MarkdownEditorSurface so the surface renders something.
 *
 * @coordinates-with src/lib/formats/registry.ts — dispatchEditor()
 * @coordinates-with src/lib/formats/adapters/markdown.tsx — MarkdownEditorSurface
 * @coordinates-with src/components/Editor/SplitPaneEditor — SplitPaneEditor
 * @coordinates-with src/components/Welcome/WelcomeScreen — shown when no tab open
 * @module components/Editor/Editor
 */
import { useActiveTabId } from "@/hooks/useDocumentState";
import { useTabStore } from "@/stores/tabStore";
import { useUnifiedMenuCommands } from "@/hooks/useUnifiedMenuCommands";
import { dispatchEditor } from "@/lib/formats/registry";
import { MarkdownEditorSurface } from "@/lib/formats/adapters/markdown";
import { WelcomeScreen } from "@/components/Welcome/WelcomeScreen";
import { SplitPaneEditor } from "./SplitPaneEditor/SplitPaneEditor";
import "./editor.css";
import "./heading-picker.css";
import "@/styles/popup-shared.css";

/** Top-level editor dispatcher. Resolves the active tab's FormatConfig and
 *  mounts the matching surface (wysiwyg or split-pane). useUnifiedMenuCommands
 *  mounts at this level so menu events reach every kind of surface. */
export function Editor() {
  const tabId = useActiveTabId();

  // Single mount for the menu dispatcher — mounted unconditionally (before any
  // early return) so New / Open / Open Folder menu events keep working even
  // when no document is open (Welcome screen). The markdown adapter no longer
  // owns this, so non-markdown tabs receive menu events too.
  useUnifiedMenuCommands();

  const tab = useTabStore((s) =>
    tabId ? (s.findTabById?.(tabId) ?? null) : null,
  );

  // No active tab → empty-workspace window: show the Welcome screen.
  if (!tabId) {
    return <WelcomeScreen />;
  }

  const filePath = tab?.filePath ?? null;
  const formatConfig = dispatchEditor(filePath);

  // WI-4.3 — keying by tabId+formatId forces a remount on tab switch
  // and on kind change (markdown → txt → json …) so per-tab state in
  // SplitPaneEditor / MarkdownEditorSurface (split fraction, lazy-
  // language load) doesn't leak across tabs.
  const key = `${tabId}-${formatConfig.id}`;

  if (formatConfig.kind === "wysiwyg") {
    /* v8 ignore next -- @preserve markdown surface dispatch — the only kind="wysiwyg" today */
    const Surface = formatConfig.wysiwygComponent ?? MarkdownEditorSurface;
    return <Surface key={key} tabId={tabId} />;
  }
  return (
    <SplitPaneEditor
      key={key}
      tabId={tabId}
      formatConfig={formatConfig}
    />
  );
}
