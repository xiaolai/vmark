// WI-S0.8 — browserOcclusion: the single, reference-counted freeze/thaw authority.
//
// Before this, BrowserSurface invoked browser_freeze/browser_thaw directly with no
// reference counting, so two overlays over one tab (a crash overlay and a JS dialog,
// or an approval dialog raised while a dialog is up) fought: whichever dismissed
// first thawed the native view out from under the one still showing, revealing the
// live page beneath it. OcclusionController already solved this — it was simply
// never instantiated.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { browserOcclusion, OCCLUDER } from "./browserOcclusion";

const TAB = "tab-1";

/** Let the controller's serialized op loop drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  // Drop any occluders a previous test left behind.
  browserOcclusion.removeTab(TAB);
  await settle();
  invokeMock.mockClear();
});

describe("browserOcclusion", () => {
  it("freezes the tab through browser_freeze when the first occluder appears", async () => {
    browserOcclusion.addOccluder(TAB, OCCLUDER.approval);
    await settle();
    expect(invokeMock).toHaveBeenCalledWith("browser_freeze", { tabId: TAB });
  });

  it("thaws through browser_thaw when the last occluder goes away", async () => {
    browserOcclusion.addOccluder(TAB, OCCLUDER.approval);
    await settle();
    invokeMock.mockClear();
    browserOcclusion.removeOccluder(TAB, OCCLUDER.approval);
    await settle();
    expect(invokeMock).toHaveBeenCalledWith("browser_thaw", { tabId: TAB });
  });

  it("does NOT thaw while another occluder still covers the tab", async () => {
    browserOcclusion.addOccluder(TAB, OCCLUDER.crash);
    browserOcclusion.addOccluder(TAB, OCCLUDER.approval);
    await settle();
    invokeMock.mockClear();

    // The approval dialog closes, but the crash overlay is still up.
    browserOcclusion.removeOccluder(TAB, OCCLUDER.approval);
    await settle();
    expect(invokeMock).not.toHaveBeenCalledWith("browser_thaw", { tabId: TAB });
    expect(browserOcclusion.isFrozen(TAB)).toBe(true);

    // Now the crash overlay goes too — only then does the page come back.
    browserOcclusion.removeOccluder(TAB, OCCLUDER.crash);
    await settle();
    expect(invokeMock).toHaveBeenCalledWith("browser_thaw", { tabId: TAB });
    expect(browserOcclusion.isFrozen(TAB)).toBe(false);
  });

  it("issues a single freeze for two simultaneous occluders", async () => {
    browserOcclusion.addOccluder(TAB, OCCLUDER.crash);
    browserOcclusion.addOccluder(TAB, OCCLUDER.dialog);
    await settle();
    const freezes = invokeMock.mock.calls.filter((c) => c[0] === "browser_freeze");
    expect(freezes).toHaveLength(1);
  });
});
