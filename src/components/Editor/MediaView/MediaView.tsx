// Media render-core — shared, reusable surface for previewing a local
// image / audio / video file (WI-2).
//
// Purpose: Given an absolute file path, classify it, resolve it to a Tauri
//   asset URL (convertFileSrc), and render the matching element. On load
//   failure or an unknown extension, show a fallback panel with two
//   external-open actions. This component is intentionally prop-only (no
//   store reads) so the Quick Look overlay can reuse it directly.
//
// Public contract: <MediaView path={absolutePath} />
//
// @coordinates-with utils/mediaPathDetection.ts — getMediaType()
// @coordinates-with services/media/resolveMediaSrc.ts — normalizePathForAsset()
// @module components/Editor/MediaView/MediaView

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { FileQuestion } from "lucide-react";
import { getMediaType } from "@/utils/mediaPathDetection";
import { normalizePathForAsset } from "@/services/media/resolveMediaSrc";
import { mediaViewError } from "@/utils/debug";
import "./MediaView.css";

/** Extract the trailing filename from an absolute path (sync, cross-platform). */
function basenameOf(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/");
  return segments[segments.length - 1] || path;
}

export interface MediaViewProps {
  /** Absolute file path handed down by the tab surface / overlay. */
  path: string;
}

/** Render an image / audio / video preview, or a graceful fallback. */
export function MediaView({ path }: MediaViewProps) {
  const { t } = useTranslation("editor");
  // Track state per-path (not booleans) so a path change resets granted/errored
  // implicitly — no synchronous setState in the effect (cascading-render rule).
  const [grantedPath, setGrantedPath] = useState<string | null>(null);
  const [erroredPath, setErroredPath] = useState<string | null>(null);
  const granted = grantedPath === path;
  const errored = erroredPath === path;

  const mediaType = getMediaType(path);
  const filename = basenameOf(path);
  const src = convertFileSrc(normalizePathForAsset(path));

  // Grant the webview asset:// access to THIS file before rendering the media
  // element. Opening a media tab grants at open time, but Quick Look and
  // arrow-nav reach MediaView without going through that path — so the render
  // core owns the grant, making every entry point work. Best-effort: on
  // failure we still render and let the element's onError show the fallback.
  useEffect(() => {
    // Skip the grant for a non-media path: an unknown extension renders the
    // fallback panel and never points an element at an asset:// URL, so it must
    // not acquire fs+asset scope for a file it won't preview.
    if (getMediaType(path) === null) return;
    let cancelled = false;
    void invoke("grant_asset_access", { path })
      .catch((e: unknown) => mediaViewError("grant_asset_access failed:", e))
      // Mark the path granted even if the grant REJECTED. This is deliberate:
      // the element then attempts the asset:// URL, the webview returns 403, and
      // onError falls through to the panel below. Gating render on grant success
      // instead would strand a legitimately-failed grant on the loading spinner
      // forever — render → onError → fallback is the intended failure path.
      .finally(() => {
        if (!cancelled) setGrantedPath(path);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

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
            className="media-view__btn"
            onClick={openExternally}
          >
            {t("media.openExternally")}
          </button>
          <button
            type="button"
            className="media-view__btn"
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
          className={`media-view__${mediaType}`}
          data-testid={`media-view-${mediaType}`}
          src={src}
          controls
          preload="metadata"
          onError={() => setErroredPath(path)}
        />
      </div>
    );
  }

  return (
    <div className="media-view media-view--image">
      <img
        className="media-view__image"
        src={src}
        alt={filename}
        onError={() => setErroredPath(path)}
      />
    </div>
  );
}
