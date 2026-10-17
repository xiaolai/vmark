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
 * Nothing mounts until the window has announced that it is listening
 * (`windowListening`): building a large document's view is seconds of
 * main-thread work on a slow machine, and started earlier it starved the
 * listeners the announcement waits on (#1565). The gate sits above every
 * hook, so the panes mount fresh when it opens and scroll sync binds to them.
 *
 * @coordinates-with stores/paneStore.ts — split layout + focus + fraction
 * @coordinates-with contexts/PaneContext.tsx — provides each pane's tabId
 * @coordinates-with components/Editor/Editor.tsx — the per-pane surface
 * @coordinates-with contexts/windowListening.ts — the gate the surface waits on
 * @module components/Editor/DocumentSplit/DocumentSplitContainer
 */
import { useRef, type CSSProperties } from "react";
import { useWindowLabel } from "@/contexts/WindowContext";
import { PaneProvider } from "@/contexts/PaneContext";
import { useWindowListening } from "@/contexts/windowListening";
import { usePaneStore } from "@/stores/paneStore";
import { useUIStore } from "@/stores/uiStore";
import { Editor } from "../Editor";
import { SplitDivider } from "./SplitDivider";
import { useSyncPaneScroll } from "./useSyncPaneScroll";
import "./document-split.css";

export function DocumentSplitContainer() {
  return useWindowListening() ? <DocumentSplitPanes /> : null;
}

function DocumentSplitPanes() {
  const windowLabel = useWindowLabel();
  const split = usePaneStore((state) => state.byWindow[windowLabel]);

  const primaryRef = useRef<HTMLDivElement>(null);
  const secondaryRef = useRef<HTMLDivElement>(null);
  const enabled = split?.enabled ?? false;
  const primaryTabId = split?.primaryTabId ?? null;
  const secondaryTabId = split?.secondaryTabId ?? null;
  // Source/WYSIWYG swaps the scroller element without changing the tab, so the
  // mode is part of the re-bind key (#1081 L1).
  const sourceMode = useUIStore((state) => state.sourceMode);

  // Hooks before any early return. Scroll sync no-ops unless the split is open
  // AND syncScroll is on; re-binds when a pane's document or view mode changes.
  useSyncPaneScroll(
    primaryRef,
    secondaryRef,
    enabled && (split?.syncScroll ?? false),
    `${primaryTabId}:${secondaryTabId}:${sourceMode}`,
  );

  // Single pane — unchanged.
  if (!enabled || !split) {
    return <Editor />;
  }

  const { fraction, focusedPane } = split;
  const focusPrimary = () => usePaneStore.getState().setFocusedPane(windowLabel, "primary");
  const focusSecondary = () => usePaneStore.getState().setFocusedPane(windowLabel, "secondary");

  return (
    <div className="document-split">
      <div
        ref={primaryRef}
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
        fraction={fraction}
        onResize={(f) => usePaneStore.getState().setFraction(windowLabel, f)}
      />

      <div
        ref={secondaryRef}
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
