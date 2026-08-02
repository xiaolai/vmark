/**
 * The host-document seam.
 *
 * @coordinates-with plugins/shared/hostDocument.ts
 * @module plugins/shared/hostDocument.test
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { hostDocument, bindHostDocument, resetHostDocument } from "./hostDocument";

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
