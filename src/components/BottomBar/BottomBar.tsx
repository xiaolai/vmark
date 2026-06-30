/**
 * BottomBar — the 40px bottom-lane mux: StatusBar (tab strip + counts + "+"),
 * the editor formatting UniversalToolbar, and FindBar.
 *
 * Owns the "is a document open?" check so the empty-workspace window (Welcome
 * screen) doesn't sit under the editor formatting toolbar. StatusBar and
 * FindBar always render — StatusBar carries the tab strip and "+" button, the
 * in-window way to start a new document.
 *
 * Owning the active-tab gate here (rather than in App.tsx's MainLayout) keeps
 * per-tab-switch re-renders off the whole shell composition and makes the gate
 * unit-testable.
 *
 * @coordinates-with App.tsx — rendered in EditorArea's bottomBar slot
 * @module components/BottomBar/BottomBar
 */
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { StatusBar } from "@/components/StatusBar";
import { UniversalToolbar } from "@/components/Editor/UniversalToolbar";
import { FindBar } from "@/components/FindBar";

export function BottomBar() {
  const windowLabel = useWindowLabel();
  // Boolean selector: a tab *switch* (id change) must NOT re-render this bar —
  // only a transition between "a tab is open" and "empty workspace" does.
  const hasActiveTab = useTabStore(
    (s) => (s.activeTabId[windowLabel] ?? null) !== null,
  );

  return (
    <>
      <StatusBar />
      {hasActiveTab && <UniversalToolbar />}
      <FindBar />
    </>
  );
}
