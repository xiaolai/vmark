import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleRenameEvent,
  handleRemoveEvent,
  handleModifyOrCreateEvent,
  type FsChangeContext,
} from "./fsChangeHandlers";

function makeContext(over: Partial<FsChangeContext> = {}): FsChangeContext {
  return {
    readTextFile: vi.fn(async () => "disk content"),
    normalizePath: (p: string) => p,
    hasPendingSave: vi.fn(() => false),
    matchesPendingSave: vi.fn(() => false),
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

  it("marks missing when the file is truly gone", async () => {
    const ctx = makeContext({
      readTextFile: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });

    await handleRemoveEvent(ctx, "tab-1", "/file.md", "/file.md");

    expect(ctx.handleDeletion).toHaveBeenCalledWith("tab-1");
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
