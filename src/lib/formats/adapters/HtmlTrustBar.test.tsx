// Trust bar for the standalone HTML preview (issue #1273).
//
// The bar IS the security UI: it carries the explicit action that authorizes
// execution (requirement 2), the warning shown before it (3), the persistent
// indicator while it is live (3), and the revoke control (4).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HtmlTrustBar } from "./HtmlTrustBar";

function setup(props: Partial<React.ComponentProps<typeof HtmlTrustBar>> = {}) {
  const onEnable = vi.fn();
  const onRevoke = vi.fn();
  const onReload = vi.fn();
  render(
    <HtmlTrustBar
      documentKey="/labs/a.html"
      trusted={false}
      stale={false}
      canTrust
      error={null}
      onEnable={onEnable}
      onRevoke={onRevoke}
      onReload={onReload}
      {...props}
    />,
  );
  return { onEnable, onRevoke, onReload };
}

describe("untrusted state", () => {
  it("offers an explicit action to enable trusted preview", () => {
    setup();
    expect(screen.getByRole("button", { name: /trusted preview/i })).toBeInTheDocument();
  });

  it("does not enable on the first click — it asks first", async () => {
    const user = userEvent.setup();
    const { onEnable } = setup();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));

    expect(onEnable).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("enables only after the confirmation is accepted", async () => {
    const user = userEvent.setup();
    const { onEnable } = setup();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));

    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it("cancelling the confirmation leaves trust off", async () => {
    const user = userEvent.setup();
    const { onEnable } = setup();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onEnable).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns before enabling, naming what will happen", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/script/i);
  });

  /// Requirement 4: an unsaved document has no identity a grant can attach to,
  /// so the action is unavailable rather than failing after the fact.
  it("cannot be enabled for an unsaved document", () => {
    setup({ canTrust: false });
    expect(screen.getByRole("button", { name: /trusted preview/i })).toBeDisabled();
  });

  it("shows no trusted indicator", () => {
    setup();
    expect(screen.queryByTestId("html-trust-active")).not.toBeInTheDocument();
  });
});

describe("trusted state", () => {
  it("shows a persistent scripts-enabled indicator", () => {
    setup({ trusted: true });
    const badge = screen.getByTestId("html-trust-active");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/script/i);
  });

  it("offers revoke at all times while active", async () => {
    const user = userEvent.setup();
    const { onRevoke } = setup({ trusted: true });

    await user.click(screen.getByRole("button", { name: /revoke/i }));

    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it("revoking takes one click — no confirmation stands between the user and off", async () => {
    const user = userEvent.setup();
    const { onRevoke } = setup({ trusted: true });
    await user.click(screen.getByRole("button", { name: /revoke/i }));
    expect(onRevoke).toHaveBeenCalled();
  });

  /// Reload is not gated on staleness: re-running is a normal action, and a
  /// stale-only button would be unreachable for a file trusted earlier in the
  /// session, whose running content the pane cannot know.
  it("offers reload even when the preview matches the source", () => {
    setup({ trusted: true, stale: false });
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });

  it("offers reload once the source has changed", async () => {
    const user = userEvent.setup();
    const { onReload } = setup({ trusted: true, stale: true });

    await user.click(screen.getByRole("button", { name: /reload/i }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("says the preview is out of date when stale", () => {
    setup({ trusted: true, stale: true });
    expect(screen.getByTestId("html-trust-stale")).toBeInTheDocument();
  });

  it("no longer offers the enable action", () => {
    setup({ trusted: true });
    expect(
      screen.queryByRole("button", { name: /enable trusted preview/i }),
    ).not.toBeInTheDocument();
  });
});

describe("trust transitions", () => {
  /// Revoking while a confirmation is open must not drop the user back onto
  /// an "Enable scripts" prompt they never re-opened.
  it("closes an open confirmation when trust changes", async () => {
    const user = userEvent.setup();
    const onEnable = vi.fn();
    const { rerender } = render(
      <HtmlTrustBar
        documentKey="/labs/a.html"
        trusted={false}
        stale={false}
        canTrust
        error={null}
        onEnable={onEnable}
        onRevoke={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Granted elsewhere, then revoked — back to the untrusted bar.
    rerender(
      <HtmlTrustBar
        documentKey="/labs/a.html"
        trusted
        stale={false}
        canTrust
        error={null}
        onEnable={onEnable}
        onRevoke={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    rerender(
      <HtmlTrustBar
        documentKey="/labs/a.html"
        trusted={false}
        stale={false}
        canTrust
        error={null}
        onEnable={onEnable}
        onRevoke={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enable trusted preview/i }),
    ).toBeInTheDocument();
  });

  /// The confirmation belongs to ONE document. Left open across a file switch
  /// it authorized whichever file the pane had moved on to — and for an unsaved
  /// one it slipped past `canTrust`, which only guards the button that opens it.
  it("closes an open confirmation when the document changes", async () => {
    const user = userEvent.setup();
    const onEnable = vi.fn();
    const props = {
      trusted: false as const,
      stale: false,
      canTrust: true,
      error: null,
      onEnable,
      onRevoke: vi.fn(),
      onReload: vi.fn(),
    };
    const { rerender } = render(<HtmlTrustBar documentKey="/labs/a.html" {...props} />);

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<HtmlTrustBar documentKey="/labs/b.html" {...props} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onEnable).not.toHaveBeenCalled();
  });

  it("cannot confirm for a document that became unsaved mid-prompt", async () => {
    const user = userEvent.setup();
    const onEnable = vi.fn();
    const props = {
      documentKey: "/labs/a.html",
      trusted: false as const,
      stale: false,
      error: null,
      onEnable,
      onRevoke: vi.fn(),
      onReload: vi.fn(),
    };
    const { rerender } = render(<HtmlTrustBar {...props} canTrust />);
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));

    rerender(<HtmlTrustBar {...props} canTrust={false} />);

    const confirm = screen.queryByRole("button", { name: /enable scripts/i });
    if (confirm) {
      expect(confirm).toBeDisabled();
      await user.click(confirm);
    }
    expect(onEnable).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it("surfaces a failure to enable", () => {
    setup({ error: "content too large" });
    expect(screen.getByRole("alert").textContent).toMatch(/content too large/);
  });

  /// A failed Reload set `error`, but only the untrusted branch rendered it —
  /// so a rejected publish was silent and left stale content on screen.
  it("surfaces a failure while trusted", () => {
    setup({ trusted: true, error: "bridge down" });
    expect(screen.getByRole("alert").textContent).toMatch(/bridge down/);
  });
});
