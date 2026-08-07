// @vitest-environment node
// WI-4.2 — "Open Terminal Here" (F2).
import { describe, it, expect, beforeEach } from "vitest";
import {
  useUIStore,
  resetTerminalSessionStore,
  MAX_TERMINAL_SESSIONS,
} from "@/stores/uiStore";
import { openTerminalHere, canOpenTerminalHere } from "./openTerminalHere";

describe("openTerminalHere (WI-4.2)", () => {
  beforeEach(() => {
    resetTerminalSessionStore();
    if (useUIStore.getState().terminalVisible) useUIStore.getState().toggleTerminal();
  });

  it("creates a session pinned to the requested directory", () => {
    const result = openTerminalHere("/w/pkg/api");

    expect(result.ok).toBe(true);
    const session = useUIStore
      .getState()
      .terminal.sessions.find((s) => s.id === result.sessionId);
    expect(session?.requestedCwd).toBe("/w/pkg/api");
  });

  it("makes the panel visible when it was hidden", () => {
    expect(useUIStore.getState().terminalVisible).toBe(false);
    openTerminalHere("/w/pkg");
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("leaves an already-visible panel visible", () => {
    useUIStore.getState().toggleTerminal();
    expect(useUIStore.getState().terminalVisible).toBe(true);
    openTerminalHere("/w/pkg");
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("activates the new session", () => {
    openTerminalHere("/w/a");
    const first = useUIStore.getState().terminal.activeSessionId;
    const second = openTerminalHere("/w/b");
    expect(useUIStore.getState().terminal.activeSessionId).toBe(second.sessionId);
    expect(second.sessionId).not.toBe(first);
  });

  it("refuses at the session cap instead of silently doing nothing", () => {
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) {
      useUIStore.getState().terminalCreateSession();
    }
    expect(canOpenTerminalHere()).toBe(false);

    const result = openTerminalHere("/w/pkg");

    expect(result).toEqual({ ok: false, reason: "max-sessions" });
    expect(useUIStore.getState().terminal.sessions).toHaveLength(
      MAX_TERMINAL_SESSIONS,
    );
  });

  it("does not reveal the panel when the request was refused", () => {
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) {
      useUIStore.getState().terminalCreateSession();
    }
    openTerminalHere("/w/pkg");
    expect(useUIStore.getState().terminalVisible).toBe(false);
  });

  it.each(["", "   "])("refuses a blank path (%j)", (path) => {
    const result = openTerminalHere(path);
    expect(result).toEqual({ ok: false, reason: "no-directory" });
    expect(useUIStore.getState().terminal.sessions).toHaveLength(0);
  });

  it("canOpenTerminalHere is true below the cap", () => {
    expect(canOpenTerminalHere()).toBe(true);
    for (let i = 0; i < MAX_TERMINAL_SESSIONS - 1; i++) {
      useUIStore.getState().terminalCreateSession();
    }
    expect(canOpenTerminalHere()).toBe(true);
  });

  it("preserves a path containing spaces and CJK verbatim", () => {
    const result = openTerminalHere("/Users/me/My 项目");
    const session = useUIStore
      .getState()
      .terminal.sessions.find((s) => s.id === result.sessionId);
    expect(session?.requestedCwd).toBe("/Users/me/My 项目");
  });

  it("does NOT trim a directory whose name has leading/trailing spaces", () => {
    // " notes " is a legal directory name on macOS and Linux; trimming it
    // would spawn the shell in a different directory, or none.
    const result = openTerminalHere("/w/ notes ");
    const session = useUIStore
      .getState()
      .terminal.sessions.find((s) => s.id === result.sessionId);
    expect(session?.requestedCwd).toBe("/w/ notes ");
  });

  it("always creates a NEW session, even when one is already active", () => {
    // "Open Terminal Here" means a terminal *here* — reusing the active
    // session would leave the user in whatever directory it was already in.
    const first = openTerminalHere("/w/a");
    const second = openTerminalHere("/w/b");
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(useUIStore.getState().terminal.sessions).toHaveLength(2);
  });
});

describe("requestedCwd peek/clear (WI-4.2)", () => {
  beforeEach(() => {
    resetTerminalSessionStore();
  });

  it("peeking does NOT consume the requested cwd", () => {
    // The spawn path peeks before spawning and clears only on success — a
    // failed first spawn must still be retryable in the requested directory.
    const { sessionId } = openTerminalHere("/w/pkg");
    expect(useUIStore.getState().terminalPeekRequestedCwd(sessionId!)).toBe("/w/pkg");
    expect(useUIStore.getState().terminalPeekRequestedCwd(sessionId!)).toBe("/w/pkg");
  });

  it("clearing releases it, so a later restart resolves normally", () => {
    const { sessionId } = openTerminalHere("/w/pkg");
    useUIStore.getState().terminalClearRequestedCwd(sessionId!);
    expect(useUIStore.getState().terminalPeekRequestedCwd(sessionId!)).toBeUndefined();
  });

  it("returns undefined for a session created without one", () => {
    const session = useUIStore.getState().terminalCreateSession()!;
    expect(useUIStore.getState().terminalPeekRequestedCwd(session.id)).toBeUndefined();
  });

  it("returns undefined for an unknown session id", () => {
    expect(useUIStore.getState().terminalPeekRequestedCwd("term-nope")).toBeUndefined();
  });

  it("clearing an unknown session id is a no-op that does not touch state", () => {
    openTerminalHere("/w/a");
    const before = useUIStore.getState().terminal.sessions;
    useUIStore.getState().terminalClearRequestedCwd("term-nope");
    // Same array reference: no subscriber should have been woken.
    expect(useUIStore.getState().terminal.sessions).toBe(before);
  });

  it("clearing one session does not disturb another", () => {
    const a = openTerminalHere("/w/a").sessionId!;
    const b = openTerminalHere("/w/b").sessionId!;
    useUIStore.getState().terminalClearRequestedCwd(a);
    expect(useUIStore.getState().terminalPeekRequestedCwd(b)).toBe("/w/b");
  });
});
