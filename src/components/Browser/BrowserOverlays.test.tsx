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
        onRetry={noop}
        onCloseDialog={noop}
        onRecover={noop}
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
        onRetry={noop}
        onCloseDialog={noop}
        onRecover={noop}
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
        onRetry={onRetry}
        onCloseDialog={noop}
        onRecover={noop}
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
        onRetry={noop}
        onCloseDialog={noop}
        onRecover={noop}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/crashed/i);
    expect(screen.queryByText(/offline/)).toBeNull();
  });

  it("answers a confirm dialog", async () => {
    const onCloseDialog = vi.fn();
    render(
      <BrowserOverlays
        frozen={false}
        error={null}
        crash={null}
        dialog={{ kind: "confirm", message: "Delete?", id: 3 }}
        onRetry={noop}
        onCloseDialog={onCloseDialog}
        onRecover={noop}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    expect(onCloseDialog).toHaveBeenCalledWith(true);
    cleanup();
  });
});
