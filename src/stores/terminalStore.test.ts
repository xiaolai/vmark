import { beforeEach, describe, expect, it } from "vitest";
import {
  useTerminalStore,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_WIDTH,
  TERMINAL_MAX_WIDTH,
  MAX_SESSIONS,
  type TerminalSession,
} from "./terminalStore";

function resetTerminalStore() {
  useTerminalStore.setState({
    visible: false,
    height: 200,
    width: 400,
    sessions: [],
    activeSessionId: null,
  });
}

function createSession(id: string, overrides?: Partial<TerminalSession>): TerminalSession {
  return {
    id,
    title: `Terminal ${id}`,
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(resetTerminalStore);

describe("terminalStore", () => {
  describe("visibility", () => {
    it("toggles visibility", () => {
      const store = useTerminalStore.getState();

      expect(useTerminalStore.getState().visible).toBe(false);
      store.toggle();
      expect(useTerminalStore.getState().visible).toBe(true);
      store.toggle();
      expect(useTerminalStore.getState().visible).toBe(false);
    });

    it("sets visibility directly", () => {
      const store = useTerminalStore.getState();

      store.setVisible(true);
      expect(useTerminalStore.getState().visible).toBe(true);
      store.setVisible(false);
      expect(useTerminalStore.getState().visible).toBe(false);
    });
  });

  describe("resize", () => {
    it("clamps height to min/max bounds", () => {
      const store = useTerminalStore.getState();

      store.setHeight(50);
      expect(useTerminalStore.getState().height).toBe(TERMINAL_MIN_HEIGHT);

      store.setHeight(1000);
      expect(useTerminalStore.getState().height).toBe(TERMINAL_MAX_HEIGHT);

      store.setHeight(300);
      expect(useTerminalStore.getState().height).toBe(300);
    });

    it("clamps width to min/max bounds", () => {
      const store = useTerminalStore.getState();

      store.setWidth(50);
      expect(useTerminalStore.getState().width).toBe(TERMINAL_MIN_WIDTH);

      store.setWidth(1000);
      expect(useTerminalStore.getState().width).toBe(TERMINAL_MAX_WIDTH);

      store.setWidth(500);
      expect(useTerminalStore.getState().width).toBe(500);
    });
  });

  describe("session management", () => {
    it("adds a session and sets it as active", () => {
      const store = useTerminalStore.getState();
      const session = createSession("session-1");

      store.addSession(session);

      expect(useTerminalStore.getState().sessions).toHaveLength(1);
      expect(useTerminalStore.getState().activeSessionId).toBe("session-1");
    });

    it("respects MAX_SESSIONS limit", () => {
      const store = useTerminalStore.getState();

      for (let i = 0; i < MAX_SESSIONS + 2; i++) {
        store.addSession(createSession(`session-${i}`));
      }

      expect(useTerminalStore.getState().sessions).toHaveLength(MAX_SESSIONS);
    });

    it("removes a session and updates active", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("session-1"));
      store.addSession(createSession("session-2"));

      store.removeSession("session-2");

      expect(useTerminalStore.getState().sessions).toHaveLength(1);
      expect(useTerminalStore.getState().activeSessionId).toBe("session-1");
    });

    it("updates active session when removing the active one", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("session-1"));
      store.addSession(createSession("session-2"));
      store.setActiveSession("session-1");

      store.removeSession("session-1");

      expect(useTerminalStore.getState().activeSessionId).toBe("session-2");
    });

    it("clears active session when removing the last session", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("session-1"));

      store.removeSession("session-1");

      expect(useTerminalStore.getState().sessions).toHaveLength(0);
      expect(useTerminalStore.getState().activeSessionId).toBeNull();
    });

    it("updates session title", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("session-1"));

      store.updateSessionTitle("session-1", "New Title");

      expect(useTerminalStore.getState().sessions[0].title).toBe("New Title");
    });

    it("clears all sessions", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("session-1"));
      store.addSession(createSession("session-2"));

      store.clearSessions();

      expect(useTerminalStore.getState().sessions).toHaveLength(0);
      expect(useTerminalStore.getState().activeSessionId).toBeNull();
    });
  });

  describe("session ID updates", () => {
    it("updates session ID and active session reference", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("old-id"));

      store.updateSessionId("old-id", "new-id");

      expect(useTerminalStore.getState().sessions[0].id).toBe("new-id");
      expect(useTerminalStore.getState().activeSessionId).toBe("new-id");
    });

    it("clears needsRestore flag when updating ID", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("old-id", { needsRestore: true }));

      store.updateSessionId("old-id", "new-id");

      expect(useTerminalStore.getState().sessions[0].needsRestore).toBe(false);
    });

    it("updates splitWith references when ID changes", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("primary"));
      store.splitSession("primary", "split-placeholder", "horizontal");

      // The split session has splitWith: "primary"
      // Now update primary's ID
      store.updateSessionId("primary", "primary-new");

      const sessions = useTerminalStore.getState().sessions;
      const splitSession = sessions.find((s) => s.id === "split-placeholder");
      expect(splitSession?.splitWith).toBe("primary-new");
    });
  });

  describe("split management", () => {
    it("creates a split session with correct references", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("primary"));

      store.splitSession("primary", "split-1", "horizontal");

      const sessions = useTerminalStore.getState().sessions;
      expect(sessions).toHaveLength(2);

      const primary = sessions.find((s) => s.id === "primary");
      const split = sessions.find((s) => s.id === "split-1");

      expect(primary?.splitWith).toBe("split-1");
      expect(primary?.splitDirection).toBe("horizontal");
      expect(split?.splitWith).toBe("primary");
      expect(split?.splitDirection).toBeUndefined();
    });

    it("prevents splitting when already at MAX_SESSIONS", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("session-1"));
      store.addSession(createSession("session-2"));

      store.splitSession("session-1", "split-1", "horizontal");

      expect(useTerminalStore.getState().sessions).toHaveLength(MAX_SESSIONS);
    });

    it("prevents splitting an already split session", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("primary", { splitWith: "other" }));

      store.splitSession("primary", "new-split", "horizontal");

      // Should not add a new session
      expect(useTerminalStore.getState().sessions).toHaveLength(1);
    });

    it("unsplits sessions keeping both", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("primary"));
      store.splitSession("primary", "split-1", "horizontal");

      store.unsplitSession("primary");

      const sessions = useTerminalStore.getState().sessions;
      expect(sessions).toHaveLength(2);
      expect(sessions[0].splitWith).toBeUndefined();
      expect(sessions[0].splitDirection).toBeUndefined();
      expect(sessions[1].splitWith).toBeUndefined();
    });

    it("gets split sibling correctly", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("primary"));
      store.splitSession("primary", "split-1", "vertical");

      const sibling = store.getSplitSibling("primary");
      expect(sibling?.id).toBe("split-1");

      const primaryFromSplit = store.getSplitSibling("split-1");
      expect(primaryFromSplit?.id).toBe("primary");
    });

    it("returns null for non-split session sibling", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("solo"));

      const sibling = store.getSplitSibling("solo");
      expect(sibling).toBeNull();
    });
  });

  describe("split cleanup on remove", () => {
    it("clears splitWith on sibling when removing split session", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("primary"));
      store.splitSession("primary", "split-1", "horizontal");

      store.removeSession("split-1");

      const sessions = useTerminalStore.getState().sessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].splitWith).toBeUndefined();
      expect(sessions[0].splitDirection).toBeUndefined();
    });

    it("clears splitWith on sibling when removing primary session", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("primary"));
      store.splitSession("primary", "split-1", "horizontal");

      store.removeSession("primary");

      const sessions = useTerminalStore.getState().sessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("split-1");
      expect(sessions[0].splitWith).toBeUndefined();
    });
  });

  describe("session persistence/restore", () => {
    it("marks session as restored", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("session-1", { needsRestore: true }));

      store.markSessionRestored("session-1");

      expect(useTerminalStore.getState().sessions[0].needsRestore).toBe(false);
    });

    it("returns only sessions needing restore", () => {
      const store = useTerminalStore.getState();
      store.addSession(createSession("session-1", { needsRestore: true }));
      store.addSession(createSession("session-2", { needsRestore: false }));

      const toRestore = store.getSessionsToRestore();

      expect(toRestore).toHaveLength(1);
      expect(toRestore[0].id).toBe("session-1");
    });
  });
});
