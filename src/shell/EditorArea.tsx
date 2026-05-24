/**
 * EditorArea — composes the editor pane, bottom-bar mux, and optional
 * side/bottom panel (terminal today; Assistant pane tomorrow).
 *
 * Per ADR-007, EditorArea is a pure layout helper — no store imports.
 * The dynamic panel positioning (right vs bottom) is the only layout
 * intelligence; everything else is pass-through composition.
 *
 * The editor + bottom-bar are siblings inside a flex column so the
 * 40px bottom bar always hugs the editor. The panel arranges around
 * that column based on panelPosition.
 *
 * @module shell/EditorArea
 */

import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

const BOTTOM_BAR_HEIGHT = 40;

export type PanelPosition = "right" | "bottom";

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

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: panelPosition === "right" ? "row" : "column",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        role="main"
        aria-label={t("aria.mainContent")}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>{editor}</div>
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
      {panel}
    </div>
  );
}
