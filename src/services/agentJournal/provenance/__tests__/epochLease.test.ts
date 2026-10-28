// @vitest-environment node
// WI-AL1.4 — the epoch lease never leaves an epoch armed that no session holds: a failed handshake closes the epoch it just armed and answers null, and an arm that lands after dispose is closed at once; a close the journal rejects keeps its epoch unclosed, retried before the next arm and surfaced by dispose
import { describe, it, expect, vi } from "vitest";
import type { ArmedEpoch } from "../../epochClient";
import { EpochLease, type SessionJournal } from "../epochLease";

const ARMED: ArmedEpoch = { doc: "path:/a.md", epoch: "7", head: null, headHash: null };

function journal(): SessionJournal & { arm: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  return { arm: vi.fn(async () => ARMED), close: vi.fn(async () => {}) };
}

describe("EpochLease", () => {
  it("arms once and hands the epoch out", async () => {
    const j = journal();
    const lease = new EpochLease(j, { onArmed: async () => {}, afterArm: () => {}, warn: () => {} });
    await expect(Promise.all([lease.ensure(), lease.ensure()])).resolves.toEqual([ARMED, ARMED]);
    expect(j.arm).toHaveBeenCalledTimes(1);
  });

  it("closes the epoch it armed when the handshake fails, and answers null", async () => {
    const j = journal();
    const warn = vi.fn();
    const lease = new EpochLease(j, { onArmed: async () => Promise.reject(new Error("handshake")), afterArm: () => {}, warn });
    await expect(lease.ensure()).resolves.toBeNull();
    await lease.idle();
    expect(j.close).toHaveBeenCalledWith("7");
    expect(warn).toHaveBeenCalled();
  });

  it("a later demand arms again after a failed handshake", async () => {
    const j = journal();
    const onArmed = vi.fn().mockRejectedValueOnce(new Error("handshake")).mockResolvedValue(undefined);
    const lease = new EpochLease(j, { onArmed, afterArm: () => {}, warn: () => {} });
    await expect(lease.ensure()).resolves.toBeNull();
    await expect(lease.ensure()).resolves.toEqual(ARMED);
    expect(j.arm).toHaveBeenCalledTimes(2);
  });

  it("closes an arm that lands after dispose", async () => {
    const j = journal();
    let land: (a: ArmedEpoch) => void = () => {};
    j.arm.mockImplementationOnce(() => new Promise<ArmedEpoch>((r) => (land = r)));
    const lease = new EpochLease(j, { onArmed: async () => {}, afterArm: () => {}, warn: () => {} });
    const armed = lease.ensure();
    const disposed = lease.dispose();
    await vi.waitFor(() => expect(j.arm).toHaveBeenCalled());
    land(ARMED);
    await expect(armed).resolves.toBeNull();
    await disposed;
    expect(j.close).toHaveBeenCalledWith("7");
  });

  it("a known suspension warns once per episode and does not re-arm per demand until it lifts", async () => {
    const j = journal();
    let suspended = true;
    j.arm.mockImplementation(async () => {
      if (suspended) throw new Error("recording suspended");
      return ARMED;
    });
    const warn = vi.fn();
    const lease = new EpochLease({ ...j, suspended: () => suspended }, { onArmed: async () => {}, afterArm: () => {}, warn });
    for (let i = 0; i < 10; i++) await expect(lease.ensure()).resolves.toBeNull();
    expect(j.arm).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    // Recovered: the next demand arms.
    suspended = false;
    await expect(lease.ensure()).resolves.toEqual(ARMED);
    expect(j.arm).toHaveBeenCalledTimes(2);
    // A new episode is observable again, once.
    lease.release();
    suspended = true;
    for (let i = 0; i < 3; i++) await expect(lease.ensure()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(j.arm).toHaveBeenCalledTimes(3);
  });

  describe("a rejected close", () => {
    it("on release is retried before the next arm, which waits for it", async () => {
      const j = journal();
      const warn = vi.fn();
      j.close.mockRejectedValueOnce(new Error("ipc")).mockRejectedValueOnce(new Error("ipc"));
      const lease = new EpochLease(j, { onArmed: async () => {}, afterArm: () => {}, warn });
      await lease.ensure();
      lease.release();
      await lease.idle();
      expect(warn).toHaveBeenCalledWith("provenance: close failed", expect.any(Error));
      await expect(lease.ensure()).resolves.toBeNull();
      expect(j.arm).toHaveBeenCalledTimes(1);
      await expect(lease.ensure()).resolves.toEqual(ARMED);
      expect(j.close).toHaveBeenCalledTimes(3);
      expect(j.arm).toHaveBeenCalledTimes(2);
    });

    it("after a failed handshake is retried before the next arm", async () => {
      const j = journal();
      const onArmed = vi.fn().mockRejectedValueOnce(new Error("handshake")).mockResolvedValue(undefined);
      j.close.mockRejectedValueOnce(new Error("ipc"));
      const lease = new EpochLease(j, { onArmed, afterArm: () => {}, warn: () => {} });
      await expect(lease.ensure()).resolves.toBeNull();
      await expect(lease.ensure()).resolves.toEqual(ARMED);
      expect(j.close.mock.invocationCallOrder[1]).toBeLessThan(j.arm.mock.invocationCallOrder[1]);
    });

    it("on dispose is retried once, then rejects", async () => {
      const j = journal();
      j.close.mockRejectedValue(new Error("ipc"));
      const lease = new EpochLease(j, { onArmed: async () => {}, afterArm: () => {}, warn: () => {} });
      await lease.ensure();
      await expect(lease.dispose()).rejects.toThrow("epoch 7 could not be closed");
      expect(j.close).toHaveBeenCalledTimes(2);
    });

    it("on dispose resolves when the retry is confirmed", async () => {
      const j = journal();
      j.close.mockRejectedValueOnce(new Error("ipc"));
      const lease = new EpochLease(j, { onArmed: async () => {}, afterArm: () => {}, warn: () => {} });
      await lease.ensure();
      await expect(lease.dispose()).resolves.toBeUndefined();
      expect(j.close).toHaveBeenCalledTimes(2);
    });
  });
});
