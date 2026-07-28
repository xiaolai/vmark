import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUpdateState: Record<string, unknown> = {};

vi.mock("@/stores/mcpStore", () => ({
  useMcpStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ update: mockUpdateState }),
}));

vi.mock("@/hooks/useUpdateOperations", () => ({
  useUpdateOperations: () => ({
    downloadAndInstall: vi.fn(),
    restartApp: vi.fn(),
    skipVersion: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@/utils/safeUnlisten", () => ({ safeUnlistenAsync: vi.fn() }));

import { UpdateAvailableCard } from "./UpdateAvailableCard";

const MB = 1024 * 1024;
const INFO = { version: "1.2.0", notes: "", pubDate: "", currentVersion: "1.1.0" };

beforeEach(() => {
  Object.assign(mockUpdateState, {
    status: "available",
    updateInfo: INFO,
    dismissed: false,
    downloadProgress: null,
  });
});

describe("UpdateAvailableCard", () => {
  it("renders nothing before any update is known", () => {
    mockUpdateState.updateInfo = null;
    mockUpdateState.status = "checking";
    const { container } = render(<UpdateAvailableCard />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a determinate, accessible progress bar while downloading", () => {
    mockUpdateState.status = "downloading";
    mockUpdateState.downloadProgress = { downloaded: 5 * MB, total: 10 * MB };
    render(<UpdateAvailableCard />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(screen.getByText("5.0 / 10.0 MB (50%)")).toBeInTheDocument();
  });

  it("clamps the bar to 100% if downloaded exceeds total", () => {
    mockUpdateState.status = "downloading";
    mockUpdateState.downloadProgress = { downloaded: 11 * MB, total: 10 * MB };
    render(<UpdateAvailableCard />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("uses an indeterminate bar when Content-Length is unknown", () => {
    mockUpdateState.status = "downloading";
    mockUpdateState.downloadProgress = { downloaded: 3 * MB, total: null };
    render(<UpdateAvailableCard />);

    const bar = screen.getByRole("progressbar");
    // No fake percentage; announces bytes instead.
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-valuetext", "3.0 MB downloaded");
    expect(screen.getByText("3.0 MB downloaded")).toBeInTheDocument();
    // Animated rather than frozen at 0% — but NOT a full-width fill, which
    // reads as "finished".
    const fill = bar.querySelector<HTMLElement>(".update-progress-fill");
    expect(fill).not.toBeNull();
    expect(fill!.style.width).not.toBe("100%");
  });

  // Regression: the download begins with `{ downloaded: 0, total: null }`,
  // written before Tauri's `Started` event carries Content-Length. That state
  // is indistinguishable from "no Content-Length", so the bar rendered a
  // full-width fill and then snapped back to 0% once `Started` arrived —
  // reported as "the progress bar is 100% first, then starts from 0%".
  it("does not show a full bar before the download has started", () => {
    mockUpdateState.status = "downloading";
    mockUpdateState.downloadProgress = { downloaded: 0, total: null };
    render(<UpdateAvailableCard />);

    const fill = screen
      .getByRole("progressbar")
      .querySelector<HTMLElement>(".update-progress-fill");
    expect(fill).not.toBeNull();
    expect(fill!.style.width).not.toBe("100%");
  });

  it("never renders a full fill until the download is actually complete", () => {
    for (const progress of [
      { downloaded: 0, total: null },
      { downloaded: 3 * MB, total: null },
      { downloaded: 0, total: 10 * MB },
      { downloaded: 5 * MB, total: 10 * MB },
    ]) {
      mockUpdateState.status = "downloading";
      mockUpdateState.downloadProgress = progress;
      const { unmount } = render(<UpdateAvailableCard />);
      const fill = screen
        .getByRole("progressbar")
        .querySelector<HTMLElement>(".update-progress-fill");
      expect(fill!.style.width, JSON.stringify(progress)).not.toBe("100%");
      unmount();
    }
  });

  it("shows an Installing state at 100% after the download finishes", () => {
    mockUpdateState.status = "installing";
    mockUpdateState.downloadProgress = { downloaded: 10 * MB, total: 10 * MB };
    render(<UpdateAvailableCard />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("Installing update...")).toBeInTheDocument();
    // The primary button reflects the install phase and is disabled.
    const btn = screen.getByRole("button", { name: /installing/i });
    expect(btn).toBeDisabled();
  });

  it("keeps the (disabled) download button mounted during the re-check", () => {
    // Settings download path flips to "checking" briefly; the button must not
    // vanish — it stays as a disabled spinner.
    mockUpdateState.status = "checking";
    render(<UpdateAvailableCard />);
    const btn = screen.getByRole("button", { name: /downloading/i });
    expect(btn).toBeDisabled();
  });

  it("shows the restart button when ready", () => {
    mockUpdateState.status = "ready";
    render(<UpdateAvailableCard />);
    expect(screen.getByRole("button", { name: /restart to update/i })).toBeInTheDocument();
    // No progress bar in the ready state.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders nothing when dismissed", () => {
    mockUpdateState.dismissed = true;
    const { container } = render(<UpdateAvailableCard />);
    expect(container.innerHTML).toBe("");
  });
});
