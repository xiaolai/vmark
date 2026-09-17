/**
 * Browser-tier smoke test — locks in the two facts that make this tier exist,
 * established by the Phase 0 spike (plan Q1/Q3, rule 60 §7):
 *
 *   1. A REAL @xterm/xterm Terminal constructs + opens (jsdom globally mocks it).
 *   2. REAL keyboard input drains a microtask BETWEEN two capture listeners on
 *      one node — [L1, mt, L2] — the WKWebView mechanism the 「。」 bug rode.
 *      SYNTHETIC dispatchEvent does NOT (synchronous → [L1, L2, mt]), so gate-
 *      path tests MUST drive input via userEvent, never dispatchEvent.
 *
 * If either regresses, the gate-path verification below it is worthless — hence
 * this guards the tier itself.
 */
import { describe, it, expect } from "vitest";
import { userEvent } from "vitest/browser";
import { TERMINAL_SURFACE_SELECTOR } from "@/utils/terminalSurface";

describe("browser tier — foundational guarantees", () => {
  it("instantiates a real Terminal with a live helper textarea", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const term = new Terminal({ cols: 80, rows: 24 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    term.open(host);
    expect(term.textarea).toBeTruthy();
    expect(host.contains(term.textarea ?? null)).toBe(true);

    /**
     * The `.xterm` half of `TERMINAL_SURFACE_SELECTOR`, asked of the LIBRARY
     * rather than of a literal we wrote. That selector is how the keybinding
     * scope resolver decides a keypress is "in the terminal" and how the
     * editor⇄terminal focus toggle decides which way to move. If xterm ever
     * renames the class, both go silently blind — terminal-scoped bindings
     * quietly degrade to window bindings and the focus toggle always believes
     * focus is in the editor, with nothing failing. jsdom mocks this library,
     * so this tier is the only place the question can be asked honestly.
     * (`.terminal-container`, the other half, is asked of the real panel in
     * `TerminalPanel.test.tsx`.)
     */
    expect(term.textarea?.closest(TERMINAL_SURFACE_SELECTOR)).not.toBeNull();

    term.dispose();
  });

  it("real keyboard drains a microtask BETWEEN two capture listeners", async () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    const order: string[] = [];
    ta.addEventListener("input", () => { order.push("L1"); queueMicrotask(() => order.push("mt")); }, true);
    ta.addEventListener("input", () => order.push("L2"), true);

    ta.focus();
    await userEvent.keyboard("x");
    await new Promise((r) => setTimeout(r, 20));

    expect(order).toEqual(["L1", "mt", "L2"]);
    ta.remove();
  });

  it("synthetic dispatchEvent does NOT drain between listeners (why userEvent is required)", async () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    const order: string[] = [];
    ta.addEventListener("input", () => { order.push("L1"); queueMicrotask(() => order.push("mt")); }, true);
    ta.addEventListener("input", () => order.push("L2"), true);

    ta.dispatchEvent(new Event("input"));
    await Promise.resolve();

    expect(order).toEqual(["L1", "L2", "mt"]);
    ta.remove();
  });
});
