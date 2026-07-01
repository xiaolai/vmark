import { describe, it, expect, vi } from "vitest";
import { onTabRemoved, notifyTabRemoved } from "./tabRemovalBus";

describe("tabRemovalBus (#1081)", () => {
  it("delivers removal notifications to subscribers", () => {
    const seen: Array<[string, string]> = [];
    const off = onTabRemoved((w, t) => seen.push([w, t]));
    notifyTabRemoved("main", "tab-1");
    expect(seen).toEqual([["main", "tab-1"]]);
    off();
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const off = onTabRemoved(listener);
    off();
    notifyTabRemoved("main", "tab-1");
    expect(listener).not.toHaveBeenCalled();
  });

  it("fans out to every active subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onTabRemoved(a);
    const offB = onTabRemoved(b);
    notifyTabRemoved("w", "t");
    expect(a).toHaveBeenCalledWith("w", "t");
    expect(b).toHaveBeenCalledWith("w", "t");
    offA();
    offB();
  });
});
