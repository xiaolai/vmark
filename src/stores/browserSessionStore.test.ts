// WI-P6.4/P6.5 — the frontend registry of saved sessions + named profiles.
//
// The OS keychain (session blobs) and WebKit named stores cannot be enumerated, so
// the UI needs this metadata-only registry to LIST what exists. It holds NO
// credential values — only a handle/profile name, a value-free count summary, and a
// timestamp. Isolation: reset between tests.
import { describe, it, expect, beforeEach } from "vitest";
import { useBrowserSessionStore } from "./browserSessionStore";

beforeEach(() => {
  useBrowserSessionStore.setState({ sessions: [], profiles: [] });
});

describe("saved sessions", () => {
  it("records a saved session by handle with its value-free summary", () => {
    useBrowserSessionStore.getState().recordSession("work_login", "2 cookie(s), 1 origin(s)", 1000);
    expect(useBrowserSessionStore.getState().sessions).toEqual([
      { handle: "work_login", summary: "2 cookie(s), 1 origin(s)", savedAt: 1000 },
    ]);
  });

  it("re-recording the same handle updates it in place (no duplicates)", () => {
    const s = useBrowserSessionStore.getState();
    s.recordSession("work_login", "old", 1000);
    s.recordSession("work_login", "new", 2000);
    const { sessions } = useBrowserSessionStore.getState();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ handle: "work_login", summary: "new", savedAt: 2000 });
  });

  it("forgets a session by handle", () => {
    const s = useBrowserSessionStore.getState();
    s.recordSession("a", "x", 1);
    s.recordSession("b", "y", 2);
    s.forgetSession("a");
    expect(useBrowserSessionStore.getState().sessions.map((e) => e.handle)).toEqual(["b"]);
  });

  it("stores no credential value — only handle, summary, timestamp", () => {
    useBrowserSessionStore.getState().recordSession("h", "3 cookie(s), 0 origin(s), 5 item(s)", 1);
    const json = JSON.stringify(useBrowserSessionStore.getState().sessions);
    expect(json).not.toMatch(/token|secret|value|cookie-value/i);
  });
});

describe("named profiles", () => {
  it("records a profile use and de-dupes by name, keeping the latest use time", () => {
    const s = useBrowserSessionStore.getState();
    s.recordProfileUse("work", 1000);
    s.recordProfileUse("work", 2000);
    s.recordProfileUse("personal", 1500);
    const { profiles } = useBrowserSessionStore.getState();
    expect(profiles).toHaveLength(2);
    expect(profiles.find((p) => p.name === "work")).toMatchObject({ name: "work", usedAt: 2000 });
  });

  it("removes a profile by name", () => {
    const s = useBrowserSessionStore.getState();
    s.recordProfileUse("work", 1);
    s.recordProfileUse("personal", 2);
    s.removeProfile("work");
    expect(useBrowserSessionStore.getState().profiles.map((p) => p.name)).toEqual(["personal"]);
  });
});
