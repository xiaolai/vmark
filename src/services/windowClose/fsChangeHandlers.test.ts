// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRenameEvent } from "./fsRenameHandlers";
import {
  handleRemoveEvent,
  handleModifyOrCreateEvent,
  handleSemanticBatch,
  type FsChangeContext,
} from "./fsChangeHandlers";
import { isBinaryMediaPath } from "@/services/navigation/openMediaFile";
import type { SemanticWorkspaceEvent } from "@/services/workspaceEvents";

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
    isMissing: vi.fn(() => false),
    clearMissing: vi.fn(),
    markBinaryFileChanged: vi.fn(),
    ...over,
  };
}

function evt(over: Partial<SemanticWorkspaceEvent> = {}): SemanticWorkspaceEvent {
  return { kind: "modified", path: "/ws/a.md", rootPath: "/ws", selfWrite: false, ...over };
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
      // "Truly gone" has to be in the FIXTURE, not just the title. It used to
      // sit at the default (`exists: true`) and still pass, because the code
      // took any read failure as proof of deletion and never asked.
      fileExists: vi.fn(async () => false),
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
      fileExists: vi.fn(async () => false),
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

// Audit findings #22 and #23 — one mechanism, two symptoms. The `try` around
// the disk read also enclosed the POLICY call, and its `catch` treated every
// failure as proof of deletion. So a rejecting reload policy and a transient
// EACCES both ended as "the file is gone", marking a document missing that was
// sitting on disk the whole time. The media path next to it already probes
// before concluding deletion; the text path did not.
// Audit findings #21 and #24 — one mechanism: rename handling treats the batch
// as a unit when each pair is independent.
describe("rename pairs are independent of each other", () => {
  it("runs the fallback for an unmatched pair even when another pair matched", async () => {
    // `handled` was batch-wide: one recognised rename returned early and every
    // OTHER path in the same batch was dropped, so an atomic replacement
    // arriving beside a real rename was silently lost.
    const ctx = makeContext({ readTextFile: vi.fn(async () => "edited") });
    const openPaths = new Map([
      ["/ws/old.md", "tab-renamed"],
      ["/ws/atomic.md", "tab-atomic"],
    ]);

    // The atomic pair is temp -> target: its OLD path belongs to no tab, which
    // is exactly what makes it "unmatched" and sends it to the fallback.
    await handleRenameEvent(
      ctx,
      ["/ws/old.md", "/ws/new.md", "/ws/.tmp-9f2a", "/ws/atomic.md"],
      openPaths,
    );

    expect(ctx.applyRename).toHaveBeenCalledWith("tab-renamed", "/ws/new.md");
    expect(ctx.handleModifyEvent).toHaveBeenCalledWith(
      "tab-atomic", "/ws/atomic.md", "edited",
    );
  });

  it("follows a chained old -> mid -> new rename across one batch", async () => {
    // Faithful to production: the real `applyRename` re-points the tab in the
    // STORE, and `getOpenPaths` reads the store. `handleSemanticBatch` took ONE
    // snapshot before dispatching every rename, so the second hop looked the
    // tab up under a name the snapshot still held and found nothing — the tab
    // stayed pointed at `/ws/b.md` while the file was at `/ws/c.md`.
    const store = new Map([["/ws/a.md", "tab-a"]]);
    const ctx = makeContext({
      applyRename: vi.fn((tabId: string, newPath: string) => {
        for (const [k, v] of [...store]) if (v === tabId) store.delete(k);
        store.set(newPath, tabId);
      }),
    });

    await handleSemanticBatch(
      ctx,
      [
        evt({ kind: "renamed", path: "/ws/b.md", previousPath: "/ws/a.md" }),
        evt({ kind: "renamed", path: "/ws/c.md", previousPath: "/ws/b.md" }),
      ],
      () => new Map(store),
    );

    expect(ctx.applyRename).toHaveBeenNthCalledWith(1, "tab-a", "/ws/b.md");
    expect(ctx.applyRename).toHaveBeenNthCalledWith(2, "tab-a", "/ws/c.md");
    expect(store.get("/ws/c.md")).toBe("tab-a");
  });
});

describe("read failures are not proof of deletion", () => {
  for (const [label, run] of [
    ["rename fallback", (ctx: FsChangeContext) =>
      handleRenameEvent(ctx, ["/ws/a.md"], new Map([["/ws/a.md", "tab-a"]]))],
    ["remove event", (ctx: FsChangeContext) =>
      handleRemoveEvent(ctx, "tab-a", "/ws/a.md", "/ws/a.md")],
  ] as const) {
    describe(label, () => {
      it("does not mark missing when the read fails but the file still exists", async () => {
        const ctx = makeContext({
          readTextFile: vi.fn(async () => { throw new Error("EACCES"); }),
          fileExists: vi.fn(async () => true),
        });
        await run(ctx);
        expect(ctx.handleDeletion).not.toHaveBeenCalled();
      });

      it("marks missing when the read fails AND the file is gone", async () => {
        const ctx = makeContext({
          readTextFile: vi.fn(async () => { throw new Error("ENOENT"); }),
          fileExists: vi.fn(async () => false),
        });
        await run(ctx);
        expect(ctx.handleDeletion).toHaveBeenCalledWith("tab-a");
      });

      it("does not mark missing when the existence probe itself is ambiguous", async () => {
        // Same conservatism the media branch already applies: an unreadable
        // probe is not evidence either way.
        const ctx = makeContext({
          readTextFile: vi.fn(async () => { throw new Error("EIO"); }),
          fileExists: vi.fn(async () => { throw new Error("EPERM"); }),
        });
        await run(ctx);
        expect(ctx.handleDeletion).not.toHaveBeenCalled();
      });

      it("does not convert a POLICY rejection into a deletion", async () => {
        // The reload policy failing says nothing about whether the file exists.
        const ctx = makeContext({
          readTextFile: vi.fn(async () => "text"),
          handleModifyEvent: vi.fn(async () => { throw new Error("policy exploded"); }),
        });
        await expect(run(ctx)).rejects.toThrow("policy exploded");
        expect(ctx.handleDeletion).not.toHaveBeenCalled();
      });
    });
  }
});

describe("handleSemanticBatch", () => {
  const openPaths = () => new Map<string, string>([["/ws/a.md", "tab-a"]]);

  it("ignores events for files that are not open", async () => {
    const ctx = makeContext({ readTextFile: vi.fn(async () => "x") });
    await handleSemanticBatch(ctx, [evt({ path: "/ws/not-open.md" })], openPaths);
    expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
  });

  it("routes a modified event on an open file to the modify handler", async () => {
    const ctx = makeContext({ readTextFile: vi.fn(async () => "edited") });
    await handleSemanticBatch(ctx, [evt({ path: "/ws/a.md", kind: "modified" })], openPaths);
    expect(ctx.handleModifyEvent).toHaveBeenCalledWith("tab-a", "/ws/a.md", "edited");
  });

  it("routes a deleted event to the remove handler", async () => {
    const ctx = makeContext({
      readTextFile: vi.fn(async () => {
        throw new Error("gone");
      }),
      fileExists: vi.fn(async () => false),
    });
    await handleSemanticBatch(ctx, [evt({ path: "/ws/a.md", kind: "deleted" })], openPaths);
    expect(ctx.handleDeletion).toHaveBeenCalledWith("tab-a");
  });

  it("reconstructs [old, new] pairs so a rename re-points the open tab", async () => {
    const ctx = makeContext();
    const map = new Map<string, string>([["/ws/old.md", "tab-a"]]);
    await handleSemanticBatch(
      ctx,
      [evt({ kind: "renamed", path: "/ws/new.md", previousPath: "/ws/old.md" })],
      () => map,
    );
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-a", "/ws/new.md");
  });

  it("clears missing on a media re-create without reading the binary", async () => {
    const readTextFile = vi.fn(async () => "x");
    const ctx = makeContext({
      readTextFile,
      isMedia: () => true,
      isMissing: () => true,
    });
    const map = new Map<string, string>([["/ws/pic.png", "tab-p"]]);
    await handleSemanticBatch(ctx, [evt({ path: "/ws/pic.png", kind: "created" })], () => map);
    expect(ctx.clearMissing).toHaveBeenCalledWith("tab-p");
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("announces a media modify so the viewer re-fetches the bytes (#1328)", async () => {
    // The regression: this branch used to `continue` on the reasoning that
    // "the asset URL already points at the fresh bytes". It does — but an
    // <img> whose src attribute never changes never refetches, so the viewer
    // kept showing the bytes it decoded when the tab opened.
    const readTextFile = vi.fn(async () => "x");
    const ctx = makeContext({ readTextFile, isMedia: () => true });
    const map = new Map<string, string>([["/ws/pic.png", "tab-p"]]);

    await handleSemanticBatch(ctx, [evt({ path: "/ws/pic.png", kind: "modified" })], () => map);

    expect(ctx.markBinaryFileChanged).toHaveBeenCalledWith("tab-p");
    // Still never reads the binary — it could be a multi-GB video.
    expect(readTextFile).not.toHaveBeenCalled();
    expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
  });

  it("announces a media re-create as well as clearing missing", async () => {
    // A file deleted and rewritten is new bytes just as much as an in-place
    // rewrite. Clearing `isMissing` alone re-renders the same stale URL.
    const ctx = makeContext({ isMedia: () => true, isMissing: () => true });
    const map = new Map<string, string>([["/ws/pic.png", "tab-p"]]);

    await handleSemanticBatch(ctx, [evt({ path: "/ws/pic.png", kind: "created" })], () => map);

    expect(ctx.clearMissing).toHaveBeenCalledWith("tab-p");
    expect(ctx.markBinaryFileChanged).toHaveBeenCalledWith("tab-p");
  });

  it("announces a media create even when the tab was never missing", async () => {
    // Watchers emit `created` for atomic replacements (write-temp-then-rename)
    // of a file that never disappeared, so the refresh must not be gated on
    // the missing flag the way `clearMissing` is.
    const ctx = makeContext({ isMedia: () => true, isMissing: () => false });
    const map = new Map<string, string>([["/ws/pic.png", "tab-p"]]);

    await handleSemanticBatch(ctx, [evt({ path: "/ws/pic.png", kind: "created" })], () => map);

    expect(ctx.clearMissing).not.toHaveBeenCalled();
    expect(ctx.markBinaryFileChanged).toHaveBeenCalledWith("tab-p");
  });

  it("does not announce a media change for our own pending save", async () => {
    const ctx = makeContext({ isMedia: () => true, hasPendingSave: () => true });
    const map = new Map<string, string>([["/ws/pic.png", "tab-p"]]);

    await handleSemanticBatch(ctx, [evt({ path: "/ws/pic.png", kind: "modified" })], () => map);

    expect(ctx.markBinaryFileChanged).not.toHaveBeenCalled();
  });

  it("still clears missing on a re-create during our own pending save", async () => {
    // The pending-save filter is about the REFRESH, and must not narrow the
    // pre-existing recovery: a file that is back is back whoever wrote it.
    const ctx = makeContext({
      isMedia: () => true,
      isMissing: () => true,
      hasPendingSave: () => true,
    });
    const map = new Map<string, string>([["/ws/pic.png", "tab-p"]]);

    await handleSemanticBatch(ctx, [evt({ path: "/ws/pic.png", kind: "created" })], () => map);

    expect(ctx.clearMissing).toHaveBeenCalledWith("tab-p");
    expect(ctx.markBinaryFileChanged).not.toHaveBeenCalled();
  });

  it("does not announce a media change for a file no tab has open", async () => {
    const ctx = makeContext({ isMedia: () => true });
    await handleSemanticBatch(
      ctx,
      [evt({ path: "/ws/other.png", kind: "modified" })],
      () => new Map<string, string>(),
    );
    expect(ctx.markBinaryFileChanged).not.toHaveBeenCalled();
  });

  it("leaves text documents on the text path", async () => {
    const ctx = makeContext({ readTextFile: vi.fn(async () => "edited") });
    const map = new Map<string, string>([["/ws/a.md", "tab-a"]]);
    await handleSemanticBatch(ctx, [evt({ path: "/ws/a.md", kind: "modified" })], () => map);
    expect(ctx.markBinaryFileChanged).not.toHaveBeenCalled();
    expect(ctx.handleModifyEvent).toHaveBeenCalledWith("tab-a", "/ws/a.md", "edited");
  });

  it("handles a mixed batch (rename + modify) in one pass", async () => {
    const ctx = makeContext({ readTextFile: vi.fn(async () => "edited") });
    const map = new Map<string, string>([
      ["/ws/a.md", "tab-a"],
      ["/ws/old.md", "tab-b"],
    ]);
    await handleSemanticBatch(
      ctx,
      [
        evt({ kind: "renamed", path: "/ws/new.md", previousPath: "/ws/old.md" }),
        evt({ kind: "modified", path: "/ws/a.md" }),
      ],
      () => map,
    );
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-b", "/ws/new.md");
    expect(ctx.handleModifyEvent).toHaveBeenCalledWith("tab-a", "/ws/a.md", "edited");
  });

  // Audit finding #1 (2026-08-25). An atomic replacement — write temp, rename
  // over the target — reaches an open media tab through the RENAME fallback,
  // not the modify branch. That path existence-probed the file and returned,
  // so the viewer kept rendering the bytes it had already decoded: the exact
  // #1328 defect, still live on a second path after the modify branch was
  // fixed. Editors and image tools use atomic replacement by default, so this
  // is the COMMON way a picture changes, not an exotic one.
  it("announces a media change when an atomic rename replaces the file", async () => {
    const ctx = makeContext({ isMedia: () => true, fileExists: vi.fn(async () => true) });
    const map = new Map<string, string>([["/ws/pic.png", "tab-p"]]);

    await handleRenameEvent(ctx, ["/ws/pic.png"], map);

    expect(ctx.markBinaryFileChanged).toHaveBeenCalledWith("tab-p");
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("marks a renamed-away media file missing instead of announcing a change", async () => {
    const ctx = makeContext({ isMedia: () => true, fileExists: vi.fn(async () => false) });
    const map = new Map<string, string>([["/ws/pic.png", "tab-p"]]);

    await handleRenameEvent(ctx, ["/ws/pic.png"], map);

    expect(ctx.handleDeletion).toHaveBeenCalledWith("tab-p");
    expect(ctx.markBinaryFileChanged).not.toHaveBeenCalled();
  });

  it("announces nothing when the media existence probe is ambiguous", async () => {
    // An unreadable probe is not evidence either way. Announcing a change would
    // make the viewer re-fetch a file we cannot confirm exists.
    const ctx = makeContext({
      isMedia: () => true,
      fileExists: vi.fn(async () => { throw new Error("EPERM"); }),
    });
    const map = new Map<string, string>([["/ws/pic.png", "tab-p"]]);

    await handleRenameEvent(ctx, ["/ws/pic.png"], map);

    expect(ctx.handleDeletion).not.toHaveBeenCalled();
    expect(ctx.markBinaryFileChanged).not.toHaveBeenCalled();
  });

  it("does not mis-pair a paired rename that follows an unpaired one", async () => {
    const ctx = makeContext({ readTextFile: vi.fn(async () => "x") });
    const map = new Map<string, string>([["/ws/old.md", "tab-r"]]);
    await handleSemanticBatch(
      ctx,
      [
        evt({ kind: "renamed", path: "/ws/atomic.md" }), // unpaired first
        evt({ kind: "renamed", path: "/ws/new.md", previousPath: "/ws/old.md" }), // real pair
      ],
      () => map,
    );
    // The real pair must re-point tab-r — never positionally paired with the unpaired path.
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-r", "/ws/new.md");
    expect(ctx.applyRename).toHaveBeenCalledTimes(1);
  });
});
