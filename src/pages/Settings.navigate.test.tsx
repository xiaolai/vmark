// Section jumps into an open Settings window (#1716).
//
// Help → Keyboard Shortcuts, About, the status bar and the update toast open
// Settings at a section; when the window already exists Rust emits
// `settings:navigate`. An active search used to keep its stacked results on
// screen, and Shortcuts is not among the searchable panels, so the requested
// pane never appeared. A jump now clears the search, as a nav click does.
//
// Renders the real page; the event bridge is a capturing stand-in.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const handlers = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: (event: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return Promise.resolve(() => handlers.delete(name));
  }),
  emit: vi.fn(() => Promise.resolve()),
}));

import { SettingsPage } from "./Settings";
import { useSettingsStore } from "@/stores/settingsStore";

const activeNavLabel = () =>
  screen.getAllByRole("button").find((b) => b.dataset.active === "true")?.textContent;

function navigate(section: string): void {
  const handler = handlers.get("settings:navigate");
  if (!handler) throw new Error("Settings is not listening for settings:navigate");
  act(() => handler({ payload: section }));
}

beforeEach(() => {
  handlers.clear();
  useSettingsStore.getState().resetSettings();
  window.history.replaceState(null, "", "/?section=editor");
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("SettingsPage — section jumps", () => {
  it("moves to the requested section", async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(handlers.has("settings:navigate")).toBe(true));

    navigate("shortcuts");

    expect(activeNavLabel()).toBe("Shortcuts");
    expect(await screen.findByPlaceholderText("Search shortcuts…")).toBeInTheDocument();
  });

  it("clears an active search so the requested section is what shows", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => expect(handlers.has("settings:navigate")).toBe(true));
    const search = screen.getByRole("searchbox");
    await user.type(search, "font");
    expect(activeNavLabel()).toBeUndefined();

    navigate("shortcuts");

    expect(search).toHaveValue("");
    expect(activeNavLabel()).toBe("Shortcuts");
    // The Shortcuts pane itself is on screen, not only its nav item.
    expect(await screen.findByPlaceholderText("Search shortcuts…")).toBeInTheDocument();
  });

  it("ignores an unknown section and keeps the search", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => expect(handlers.has("settings:navigate")).toBe(true));
    const search = screen.getByRole("searchbox");
    await user.type(search, "font");

    navigate("no-such-section");

    expect(search).toHaveValue("font");
  });
});
