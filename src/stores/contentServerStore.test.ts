// Phase 5 — content-server status store transitions.
import { beforeEach, describe, expect, it } from "vitest";
import {
  useContentServerStore,
  selectIsRunning,
  selectServerStatus,
  selectServerUrl,
  selectProvision,
  selectSlidevDeck,
  selectError,
  selectPanelOpen,
  selectIframeUrl,
  selectViewMode,
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

describe("contentServerStore — panel, iframe, view, errors", () => {
  const s = () => useContentServerStore.getState();

  it("setProvision falls back to a default reason when none given", () => {
    s().setProvision({ phase: "failed" });
    expect(s().error).toBe("provisioning failed");
  });

  it("setError records the message and error status", () => {
    s().setError("spawn failed");
    expect(s().status).toBe("error");
    expect(s().error).toBe("spawn failed");
  });

  it("setStarting clears a prior error", () => {
    s().setError("boom");
    s().setStarting();
    expect(s().error).toBeNull();
  });

  it("setPanelOpen and togglePanel control the inspector panel", () => {
    s().setPanelOpen(true);
    expect(s().panelOpen).toBe(true);
    s().togglePanel();
    expect(s().panelOpen).toBe(false);
    s().togglePanel();
    expect(s().panelOpen).toBe(true);
  });

  it("setIframeUrl stores and clears the one-time auth URL", () => {
    s().setIframeUrl("http://127.0.0.1:7/__auth?t=n");
    expect(s().iframeUrl).toBe("http://127.0.0.1:7/__auth?t=n");
    s().stop();
    expect(s().iframeUrl).toBeNull();
  });

  it("setViewMode switches between site and graph", () => {
    s().setViewMode("graph");
    expect(s().viewMode).toBe("graph");
    s().setViewMode("site");
    expect(s().viewMode).toBe("site");
  });

  it("selectors expose the matching slice of state", () => {
    s().setRunning("http://127.0.0.1:9", 9);
    s().setSlidevDeck("/d.md");
    s().setIframeUrl("http://i");
    s().setViewMode("graph");
    s().setPanelOpen(true);
    const st = s();
    expect(selectServerUrl(st)).toBe("http://127.0.0.1:9");
    expect(selectProvision(st)).toBeNull();
    expect(selectSlidevDeck(st)).toBe("/d.md");
    expect(selectError(st)).toBeNull();
    expect(selectPanelOpen(st)).toBe(true);
    expect(selectIframeUrl(st)).toBe("http://i");
    expect(selectViewMode(st)).toBe("graph");
  });
});
