import { describe, expect, it } from "vitest";
import type { Tab } from "@/stores/tabStore";
import type { WorkspaceTransferTabPayload, WorkspaceWindowOperation } from "@/types/workspaceTransfer";
import {
  classifyDuplicateEligibility,
  resolveTransferActiveTab,
  serializeTransferTab,
} from "./workspaceTabCollection";

function tab(over: Partial<Tab> = {}): Tab {
  return { id: "t1", filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown", ...over };
}

type Doc = Parameters<typeof serializeTransferTab>[1];
function doc(over: Partial<Doc> = {}): Doc {
  return {
    content: "c",
    savedContent: "c",
    isDirty: false,
    readOnly: false,
    isMissing: false,
    ...over,
  } as Doc;
}

describe("classifyDuplicateEligibility", () => {
  it("never skips for a move", () => {
    expect(classifyDuplicateEligibility(tab({ filePath: null }), doc({ isDirty: true }), "move")).toBeNull();
  });

  it.each<[Partial<Tab>, Partial<Doc>, string]>([
    [{ filePath: null }, {}, "untitled"],
    [{}, { isMissing: true }, "missing"],
    [{}, { isDirty: true }, "dirty"],
  ])("skips %j/%j as %s on duplicate", (tabOver, docOver, expected) => {
    expect(classifyDuplicateEligibility(tab(tabOver), doc(docOver), "duplicate" as WorkspaceWindowOperation))
      .toBe(expected);
  });

  it("is eligible when clean, present, and titled on duplicate", () => {
    expect(classifyDuplicateEligibility(tab(), doc(), "duplicate")).toBeNull();
  });
});

describe("resolveTransferActiveTab", () => {
  const tabs: WorkspaceTransferTabPayload[] = [
    { tabId: "a" } as WorkspaceTransferTabPayload,
    { tabId: "b" } as WorkspaceTransferTabPayload,
  ];

  it("keeps the window's active tab when it was collected", () => {
    expect(resolveTransferActiveTab(tabs, "b")).toBe("b");
  });

  it("falls back to the first collected tab when the active tab was not collected", () => {
    expect(resolveTransferActiveTab(tabs, "z")).toBe("a");
  });

  it("returns null for an empty collection", () => {
    expect(resolveTransferActiveTab([], "a")).toBeNull();
  });
});

describe("serializeTransferTab", () => {
  it("copies tab + document fields into the transfer payload", () => {
    const result = serializeTransferTab(
      tab({ id: "x", title: "X", filePath: "/x.md", isPinned: true }),
      doc({ content: "edited", savedContent: "saved", isDirty: true, readOnly: true }),
    );
    expect(result).toMatchObject({
      tabId: "x",
      title: "X",
      filePath: "/x.md",
      content: "edited",
      savedContent: "saved",
      isDirty: true,
      readOnly: true,
      isPinned: true,
    });
  });
});
