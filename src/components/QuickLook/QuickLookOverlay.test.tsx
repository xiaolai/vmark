import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuickLookStore } from "@/stores/quickLookStore";
import { QuickLookOverlay } from "./QuickLookOverlay";

// Mock MediaView so we can assert it receives the selected path, without
// pulling in Tauri asset resolution / media element rendering.
const mediaViewSpy = vi.fn();
vi.mock("@/components/Editor/MediaView/MediaView", () => ({
  MediaView: (props: { path: string }) => {
    mediaViewSpy(props);
    return <div data-testid="media-view">{props.path}</div>;
  },
}));

describe("QuickLookOverlay", () => {
  beforeEach(() => {
    mediaViewSpy.mockClear();
    useQuickLookStore.setState({ isOpen: false, path: null });
  });

  afterEach(() => {
    cleanup();
    useQuickLookStore.setState({ isOpen: false, path: null });
  });

  it("renders nothing when closed", () => {
    render(<QuickLookOverlay />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mediaViewSpy).not.toHaveBeenCalled();
  });

  it("renders MediaView with the open path", () => {
    useQuickLookStore.setState({ isOpen: true, path: "/abs/photo.png" });
    render(<QuickLookOverlay />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mediaViewSpy).toHaveBeenCalledWith({ path: "/abs/photo.png" });
    expect(screen.getByTestId("media-view")).toHaveTextContent("/abs/photo.png");
  });

  it("shows the filename in the header and dialog aria-label", () => {
    useQuickLookStore.setState({ isOpen: true, path: "/deep/dir/photo.png" });
    render(<QuickLookOverlay />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "photo.png");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("closes when the close button is clicked", async () => {
    const user = userEvent.setup();
    useQuickLookStore.setState({ isOpen: true, path: "/abs/photo.png" });
    render(<QuickLookOverlay />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(useQuickLookStore.getState().isOpen).toBe(false);
  });

  it("closes when Escape is pressed", () => {
    useQuickLookStore.setState({ isOpen: true, path: "/abs/photo.png" });
    render(<QuickLookOverlay />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useQuickLookStore.getState().isOpen).toBe(false);
  });

  it("closes when Space is pressed (Finder toggle)", () => {
    useQuickLookStore.setState({ isOpen: true, path: "/abs/photo.png" });
    render(<QuickLookOverlay />);
    fireEvent.keyDown(window, { key: " " });
    expect(useQuickLookStore.getState().isOpen).toBe(false);
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    useQuickLookStore.setState({ isOpen: true, path: "/abs/photo.png" });
    const { container } = render(<QuickLookOverlay />);
    const backdrop = container.ownerDocument.querySelector(
      ".quick-look-backdrop",
    ) as HTMLElement;
    await user.click(backdrop);
    expect(useQuickLookStore.getState().isOpen).toBe(false);
  });

  it("does not close when the panel itself is clicked", async () => {
    const user = userEvent.setup();
    useQuickLookStore.setState({ isOpen: true, path: "/abs/photo.png" });
    render(<QuickLookOverlay />);
    await user.click(screen.getByRole("dialog"));
    expect(useQuickLookStore.getState().isOpen).toBe(true);
  });

  it("ArrowRight/ArrowDown advance to the next sibling", () => {
    useQuickLookStore
      .getState()
      .open("/ws/a.png", ["/ws/a.png", "/ws/b.mp4", "/ws/c.mp3"]);
    render(<QuickLookOverlay />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useQuickLookStore.getState().path).toBe("/ws/b.mp4");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(useQuickLookStore.getState().path).toBe("/ws/c.mp3");
    // Clamps at the end.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useQuickLookStore.getState().path).toBe("/ws/c.mp3");
    // Still open (arrows navigate, don't close).
    expect(useQuickLookStore.getState().isOpen).toBe(true);
  });

  it("ArrowLeft/ArrowUp move to the previous sibling", () => {
    useQuickLookStore
      .getState()
      .open("/ws/c.mp3", ["/ws/a.png", "/ws/b.mp4", "/ws/c.mp3"]);
    render(<QuickLookOverlay />);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(useQuickLookStore.getState().path).toBe("/ws/b.mp4");
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(useQuickLookStore.getState().path).toBe("/ws/a.png");
  });

  it("shows a position indicator when there are multiple siblings", () => {
    useQuickLookStore
      .getState()
      .open("/ws/b.mp4", ["/ws/a.png", "/ws/b.mp4", "/ws/c.mp3"]);
    render(<QuickLookOverlay />);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("hides the position indicator for a lone file", () => {
    useQuickLookStore.getState().open("/ws/solo.png");
    render(<QuickLookOverlay />);
    expect(screen.queryByText("1 / 1")).toBeNull();
  });

  // ── F3: don't steal keys from a focused media control ──

  it("does not navigate siblings when Arrow keys come from a focused media element", () => {
    useQuickLookStore
      .getState()
      .open("/ws/a.png", ["/ws/a.png", "/ws/b.mp4", "/ws/c.mp3"]);
    render(<QuickLookOverlay />);
    const video = document.createElement("video");
    document.body.appendChild(video);

    fireEvent.keyDown(video, { key: "ArrowRight" });
    expect(useQuickLookStore.getState().path).toBe("/ws/a.png");
    fireEvent.keyDown(video, { key: "ArrowLeft" });
    expect(useQuickLookStore.getState().path).toBe("/ws/a.png");

    video.remove();
  });

  it("does not close on Space from a focused media element", () => {
    useQuickLookStore.setState({ isOpen: true, path: "/abs/video.mp4" });
    render(<QuickLookOverlay />);
    const video = document.createElement("video");
    document.body.appendChild(video);

    fireEvent.keyDown(video, { key: " " });
    expect(useQuickLookStore.getState().isOpen).toBe(true);

    video.remove();
  });

  it("still closes on Escape from a focused media element", () => {
    useQuickLookStore.setState({ isOpen: true, path: "/abs/video.mp4" });
    render(<QuickLookOverlay />);
    const video = document.createElement("video");
    document.body.appendChild(video);

    fireEvent.keyDown(video, { key: "Escape" });
    expect(useQuickLookStore.getState().isOpen).toBe(false);

    video.remove();
  });

  // ── F4: focus restoration guards against a removed element ──

  it("does not restore focus to a disconnected previously-focused element", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    const focusSpy = vi.spyOn(btn, "focus");

    useQuickLookStore.setState({ isOpen: true, path: "/abs/photo.png" });
    const { rerender } = render(<QuickLookOverlay />);
    focusSpy.mockClear();

    // Element gone before the overlay closes.
    btn.remove();
    useQuickLookStore.setState({ isOpen: false, path: null });

    expect(() => rerender(<QuickLookOverlay />)).not.toThrow();
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("removes the window keydown listener after closing", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    useQuickLookStore.setState({ isOpen: true, path: "/abs/photo.png" });
    const { rerender } = render(<QuickLookOverlay />);
    useQuickLookStore.setState({ isOpen: false, path: null });
    rerender(<QuickLookOverlay />);
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });
});
