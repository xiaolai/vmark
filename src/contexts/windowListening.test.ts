// @vitest-environment node
// WI-OC1.3 — the document surface waits for the window's ready handshake, so
// building a large document cannot starve the listeners that handshake waits on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  armWindowListening,
  isWindowListening,
  publishWindowListening,
  resetWindowListeningForTest,
  subscribeWindowListening,
} from "./windowListening";

beforeEach(() => {
  resetWindowListeningForTest();
});

describe("windowListening", () => {
  it("lets a surface mount in a window that never armed the wait", () => {
    expect(isWindowListening()).toBe(true);
  });

  it("holds the surface back from arming until the window announces", () => {
    armWindowListening();
    expect(isWindowListening()).toBe(false);

    publishWindowListening();
    expect(isWindowListening()).toBe(true);
  });

  it("stays open once announced: a later arm cannot close it again", () => {
    armWindowListening();
    publishWindowListening();
    armWindowListening();
    expect(isWindowListening()).toBe(true);
  });

  it("is open at once for an announcement that came before any arm", () => {
    publishWindowListening();
    armWindowListening();
    expect(isWindowListening()).toBe(true);
  });

  it("tells subscribers when the answer changes, and only then", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeWindowListening(changed);

    armWindowListening();
    armWindowListening();
    publishWindowListening();
    publishWindowListening();
    expect(changed).toHaveBeenCalledTimes(2);

    unsubscribe();
    resetWindowListeningForTest();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
