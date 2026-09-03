// WI-S0.9 / WI-SOC.1b — BrowserOverlays: everything that stands in for the native page.
//
// All four are opaque and fill the rect, because each one replaces a native view that is
// either absent (create failed) or hidden (frozen). A translucent overlay here would
// show the blank hole where the page used to be.
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserOverlays } from "./BrowserOverlays";

const noop = () => {};

describe("BrowserOverlays", () => {
  it("renders nothing when the page is healthy and visible", () => {
    const { container } = render(
      <BrowserOverlays
        frozen={false}
        error={null}
        crash={null}
        dialog={null}
        popup={null}
        onRetry={noop}
        onCloseDialog={noop}
        onRecover={noop}
        onOpenPopup={noop}
        onDismissPopup={noop}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("paints an opaque placeholder while the native view is frozen", () => {
    const { container } = render(
      <BrowserOverlays
        frozen
        error={null}
        crash={null}
        dialog={null}
        popup={null}
        onRetry={noop}
        onCloseDialog={noop}
        onRecover={noop}
        onOpenPopup={noop}
        onDismissPopup={noop}
      />,
    );
    expect(container.querySelector(".browser-frozen")).not.toBeNull();
  });

  it("shows a failure with its detail and retries on click", async () => {
    const onRetry = vi.fn();
    render(
      <BrowserOverlays
        frozen={false}
        error="A server with the specified hostname could not be found."
        crash={null}
        dialog={null}
        popup={null}
        onRetry={onRetry}
        onCloseDialog={noop}
        onRecover={noop}
        onOpenPopup={noop}
        onDismissPopup={noop}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be found/i);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("a crash overlay wins over an error — the process died, which is the bigger fact", () => {
    render(
      <BrowserOverlays
        frozen={false}
        error="offline"
        crash={{ action: "manual" }}
        dialog={null}
        popup={null}
        onRetry={noop}
        onCloseDialog={noop}
        onRecover={noop}
        onOpenPopup={noop}
        onDismissPopup={noop}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/crashed/i);
    expect(screen.queryByText(/offline/)).toBeNull();
  });

  it("takes focus on OK while a dialog is shown and hands it back when the dialog closes (#161)", () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();
    const props = {
      frozen: false,
      error: null,
      crash: null,
      popup: null,
      onRetry: noop,
      onCloseDialog: noop,
      onRecover: noop,
      onOpenPopup: noop,
      onDismissPopup: noop,
    };
    const { rerender } = render(<BrowserOverlays {...props} dialog={{ kind: "alert", message: "Saved" }} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^ok$/i }));
    rerender(<BrowserOverlays {...props} dialog={null} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
    cleanup();
  });

  it("answers a confirm dialog", async () => {
    const onCloseDialog = vi.fn();
    render(
      <BrowserOverlays
        frozen={false}
        error={null}
        crash={null}
        dialog={{ kind: "confirm", message: "Delete?", id: 3 }}
        popup={null}
        onRetry={noop}
        onCloseDialog={onCloseDialog}
        onRecover={noop}
        onOpenPopup={noop}
        onDismissPopup={noop}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    expect(onCloseDialog).toHaveBeenCalledWith(true);
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
        frozen={false}
        error={null}
        crash={null}
        dialog={null}
        popup={{ url: "https://auth.example/login?state=SECRET#frag", at: 1 }}
        onRetry={noop}
        onCloseDialog={noop}
        onRecover={noop}
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
