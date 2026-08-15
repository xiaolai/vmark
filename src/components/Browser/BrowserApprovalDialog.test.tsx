// WI-S0.8 — BrowserApprovalDialog: the human half of the browser security model.
//
// The enforcement half (origin guard, standing grants, one-shots bound to
// tab+generation+origin+operation+target, R7a expiry) was built and audited. The
// CONSENT half was not: `requestApproval()` queued a request "for the UI to resolve"
// and the MCP bridge refused the AI's operation — but nothing ever rendered the queue
// or called `resolveApproval`. The AI `act` path was therefore permanent-deny and the
// human-in-the-loop model had no human in it. This is that human.
//
// Design note the tests encode: the dialog shows the DESCRIPTOR (origin, operation,
// element role+name) — never a picture of the page. The authorization is bound to
// exactly that tuple, and a hostile page controls its own pixels, so approving a
// rendering of the page would be strictly weaker than approving the descriptor the
// gate actually enforces. That is also why an opaque hide-only freeze is sufficient.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const occlusion = vi.hoisted(() => ({
  browserOcclusion: { addOccluder: vi.fn(), removeOccluder: vi.fn() },
  OCCLUDER: {
    crash: "crash-overlay",
    dialog: "page-dialog",
    approval: "approval-dialog",
    error: "error-overlay",
  },
}));
vi.mock("@/services/browser/browserOcclusion", () => occlusion);
// The dialog now freezes EVERY mounted browser (audit finding), which it does through the
// hook — a second browser pane must not be able to paint over the consent prompt.
vi.mock("@/hooks/useBrowserOccluder", async () => {
  const { useEffect } = await import("react");
  const { useBrowserUiStore } = await import("@/stores/browserUiStore");
  return {
    useBrowserOccluder: (active: boolean, id: string) => {
      useEffect(() => {
        if (!active) return;
        const tabs = Object.keys(useBrowserUiStore.getState().entries);
        for (const t of tabs) occlusion.browserOcclusion.addOccluder(t, id);
        return () => {
          for (const t of tabs) occlusion.browserOcclusion.removeOccluder(t, id);
        };
      }, [active, id]);
    },
  };
});

import { BrowserApprovalDialog } from "./BrowserApprovalDialog";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserUiStore } from "@/stores/browserUiStore";

const TAB = "tab-1";
const URL = "https://blog.example.com/wp-admin/post-new.php";
const TARGET = { role: "button", name: "Publish" };

// No default for `target`: passing `undefined` to a defaulted parameter substitutes
// the default back in, which silently gave the "read" case an element it should not
// have had. Explicit arguments only.
function raise(id: string, operation: string, target: typeof TARGET | undefined) {
  useBrowserApprovalStore.getState().requestApproval(id, URL, operation, target, TAB, 1);
}
/** The common case: a click on the Publish button. */
function raiseClick(id = "r1") {
  raise(id, "click", TARGET);
}

beforeEach(() => {
  cleanup();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useBrowserUiStore.setState({ entries: {} });
  occlusion.browserOcclusion.addOccluder.mockClear();
  occlusion.browserOcclusion.removeOccluder.mockClear();
});

describe("BrowserApprovalDialog", () => {
  it("renders nothing when no approval is pending", () => {
    const { container } = render(<BrowserApprovalDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the descriptor the gate enforces: origin, operation, and element", () => {
    raiseClick();
    render(<BrowserApprovalDialog />);
    const dlg = screen.getByRole("alertdialog");
    // The ORIGIN — not the full path, and not the page's own claim about itself.
    expect(dlg).toHaveTextContent("https://blog.example.com");
    expect(dlg).toHaveTextContent(/click/i);
    expect(dlg).toHaveTextContent("Publish");
  });

  it("freezes EVERY mounted browser while it is up — not just the tab being asked about", async () => {
    // Split view: a second browser pane. If it stays live it can paint over the consent
    // prompt and forge it. (Audit finding, High.)
    useBrowserUiStore.getState().ensureEntry(TAB, "https://a.com/");
    useBrowserUiStore.getState().ensureEntry("other-tab", "https://evil.com/");
    raiseClick();
    render(<BrowserApprovalDialog />);
    expect(occlusion.browserOcclusion.addOccluder).toHaveBeenCalledWith(TAB, "approval-dialog");
    expect(occlusion.browserOcclusion.addOccluder).toHaveBeenCalledWith(
      "other-tab",
      "approval-dialog",
    );

    await userEvent.click(screen.getByRole("button", { name: /deny/i }));
    await waitFor(() =>
      expect(occlusion.browserOcclusion.removeOccluder).toHaveBeenCalledWith(
        TAB,
        "approval-dialog",
      ),
    );
  });

  it("Allow once mints a single-use authorization", async () => {
    raiseClick();
    render(<BrowserApprovalDialog />);
    await userEvent.click(screen.getByRole("button", { name: /allow once/i }));

    const s = useBrowserApprovalStore.getState();
    expect(s.pending).toHaveLength(0);
    expect(s.oneShots).toHaveLength(1);
    expect(s.oneShots[0]).toMatchObject({ operation: "click", target: TARGET, tabId: TAB });
    // ...and it is NOT standing authority.
    expect(s.decide(URL, "click")).toBe("needs-approval");
  });

  it("Allow on this site creates a standing grant scoped to the origin", async () => {
    raiseClick();
    render(<BrowserApprovalDialog />);
    await userEvent.click(screen.getByRole("button", { name: /this site/i }));

    const s = useBrowserApprovalStore.getState();
    expect(s.pending).toHaveLength(0);
    expect(s.decide(URL, "click")).toBe("allowed");
    // Scoped: it must not widen to another operation.
    expect(s.decide(URL, "type")).toBe("needs-approval");
  });

  it("Deny authorizes nothing", async () => {
    raiseClick();
    render(<BrowserApprovalDialog />);
    await userEvent.click(screen.getByRole("button", { name: /deny/i }));

    const s = useBrowserApprovalStore.getState();
    expect(s.pending).toHaveLength(0);
    expect(s.oneShots).toHaveLength(0);
    expect(s.decide(URL, "click")).toBe("needs-approval");
  });

  it("Escape denies — the dialog fails closed", async () => {
    raiseClick();
    render(<BrowserApprovalDialog />);
    await userEvent.keyboard("{Escape}");

    const s = useBrowserApprovalStore.getState();
    expect(s.pending).toHaveLength(0);
    expect(s.oneShots).toHaveLength(0);
    expect(s.decide(URL, "click")).toBe("needs-approval");
  });

  it("focuses Deny, so a stray Enter cannot authorize an action", () => {
    raiseClick();
    render(<BrowserApprovalDialog />);
    expect(screen.getByRole("button", { name: /deny/i })).toHaveFocus();
  });

  it("describes a read, which targets the whole page rather than one element", () => {
    raise("r1", "read", undefined);
    render(<BrowserApprovalDialog />);
    const dlg = screen.getByRole("alertdialog");
    expect(dlg).toHaveTextContent(/read/i);
    // No element clause when there is no element.
    expect(dlg).not.toHaveTextContent("Publish");
  });

  it("shows one prompt at a time and advances to the next after resolving", async () => {
    raiseClick("r1");
    raise("r2", "type", { role: "textbox", name: "Title" });
    render(<BrowserApprovalDialog />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Publish");

    await userEvent.click(screen.getByRole("button", { name: /deny/i }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent("Title"));
  });
});

/** Raise a request that carries a payload script (style/eval) or handle (session). */
function raisePayload(id: string, operation: string, script: string) {
  useBrowserApprovalStore
    .getState()
    .requestApproval(id, URL, operation, undefined, TAB, 1, script);
}

describe("BrowserApprovalDialog — audit 20260815-163607", () => {
  // #21. `style` injects author CSS chosen by the AI and the store records the
  // exact script for it, but the dialog's hardcoded ["eval","session"] set left
  // it out — so the user authorised CSS they were never shown.
  it("shows the exact payload for a style request", () => {
    raisePayload("s1", "style", "body { display: none }");
    render(<BrowserApprovalDialog />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("body { display: none }");
  });

  it("still shows the exact payload for an eval request", () => {
    raisePayload("e1", "eval", "fetch('/drain')");
    render(<BrowserApprovalDialog />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("fetch('/drain')");
  });

  // #21, second half: a session payload is a saved-session NAME, not a script,
  // and labelling it "Script" misdescribes what is being approved.
  it("does not label a session handle as a script", () => {
    raisePayload("n1", "session", "my-logged-in-session");
    render(<BrowserApprovalDialog />);
    const dlg = screen.getByRole("alertdialog");
    expect(dlg).toHaveTextContent("my-logged-in-session");
    expect(dlg.querySelector("pre")).toBeNull();
  });

  // #22. Focus started on Deny but nothing kept it inside: Tab could reach
  // background UI while a security prompt was still open.
  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    const outside = document.createElement("button");
    outside.textContent = "background";
    document.body.appendChild(outside);
    raiseClick();
    render(<BrowserApprovalDialog />);

    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(screen.getByRole("alertdialog").contains(document.activeElement)).toBe(true);
    }
    outside.remove();
  });

  it("restores focus to the previously focused element on close", async () => {
    const user = userEvent.setup();
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();
    raiseClick();
    render(<BrowserApprovalDialog />);
    await user.click(screen.getByRole("button", { name: /deny/i }));
    await waitFor(() => expect(document.activeElement).toBe(before));
    before.remove();
  });

  // #23. A security prompt must be the EXCLUSIVE Escape handler while raised —
  // a shared Escape resolves two decisions from one keystroke.
  it("does not let Escape reach another overlay's listener", async () => {
    const user = userEvent.setup();
    const other = vi.fn();
    window.addEventListener("keydown", other);
    raiseClick();
    render(<BrowserApprovalDialog />);
    await user.keyboard("{Escape}");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    expect(other, "sibling overlay must not also see Escape").not.toHaveBeenCalled();
    window.removeEventListener("keydown", other);
  });
});
