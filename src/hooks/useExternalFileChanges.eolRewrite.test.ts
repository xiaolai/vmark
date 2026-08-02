/**
 * WI-1.6 — an EOL-only external rewrite must ADOPT the new convention.
 *
 * A cloud sync engine rewriting a file with only line-ending/BOM changes takes
 * the soft-equals branch: content is untouched and `lastDiskContent` is
 * refreshed so the next byte compare matches. But the refresh left `lineEnding`
 * and `hasBom` STALE, so the next `preserve` save wrote the OLD convention back
 * — the editor and the sync engine flipping the file forever (LF → CRLF → LF).
 *
 * Tested at `updateLastDiskContent`, which is where the defect lives and which
 * all three production callers share (the watcher's soft-equals branch, its
 * Keep-my-changes refresh, and `keepAllLocal`). The plan's caveat about NOT
 * making this unconditional applied to `restoreHelpers`, which used to call it
 * carrying persisted metadata — that call is gone, folded into the single
 * hot-exit-restore ingest, so every remaining caller genuinely wants adoption.
 * `keepAllLocal` is exercised end-to-end here as the integration half.
 *
 * @coordinates-with stores/documentStore/document.ts — updateLastDiskContent
 * @coordinates-with hooks/useExternalFileChanges.ts — the soft-equals branch
 * @coordinates-with hooks/fileChangeBatch.ts — keepAllLocal
 * @module hooks/useExternalFileChanges.eolRewrite.test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const readTextFileMock = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => readTextFileMock(...args),
  exists: vi.fn(async () => true),
}));

import { useDocumentStore } from "@/stores/documentStore";
import { keepAllLocal } from "./fileChangeBatch";

const TAB = "tab-eol";
const PATH = "/watched/doc.md";
const BOM = "\u{FEFF}";

const doc = () => useDocumentStore.getState().documents[TAB];

function seed(raw: string) {
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().ingestExternalContent(TAB, raw, "disk-open", { filePath: PATH });
}

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
  readTextFileMock.mockReset();
});

describe("updateLastDiskContent adopts the file's new convention (WI-1.6)", () => {
  it("LF rewritten to CRLF: lineEnding becomes crlf", () => {
    seed("alpha\nbeta\n");
    expect(doc()?.lineEnding).toBe("lf");

    useDocumentStore.getState().updateLastDiskContent(TAB, "alpha\r\nbeta\r\n");

    expect(doc()?.lineEnding).toBe("crlf");
    expect(doc()?.lastDiskContent).toBe("alpha\r\nbeta\r\n");
  });

  it("CRLF rewritten to LF: the mirrored direction", () => {
    seed("alpha\r\nbeta\r\n");
    expect(doc()?.lineEnding).toBe("crlf");

    useDocumentStore.getState().updateLastDiskContent(TAB, "alpha\nbeta\n");

    expect(doc()?.lineEnding).toBe("lf");
  });

  it("a BOM added externally flips hasBom, so the next save keeps it", () => {
    seed("alpha\n");
    expect(doc()?.hasBom).toBe(false);

    useDocumentStore.getState().updateLastDiskContent(TAB, `${BOM}alpha\n`);

    expect(doc()?.hasBom).toBe(true);
  });

  it("a BOM removed externally clears hasBom, so the next save stops adding one", () => {
    seed(`${BOM}alpha\n`);
    expect(doc()?.hasBom).toBe(true);

    useDocumentStore.getState().updateLastDiskContent(TAB, "alpha\n");

    expect(doc()?.hasBom).toBe(false);
  });

  it("touches NOTHING else — content, dirty state and flags are the caller's business", () => {
    seed("alpha\nbeta\n");
    useDocumentStore.getState().setEditorContent(TAB, "alpha\nbeta\nlocal edit\n");
    useDocumentStore.getState().markDivergent(TAB);
    const before = doc()!;

    useDocumentStore.getState().updateLastDiskContent(TAB, "alpha\r\nbeta\r\n");

    expect(doc()?.content).toBe(before.content);
    expect(doc()?.savedContent).toBe(before.savedContent);
    expect(doc()?.isDirty).toBe(true);
    expect(doc()?.isDivergent).toBe(true);
    expect(doc()?.documentId).toBe(before.documentId);
  });

  it("is a no-op for a missing tab, like every other keyed update", () => {
    expect(() =>
      useDocumentStore.getState().updateLastDiskContent("no-such-tab", "x"),
    ).not.toThrow();
    expect(useDocumentStore.getState().documents["no-such-tab"]).toBeUndefined();
  });
});

describe("keepAllLocal adopts the convention alongside the disk snapshot", () => {
  it("refreshes the snapshot AND the line ending, keeping divergent state", async () => {
    seed("alpha\nbeta\n");
    readTextFileMock.mockResolvedValue("alpha\r\nbeta\r\n");

    await keepAllLocal([{ tabId: TAB, filePath: PATH, kind: "modify" } as never]);

    expect(doc()?.lastDiskContent).toBe("alpha\r\nbeta\r\n");
    expect(doc()?.lineEnding).toBe("crlf");
    expect(doc()?.isDivergent).toBe(true); // Keep-my-changes semantics intact
  });
});
