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

import { useMcpCheckpointStore } from "../mcpCheckpointStore";
import {
  hydrateCheckpoints,
  appendCheckpoint,
  rewriteAll,
} from "../mcpCheckpointPersistence";

function reset() {
  useMcpCheckpointStore.setState({ checkpoints: [], hydrated: false });
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
    const list = useMcpCheckpointStore.getState().checkpoints;
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("cp-new");
    expect(list[1].id).toBe("cp-old");
    expect(useMcpCheckpointStore.getState().hydrated).toBe(true);
  });

  it("skips malformed lines without aborting hydrate", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue(
      `not-json\n${JSON.stringify(sampleCp)}\n{partial: \n`,
    );

    await hydrateCheckpoints();
    const list = useMcpCheckpointStore.getState().checkpoints;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(sampleCp.id);
  });

  it("treats missing file as empty history", async () => {
    fsMocks.exists.mockResolvedValue(false);
    await hydrateCheckpoints();
    expect(useMcpCheckpointStore.getState().checkpoints).toHaveLength(0);
    expect(useMcpCheckpointStore.getState().hydrated).toBe(true);
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

  it("appends a new line to the existing log", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue(
      `${JSON.stringify({ ...sampleCp, id: "cp-existing" })}\n`,
    );

    await appendCheckpoint(sampleCp);
    const wrote = fsMocks.writeTextFile.mock.calls[0]?.[1];
    expect(wrote).toContain("cp-existing");
    expect(wrote).toContain("cp-test01");
    expect(wrote.endsWith("\n")).toBe(true);
  });

  it("creates the file when the log does not yet exist", async () => {
    fsMocks.exists.mockResolvedValue(false);
    await appendCheckpoint(sampleCp);
    expect(fsMocks.writeTextFile).toHaveBeenCalled();
    const wrote = fsMocks.writeTextFile.mock.calls[0]?.[1];
    expect(wrote).toContain(sampleCp.id);
  });

  it("swallows fs errors so the MCP write path never blows up", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockRejectedValue(new Error("disk full"));
    await expect(appendCheckpoint(sampleCp)).resolves.toBeUndefined();
  });
});

describe("rewriteAll", () => {
  beforeEach(reset);

  it("writes the in-memory checkpoints out as JSONL newest-first", async () => {
    useMcpCheckpointStore.setState({
      checkpoints: [
        sampleCp,
        { ...sampleCp, id: "cp-second", timestamp: sampleCp.timestamp - 1 },
      ],
      hydrated: true,
    });
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
});
