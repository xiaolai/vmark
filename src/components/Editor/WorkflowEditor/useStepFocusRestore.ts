/**
 * Purpose: restore keyboard focus after a step→step navigation remount in the
 *   forms editor, split out of WorkflowEditorPanel (audit 20260907, #283).
 *
 *   The `key=` prop change unmounts/remounts StepForm and strands keyboard
 *   focus on document.body. Only a transition between two non-null step ids
 *   restores it — an initial selection (null → step) does NOT auto-focus, so
 *   users who clicked a step row in JobForm aren't pulled to the nav buttons
 *   (Codex audit MED-3 + verify regression). The focus is deferred a frame so
 *   the new StepForm has mounted and laid out before its DOM is queried.
 *
 *   Two things about the query are load-bearing (audit R2, #586):
 *
 *   - It is SCOPED to the panel that owns it. The selection lives in one store
 *     slice, so every mounted forms editor reacts to the same change, and a
 *     `document.querySelector` reached into whichever pane's nav button came
 *     first in the DOM. (With two panes open, both panels still restore focus
 *     into their own StepForm — that they both react at all is the shared
 *     selection slice, not this hook.)
 *   - Buttons are identified by `data-step-nav`, not by an aria-label
 *     substring. Those labels come from `t()`, so matching the English `Next`
 *     found nothing in any of the other nine locales and focus restoration
 *     silently did not happen at all.
 *
 *   Focus goes back to the control the user was ON, not to a fixed favourite
 *   (audit R2, #588). `next` first regardless of direction meant walking
 *   BACKWARD landed on Next every time, so the next Enter reversed the
 *   direction the user had established — two keystrokes per step, alternating.
 *   The remembered nav is captured from `focusin` rather than read here,
 *   because by the time this effect runs the remount has already sent focus to
 *   `document.body`; NAV_ORDER remains the fallback for the first navigation
 *   and for a remembered button that is now disabled (the end of the list).
 *
 * @coordinates-with src/components/Editor/WorkflowEditor/StepForm.tsx — the nav buttons
 * @module components/Editor/WorkflowEditor/useStepFocusRestore
 */
import { useEffect, useRef, type RefObject } from "react";

/** The nav buttons, in the order focus should try them. */
const NAV_ORDER = [
  { nav: "next", enabledOnly: true },
  { nav: "prev", enabledOnly: true },
  { nav: "back-to-job", enabledOnly: false },
] as const;

export function useStepFocusRestore(
  selectedStepId: string | null,
  rootRef: RefObject<HTMLElement | null>,
): void {
  const prevStepIdRef = useRef<string | null>(null);
  /** The nav control focus was last on — the direction the user is travelling. */
  const lastNavRef = useRef<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const remember = (e: FocusEvent): void => {
      const target = e.target as HTMLElement | null;
      const nav = target?.closest?.("[data-step-nav]")?.getAttribute("data-step-nav");
      if (nav !== null && nav !== undefined) lastNavRef.current = nav;
    };
    root.addEventListener("focusin", remember);
    return () => root.removeEventListener("focusin", remember);
  }, [rootRef]);

  useEffect(() => {
    const wasStepNavigation =
      prevStepIdRef.current !== null &&
      selectedStepId !== null &&
      prevStepIdRef.current !== selectedStepId;
    prevStepIdRef.current = selectedStepId;
    if (!wasStepNavigation) return;
    const id = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const preferred = lastNavRef.current;
      const order =
        preferred === null
          ? NAV_ORDER
          : [
              ...NAV_ORDER.filter((n) => n.nav === preferred),
              ...NAV_ORDER.filter((n) => n.nav !== preferred),
            ];
      for (const { nav, enabledOnly } of order) {
        const found = root.querySelector<HTMLElement>(
          `[data-step-nav="${nav}"]${enabledOnly ? ":not([disabled])" : ""}`,
        );
        if (found) {
          found.focus();
          return;
        }
      }
    });
    return () => cancelAnimationFrame(id);
  }, [selectedStepId, rootRef]);
}
