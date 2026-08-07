// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createSectionMergingStorage } from "./persistedSectionMerge";

/** In-memory StateStorage standing in for the shared localStorage key. */
function createDisk(initial: Record<string, unknown> | null = null) {
  const disk = { value: initial ? envelope(initial) : null as string | null };
  const base: StateStorage = {
    getItem: (_name) => disk.value,
    setItem: (_name, value) => {
      disk.value = value;
    },
    removeItem: (_name) => {
      disk.value = null;
    },
  };
  return {
    base,
    read: () => (disk.value ? JSON.parse(disk.value).state : null),
    raw: () => disk.value,
    writeExternally: (state: Record<string, unknown>) => {
      disk.value = envelope(state);
    },
  };
}

function envelope(state: Record<string, unknown>): string {
  return JSON.stringify({ state, version: 1 });
}

const KEY = "vmark-settings";

let disk: ReturnType<typeof createDisk>;
let storage: StateStorage;

beforeEach(() => {
  disk = createDisk({ terminal: { fontSize: 13 }, appearance: { theme: "paper" } });
  storage = createSectionMergingStorage(disk.base);
  // Persist hydrates via getItem — this is what establishes the baseline.
  storage.getItem(KEY);
});

describe("createSectionMergingStorage", () => {
  // Reproduced live in the app: window A set terminal.fontSize=21, window B
  // (which never synced that group) later wrote its whole state for an
  // unrelated reason and reverted it to 13. A window must only persist the
  // sections it actually changed.
  it("does not write sections this window did not change", () => {
    disk.writeExternally({
      terminal: { fontSize: 21 }, // another window's change
      appearance: { theme: "paper" },
    });

    // This window still holds fontSize 13 and writes for an unrelated reason.
    storage.setItem(KEY, envelope({ terminal: { fontSize: 13 }, appearance: { theme: "paper" } }));

    expect(disk.read().terminal.fontSize).toBe(21); // preserved, not clobbered
  });

  it("persists a section this window did change", () => {
    storage.setItem(KEY, envelope({ terminal: { fontSize: 16 }, appearance: { theme: "paper" } }));

    expect(disk.read().terminal.fontSize).toBe(16);
  });

  it("merges this window's change onto another window's concurrent change", () => {
    disk.writeExternally({
      terminal: { fontSize: 21 }, // theirs
      appearance: { theme: "paper" },
    });

    // Ours changes only appearance.
    storage.setItem(KEY, envelope({ terminal: { fontSize: 13 }, appearance: { theme: "night" } }));

    const state = disk.read();
    expect(state.appearance.theme).toBe("night"); // ours applied
    expect(state.terminal.fontSize).toBe(21); // theirs survived
  });

  it("skips the physical write entirely when nothing changed", () => {
    const spy = vi.spyOn(disk.base, "setItem");

    storage.setItem(KEY, envelope({ terminal: { fontSize: 13 }, appearance: { theme: "paper" } }));

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("skips the write when this window is only echoing what disk already has", () => {
    // The cross-window sync handler applies another window's value via
    // setState, which makes it look 'changed' relative to our baseline. Writing
    // it back would fire a redundant storage event in every other window.
    disk.writeExternally({ terminal: { fontSize: 21 }, appearance: { theme: "paper" } });
    const spy = vi.spyOn(disk.base, "setItem");

    storage.setItem(KEY, envelope({ terminal: { fontSize: 21 }, appearance: { theme: "paper" } }));

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not re-clobber an external section after two consecutive local writes", () => {
    // Regression (audit High-1): the baseline must track what THIS window
    // holds, not the merged disk result. If it took the merged value, the
    // external section (terminal=21) would enter the baseline even though this
    // window never adopted it into memory — and the window's still-stale
    // in-memory terminal=13 would then look "changed" on the next write and
    // overwrite 21, recreating the data loss this wrapper prevents.
    disk.writeExternally({ terminal: { fontSize: 21 }, appearance: { theme: "paper" } });

    // First local write: change only appearance. Disk terminal must stay 21.
    storage.setItem(KEY, envelope({ terminal: { fontSize: 13 }, appearance: { theme: "night" } }));
    expect(disk.read().terminal.fontSize).toBe(21);

    // Second local write: change appearance again, terminal still locally 13.
    storage.setItem(KEY, envelope({ terminal: { fontSize: 13 }, appearance: { theme: "sepia" } }));

    expect(disk.read().terminal.fontSize).toBe(21); // external value preserved
    expect(disk.read().appearance.theme).toBe("sepia");
  });

  it("tracks its own writes so a later unrelated write does not re-clobber", () => {
    storage.setItem(KEY, envelope({ terminal: { fontSize: 16 }, appearance: { theme: "paper" } }));
    disk.writeExternally({ terminal: { fontSize: 30 }, appearance: { theme: "paper" } });

    // Unrelated write; our terminal value (16) is stale vs disk (30) but we did
    // not change it since our last write, so it must not be persisted.
    storage.setItem(KEY, envelope({ terminal: { fontSize: 16 }, appearance: { theme: "paper" } }));

    expect(disk.read().terminal.fontSize).toBe(30);
  });

  it("writes everything when the key has never been read (fail open)", () => {
    const fresh = createDisk(null);
    const s = createSectionMergingStorage(fresh.base);

    s.setItem(KEY, envelope({ terminal: { fontSize: 14 } }));

    expect(fresh.read().terminal.fontSize).toBe(14);
  });

  it("preserves sections present on disk but absent from this window's state", () => {
    disk.writeExternally({
      terminal: { fontSize: 13 },
      appearance: { theme: "paper" },
      futureSection: { added: "by a newer build" },
    });

    storage.setItem(KEY, envelope({ terminal: { fontSize: 15 }, appearance: { theme: "paper" } }));

    expect(disk.read().futureSection).toEqual({ added: "by a newer build" });
  });

  it("falls back to a plain write when disk holds corrupt JSON", () => {
    disk.base.setItem(KEY, "{not json");

    storage.setItem(KEY, envelope({ terminal: { fontSize: 17 }, appearance: { theme: "paper" } }));

    expect(disk.read().terminal.fontSize).toBe(17);
  });

  it("resets its baseline on removeItem", () => {
    storage.removeItem(KEY);

    storage.setItem(KEY, envelope({ terminal: { fontSize: 18 } }));

    expect(disk.read().terminal.fontSize).toBe(18);
  });
});
