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

/**
 * Build a fake AudioContext + the nodes it hands out, so a test can assert on
 * construction count and node wiring. `state` drives the autoplay-policy path.
 */
function makeFakeAudio(state: AudioContextState = "running") {
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
    state,
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
    destination: {},
    close: vi.fn(),
  };
  const Ctor = vi.fn(function (this: unknown) {
    return ctx;
  });
  return { osc, gain, ctx, Ctor };
}

/** Load a FRESH copy of the module so its lazily-created context is unset. */
async function freshBell() {
  vi.resetModules();
  return (await import("./terminalBell")).playTerminalBell;
}

describe("playTerminalBell — shared AudioContext (WI-1.4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reuses a single AudioContext across bells", async () => {
    // WebKit caps concurrent AudioContexts. Constructing one per BEL means a
    // burst (e.g. a script printing 20 bells) exhausts the pool, the
    // constructor throws, and the audible bell goes dead for the session.
    const { Ctor, ctx } = makeFakeAudio();
    vi.stubGlobal("AudioContext", Ctor);
    const play = await freshBell();

    for (let i = 0; i < 20; i++) play();

    expect(Ctor).toHaveBeenCalledTimes(1);
    // Every bell still gets its own oscillator — only the context is shared.
    expect(ctx.createOscillator).toHaveBeenCalledTimes(20);
  });

  it("never closes the shared context", async () => {
    const { Ctor, ctx, osc } = makeFakeAudio();
    vi.stubGlobal("AudioContext", Ctor);
    const play = await freshBell();

    play();
    // Even if the oscillator's onended runs, the context must survive: closing
    // it would make the NEXT bell silent (a closed context cannot create nodes).
    osc.onended?.();
    expect(ctx.close).not.toHaveBeenCalled();

    play();
    expect(Ctor).toHaveBeenCalledTimes(1);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it("resumes a suspended context", async () => {
    // Browsers start a context suspended until a user gesture (autoplay
    // policy). Without resume() the beep is created but never audible.
    const { Ctor, ctx } = makeFakeAudio("suspended");
    vi.stubGlobal("AudioContext", Ctor);
    const play = await freshBell();

    play();

    expect(ctx.resume).toHaveBeenCalled();
  });

  it("does not resume a context that is already running", async () => {
    const { Ctor, ctx } = makeFakeAudio("running");
    vi.stubGlobal("AudioContext", Ctor);
    const play = await freshBell();

    play();

    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("swallows a rejected resume() rather than throwing into the data path", async () => {
    const { Ctor, ctx } = makeFakeAudio("suspended");
    ctx.resume = vi.fn(() => Promise.reject(new Error("not allowed")));
    vi.stubGlobal("AudioContext", Ctor);
    const play = await freshBell();

    expect(() => play()).not.toThrow();
    // An unhandled rejection would surface as a test-run failure; awaiting a
    // tick proves the rejection was caught.
    await Promise.resolve();
    expect(ctx.createOscillator).toHaveBeenCalled();
  });

  it("logs once when audio is unavailable, not once per bell", async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      if (args[0] === "[Terminal]") logged.push(args);
    });
    const Ctor = vi.fn(() => {
      throw new Error("AudioContext limit reached");
    });
    vi.stubGlobal("AudioContext", Ctor);
    const play = await freshBell();

    for (let i = 0; i < 10; i++) expect(() => play()).not.toThrow();

    expect(logged).toHaveLength(1);
    // It retries construction each time (a later bell may succeed once the
    // pool drains) but must not spam the console.
    expect(Ctor).toHaveBeenCalledTimes(10);
  });

  it("logs once when the platform has no AudioContext at all", async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      if (args[0] === "[Terminal]") logged.push(args);
    });
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const play = await freshBell();

    play();
    play();

    expect(logged).toHaveLength(1);
  });

  it("recovers when a later construction succeeds after an earlier failure", async () => {
    const { ctx } = makeFakeAudio();
    let attempts = 0;
    const Ctor = vi.fn(function (this: unknown) {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      return ctx;
    });
    vi.stubGlobal("AudioContext", Ctor);
    const play = await freshBell();

    play(); // fails, swallowed
    play(); // succeeds
    play(); // reuses

    expect(Ctor).toHaveBeenCalledTimes(2);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it("falls back to webkitAudioContext when AudioContext is absent", async () => {
    const { Ctor, ctx } = makeFakeAudio();
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", Ctor);
    const play = await freshBell();

    play();

    expect(ctx.createOscillator).toHaveBeenCalled();
  });
});

describe("playTerminalBell", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not throw when AudioContext is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    expect(() => playTerminalBell()).not.toThrow();
  });

  it("creates and wires an oscillator when AudioContext exists", () => {
    const { osc, gain, ctx, Ctor } = makeFakeAudio();
    vi.stubGlobal("AudioContext", Ctor);

    playTerminalBell();

    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(osc.type).toBe("sine");
    expect(osc.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalled();
    // The context is process-wide and reused (WI-1.4) — no per-bell teardown,
    // so no `onended` close handler is installed at all.
    expect(osc.onended).toBeNull();
  });
});
