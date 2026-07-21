import { describe, it, expect, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { resolveHelperTextarea } from "./resolveHelperTextarea";

const mockTerminalError = vi.fn();
vi.mock("@/utils/debug", () => ({
  terminalError: (...args: unknown[]) => mockTerminalError(...args),
}));

function makeTerm(textarea: HTMLTextAreaElement | undefined): Terminal {
  return { textarea } as unknown as Terminal;
}

describe("resolveHelperTextarea", () => {
  it("returns the textarea when present and inside the container", () => {
    const container = document.createElement("div");
    const ta = document.createElement("textarea");
    container.appendChild(ta);
    expect(resolveHelperTextarea(makeTerm(ta), container, false)).toBe(ta);
  });

  it("throws in dev when the textarea is absent", () => {
    const container = document.createElement("div");
    expect(() => resolveHelperTextarea(makeTerm(undefined), container, true)).toThrow(/textarea/i);
  });

  it("logs (does not throw) and returns undefined in prod when absent", () => {
    mockTerminalError.mockClear();
    const container = document.createElement("div");
    expect(resolveHelperTextarea(makeTerm(undefined), container, false)).toBeUndefined();
    expect(mockTerminalError).toHaveBeenCalledWith(expect.stringContaining("absent"));
  });

  it("throws in dev when the textarea is NOT inside the container", () => {
    const container = document.createElement("div");
    const ta = document.createElement("textarea"); // not appended
    expect(() => resolveHelperTextarea(makeTerm(ta), container, true)).toThrow(/not inside/i);
  });

  it("logs but still returns the textarea in prod when outside the container", () => {
    mockTerminalError.mockClear();
    const container = document.createElement("div");
    const ta = document.createElement("textarea");
    expect(resolveHelperTextarea(makeTerm(ta), container, false)).toBe(ta);
    expect(mockTerminalError).toHaveBeenCalledWith(expect.stringContaining("not inside"));
  });
});
