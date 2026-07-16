/**
 * Editor
 *
 * Purpose: Format-registry dispatcher (WI-1A.5). Reads the active tab, resolves
 *   a FormatConfig for it, and mounts one of four surfaces: <BrowserWorkspaceSurface>
 *   for kind:"browser" tabs, the format's wysiwygComponent (markdown today), the
 *   dedicated read-only <MediaViewer> for kind:"media" (image/audio/video), or
 *   the generic <SplitPaneEditor> for the remaining split-pane / viewer kinds.
 *
 * Pipeline: useActiveTabId → useTabStore.findTabById →
 *   tab.kind === "browser" ? <BrowserWorkspaceSurface />
 *   : resolveFormat(tab) →
 *     kind === "wysiwyg" ? <wysiwygComponent />
 *     : kind === "media" ? <MediaViewer />
 *     : <SplitPaneEditor />
 *
 * Key decisions:
 *   - Browser tabs are branched on BEFORE any format lookup: they carry no
 *     filePath, so dispatchEditor would resolve them as untitled markdown (R1).
 *   - Format source: a pathed tab dispatches on its filePath, so a live change to
 *     the user's format associations takes effect without touching the tab. An
 *     UNTITLED tab (filePath === null) dispatches on its own Tab.formatId —
 *     dispatchEditor(null) can only ever answer "markdown", so the tab record is
 *     the sole source of truth for an untitled JSON/txt/… document (created via
 *     createUntitledTab(formatId) or restored by hot-exit, which persists
 *     format_id precisely because the path cannot recover it).
 *   - Markdown rendering surface lives in src/lib/formats/adapters/markdown.tsx
 *     as MarkdownEditorSurface; this dispatcher pulls the component reference
 *     out of the FormatConfig so the registry is the single source of truth.
 *   - The remount key is `${tabId}-${formatConfig.id}`: a kind change
 *     (markdown → txt → json …) remounts the surface so per-tab state doesn't
 *     leak across formats (ADR-10 / WI-1A.12).
 *   - No active tab → the empty-workspace window: render <WelcomeScreen />
 *     instead of an editor bound to no document. The window stays open after
 *     the last tab is closed (VSCode-style); this is what fills the editor area.
 *   - Failure-open: when a tab IS active but no format resolves, the dispatcher
 *     still falls back to MarkdownEditorSurface so the surface renders something.
 *
 * @coordinates-with src/lib/formats/registry.ts — dispatchEditor() / getFormatById()
 * @coordinates-with src/lib/formats/adapters/markdown.tsx — MarkdownEditorSurface
 * @coordinates-with src/components/Browser/BrowserWorkspaceSurface — kind:"browser" workspace surface
 * @coordinates-with src/components/Editor/MediaViewer/MediaViewer — kind:"media" surface
 * @coordinates-with src/components/Editor/SplitPaneEditor — SplitPaneEditor
 * @coordinates-with src/components/Welcome/WelcomeScreen — shown when no tab open
 * @coordinates-with src/services/navigation/newFile.ts — creates untitled non-markdown tabs
 * @module components/Editor/Editor
 */
import { useActiveTabId } from "@/hooks/useDocumentState";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab, isDocumentTab } from "@/stores/tabStoreTypes";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { BrowserWorkspaceSurface } from "@/components/Browser/BrowserWorkspaceSurface";
import { dispatchEditor, getFormatById } from "@/lib/formats/registry";
import type { FormatConfig } from "@/lib/formats/types";
import { MarkdownEditorSurface } from "@/lib/formats/adapters/markdown";
import { WelcomeScreen } from "@/components/Welcome/WelcomeScreen";
import { MediaViewer } from "./MediaViewer/MediaViewer";
import { SplitPaneEditor } from "./SplitPaneEditor/SplitPaneEditor";
import "./editor.css";
import "./heading-picker.css";
import "@/styles/popup-shared.css";

/** Resolve the FormatConfig for a document tab.
 *
 *  Pathed tab → dispatch on the path (live user format associations win).
 *  Untitled tab → the tab's own formatId, which is the only place an untitled
 *  non-markdown format is recorded; dispatchEditor(null) always answers
 *  "markdown". An unregistered/stale formatId falls back to path dispatch. */
function resolveFormat(tab: DocumentTab | null): FormatConfig {
  const filePath = tab?.filePath ?? null;
  const untitledFormat =
    tab && filePath === null ? getFormatById(tab.formatId) : undefined;
  return untitledFormat ?? dispatchEditor(filePath);
}

/** Top-level editor dispatcher. Resolves the active tab's FormatConfig and
 *  mounts the matching surface (browser, wysiwyg, media viewer, or split-pane).
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
  //
  // Also when `tabId` names a tab that no longer exists. A stale activeTabId is
  // reachable (tab transfer, hot-exit restore, workspace switch), and falling
  // through would resolve `null` to an untitled MARKDOWN document and mount a
  // full editor over a document that does not exist — a phantom buffer the user
  // can type into, backed by nothing. Fail closed.
  if (!tabId || !tab) {
    return <WelcomeScreen />;
  }

  // R1: a browser page is not a document — branch on `kind` BEFORE dispatchEditor,
  // or a browser tab (which has no filePath) would resolve as an untitled
  // markdown document. Browser pages render inside the Browser workspace (WI-1.3).
  if (tab && isBrowserTab(tab)) {
    return <BrowserWorkspaceSurface />;
  }

  const formatConfig = resolveFormat(tab && isDocumentTab(tab) ? tab : null);

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
