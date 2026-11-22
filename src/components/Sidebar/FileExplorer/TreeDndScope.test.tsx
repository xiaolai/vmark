// #1714 — each file-explorer Tree mount owns one react-dnd manager, and its
// HTML5 backend is released when that mount goes away, even mid-drag.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Suspense, useLayoutEffect } from "react";
import type { DragDropManager } from "dnd-core";
import { NativeTypes } from "react-dnd-html5-backend";
import { TreeDndScope, createTreeDnd } from "./TreeDndScope";

function backendSetUp(): boolean {
  return Boolean((window as unknown as { __isReactDndBackendSetUp?: boolean }).__isReactDndBackendSetUp);
}

/** Stands in for a mounted Tree: registers a NODE drop target on the scope's manager. */
function FakeTree({ manager, onManager }: { manager: DragDropManager; onManager: (m: DragDropManager) => void }) {
  onManager(manager);
  return <TargetRegistration manager={manager} />;
}

function TargetRegistration({ manager }: { manager: DragDropManager }) {
  // Registered and released in a layout effect, exactly as react-dnd's useDrop does.
  useLayoutEffect(() => {
    const registry = manager.getRegistry();
    const id = registry.addTarget("NODE", { canDrop: () => true, hover: () => {}, drop: () => undefined });
    return () => registry.removeTarget(id);
  }, [manager]);
  return null;
}

const NODE_TARGET = { canDrop: () => true, hover: () => {}, drop: () => undefined };

/** A drag the webview saw start but never saw finish (no drop, no final leave). */
function nativeDragEnter(types: string[] = ["Files"]): void {
  const event = new Event("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types, files: [], items: [], getData: () => "", setData: () => {} },
  });
  document.body.dispatchEvent(event);
}

function renderScope(key: string, seen: DragDropManager[]) {
  return (
    <TreeDndScope key={key}>
      {(manager) => <FakeTree manager={manager} onManager={(m) => seen.push(m)} />}
    </TreeDndScope>
  );
}

afterEach(() => {
  cleanup();
  expect(backendSetUp()).toBe(false);
});

describe("TreeDndScope (#1714)", () => {
  it("hands its Tree the same manager on every render of one mount", () => {
    const seen: DragDropManager[] = [];
    const { rerender } = render(renderScope("a", seen));
    rerender(renderScope("a", seen));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);
  });

  it("gives a remounted Tree a fresh manager", () => {
    const seen: DragDropManager[] = [];
    const { rerender } = render(renderScope("a", seen));
    rerender(renderScope("b", seen));
    expect(new Set(seen).size).toBe(2);
  });

  it("releases the backend on unmount even while a native drag is stuck open", () => {
    const seen: DragDropManager[] = [];
    const { unmount } = render(renderScope("a", seen));
    expect(backendSetUp()).toBe(true);

    act(() => nativeDragEnter());
    expect(seen[0].getMonitor().isDragging()).toBe(true);

    unmount();
    expect(backendSetUp()).toBe(false);
  });

  it.each([["Files"], ["text/plain"], ["text/uri-list"]])(
    "lets the next mount set up its own backend after a stuck %s drag",
    (type) => {
      const seen: DragDropManager[] = [];
      const first = render(renderScope("a", seen));
      act(() => nativeDragEnter([type]));
      first.unmount();

      expect(() => render(renderScope("b", seen))).not.toThrow();
      expect(backendSetUp()).toBe(true);
      // The new mount starts clean: the stuck drag died with its manager.
      expect(seen[seen.length - 1].getMonitor().isDragging()).toBe(false);
    },
  );

  it("releases the backend when nothing was ever dragged", () => {
    const seen: DragDropManager[] = [];
    const { unmount } = render(renderScope("a", seen));
    unmount();
    expect(backendSetUp()).toBe(false);
  });

  it("never clears another backend's window claim when released without setting up", () => {
    const flagHolder = window as unknown as { __isReactDndBackendSetUp?: boolean };
    flagHolder.__isReactDndBackendSetUp = true; // claimed by someone else
    try {
      createTreeDnd().release();
      createTreeDnd().manager.getBackend().teardown();
      expect(backendSetUp()).toBe(true);
    } finally {
      flagHolder.__isReactDndBackendSetUp = false;
    }
  });

  it("leaves the replacement backend's claim alone when the old one releases late", () => {
    const old = createTreeDnd();
    const oldTarget = old.manager.getRegistry().addTarget("NODE", NODE_TARGET);
    act(() => nativeDragEnter()); // stuck: the native source holds the old backend
    old.release();
    expect(backendSetUp()).toBe(false);

    const next = createTreeDnd();
    const nextTarget = next.manager.getRegistry().addTarget("NODE", NODE_TARGET);
    expect(backendSetUp()).toBe(true);

    // The old Tree's targets go after the scope released; dnd-core's own
    // release (and any repeat) must not touch the replacement's claim.
    old.manager.getRegistry().removeTarget(oldTarget);
    old.manager.getBackend().teardown();
    old.release();
    expect(backendSetUp()).toBe(true);

    next.manager.getRegistry().removeTarget(nextTarget);
    expect(backendSetUp()).toBe(false);
  });

  it("ignores a DOM drop that arrives while nothing is being dragged", () => {
    const dnd = createTreeDnd();
    const target = dnd.manager.getRegistry().addTarget("NODE", NODE_TARGET);
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e.error);
      e.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files: [], items: [] } });
      document.body.dispatchEvent(drop);
    } finally {
      window.removeEventListener("error", onError);
      dnd.manager.getRegistry().removeTarget(target);
    }
    expect(errors).toEqual([]);
  });

  it("sets the backend up again when Suspense reveals a Tree it hid mid native drag", async () => {
    let release: () => void = () => {};
    let suspended: Promise<void> | null = null;
    function MaybeSuspend() {
      if (suspended) throw suspended;
      return null;
    }
    const seen: DragDropManager[] = [];
    const ui = () => (
      <Suspense fallback={<p>loading</p>}>
        {renderScope("a", seen)}
        <MaybeSuspend />
      </Suspense>
    );
    const { rerender } = render(ui());
    act(() => nativeDragEnter());
    expect(backendSetUp()).toBe(true);

    suspended = new Promise<void>((resolve) => {
      release = () => {
        suspended = null;
        resolve();
      };
    });
    rerender(ui());
    expect(screen.getByText("loading")).toBeTruthy();
    expect(backendSetUp()).toBe(false); // hidden: released

    await act(async () => release());
    expect(screen.queryByText("loading")).toBeNull();
    expect(new Set(seen).size).toBe(1); // same mount, same manager
    expect(backendSetUp()).toBe(true); // revealed: attached again
  });

  it("starts a fresh native drag after a Suspense hide swallowed the last one's drop", async () => {
    let release: () => void = () => {};
    let suspended: Promise<void> | null = null;
    function MaybeSuspend() {
      if (suspended) throw suspended;
      return null;
    }
    const seen: DragDropManager[] = [];
    const ui = () => (
      <Suspense fallback={<p>loading</p>}>
        {renderScope("a", seen)}
        <MaybeSuspend />
      </Suspense>
    );
    const { rerender } = render(ui());
    act(() => nativeDragEnter());
    const monitor = seen[0].getMonitor();
    expect(monitor.isDragging()).toBe(true);

    suspended = new Promise<void>((resolve) => {
      release = () => {
        suspended = null;
        resolve();
      };
    });
    rerender(ui());
    // Hidden: the drag is cancelled with the release, and its drop lands
    // while no listener is attached.
    expect(monitor.isDragging()).toBe(false);
    act(() => document.body.dispatchEvent(new Event("drop", { bubbles: true })));

    await act(async () => release());
    expect(backendSetUp()).toBe(true);
    act(() => nativeDragEnter());
    expect(monitor.isDragging()).toBe(true);
    expect(monitor.getItemType()).toBe(NativeTypes.FILE);
  });
});
