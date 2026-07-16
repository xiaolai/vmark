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
import { isBrowserTab } from "@/stores/tabStoreTypes";
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
  // A browser tab owns this lane: its StatusBar workspace controls are its only
  // bottom chrome, and both the editor formatting toolbar and the find bar would cover
  // it — neither applies to a native page (VMark's find searches the editor
  // document, which a browser tab has none of). Boolean selector, so a plain tab
  // switch re-renders only when the document↔browser kind actually flips.
  const activeIsBrowser = useTabStore((s) => {
    const id = s.activeTabId[windowLabel] ?? null;
    if (!id) return false;
    const tab = (s.tabs[windowLabel] ?? []).find((t) => t.id === id);
    return !!tab && isBrowserTab(tab);
  });

  return (
    <>
      <StatusBar />
      {hasActiveTab && !activeIsBrowser && <UniversalToolbar />}
      {!activeIsBrowser && <FindBar />}
    </>
  );
}
