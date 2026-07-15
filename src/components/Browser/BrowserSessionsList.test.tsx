// WI-P6.4/P6.5 — the saved-sessions + named-profiles management list.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(useBrowserSessionStore.getState().sessions).toEqual([]);
  });

  it("removing a profile revokes its on-disk store AND the registry row", async () => {
    const user = userEvent.setup();
    useBrowserSessionStore.getState().recordProfileUse("work", 1);
    render(<BrowserSessionsList />);
    await user.click(screen.getByRole("button", { name: /remove profile work/i }));
    // The Medium fix: removal must actually revoke the login, not just the metadata.
    expect(invoke).toHaveBeenCalledWith("browser_forget_profile", { profile: "work" });
    expect(useBrowserSessionStore.getState().profiles).toEqual([]);
  });
});
