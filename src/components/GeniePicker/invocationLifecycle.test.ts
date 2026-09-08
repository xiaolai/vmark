// @vitest-environment node
// Audit 20260907 (#309/#310) — the picker closes after an invocation only
// when the invocation never entered a response mode.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { isResponseMode, settleInvocation } from "./invocationLifecycle";

beforeEach(() => {
  useGeniePickerStore.getState().openPicker();
});

describe("isResponseMode", () => {
  it.each([
    ["search", false],
    ["freeform", false],
    ["processing", true],
    ["preview", true],
    ["error", true],
  ] as const)("%s → %s", (mode, expected) => {
    expect(isResponseMode(mode)).toBe(expected);
  });
});

describe("settleInvocation", () => {
  it("closes the picker when the invocation settles in an input mode", async () => {
    await settleInvocation(() => Promise.resolve(), vi.fn());
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  it("keeps the picker open when the invocation entered processing", async () => {
    await settleInvocation(
      () => Promise.resolve().then(() => useGeniePickerStore.getState().startProcessing("Polish")),
      vi.fn(),
    );
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
    expect(useGeniePickerStore.getState().mode).toBe("processing");
  });

  it("keeps the picker open on an invocation error the runner surfaced inline", async () => {
    await settleInvocation(
      () => Promise.resolve().then(() => useGeniePickerStore.getState().setPickerError("no provider")),
      vi.fn(),
    );
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
    expect(useGeniePickerStore.getState().mode).toBe("error");
  });

  it("reports a rejection to the logger, never throws, and closes", async () => {
    const onError = vi.fn();
    const boom = new Error("boom");
    await expect(settleInvocation(() => Promise.reject(boom), onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(boom);
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  it("accepts a synchronous (non-promise) invocation result", async () => {
    await settleInvocation(() => undefined, vi.fn());
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  // Audit R2 #610/#624 — everything before `startProcessing` is awaited, so a
  // user can cancel and REOPEN the picker while an invocation is still in
  // flight. The one that settles afterwards found `search` on screen and shut
  // a session it had nothing to do with.
  it("does not close a picker the invocation no longer owns", async () => {
    let current = 1;
    const claim = (() => {
      const owned = current;
      return () => current === owned;
    })();
    current = 2; // the user closed and reopened the picker
    await settleInvocation(() => Promise.resolve(), vi.fn(), claim);
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
  });

  it("still closes while the invocation owns the open picker", async () => {
    await settleInvocation(() => Promise.resolve(), vi.fn(), () => true);
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  it("checks ownership even when the invocation rejected", async () => {
    const onError = vi.fn();
    await settleInvocation(() => Promise.reject(new Error("boom")), onError, () => false);
    expect(onError).toHaveBeenCalled();
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
  });
});

// Audit R3 #623 — the invocation used to be EVALUATED by the caller, so a
// synchronous throw escaped both the error handler and the close.
describe("settleInvocation — a synchronous throw is still a settled invocation", () => {
  it("reports a thunk that throws before it ever returns a promise", async () => {
    const onError = vi.fn();
    const boom = new Error("threw before awaiting");
    await expect(
      settleInvocation(
        () => {
          throw boom;
        },
        onError,
      ),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("closes the picker after a synchronous throw, rather than leaving it open", async () => {
    useGeniePickerStore.getState().openPicker();
    await settleInvocation(() => {
      throw new Error("boom");
    }, vi.fn());
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });
});
