// WI-AL3.2 — a comment action outlives the history popover: Resolve pressed from the keyboard, its reply held, Escape closes the popover and the history button reopens it; the reopened comments panel shows every thread control disabled and sends no second action while the first is under way, focus stays on the history button, and once the reply arrives the controls enable without moving focus and exactly one resolve was sent
import { describe, it, expect, vi, onTestFinished } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined), emit: vi.fn(async () => undefined) }));
vi.mock("@/services/agentJournal/docHistoryClient", () => ({
  listDocumentHistory: vi.fn(async () => ({ generation: "1", head: null, rows: [], truncated: false, hunks: [], blocked: [], degraded: false })),
}));
vi.mock("@/services/agentJournal/journalStatusClient", () => ({
  readJournalHealth: vi.fn(async () => ({ phase: "ready", generation: "1", readOnly: false, degraded: false, liveUpdates: "ready", identity: "durable", error: null, identityError: null, retention: null, uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0 })),
}));
vi.mock("@/services/agentJournal/checkpointClient", () => ({ listJournalCheckpoints: vi.fn(async () => []), forgetJournalCheckpoints: vi.fn(async () => 0) }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { invoke } from "@tauri-apps/api/core";
import { resolveKey } from "@/test/i18nResolve";
import { installWebKitFocusModel } from "@/test/webkitFocusModel";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { forgetCommentDrafts } from "@/components/Comments/commentDrafts";
import { McpHistoryButton } from "../McpHistoryButton";

const DOC = "0190d3c4-0000-7000-8000-0000000000d1";
const en = (key: string) => resolveKey(key, ["statusbar"]);
const THREAD = {
  comment: "c1",
  state: "open",
  commentGen: "2",
  revision: "0190d3c4-0000-7000-8000-000000000011",
  creationRetained: true,
  quote: "quote of c1",
  body: "body of c1",
  author: "",
  caller: "user",
  replies: [],
  anchor: { status: "resolved", tier: "context", start: 5, end: 10, byHint: true },
};

const trigger = () => screen.getAllByRole("button", { name: /MCP write history/i })[0];
const threadButtons = async () => within(await screen.findByRole("article", { name: "quote of c1" })).getAllByRole("button");
const resolves = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "comment_user_resolve").length;
async function press(el: HTMLElement): Promise<void> {
  act(() => el.focus());
  await userEvent.keyboard("{Enter}");
}

describe("a comment action across the history popover closing", () => {
  it("keeps the panel busy after a reopen, sends no second action, and enables the controls without moving focus when it ends", async () => {
    onTestFinished(installWebKitFocusModel());
    forgetCommentDrafts();
    let release: (() => void) | null = null;
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "comment_user_list") return { doc: DOC, generation: "3", threads: [THREAD] };
      if (command === "comment_user_resolve")
        return new Promise((resolve) => {
          release = () => resolve({ doc: DOC, comment: "c1", state: "resolved", generation: "4", commentGen: "3" });
        });
      return command === "agent_journal_uncommitted" ? [] : undefined;
    });
    useTabStore.setState({
      tabs: { main: [{ kind: "document", formatId: "markdown", id: "tab-1", filePath: "/a.md", title: "a", isPinned: false }] },
      activeTabId: { main: "tab-1" },
      untitledCounter: 0,
    });
    useDocumentStore.setState({ documents: {} });
    useDocumentStore.getState().initDocument("tab-1", "# T\n\nhello world\n", "/a.md");
    render(<McpHistoryButton />);

    await press(trigger());
    const resolve = within(await screen.findByRole("article", { name: "quote of c1" })).getByRole("button", { name: en("comments.resolve") });
    await press(resolve);
    await waitFor(() => expect(release).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await press(trigger());
    const controls = await threadButtons();
    for (const control of controls) expect(control).toBeDisabled();
    expect(document.activeElement).toBe(trigger());
    // A click that moves no focus: were the button enabled, it would start a second resolve.
    fireEvent.click(within(await screen.findByRole("article", { name: "quote of c1" })).getByRole("button", { name: en("comments.resolve") }));

    await act(async () => release?.());
    await waitFor(async () => {
      for (const control of await threadButtons()) expect(control).toBeEnabled();
    });
    expect(document.activeElement).toBe(trigger());
    expect(resolves()).toBe(1);
  });
});
