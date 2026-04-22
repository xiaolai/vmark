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

  it("startLoad activates with filename and size", () => {
    useFileLoadStore.getState().startLoad("huge.md", 1_500_000);
    const state = useFileLoadStore.getState();
    expect(state.active).toBe(true);
    expect(state.filename).toBe("huge.md");
    expect(state.sizeBytes).toBe(1_500_000);
  });

  it("endLoad resets all fields", () => {
    useFileLoadStore.getState().startLoad("huge.md", 1_500_000);
    useFileLoadStore.getState().endLoad();
    const state = useFileLoadStore.getState();
    expect(state.active).toBe(false);
    expect(state.filename).toBe("");
    expect(state.sizeBytes).toBe(0);
  });

  it("a second startLoad replaces previous state (latest wins)", () => {
    useFileLoadStore.getState().startLoad("first.md", 1_000_000);
    useFileLoadStore.getState().startLoad("second.md", 2_000_000);
    const state = useFileLoadStore.getState();
    expect(state.filename).toBe("second.md");
    expect(state.sizeBytes).toBe(2_000_000);
  });
});
