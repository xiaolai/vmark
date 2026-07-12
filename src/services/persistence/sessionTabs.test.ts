// WI-1.1 — versioned session-tab persistence + legacy migration + downgrade tolerance
import { describe, it, expect } from "vitest";
import {
  migratePersistedTabs,
  serializeSessionTabs,
  documentPathsOf,
  documentPathsForRestore,
  type SessionTabsV1,
} from "./sessionTabs";
import type { Tab } from "@/stores/tabStoreTypes";

describe("migratePersistedTabs", () => {
  it("migrates a legacy string[] to document records, in order", () => {
    expect(migratePersistedTabs(undefined, ["/a.md", "/b.md"])).toEqual([
      { kind: "document", path: "/a.md" },
      { kind: "document", path: "/b.md" },
    ]);
  });

  it("returns [] for empty/nullish legacy and no sessionTabs", () => {
    expect(migratePersistedTabs(undefined, [])).toEqual([]);
    expect(migratePersistedTabs(undefined, null)).toEqual([]);
    expect(migratePersistedTabs(null, undefined)).toEqual([]);
  });

  it("prefers a valid SessionTabsV1 over the legacy field, preserving mixed order", () => {
    const session: SessionTabsV1 = {
      version: 1,
      tabs: [
        { kind: "document", path: "/a.md" },
        { kind: "browser", url: "https://example.com/", title: "Example", scrollY: 42 },
        { kind: "document", path: null },
      ],
    };
    expect(migratePersistedTabs(session, ["/ignored.md"])).toEqual(session.tabs);
  });

  it("skips unknown-kind records but keeps the rest (forward/downgrade tolerance)", () => {
    const session = {
      version: 1,
      tabs: [
        { kind: "document", path: "/a.md" },
        { kind: "terminal", cwd: "/tmp" }, // a future kind this build doesn't know
        { kind: "browser", url: "https://example.com/", title: "Example" },
      ],
    };
    expect(migratePersistedTabs(session, [])).toEqual([
      { kind: "document", path: "/a.md" },
      { kind: "browser", url: "https://example.com/", title: "Example" },
    ]);
  });

  it("skips malformed records (bad types / missing required fields)", () => {
    const session = {
      version: 1,
      tabs: [
        { kind: "browser" }, // no url
        { kind: "browser", url: 42 }, // url not a string
        { kind: "document", path: 5 }, // path not a string|null
        { kind: "document", path: "/ok.md" },
        "just a string",
        null,
      ],
    };
    expect(migratePersistedTabs(session, [])).toEqual([
      { kind: "document", path: "/ok.md" },
    ]);
  });

  it("skips browser records when browser support is off (downgraded build)", () => {
    const session: SessionTabsV1 = {
      version: 1,
      tabs: [
        { kind: "document", path: "/a.md" },
        { kind: "browser", url: "https://example.com/", title: "Example" },
      ],
    };
    expect(migratePersistedTabs(session, [], { browserSupported: false })).toEqual([
      { kind: "document", path: "/a.md" },
    ]);
  });

  it("falls back to legacy paths when sessionTabs has an unknown future version", () => {
    const future = { version: 99, tabs: [{ kind: "document", path: "/new.md" }] };
    expect(migratePersistedTabs(future, ["/legacy.md"])).toEqual([
      { kind: "document", path: "/legacy.md" },
    ]);
  });

  it("ignores a structurally invalid sessionTabs and uses legacy", () => {
    expect(migratePersistedTabs({ version: 1, tabs: "nope" }, ["/a.md"])).toEqual([
      { kind: "document", path: "/a.md" },
    ]);
    expect(migratePersistedTabs(42, ["/a.md"])).toEqual([
      { kind: "document", path: "/a.md" },
    ]);
  });
});

describe("serializeSessionTabs", () => {
  it("serializes document and browser tabs to a versioned record", () => {
    const tabs: Tab[] = [
      { kind: "document", id: "t1", filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" },
      { kind: "document", id: "t2", filePath: null, title: "Untitled-1", isPinned: false, formatId: "markdown" },
      { kind: "browser", id: "b1", url: "https://example.com/", title: "Example", isPinned: false, scrollY: 12 },
    ];
    expect(serializeSessionTabs(tabs)).toEqual({
      version: 1,
      tabs: [
        { kind: "document", path: "/a.md" },
        { kind: "document", path: null },
        { kind: "browser", url: "https://example.com/", title: "Example", scrollY: 12 },
      ],
    });
  });

  it("omits scrollY when absent", () => {
    const tabs: Tab[] = [
      { kind: "browser", id: "b1", url: "https://x.test/", title: "x", isPinned: false },
    ];
    expect(serializeSessionTabs(tabs).tabs[0]).toEqual({
      kind: "browser",
      url: "https://x.test/",
      title: "x",
    });
  });

  it("round-trips through migratePersistedTabs", () => {
    const tabs: Tab[] = [
      { kind: "document", id: "t1", filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" },
      { kind: "browser", id: "b1", url: "https://example.com/", title: "Example", isPinned: false, scrollY: 7 },
    ];
    const persisted = serializeSessionTabs(tabs);
    expect(migratePersistedTabs(persisted, [])).toEqual(persisted.tabs);
  });
});

describe("documentPathsForRestore", () => {
  it("reads document paths from sessionTabs when present (browser records ignored)", () => {
    const config = {
      sessionTabs: {
        version: 1,
        tabs: [
          { kind: "document", path: "/a.md" },
          { kind: "browser", url: "https://example.com/", title: "Example" },
          { kind: "document", path: "/b.md" },
          { kind: "document", path: null }, // untitled — not restorable by path
        ],
      },
      lastOpenTabs: ["/ignored.md"],
    };
    expect(documentPathsForRestore(config)).toEqual(["/a.md", "/b.md"]);
  });

  it("falls back to legacy lastOpenTabs when sessionTabs is absent", () => {
    expect(documentPathsForRestore({ lastOpenTabs: ["/a.md", "/b.md"] })).toEqual([
      "/a.md",
      "/b.md",
    ]);
  });

  it("returns [] for an empty config", () => {
    expect(documentPathsForRestore({})).toEqual([]);
    expect(documentPathsForRestore({ lastOpenTabs: [] })).toEqual([]);
  });
});

describe("documentPathsOf", () => {
  it("extracts non-null document paths only (for the legacy lastOpenTabs field)", () => {
    const tabs: Tab[] = [
      { kind: "document", id: "t1", filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" },
      { kind: "document", id: "t2", filePath: null, title: "Untitled", isPinned: false, formatId: "markdown" },
      { kind: "browser", id: "b1", url: "https://example.com/", title: "Example", isPinned: false },
    ];
    expect(documentPathsOf(tabs)).toEqual(["/a.md"]);
  });
});
