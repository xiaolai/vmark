// Media tab surface — the component Editor.tsx mounts for kind:"media" (WI-2).
//
// Purpose: Bridge the tab/document store to the store-agnostic <MediaView>
//   render core. Reads the tab's absolute filePath via a store selector
//   (never destructured) and wraps the preview in a full-width, read-only
//   container. A media tab's document `content` is always empty — the bytes
//   reach the webview through the Tauri asset protocol inside MediaView.
//
// @coordinates-with components/Editor/Editor.tsx — kind:"media" dispatch
// @coordinates-with components/Editor/MediaView/MediaView.tsx — render core
// @coordinates-with stores/documentStore.ts — per-tab filePath
// @module components/Editor/MediaViewer/MediaViewer

import { useDocumentStore } from "@/stores/documentStore";
import { MediaView } from "@/components/Editor/MediaView/MediaView";
import "./MediaViewer.css";

export interface MediaViewerProps {
  /** Active tab id — keyed the same way as the wysiwyg / split-pane surfaces. */
  tabId: string;
}

/** Full-width read-only surface that previews the tab's media file. */
export function MediaViewer({ tabId }: MediaViewerProps) {
  const filePath = useDocumentStore(
    (state) => state.documents?.[tabId]?.filePath ?? null,
  );

  // A media tab always carries a filePath (opened from disk). Guard anyway:
  // an empty untitled media tab has nothing to render.
  if (!filePath) return null;

  return (
    <div className="media-viewer" role="group">
      <MediaView path={filePath} />
    </div>
  );
}
