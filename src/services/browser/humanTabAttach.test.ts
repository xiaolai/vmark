// @vitest-environment node
// Audit 20260815-163607 #24 — the attach IPC used to swallow its rejection, so a
// failed attach was indistinguishable from a successful one.
import { afterEach, describe, expect, it } from "vitest";
import {
  performHumanTabAttach,
  recordAttachment,
  consumeOnceAttachment,
  __setAttachInvoker,
} from "./humanTabAttach";

afterEach(() => __setAttachInvoker(null));

describe("performHumanTabAttach", () => {
  it("resolves true when the IPC succeeds", async () => {
    __setAttachInvoker(() => Promise.resolve());
    await expect(performHumanTabAttach("t1", 1, true)).resolves.toBe(true);
  });

  it("resolves FALSE rather than throwing when the IPC rejects", async () => {
    __setAttachInvoker(() => Promise.reject(new Error("ipc down")));
    await expect(performHumanTabAttach("t1", 1, true)).resolves.toBe(false);
  });

  it("passes the tab, generation and once flag through unchanged", async () => {
    const seen: unknown[] = [];
    __setAttachInvoker((...args) => {
      seen.push(args);
      return Promise.resolve();
    });
    await performHumanTabAttach("tab-9", 42, false);
    expect(seen).toEqual([["tab-9", 42, false]]);
  });
});

describe("recordAttachment", () => {
  const a = { tabId: "t1", generation: 1, once: true };

  it("adds an attachment", () => {
    expect(recordAttachment([], a)).toEqual([a]);
  });

  // One attachment per tab: a re-attach at a new generation must REPLACE, not
  // accumulate, or a stale generation would keep authorising the tab.
  it("replaces any existing attachment for the same tab", () => {
    const older = { tabId: "t1", generation: 1, once: false };
    const newer = { tabId: "t1", generation: 2, once: true };
    expect(recordAttachment([older], newer)).toEqual([newer]);
  });

  it("leaves other tabs untouched", () => {
    const other = { tabId: "t2", generation: 5, once: false };
    expect(recordAttachment([other], a)).toEqual([other, a]);
  });

  it("does not mutate the input list", () => {
    const list = [{ tabId: "t2", generation: 5, once: false }];
    recordAttachment(list, a);
    expect(list).toHaveLength(1);
  });
});

describe("consumeOnceAttachment", () => {
  const once = { tabId: "t1", generation: 1, once: true };
  const standing = { tabId: "t2", generation: 1, once: false };

  it("removes a matching one-shot attachment", () => {
    expect(consumeOnceAttachment([once], "t1", 1)).toEqual([]);
  });

  // `once: false` is a standing attachment — consuming must not revoke it.
  it("keeps a standing attachment", () => {
    expect(consumeOnceAttachment([standing], "t2", 1)).toEqual([standing]);
  });

  it("keeps a one-shot from a different generation", () => {
    expect(consumeOnceAttachment([once], "t1", 2)).toEqual([once]);
  });

  it("keeps a one-shot for a different tab", () => {
    expect(consumeOnceAttachment([once], "other", 1)).toEqual([once]);
  });
});
