// Standalone HTML preview, both modes (issue #1273).
//
// The safe mode assertions are the REGRESSION half: nothing about adding
// trusted mode may weaken the default, so the sanitized path is pinned here
// alongside the new one.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  grantTrustedHtml: vi.fn(),
  publishTrustedHtml: vi.fn(),
  revokeTrustedHtml: vi.fn(),
}));
vi.mock("@/services/trustedHtml/trustedHtmlBridge", () => bridge);

import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import { HtmlPreview } from "./HtmlPreview";

const TOKEN = "a".repeat(64);
const PATH = "/labs/thermometer.html";
const SCRIPTED = `<!doctype html><html><body><button id="b">go</button>
<script>document.getElementById("b").textContent = "ran";</script></body></html>`;

function renderPreview(content = SCRIPTED, path: string | null = PATH) {
  return render(
    <HtmlPreview content={content} liveContent={content} path={path} diagnostics={[]} />,
  );
}

const frame = () => document.querySelector("iframe") as HTMLIFrameElement;

beforeEach(() => {
  useHtmlTrustStore.getState().clearAll();
  bridge.grantTrustedHtml.mockReset();
  bridge.publishTrustedHtml.mockReset();
  bridge.revokeTrustedHtml.mockReset();
  bridge.grantTrustedHtml.mockImplementation(async (p: string) => {
    useHtmlTrustStore.getState().grant(p, TOKEN);
    return TOKEN;
  });
  bridge.revokeTrustedHtml.mockImplementation(async (p: string) => {
    useHtmlTrustStore.getState().revoke(p);
  });
});

describe("safe mode (the default)", () => {
  it("renders an iframe with an empty sandbox", () => {
    renderPreview();
    expect(frame().getAttribute("sandbox")).toBe("");
  });

  it("strips script tags before rendering", () => {
    renderPreview();
    expect(frame().getAttribute("srcdoc")).not.toContain("<script");
  });

  it("injects a default-src 'none' CSP", () => {
    renderPreview();
    expect(frame().getAttribute("srcdoc")).toContain("default-src 'none'");
  });

  /// The injector used to match `<head` plus one delimiter, so an attributed
  /// head became `<head <meta …>lang="en">` — malformed, with the CSP possibly
  /// not applying. On the default path, that is the dangerous direction.
  it("injects the CSP after an attributed <head> without corrupting it", () => {
    renderPreview(
      '<!doctype html><html><head lang="en"><title>t</title></head><body><p>x</p></body></html>',
    );
    const srcdoc = frame().getAttribute("srcdoc") ?? "";
    expect(srcdoc).not.toContain("<head <meta");
    expect(srcdoc).toMatch(/<head\b[^>]*>\s*<meta http-equiv="Content-Security-Policy"/i);
  });

  it("still injects the CSP for a bare <head>", () => {
    renderPreview("<!doctype html><html><head><title>t</title></head><body>x</body></html>");
    expect(frame().getAttribute("srcdoc")).toMatch(
      /<head>\s*<meta http-equiv="Content-Security-Policy"/i,
    );
  });

  it("does not load anything from the trusted scheme", () => {
    renderPreview();
    expect(frame().getAttribute("src")).toBeNull();
  });

  it("renders no frame for an empty document", () => {
    renderPreview("   ");
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByTestId("html-preview-empty")).toBeInTheDocument();
  });

  /// Requirement 10 — nothing about the file itself confers trust.
  it("is untrusted even for a .html path with no prior grant", () => {
    renderPreview();
    expect(screen.queryByTestId("html-trust-active")).not.toBeInTheDocument();
  });

  /// WI-3.4's notice predates this feature and is about the sandboxed path.
  /// Adding trusted mode must not quietly retire it.
  it("keeps the pending sign-off notice", () => {
    renderPreview();
    expect(screen.getByTestId("html-preview-sign-off-pending")).toBeInTheDocument();
  });
});

describe("enabling trusted mode", () => {
  it("requires the confirmation before granting", async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));

    expect(bridge.grantTrustedHtml).not.toHaveBeenCalled();
  });

  it("grants the CURRENT buffer, not the file on disk", async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));

    await waitFor(() =>
      expect(bridge.grantTrustedHtml).toHaveBeenCalledWith(PATH, SCRIPTED),
    );
  });

  it("switches the frame to the trusted origin with allow-scripts only", async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));

    await waitFor(() => expect(frame().getAttribute("sandbox")).toBe("allow-scripts"));
    expect(frame().getAttribute("src")).toContain(`vmark-trusted://doc/${TOKEN}`);
    expect(frame().getAttribute("srcdoc")).toBeNull();
  });

  it("delegates no powerful features to the trusted frame", async () => {
    const user = userEvent.setup();
    renderPreview();
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));

    await waitFor(() => expect(frame().getAttribute("allow")).toBe(""));
  });

  it("shows the persistent trusted indicator", async () => {
    const user = userEvent.setup();
    renderPreview();
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));

    expect(await screen.findByTestId("html-trust-active")).toBeInTheDocument();
  });

  it("retires the sandbox-specific sign-off notice once trusted", async () => {
    const user = userEvent.setup();
    renderPreview();
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));
    await screen.findByTestId("html-trust-active");

    expect(
      screen.queryByTestId("html-preview-sign-off-pending"),
    ).not.toBeInTheDocument();
  });

  it("cannot be enabled for an unsaved document", () => {
    renderPreview(SCRIPTED, null);
    expect(screen.getByRole("button", { name: /trusted preview/i })).toBeDisabled();
  });

  it("stays in safe mode when the grant fails", async () => {
    const user = userEvent.setup();
    bridge.grantTrustedHtml.mockRejectedValue({
      code: "invalid-input",
      message: "content too large",
    });
    renderPreview();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(frame().getAttribute("sandbox")).toBe("");
  });

  it("reports the failure using the typed error message", async () => {
    const user = userEvent.setup();
    bridge.grantTrustedHtml.mockRejectedValue({
      code: "invalid-input",
      message: "content too large",
    });
    renderPreview();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("content too large");
    expect(alert.textContent).not.toContain("[object Object]");
  });
});

describe("editing a trusted document", () => {
  async function enable(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));
    await screen.findByTestId("html-trust-active");
  }

  /// Re-running a document is an execution, so it waits for the user. This is
  /// also what stops a running simulation being reset on every keystroke.
  it("does not re-run automatically when the source changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreview();
    await enable(user);
    const before = frame().getAttribute("src");

    rerender(<HtmlPreview content={`${SCRIPTED}<p>edit</p>`} liveContent={`${SCRIPTED}<p>edit</p>`} path={PATH} diagnostics={[]} />);

    expect(frame().getAttribute("src")).toBe(before);
    expect(bridge.publishTrustedHtml).not.toHaveBeenCalled();
  });

  it("marks the preview stale once the source diverges", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreview();
    await enable(user);

    rerender(<HtmlPreview content={`${SCRIPTED}<p>edit</p>`} liveContent={`${SCRIPTED}<p>edit</p>`} path={PATH} diagnostics={[]} />);

    expect(screen.getByTestId("html-trust-stale")).toBeInTheDocument();
  });

  it("republishes and re-runs on Reload", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreview();
    await enable(user);
    const before = frame().getAttribute("src");
    const edited = `${SCRIPTED}<p>edit</p>`;

    rerender(<HtmlPreview content={edited} liveContent={edited} path={PATH} diagnostics={[]} />);
    await user.click(screen.getByRole("button", { name: /reload/i }));

    await waitFor(() =>
      expect(bridge.publishTrustedHtml).toHaveBeenCalledWith(TOKEN, edited),
    );
    expect(frame().getAttribute("src")).not.toBe(before);
    expect(frame().getAttribute("src")).toContain(TOKEN);
  });

  it("clears the stale marker after a reload", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreview();
    await enable(user);
    rerender(<HtmlPreview content={`${SCRIPTED}<p>edit</p>`} liveContent={`${SCRIPTED}<p>edit</p>`} path={PATH} diagnostics={[]} />);

    await user.click(screen.getByRole("button", { name: /reload/i }));

    await waitFor(() =>
      expect(screen.queryByTestId("html-trust-stale")).not.toBeInTheDocument(),
    );
  });
});

describe("audit regressions", () => {
  async function enable(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));
    await screen.findByTestId("html-trust-active");
  }

  /// Clearing the buffer used to return before the trust bar rendered, taking
  /// the only off switch away while the grant stayed live.
  it("keeps Revoke reachable when the document is emptied", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreview();
    await enable(user);

    rerender(<HtmlPreview content="   " liveContent="   " path={PATH} diagnostics={[]} />);

    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument();
    expect(screen.getByTestId("html-trust-active")).toBeInTheDocument();
  });

  /// Enable/Reload publish `liveContent`. Publishing the DEFERRED `content`
  /// meant editing and immediately acting could execute the previous document.
  it("publishes the live content, not the deferred render value", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreview();
    await enable(user);

    // Deferred render value lags one edit behind the authoritative content.
    rerender(
      <HtmlPreview content={SCRIPTED} liveContent="<p>typed just now</p>" path={PATH} diagnostics={[]} />,
    );
    await user.click(screen.getByRole("button", { name: /reload/i }));

    await waitFor(() =>
      expect(bridge.publishTrustedHtml).toHaveBeenCalledWith(TOKEN, "<p>typed just now</p>"),
    );
  });

  /// A second click before the first grant resolves used to mint a second
  /// backend grant; the store kept only the later token, orphaning the earlier
  /// one in a MAX_GRANTS slot nothing could free.
  it("grants once when Enable is double-clicked", async () => {
    const user = userEvent.setup();
    let release: (v: string) => void = () => {};
    bridge.grantTrustedHtml.mockImplementation(
      () => new Promise<string>((res) => { release = res; }),
    );
    renderPreview();

    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    const confirm = screen.getByRole("button", { name: /enable scripts/i });
    await user.click(confirm);

    expect(bridge.grantTrustedHtml).toHaveBeenCalledTimes(1);
    release(TOKEN);
  });
});

describe("revoking", () => {
  it("returns the frame to the sandboxed preview immediately", async () => {
    const user = userEvent.setup();
    renderPreview();
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));
    await screen.findByTestId("html-trust-active");

    await user.click(screen.getByRole("button", { name: /revoke/i }));

    await waitFor(() => expect(frame().getAttribute("sandbox")).toBe(""));
    expect(frame().getAttribute("src")).toBeNull();
    expect(bridge.revokeTrustedHtml).toHaveBeenCalledWith(PATH);
  });
});

describe("switching documents in the same pane", () => {
  /// Trust is keyed by path, so a second file rendered by the same component
  /// instance must not inherit the first one's grant.
  it("does not carry a grant across to another file", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreview();
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));
    await screen.findByTestId("html-trust-active");

    rerender(<HtmlPreview content={SCRIPTED} liveContent={SCRIPTED} path="/labs/other.html" diagnostics={[]} />);

    expect(screen.queryByTestId("html-trust-active")).not.toBeInTheDocument();
    expect(frame().getAttribute("sandbox")).toBe("");
  });

  /// `ran` describes the document the frame is running. Carried across a path
  /// change it reports a freshly-opened trusted file as stale against content
  /// it never ran.
  it("does not report a newly-opened trusted file as stale", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreview();
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));
    await screen.findByTestId("html-trust-active");

    // A second file, granted earlier in this session, rendered by the same pane.
    const other = "/labs/other.html";
    useHtmlTrustStore.getState().grant(other, "b".repeat(64));
    rerender(<HtmlPreview content="<p>different</p>" liveContent="<p>different</p>" path={other} diagnostics={[]} />);

    expect(screen.getByTestId("html-trust-active")).toBeInTheDocument();
    expect(screen.queryByTestId("html-trust-stale")).not.toBeInTheDocument();
  });

  it("can always re-run a file trusted earlier in the session", async () => {
    const other = "/labs/other.html";
    const otherToken = "b".repeat(64);
    useHtmlTrustStore.getState().grant(other, otherToken);
    const user = userEvent.setup();
    render(<HtmlPreview content="<p>lab</p>" liveContent="<p>lab</p>" path={other} diagnostics={[]} />);

    await user.click(screen.getByRole("button", { name: /reload/i }));

    await waitFor(() =>
      expect(bridge.publishTrustedHtml).toHaveBeenCalledWith(otherToken, "<p>lab</p>"),
    );
  });
});
