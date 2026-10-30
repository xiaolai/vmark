// A rebinding the native menu refuses must not look applied: the rejected
// `update_menu_accelerators` reaches the pane as an error toast carrying the
// command's message. It used to be logged only.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/services/dialogs/confirmAction", () => ({ confirmAction: vi.fn() }));

const { toastError, invoke } = vi.hoisted(() => ({ toastError: vi.fn(), invoke: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { error: toastError } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { ShortcutsSettings } from "./ShortcutsSettings";
import { useShortcutsStore, flushMenuShortcutsSync } from "@/stores/settingsStore";

function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label).closest("div.flex.items-center.justify-between");
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return row;
}

function rebindBoldTo(key: string, code: string): void {
  fireEvent.click(within(rowFor("Bold")).getByTitle("Click to change"));
  fireEvent.keyDown(window, { key, code, metaKey: true, altKey: true, shiftKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
}

beforeEach(async () => {
  await flushMenuShortcutsSync();
  vi.clearAllMocks();
  invoke.mockResolvedValue(undefined);
  useShortcutsStore.setState({ customBindings: {} });
});

describe("native menu refusal", () => {
  it("toasts the refusal with the command's message", async () => {
    invoke.mockRejectedValueOnce({
      code: "invalid-input",
      message: "invalid accelerator for 'bold'",
    });
    render(<ShortcutsSettings />);
    rebindBoldTo("9", "Digit9");
    await flushMenuShortcutsSync();

    expect(toastError).toHaveBeenCalledTimes(1);
    const [title, options] = toastError.mock.calls[0];
    expect(title).toBe("The menu bar could not apply this shortcut");
    expect(options.description).toContain("invalid accelerator for 'bold'");
  });

  it("stays silent when the menu accepts the update", async () => {
    render(<ShortcutsSettings />);
    rebindBoldTo("8", "Digit8");
    await flushMenuShortcutsSync();
    expect(invoke).toHaveBeenCalledWith("update_menu_accelerators", expect.anything());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("stops listening once the pane unmounts", async () => {
    invoke.mockRejectedValueOnce(new Error("refused"));
    const { unmount } = render(<ShortcutsSettings />);
    unmount();
    useShortcutsStore.getState().setShortcut("bold", "Mod-k");
    await flushMenuShortcutsSync();
    expect(toastError).not.toHaveBeenCalled();
  });
});
