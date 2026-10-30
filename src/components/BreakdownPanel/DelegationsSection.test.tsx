/**
 * DelegationsSection — live delegations and the grant/revoke acts: a grant is
 * recorded only after a confirmation naming principal, scope and expiry, the
 * day count is a strict 1–365 integer (7 by default), and revoke names the grant.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const ask = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...a: unknown[]) => ask(...a) }));

import { DelegationsSection } from "./DelegationsSection";
import { useBreakdownStore } from "@/stores/breakdownStore";

const DAY = 24 * 60 * 60 * 1000;
const delegateCalls = () => invoke.mock.calls.filter(([c]) => c === "coherence_delegate");
const principalBox = () => screen.getByRole("textbox", { name: "Agent principal (e.g. codex-cli)" });
const daysBox = () => screen.getByRole("textbox", { name: "Days" });
const grantButton = () => screen.getByRole("button", { name: "Grant" });

const NOW = Date.parse("2026-06-01T12:00:00Z");

beforeEach(() => {
  // Only Date is faked: the expiry is computed from the clock, while
  // userEvent and React still need real timers to settle.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  invoke.mockReset().mockResolvedValue([]);
  ask.mockReset().mockResolvedValue(true);
  useBreakdownStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DelegationsSection", () => {
  it("renders nothing without a workspace", () => {
    const { container } = render(<DelegationsSection workspaceRoot={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when there are no delegations, and defaults to 7 days", () => {
    render(<DelegationsSection workspaceRoot="/w" />);
    expect(screen.getByText(/No active delegations/)).toBeInTheDocument();
    expect(daysBox()).toHaveValue("7");
    expect(grantButton()).toBeDisabled(); // no principal yet
  });

  it("lists each delegation with its scope and expiry date", () => {
    useBreakdownStore.getState().setDelegations([
      { grant: "g1", delegate: "codex-cli", scope: ["resolve.accept-newer", "resolve.waive"], expires: "2026-11-06T10:00:00Z" },
    ]);
    render(<DelegationsSection workspaceRoot="/w" />);
    expect(screen.getByText("codex-cli")).toBeInTheDocument();
    expect(screen.getByText("resolve.accept-newer, resolve.waive")).toBeInTheDocument();
    expect(screen.getByText("until 2026-11-06")).toBeInTheDocument();
  });

  it("grants only after a confirmation naming principal, scope and expiry", async () => {
    const user = userEvent.setup();
    render(<DelegationsSection workspaceRoot="/w" />);
    await user.type(principalBox(), "  codex-cli  ");
    await user.click(grantButton());
    await act(async () => {});
    const message = ask.mock.calls[0][0] as string;
    expect(message).toContain("codex-cli");
    expect(message).toContain("resolve.accept-newer");
    const [[, args]] = delegateCalls();
    const { request } = args as { request: { delegate: string; scope: string[]; expires: string } };
    expect(request.delegate).toBe("codex-cli");
    expect(request.scope).toEqual(["resolve.accept-newer"]);
    expect(Date.parse(request.expires) - NOW).toBe(7 * DAY);
    expect(message).toContain(request.expires.slice(0, 10));
    expect(principalBox()).toHaveValue("");
  });

  it("records nothing when the confirmation is declined", async () => {
    ask.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<DelegationsSection workspaceRoot="/w" />);
    await user.type(principalBox(), "codex-cli");
    await user.click(grantButton());
    await act(async () => {});
    expect(ask).toHaveBeenCalledTimes(1);
    expect(delegateCalls()).toHaveLength(0);
  });

  it.each([["7days"], ["0"], ["366"], ["-1"], [""]])("refuses a day count of %j without asking", async (days) => {
    const user = userEvent.setup();
    render(<DelegationsSection workspaceRoot="/w" />);
    await user.type(principalBox(), "codex-cli");
    await user.clear(daysBox());
    if (days) await user.type(daysBox(), days);
    await user.click(grantButton());
    await act(async () => {});
    expect(ask).not.toHaveBeenCalled();
    expect(delegateCalls()).toHaveLength(0);
  });

  it("cannot grant an empty scope", async () => {
    const user = userEvent.setup();
    render(<DelegationsSection workspaceRoot="/w" />);
    await user.type(principalBox(), "codex-cli");
    await user.click(screen.getByRole("checkbox", { name: "Accept newer" }));
    expect(grantButton()).toBeDisabled();
  });

  it("Revoke names the grant, with an empty scope", async () => {
    useBreakdownStore.getState().setDelegations([
      { grant: "g1", delegate: "codex-cli", scope: ["resolve.waive"], expires: "2026-11-06T10:00:00Z" },
    ]);
    const user = userEvent.setup();
    render(<DelegationsSection workspaceRoot="/w" />);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await act(async () => {});
    const [[, args]] = delegateCalls();
    expect(args).toMatchObject({ workspaceRoot: "/w", request: { delegate: "codex-cli", scope: [], revoke: "g1" } });
    expect(ask).not.toHaveBeenCalled();
  });
});
