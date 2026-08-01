/**
 * The host-document seam.
 *
 * @coordinates-with plugins/shared/hostDocument.ts
 * @module plugins/shared/hostDocument.test
 */
import { describe, it, expect, afterEach } from "vitest";
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
