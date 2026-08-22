// @vitest-environment node
//
// Direct tests for the disk actions. They were extracted from
// `useTabContextMenuActions` for the file-size gate and shipped with no tests
// of their own — the hook suite covers the WIRING (item → action → dismiss) and
// mocks `saveToPath`, so it could never see the delegation contract below.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveToPath: vi.fn(),
  reloadTabFromDisk: vi.fn(),
  ask: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/services/persistence/saveToPath", () => ({ saveToPath: mocks.saveToPath }));
vi.mock("@/services/persistence/reloadFromDisk", () => ({ reloadTabFromDisk: mocks.reloadTabFromDisk }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { success: mocks.success, error: mocks.error },
}));
// The REAL documentStore, not a double: it is app state, and
// `lint:mock-boundaries` refuses a test-side mock of it. Asserting the real
// `isMissing` transition is also a stronger claim than a spy on a setter.
import { useDocumentStore } from "@/stores/documentStore";
import { restoreTabToDisk, revertTabToSaved } from "./tabDiskActions";

const doc = { content: "hello" } as never;
const TAB = "t1";

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: {} } as never);
  useDocumentStore.getState().initDocument(TAB, "hello", "/a.md");
  useDocumentStore.getState().markMissing(TAB);
});

describe("restoreTabToDisk", () => {
  it("clears the missing flag and confirms on success", async () => {
    expect(useDocumentStore.getState().getDocument(TAB)?.isMissing).toBe(true);
    mocks.saveToPath.mockResolvedValueOnce(true);
    await restoreTabToDisk(TAB, "/a.md", doc);
    expect(useDocumentStore.getState().getDocument(TAB)?.isMissing).toBe(false);
    expect(mocks.success).toHaveBeenCalled();
  });

  it("stays SILENT on failure — saveToPath owns manual-failure feedback", async () => {
    // It toasts on all three of its manual paths (vanished parent directory
    // with its path, ownership conflict, system error text). A generic
    // "failed to restore" on top carried strictly less information than the
    // message already on screen.
    mocks.saveToPath.mockResolvedValueOnce(false);
    await restoreTabToDisk(TAB, "/a.md", doc);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    // Still missing: a failed restore must not clear the flag.
    expect(useDocumentStore.getState().getDocument(TAB)?.isMissing).toBe(true);
  });

  it("saves as MANUAL — the mode in which saveToPath reports its own failure", async () => {
    // The silence above is only correct in this mode: an auto-save stays quiet
    // by design, so delegating would lose the report entirely.
    mocks.saveToPath.mockResolvedValueOnce(true);
    await restoreTabToDisk(TAB, "/a.md", doc);
    expect(mocks.saveToPath).toHaveBeenCalledWith(TAB, "/a.md", "hello", "manual");
  });

  it.each([
    ["no path", null, doc],
    ["no document", "/a.md", undefined],
  ])("does nothing with %s", async (_l, path, d) => {
    await restoreTabToDisk("t1", path as string | null, d as never);
    expect(mocks.saveToPath).not.toHaveBeenCalled();
  });
});

describe("revertTabToSaved", () => {
  it("reloads after confirmation", async () => {
    mocks.ask.mockResolvedValueOnce(true);
    await revertTabToSaved("t1", "one.md", "/a.md", doc);
    expect(mocks.reloadTabFromDisk).toHaveBeenCalledWith("t1", "/a.md");
    expect(mocks.success).toHaveBeenCalled();
  });

  it("does not reload when the user declines", async () => {
    mocks.ask.mockResolvedValueOnce(false);
    await revertTabToSaved("t1", "one.md", "/a.md", doc);
    expect(mocks.reloadTabFromDisk).not.toHaveBeenCalled();
  });

  it("reports a reload failure — nothing else owns that message", async () => {
    mocks.ask.mockResolvedValueOnce(true);
    mocks.reloadTabFromDisk.mockRejectedValueOnce(new Error("disk gone"));
    await revertTabToSaved("t1", "one.md", "/a.md", doc);
    expect(mocks.error).toHaveBeenCalled();
  });

  it("never prompts without a path", async () => {
    await revertTabToSaved("t1", "one.md", null, doc);
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});
