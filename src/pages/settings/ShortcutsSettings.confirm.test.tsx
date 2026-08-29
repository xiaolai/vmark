// Audit 20260829 (WI-UI4.1 follow-up) — the async reset-all gate at the SITE:
// both branches, so a dropped or inverted `if (confirmed)` cannot survive the
// funnel's own unit tests.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const confirmActionMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/dialogs/confirmAction", () => ({
  confirmAction: confirmActionMock,
}));

import { ShortcutsSettings } from "./ShortcutsSettings";
import { useShortcutsStore } from "@/stores/settingsStore";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reset-all confirmation gate", () => {
  it("resets only when confirmAction resolves true", async () => {
    const spy = vi.spyOn(useShortcutsStore.getState(), "resetAllShortcuts");
    confirmActionMock.mockResolvedValue(true);
    render(<ShortcutsSettings />);
    fireEvent.click(screen.getByText("Reset All"));
    await vi.waitFor(() => expect(confirmActionMock).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
  });

  it("does nothing when confirmAction resolves false", async () => {
    const spy = vi.spyOn(useShortcutsStore.getState(), "resetAllShortcuts");
    confirmActionMock.mockResolvedValue(false);
    render(<ShortcutsSettings />);
    fireEvent.click(screen.getByText("Reset All"));
    await vi.waitFor(() => expect(confirmActionMock).toHaveBeenCalledOnce());
    expect(spy).not.toHaveBeenCalled();
  });
});
