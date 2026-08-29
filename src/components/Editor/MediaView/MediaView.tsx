// Media render-core — shared, reusable surface for previewing a local
// image / audio / video file (WI-2).
//
// Purpose: Given an absolute file path, classify it, resolve it to a Tauri
//   asset URL (convertFileSrc), and render the matching element. On load
//   failure or an unknown extension, show a fallback panel with two
//   external-open actions. This component is intentionally prop-only (no
//   store reads) so the Quick Look overlay can reuse it directly.
//
// Public contract: <MediaView path={absolutePath} reloadKey={n?} />
//
// Key decisions:
//   - This file is RENDER ONLY: three media branches, a loading slot, and the
//     fallback panel. The asset-grant lifecycle, the per-attempt error keying
//     and the cache-busting URL live in `useMediaAsset` — none of that is
//     about rendering, and all of it is subtle.
//   - `reloadKey` is optional and 0-defaulted, so the overlay entry points,
//     which have no document to watch, produce byte-identical URLs to before.
//
// @coordinates-with useMediaAsset.ts — the grant lifecycle and the asset URL
// @coordinates-with utils/mediaPathDetection.ts — getMediaType()
// @coordinates-with components/Editor/MediaViewer/MediaViewer.tsx — supplies reloadKey from documentId
// @module components/Editor/MediaView/MediaView

import { useTranslation } from "react-i18next";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { FileQuestion } from "lucide-react";
import { getMediaType } from "@/utils/mediaPathDetection";
import { mediaViewError } from "@/utils/debug";
import { useMediaAsset } from "./useMediaAsset";
import "./MediaView.css";

/** Extract the trailing filename from an absolute path (sync, cross-platform). */
function basenameOf(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/");
  return segments[segments.length - 1] || path;
}

export interface MediaViewProps {
  /** Absolute file path handed down by the tab surface / overlay. */
  path: string;
  /**
   * Bumped when the file's BYTES change on disk, so the element re-fetches.
   *
   * Optional and defaulting to 0 because the two overlay entry points (Quick
   * Look, arrow-nav) render a path the user just picked and have no document
   * to watch; only a media TAB, which outlives external edits, supplies one.
   * At 0 the URL is byte-identical to what it was before issue #1328.
   */
  reloadKey?: number;
}

/** Render an image / audio / video preview, or a graceful fallback. */
export function MediaView({ path, reloadKey = 0 }: MediaViewProps) {
  const { t } = useTranslation("editor");
  // Grant lifecycle, error-per-attempt and the cache-busting URL all live in
  // the hook — none of it is about rendering, and all of it is subtle.
  const { granted, errored, src, attempt, markErrored } = useMediaAsset(path, reloadKey);

  const mediaType = getMediaType(path);
  const filename = basenameOf(path);

  const openExternally = () => {
    void openPath(path).catch((e: unknown) =>
      mediaViewError("openPath failed:", e),
    );
  };
  const reveal = () => {
    void revealItemInDir(path).catch((e: unknown) =>
      mediaViewError("revealItemInDir failed:", e),
    );
  };

  if (mediaType === null || errored) {
    return (
      <div className="media-view media-view--fallback" role="group">
        <FileQuestion className="media-view__fallback-icon" aria-hidden />
        <span className="media-view__filename">{filename}</span>
        <p className="media-view__message">{t("media.cannotPreview")}</p>
        <div className="media-view__actions">
          <button
            type="button"
            className="vm-btn"
            onClick={openExternally}
          >
            {t("media.openExternally")}
          </button>
          <button
            type="button"
            className="vm-btn"
            onClick={reveal}
          >
            {t("media.revealInFinder")}
          </button>
        </div>
      </div>
    );
  }

  // Wait for the asset grant before pointing an element at the asset:// URL —
  // otherwise a fresh path would 403 once and fall to the panel.
  if (!granted) {
    return <div className="media-view media-view--loading" aria-busy="true" />;
  }

  // <video> and <audio> share the same wrapper / controls / preload / onError
  // shape — the only difference is the element tag. Render them from one branch
  // so the two stay in lockstep (keeps data-testid, className, and attributes).
  if (mediaType === "video" || mediaType === "audio") {
    const Tag = mediaType === "video" ? "video" : "audio";
    return (
      <div className={`media-view media-view--${mediaType}`}>
        <Tag
          // Keyed by ATTEMPT, not by path: without it React reuses one DOM node
          // across a reload, and a late error for the previous `src` runs the
          // handler closed over the new attempt — failing a version that
          // loaded fine (audit finding #10). Decoding is async, so a slow old
          // image erroring after a fast new one is ordinary.
          key={attempt}
          className={`media-view__${mediaType}`}
          data-testid={`media-view-${mediaType}`}
          src={src}
          controls
          preload="metadata"
          onError={markErrored}
        />
      </div>
    );
  }

  return (
    <div className="media-view media-view--image">
      <img
        // See the video/audio branch: keyed by attempt so a stale error cannot
        // be delivered against a newer version.
        key={attempt}
        className="media-view__image"
        src={src}
        alt={filename}
        onError={markErrored}
      />
    </div>
  );
}
