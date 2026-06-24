/**
 * Spotlight Dialog Shared Scaffolding
 *
 * Purpose: Shared building blocks for the spotlight-style overlays
 * (QuickOpen, ContentSearch). Both render a centered, portal-mounted
 * `role="dialog" aria-modal="true"` surface with the same focus, scroll,
 * and dismiss behavior. This module collapses the duplicated inline SVG
 * icons and the Tab focus-trap logic into one tested place.
 *
 * @coordinates-with QuickOpen.tsx — uses SpotlightFileIcon/SpotlightFolderIcon, focus trap
 * @coordinates-with ContentSearch.tsx — uses SpotlightFileIcon, focus trap
 * @module components/spotlight/spotlightDialog
 */

import { useEffect } from "react";

/** Inline file glyph used by spotlight overlays. `className` keeps each
 *  call site's existing scoped styling (e.g. `quick-open-item-icon`). */
export function SpotlightFileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M4 1h5l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
      <path d="M9 1v4h4" />
    </svg>
  );
}

/** Inline folder glyph used by spotlight overlays. */
export function SpotlightFolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2 3h4l2 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

/**
 * Tab focus-trap for an aria-modal dialog. Cycles focus within the
 * container so keyboard focus can't leave the open overlay. Returns the
 * (possibly mutated) event untouched; it calls `preventDefault()` and
 * moves focus only when wrapping at an edge.
 *
 * Extracted so QuickOpen and ContentSearch share identical, tested
 * behavior rather than each re-deriving the focusable-element query.
 */
export function handleSpotlightTabTrap(
  e: Pick<React.KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  container: HTMLElement | null,
): void {
  if (e.key !== "Tab") return;
  const focusable = container?.querySelectorAll<HTMLElement>(
    'input, button, [tabindex]:not([tabindex="-1"])',
  );
  if (!focusable || focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Manage focus when a spotlight overlay opens/closes: focus the input on
 * open (next frame, after the portal mounts), and restore focus to the
 * previously-focused element on close.
 */
export function useSpotlightFocusManagement(
  isOpen: boolean,
  inputRef: React.RefObject<HTMLInputElement | null>,
  previousFocusRef: React.RefObject<Element | null>,
): void {
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (previousFocusRef.current) {
      const el = previousFocusRef.current as HTMLElement;
      if (typeof el.focus === "function") el.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen, inputRef, previousFocusRef]);
}
