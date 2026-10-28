// @vitest-environment node
// writeContent replaces a tab's whole document and answers its new revision; a tab with no document answers INVALID_TAB and mints no revision, instead of reporting a write that changed nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { writeContent } from "./writeContent";

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
});

describe("writeContent", () => {
  it("replaces the document and answers its new revision", () => {
    useDocumentStore.getState().initDocument("t1", "old\n", null);
    const before = useRevisionStore.getState().getRevision("t1");
    const result = writeContent("t1", "新しい\n", "markdown");
    expect(result).toEqual({ revision: useRevisionStore.getState().getRevision("t1") });
    expect(useRevisionStore.getState().getRevision("t1")).not.toBe(before);
    expect(useDocumentStore.getState().documents.t1?.content).toBe("新しい\n");
  });

  it("answers INVALID_TAB for a tab with no document, minting no revision", () => {
    const before = useRevisionStore.getState().getRevision("gone");
    expect(writeContent("gone", "text\n", "markdown")).toMatchObject({ error: "INVALID_TAB" });
    expect(useRevisionStore.getState().getRevision("gone")).toBe(before);
    expect(useDocumentStore.getState().documents.gone).toBeUndefined();
  });
});
