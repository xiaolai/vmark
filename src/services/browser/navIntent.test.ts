// WI-S2.2 — navIntent: how the user SET OFF, which is what history records.
import { describe, it, expect, beforeEach } from "vitest";
import { setNavIntent, takeNavIntent, clearNavIntent } from "./navIntent";

beforeEach(() => clearNavIntent("t1"));

describe("navIntent", () => {
  it("defaults to a link — the page navigated itself", () => {
    // The overwhelmingly common case: nothing in VMark asked for this, the page did.
    expect(takeNavIntent("t1")).toBe("link");
  });

  it("remembers an explicit intent until the navigation it belongs to commits", () => {
    setNavIntent("t1", "typed");
    expect(takeNavIntent("t1")).toBe("typed");
  });

  it("is consumed exactly once — a later page-driven navigation is not 'typed'", () => {
    setNavIntent("t1", "typed");
    expect(takeNavIntent("t1")).toBe("typed");
    // The user typed a url; the page then followed a link on its own. That second
    // navigation is not something the user typed.
    expect(takeNavIntent("t1")).toBe("link");
  });

  it("is per-tab", () => {
    setNavIntent("t1", "reload");
    expect(takeNavIntent("t2")).toBe("link");
    expect(takeNavIntent("t1")).toBe("reload");
  });
});
