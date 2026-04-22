import { describe, it, expect, beforeEach } from "vitest";
import { useFileLoadStore } from "./fileLoadStore";

describe("fileLoadStore", () => {
  beforeEach(() => {
    useFileLoadStore.getState().endLoad();
  });

  it("starts inactive", () => {
    const state = useFileLoadStore.getState();
    expect(state.active).toBe(false);
    expect(state.filename).toBe("");
    expect(state.sizeBytes).toBe(0);
  });

  it("startLoad activates with filename and size and returns a loadId", () => {
    const id = useFileLoadStore.getState().startLoad("huge.md", 1_500_000);
    const state = useFileLoadStore.getState();
    expect(state.active).toBe(true);
    expect(state.filename).toBe("huge.md");
    expect(state.sizeBytes).toBe(1_500_000);
    expect(id).toBe(state.loadId);
  });

  it("endLoad() with no argument clears unconditionally", () => {
    useFileLoadStore.getState().startLoad("huge.md", 1_500_000);
    useFileLoadStore.getState().endLoad();
    const state = useFileLoadStore.getState();
    expect(state.active).toBe(false);
    expect(state.filename).toBe("");
    expect(state.sizeBytes).toBe(0);
  });

  it("endLoad(matchingId) clears the indicator", () => {
    const id = useFileLoadStore.getState().startLoad("huge.md", 1_500_000);
    useFileLoadStore.getState().endLoad(id);
    expect(useFileLoadStore.getState().active).toBe(false);
  });

  it("endLoad(staleId) does NOT clear a newer load (prevents race)", () => {
    const staleId = useFileLoadStore.getState().startLoad("first.md", 1_000_000);
    useFileLoadStore.getState().startLoad("second.md", 2_000_000);
    useFileLoadStore.getState().endLoad(staleId);
    const state = useFileLoadStore.getState();
    expect(state.active).toBe(true);
    expect(state.filename).toBe("second.md");
  });

  it("a second startLoad replaces previous state and increments loadId", () => {
    const first = useFileLoadStore.getState().startLoad("first.md", 1_000_000);
    const second = useFileLoadStore.getState().startLoad("second.md", 2_000_000);
    expect(second).toBeGreaterThan(first);
    const state = useFileLoadStore.getState();
    expect(state.filename).toBe("second.md");
    expect(state.sizeBytes).toBe(2_000_000);
  });
});
