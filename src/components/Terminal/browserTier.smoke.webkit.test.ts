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

describe("browser tier — foundational guarantees", () => {
  it("instantiates a real Terminal with a live helper textarea", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const term = new Terminal({ cols: 80, rows: 24 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    term.open(host);
    expect(term.textarea).toBeTruthy();
    expect(host.contains(term.textarea ?? null)).toBe(true);
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
