// Media tab-surface tests.
//
// MediaViewer reads the active tab's filePath from the document store and
// mounts MediaView. When the tab has no filePath it renders nothing.

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub MediaView so this suite isolates the surface's store wiring.
vi.mock("@/components/Editor/MediaView/MediaView", () => ({
  MediaView: ({ path }: { path: string }) => (
    <div data-testid="media-view">{path}</div>
  ),
}));

let mockFilePath: string | null = "/photos/sunset.png";
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: (selector: (s: unknown) => unknown) =>
    selector({ documents: { "tab-1": { filePath: mockFilePath } } }),
}));

import { MediaViewer } from "./MediaViewer";

afterEach(() => {
  cleanup();
  mockFilePath = "/photos/sunset.png";
});

describe("MediaViewer", () => {
  it("reads filePath from the store and renders MediaView", () => {
    render(<MediaViewer tabId="tab-1" />);
    const view = screen.getByTestId("media-view");
    expect(view).toHaveTextContent("/photos/sunset.png");
  });

  it("renders nothing when the tab has no filePath", () => {
    mockFilePath = null;
    const { container } = render(<MediaViewer tabId="tab-1" />);
    expect(screen.queryByTestId("media-view")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
