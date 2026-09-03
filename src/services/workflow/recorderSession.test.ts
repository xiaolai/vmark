// @vitest-environment node
// WI-NB7.1 — host-owned recording session: drain loop, navigation records, the
// 1000-event session cap, and the start/stop/abort lifecycle.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordedEvent } from "@/lib/browser/workflow/recorder";
import {
  startRecorderSession,
  stopRecorderSession,
  abortRecorderSession,
  drainActiveRecording,
  recordNavigation,
  isRecording,
  __resetRecorderSessions,
  type RecorderDeps,
} from "./recorderSession";

const noSchedule = () => () => {}; // never auto-fire the timer — tests drive drains
const START = "https://x.test/start?session=SECRET#frag";

function deps(overrides: Partial<RecorderDeps> = {}): RecorderDeps {
  return {
    rearm: vi.fn(async () => {}),
    disarm: vi.fn(async () => {}),
    drainOnce: vi.fn(async () => []),
    schedule: noSchedule,
    ...overrides,
  };
}

afterEach(() => __resetRecorderSessions());

describe("recorder session lifecycle", () => {
  it("refuses a duplicate start on the same tab", () => {
    expect(startRecorderSession({ tabId: "t1", site: "x", generation: 1, startUrl: START, deps: deps() })).toEqual({ ok: true });
    expect(isRecording("t1")).toBe(true);
    expect(startRecorderSession({ tabId: "t1", site: "x", generation: 1, startUrl: START, deps: deps() })).toEqual({
      ok: false,
      error: "recording-already-active",
    });
  });

  it("stop without a start returns null", async () => {
    expect(await stopRecorderSession("nope")).toBeNull();
  });

  it("drains the shim buffer and appends events", async () => {
    const events: RecordedEvent[] = [
      { type: "click", role: "button", name: "Publish" },
      { type: "type", role: "textbox", name: "Title" },
    ];
    const d = deps({ drainOnce: vi.fn(async () => events) });
    startRecorderSession({ tabId: "t1", site: "blog", generation: 3, startUrl: START, deps: d });
    await drainActiveRecording("t1");
    const result = await stopRecorderSession("t1");
    expect(result).not.toBeNull();
    expect(result!.eventCount).toBe(5); // the entry navigate + 2 from the tick + 2 from the final stop drain
    expect(result!.source).toContain('action: click "Publish"');
    expect(result!.inputs).toContain("Title");
    expect(d.disarm).toHaveBeenCalledWith("t1", 3); // capture stopped immediately
  });

  it("records a navigation host-side and re-arms the new document", async () => {
    const d = deps();
    startRecorderSession({ tabId: "t1", site: "x", generation: 1, startUrl: START, deps: d });
    await recordNavigation("t1", "https://x.test/step2?token=SECRET", 2);
    const result = await stopRecorderSession("t1");
    // The navigate event was recorded, its URL stripped by the redactor at finalize.
    expect(result!.source).toContain("action: navigate to https://x.test/step2");
    expect(result!.source).not.toContain("SECRET");
    // Re-arm was issued against the NEW generation.
    expect(d.rearm).toHaveBeenCalledWith("t1", 2);
  });

  it("caps a session at 1000 events", async () => {
    const flood: RecordedEvent[] = Array.from({ length: 600 }, () => ({ type: "click", role: "button", name: "x" }));
    const d = deps({ drainOnce: vi.fn(async () => flood) });
    startRecorderSession({ tabId: "t1", site: "x", generation: 1, startUrl: START, deps: d });
    await drainActiveRecording("t1"); // 600
    await drainActiveRecording("t1"); // +600 -> would be 1200, capped at 1000
    const result = await stopRecorderSession("t1");
    expect(result!.eventCount).toBeLessThanOrEqual(1000);
  });

  it("records a host-side entry navigate at start so the workflow has an entry point (W11)", async () => {
    startRecorderSession({ tabId: "t1", site: "x", generation: 1, startUrl: START, deps: deps() });
    const result = await stopRecorderSession("t1");
    expect(result!.source).toMatch(/^---[\s\S]*?---\n1\. action: navigate to https:\/\/x\.test\/start\n/);
    expect(result!.source).not.toContain("SECRET");
    expect(result!.source).not.toContain("frag");
  });

  it("a navigation that arrives while the session is stopping is not recorded or re-armed (#188)", async () => {
    let releaseDrain: (v: RecordedEvent[]) => void = () => {};
    const d = deps({ drainOnce: vi.fn(() => new Promise<RecordedEvent[]>((r) => (releaseDrain = r))) });
    startRecorderSession({ tabId: "t1", site: "x", generation: 1, startUrl: START, deps: d });
    const stopping = stopRecorderSession("t1");
    const nav = recordNavigation("t1", "https://x.test/late", 2);
    await vi.waitFor(() => expect(d.drainOnce).toHaveBeenCalled());
    releaseDrain([]);
    await nav;
    const result = await stopping;
    expect(result!.source).not.toContain("late");
    expect(d.rearm).not.toHaveBeenCalledWith("t1", 2);
  });

  it("a drain error does not tear down the session", async () => {
    const d = deps({ drainOnce: vi.fn(async () => { throw new Error("eval failed"); }) });
    startRecorderSession({ tabId: "t1", site: "x", generation: 1, startUrl: START, deps: d });
    await drainActiveRecording("t1");
    expect(isRecording("t1")).toBe(true);
  });

  it("abort discards the recording without finalizing", () => {
    startRecorderSession({ tabId: "t1", site: "x", generation: 1, startUrl: START, deps: deps() });
    abortRecorderSession("t1");
    expect(isRecording("t1")).toBe(false);
  });

  it("stop clears the drain timer (real scheduler)", async () => {
    vi.useFakeTimers();
    try {
      const tick = vi.fn(async () => []);
      const realTimerDeps: RecorderDeps = { rearm: vi.fn(async () => {}), disarm: vi.fn(async () => {}), drainOnce: tick };
      startRecorderSession({ tabId: "t1", site: "x", generation: 1, startUrl: START, deps: realTimerDeps });
      await stopRecorderSession("t1");
      tick.mockClear();
      vi.advanceTimersByTime(5000);
      expect(tick).not.toHaveBeenCalled(); // timer was cleared on stop
    } finally {
      vi.useRealTimers();
    }
  });
});
