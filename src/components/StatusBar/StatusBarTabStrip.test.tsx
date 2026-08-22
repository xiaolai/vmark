// WI-TNAV1.2 — fade masks and chevrons. WI-TNAV1.4 — the focusable, named
// scroll region. WI-DSPL1.1 — the pane indicator.
import { describe, it, expect, vi, beforeEach } from "vitest";

// The real WindowProvider gates its children on Tauri window init, so it
// renders nothing under jsdom. Mock the hook, as StatusBar.test.tsx:12 does.
vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusBarTabStrip } from "./StatusBarTabStrip";
import { usePaneStore, DEFAULT_SPLIT } from "@/stores/paneStore";
import type { Tab as TabType } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";

// Local ResizeObserver shim. `src/test/setup.ts:24-29` deliberately defines NO
// global one — doing so makes mermaid/markmap render code proceed past their
// own RO check and then fail on a different jsdom gap — so files that need it
// bring their own. WI-TNAV1.2 put `useTabStripOverflow` in this component's
// tree, and the hook constructs one unconditionally.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function makeTab(overrides: Partial<TabType> = {}): TabType {
  return {
    id: "t1",
    filePath: "/root/a.md",
    title: "a.md",
    isPinned: false,
    formatId: "markdown",
    ...overrides,
  };
}

const noopDrag = {
  getTabDragHandlers: () => ({ onPointerDown: vi.fn() }),
} as never;

function setup(props: Partial<Parameters<typeof StatusBarTabStrip>[0]> = {}) {
  return render(
    <StatusBarTabStrip
      tabs={[makeTab()]}
      activeTabId="t1"
      showTabs
      showNewTabButton
      isDragging={false}
      isReordering={false}
      dragTabId={null}
      dropIndex={null}
      isDropInvalid={false}
      isReorderBlocked={false}
      snapbackTabId={null}
      getTabDragHandlers={(noopDrag as { getTabDragHandlers: unknown }).getTabDragHandlers as never}
      onActivateTab={vi.fn()}
      onCloseTab={vi.fn()}
      onContextMenu={vi.fn()}
      onTabKeyDown={vi.fn()}
      onNewTab={vi.fn()}
      onActivateBrowserWorkspace={vi.fn()}
      {...props}
    />,
  );
}

describe("StatusBarTabStrip", () => {
  beforeEach(() => {
    // Ensure document-derived per-tab flags resolve to defaults.
    useDocumentStore.setState({ documents: {} } as never);
  });

  it("renders a tablist with one tab per entry", () => {
    setup({
      tabs: [makeTab({ id: "t1", title: "one" }), makeTab({ id: "t2", title: "two" })],
    });
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("marks the active tab via aria-selected", () => {
    setup({
      tabs: [makeTab({ id: "t1", title: "one" }), makeTab({ id: "t2", title: "two" })],
      activeTabId: "t2",
    });
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  });

  it("calls onNewTab when the new-tab button is clicked", async () => {
    const user = userEvent.setup();
    const onNewTab = vi.fn();
    setup({ onNewTab });
    await user.click(screen.getByRole("button", { name: /new tab/i }));
    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it("new-tab tooltip surfaces the shortcut, with title/aria-label parity", () => {
    useShortcutsStore.setState({ customBindings: {} });
    setup();
    const btn = screen.getByRole("button", { name: /new tab/i });
    const display = formatKeyForDisplay(useShortcutsStore.getState().getShortcut("newTab"));
    expect(display).not.toBe("");
    expect(btn.getAttribute("title")).toContain(display);
    expect(btn.getAttribute("title")).toBe(btn.getAttribute("aria-label"));
  });

  it("hides the new-tab button when showNewTabButton is false", () => {
    setup({ showNewTabButton: false });
    expect(
      screen.queryByRole("button", { name: /new tab/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onActivateTab with the tab id when a tab is clicked", async () => {
    const user = userEvent.setup();
    const onActivateTab = vi.fn();
    setup({ tabs: [makeTab({ id: "t1", title: "one" })], onActivateTab });
    await user.click(screen.getByRole("tab"));
    expect(onActivateTab).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("calls onCloseTab when a tab's close button is clicked", async () => {
    const user = userEvent.setup();
    const onCloseTab = vi.fn();
    setup({
      tabs: [makeTab({ id: "t1", title: "one", isPinned: false })],
      onCloseTab,
    });
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("renders no tablist when showTabs is false", () => {
    setup({ showTabs: false });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  describe("browser workspace tab", () => {
    it("is absent when there are no browser pages", () => {
      setup({ browserWorkspaceCount: 0 });
      expect(screen.queryByRole("tab", { name: /browser/i })).not.toBeInTheDocument();
    });

    it("renders when there are browser pages", () => {
      setup({ browserWorkspaceCount: 2, browserWorkspaceActive: false });
      expect(screen.getByRole("tab", { name: /browser/i })).toBeInTheDocument();
    });

    it("activates the workspace on click", async () => {
      const user = userEvent.setup();
      const onActivateBrowserWorkspace = vi.fn();
      setup({ browserWorkspaceCount: 1, onActivateBrowserWorkspace });
      await user.click(screen.getByRole("tab", { name: /browser/i }));
      expect(onActivateBrowserWorkspace).toHaveBeenCalledOnce();
    });

    it("activates the workspace on Enter (native button)", async () => {
      const user = userEvent.setup();
      const onActivateBrowserWorkspace = vi.fn();
      setup({ browserWorkspaceCount: 1, browserWorkspaceActive: true, onActivateBrowserWorkspace });
      const wsTab = screen.getByRole("tab", { name: /browser/i });
      wsTab.focus();
      await user.keyboard("{Enter}");
      expect(onActivateBrowserWorkspace).toHaveBeenCalled();
    });

    it("is focusable (tabindex 0) and excluded from drop math when active", () => {
      setup({ browserWorkspaceCount: 1, browserWorkspaceActive: true });
      const wsTab = screen.getByRole("tab", { name: /browser/i });
      expect(wsTab).toHaveAttribute("tabindex", "0");
      expect(wsTab).toHaveAttribute("data-workspace-tab");
    });

    it("has roving tabindex -1 when not the active tab", () => {
      setup({ browserWorkspaceCount: 1, browserWorkspaceActive: false });
      expect(screen.getByRole("tab", { name: /browser/i })).toHaveAttribute("tabindex", "-1");
    });

    it("renders the trailing drop indicator before the workspace tab", () => {
      setup({
        tabs: [makeTab({ id: "t1", title: "one" })],
        browserWorkspaceCount: 1,
        isReordering: true,
        dropIndex: 1, // >= documentTabs.length → end-of-documents drop
        dragTabId: "t1",
      });
      const tablist = screen.getByRole("tablist");
      const indicator = tablist.querySelector(".tab-drop-indicator");
      const wsTab = screen.getByRole("tab", { name: /browser/i });
      expect(indicator).toBeInTheDocument();
      // The indicator must precede the synthetic workspace tab in the DOM.
      expect(
        indicator!.compareDocumentPosition(wsTab) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("ArrowLeft moves focus from the workspace tab to the preceding document tab", () => {
      setup({
        tabs: [makeTab({ id: "t1", title: "one" })],
        activeTabId: null as never,
        browserWorkspaceCount: 1,
        browserWorkspaceActive: true,
      });
      const wsTab = screen.getByRole("tab", { name: /browser/i });
      const docTab = screen.getByRole("tab", { name: /one/i });
      wsTab.focus();
      fireEvent.keyDown(wsTab, { key: "ArrowLeft" });
      expect(document.activeElement).toBe(docTab);
    });
  });
});

// ---------------------------------------------------------------------------
// WI-TNAV1.2 / WI-TNAV1.4 — the overflow affordance and the scroll region.
// ---------------------------------------------------------------------------

/** Give the scroll region real geometry; jsdom reports 0 for all of it. */
function setGeometry(el: HTMLElement, { clientWidth = 400, scrollWidth = 400, scrollLeft = 0 } = {}) {
  Object.defineProperty(el, "clientWidth", { get: () => clientWidth, configurable: true });
  Object.defineProperty(el, "scrollWidth", { get: () => scrollWidth, configurable: true });
  Object.defineProperty(el, "scrollLeft", {
    get: () => scrollLeft,
    set: (v: number) => {
      scrollLeft = v;
    },
    configurable: true,
  });
}

const scrollRegion = () => screen.getByRole("group", { name: /open tabs/i });
const chevrons = () => screen.queryAllByRole("button", { name: /scroll tabs (left|right)/i });

describe("StatusBarTabStrip — scroll region (WI-TNAV1.4)", () => {
  it("exposes a focusable, accessibly named scroll region", () => {
    setup();
    const region = scrollRegion();
    expect(region).toHaveAttribute("tabindex", "0");
    // A tabindex with no name is the axe `scrollable-region-focusable` failure
    // this requirement exists for.
    expect(region).toHaveAccessibleName();
  });

  it("keeps the scroll region out of the roving focus order between pills", async () => {
    // `tabindex="0"` on the `role="tablist"` element itself would put the
    // container in the arrow-key path and break the roving contract.
    //
    // Driven from the WORKSPACE pill, which is the only pill whose keydown this
    // component owns — document pills delegate to the `onTabKeyDown` prop, which
    // the harness mocks, so an ArrowRight from one of those would assert the
    // mock rather than the behaviour.
    setup({
      tabs: [makeTab({ id: "t1", title: "one" }), makeTab({ id: "t2", title: "two" })],
      browserWorkspaceCount: 2,
      browserWorkspaceActive: true,
    });
    const workspacePill = screen.getByRole("tab", { name: /browser/i });
    workspacePill.focus();
    fireEvent.keyDown(workspacePill, { key: "ArrowLeft" });

    const documentPills = screen.getAllByRole("tab").filter((el) => el !== workspacePill);
    expect(document.activeElement).toBe(documentPills[documentPills.length - 1]);
    expect(document.activeElement).not.toBe(scrollRegion());
  });

  it("names the region from the bundle, not a hardcoded literal", () => {
    // `lint:i18n` checks bundles, not JSX, so a literal is invisible to it.
    setup();
    expect(scrollRegion()).toHaveAccessibleName("Open tabs");
  });
});

describe("StatusBarTabStrip — chevrons and masks (WI-TNAV1.2)", () => {
  it.each([
    { label: "no overflow", scrollWidth: 400 },
    { label: "sub-epsilon overflow", scrollWidth: 400.4 },
  ])("renders no chevrons without overflow ($label)", async ({ scrollWidth }) => {
    // Rendering them unconditionally with a `hidden` class puts two focusable
    // buttons permanently in the tab order.
    setup({ tabs: [makeTab({ id: "t1" }), makeTab({ id: "t2", title: "two" })] });
    setGeometry(scrollRegion(), { clientWidth: 400, scrollWidth });
    fireEvent.scroll(scrollRegion());
    await screen.findByRole("tablist");
    expect(chevrons()).toHaveLength(0);
  });

  it("shows chevrons on overflow and scrolls by a step proportional to the width", async () => {
    // Two widths, because one example admits a hardcoded `scrollBy(100)`.
    const steps: number[] = [];
    for (const clientWidth of [400, 800]) {
      const view = setup({ tabs: [makeTab({ id: "t1" }), makeTab({ id: "t2", title: "two" })] });
      const region = scrollRegion();
      setGeometry(region, { clientWidth, scrollWidth: clientWidth * 3 });
      const scrollBy = vi.fn();
      region.scrollBy = scrollBy as never;
      fireEvent.scroll(region);

      const right = await screen.findByRole("button", { name: /scroll tabs right/i });
      await userEvent.click(right);
      expect(scrollBy).toHaveBeenCalled();
      const arg = scrollBy.mock.calls[0][0] as { left: number };
      expect(arg.left).toBeGreaterThan(0);
      steps.push(arg.left);
      view.unmount();
    }
    // The assertion is a RELATION, so tuning the proportion does not break it.
    expect(steps[1]).toBeGreaterThan(steps[0]);
  });

  it("scrolls with behavior auto under prefers-reduced-motion", async () => {
    // The chevrons had their own copy of the policy and no test asserted it,
    // so the same preference produced two behaviours in one strip.
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q }));
    setup({ tabs: [makeTab({ id: "t1" }), makeTab({ id: "t2", title: "two" })] });
    const region = scrollRegion();
    setGeometry(region, { clientWidth: 400, scrollWidth: 1200 });
    const scrollBy = vi.fn();
    region.scrollBy = scrollBy as never;
    fireEvent.scroll(region);

    await userEvent.click(await screen.findByRole("button", { name: /scroll tabs right/i }));
    expect((scrollBy.mock.calls[0][0] as { behavior: string }).behavior).toBe("auto");
    // Restore ONLY matchMedia. `vi.unstubAllGlobals()` would also drop the
    // module-level ResizeObserver stub this file installs, breaking every test
    // that runs after it.
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
  });

  it("keeps chevrons outside the tablist in every overflow state", async () => {
    for (const scrollWidth of [400, 1200]) {
      const view = setup({ tabs: [makeTab({ id: "t1" }), makeTab({ id: "t2", title: "two" })] });
      const region = scrollRegion();
      setGeometry(region, { clientWidth: 400, scrollWidth, scrollLeft: scrollWidth > 400 ? 100 : 0 });
      fireEvent.scroll(region);
      await screen.findByRole("tablist");

      const tablist = screen.getByRole("tablist");
      // Chevrons inside `.status-tabs` would scroll away with the content —
      // exactly how this regresses, because absolute positioning is easier
      // against the scrolling parent.
      expect(
        Array.from(tablist.querySelectorAll("button")).filter((b) =>
          /scroll tabs/i.test(b.getAttribute("aria-label") ?? ""),
        ),
      ).toHaveLength(0);
      for (const child of Array.from(tablist.children)) {
        expect(child.matches('[role="tab"], .tab-drop-indicator')).toBe(true);
      }
      view.unmount();
    }
  });
});

describe("StatusBarTabStrip — pane indicator (WI-DSPL1.1)", () => {
  const twoTabs = [makeTab({ id: "t1", title: "one" }), makeTab({ id: "t2", title: "two" })];
  const enableSplit = (focusedPane: "primary" | "secondary") =>
    usePaneStore.setState({
      byWindow: {
        main: { ...DEFAULT_SPLIT, enabled: true, primaryTabId: "t1", secondaryTabId: "t2", focusedPane },
      },
    });

  beforeEach(() => usePaneStore.setState({ byWindow: {} }));

  it("marks nothing when no split is open", () => {
    setup({ tabs: twoTabs });
    expect(document.querySelectorAll("[data-pane-indicator]")).toHaveLength(0);
  });

  it("follows the NON-focused pane in both directions (D8)", () => {
    enableSplit("secondary");
    const first = setup({ tabs: twoTabs, activeTabId: "t2" });
    expect(document.querySelector("[data-pane-indicator]")).toHaveAttribute("data-tab-id", "t1");
    first.unmount();

    enableSplit("primary");
    setup({ tabs: twoTabs, activeTabId: "t1" });
    expect(document.querySelector("[data-pane-indicator]")).toHaveAttribute("data-tab-id", "t2");
  });

  it("describes the indicated pill via aria-describedby, not aria-description", () => {
    // `aria-description` is an ARIA 1.3 draft attribute; WebKit/VoiceOver — this
    // app's primary platform — is where its support is weakest, so the
    // description would never actually be announced.
    enableSplit("primary");
    setup({ tabs: twoTabs, activeTabId: "t1" });
    const pill = document.querySelector("[data-pane-indicator]")!;
    expect(pill).not.toHaveAttribute("aria-description");
    const describedBy = pill.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBeTruthy();
  });

  it("keeps at most one aria-selected, and never puts it on the indicated pill", () => {
    enableSplit("primary");
    setup({ tabs: twoTabs, activeTabId: "t1" });
    const selected = document.querySelectorAll('[role="tab"][aria-selected="true"]');
    expect(selected.length).toBeLessThanOrEqual(1);
    expect(document.querySelector("[data-pane-indicator]")).not.toHaveAttribute("aria-selected", "true");
  });

  it("is suppressed while the browser workspace is active, describing nothing (R3)", () => {
    // The native webview paints above all DOM, so no document pane is on screen
    // — a screen-reader description of a second pane would be false.
    enableSplit("primary");
    setup({ tabs: twoTabs, activeTabId: null, browserWorkspaceCount: 1, browserWorkspaceActive: true });
    expect(document.querySelectorAll("[data-pane-indicator]")).toHaveLength(0);
    expect(document.querySelector("[aria-describedby]")).toBeNull();
    expect(document.querySelector(".sr-only")).toBeNull();
  });
});
