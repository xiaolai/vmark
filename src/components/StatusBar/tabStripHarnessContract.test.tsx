/**
 * The E2E harness reads the tab strip through DOM selectors. Nothing joins the
 * two.
 *
 * `e2e/lib/vmark.mjs` snapshots the strip with querySelector strings evaluated
 * inside the live webview. A change to what this component renders — an
 * attribute renamed, a second kind of tab added — type-checks, lints and ships;
 * the only symptom is a journey that reports the wrong thing about a healthy
 * app. Both directions have already happened:
 *
 *   - the document-tab selector requires `data-tab-id`, and the synthetic
 *     browser-workspace tab has none, so a browser-active session read as
 *     "tabs open but none active" (a false FAILURE) and a browser-only session
 *     read as an empty welcome screen (a false PASS that skipped the surface
 *     check entirely);
 *   - `.browser-workspace` was written for a class no element carries, which
 *     could only ever have timed out.
 *
 * So the snippets are evaluated here against the DOM the REAL component
 * renders, read from the harness source rather than restated — a copy here
 * would pass while the harness stayed broken.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
import { render } from "@testing-library/react";
import { StatusBarTabStrip } from "./StatusBarTabStrip";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useDocumentStore } from "@/stores/documentStore";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

/** Pull a snippet out of the harness source, so this test cannot hold a copy. */
function harnessSnippet(name: string): string {
  const source = readFileSync("e2e/lib/vmark.mjs", "utf8");
  const match = source.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`${name} not found in e2e/lib/vmark.mjs`);
  return match[1];
}

const TABS_SNIPPET = harnessSnippet("TABS_SNIPPET");
const WORKSPACE_TAB_SNIPPET = harnessSnippet("WORKSPACE_TAB_SNIPPET");

interface HarnessTab {
  id: string;
  title: string | null;
  selected: boolean;
  dirty: boolean;
}
interface HarnessWorkspaceTab {
  kind: string;
  title: string | null;
  selected: boolean;
}

function readDocumentTabs(): HarnessTab[] {
  return new Function(`return (${TABS_SNIPPET})`)() as HarnessTab[];
}
function readWorkspaceTab(): HarnessWorkspaceTab | null {
  return new Function(`return ${WORKSPACE_TAB_SNIPPET}`)() as HarnessWorkspaceTab | null;
}

/** Only id and title ever vary here, so the helper takes exactly those. A
 *  `Partial<DocumentTab>` parameter cannot be spread onto a `DocumentTab`
 *  under `exactOptionalPropertyTypes` without introducing explicit
 *  `undefined`s, and casting that away would hide the shape drift this
 *  contract test exists to notice. */
function makeTab(id: string, title = id): DocumentTab {
  return {
    kind: "document",
    id,
    filePath: `/root/${title}.md`,
    title,
    isPinned: false,
    formatId: "markdown",
  };
}

const noopDrag = {
  getTabDragHandlers: () => ({ onPointerDown: vi.fn() }),
} as never;

function setup(props: Partial<Parameters<typeof StatusBarTabStrip>[0]> = {}) {
  return render(
    <StatusBarTabStrip
      tabs={[makeTab("t1")]}
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

beforeEach(() => {
  useDocumentStore.setState({ documents: {} } as never);
});

describe("tab-strip ↔ E2E harness contract", () => {
  it("sees each document tab, with its id, title and selection", () => {
    setup({
      tabs: [makeTab("t1", "one"), makeTab("t2", "two")],
      activeTabId: "t2",
    });

    const seen = readDocumentTabs();
    expect(seen.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(seen.map((t) => t.title)).toEqual(["one", "two"]);
    expect(seen.map((t) => t.selected)).toEqual([false, true]);
  });

  it("does not mistake the browser-workspace tab for a document", () => {
    // It is a `role="tab"` too. Widening the document selector to catch it
    // would put an id-less entry into every count and lookup in the harness.
    setup({ tabs: [makeTab("t1", "one")], browserWorkspaceCount: 2 });
    expect(readDocumentTabs().map((t) => t.id)).toEqual(["t1"]);
  });

  it("sees the browser-workspace tab, and its selection", () => {
    setup({
      tabs: [makeTab("t1", "one")],
      browserWorkspaceCount: 1,
      browserWorkspaceActive: true,
    });

    const workspace = readWorkspaceTab();
    expect(workspace).not.toBeNull();
    expect(workspace?.kind).toBe("workspace");
    expect(workspace?.selected).toBe(true);
  });

  it("reports no workspace tab when no browser page is open", () => {
    setup({ tabs: [makeTab("t1")], browserWorkspaceCount: 0 });
    expect(readWorkspaceTab()).toBeNull();
  });

  it("leaves every document tab unselected while the browser workspace is active", () => {
    // This is the exact state that read as "tabs open but none active". It is
    // healthy, and the harness must be able to tell it apart from a broken one.
    setup({
      tabs: [makeTab("t1", "one"), makeTab("t2", "two")],
      activeTabId: null,
      browserWorkspaceCount: 1,
      browserWorkspaceActive: true,
    });

    expect(readDocumentTabs().some((t) => t.selected)).toBe(false);
    expect(readWorkspaceTab()?.selected).toBe(true);
  });

  it("renders the surface class the journey polls for", () => {
    // `.browser-workspace-surface`, not `.browser-workspace` — the latter
    // belongs to no element, and the first version of that check used it.
    const journey = readFileSync("e2e/journeys/01-boot-editor-ready.mjs", "utf8");
    const selectors = [...journey.matchAll(/querySelector\('\.([\w-]+)'\)/g)].map((m) => m[1]);
    expect(selectors).toContain("browser-workspace-surface");
    expect(selectors).not.toContain("browser-workspace");
  });
});
