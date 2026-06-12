// MCP checkpoint persistence — JSONL hydrate / append / rewrite.

import { describe, it, expect, beforeEach, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(async () => false),
  readTextFile: vi.fn(async () => ""),
  writeTextFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "/app/data"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

vi.mock("@tauri-apps/plugin-fs", () => fsMocks);

import { useMcpStore } from "../mcpStore";
import {
  hydrateCheckpoints,
  appendCheckpoint,
  rewriteAll,
  clearCheckpointsOnDisk,
} from "../mcpCheckpointPersistence";

function reset() {
  useMcpStore.setState((s) => ({ checkpoint: { ...s.checkpoint, checkpoints: [], hydrated: false } }));
  fsMocks.exists.mockReset();
  fsMocks.readTextFile.mockReset();
  fsMocks.writeTextFile.mockReset();
  fsMocks.mkdir.mockReset();
  fsMocks.exists.mockResolvedValue(false);
  fsMocks.readTextFile.mockResolvedValue("");
  fsMocks.writeTextFile.mockResolvedValue(undefined);
  fsMocks.mkdir.mockResolvedValue(undefined);
}

const sampleCp = {
  id: "cp-test01",
  tabId: "tab-1",
  filePath: "/notes.md",
  timestamp: 1700000000000,
  tool: "document.write" as const,
  description: "test write",
  contentBefore: "before",
  revisionBefore: "rev-A",
  revisionAfter: "rev-B",
  byteSize: 6,
};

describe("hydrateCheckpoints", () => {
  beforeEach(reset);

  it("loads valid JSONL into the store newest-first", async () => {
    const older = { ...sampleCp, id: "cp-old", timestamp: 1700000000 };
    const newer = { ...sampleCp, id: "cp-new", timestamp: 1700000999 };
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue(
      `${JSON.stringify(older)}\n${JSON.stringify(newer)}\n`,
    );

    await hydrateCheckpoints();
    const list = useMcpStore.getState().checkpoint.checkpoints;
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("cp-new");
    expect(list[1].id).toBe("cp-old");
    expect(useMcpStore.getState().checkpoint.hydrated).toBe(true);
  });

  it("skips malformed lines without aborting hydrate", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue(
      `not-json\n${JSON.stringify(sampleCp)}\n{partial: \n`,
    );

    await hydrateCheckpoints();
    const list = useMcpStore.getState().checkpoint.checkpoints;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(sampleCp.id);
  });

  it("treats missing file as empty history", async () => {
    fsMocks.exists.mockResolvedValue(false);
    await hydrateCheckpoints();
    expect(useMcpStore.getState().checkpoint.checkpoints).toHaveLength(0);
    expect(useMcpStore.getState().checkpoint.hydrated).toBe(true);
  });

  it("dedupes duplicate ids, newest line wins", async () => {
    const stale = { ...sampleCp, description: "stale copy" };
    const fresh = { ...sampleCp, description: "fresh copy" };
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue(
      `${JSON.stringify(stale)}\n${JSON.stringify(fresh)}\n`,
    );

    await hydrateCheckpoints();
    const list = useMcpStore.getState().checkpoint.checkpoints;
    expect(list).toHaveLength(1);
    expect(list[0].description).toBe("fresh copy");
  });

  it("noops when called twice (already hydrated)", async () => {
    fsMocks.exists.mockResolvedValue(false);
    await hydrateCheckpoints();
    fsMocks.readTextFile.mockClear();
    await hydrateCheckpoints();
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
  });
});

describe("appendCheckpoint", () => {
  beforeEach(reset);

  it("performs a true append — one write, no read-modify-write (audit H5)", async () => {
    fsMocks.exists.mockResolvedValue(true);
    await appendCheckpoint(sampleCp);
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
    expect(fsMocks.writeTextFile).toHaveBeenCalledTimes(1);
    const [, wrote, options] = fsMocks.writeTextFile.mock.calls[0];
    expect(wrote).toBe(`${JSON.stringify(sampleCp)}\n`);
    expect(options).toEqual({ append: true });
  });

  it("creates the file when the log does not yet exist (append creates)", async () => {
    fsMocks.exists.mockResolvedValue(false);
    await appendCheckpoint(sampleCp);
    expect(fsMocks.writeTextFile).toHaveBeenCalled();
    const wrote = fsMocks.writeTextFile.mock.calls[0]?.[1];
    expect(wrote).toContain(sampleCp.id);
  });

  it("swallows fs errors so the MCP write path never blows up", async () => {
    fsMocks.writeTextFile.mockRejectedValue(new Error("disk full"));
    await expect(appendCheckpoint(sampleCp)).resolves.toBeUndefined();
  });

  it("two concurrent appends both land on disk (audit H5 race)", async () => {
    let file = "";
    fsMocks.writeTextFile.mockImplementation(
      async (_path: string, text: string, options?: { append?: boolean }) => {
        // Simulate async fs latency before the write commits.
        await new Promise((r) => setTimeout(r, 5));
        file = options?.append ? file + text : text;
      },
    );

    const first = appendCheckpoint({ ...sampleCp, id: "cp-a" });
    const second = appendCheckpoint({ ...sampleCp, id: "cp-b" });
    await Promise.all([first, second]);

    const lines = file.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("cp-a");
    expect(lines[1]).toContain("cp-b");
  });

  it("rewriteAll queues behind an in-flight append (writers serialized)", async () => {
    const order: string[] = [];
    fsMocks.writeTextFile.mockImplementation(
      async (_path: string, _text: string, options?: { append?: boolean }) => {
        const kind = options?.append ? "append" : "rewrite";
        order.push(`start:${kind}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end:${kind}`);
      },
    );

    const append = appendCheckpoint(sampleCp);
    const rewrite = rewriteAll();
    await Promise.all([append, rewrite]);

    expect(order).toEqual([
      "start:append",
      "end:append",
      "start:rewrite",
      "end:rewrite",
    ]);
  });

  it("a failed append does not block subsequent writes", async () => {
    fsMocks.writeTextFile.mockRejectedValueOnce(new Error("disk full"));
    await appendCheckpoint({ ...sampleCp, id: "cp-fail" });
    await appendCheckpoint({ ...sampleCp, id: "cp-ok" });
    expect(fsMocks.writeTextFile).toHaveBeenCalledTimes(2);
  });
});

describe("rewriteAll", () => {
  beforeEach(reset);

  it("writes the in-memory checkpoints out as JSONL newest-first", async () => {
    useMcpStore.setState((s) => ({
      checkpoint: {
        ...s.checkpoint,
        checkpoints: [
          sampleCp,
          { ...sampleCp, id: "cp-second", timestamp: sampleCp.timestamp - 1 },
        ],
        hydrated: true,
      },
    }));
    await rewriteAll();
    const wrote = fsMocks.writeTextFile.mock.calls.at(-1)?.[1];
    expect(wrote).toContain("cp-test01");
    expect(wrote).toContain("cp-second");
    expect(wrote.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("writes empty string when the store has no checkpoints", async () => {
    await rewriteAll();
    const wrote = fsMocks.writeTextFile.mock.calls.at(-1)?.[1];
    expect(wrote).toBe("");
  });

  it("preserves on-disk checkpoints another window appended (multi-window union)", async () => {
    // This window's memory has only cp-mine; the file already holds
    // cp-other appended by a different window. Compaction must keep both.
    useMcpStore.setState((s) => ({
      checkpoint: {
        ...s.checkpoint,
        checkpoints: [{ ...sampleCp, id: "cp-mine" }],
        hydrated: true,
      },
    }));
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue(
      `${JSON.stringify({ ...sampleCp, id: "cp-other", tabId: "tab-2" })}\n`,
    );
    await rewriteAll();
    const wrote = fsMocks.writeTextFile.mock.calls.at(-1)?.[1] as string;
    expect(wrote).toContain("cp-mine");
    expect(wrote).toContain("cp-other");
  });
});

describe("clearCheckpointsOnDisk (multi-window safe)", () => {
  beforeEach(reset);

  it("removes only checkpoints matching the filePath filter, keeping the rest", async () => {
    fsMocks.exists.mockResolvedValue(true);
    const mine = { ...sampleCp, id: "cp-mine", filePath: "/notes.md" };
    const other = { ...sampleCp, id: "cp-other", filePath: "/other.md" };
    fsMocks.readTextFile.mockResolvedValue(
      `${JSON.stringify(mine)}\n${JSON.stringify(other)}\n`,
    );
    await clearCheckpointsOnDisk({ filePath: "/notes.md" });
    const wrote = fsMocks.writeTextFile.mock.calls.at(-1)?.[1] as string;
    expect(wrote).not.toContain("cp-mine");
    expect(wrote).toContain("cp-other");
  });

  it("removes only checkpoints matching the tabId filter", async () => {
    fsMocks.exists.mockResolvedValue(true);
    const a = { ...sampleCp, id: "cp-a", tabId: "tab-1" };
    const b = { ...sampleCp, id: "cp-b", tabId: "tab-2" };
    fsMocks.readTextFile.mockResolvedValue(
      `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`,
    );
    await clearCheckpointsOnDisk({ tabId: "tab-2" });
    const wrote = fsMocks.writeTextFile.mock.calls.at(-1)?.[1] as string;
    expect(wrote).toContain("cp-a");
    expect(wrote).not.toContain("cp-b");
  });

  it("is a no-op when the file does not exist", async () => {
    fsMocks.exists.mockResolvedValue(false);
    await clearCheckpointsOnDisk({ tabId: "tab-1" });
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("drops malformed lines while clearing", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue(
      `garbage\n${JSON.stringify({ ...sampleCp, id: "cp-keep", tabId: "tab-9" })}\n`,
    );
    await clearCheckpointsOnDisk({ tabId: "tab-1" });
    const wrote = fsMocks.writeTextFile.mock.calls.at(-1)?.[1] as string;
    expect(wrote).toContain("cp-keep");
    expect(wrote).not.toContain("garbage");
  });

  it("swallows fs errors", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockRejectedValue(new Error("disk error"));
    await expect(clearCheckpointsOnDisk({ tabId: "tab-1" })).resolves.toBeUndefined();
  });
});
