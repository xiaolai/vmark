// WI-P6.4/P6.5 — the saved-sessions + named-profiles management list.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { BrowserSessionsList } from "./BrowserSessionsList";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  useBrowserSessionStore.setState({ sessions: [], profiles: [] });
});

describe("BrowserSessionsList", () => {
  it("shows an empty state when nothing is saved", () => {
    render(<BrowserSessionsList />);
    expect(screen.getByText(/no saved session/i)).toBeInTheDocument();
  });

  it("lists a saved session with its value-free summary", () => {
    useBrowserSessionStore.getState().recordSession("work_login", "2 cookie(s), 1 origin(s)", 1);
    render(<BrowserSessionsList />);
    expect(screen.getByText("work_login")).toBeInTheDocument();
    expect(screen.getByText(/2 cookie/)).toBeInTheDocument();
  });

  it("forgetting a session clears the keychain entry AND the registry row", async () => {
    const user = userEvent.setup();
    useBrowserSessionStore.getState().recordSession("work_login", "x", 1);
    render(<BrowserSessionsList />);
    await user.click(screen.getByRole("button", { name: /forget saved session work_login/i }));
    expect(invoke).toHaveBeenCalledWith("browser_forget_storage_state", { handle: "work_login" });
    // Row drops only after the native clear resolves.
    await waitFor(() => expect(useBrowserSessionStore.getState().sessions).toEqual([]));
  });

  it("removing a profile revokes its on-disk store AND the registry row", async () => {
    const user = userEvent.setup();
    useBrowserSessionStore.getState().recordProfileUse("work", 1);
    render(<BrowserSessionsList />);
    await user.click(screen.getByRole("button", { name: /remove profile work/i }));
    // The fix: removal must actually revoke the login, not just the metadata.
    expect(invoke).toHaveBeenCalledWith("browser_forget_profile", { profile: "work" });
    await waitFor(() => expect(useBrowserSessionStore.getState().profiles).toEqual([]));
  });

  it("keeps the profile row and warns when the native revocation FAILS", async () => {
    // Re-verify WI-P6.1 Removal: the UI must never claim a login is gone while it
    // survives on disk. A rejected `browser_forget_profile` leaves the row and alerts.
    invoke.mockRejectedValueOnce(new Error("PROFILE_STORE_LIMIT"));
    const user = userEvent.setup();
    useBrowserSessionStore.getState().recordProfileUse("work", 1);
    render(<BrowserSessionsList />);
    await user.click(screen.getByRole("button", { name: /remove profile work/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't remove/i);
    // The row is still there — the login was NOT confirmed gone.
    expect(useBrowserSessionStore.getState().profiles.map((p) => p.name)).toEqual(["work"]);
  });

  it("keeps the session row and warns when the native clear FAILS", async () => {
    invoke.mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();
    useBrowserSessionStore.getState().recordSession("work_login", "x", 1);
    render(<BrowserSessionsList />);
    await user.click(screen.getByRole("button", { name: /forget saved session work_login/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't forget/i);
    expect(useBrowserSessionStore.getState().sessions.map((s) => s.handle)).toEqual(["work_login"]);
  });
});
