// @vitest-environment node
/**
 * oneShotMints — one mint path per "Allow once" approval, awaited rather than
 * repeated, and a revoke that names the mint by its full identity.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import {
  MAX_PENDING_MINTS,
  mintOneShotConfirmed,
  pushOneShot,
  resetOneShotMints,
  revokeOneShot,
} from "./oneShotMints";
import type { OneShotApproval } from "@/stores/browserApprovalStore";

const SHOT: OneShotApproval = {
  tabId: "tab-1",
  generation: 3,
  originPattern: "https://blog.example.com",
  operation: "type",
  target: { role: "textbox", name: "Title" },
  script: "return 1",
};

const mintCalls = () => invoke.mock.calls.filter(([cmd]) => cmd === "browser_add_one_shot");

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetOneShotMints();
});

afterEach(() => {
  resetOneShotMints();
});

describe("pushOneShot + mintOneShotConfirmed", () => {
  it("a confirmed caller awaits the subscription's mint instead of minting again", async () => {
    pushOneShot(SHOT);
    await expect(mintOneShotConfirmed(SHOT)).resolves.toBe(true);
    expect(mintCalls()).toHaveLength(1);
    expect(mintCalls()[0][1]).toEqual({
      tabId: "tab-1",
      generation: 3,
      originPattern: "https://blog.example.com",
      operation: "type",
      target: { role: "textbox", name: "Title" },
      evalScript: "return 1",
    });
  });

  it("pushing the same approval twice mints it once", async () => {
    pushOneShot(SHOT);
    pushOneShot({ ...SHOT, target: { ...SHOT.target! } });
    await mintOneShotConfirmed(SHOT);
    expect(mintCalls()).toHaveLength(1);
  });

  it("a different script is a different authorization, minted separately", async () => {
    pushOneShot(SHOT);
    pushOneShot({ ...SHOT, script: "return 2" });
    await Promise.all([mintOneShotConfirmed(SHOT), mintOneShotConfirmed({ ...SHOT, script: "return 2" })]);
    expect(mintCalls()).toHaveLength(2);
  });

  it("a driver refusal resolves false and does not throw", async () => {
    invoke.mockRejectedValue(new Error("STALE_COMMAND: generation moved"));
    pushOneShot(SHOT);
    await expect(mintOneShotConfirmed(SHOT)).resolves.toBe(false);
  });

  it("the recorded outcome is consumed: a later identical approval is a fresh mint", async () => {
    pushOneShot(SHOT);
    await mintOneShotConfirmed(SHOT);
    await mintOneShotConfirmed(SHOT);
    expect(mintCalls()).toHaveLength(2);
  });

  it("with no recorded mint the caller mints exactly once itself", async () => {
    await expect(mintOneShotConfirmed(SHOT)).resolves.toBe(true);
    expect(mintCalls()).toHaveLength(1);
  });

  it("remembers at most MAX_PENDING_MINTS outcomes, dropping the oldest first", async () => {
    for (let i = 0; i <= MAX_PENDING_MINTS; i += 1) pushOneShot({ ...SHOT, generation: i });
    expect(mintCalls()).toHaveLength(MAX_PENDING_MINTS + 1);
    await mintOneShotConfirmed({ ...SHOT, generation: 1 }); // still recorded
    expect(mintCalls()).toHaveLength(MAX_PENDING_MINTS + 1);
    await mintOneShotConfirmed({ ...SHOT, generation: 0 }); // evicted: mints again
    expect(mintCalls()).toHaveLength(MAX_PENDING_MINTS + 2);
  });
});

describe("revokeOneShot", () => {
  it("names the mint by its full identity, script included", async () => {
    await revokeOneShot(SHOT);
    expect(invoke).toHaveBeenCalledWith("browser_revoke_one_shot", {
      tabId: "tab-1",
      generation: 3,
      originPattern: "https://blog.example.com",
      operation: "type",
      target: { role: "textbox", name: "Title" },
      evalScript: "return 1",
    });
  });

  it("sends explicit nulls for a mint with no target or script", async () => {
    await revokeOneShot({ tabId: "t", generation: 1, originPattern: "https://a.com", operation: "read" });
    expect(invoke).toHaveBeenCalledWith(
      "browser_revoke_one_shot",
      expect.objectContaining({ target: null, evalScript: null }),
    );
  });

  it("a failed revoke is swallowed, not thrown", async () => {
    invoke.mockRejectedValue(new Error("gone"));
    await expect(revokeOneShot(SHOT)).resolves.toBeUndefined();
  });
});
