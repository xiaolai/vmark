// @vitest-environment node
/**
 * The stale-document defect, and the three branches around it.
 *
 * `handleDirtyChange` captured `doc` before `message()`, then awaited that
 * dialog AND a Save As dialog, then wrote the captured `doc.content`. Both
 * dialogs are open for as long as the user leaves them open, and the editor
 * stays live behind them — so every keystroke typed while deciding was
 * silently absent from the file that got written.
 *
 * @coordinates-with services/persistence/resolveDirtyFileChange.ts
 * @module services/persistence/resolveDirtyFileChange.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockMessage,
  mockSave,
  mockReadTextFile,
  mockSaveToPath,
  mockReloadTabFromDisk,
  mockDispatchEditor,
} = vi.hoisted(() => ({
  mockMessage: vi.fn(),
  mockSave: vi.fn(),
  mockReadTextFile: vi.fn(),
  mockSaveToPath: vi.fn(),
  mockReloadTabFromDisk: vi.fn(),
  mockDispatchEditor: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: (...a: unknown[]) => mockMessage(...a),
  save: (...a: unknown[]) => mockSave(...a),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...a: unknown[]) => mockReadTextFile(...a),
}));
vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPath: (...a: unknown[]) => mockSaveToPath(...a),
}));
vi.mock("@/services/persistence/reloadFromDisk", () => ({
  reloadTabFromDisk: (...a: unknown[]) => mockReloadTabFromDisk(...a),
}));
vi.mock("@/lib/formats/registry", () => ({
  dispatchEditor: (...a: unknown[]) => mockDispatchEditor(...a),
  getFormatById: vi.fn(() => undefined),
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { useDocumentStore } from "@/stores/documentStore";
import { resolveDirtyFileChange } from "./resolveDirtyFileChange";

const TAB = "tab-dirty";
const PATH = "/w/doc.md";
const doc = () => useDocumentStore.getState().documents[TAB];

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(TAB, "on disk\n", PATH, { savedContent: "on disk\n" });
  mockReadTextFile.mockResolvedValue("on disk\n");
  mockSaveToPath.mockResolvedValue(true);
  mockReloadTabFromDisk.mockResolvedValue(undefined);
  mockDispatchEditor.mockReturnValue({
    id: "markdown",
    adapters: {
      saveDialogFilters: [{ nameI18nKey: "format.markdown", extensions: ["md"] }],
    },
  });
});

describe("Save As — the stale-document defect", () => {
  it("writes edits made WHILE the change dialog was open", async () => {
    // The user is typing behind the modal. The old code had already captured
    // `doc` and wrote the pre-dialog buffer, losing everything since.
    mockMessage.mockImplementation(async () => {
      useDocumentStore.getState().setEditorContent(TAB, "typed during dialog\n");
      return "Yes";
    });
    mockSave.mockResolvedValue("/w/copy.md");

    await resolveDirtyFileChange(TAB, PATH);

    expect(mockSaveToPath).toHaveBeenCalledWith(
      TAB,
      "/w/copy.md",
      "typed during dialog\n",
      "manual"
    );
  });

  it("writes edits made while the SAVE AS dialog was open too", async () => {
    // Two awaits, two windows to lose edits in. The second is the longer one.
    mockMessage.mockResolvedValue("Yes");
    mockSave.mockImplementation(async () => {
      useDocumentStore.getState().setEditorContent(TAB, "typed during save-as\n");
      return "/w/copy.md";
    });

    await resolveDirtyFileChange(TAB, PATH);

    expect(mockSaveToPath).toHaveBeenCalledWith(
      TAB,
      "/w/copy.md",
      "typed during save-as\n",
      "manual"
    );
  });

  it("writes nothing when the tab closed while the dialogs were open", async () => {
    mockMessage.mockResolvedValue("Yes");
    mockSave.mockImplementation(async () => {
      useDocumentStore.setState({ documents: {} }); // tab closed
      return "/w/copy.md";
    });

    await resolveDirtyFileChange(TAB, PATH);

    expect(mockSaveToPath).not.toHaveBeenCalled();
  });

  it("does not reload when Save As is cancelled — local edits survive", async () => {
    mockMessage.mockResolvedValue("Yes");
    mockSave.mockResolvedValue(null);

    await resolveDirtyFileChange(TAB, PATH);

    expect(mockSaveToPath).not.toHaveBeenCalled();
    expect(mockReloadTabFromDisk).not.toHaveBeenCalled();
  });

  it("clears the missing flag after a successful Save As", async () => {
    mockMessage.mockResolvedValue("Yes");
    mockSave.mockResolvedValue("/w/copy.md");
    useDocumentStore.getState().markMissing(TAB);

    await resolveDirtyFileChange(TAB, PATH);

    expect(doc()?.isMissing).toBe(false);
  });

  it("leaves the missing flag alone when the save itself failed", async () => {
    mockMessage.mockResolvedValue("Yes");
    mockSave.mockResolvedValue("/w/copy.md");
    mockSaveToPath.mockResolvedValue(false);
    useDocumentStore.getState().markMissing(TAB);

    await resolveDirtyFileChange(TAB, PATH);

    expect(doc()?.isMissing).toBe(true);
  });

  it("uses the format registry's localized filters, not a hardcoded name", async () => {
    mockMessage.mockResolvedValue("Yes");
    mockSave.mockResolvedValue(null);

    await resolveDirtyFileChange(TAB, PATH);

    const filters = mockSave.mock.calls[0][0].filters;
    expect(filters[0].extensions).toEqual(["md"]);
    expect(filters[0].name).not.toBe("Markdown"); // resolved through i18n, not literal
  });

  it("falls back to the markdown filter when the registry is not bootstrapped", async () => {
    mockDispatchEditor.mockImplementation(() => {
      throw new Error("registry not bootstrapped");
    });
    mockMessage.mockResolvedValue("Yes");
    mockSave.mockResolvedValue(null);

    await resolveDirtyFileChange(TAB, PATH);

    expect(mockSave.mock.calls[0][0].filters[0].extensions).toContain("md");
  });
});

describe("Reload", () => {
  it("delegates to reloadTabFromDisk", async () => {
    mockMessage.mockResolvedValue("No");
    await resolveDirtyFileChange(TAB, PATH);
    expect(mockReloadTabFromDisk).toHaveBeenCalledWith(TAB, PATH);
  });

  it("marks the document missing when the reload throws", async () => {
    mockMessage.mockResolvedValue("No");
    mockReloadTabFromDisk.mockRejectedValue(new Error("ENOENT"));

    await resolveDirtyFileChange(TAB, PATH);

    expect(doc()?.isMissing).toBe(true);
  });

  it("accepts the localized button label as well as 'No'", async () => {
    mockMessage.mockResolvedValue("dialog:fileChanged.buttonReload");
    await resolveDirtyFileChange(TAB, PATH);
    expect(mockReloadTabFromDisk).toHaveBeenCalled();
  });
});

describe("Keep my changes (the safe default)", () => {
  it("marks divergent and adopts current disk bytes as the new baseline", async () => {
    mockMessage.mockResolvedValue("Cancel");
    mockReadTextFile.mockResolvedValue("rewritten by sync\r\n");

    await resolveDirtyFileChange(TAB, PATH);

    expect(doc()?.isDivergent).toBe(true);
    expect(doc()?.lastDiskContent).toBe("rewritten by sync\r\n");
    // Adopting the snapshot adopts its convention too (WI-1.6).
    expect(doc()?.lineEnding).toBe("crlf");
  });

  it("still marks divergent when the disk read fails", async () => {
    mockMessage.mockResolvedValue("Cancel");
    mockReadTextFile.mockRejectedValue(new Error("EACCES"));

    await resolveDirtyFileChange(TAB, PATH);

    expect(doc()?.isDivergent).toBe(true);
  });

  it("does not write to a tab closed while the disk read was in flight", async () => {
    mockMessage.mockResolvedValue("Cancel");
    mockReadTextFile.mockImplementation(async () => {
      useDocumentStore.setState({ documents: {} });
      return "late\n";
    });

    await resolveDirtyFileChange(TAB, PATH);

    expect(useDocumentStore.getState().documents[TAB]).toBeUndefined();
  });

  it("an unrecognised dialog result is treated as Keep, never as Reload", async () => {
    mockMessage.mockResolvedValue("some-unexpected-string");

    await resolveDirtyFileChange(TAB, PATH);

    expect(mockReloadTabFromDisk).not.toHaveBeenCalled();
    expect(doc()?.isDivergent).toBe(true);
  });
});
