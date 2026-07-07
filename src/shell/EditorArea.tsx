/**
 * EditorArea — composes the editor pane, bottom-bar mux, and optional
 * side/bottom panel (terminal today; Assistant pane tomorrow).
 *
 * Per ADR-007, EditorArea is a pure layout helper — no store imports.
 * The dynamic panel positioning (top/bottom/left/right) is the only layout
 * intelligence: left/right use a row axis, top/left render the panel before
 * the editor. Everything else is pass-through composition.
 *
 * The editor + bottom-bar are siblings inside a flex column so the
 * 40px bottom bar always hugs the editor. The panel arranges around
 * that column based on panelPosition.
 *
 * The `main` ARIA landmark wraps only the editor (not the bottom bar) so
 * StatusBar's `contentinfo` landmark stays a top-level sibling.
 *
 * @module shell/EditorArea
 */

import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

const BOTTOM_BAR_HEIGHT = 40;

type PanelPosition = "top" | "bottom" | "left" | "right";

export interface EditorAreaProps {
  /** The editor surface. */
  editor: ReactNode;
  /** Bottom-bar mux (StatusBar / Toolbar / FindBar). Renders in 40px lane. */
  bottomBar: ReactNode;
  /** Optional side or bottom panel (terminal today). */
  panel?: ReactNode;
  /** Where the panel sits relative to the editor. */
  panelPosition: PanelPosition;
}

export function EditorArea({
  editor,
  bottomBar,
  panel,
  panelPosition,
}: EditorAreaProps) {
  const { t } = useTranslation();

  // left/right share a row axis; top/left render the panel before the editor.
  const horizontal = panelPosition === "left" || panelPosition === "right";
  const panelFirst = panelPosition === "top" || panelPosition === "left";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {panelFirst && panel}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {/* `role="main"` wraps only the editor so the bottom bar's
            contentinfo landmark (StatusBar) stays a top-level sibling, not
            nested inside main (axe landmark-contentinfo-is-top-level). */}
        <div
          role="main"
          aria-label={t("aria.mainContent")}
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        >
          {editor}
        </div>
        <div
          style={{
            position: "relative",
            height: BOTTOM_BAR_HEIGHT,
            flexShrink: 0,
          }}
        >
          {bottomBar}
        </div>
      </div>
      {!panelFirst && panel}
    </div>
  );
}
