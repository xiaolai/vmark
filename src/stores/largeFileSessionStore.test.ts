import { describe, it, expect, beforeEach } from "vitest";
import { useLargeFileSessionStore } from "./largeFileSessionStore";

describe("largeFileSessionStore", () => {
  beforeEach(() => {
    useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
  });

  it("starts with no forced-source tabs", () => {
    expect(useLargeFileSessionStore.getState().forcedSourceTabs).toEqual({});
  });

  it("markForcedSource tracks a tab", () => {
    useLargeFileSessionStore.getState().markForcedSource("tab-1");
    expect(useLargeFileSessionStore.getState().isForcedSource("tab-1")).toBe(true);
  });

  it("clearForcedSource removes a tab without disturbing others", () => {
    const s = useLargeFileSessionStore.getState();
    s.markForcedSource("tab-1");
    s.markForcedSource("tab-2");
    s.clearForcedSource("tab-1");
    expect(useLargeFileSessionStore.getState().isForcedSource("tab-1")).toBe(false);
    expect(useLargeFileSessionStore.getState().isForcedSource("tab-2")).toBe(true);
  });

  it("clearForcedSource on an unknown tab is a no-op and returns reference-equal state", () => {
    const before = useLargeFileSessionStore.getState().forcedSourceTabs;
    useLargeFileSessionStore.getState().clearForcedSource("unknown-tab");
    expect(useLargeFileSessionStore.getState().forcedSourceTabs).toBe(before);
  });

  it("markForcedSource on an existing tab is idempotent", () => {
    useLargeFileSessionStore.getState().markForcedSource("tab-1");
    useLargeFileSessionStore.getState().markForcedSource("tab-1");
    expect(Object.keys(useLargeFileSessionStore.getState().forcedSourceTabs)).toEqual(["tab-1"]);
  });
});
