// Window-Status panel (#1057) — lists other windows, ranks by attention, jumps on click.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
const emit = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: (...a: unknown[]) => emit(...a) }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "self",
}));

import { WindowStatusPanel } from "./WindowStatusPanel";
import { useWindowStatusStore, type WindowStatusEntry } from "@/stores/windowStatusStore";

function entry(p: Partial<WindowStatusEntry> & { label: string }): WindowStatusEntry {
  return { docName: p.label, ai: "idle", elapsedSeconds: 0, attention: false, ...p };
}

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  emit.mockReset().mockResolvedValue(undefined);
  useWindowStatusStore.getState().reset();
  useWindowStatusStore.getState().setPanelOpen(true);
});

describe("WindowStatusPanel", () => {
  it("shows the empty state when there are no other windows", () => {
    useWindowStatusStore.getState().setWindows([entry({ label: "self" })]);
    render(<WindowStatusPanel />);
    expect(screen.getByText(/no other windows/i)).toBeInTheDocument();
  });

  it("lists other windows (not self) with their status, attention first", () => {
    useWindowStatusStore.getState().setWindows([
      entry({ label: "self", docName: "me" }),
      entry({ label: "w-run", docName: "running.md", ai: "running" }),
      entry({ label: "w-bell", docName: "needs-me.md", attention: true }),
    ]);
    render(<WindowStatusPanel />);
    const rows = screen.getAllByRole("button").filter((b) => b.className.includes("window-status-row"));
    expect(rows).toHaveLength(2);
    // attention-first ordering
    expect(rows[0]).toHaveTextContent("needs-me.md");
    expect(rows[0]).toHaveTextContent(/needs attention/i);
    expect(rows[1]).toHaveTextContent("running.md");
    expect(rows[1]).toHaveTextContent(/running/i);
    expect(screen.queryByText("me")).toBeNull(); // self excluded
  });

  it("clicking a row focuses that window and closes the panel", async () => {
    const user = userEvent.setup();
    useWindowStatusStore.getState().setWindows([
      entry({ label: "self" }),
      entry({ label: "w-2", docName: "other.md" }),
    ]);
    render(<WindowStatusPanel />);
    await user.click(screen.getByRole("button", { name: /other\.md/i }));
    expect(invoke).toHaveBeenCalledWith("focus_window", { label: "w-2" });
    await vi.waitFor(() => expect(useWindowStatusStore.getState().panelOpen).toBe(false));
  });

  it("keeps the panel open if focusing a stale window fails", async () => {
    const user = userEvent.setup();
    invoke.mockRejectedValue(new Error("window not found"));
    useWindowStatusStore.getState().setWindows([
      entry({ label: "self" }),
      entry({ label: "w-gone", docName: "gone.md" }),
    ]);
    render(<WindowStatusPanel />);
    await user.click(screen.getByRole("button", { name: /gone\.md/i }));
    expect(invoke).toHaveBeenCalledWith("focus_window", { label: "w-gone" });
    // Focus failed → panel stays open so the user isn't left with nothing.
    await Promise.resolve();
    expect(useWindowStatusStore.getState().panelOpen).toBe(true);
  });

  it("falls back to 'Untitled' for a window with no doc name", () => {
    useWindowStatusStore.getState().setWindows([
      entry({ label: "self" }),
      entry({ label: "w-3", docName: "" }),
    ]);
    render(<WindowStatusPanel />);
    expect(screen.getByText(/untitled/i)).toBeInTheDocument();
  });

  it("pin dropdown — 'Pin this window' toggles this window's pin (#1120)", async () => {
    const user = userEvent.setup();
    useWindowStatusStore.getState().setWindows([
      entry({ label: "self" }),
      entry({ label: "w", docName: "o.md" }),
    ]);
    render(<WindowStatusPanel />);
    // The pin button now opens a scope menu instead of toggling directly.
    await user.click(screen.getByRole("button", { name: /pin/i }));
    const item = screen.getByRole("menuitemcheckbox", { name: /pin this window/i });
    expect(item).toHaveAttribute("aria-checked", "false");
    await user.click(item);
    expect(useWindowStatusStore.getState().pinned).toBe(true);
    expect(useWindowStatusStore.getState().globalPin).toBe(false);
  });

  it("pin dropdown — 'Pin all windows' enables the app-global pin and broadcasts it (#1135)", async () => {
    const user = userEvent.setup();
    useWindowStatusStore.getState().setWindows([entry({ label: "self" })]);
    render(<WindowStatusPanel />);
    await user.click(screen.getByRole("button", { name: /pin/i }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /pin all windows/i }));
    expect(useWindowStatusStore.getState().globalPin).toBe(true);
    // Other open windows follow via the broadcast.
    expect(emit).toHaveBeenCalledWith("window-status:global-pin", true);
  });

  it("closes the pin menu on Escape", async () => {
    const user = userEvent.setup();
    useWindowStatusStore.getState().setWindows([entry({ label: "self" })]);
    render(<WindowStatusPanel />);
    await user.click(screen.getByRole("button", { name: /pin/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the pin menu when clicking outside it", async () => {
    const user = userEvent.setup();
    useWindowStatusStore.getState().setWindows([entry({ label: "self" })]);
    render(<WindowStatusPanel />);
    await user.click(screen.getByRole("button", { name: /pin/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByText(/window status/i)); // panel title, outside the menu
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("with the app-global pin on, clicking a row keeps the panel open (#1135)", async () => {
    const user = userEvent.setup();
    useWindowStatusStore.getState().setGlobalPin(true); // opens + marks global
    useWindowStatusStore.getState().setWindows([
      entry({ label: "self" }),
      entry({ label: "w-2", docName: "other.md" }),
    ]);
    render(<WindowStatusPanel />);
    await user.click(screen.getByRole("button", { name: /other\.md/i }));
    expect(invoke).toHaveBeenCalledWith("focus_window", { label: "w-2" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    await Promise.resolve();
    // Global pin behaves pinned everywhere → panel stays open (contrast: the
    // unpinned case above closes it).
    expect(useWindowStatusStore.getState().panelOpen).toBe(true);
  });

  it("when pinned, clicking a row focuses the window but keeps the panel open (#1120)", async () => {
    const user = userEvent.setup();
    useWindowStatusStore.getState().setPinned(true);
    useWindowStatusStore.getState().setWindows([
      entry({ label: "self" }),
      entry({ label: "w-2", docName: "other.md" }),
    ]);
    render(<WindowStatusPanel />);
    await user.click(screen.getByRole("button", { name: /other\.md/i }));
    expect(invoke).toHaveBeenCalledWith("focus_window", { label: "w-2" });
    // Pinned → panel stays open as mission control (contrast: the unpinned
    // case above closes it).
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    await Promise.resolve();
    expect(useWindowStatusStore.getState().panelOpen).toBe(true);
  });
});
