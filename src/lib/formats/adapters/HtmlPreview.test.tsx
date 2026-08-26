// Standalone HTML preview, both modes (issue #1273).
//
// The safe mode assertions are the REGRESSION half: nothing about adding
// trusted mode may weaken the default, so the sanitized path is pinned here
// alongside the new one.

import { render, screen, waitFor, cleanup } from "@testing-library/react";
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

  /// Audit finding #19. `<head\b[^>]*>` stops at the FIRST `>`, which a quoted
  /// attribute value may contain — HTML attribute serialization escapes `&` and
  /// `"` but NOT `>`, so DOMPurify hands one straight through. The regex then
  /// matched `<head title="a>` and spliced the meta INSIDE the attribute, so no
  /// CSP element existed at all and the sandboxed document ran with none.
  ///
  /// Asserted by PARSING the result rather than pattern-matching it: the
  /// property is "a real meta element exists in head", and a regex assertion is
  /// what let a regex bug hide here in the first place.
  it("injects a REAL CSP element when <head> has an attribute containing '>'", () => {
    renderPreview(
      '<!doctype html><html><head title="a>b"><title>t</title></head><body><p>x</p></body></html>',
    );
    const srcdoc = frame().getAttribute("srcdoc") ?? "";
    const parsed = new DOMParser().parseFromString(srcdoc, "text/html");
    const meta = parsed.head.querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(meta, "no CSP meta element in <head> — the sandbox has no policy").not.toBeNull();
    expect(meta?.getAttribute("content")).toContain("default-src 'none'");
  });

  it("keeps the CSP a real element for every document shape", () => {
    for (const html of [
      '<!doctype html><html><head lang="en"><title>t</title></head><body>x</body></html>',
      "<!doctype html><html><head><title>t</title></head><body>x</body></html>",
      "<p>no head at all</p>",
      '<html><head data-a="1>2" data-b=\'3>4\'><title>t</title></head><body>x</body></html>',
    ]) {
      renderPreview(html);
      const parsed = new DOMParser().parseFromString(
        frame().getAttribute("srcdoc") ?? "",
        "text/html",
      );
      expect(
        parsed.head.querySelector('meta[http-equiv="Content-Security-Policy"]'),
        `no CSP element for: ${html}`,
      ).not.toBeNull();
      cleanup();
    }
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

  /// The reported defect (#1328): close the tab and reopen it, or switch tabs
  /// away and back, and the component remounts. `ran` starts null again while
  /// the grant — held in a module-level store keyed by path — survives, so the
  /// frame reloads and re-executes whatever that token still holds. The old
  /// `ran !== null` guard made that render as "up to date", leaving the user
  /// looking at superseded output with no Reload prompt and no explanation.
  it("flags a trusted document as possibly-stale after a remount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPreview();
    await enable(user);
    expect(screen.queryByTestId("html-trust-stale")).not.toBeInTheDocument();

    unmount();
    renderPreview(); // same path, same content — the reopen

    expect(screen.getByTestId("html-trust-active")).toBeInTheDocument();
    expect(screen.getByTestId("html-trust-stale")).toBeInTheDocument();
  });

  /// The posture the maintainer chose: report honestly, change nothing about
  /// what executes. A remount must not publish anything on its own.
  it("does not publish anything of its own accord on remount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPreview();
    await enable(user);
    bridge.publishTrustedHtml.mockClear();

    unmount();
    renderPreview();

    expect(bridge.publishTrustedHtml).not.toHaveBeenCalled();
  });

  /// And the badge must be actionable, not just honest: Reload republishes the
  /// current source, after which the pane knows what is running again.
  it("clears the post-remount flag once the user presses Reload", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPreview();
    await enable(user);
    unmount();
    renderPreview();

    await user.click(screen.getByRole("button", { name: /reload/i }));

    await waitFor(() =>
      expect(screen.queryByTestId("html-trust-stale")).not.toBeInTheDocument(),
    );
    expect(bridge.publishTrustedHtml).toHaveBeenCalledWith(TOKEN, SCRIPTED);
  });

  /// Audit finding #32. `run()` writes `ran`/`runCount` when its async
  /// operation settles, with nothing tying that completion to the document it
  /// started on. A pane can render a DIFFERENT file without remounting, so an
  /// Enable that resolves after the switch marked the NEW document as running
  /// content it had never executed — and `stale` is computed from `ran`, so the
  /// new file then advertised itself as up to date.
  it("ignores a grant that completes after the pane moved to another file", async () => {
    const user = userEvent.setup();
    let release!: (token: string) => void;
    bridge.grantTrustedHtml.mockImplementation(
      (p: string) => new Promise<string>((resolve) => {
        release = (token) => { useHtmlTrustStore.getState().grant(p, token); resolve(token); };
      }),
    );

    const { rerender } = renderPreview();
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));

    // The pane moves on before the grant lands.
    const other = "/labs/other.html";
    rerender(<HtmlPreview content="<p>other</p>" liveContent="<p>other</p>" path={other} diagnostics={[]} />);
    release(TOKEN);
    await waitFor(() => expect(bridge.grantTrustedHtml).toHaveBeenCalled());

    // The completion belongs to the FIRST file. The second must not inherit it:
    // it is untrusted, and nothing here may say otherwise.
    expect(screen.queryByTestId("html-trust-active")).not.toBeInTheDocument();
    expect(frame().getAttribute("sandbox")).toBe("");
  });

  it("does not re-run another document's frame when a stale operation lands", async () => {
    // The concrete harm: `run()` bumps `runCount` on completion, and the
    // trusted frame's URL carries `?run=`. A completion belonging to a file the
    // pane has already left therefore forces a DIFFERENT, trusted document to
    // reload and re-execute — an execution nobody asked for, which is exactly
    // what "a trusted preview never re-runs itself" exists to prevent.
    const user = userEvent.setup();
    const other = "/labs/other.html";
    const otherToken = "b".repeat(64);
    let release!: () => void;
    bridge.grantTrustedHtml.mockImplementation(
      () => new Promise<string>((resolve) => { release = () => resolve(TOKEN); }),
    );

    const { rerender } = renderPreview();
    await user.click(screen.getByRole("button", { name: /trusted preview/i }));
    await user.click(screen.getByRole("button", { name: /enable scripts/i }));

    useHtmlTrustStore.getState().grant(other, otherToken);
    rerender(<HtmlPreview content="<p>other</p>" liveContent="<p>other</p>" path={other} diagnostics={[]} />);
    const before = frame().getAttribute("src");

    release();
    await waitFor(() => expect(bridge.grantTrustedHtml).toHaveBeenCalled());

    expect(frame().getAttribute("src")).toBe(before);
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

  /// UNKNOWN IS NOT CURRENT (issue #1328). `ran` describes the document the
  /// frame is running, and a path change clears it — so the pane genuinely does
  /// not know what the other file's token is serving. It was previously
  /// reported as up to date, which is a claim the component cannot support: the
  /// frame runs whatever was published for that token earlier in the session.
  /// The badge is worded "may not match the current source" precisely because
  /// this case is uncertainty rather than an observed change.
  it("flags a trusted file whose running content it cannot know", async () => {
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
    expect(screen.getByTestId("html-trust-stale")).toBeInTheDocument();
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
