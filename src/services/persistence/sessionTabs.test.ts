// WI-1.1 — versioned session-tab persistence + legacy migration + downgrade tolerance
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  migratePersistedTabs,
  serializeSessionTabs,
  documentPathsOf,
  documentPathsForRestore,
  type SessionTabsV1,
} from "./sessionTabs";
import type { Tab } from "@/stores/tabStoreTypes";

const { mockWorkspaceWarn } = vi.hoisted(() => ({ mockWorkspaceWarn: vi.fn() }));
vi.mock("@/utils/debug", () => ({ workspaceWarn: mockWorkspaceWarn }));

beforeEach(() => {
  mockWorkspaceWarn.mockClear();
});

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
    // A well-formed browser record this call intentionally drops is NOT a
    // malformed record — warning about it cries wolf on every workspace open.
    expect(mockWorkspaceWarn).not.toHaveBeenCalled();
  });

  it("warns only for genuinely unrecognized records", () => {
    migratePersistedTabs(
      { version: 1, tabs: [{ kind: "terminal" }, { kind: "document", path: "/a.md" }] },
      [],
    );
    expect(mockWorkspaceWarn).toHaveBeenCalledTimes(1);
  });

  it("skips document records with an empty path", () => {
    // documentPathsOf() already refuses empty paths; accepting one here would
    // send "" down the restore path and into a filesystem read.
    expect(
      migratePersistedTabs({ version: 1, tabs: [{ kind: "document", path: "" }] }, []),
    ).toEqual([]);
    expect(documentPathsForRestore({ lastOpenTabs: ["", "/a.md"] })).toEqual(["/a.md"]);
  });

  it("drops a non-finite or negative scrollY instead of persisting it", () => {
    const parsed = migratePersistedTabs(
      {
        version: 1,
        tabs: [
          { kind: "browser", url: "https://a.test/", title: "a", scrollY: -5 },
          { kind: "browser", url: "https://b.test/", title: "b", scrollY: Number.NaN },
          { kind: "browser", url: "https://c.test/", title: "c", scrollY: Number.POSITIVE_INFINITY },
          { kind: "browser", url: "https://d.test/", title: "d", scrollY: 0 },
        ],
      },
      [],
    );
    expect(parsed).toEqual([
      { kind: "browser", url: "https://a.test/", title: "a" },
      { kind: "browser", url: "https://b.test/", title: "b" },
      { kind: "browser", url: "https://c.test/", title: "c" },
      { kind: "browser", url: "https://d.test/", title: "d", scrollY: 0 },
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

  it("omits a non-finite or negative live scrollY", () => {
    const tabs: Tab[] = [
      { kind: "browser", id: "b1", url: "https://x.test/", title: "x", isPinned: false, scrollY: Number.NaN },
      { kind: "browser", id: "b2", url: "https://y.test/", title: "y", isPinned: false, scrollY: -1 },
    ];
    // JSON.stringify turns NaN/Infinity into null, so persisting them is a
    // silent corruption of the record.
    expect(serializeSessionTabs(tabs).tabs).toEqual([
      { kind: "browser", url: "https://x.test/", title: "x" },
      { kind: "browser", url: "https://y.test/", title: "y" },
    ]);
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
