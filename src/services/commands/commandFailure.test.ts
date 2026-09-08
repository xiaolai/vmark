// @vitest-environment node
/**
 * The one log-and-show policy (audit #897/#900/#921/#922/#953).
 *
 * Five command bodies had each written this by hand, and they had drifted: the
 * Pandoc export toasted, the four other exports only logged; the help links
 * toasted, the Genies folder only logged; Open Workspace logged, Close
 * Workspace did neither.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockToastError = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: (...a: unknown[]) => mockToastError(...a), info: vi.fn(), success: vi.fn() },
}));

const mockMenuError = vi.fn();
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  menuError: (...a: unknown[]) => mockMenuError(...a),
}));

import { reportCommandFailure } from "./commandFailure";

beforeEach(() => {
  mockToastError.mockReset();
  mockMenuError.mockReset();
});

describe("reportCommandFailure", () => {
  it("logs with the label AND shows the error's own message", () => {
    reportCommandFailure(new Error("no handler registered"), { label: "Failed to open:" });

    expect(mockMenuError).toHaveBeenCalledWith("Failed to open:", expect.any(Error));
    expect(mockToastError).toHaveBeenCalledWith("no handler registered");
  });

  it("prefers a translated message when the caller has one", () => {
    reportCommandFailure(new Error("spawn ENOENT"), {
      label: "Failed to export via Pandoc:",
      message: "Pandoc export failed",
    });

    expect(mockToastError).toHaveBeenCalledWith("Pandoc export failed");
  });

  it("renders a TYPED CommandError's message, never [object Object]", () => {
    reportCommandFailure(
      { code: "permission-denied", message: "The folder is read-only" },
      { label: "Failed to reveal:" },
    );

    expect(mockToastError).toHaveBeenCalledWith("The folder is read-only");
  });

  it("routes the log through the caller's own domain logger when given one", () => {
    const workspaceLog = vi.fn();
    reportCommandFailure(new Error("disk full"), {
      label: "Failed to close the workspace:",
      log: workspaceLog,
    });

    expect(workspaceLog).toHaveBeenCalledWith("Failed to close the workspace:", expect.any(Error));
    expect(mockMenuError).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });
});
