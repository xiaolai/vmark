/**
 * Origin isolation for the trusted HTML preview, in REAL WebKit (issue #1273).
 *
 * jsdom cannot answer any of this. It does not implement sandbox origin
 * semantics at all: a `sandbox="allow-scripts"` frame there is not opaque, and
 * `parent.document` is reachable — so a jsdom test asserting isolation would
 * pass against an implementation that has none. WKWebView is where the preview
 * actually runs, and Playwright's WebKit is the same engine family.
 *
 * What is pinned here, per issue #1273's acceptance criteria:
 *
 * - untrusted HTML never executes scripts (`sandbox=""`, the default preview);
 * - a trusted frame's document is opaque-origin and cannot read the embedder;
 * - it has no same-origin storage and cannot reach the embedder's globals.
 *
 * What is deliberately NOT here: the `vmark-trusted://` scheme itself, which
 * only exists inside the Tauri app, and the CSP-inheritance behaviour that
 * forced the scheme's existence — reproducing the latter needs a parent
 * document served with a real CSP header, which this tier's harness page is
 * not. Both are covered in `src-tauri/src/trusted_html/protocol.rs`.
 *
 * @coordinates-with ../htmlTrust.ts — TRUSTED_SANDBOX, the attribute under test
 * @coordinates-with ../HtmlPreview.tsx — mounts the two frames this mirrors
 * @module lib/formats/adapters/__tests__/trustedHtmlIsolation.webkit.test
 */
import { afterEach, describe, expect, it } from "vitest";
import { TRUSTED_SANDBOX } from "../htmlTrust";

interface Report {
  ran: true;
  origin: string;
  canReadParentDocument: boolean;
  canReadParentGlobals: boolean;
  hasLocalStorage: boolean;
  hasWebkitMessageHandlers: boolean;
  hasTauriInternals: boolean;
}

/** The probe a framed document runs and posts back to us. */
const PROBE = `
<!doctype html><html><body><p id="r">inert</p><script>
  function reach(fn) { try { return Boolean(fn()); } catch { return false; } }
  parent.postMessage({
    ran: true,
    origin: String(window.origin),
    canReadParentDocument: reach(function () { return window.parent.document; }),
    canReadParentGlobals: reach(function () { return window.parent.__VMARK_ISOLATION_CANARY__; }),
    hasLocalStorage: reach(function () { return window.localStorage; }),
    hasWebkitMessageHandlers: reach(function () { return window.webkit.messageHandlers; }),
    hasTauriInternals: reach(function () { return window.__TAURI_INTERNALS__; })
  }, "*");
</script></body></html>`;

const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  delete (window as unknown as Record<string, unknown>).__VMARK_ISOLATION_CANARY__;
});

/**
 * Mount a frame with `sandbox` and wait for the probe's report, or resolve
 * null if nothing arrives — which is what "the script was blocked" looks like.
 */
function mount(sandbox: string, timeoutMs = 1500): Promise<Report | null> {
  (window as unknown as Record<string, unknown>).__VMARK_ISOLATION_CANARY__ =
    "reachable";

  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", sandbox);
    frame.srcdoc = PROBE;
    frames.push(frame);

    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.data as Report);
    }

    window.addEventListener("message", onMessage);
    document.body.appendChild(frame);
  });
}

describe("the default preview never executes scripts", () => {
  it("blocks execution with an empty sandbox", async () => {
    expect(await mount("")).toBeNull();
  });
});

describe("a trusted frame is isolated from the app", () => {
  it("runs scripts", async () => {
    const report = await mount(TRUSTED_SANDBOX);
    expect(report?.ran).toBe(true);
  });

  /// The property the whole design rests on. `allow-scripts` without
  /// `allow-same-origin` yields an opaque origin, which is what makes every
  /// assertion below true rather than a matter of policy.
  it("has an opaque origin", async () => {
    const report = await mount(TRUSTED_SANDBOX);
    expect(report?.origin).toBe("null");
  });

  it("cannot read the embedder's document", async () => {
    const report = await mount(TRUSTED_SANDBOX);
    expect(report?.canReadParentDocument).toBe(false);
  });

  it("cannot read the embedder's globals", async () => {
    const report = await mount(TRUSTED_SANDBOX);
    expect(report?.canReadParentGlobals).toBe(false);
  });

  it("has no same-origin storage", async () => {
    const report = await mount(TRUSTED_SANDBOX);
    expect(report?.hasLocalStorage).toBe(false);
  });

  /// Belt-and-braces against the Tauri IPC surface. In the app these are also
  /// closed by the main-frame-only invoke bootstrap and the ACL; asserting
  /// them here means a future sandbox change that reopened them would fail a
  /// test rather than be noticed in review.
  it("reaches no Tauri IPC surface", async () => {
    const report = await mount(TRUSTED_SANDBOX);
    expect(report?.hasWebkitMessageHandlers).toBe(false);
    expect(report?.hasTauriInternals).toBe(false);
  });
});
