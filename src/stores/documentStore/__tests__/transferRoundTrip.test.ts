// @vitest-environment node
/**
 * A file's convention must survive a window-to-window move.
 *
 * `TabTransferPayload` carried `content`, `savedContent` and `isDirty` — all
 * canonical editor text, LF and BOM-free by construction. So the file's own
 * line ending and BOM were simply unrecoverable on the far side: `initDocument`
 * set `lineEnding: "unknown"`, `resolveLineEnding` under `preserve` then
 * applied the user's default, and a CRLF+BOM file came back LF and BOM-less on
 * its first save in the new window. `preserve`'s whole promise is that it does
 * not do that.
 *
 * The byte round-trip below is the same assertion `ingestMatrix.test.ts` makes
 * for every other origin, applied to the one Phase 1 could not route.
 *
 * @coordinates-with utils/transferLineMetadata.ts — the pure helpers
 * @coordinates-with types/tabTransfer.ts — the payload
 * @module stores/documentStore/__tests__/transferRoundTrip.test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      general: { lineEndingsOnSave: "preserve" },
      markdown: { hardBreakStyleOnSave: "preserve" },
    })),
    subscribe: vi.fn(),
  },
}));

import { useDocumentStore } from "@/stores/documentStore";
import { normalizeSaveContent } from "@/services/persistence/saveToPath";
import { collectTransferLineMetadata } from "@/utils/transferLineMetadata";

const SOURCE = "tab-source";
const DEST = "tab-dest";
const BOM = "\u{FEFF}";

const doc = (id: string) => useDocumentStore.getState().documents[id];

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
});

/** Move SOURCE's tab into DEST the way the transfer path does. */
function moveTab(): void {
  const src = doc(SOURCE)!;
  const payload = {
    content: src.content,
    savedContent: src.savedContent,
    ...collectTransferLineMetadata(src),
  };
  useDocumentStore.getState().initDocument(DEST, payload.content, "/m.md", {
    savedContent: payload.savedContent,
    ...payload,
  });
}

describe("byte round-trip across a window move", () => {
  it.each([
    { label: "LF", raw: "alpha\nbeta\n" },
    { label: "CRLF", raw: "alpha\r\nbeta\r\n" },
    { label: "CRLF+BOM", raw: `${BOM}alpha\r\nbeta\r\n` },
    { label: "LF+BOM", raw: `${BOM}alpha\nbeta\n` },
    { label: "backslash breaks", raw: "one\\\ntwo\n" },
    { label: "two-space breaks", raw: "one  \ntwo\n" },
  ])("$label survives the move and saves byte-identical", ({ raw }) => {
    useDocumentStore
      .getState()
      .ingestExternalContent(SOURCE, raw, "disk-open", { filePath: "/m.md" });

    moveTab();

    expect(normalizeSaveContent(DEST, doc(DEST)!.content).output).toBe(raw);
  });

  it("carries the disk snapshot RAW, so the watcher compares the right domain", () => {
    // Handing the destination canonical text as `lastDiskContent` makes the
    // first watcher event report a change that never happened.
    const raw = `${BOM}alpha\r\nbeta\r\n`;
    useDocumentStore
      .getState()
      .ingestExternalContent(SOURCE, raw, "disk-open", { filePath: "/m.md" });

    moveTab();

    expect(doc(DEST)!.lastDiskContent).toBe(raw);
    expect(doc(DEST)!.content).not.toContain("\r");
  });

  it("a moved document is not spuriously dirty", () => {
    useDocumentStore
      .getState()
      .ingestExternalContent(SOURCE, "alpha\r\nbeta\r\n", "disk-open", { filePath: "/m.md" });

    moveTab();

    expect(doc(DEST)!.isDirty).toBe(false);
  });

  it("a document dirty at the source stays dirty at the destination", () => {
    useDocumentStore
      .getState()
      .ingestExternalContent(SOURCE, "alpha\n", "disk-open", { filePath: "/m.md" });
    useDocumentStore.getState().setEditorContent(SOURCE, "alpha\nedited\n");

    moveTab();

    expect(doc(DEST)!.isDirty).toBe(true);
    expect(doc(DEST)!.content).toBe("alpha\nedited\n");
  });
});


describe("backward compatibility with an older sender", () => {
  it("does not overwrite a derived value with an absent one", () => {
    useDocumentStore
      .getState()
      .ingestExternalContent(SOURCE, "one\\\ntwo\n", "disk-open", { filePath: "/m.md" });
    const derived = doc(SOURCE)!.hardBreakStyle;

    // An old payload: content only, no metadata fields.
    useDocumentStore.getState().initDocument(DEST, "one\\\ntwo\n", "/m.md", {
      savedContent: "one\\\ntwo\n",
    });

    expect(doc(DEST)!.hardBreakStyle).toBe(derived);
  });
});
