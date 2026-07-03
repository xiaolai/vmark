/**
 * QuickLookOverlay — Finder-style spacebar preview overlay.
 *
 * Purpose: Full-screen, portal-mounted overlay that previews the file selected
 *   in the FileExplorer. Reuses <MediaView> for the actual render (images,
 *   audio, video, graceful fallback). Opened by the spacebar hotkey via
 *   quickLookStore; toggled/closed by Space or Escape, and by clicking the
 *   backdrop (but not the panel).
 *
 * Key decisions:
 *   - Mounts once at the app shell overlay slot; renders null when closed.
 *   - Portals to document.body (matches other app-level dialogs).
 *   - Window keydown listener is attached only while open and torn down on
 *     close/unmount via a refs-based cleanup (50-codebase-conventions §2).
 *   - Space preventDefault stops page scroll and button re-activation.
 *   - A focused <video>/<audio> control keeps Space (play/pause) and arrows
 *     (seek/volume); Escape still closes from anywhere.
 *   - Focuses the close button on open; restores prior focus on close (a11y),
 *     but only if the previously-focused element is still connected.
 *
 * @coordinates-with stores/quickLookStore.ts — open/close state
 * @coordinates-with components/Editor/MediaView/MediaView.tsx — render core
 * @module components/QuickLook/QuickLookOverlay
 */

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useQuickLookStore } from "@/stores/quickLookStore";
import { MediaView } from "@/components/Editor/MediaView/MediaView";
import "./QuickLookOverlay.css";

/** Extract the trailing filename from an absolute path (cross-platform). */
function basenameOf(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/");
  return segments[segments.length - 1] || path;
}

/** Full-screen Quick Look preview overlay, mounted once at the app shell. */
export function QuickLookOverlay() {
  const { t } = useTranslation("common");
  const isOpen = useQuickLookStore((s) => s.isOpen);
  const path = useQuickLookStore((s) => s.path);
  const index = useQuickLookStore((s) => s.index);
  const total = useQuickLookStore((s) => s.siblings.length);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  // Store the exact handler so cleanup removes the same reference (§2).
  const handlersRef = useRef<{ keydown: ((e: KeyboardEvent) => void) | null }>({
    keydown: null,
  });

  const close = useCallback(() => {
    useQuickLookStore.getState().close();
  }, []);

  // Window keydown + focus management, active only while open.
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Escape always closes, even from a focused media control.
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      // When a <video>/<audio> control is focused, let it own Space (play/pause)
      // and the arrows (seek/volume) — don't steal them to close/navigate.
      if (e.target instanceof HTMLMediaElement) return;
      // Space dismisses; preventDefault stops scroll / button re-activation and
      // lets Space act as a Finder-style toggle.
      if (e.key === " ") {
        e.preventDefault();
        close();
        return;
      }
      // Arrow keys walk the sibling list (Finder-style), no wrap.
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        useQuickLookStore.getState().next();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        useQuickLookStore.getState().prev();
      }
    };
    handlersRef.current.keydown = onKeyDown;
    window.addEventListener("keydown", onKeyDown);
    // Copy the ref bag into the effect scope so cleanup removes the exact
    // handler reference without reading a possibly-changed ref later (§2).
    const handlers = handlersRef.current;

    previousFocusRef.current = document.activeElement;
    const focusId = requestAnimationFrame(() => closeBtnRef.current?.focus());

    return () => {
      cancelAnimationFrame(focusId);
      if (handlers.keydown) {
        window.removeEventListener("keydown", handlers.keydown);
      }
      handlers.keydown = null;
      const prev = previousFocusRef.current as HTMLElement | null;
      // Only restore focus if the element is still in the DOM — focusing a
      // detached node throws in some engines and misfocuses in others.
      if (prev && prev.isConnected && typeof prev.focus === "function") {
        prev.focus();
      }
      previousFocusRef.current = null;
    };
  }, [isOpen, close]);

  if (!isOpen || !path) return null;

  const filename = basenameOf(path);

  return createPortal(
    <div className="quick-look-backdrop" onClick={close}>
      <div
        className="quick-look-panel"
        role="dialog"
        aria-modal="true"
        aria-label={filename}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="quick-look-header">
          <span className="quick-look-filename" title={filename}>
            {filename}
          </span>
          {total > 1 && (
            <span className="quick-look-position" aria-hidden>
              {index + 1} / {total}
            </span>
          )}
          <button
            ref={closeBtnRef}
            type="button"
            className="quick-look-close"
            aria-label={t("quickLook.close")}
            onClick={close}
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="quick-look-body">
          <MediaView path={path} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
