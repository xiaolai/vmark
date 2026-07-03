// Media render-core tests.
//
// MediaView classifies a file path (image / video / audio / unknown),
// resolves it to a Tauri asset URL, and renders the matching element.
// On load error or unknown type it shows a fallback panel with two
// external-open actions.

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// convertFileSrc is not in the global core mock — provide it here so the
// asset URL is deterministic. invoke resolves so the grant-then-render gate
// completes synchronously-ish in tests.
const invoke = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: (...args: unknown[]) => invoke(...args),
}));

const openPath = vi.fn(() => Promise.resolve());
const revealItemInDir = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => openPath(...args),
  revealItemInDir: (...args: unknown[]) => revealItemInDir(...args),
}));

import { MediaView } from "./MediaView";

afterEach(() => {
  cleanup();
  openPath.mockClear();
  revealItemInDir.mockClear();
  invoke.mockClear();
});

describe("MediaView", () => {
  it("grants asset access for the path before rendering the media element", async () => {
    render(<MediaView path="/photos/sunset.png" />);
    // The element is gated on the grant so a fresh Quick Look / arrow-nav path
    // (never opened as a tab) can still be served via asset://.
    await screen.findByRole("img");
    expect(invoke).toHaveBeenCalledWith("grant_asset_access", {
      path: "/photos/sunset.png",
    });
  });

  it("renders an <img> with the filename as alt text for a .png path", async () => {
    render(<MediaView path="/photos/sunset.png" />);
    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("alt", "sunset.png");
    expect(img).toHaveAttribute("src", "asset://localhost//photos/sunset.png");
  });

  it("renders a <video controls> element for a .mp4 path", async () => {
    render(<MediaView path="/clips/demo.mp4" />);
    const video = await screen.findByTestId("media-view-video");
    expect(video).toHaveAttribute("controls");
    expect(video.getAttribute("src")).toBe("asset://localhost//clips/demo.mp4");
  });

  it("renders an <audio controls> element for a .mp3 path", async () => {
    render(<MediaView path="/music/track.mp3" />);
    const audio = await screen.findByTestId("media-view-audio");
    expect(audio).toHaveAttribute("controls");
    expect(audio.getAttribute("src")).toBe("asset://localhost//music/track.mp3");
  });

  it("shows the fallback panel for an unknown extension", () => {
    render(<MediaView path="/data/archive.xyz" />);
    expect(screen.getByText(/can't preview this format/i)).toBeInTheDocument();
    expect(screen.getByText("archive.xyz")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("does not grant asset access for an unknown extension", () => {
    // An unknown extension renders the fallback panel and never loads an
    // asset:// URL, so it must not acquire fs+asset scope for that file.
    render(<MediaView path="/data/archive.xyz" />);
    expect(screen.getByText(/can't preview this format/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows the fallback panel when the media element fails to load", async () => {
    render(<MediaView path="/photos/broken.png" />);
    const img = await screen.findByRole("img");
    fireEvent.error(img);
    expect(screen.getByText(/can't preview this format/i)).toBeInTheDocument();
  });

  it("calls openPath with the file path when 'Open with default app' is clicked", async () => {
    const user = userEvent.setup();
    render(<MediaView path="/data/archive.xyz" />);
    await user.click(
      screen.getByRole("button", { name: /open with default app/i }),
    );
    expect(openPath).toHaveBeenCalledWith("/data/archive.xyz");
  });

  it("calls revealItemInDir with the file path when 'Reveal in Finder' is clicked", async () => {
    const user = userEvent.setup();
    render(<MediaView path="/data/archive.xyz" />);
    await user.click(
      screen.getByRole("button", { name: /reveal in finder/i }),
    );
    expect(revealItemInDir).toHaveBeenCalledWith("/data/archive.xyz");
  });
});
