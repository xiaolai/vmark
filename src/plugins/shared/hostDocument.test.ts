// @vitest-environment node
/**
 * The host-document seam.
 *
 * WI-11 — the window label is now a SEAM MEMBER (`currentWindowLabel`), not a
 * static `@/services/navigation/windowFocus` import. The module whose whole
 * purpose is host independence was hard-linked to an app service, so the one
 * file a lifted-out plugin must be able to carry dragged the app in with it.
 *
 * Rebind semantics, pinned below and decided here: **last write wins, and a
 * rebind REPLACES rather than merges** — members the new binding omits fall
 * back to the defaults, not to whatever the previous binding supplied. The
 * seam is bound once at the composition root; a silent merge would make a
 * second, partial binding produce a half-app/half-default hybrid that no
 * single call site declares.
 *
 * @coordinates-with plugins/shared/hostDocument.ts
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/shared/hostDocument.test
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  hostDocument,
  bindHostDocument,
  resetHostDocument,
  activeFilePathForCurrentWindow,
} from "./hostDocument";

afterEach(resetHostDocument);

describe("an unbound host answers honestly", () => {
  it("reports no document rather than throwing", () => {
    // Null is a real answer: an untitled buffer has no path either, so a
    // relative link has nothing to resolve against. A plugin lifted out of
    // this repo gets that same answer instead of a crash.
    expect(hostDocument.activeFilePath("main")).toBeNull();
  });
});

describe("binding supplies the real lookup", () => {
  it("passes the window label through", () => {
    bindHostDocument({ activeFilePath: (label) => `/docs/${label}.md` });
    expect(hostDocument.activeFilePath("second")).toBe("/docs/second.md");
  });

  it("reads LIVE, so switching documents is picked up", () => {
    let path: string | null = "/a.md";
    bindHostDocument({ activeFilePath: () => path });
    expect(hostDocument.activeFilePath("main")).toBe("/a.md");
    path = "/b.md";
    expect(hostDocument.activeFilePath("main")).toBe("/b.md");
  });

  it("still reports null for a window with no document", () => {
    bindHostDocument({ activeFilePath: () => null });
    expect(hostDocument.activeFilePath("main")).toBeNull();
  });
});

describe("cursor reporting", () => {
  it("does nothing when unbound, rather than throwing", () => {
    // A plugin lifted out of this repo still tracks the cursor; it simply has
    // nobody to tell.
    expect(() => hostDocument.reportCursorInfo("main", { sourceLine: 1 })).not.toThrow();
  });

  it("passes the window label and the info through", () => {
    const reported: unknown[] = [];
    bindHostDocument({ reportCursorInfo: (label, info) => reported.push([label, info]) });
    hostDocument.reportCursorInfo("doc-2", { sourceLine: 42 });
    expect(reported).toEqual([["doc-2", { sourceLine: 42 }]]);
  });
});

describe("the unbound defaults are the honest 'no document' answers", () => {
  beforeEach(resetHostDocument);

  it("reports no path, no root, no format and a clean empty buffer", () => {
    expect(hostDocument.activeFilePath("main")).toBeNull();
    expect(hostDocument.workspaceRoot()).toBeNull();
    expect(hostDocument.activeFormatId("main")).toBeNull();
    expect(hostDocument.activeContent("main")).toBe("");
    expect(hostDocument.isTabDirty("tab-1")).toBe(false);
  });

  it("reports an UNKNOWN hard-break style rather than guessing one", () => {
    // Not a style default: a buffer with no evidence must not be claimed to
    // use either spelling, or the resolver would stop consulting the setting.
    expect(hostDocument.activeHardBreakStyle("main")).toBe("unknown");
  });

  it("swallows writes instead of throwing", () => {
    expect(() => hostDocument.reportCursorInfo("main", { sourceLine: 1 })).not.toThrow();
    expect(() => hostDocument.checkpoint("main", { markdown: "x", mode: "wysiwyg" })).not.toThrow();
  });

  it("reports NO current window rather than reaching for an app service", () => {
    // Case 8. The seam default: an unbound host has no window, so the guarded
    // convenience has nothing to resolve against and answers null — exactly
    // what the app answered when `getWindowLabel()` threw outside Tauri.
    expect(hostDocument.currentWindowLabel()).toBeNull();
    expect(activeFilePathForCurrentWindow()).toBeNull();
  });

  it("routes each member to the binding once bound", () => {
    const checkpoint = vi.fn();
    bindHostDocument({
      workspaceRoot: () => "/vault",
      activeFormatId: () => "markdown",
      activeContent: () => "body",
      activeHardBreakStyle: () => "twoSpaces",
      isTabDirty: () => true,
      checkpoint,
    });
    expect(hostDocument.workspaceRoot()).toBe("/vault");
    expect(hostDocument.activeFormatId("main")).toBe("markdown");
    expect(hostDocument.activeContent("main")).toBe("body");
    expect(hostDocument.activeHardBreakStyle("main")).toBe("twoSpaces");
    expect(hostDocument.isTabDirty("tab-1")).toBe(true);
    hostDocument.checkpoint("main", { markdown: "b", mode: "wysiwyg" });
    expect(checkpoint).toHaveBeenCalledWith("main", { markdown: "b", mode: "wysiwyg" });
  });
});

describe("activeFilePathForCurrentWindow reads the window through the seam", () => {
  beforeEach(resetHostDocument);

  it("uses the host's window label, not an app service", () => {
    // Case 9. The label is data the host supplies; the plugin only asks. If
    // the static `@/services/navigation/windowFocus` import came back, this
    // would answer for whatever window the app happened to be in, not "second".
    bindHostDocument({
      currentWindowLabel: () => "second",
      activeFilePath: (label) => (label === "second" ? "/x/y.md" : null),
    });
    expect(activeFilePathForCurrentWindow()).toBe("/x/y.md");
  });

  it("returns null when the host reports no window", () => {
    bindHostDocument({
      currentWindowLabel: () => null,
      activeFilePath: () => "/must/not/be/used.md",
    });
    expect(activeFilePathForCurrentWindow()).toBeNull();
  });

  it("swallows a THROWING window lookup — the guard eight call sites rely on", () => {
    // `getWindowLabel()` throws outside a Tauri context, and six plugin files
    // had each hand-rolled this try/catch while two had not (a copy-resolution
    // handler could reject instead of falling back). The guard stays here, on
    // the seam side, so moving the label behind the seam cannot lose it again.
    bindHostDocument({
      currentWindowLabel: () => {
        throw new Error("no Tauri window");
      },
      activeFilePath: () => "/must/not/be/used.md",
    });
    expect(activeFilePathForCurrentWindow()).toBeNull();
  });

  it("does NOT swallow a failure inside the path lookup", () => {
    // Only the LABEL lookup is guarded. A wider try would hide host failures
    // that several callers wrap themselves precisely so they can log them.
    bindHostDocument({
      currentWindowLabel: () => "main",
      activeFilePath: () => {
        throw new Error("document store exploded");
      },
    });
    expect(() => activeFilePathForCurrentWindow()).toThrow("document store exploded");
  });
});

describe("rebinding replaces, and the last write wins", () => {
  beforeEach(resetHostDocument);

  it("lets a second bind win over the first", () => {
    // Case 11. Not an error: the composition root binds once, and tests /
    // future multi-window hosts rebind. Silent no-op-on-second-bind would make
    // a mis-ordered startup impossible to diagnose.
    bindHostDocument({ activeFilePath: () => "/first.md" });
    bindHostDocument({ activeFilePath: () => "/second.md" });
    expect(hostDocument.activeFilePath("main")).toBe("/second.md");
  });

  it("resets members the new binding omits to the DEFAULTS, not the old binding", () => {
    bindHostDocument({ currentWindowLabel: () => "second", workspaceRoot: () => "/vault" });
    bindHostDocument({ workspaceRoot: () => "/other-vault" });
    expect(hostDocument.workspaceRoot()).toBe("/other-vault");
    expect(hostDocument.currentWindowLabel()).toBeNull();
  });
});
