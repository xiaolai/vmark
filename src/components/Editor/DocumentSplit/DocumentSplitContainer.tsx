/**
 * DocumentSplitContainer — renders one or two document panes (#1081).
 *
 * With no split open it renders a single <Editor/>, byte-for-byte the old
 * behavior. When the window's split is enabled it renders the primary and
 * secondary panes side-by-side (or stacked), each wrapped in a PaneProvider so
 * its <Editor/> resolves that pane's document, with a draggable divider.
 *
 * Focus tracking: clicking/tabbing into a pane sets it as the focused pane (the
 * one the toolbar/find/menus act on) via onFocusCapture.
 *
 * @coordinates-with stores/paneStore.ts — split layout + focus + fraction
 * @coordinates-with contexts/PaneContext.tsx — provides each pane's tabId
 * @coordinates-with components/Editor/Editor.tsx — the per-pane surface
 * @module components/Editor/DocumentSplit/DocumentSplitContainer
 */
import type { CSSProperties } from "react";
import { useWindowLabel } from "@/contexts/WindowContext";
import { PaneProvider } from "@/contexts/PaneContext";
import { usePaneStore } from "@/stores/paneStore";
import { useTabStore } from "@/stores/tabStore";
import { Editor } from "../Editor";
import { SplitDivider } from "./SplitDivider";
import "./document-split.css";

export function DocumentSplitContainer() {
  const windowLabel = useWindowLabel();
  const split = usePaneStore((state) => state.byWindow[windowLabel]);
  const primaryTabId = useTabStore((state) => state.activeTabId[windowLabel] ?? null);

  // Single pane — unchanged.
  if (!split?.enabled) {
    return <Editor />;
  }

  const { orientation, fraction, secondaryTabId, focusedPane } = split;
  const focusPrimary = () => usePaneStore.getState().setFocusedPane(windowLabel, "primary");
  const focusSecondary = () => usePaneStore.getState().setFocusedPane(windowLabel, "secondary");

  return (
    <div className={`document-split document-split--${orientation}`}>
      <div
        className="document-split__pane"
        style={{ flexGrow: fraction } as CSSProperties}
        data-focused={focusedPane === "primary"}
        onFocusCapture={focusPrimary}
        onMouseDownCapture={focusPrimary}
      >
        <PaneProvider value={{ paneId: "primary", tabId: primaryTabId }}>
          <Editor />
        </PaneProvider>
      </div>

      <SplitDivider
        orientation={orientation}
        fraction={fraction}
        onResize={(f) => usePaneStore.getState().setFraction(windowLabel, f)}
      />

      <div
        className="document-split__pane"
        style={{ flexGrow: 1 - fraction } as CSSProperties}
        data-focused={focusedPane === "secondary"}
        onFocusCapture={focusSecondary}
        onMouseDownCapture={focusSecondary}
      >
        <PaneProvider value={{ paneId: "secondary", tabId: secondaryTabId }}>
          <Editor />
        </PaneProvider>
      </div>
    </div>
  );
}
