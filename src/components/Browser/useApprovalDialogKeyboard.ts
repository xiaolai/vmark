/**
 * useApprovalDialogKeyboard — the focus and keyboard discipline of the AI-action
 * approval prompt (split from BrowserApprovalDialog for the file-size gate).
 *
 *  - Deny holds focus while the prompt is up, and the element focused before the
 *    prompt is restored on close — resolving a prompt used to drop focus to <body>
 *    and a keyboard user lost their place (audit 20260815-163607 #22).
 *  - Escape DENIES, exclusively: capture phase + stopImmediatePropagation, because a
 *    sibling overlay's window-level listener once saw the same keystroke and one
 *    Escape resolved two decisions (audit #23).
 *  - Tab is trapped inside the dialog: `aria-modal` informs assistive tech, it does
 *    not make the rest of the app inert for the Tab key.
 *
 * @coordinates-with components/Browser/BrowserApprovalDialog — the consumer
 * @module components/Browser/useApprovalDialogKeyboard
 */
import {useLayoutEffect, useRef, type RefObject } from "react";

export function useApprovalDialogKeyboard(
  requestId: string | undefined,
  denyRef: RefObject<HTMLButtonElement | null>,
  dialogRef: RefObject<HTMLDivElement | null>,
  /** Called with the current request id when the user presses Escape. */
  onDeny: (requestId: string) => void,
): void {
  // The latest `onDeny` without resubscribing the window listener on every render.
  // Written after commit (a layout effect), never during render.
  const onDenyRef = useRef(onDeny);
  useLayoutEffect(() => {
    onDenyRef.current = onDeny;
  });
  // Deny holds focus: a stray Enter must never authorize an action. The element
  // focused BEFORE the prompt is remembered so it can be restored on close —
  // otherwise resolving a prompt dropped focus to <body> and a keyboard user lost
  // their place in the app (audit 20260815-163607 #22).
  // Layout effects, not passive ones: the prompt must own focus and the keyboard
  // BEFORE it is painted. A passive effect left a post-render window in which the
  // security prompt was visible while background focus and sibling handlers were live.
  useLayoutEffect(() => {
    if (!requestId) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    denyRef.current?.focus();
    return () => {
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, [requestId, denyRef]);

  useLayoutEffect(() => {
    if (!requestId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Fail closed. Dismissing a security prompt is a denial, never an approval.
      if (e.key === "Escape") {
        e.preventDefault();
        // EXCLUSIVE: while a security prompt is raised it is the only Escape
        // handler. There is no modal stack, so a sibling overlay's window-level
        // listener also saw this keystroke and one Escape resolved two separate
        // decisions — one of them unseen by the user (audit #23). Capture phase
        // plus stopImmediatePropagation makes this prompt win deterministically
        // instead of depending on listener registration order.
        e.stopPropagation();
        e.stopImmediatePropagation();
        onDenyRef.current(requestId);
        return;
      }
      // Trap Tab inside the dialog. `aria-modal` tells assistive tech the rest of
      // the app is inert; it does NOT make it inert for the Tab key, so focus
      // could walk out of a security prompt and into the background UI while the
      // prompt was still open (audit #22).
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [requestId, dialogRef]);

}
