import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock stores and hooks before imports
const mockCheckForUpdates = vi.fn();
const mockRestartApp = vi.fn();
const mockOpenSettingsWindow = vi.fn();
const mockRecoverFromStall = vi.fn();
// Stall detection is time-based and tested directly in useUpdateStall.test.ts.
// Here it is a switch, so these cases assert what the indicator DOES about a
// stall rather than re-testing how one is detected.
let mockStalled = false;

vi.mock("@/stores/mcpStore", () => ({
  useMcpStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector({ update: mockUpdateState })
  ),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector(mockSettingsState)
  ),
}));

vi.mock("@/hooks/useUpdateOperations", () => ({
  useUpdateOperations: () => ({
    checkForUpdates: mockCheckForUpdates,
    restartApp: mockRestartApp,
    downloadAndInstall: vi.fn(),
    skipVersion: vi.fn(),
    requestState: vi.fn(),
  }),
  recoverFromStall: (...args: unknown[]) => mockRecoverFromStall(...args),
}));

vi.mock("@/hooks/useUpdateStall", () => ({
  useUpdateStall: () => mockStalled,
}));

vi.mock("@/services/navigation/settingsWindow", () => ({
  openSettingsWindow: (...args: unknown[]) => mockOpenSettingsWindow(...args),
}));

import { UpdateIndicator } from "./UpdateIndicator";

let mockUpdateState: Record<string, unknown>;
let mockSettingsState: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mockStalled = false;
  mockUpdateState = {
    status: "idle",
    updateInfo: null,
    downloadProgress: null,
  };
  mockSettingsState = {
    update: { autoDownload: false },
  };
});

describe("UpdateIndicator", () => {
  it("renders nothing for idle status", () => {
    mockUpdateState.status = "idle";
    const { container } = render(<UpdateIndicator />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for up-to-date status", () => {
    mockUpdateState.status = "up-to-date";
    const { container } = render(<UpdateIndicator />);
    expect(container.innerHTML).toBe("");
  });

  it("renders checking indicator (not clickable)", () => {
    mockUpdateState.status = "checking";
    render(<UpdateIndicator />);
    const button = screen.getByTitle("Checking for updates…");
    expect(button).toBeInTheDocument();
    expect(button.style.cursor).toBe("default");
  });

  it("renders available indicator with version info", () => {
    mockUpdateState.status = "available";
    mockUpdateState.updateInfo = {
      version: "1.2.3",
      notes: "Bug fixes",
      pubDate: "2025-01-01",
      currentVersion: "1.2.0",
    };
    render(<UpdateIndicator />);
    const button = screen.getByTitle("Update available: v1.2.3 — click to view");
    expect(button).toBeInTheDocument();
    expect(button.style.cursor).toBe("pointer");
  });

  it("renders available indicator without version info", () => {
    mockUpdateState.status = "available";
    mockUpdateState.updateInfo = null;
    render(<UpdateIndicator />);
    const button = screen.getByTitle("Update available — click to view");
    expect(button).toBeInTheDocument();
  });

  it("hides available indicator when autoDownload is on", () => {
    mockUpdateState.status = "available";
    mockSettingsState = { update: { autoDownload: true } };
    const { container } = render(<UpdateIndicator />);
    expect(container.innerHTML).toBe("");
  });

  it("renders downloading indicator with percentage", () => {
    mockUpdateState.status = "downloading";
    mockUpdateState.downloadProgress = { downloaded: 50, total: 100 };
    render(<UpdateIndicator />);
    const button = screen.getByTitle("Downloading: 50%");
    expect(button).toBeInTheDocument();
    expect(button.style.cursor).toBe("default");
  });

  it("renders downloading indicator without total (null total)", () => {
    mockUpdateState.status = "downloading";
    mockUpdateState.downloadProgress = { downloaded: 50, total: null };
    render(<UpdateIndicator />);
    const button = screen.getByTitle("Downloading update…");
    expect(button).toBeInTheDocument();
  });

  it("renders downloading indicator without progress data", () => {
    mockUpdateState.status = "downloading";
    mockUpdateState.downloadProgress = null;
    render(<UpdateIndicator />);
    const button = screen.getByTitle("Downloading update…");
    expect(button).toBeInTheDocument();
  });

  it("renders ready indicator with version info", () => {
    mockUpdateState.status = "ready";
    mockUpdateState.updateInfo = {
      version: "2.0.0",
      notes: "",
      pubDate: "",
      currentVersion: "1.0.0",
    };
    render(<UpdateIndicator />);
    const button = screen.getByTitle("v2.0.0 ready — click to restart");
    expect(button).toBeInTheDocument();
    expect(button.style.cursor).toBe("pointer");
  });

  it("renders ready indicator without version info", () => {
    mockUpdateState.status = "ready";
    mockUpdateState.updateInfo = null;
    render(<UpdateIndicator />);
    const button = screen.getByTitle("Click to restart and update");
    expect(button).toBeInTheDocument();
  });

  it("renders error indicator", () => {
    mockUpdateState.status = "error";
    render(<UpdateIndicator />);
    const button = screen.getByTitle("Update check failed — click to retry");
    expect(button).toBeInTheDocument();
    expect(button.style.cursor).toBe("pointer");
  });

  it("shows dot for available status", () => {
    mockUpdateState.status = "available";
    render(<UpdateIndicator />);
    const button = screen.getByTitle(/Update available/);
    const dot = button.querySelector(".status-update-dot");
    expect(dot).toBeInTheDocument();
  });

  it("shows dot for ready status", () => {
    mockUpdateState.status = "ready";
    render(<UpdateIndicator />);
    const button = screen.getByTitle(/restart/);
    const dot = button.querySelector(".status-update-dot");
    expect(dot).toBeInTheDocument();
  });

  it("does not show dot for checking status", () => {
    mockUpdateState.status = "checking";
    render(<UpdateIndicator />);
    const button = screen.getByTitle("Checking for updates…");
    const dot = button.querySelector(".status-update-dot");
    expect(dot).toBeNull();
  });

  it("does not show dot for error status", () => {
    mockUpdateState.status = "error";
    render(<UpdateIndicator />);
    const button = screen.getByTitle(/failed/);
    const dot = button.querySelector(".status-update-dot");
    expect(dot).toBeNull();
  });

  describe("click handlers", () => {
    it("opens settings on available click", async () => {
      const user = userEvent.setup();
      mockUpdateState.status = "available";
      render(<UpdateIndicator />);
      await user.click(screen.getByTitle(/Update available/));
      expect(mockOpenSettingsWindow).toHaveBeenCalledWith("about");
    });

    it("calls restartApp on ready click", async () => {
      const user = userEvent.setup();
      mockUpdateState.status = "ready";
      render(<UpdateIndicator />);
      await user.click(screen.getByTitle(/restart/));
      expect(mockRestartApp).toHaveBeenCalled();
    });

    it("calls checkForUpdates on error click", async () => {
      const user = userEvent.setup();
      mockUpdateState.status = "error";
      render(<UpdateIndicator />);
      await user.click(screen.getByTitle(/failed/));
      expect(mockCheckForUpdates).toHaveBeenCalled();
    });

    it("does not trigger action on checking click", async () => {
      const user = userEvent.setup();
      mockUpdateState.status = "checking";
      render(<UpdateIndicator />);
      await user.click(screen.getByTitle("Checking for updates…"));
      expect(mockOpenSettingsWindow).not.toHaveBeenCalled();
      expect(mockRestartApp).not.toHaveBeenCalled();
      expect(mockCheckForUpdates).not.toHaveBeenCalled();
    });

    it("does not trigger action on downloading click", async () => {
      const user = userEvent.setup();
      mockUpdateState.status = "downloading";
      mockUpdateState.downloadProgress = null;
      render(<UpdateIndicator />);
      await user.click(screen.getByTitle("Downloading update…"));
      expect(mockOpenSettingsWindow).not.toHaveBeenCalled();
      expect(mockRestartApp).not.toHaveBeenCalled();
      expect(mockCheckForUpdates).not.toHaveBeenCalled();
    });
  });

  describe("CSS classes", () => {
    it("applies checking class", () => {
      mockUpdateState.status = "checking";
      render(<UpdateIndicator />);
      expect(screen.getByTitle("Checking for updates…").className).toBe("status-update checking");
    });

    it("applies downloading class", () => {
      mockUpdateState.status = "downloading";
      render(<UpdateIndicator />);
      expect(screen.getByTitle(/Downloading/).className).toBe("status-update downloading");
    });

    it("applies available class", () => {
      mockUpdateState.status = "available";
      render(<UpdateIndicator />);
      expect(screen.getByTitle(/Update available/).className).toBe("status-update available");
    });

    it("applies ready class", () => {
      mockUpdateState.status = "ready";
      render(<UpdateIndicator />);
      expect(screen.getByTitle(/restart/).className).toBe("status-update ready");
    });

    it("applies error class", () => {
      mockUpdateState.status = "error";
      render(<UpdateIndicator />);
      expect(screen.getByTitle(/failed/).className).toBe("status-update error");
    });
  });

  describe("download percentage calculation", () => {
    it("calculates 0% when nothing downloaded", () => {
      mockUpdateState.status = "downloading";
      mockUpdateState.downloadProgress = { downloaded: 0, total: 100 };
      render(<UpdateIndicator />);
      expect(screen.getByTitle("Downloading: 0%")).toBeInTheDocument();
    });

    it("calculates 100% when fully downloaded", () => {
      mockUpdateState.status = "downloading";
      mockUpdateState.downloadProgress = { downloaded: 100, total: 100 };
      render(<UpdateIndicator />);
      expect(screen.getByTitle("Downloading: 100%")).toBeInTheDocument();
    });

    it("rounds percentage", () => {
      mockUpdateState.status = "downloading";
      mockUpdateState.downloadProgress = { downloaded: 33, total: 100 };
      render(<UpdateIndicator />);
      expect(screen.getByTitle("Downloading: 33%")).toBeInTheDocument();
    });

    it("handles zero total gracefully", () => {
      mockUpdateState.status = "downloading";
      mockUpdateState.downloadProgress = { downloaded: 0, total: 0 };
      render(<UpdateIndicator />);
      // 0/0 = NaN, Math.round(NaN) = NaN, so it falls through to null
      // Actually 0 is falsy so total check fails
      expect(screen.getByTitle("Downloading update…")).toBeInTheDocument();
    });
  });

  describe("installing state", () => {
    it("renders an installing indicator (not clickable)", () => {
      mockUpdateState.status = "installing";
      render(<UpdateIndicator />);
      const button = screen.getByTitle("Installing update…");
      expect(button).toBeInTheDocument();
      expect(button.style.cursor).toBe("default");
    });
  });

  // #1270: checking/downloading/installing are non-interactive, so a flow that
  // stops progressing left the user with a permanent spinner and no way out.
  // A stall makes the indicator clickable regardless of the state's normal
  // interactivity, and the click resets the flow rather than re-entering it.
  describe("stalled flow", () => {
    it.each(["checking", "downloading", "installing"] as const)(
      "makes a stalled %s state clickable",
      (status) => {
        mockUpdateState.status = status;
        mockStalled = true;
        render(<UpdateIndicator />);

        const button = screen.getByRole("button");
        expect(button.style.cursor).toBe("pointer");
      },
    );

    it("says the flow is stalled rather than showing the normal label", () => {
      mockUpdateState.status = "checking";
      mockStalled = true;
      render(<UpdateIndicator />);

      expect(screen.queryByTitle("Checking for updates…")).not.toBeInTheDocument();
      expect(screen.getByRole("button")).toHaveAttribute(
        "title",
        "Update stalled — click to reset",
      );
    });

    it("recovers the flow when a stalled indicator is clicked", async () => {
      const user = userEvent.setup();
      mockUpdateState.status = "downloading";
      mockStalled = true;
      render(<UpdateIndicator />);

      await user.click(screen.getByRole("button"));

      expect(mockRecoverFromStall).toHaveBeenCalledTimes(1);
    });

    // A stalled `error` must reset rather than fire another check into the
    // same stuck guard — that retry would join the dead promise.
    it("prefers recovery over retry when an error state is stalled", async () => {
      const user = userEvent.setup();
      mockUpdateState.status = "error";
      mockStalled = true;
      render(<UpdateIndicator />);

      await user.click(screen.getByRole("button"));

      expect(mockRecoverFromStall).toHaveBeenCalledTimes(1);
      expect(mockCheckForUpdates).not.toHaveBeenCalled();
    });

    // The negative that keeps the feature honest: a healthy non-interactive
    // state must stay non-interactive.
    it("leaves a healthy downloading state non-clickable", () => {
      mockUpdateState.status = "downloading";
      mockStalled = false;
      render(<UpdateIndicator />);

      expect(screen.getByRole("button").style.cursor).toBe("default");
    });
  });
});
