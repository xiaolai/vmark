// CC-Switch import row behavior (issue #1008).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const openUrlMock = vi.hoisted(() => vi.fn(async () => undefined));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toastMock }));

import { CcSwitchImportRow } from "../CcSwitchImportRow";

describe("CcSwitchImportRow", () => {
  beforeEach(() => {
    openUrlMock.mockClear();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
  });

  it("opens a ccswitch://v1/import link carrying the binary path on click", async () => {
    const user = userEvent.setup();
    render(<CcSwitchImportRow binaryPath="/usr/local/bin/vmark-mcp-server" loading={false} />);
    await user.click(screen.getByRole("button", { name: /cc-switch/i }));
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    const link = openUrlMock.mock.calls[0][0] as string;
    expect(link).toMatch(/^ccswitch:\/\/v1\/import\?/);
    expect(decodeURIComponent(link)).toContain("/usr/local/bin/vmark-mcp-server");
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("disables the button and does not open when the binary path is missing", async () => {
    render(<CcSwitchImportRow binaryPath={null} loading={false} />);
    const btn = screen.getByRole("button", { name: /cc-switch/i });
    expect(btn).toBeDisabled();
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("disables the button while loading", () => {
    render(<CcSwitchImportRow binaryPath="/bin/x" loading={true} />);
    expect(screen.getByRole("button", { name: /cc-switch/i })).toBeDisabled();
  });

  it("surfaces an error toast when the opener fails", async () => {
    openUrlMock.mockRejectedValueOnce(new Error("no handler"));
    const user = userEvent.setup();
    render(<CcSwitchImportRow binaryPath="/bin/x" loading={false} />);
    await user.click(screen.getByRole("button", { name: /cc-switch/i }));
    expect(toastMock.error).toHaveBeenCalled();
  });
});
