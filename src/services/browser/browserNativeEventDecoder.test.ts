// @vitest-environment node
// Audit 2026-09-03 round 3 (#80) — ONE validated decoder for the native browser
// events. `browserNavEvents` (the UI handlers) and `browserEventBroker` (the MCP
// waiters) used to decode the same six payloads independently, and had drifted: the
// broker defaulted a missing generation to 0 and a missing url to "", exactly the
// values the round-2 validation (#81) exists to refuse. Every consumer now sees the
// same typed event or nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserWarn } from "@/utils/debug";
import { BROWSER_NATIVE_EVENTS, decodeBrowserNativeEvent } from "./browserNativeEventDecoder";

vi.mock("@/utils/debug", () => ({ browserWarn: vi.fn() }));

beforeEach(() => vi.mocked(browserWarn).mockClear());

describe("decodeBrowserNativeEvent — every kind", () => {
  it("names the six native events the emitter produces, each exactly once", () => {
    expect([...BROWSER_NATIVE_EVENTS].sort()).toEqual(
      [
        "browser://crashed",
        "browser://dialog",
        "browser://load-failed",
        "browser://loaded",
        "browser://navigated",
        "browser://popup",
      ].sort(),
    );
  });

  it.each(BROWSER_NATIVE_EVENTS)("%s: drops a payload whose tabId is not a string, with a warning", (event) => {
    expect(decodeBrowserNativeEvent(event, { tabId: 42, url: "https://a.example/", generation: 1 })).toBeNull();
    expect(decodeBrowserNativeEvent(event, null)).toBeNull();
    expect(decodeBrowserNativeEvent(event, "not an object")).toBeNull();
    expect(browserWarn).toHaveBeenCalledTimes(3);
  });
});

describe("navigated", () => {
  it("decodes a well-formed commit with its history flags, redirect flag and ticket", () => {
    expect(
      decodeBrowserNativeEvent("browser://navigated", {
        tabId: "t1",
        url: "https://a.example/",
        generation: 4,
        redirected: true,
        navigationId: "nav-9",
        canGoBack: true,
        canGoForward: false,
      }),
    ).toEqual({
      kind: "navigated",
      tabId: "t1",
      url: "https://a.example/",
      generation: 4,
      redirected: true,
      navigationId: "nav-9",
      canGoBack: true,
      canGoForward: false,
    });
  });

  it("coerces missing flags to false and omits a non-string ticket — never `undefined` as a value", () => {
    const decoded = decodeBrowserNativeEvent("browser://navigated", {
      tabId: "t1",
      url: "https://a.example/",
      generation: 0,
      navigationId: 7,
    });
    expect(decoded).toEqual({
      kind: "navigated",
      tabId: "t1",
      url: "https://a.example/",
      generation: 0,
      redirected: false,
      canGoBack: false,
      canGoForward: false,
    });
    expect(decoded !== null && "navigationId" in decoded).toBe(false);
  });

  it.each([
    ["no generation", { tabId: "t1", url: "https://a.example/" }],
    ["a negative generation", { tabId: "t1", url: "https://a.example/", generation: -1 }],
    ["a fractional generation", { tabId: "t1", url: "https://a.example/", generation: 1.5 }],
    ["a string generation", { tabId: "t1", url: "https://a.example/", generation: "2" }],
    ["no url", { tabId: "t1", generation: 2 }],
    ["an unparseable url", { tabId: "t1", url: "not a url", generation: 2 }],
  ])("drops a commit with %s, with a warning (#81)", (_label, payload) => {
    expect(decodeBrowserNativeEvent("browser://navigated", payload)).toBeNull();
    expect(browserWarn).toHaveBeenCalledTimes(1);
  });
});

describe("loaded", () => {
  it("decodes a finished load, defaulting a missing title to the empty string", () => {
    expect(
      decodeBrowserNativeEvent("browser://loaded", {
        tabId: "t1",
        url: "https://a.example/p",
        generation: 2,
        navigationId: "nav-2",
        canGoBack: true,
      }),
    ).toEqual({
      kind: "loaded",
      tabId: "t1",
      url: "https://a.example/p",
      title: "",
      generation: 2,
      navigationId: "nav-2",
      canGoBack: true,
      canGoForward: false,
    });
  });

  it("carries a string title and ignores a non-string one", () => {
    const base = { tabId: "t1", url: "https://a.example/", generation: 1 };
    expect(decodeBrowserNativeEvent("browser://loaded", { ...base, title: "Home" })).toMatchObject({ title: "Home" });
    expect(decodeBrowserNativeEvent("browser://loaded", { ...base, title: 12 })).toMatchObject({ title: "" });
  });

  it("applies the same url/generation validation as a commit — the broker used to default both", () => {
    expect(decodeBrowserNativeEvent("browser://loaded", { tabId: "t1", navigationId: "nav-1" })).toBeNull();
    expect(decodeBrowserNativeEvent("browser://loaded", { tabId: "t1", url: "https://a.example/" })).toBeNull();
    expect(browserWarn).toHaveBeenCalledTimes(2);
  });
});

describe("failed", () => {
  it("decodes a failure with its message and ticket", () => {
    expect(
      decodeBrowserNativeEvent("browser://load-failed", { tabId: "t1", message: "offline", navigationId: "nav-3" }),
    ).toEqual({ kind: "failed", tabId: "t1", message: "offline", navigationId: "nav-3" });
  });

  it("omits the ticket when the payload has none (an older driver), and never invents a message", () => {
    expect(decodeBrowserNativeEvent("browser://load-failed", { tabId: "t1", message: "boom" })).toEqual({
      kind: "failed",
      tabId: "t1",
      message: "boom",
    });
    expect(decodeBrowserNativeEvent("browser://load-failed", { tabId: "t1", navigationId: "nav-3" })).toBeNull();
    expect(browserWarn).toHaveBeenCalledTimes(1);
  });
});

describe("crashed", () => {
  it("passes auto-reload through and fails closed to manual for anything else", () => {
    expect(decodeBrowserNativeEvent("browser://crashed", { tabId: "t1", action: "auto-reload" })).toEqual({
      kind: "crashed",
      tabId: "t1",
      action: "auto-reload",
    });
    expect(decodeBrowserNativeEvent("browser://crashed", { tabId: "t1", action: "reloading" })).toMatchObject({
      action: "manual",
    });
    expect(decodeBrowserNativeEvent("browser://crashed", { tabId: "t1" })).toMatchObject({ action: "manual" });
  });
});

describe("dialog", () => {
  it("decodes a confirm only when its completion-handler id is a number", () => {
    expect(decodeBrowserNativeEvent("browser://dialog", { tabId: "t1", kind: "confirm", message: "Leave?", id: 7 })).toEqual(
      { kind: "dialog", tabId: "t1", dialog: { kind: "confirm", message: "Leave?", id: 7 } },
    );
    // A confirm nobody can answer is surfaced as an alert rather than offering buttons that reach no handler.
    expect(decodeBrowserNativeEvent("browser://dialog", { tabId: "t1", kind: "confirm", message: "Leave?" })).toEqual({
      kind: "dialog",
      tabId: "t1",
      dialog: { kind: "alert", message: "Leave?" },
    });
  });

  it("never drops a dialog: a non-string message becomes empty (a parked confirm must still reach the user)", () => {
    expect(decodeBrowserNativeEvent("browser://dialog", { tabId: "t1", kind: "alert" })).toEqual({
      kind: "dialog",
      tabId: "t1",
      dialog: { kind: "alert", message: "" },
    });
    expect(browserWarn).not.toHaveBeenCalled();
  });
});

describe("popup", () => {
  it("decodes a blocked popup url and drops a payload without one", () => {
    expect(decodeBrowserNativeEvent("browser://popup", { tabId: "t1", url: "https://auth.example/" })).toEqual({
      kind: "popup",
      tabId: "t1",
      url: "https://auth.example/",
    });
    expect(decodeBrowserNativeEvent("browser://popup", { tabId: "t1" })).toBeNull();
    expect(browserWarn).toHaveBeenCalledTimes(1);
  });
});
