/**
 * Tests for the batch "changed on disk" resolution helpers.
 *
 * @module hooks/fileChangeBatch.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  markMissing: vi.fn(),
  markDivergent: vi.fn(),
  updateLastDiskContent: vi.fn(),
  fileOpsError: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: mocks.readTextFile,
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      markMissing: mocks.markMissing,
      markDivergent: mocks.markDivergent,
      updateLastDiskContent: mocks.updateLastDiskContent,
    }),
  },
}));

vi.mock("@/utils/debug", () => ({
  fileOpsError: mocks.fileOpsError,
}));

import {
  reloadAllFromDisk,
  keepAllLocal,
  reviewEachIndividually,
} from "./fileChangeBatch";

const pending = [
  { tabId: "t1", filePath: "/a.md" },
  { tabId: "t2", filePath: "/b.md" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reloadAllFromDisk", () => {
  it("reloads every pending file in order", async () => {
    const reload = vi.fn(async () => {});
    await reloadAllFromDisk(pending, reload);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenNthCalledWith(1, "t1", "/a.md");
    expect(reload).toHaveBeenNthCalledWith(2, "t2", "/b.md");
    expect(mocks.markMissing).not.toHaveBeenCalled();
  });

  it("marks a tab missing when its reload throws, without aborting the rest", async () => {
    const reload = vi
      .fn()
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce(undefined);
    await reloadAllFromDisk(pending, reload);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(mocks.markMissing).toHaveBeenCalledExactlyOnceWith("t1");
    expect(mocks.fileOpsError).toHaveBeenCalledOnce();
  });
});

describe("keepAllLocal", () => {
  it("marks each tab divergent and adopts the current disk content", async () => {
    mocks.readTextFile.mockResolvedValue("disk");
    await keepAllLocal(pending);
    expect(mocks.markDivergent).toHaveBeenCalledTimes(2);
    expect(mocks.updateLastDiskContent).toHaveBeenNthCalledWith(1, "t1", "disk");
    expect(mocks.updateLastDiskContent).toHaveBeenNthCalledWith(2, "t2", "disk");
  });

  it("still marks divergent when the disk re-read fails, logging the error", async () => {
    mocks.readTextFile.mockRejectedValue(new Error("io"));
    await keepAllLocal([pending[0]]);
    expect(mocks.markDivergent).toHaveBeenCalledExactlyOnceWith("t1");
    expect(mocks.updateLastDiskContent).not.toHaveBeenCalled();
    expect(mocks.fileOpsError).toHaveBeenCalledOnce();
  });
});

describe("reviewEachIndividually", () => {
  it("prompts once per pending change, sequentially", async () => {
    const order: string[] = [];
    const handle = vi.fn(async (tabId: string) => {
      order.push(tabId);
    });
    await reviewEachIndividually(pending, handle);
    expect(order).toEqual(["t1", "t2"]);
  });
});
