/**
 * Editor
 *
 * Purpose: Format-registry dispatcher (WI-1A.5). Reads the active tab's
 *   filePath, calls dispatchEditor() to resolve a FormatConfig, and mounts one
 *   of three surfaces: the format's wysiwygComponent (markdown today), the
 *   dedicated read-only <MediaViewer> for kind:"media" (image/audio/video), or
 *   the generic <SplitPaneEditor> for the remaining split-pane / viewer kinds.
 *
 * Pipeline: useActiveTabId → useTabStore.findTabById → dispatchEditor →
 *   kind === "wysiwyg" ? <wysiwygComponent />
 *   : kind === "media" ? <MediaViewer />
 *   : <SplitPaneEditor />
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
 * @coordinates-with src/components/Editor/MediaViewer/MediaViewer — kind:"media" surface
 * @coordinates-with src/components/Editor/SplitPaneEditor — SplitPaneEditor
 * @coordinates-with src/components/Welcome/WelcomeScreen — shown when no tab open
 * @module components/Editor/Editor
 */
import { useActiveTabId } from "@/hooks/useDocumentState";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab, isDocumentTab } from "@/stores/tabStoreTypes";
import { BrowserSurface } from "@/components/Browser/BrowserSurface";
import { dispatchEditor } from "@/lib/formats/registry";
import { MarkdownEditorSurface } from "@/lib/formats/adapters/markdown";
import { WelcomeScreen } from "@/components/Welcome/WelcomeScreen";
import { MediaViewer } from "./MediaViewer/MediaViewer";
import { SplitPaneEditor } from "./SplitPaneEditor/SplitPaneEditor";
import "./editor.css";
import "./heading-picker.css";
import "@/styles/popup-shared.css";

/** Top-level editor dispatcher. Resolves the active tab's FormatConfig and
 *  mounts the matching surface (wysiwyg, media viewer, or split-pane).
 *  useUnifiedMenuCommands mounts at this level so menu events reach every
 *  kind of surface. */
export function Editor() {
  const tabId = useActiveTabId();

  // The menu dispatcher (useUnifiedMenuCommands) is mounted once per window in
  // App.tsx MainLayout — NOT here — so a two-pane split doesn't double-mount it
  // (#1081). It targets the window's focused pane via the pane-aware tab hooks.
  const tab = useTabStore((s) =>
    tabId ? (s.findTabById?.(tabId) ?? null) : null,
  );

  // No active tab → empty-workspace window: show the Welcome screen.
  if (!tabId) {
    return <WelcomeScreen />;
  }

  // R1: a browser tab is not a document — branch on `kind` BEFORE dispatchEditor,
  // or a browser tab (which has no filePath) would resolve as an untitled
  // markdown document. Browser tabs render the embedded browser surface (WI-1.3).
  if (tabId && tab && isBrowserTab(tab)) {
    return <BrowserSurface key={tabId} tabId={tabId} />;
  }

  const filePath = tab && isDocumentTab(tab) ? tab.filePath : null;
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
  // Media (image/audio/video) renders in a dedicated read-only surface —
  // NOT SplitPaneEditor, which would mount an empty CodeMirror source pane.
  if (formatConfig.kind === "media") {
    return <MediaViewer key={key} tabId={tabId} />;
  }
  return (
    <SplitPaneEditor
      key={key}
      tabId={tabId}
      formatConfig={formatConfig}
    />
  );
}
