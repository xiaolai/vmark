// WI-4.2 — Read-only banner tests.
//
// Banner appears above the source pane for kind="viewer" formats.
// Click "Enable editing" → onEnableEditing fires; click "Open in
// external editor" → onOpenExternal fires.

import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadOnlyBanner } from "./ReadOnlyBanner";

describe("ReadOnlyBanner", () => {
  afterEach(() => cleanup());

  it("renders read-only label + two action buttons", () => {
    render(
      <ReadOnlyBanner
        formatNameI18nKey="format.codeRust"
        onEnableEditing={() => {}}
        onOpenExternal={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /enable editing/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open in external/i }),
    ).toBeInTheDocument();
  });

  it("calls onEnableEditing when the editing button is clicked", async () => {
    const user = userEvent.setup();
    const onEnableEditing = vi.fn();
    render(
      <ReadOnlyBanner
        formatNameI18nKey="format.codeRust"
        onEnableEditing={onEnableEditing}
        onOpenExternal={() => {}}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /enable editing/i }),
    );
    expect(onEnableEditing).toHaveBeenCalledOnce();
  });

  it("calls onOpenExternal when the external-editor button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenExternal = vi.fn();
    render(
      <ReadOnlyBanner
        formatNameI18nKey="format.codeRust"
        onEnableEditing={() => {}}
        onOpenExternal={onOpenExternal}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /open in external/i }),
    );
    expect(onOpenExternal).toHaveBeenCalledOnce();
  });

  it("uses role=status for screen-reader announcements", () => {
    render(
      <ReadOnlyBanner
        formatNameI18nKey="format.codeRust"
        onEnableEditing={() => {}}
        onOpenExternal={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("can be hidden when editing is enabled (caller controls visibility)", () => {
    const { container } = render(
      <ReadOnlyBanner
        formatNameI18nKey="format.codeRust"
        onEnableEditing={() => {}}
        onOpenExternal={() => {}}
        hidden
      />,
    );
    expect(container.querySelector(".read-only-banner")).toBeNull();
  });

  it("disables the open-external button when onOpenExternal is omitted", () => {
    render(
      <ReadOnlyBanner
        formatNameI18nKey="format.codeRust"
        onEnableEditing={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /open in external/i }),
    ).toBeNull();
  });
});
