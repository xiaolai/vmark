import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/workspaces/fileOwnership", () => ({
  applyFileOwnershipAfterOpen: vi.fn(),
}));

import {
  openMediaFileInNewTab,
  tryOpenMediaFile,
  replaceTabWithMediaFile,
} from "./openMediaFile";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { rebootstrapFormats } from "@/lib/formats/registryBootstrap";
import {
  setFormatAssociationsProvider,
  __resetFormatAssociationsProvider,
} from "@/lib/formats/registry";

const WINDOW = "main";

describe("openMediaFileInNewTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rebootstrapFormats();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id),
    );
  });

  it("creates a media tab with EMPTY content and the file path", () => {
    const initSpy = vi.spyOn(useDocumentStore.getState(), "initDocument");
    const addFileSpy = vi.spyOn(useRecentFilesStore.getState(), "addFile");

    openMediaFileInNewTab(WINDOW, "/pics/photo.png");

    const tab = useTabStore.getState().getTabsByWindow(WINDOW).at(-1);
    expect(tab?.formatId).toBe("media");
    expect(initSpy).toHaveBeenCalledWith(tab?.id, "", "/pics/photo.png");
    // Never any bytes in the document store.
    expect(useDocumentStore.getState().documents[tab!.id]?.content).toBe("");
    expect(addFileSpy).toHaveBeenCalledWith("/pics/photo.png");
  });

  it("fires onTabCreated with the resolved tab id", () => {
    const onTabCreated = vi.fn();
    openMediaFileInNewTab(WINDOW, "/pics/a.gif", { onTabCreated });
    const tab = useTabStore.getState().getTabsByWindow(WINDOW).at(-1);
    expect(onTabCreated).toHaveBeenCalledWith(tab?.id, false);
  });
});

// F5 — binary-media detection is extension-based and UNCONDITIONAL. A media
// file must never be routed into the text pipeline even when a user format
// association would send its extension elsewhere.
describe("tryOpenMediaFile — extension-based detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rebootstrapFormats();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id),
    );
  });

  afterEach(() => {
    __resetFormatAssociationsProvider();
  });

  it("treats a .png as media even when the user associates .png → txt", () => {
    // dispatchEditor(".png") would now resolve to txt — but a binary file must
    // never be read as UTF-8, so the extension gate short-circuits to media.
    setFormatAssociationsProvider(() => ({ png: "txt" }));
    const initSpy = vi.spyOn(useDocumentStore.getState(), "initDocument");

    const handled = tryOpenMediaFile(WINDOW, "/pics/photo.png");

    expect(handled).toBe(true);
    // Path-only open: EMPTY content, no bytes ever read.
    expect(initSpy).toHaveBeenCalledWith(
      expect.any(String),
      "",
      "/pics/photo.png",
    );
  });

  it("does NOT treat a .svg as media (svg is a registered text/split-pane format)", () => {
    expect(tryOpenMediaFile(WINDOW, "/pics/icon.svg")).toBe(false);
  });

  it("returns false for a plain markdown file", () => {
    expect(tryOpenMediaFile(WINDOW, "/docs/readme.md")).toBe(false);
  });
});

// F1 — replace an existing clean tab with a media file, path-only.
describe("replaceTabWithMediaFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rebootstrapFormats();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id),
    );
  });

  it("replaces the tab with EMPTY content + the media path and formatId", () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "# scratch", null);
    const loadSpy = vi.spyOn(useDocumentStore.getState(), "loadContent");
    const addFileSpy = vi.spyOn(useRecentFilesStore.getState(), "addFile");

    replaceTabWithMediaFile(tabId, "/pics/photo.png");

    const tab = useTabStore.getState().findTabById(tabId);
    expect(tab?.filePath).toBe("/pics/photo.png");
    expect(tab?.formatId).toBe("media");
    expect(loadSpy).toHaveBeenCalledWith(tabId, "", "/pics/photo.png");
    expect(useDocumentStore.getState().documents[tabId]?.content).toBe("");
    expect(addFileSpy).toHaveBeenCalledWith("/pics/photo.png");
  });
});
