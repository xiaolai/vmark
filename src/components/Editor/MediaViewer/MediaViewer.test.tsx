// Media tab-surface tests.
//
// MediaViewer reads the active tab's filePath from the document store and
// mounts MediaView. When the tab has no filePath it renders nothing.

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub MediaView so this suite isolates the surface's store wiring.
vi.mock("@/components/Editor/MediaView/MediaView", () => ({
  MediaView: ({ path, reloadKey }: { path: string; reloadKey?: number }) => (
    <div data-testid="media-view" data-reload-key={String(reloadKey)}>
      {path}
    </div>
  ),
}));

let mockFilePath: string | null = "/photos/sunset.png";
let mockDocumentId = 0;
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: (selector: (s: unknown) => unknown) =>
    selector({
      documents: { "tab-1": { filePath: mockFilePath, documentId: mockDocumentId } },
    }),
}));

import { MediaViewer } from "./MediaViewer";

afterEach(() => {
  cleanup();
  mockFilePath = "/photos/sunset.png";
  mockDocumentId = 0;
});

describe("MediaViewer", () => {
  it("reads filePath from the store and renders MediaView", () => {
    render(<MediaViewer tabId="tab-1" />);
    const view = screen.getByTestId("media-view");
    expect(view).toHaveTextContent("/photos/sunset.png");
  });

  // issue #1328 — a media tab's bytes live on disk, so `documentId` is the only
  // signal the viewer gets that the file changed underneath it.
  it("passes the document's external-change counter down as the reload key", () => {
    mockDocumentId = 4;
    render(<MediaViewer tabId="tab-1" />);
    expect(screen.getByTestId("media-view")).toHaveAttribute("data-reload-key", "4");
  });

  it("passes 0 for a document that has never changed externally", () => {
    render(<MediaViewer tabId="tab-1" />);
    expect(screen.getByTestId("media-view")).toHaveAttribute("data-reload-key", "0");
  });

  it("renders nothing when the tab has no filePath", () => {
    mockFilePath = null;
    const { container } = render(<MediaViewer tabId="tab-1" />);
    expect(screen.queryByTestId("media-view")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
