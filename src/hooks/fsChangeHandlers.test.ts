import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleRenameEvent,
  handleRemoveEvent,
  handleModifyOrCreateEvent,
  type FsChangeContext,
} from "./fsChangeHandlers";
import { isBinaryMediaPath } from "./openMediaFile";

function makeContext(over: Partial<FsChangeContext> = {}): FsChangeContext {
  return {
    readTextFile: vi.fn(async () => "disk content"),
    fileExists: vi.fn(async () => true),
    normalizePath: (p: string) => p,
    hasPendingSave: vi.fn(() => false),
    matchesPendingSave: vi.fn(() => false),
    isMedia: vi.fn(() => false),
    applyRename: vi.fn(),
    handleModifyEvent: vi.fn(async () => {}),
    handleDeletion: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleRenameEvent", () => {
  it("re-points a tab when an old→new pair maps to an open file", async () => {
    const ctx = makeContext();
    const openPaths = new Map([["/old.md", "tab-1"]]);

    await handleRenameEvent(ctx, ["/old.md", "/new.md"], openPaths);

    expect(ctx.applyRename).toHaveBeenCalledWith("tab-1", "/new.md");
    // When a pair is handled, the fallback read path must not run.
    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("ignores rename pairs whose old path is not open", async () => {
    const ctx = makeContext();
    const openPaths = new Map([["/other.md", "tab-x"]]);

    await handleRenameEvent(ctx, ["/old.md", "/new.md"], openPaths);

    expect(ctx.applyRename).not.toHaveBeenCalled();
  });

  it("falls back to modify when no pair matched but the target still exists", async () => {
    const ctx = makeContext({ readTextFile: vi.fn(async () => "still here") });
    // Single (odd) path so the pair loop never runs → fallback.
    const openPaths = new Map([["/file.md", "tab-1"]]);

    await handleRenameEvent(ctx, ["/file.md"], openPaths);

    expect(ctx.handleModifyEvent).toHaveBeenCalledWith("tab-1", "/file.md", "still here");
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("marks missing in the fallback when the file is truly gone", async () => {
    const ctx = makeContext({
      readTextFile: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });
    const openPaths = new Map([["/file.md", "tab-1"]]);

    await handleRenameEvent(ctx, ["/file.md"], openPaths);

    expect(ctx.handleDeletion).toHaveBeenCalledWith("tab-1");
  });

  it("skips our own pending save in the fallback (atomic write)", async () => {
    const ctx = makeContext({ hasPendingSave: vi.fn(() => true) });
    const openPaths = new Map([["/file.md", "tab-1"]]);

    await handleRenameEvent(ctx, ["/file.md"], openPaths);

    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  // F2 — rename fallback must be media-aware: binary media never gets a
  // UTF-8 read; existence is probed instead (mirrors handleRemoveEvent).
  it("media: fallback existence-probes and never reads a media file as text", async () => {
    const ctx = makeContext({
      isMedia: vi.fn(() => true),
      fileExists: vi.fn(async () => true),
    });
    const openPaths = new Map([["/photo.png", "tab-1"]]);

    await handleRenameEvent(ctx, ["/photo.png"], openPaths);

    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.fileExists).toHaveBeenCalledWith("/photo.png");
    expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("media: fallback marks missing when the file is truly gone (no text read)", async () => {
    const ctx = makeContext({
      isMedia: vi.fn(() => true),
      fileExists: vi.fn(async () => false),
    });
    const openPaths = new Map([["/photo.png", "tab-1"]]);

    await handleRenameEvent(ctx, ["/photo.png"], openPaths);

    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).toHaveBeenCalledWith("tab-1");
  });

  it("media: an ambiguous probe error does not throw and does not mark missing", async () => {
    const ctx = makeContext({
      isMedia: vi.fn(() => true),
      fileExists: vi.fn(async () => {
        throw new Error("EACCES");
      }),
    });
    const openPaths = new Map([["/photo.png", "tab-1"]]);

    await expect(
      handleRenameEvent(ctx, ["/photo.png"], openPaths),
    ).resolves.toBeUndefined();
    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  // Round-2: the media gate must be EXTENSION-based (isBinaryMediaPath), not
  // the tab's formatId — a .png with a user .png→txt association still must not
  // be UTF-8-read. Wire the real predicate to prove it end-to-end.
  it("media gate is extension-based: a .png rename probes existence, a .md reads text", async () => {
    const png = makeContext({ isMedia: isBinaryMediaPath, fileExists: vi.fn(async () => true) });
    await handleRenameEvent(png, ["/x/photo.png"], new Map([["/x/photo.png", "t1"]]));
    expect(png.readTextFile).not.toHaveBeenCalled();
    expect(png.fileExists).toHaveBeenCalledWith("/x/photo.png");

    const md = makeContext({ isMedia: isBinaryMediaPath, readTextFile: vi.fn(async () => "text") });
    await handleRenameEvent(md, ["/x/notes.md"], new Map([["/x/notes.md", "t2"]]));
    expect(md.readTextFile).toHaveBeenCalledWith("/x/notes.md");
    expect(md.fileExists).not.toHaveBeenCalled();
  });
});

describe("handleRemoveEvent", () => {
  it("skips our own pending save without touching the document", async () => {
    const ctx = makeContext({ hasPendingSave: vi.fn(() => true) });

    await handleRemoveEvent(ctx, "tab-1", "/file.md", "/file.md");

    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("treats a still-readable file as a spurious remove → modify", async () => {
    const ctx = makeContext({ readTextFile: vi.fn(async () => "exists") });

    await handleRemoveEvent(ctx, "tab-1", "/file.md", "/file.md");

    expect(ctx.handleModifyEvent).toHaveBeenCalledWith("tab-1", "/file.md", "exists");
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("ignores a remove whose disk content matches our pending save", async () => {
    const ctx = makeContext({
      readTextFile: vi.fn(async () => "our write"),
      matchesPendingSave: vi.fn(() => true),
    });

    await handleRemoveEvent(ctx, "tab-1", "/file.md", "/file.md");

    expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("media: existing file → no read, no modify (binary must not load)", async () => {
    const ctx = makeContext({ fileExists: vi.fn(async () => true) });

    await handleRemoveEvent(ctx, "tab-1", "/photo.png", "/photo.png", true);

    // Never read a (possibly huge) binary as text; existence-probe only.
    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.fileExists).toHaveBeenCalledWith("/photo.png");
    expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("media: truly gone → marks missing, still no text read", async () => {
    const ctx = makeContext({ fileExists: vi.fn(async () => false) });

    await handleRemoveEvent(ctx, "tab-1", "/photo.png", "/photo.png", true);

    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).toHaveBeenCalledWith("tab-1");
  });

  it("marks missing when the file is truly gone", async () => {
    const ctx = makeContext({
      readTextFile: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });

    await handleRemoveEvent(ctx, "tab-1", "/file.md", "/file.md");

    expect(ctx.handleDeletion).toHaveBeenCalledWith("tab-1");
  });

  // F4 — a rejecting existence probe (permission/IO) must not escape the
  // handler and must not conservatively mark the tab missing.
  it("media: a fileExists rejection does not throw out of the handler or mark missing", async () => {
    const ctx = makeContext({
      fileExists: vi.fn(async () => {
        throw new Error("EACCES");
      }),
    });

    await expect(
      handleRemoveEvent(ctx, "tab-1", "/photo.png", "/photo.png", true),
    ).resolves.toBeUndefined();

    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });
});

describe("handleModifyOrCreateEvent", () => {
  it("skips unreadable files (deleted/locked mid-read)", async () => {
    const ctx = makeContext({
      readTextFile: vi.fn(async () => {
        throw new Error("EACCES");
      }),
    });

    await handleModifyOrCreateEvent(ctx, "tab-1", "/file.md");

    expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
  });

  it("filters out our own pending saves", async () => {
    const ctx = makeContext({
      readTextFile: vi.fn(async () => "our write"),
      matchesPendingSave: vi.fn(() => true),
    });

    await handleModifyOrCreateEvent(ctx, "tab-1", "/file.md");

    expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
  });

  it("applies modify policy for a genuine external change", async () => {
    const ctx = makeContext({ readTextFile: vi.fn(async () => "external edit") });

    await handleModifyOrCreateEvent(ctx, "tab-1", "/file.md");

    expect(ctx.handleModifyEvent).toHaveBeenCalledWith("tab-1", "/file.md", "external edit");
  });
});
