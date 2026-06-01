import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveBellAction, playTerminalBell } from "./terminalBell";

describe("resolveBellAction (WI-11)", () => {
  it("off → nothing, regardless of active session", () => {
    expect(resolveBellAction("off", true)).toEqual({ sound: false, markActivity: false });
    expect(resolveBellAction("off", false)).toEqual({ sound: false, markActivity: false });
  });

  it("audible active → beep only (no dot — it's on screen)", () => {
    expect(resolveBellAction("audible", true)).toEqual({ sound: true, markActivity: false });
  });

  it("audible background → beep AND activity dot so it can be located", () => {
    expect(resolveBellAction("audible", false)).toEqual({ sound: true, markActivity: true });
  });

  it("visual → activity only when the session is not active", () => {
    expect(resolveBellAction("visual", false)).toEqual({ sound: false, markActivity: true });
    expect(resolveBellAction("visual", true)).toEqual({ sound: false, markActivity: false });
  });
});

describe("playTerminalBell", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not throw when AudioContext is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    expect(() => playTerminalBell()).not.toThrow();
  });

  it("creates and wires an oscillator when AudioContext exists", () => {
    const osc = {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as null | (() => void),
    };
    const gain = {
      gain: {
        value: 0,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    const ctx = {
      currentTime: 0,
      createOscillator: vi.fn(() => osc),
      createGain: vi.fn(() => gain),
      destination: {},
      close: vi.fn(),
    };
    const Ctor = vi.fn(function (this: unknown) {
      return ctx;
    });
    vi.stubGlobal("AudioContext", Ctor);

    playTerminalBell();

    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();

    // Fire the onended handler to close the context.
    expect(typeof osc.onended).toBe("function");
    osc.onended?.();
    expect(ctx.close).toHaveBeenCalled();
  });
});
