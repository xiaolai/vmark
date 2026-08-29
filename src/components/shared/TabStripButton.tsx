/**
 * TabStripButton
 *
 * Purpose: the one add/close button for the tab strips that use it — the
 * document strip (StatusBar/Tab) and the browser page tabs. Before WI-UI2.3
 * each strip drew its own: three sizes, two radii, two glyph sizes. The
 * terminal tab bar was NOT adopted: its buttons (new/swap/restart/close) are
 * icon ACTIONS on raw `.vm-icon-btn--sm` elements, not strip add/close
 * chrome, so it stays on the primitive directly.
 *
 * `kind="add"` is a canonical `.vm-icon-btn--sm` square with a 14px Plus;
 * `kind="close"` is the shared `.tab-strip-close` paint (14px round, D2
 * hit-box expander to `--target-min`) with a 12px X. Strips may pass their
 * own residual class (reveal-on-hover, layout) via `className`.
 *
 * @coordinates-with src/styles/icon-button-shared.css — owns both recipes
 * @module components/shared/TabStripButton
 */
import type { ButtonHTMLAttributes } from "react";
import { Plus, X } from "lucide-react";
import { ICON_SM, ICON_XS } from "@/utils/iconSizes";

interface TabStripButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind: "add" | "close";
  /** Accessible name; also the tooltip. */
  label: string;
}

export function TabStripButton({ kind, label, className, ...rest }: TabStripButtonProps) {
  return (
    <button
      type="button"
      className={[kind === "add" ? "vm-icon-btn vm-icon-btn--sm" : "tab-strip-close", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      title={label}
      {...rest}
    >
      {kind === "add" ? <Plus size={ICON_SM} /> : <X size={ICON_XS} />}
    </button>
  );
}
