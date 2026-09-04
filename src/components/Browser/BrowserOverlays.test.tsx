// WI-S0.9 / WI-SOC.1b — BrowserOverlays: everything that stands in for the native page.
//
// All four are opaque and fill the rect, because each one replaces a native view that is
// either absent (create failed) or hidden (frozen). A translucent overlay here would
// show the blank hole where the page used to be.
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserOverlays } from "./BrowserOverlays";

const noop = () => {};
/** The healthy, visible page: every overlay input off. Tests override one at a time. */
const base = {
  frozen: false,
  error: null,
  crash: null,
  dialog: null,
  dialogError: null,
  popup: null,
  onRetry: noop,
  onCloseDialog: noop,
  onRecover: noop,
  onOpenPopup: noop,
  onDismissPopup: noop,
} as const;

describe("BrowserOverlays", () => {
  it("renders nothing when the page is healthy and visible", () => {
    const { container } = render(<BrowserOverlays {...base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("paints an opaque placeholder while the native view is frozen", () => {
    const { container } = render(<BrowserOverlays {...base} frozen />);
    expect(container.querySelector(".browser-frozen")).not.toBeNull();
  });

  it("shows a failure with its detail and retries on click", async () => {
    const onRetry = vi.fn();
    render(
      <BrowserOverlays
        {...base}
        error="A server with the specified hostname could not be found."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be found/i);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("a crash overlay wins over an error — the process died, which is the bigger fact", () => {
    render(<BrowserOverlays {...base} error="offline" crash={{ action: "manual" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/crashed/i);
    expect(screen.queryByText(/offline/)).toBeNull();
  });

  it("takes focus on OK while a dialog is shown and hands it back when the dialog closes (#161)", () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();
    const { rerender } = render(<BrowserOverlays {...base} dialog={{ kind: "alert", message: "Saved" }} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^ok$/i }));
    rerender(<BrowserOverlays {...base} dialog={null} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
    cleanup();
  });

  it("answers a confirm dialog", async () => {
    const onCloseDialog = vi.fn();
    render(
      <BrowserOverlays
        {...base}
        dialog={{ kind: "confirm", message: "Delete?", id: 3 }}
        onCloseDialog={onCloseDialog}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    expect(onCloseDialog).toHaveBeenCalledWith(true);
    cleanup();
  });

  // Audit 2026-09-03 round 3, #164 — a rejected browser_dialog_respond is shown INSIDE
  // the dialog, which stays up with both buttons live so the user can answer again.
  it("shows a failed answer as a live alert inside the dialog, with the driver's detail, and keeps the buttons live", async () => {
    const onCloseDialog = vi.fn();
    render(
      <BrowserOverlays
        {...base}
        dialog={{ kind: "confirm", message: "Delete?", id: 3 }}
        dialogError="the dialog is no longer pending"
        onCloseDialog={onCloseDialog}
      />,
    );
    const dlg = screen.getByRole("alertdialog");
    const alert = within(dlg).getByRole("alert");
    expect(alert).toHaveTextContent(/couldn't deliver your answer/i);
    expect(alert).toHaveTextContent("the dialog is no longer pending");
    await userEvent.click(within(dlg).getByRole("button", { name: /^ok$/i }));
    expect(onCloseDialog).toHaveBeenCalledWith(true);
    await userEvent.click(within(dlg).getByRole("button", { name: /cancel/i }));
    expect(onCloseDialog).toHaveBeenCalledWith(false);
    cleanup();
  });

  it("paints no error line while the dialog has not failed", () => {
    render(<BrowserOverlays {...base} dialog={{ kind: "confirm", message: "Delete?", id: 3 }} />);
    expect(within(screen.getByRole("alertdialog")).queryByRole("alert")).toBeNull();
    cleanup();
  });
});

// Audit 2026-09-03 X-03 — a blocked popup is offered, not discarded.
describe("BrowserOverlays — blocked popup notice", () => {
  it("names the redacted URL and offers to open it in a new tab or dismiss it", async () => {
    const open = vi.fn();
    const dismiss = vi.fn();
    render(
      <BrowserOverlays
        {...base}
        popup={{ url: "https://auth.example/login?state=SECRET#frag", at: 1 }}
        onOpenPopup={open}
        onDismissPopup={dismiss}
      />,
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("https://auth.example/login");
    expect(notice).not.toHaveTextContent("SECRET");
    await userEvent.click(screen.getByRole("button", { name: /open in new tab/i }));
    expect(open).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(dismiss).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
