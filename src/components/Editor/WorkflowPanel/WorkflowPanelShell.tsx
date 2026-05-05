/**
 * Purpose: Reusable split-pane shell for both the GHA workflow viewer
 *   (this plan) and the existing Genie workflow viewer (20260331 plan).
 *   Owns: split layout, resize handle, persisted geometry — nothing
 *   feature-specific.
 *
 * Key decisions:
 *   - Per ADR-10, this shell is feature-agnostic. Children are passed
 *     via the `left` and `right` props.
 *   - Geometry persistence is intentionally scoped to this component
 *     via a small in-process useState; full session persistence
 *     ships in a follow-up.
 *
 * @module components/Editor/WorkflowPanel/WorkflowPanelShell
 */

import { useCallback, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./workflow-panel-shell.css";

interface WorkflowPanelShellProps {
  /** Left pane (typically a CodeMirror source editor). */
  left: ReactNode;
  /** Right pane (typically a diagram canvas). */
  right: ReactNode;
  /** Initial split position as a fraction of the container width [0.15, 0.85]. */
  initialSplit?: number;
  /** Optional aria-label for the shell as a whole. */
  ariaLabel?: string;
}

const MIN_SPLIT = 0.15;
const MAX_SPLIT = 0.85;
const clamp = (n: number) => Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, n));

export function WorkflowPanelShell(
  props: WorkflowPanelShellProps,
): ReactElement {
  const { left, right, initialSplit = 0.45, ariaLabel } = props;
  const { t } = useTranslation("workflowEditor");
  const [split, setSplit] = useState(() => clamp(initialSplit));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSplit(clamp((e.clientX - rect.left) / rect.width));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      ref={containerRef}
      className="gha-panel-shell"
      role="group"
      aria-label={ariaLabel}
    >
      <div
        className="gha-panel-shell__pane gha-panel-shell__pane--left"
        style={{ flexBasis: `${split * 100}%` }}
      >
        {left}
      </div>
      <div
        className="gha-panel-shell__handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("panel.shell.resize")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="gha-panel-shell__pane gha-panel-shell__pane--right">
        {right}
      </div>
    </div>
  );
}
