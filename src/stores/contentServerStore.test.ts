// Phase 5 — content-server status store transitions.
import { beforeEach, describe, expect, it } from "vitest";
import {
  useContentServerStore,
  selectIsRunning,
  selectServerStatus,
} from "./contentServerStore";

beforeEach(() => {
  useContentServerStore.getState().reset();
});

describe("contentServerStore", () => {
  it("starts stopped", () => {
    expect(selectServerStatus(useContentServerStore.getState())).toBe("stopped");
  });

  it("tracks provisioning progress", () => {
    useContentServerStore.getState().setProvision({ phase: "downloading", received: 10, total: 100 });
    const s = useContentServerStore.getState();
    expect(s.status).toBe("provisioning");
    expect(s.provision).toMatchObject({ phase: "downloading", received: 10, total: 100 });
  });

  it("enters error on a failed provision phase", () => {
    useContentServerStore.getState().setProvision({ phase: "failed", reason: "checksum mismatch" });
    const s = useContentServerStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toBe("checksum mismatch");
  });

  it("transitions starting → running and exposes url/port", () => {
    useContentServerStore.getState().setStarting();
    expect(useContentServerStore.getState().status).toBe("starting");
    useContentServerStore.getState().setRunning("http://127.0.0.1:4123", 4123);
    const s = useContentServerStore.getState();
    expect(selectIsRunning(s)).toBe(true);
    expect(s.url).toBe("http://127.0.0.1:4123");
    expect(s.port).toBe(4123);
  });

  it("stop clears url/port/deck and returns to stopped", () => {
    useContentServerStore.getState().setRunning("http://127.0.0.1:1", 1);
    useContentServerStore.getState().setSlidevDeck("/a/deck.md");
    useContentServerStore.getState().stop();
    const s = useContentServerStore.getState();
    expect(s.status).toBe("stopped");
    expect(s.url).toBeNull();
    expect(s.slidevDeckPath).toBeNull();
  });

  it("tracks the active Slidev deck", () => {
    useContentServerStore.getState().setSlidevDeck("/decks/talk.md");
    expect(useContentServerStore.getState().slidevDeckPath).toBe("/decks/talk.md");
  });
});
