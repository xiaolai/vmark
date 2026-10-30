// @vitest-environment node
/**
 * instanceRekeyBus — the fan-out a loose instance's identity re-key reaches
 * its followers through, and when the instances store raises it.
 *
 * The closed-tab history's own follow-through is pinned in
 * `tabStoreClosedScopes.test.ts` ("fires through the instances store's
 * loose-instance re-key").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyInstanceRekeyed, onInstanceRekeyed } from "./instanceRekeyBus";
import { useWorkspaceInstancesStore } from "./workspaceInstancesStore";

const unsubscribers: Array<() => void> = [];
function listen(): ReturnType<typeof vi.fn> {
  const listener = vi.fn();
  unsubscribers.push(onInstanceRekeyed(listener));
  return listener;
}

beforeEach(() => {
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
});

afterEach(() => {
  for (const off of unsubscribers.splice(0)) off();
});

describe("instanceRekeyBus", () => {
  it("delivers the window, old id and new id to every follower", () => {
    const first = listen();
    const second = listen();

    notifyInstanceRekeyed("doc-2", "wsi-old", "wsi-new");

    expect(first).toHaveBeenCalledExactlyOnceWith("doc-2", "wsi-old", "wsi-new");
    expect(second).toHaveBeenCalledExactlyOnceWith("doc-2", "wsi-old", "wsi-new");
  });

  it("stops delivering to a follower that unsubscribed, and only to it", () => {
    const kept = listen();
    const gone = vi.fn();
    const off = onInstanceRekeyed(gone);
    off();

    notifyInstanceRekeyed("main", "a", "b");

    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledOnce();
  });

  it("is raised by the instances store only when a loose instance changes identity", () => {
    const listener = listen();
    const store = useWorkspaceInstancesStore.getState();

    store.ensureLooseInstance("main"); // created, nothing to follow
    const looseId = useWorkspaceInstancesStore
      .getState()
      .windows["main"]!.workspaceInstanceIds.find(
        (id) => useWorkspaceInstancesStore.getState().instances[id]?.kind === "loose",
      )!;
    store.ensureLooseInstance("main"); // reused as-is
    store.ensureLooseInstance("main", looseId); // asked for the id it already has
    expect(listener).not.toHaveBeenCalled();

    store.ensureLooseInstance("main", "wsi-loose-acked");

    expect(listener).toHaveBeenCalledExactlyOnceWith("main", looseId, "wsi-loose-acked");
  });
});
