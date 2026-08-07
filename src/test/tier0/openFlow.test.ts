// @vitest-environment node
// WI-17 — Tier-0 OPEN flow over the REAL composition: the Cmd+O entry point
// (services/navigation/fileOpen handleOpen) through the size router, the real
// tabStore.createTab, the real disk-open ingest, against the stateful fs fake.
// The assertion is that store state EQUALS the parsed fixture — line endings,
// BOM and CJK included — not that a reader was called.
// Ledger context: D6 (.claude/tdd-guardian/decisions-20260803.md).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { handleOpen, openFileInNewTab } from "@/services/navigation/fileOpen";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { statefulFs } from "@/test/statefulFsFake";
import { WINDOW, ROOT, resetTier0, doc } from "./harness";

const LF_DOC = `${ROOT}/lf.md`;
const CRLF_DOC = `${ROOT}/crlf.md`;
const BOM_DOC = `${ROOT}/bom.md`;

/** CJK body, LF: the canonical editor domain is exactly these bytes. */
const LF_BODY = "# 标题\n\n第一段落，包含中文。\n";
/** Same document, CRLF on disk: the editor buffer must be canonical LF. */
const CRLF_BODY = "# 标题\r\n\r\n第一段落，包含中文。\r\n";

function tabIdFor(path: string): string {
  const tab = useTabStore.getState().getTabsByWindow(WINDOW).find((t) => t.filePath === path);
  if (!tab) throw new Error(`no tab for ${path}`);
  return tab.id;
}

beforeEach(() => {
  resetTier0();
  vi.mocked(openDialog).mockReset();
});

describe("Tier-0 open flow (case 2)", () => {
  it("opens the file the dialog returned and the document state equals the fixture", async () => {
    statefulFs.seed(LF_DOC, LF_BODY);
    vi.mocked(openDialog).mockResolvedValue(LF_DOC);

    await handleOpen(WINDOW);

    const tabId = tabIdFor(LF_DOC);
    const record = doc(tabId);
    expect(record.content).toBe(LF_BODY);
    expect(record.savedContent).toBe(LF_BODY);
    expect(record.lastDiskContent).toBe(LF_BODY);
    expect(record.filePath).toBe(LF_DOC);
    expect(record.isDirty).toBe(false);
    expect(record.lineEnding).toBe("lf");
    expect(useTabStore.getState().activeTabId[WINDOW]).toBe(tabId);
    expect(useRecentFilesStore.getState().files.map((f) => f.path)).toContain(LF_DOC);
  });

  it("a CRLF fixture canonicalises to LF in the buffer while the file's convention is remembered", async () => {
    statefulFs.seed(CRLF_DOC, CRLF_BODY);

    await openFileInNewTab(WINDOW, CRLF_DOC);

    const record = doc(tabIdFor(CRLF_DOC));
    expect(record.content).toBe(LF_BODY); // canonical editor domain
    expect(record.lastDiskContent).toBe(CRLF_BODY); // raw disk truth
    expect(record.lineEnding).toBe("crlf");
    expect(record.isDirty).toBe(false); // opening a CRLF file is not an edit
  });

  it("a BOM'd fixture opens BOM-free in the buffer and records hasBom", async () => {
    statefulFs.seed(BOM_DOC, `\u{FEFF}${LF_BODY}`);

    await openFileInNewTab(WINDOW, BOM_DOC);

    const record = doc(tabIdFor(BOM_DOC));
    expect(record.content).toBe(LF_BODY);
    expect(record.content.startsWith("\u{FEFF}")).toBe(false);
    expect(record.hasBom).toBe(true);
    expect(record.isDirty).toBe(false);
  });

  it("an empty file opens as an empty, clean document (boundary)", async () => {
    const empty = `${ROOT}/empty.md`;
    statefulFs.seed(empty, "");

    await openFileInNewTab(WINDOW, empty);

    const record = doc(tabIdFor(empty));
    expect(record.content).toBe("");
    expect(record.isDirty).toBe(false);
  });

  it("opening the same path twice activates the existing tab instead of duplicating it", async () => {
    statefulFs.seed(LF_DOC, LF_BODY);
    await openFileInNewTab(WINDOW, LF_DOC);
    const firstId = tabIdFor(LF_DOC);

    await openFileInNewTab(WINDOW, LF_DOC);

    expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
    expect(useTabStore.getState().activeTabId[WINDOW]).toBe(firstId);
  });

  it("a cancelled Open dialog changes nothing", async () => {
    vi.mocked(openDialog).mockResolvedValue(null);

    await handleOpen(WINDOW);

    expect(useTabStore.getState().getTabsByWindow(WINDOW)).toEqual([]);
    expect(useDocumentStore.getState().documents).toEqual({});
  });

  it("a read failure leaves NO orphan tab and no document behind", async () => {
    // The path is absent from the fake disk: the size probe and the read both
    // reject, exactly as a file deleted between listing and open would.
    await openFileInNewTab(WINDOW, `${ROOT}/ghost.md`);

    expect(useTabStore.getState().getTabsByWindow(WINDOW)).toEqual([]);
    expect(useDocumentStore.getState().documents).toEqual({});
  });

  it("round-trips: open → save-without-edit rewrites the file byte-identically", async () => {
    statefulFs.seed(CRLF_DOC, CRLF_BODY);
    await openFileInNewTab(WINDOW, CRLF_DOC);
    const tabId = tabIdFor(CRLF_DOC);

    const { saveToPath } = await import("@/services/persistence/saveToPath");
    await saveToPath(tabId, CRLF_DOC, doc(tabId).content, "manual");

    expect(statefulFs.read(CRLF_DOC)).toBe(CRLF_BODY);
  });
});
