// @vitest-environment node
// WI-4.3 — the registration path that lets document content reach a terminal.
//
// `runInTerminal.test.ts` mocks this module wholesale, so without this file the
// registration/cleanup contract would ship unverified. The ordering case
// matters in practice: React runs a remount's effect BEFORE the old effect's
// cleanup, so a naive `resolver = null` on cleanup would unregister the panel
// that is actually live.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerTerminalResolver,
  getTerminalForSession,
  type RunTargetTerminal,
} from "./activeTerminal";

const term = (id: string) =>
  ({ id, paste: vi.fn(), focus: vi.fn(), modes: { bracketedPasteMode: true } }) as unknown as
    RunTargetTerminal;

describe("activeTerminal (WI-4.3)", () => {
  let cleanups: Array<() => void>;

  beforeEach(() => {
    // Leave the module unregistered between tests.
    cleanups = [];
    registerTerminalResolver(() => null)();
  });

  function register(resolver: (id: string) => RunTargetTerminal | null) {
    const off = registerTerminalResolver(resolver);
    cleanups.push(off);
    return off;
  }

  it("returns null when no resolver is registered", () => {
    expect(getTerminalForSession("term-1")).toBeNull();
  });

  it("resolves a registered session", () => {
    const t = term("a");
    register((id) => (id === "term-1" ? t : null));
    expect(getTerminalForSession("term-1")).toBe(t);
  });

  it("returns null for a session the resolver does not know", () => {
    register(() => null);
    expect(getTerminalForSession("term-gone")).toBeNull();
  });

  it("passes the requested session id through — not 'the active one'", () => {
    const resolver = vi.fn(() => null);
    register(resolver);
    getTerminalForSession("term-42");
    expect(resolver).toHaveBeenCalledWith("term-42");
  });

  it("unregisters on cleanup", () => {
    const off = register(() => term("a"));
    expect(getTerminalForSession("term-1")).not.toBeNull();
    off();
    expect(getTerminalForSession("term-1")).toBeNull();
  });

  it("cleanup is idempotent", () => {
    const off = register(() => term("a"));
    off();
    expect(() => off()).not.toThrow();
    expect(getTerminalForSession("term-1")).toBeNull();
  });

  it("a later registration replaces the earlier one", () => {
    const first = term("first");
    const second = term("second");
    register(() => first);
    register(() => second);
    expect(getTerminalForSession("term-1")).toBe(second);
  });

  it("the OLD cleanup running after a remount does not unregister the new panel", () => {
    // React's remount order: new effect first, then the old effect's cleanup.
    // Clearing unconditionally there would leave the live panel unreachable
    // and every "Run in Terminal" would silently time out.
    const oldTerm = term("old");
    const newTerm = term("new");
    const offOld = register(() => oldTerm);
    register(() => newTerm);

    offOld(); // stale cleanup, arrives late

    expect(getTerminalForSession("term-1")).toBe(newTerm);
  });

  it("the newest cleanup does unregister", () => {
    register(() => term("old"));
    const offNew = register(() => term("new"));
    offNew();
    expect(getTerminalForSession("term-1")).toBeNull();
  });
});
