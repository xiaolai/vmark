// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { useLargeFileSessionStore } from "../largeFileSession";

describe("useLargeFileSessionStore (documentStore/largeFileSession)", () => {
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

  // #1407: the marker also lands a document the WYSIWYG parser refused, and the
  // status line must say which — "(large file)" is wrong for a refusal.
  it("markForcedSource defaults to the large-file reason, as every size caller means", () => {
    useLargeFileSessionStore.getState().markForcedSource("tab-1");
    expect(useLargeFileSessionStore.getState().forcedSourceReason("tab-1")).toBe("large-file");
  });

  it("records an unparseable document as its own reason, per tab", () => {
    const s = useLargeFileSessionStore.getState();
    s.markForcedSource("tab-1", "unparseable");
    s.markForcedSource("tab-2");
    expect(useLargeFileSessionStore.getState().isForcedSource("tab-1")).toBe(true);
    expect(useLargeFileSessionStore.getState().forcedSourceReason("tab-1")).toBe("unparseable");
    expect(useLargeFileSessionStore.getState().forcedSourceReason("tab-2")).toBe("large-file");
  });

  it("has no reason for a tab that is not forced, including after clearing", () => {
    expect(useLargeFileSessionStore.getState().forcedSourceReason("tab-1")).toBeUndefined();
    useLargeFileSessionStore.getState().markForcedSource("tab-1", "unparseable");
    useLargeFileSessionStore.getState().clearForcedSource("tab-1");
    expect(useLargeFileSessionStore.getState().forcedSourceReason("tab-1")).toBeUndefined();
  });
});
