/**
 * The asset-grant lifecycle behind `MediaView`.
 *
 * Extracted from the component, which was carrying this, two render fallbacks
 * and three media branches at once. Everything subtle about previewing a local
 * file is here, and none of it is about rendering:
 *
 *   - state is keyed by PATH and by ATTEMPT rather than held as booleans, so a
 *     path change resets it implicitly and no `setState` happens inside the
 *     effect (the cascading-render rule);
 *   - the grant marks the path granted even when it REJECTED, so a failed grant
 *     falls through to the element's `onError` and the fallback panel instead
 *     of stranding a spinner forever;
 *   - the reload key rides in the URL, because that is the only thing an
 *     `<img>`/`<video>` reacts to — an unchanged `src` never refetches, and the
 *     webview serves the element from cache (issue #1328).
 *
 * @coordinates-with MediaView.tsx — sole consumer
 * @module components/Editor/MediaView/useMediaAsset
 */
import { useEffect, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getMediaType } from "@/utils/mediaPathDetection";
import {
  normalizePathForAsset,
  withMediaReloadKey,
} from "@/services/media/resolveMediaSrc";
import { mediaViewError } from "@/utils/debug";

export interface MediaAsset {
  /** True once the webview may load this path over `asset://`. */
  granted: boolean;
  /** True when THIS path-and-version failed to decode. */
  errored: boolean;
  /** The `asset://` URL, carrying the reload key. */
  src: string;
  /** Identity of the current path-and-version; use it as the element `key`. */
  attempt: string;
  /** Report a decode failure for the current attempt. */
  markErrored: () => void;
}

export function useMediaAsset(path: string, reloadKey: number): MediaAsset {
  // Tracked per-path (not as booleans) so a path change resets granted/errored
  // implicitly — no synchronous setState in the effect (cascading-render rule).
  const [grantedPath, setGrantedPath] = useState<string | null>(null);
  // Errors are tracked per PATH-AND-VERSION, not per path: a file that failed
  // to decode and was then rewritten correctly must get a fresh attempt rather
  // than stay pinned to the fallback panel for the life of the tab.
  const [erroredAttempt, setErroredAttempt] = useState<string | null>(null);
  // NUL as the separator, written as an escape rather than a raw byte: a raw
  // one makes the whole file invisible to grep (see `pnpm lint:no-nul-bytes`).
  const attempt = `${path}\u0000${reloadKey}`;

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
      // onError falls through to the fallback panel. Gating render on grant
      // success instead would strand a legitimately-failed grant on the loading
      // spinner forever — render → onError → fallback is the intended path.
      .finally(() => {
        if (!cancelled) setGrantedPath(path);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return {
    granted: grantedPath === path,
    errored: erroredAttempt === attempt,
    // The reload key rides in the URL because that is the ONLY thing an <img>
    // or <video> reacts to — see withMediaReloadKey (issue #1328).
    src: withMediaReloadKey(convertFileSrc(normalizePathForAsset(path)), reloadKey),
    attempt,
    markErrored: () => setErroredAttempt(attempt),
  };
}
