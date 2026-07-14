// WI-S0.8 — BrowserGrantsList: see and revoke the standing permissions the AI holds.
//
// A permission model without revocation is not a permission model. "Allow on this
// site" mints standing authority for an origin, and until now there was no surface
// that showed what had been granted, let alone took it back.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BrowserGrantsList } from "./BrowserGrantsList";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";

beforeEach(() => {
  cleanup();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [] });
  vi.clearAllMocks();
});

describe("BrowserGrantsList", () => {
  it("says so plainly when nothing has been granted", () => {
    render(<BrowserGrantsList />);
    expect(screen.getByText(/no site has been given permission/i)).toBeInTheDocument();
  });

  it("lists each granted origin with the operations it covers", () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click", "type"]);
    render(<BrowserGrantsList />);
    expect(screen.getByText("https://blog.example.com")).toBeInTheDocument();
    const row = screen.getByText("https://blog.example.com").closest("li");
    expect(row).toHaveTextContent(/click/i);
    expect(row).toHaveTextContent(/type/i);
  });

  it("revokes an origin, and the AI is denied there again", async () => {
    const s = useBrowserApprovalStore.getState();
    s.grant("https://blog.example.com", ["click"]);
    expect(s.decide("https://blog.example.com/post", "click")).toBe("allowed");

    render(<BrowserGrantsList />);
    await userEvent.click(screen.getByRole("button", { name: /revoke/i }));

    const after = useBrowserApprovalStore.getState();
    expect(after.grants).toHaveLength(0);
    expect(after.decide("https://blog.example.com/post", "click")).toBe("needs-approval");
  });

  it("revokes only the origin asked for", async () => {
    const s = useBrowserApprovalStore.getState();
    s.grant("https://a.example.com", ["click"]);
    s.grant("https://b.example.com", ["click"]);

    render(<BrowserGrantsList />);
    await userEvent.click(
      screen.getByRole("button", { name: /revoke permissions for https:\/\/a\.example\.com/i }),
    );

    const after = useBrowserApprovalStore.getState();
    expect(after.grants).toHaveLength(1);
    expect(after.decide("https://b.example.com/x", "click")).toBe("allowed");
    expect(after.decide("https://a.example.com/x", "click")).toBe("needs-approval");
  });
});
