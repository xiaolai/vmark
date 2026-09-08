/**
 * Pure vocabulary for the trusted HTML preview (issue #1273).
 *
 * Purpose: the frame URL and the iframe's capability attributes, in one place,
 * with no store or Tauri import — so the security-relevant strings can be
 * asserted directly instead of inferred from a rendered component.
 *
 * The values here are half of a contract whose other half is Rust
 * (`src-tauri/src/trusted_html/protocol.rs`): the scheme must match what the
 * builder registers, and what the app CSP's `frame-src` allows.
 *
 * @module lib/formats/adapters/htmlTrust
 */

import { getRuntimePlatform, type RuntimePlatform } from "@/utils/platform";

/** The URI scheme registered by `trusted_html::protocol::SCHEME`. */
export const TRUSTED_SCHEME = "vmark-trusted";

/** Host segment on macOS and Linux. Carries no meaning — the token is the only
 *  selector. */
const TRUSTED_HOST = "doc";

/**
 * The origin a trusted document has on Windows (WI-FL6.5).
 *
 * WebView2 cannot register a URL scheme, so wry serves every custom protocol
 * over http at `http://<scheme>.<host>/…` and reverts that prefix to
 * `<scheme>://` before the handler sees the request (wry 0.55.1,
 * `custom_protocol_workaround.rs` — the same rule Tauri's own `convertFileSrc`
 * follows for `asset://`, and the reason the app CSP already lists
 * `asset.localhost`). By that convention the host is `localhost`, so this URL
 * reaches `protocol.rs` as `vmark-trusted://localhost/<token>` — a host the
 * handler has never cared about, which is why no Windows branch exists there.
 *
 * Derived from the scheme rather than written as a second literal: the
 * contract gate pins the scheme across Rust, TypeScript and the CSP, and
 * `htmlTrust.test.ts` pins that the CSP's `frame-src` names exactly this
 * origin. `http`, not `https`, because no window sets `useHttpsScheme` — that
 * test pins the assumption too, since flipping it would move this origin and
 * the CSP together.
 *
 * Confirmed by reading the vendored platform source, not by a Windows run:
 * the first release-smoke cycle on Windows is the run. Until this constant
 * existed the builder emitted only the scheme form and the CSP allowed only
 * that origin, so trusted preview could not load on Windows at all — and the
 * module said so rather than shipping a guessed URL, because a guessed origin
 * is exactly how `frame-ancestors 'self'` once disabled the whole feature.
 */
export const TRUSTED_WINDOWS_ORIGIN = `http://${TRUSTED_SCHEME}.localhost`;

/**
 * The sandbox allow-list for a trusted frame.
 *
 * `allow-scripts` ALONE. Combining it with `allow-same-origin` would let the
 * document reach the embedder's DOM and remove its own `sandbox` attribute,
 * which is the single mistake this whole design exists to avoid (requirement
 * 7). Everything in requirement 8 — top-level navigation, popups, form
 * submission, downloads, modals, pointer lock, presentation — is blocked by
 * being absent from this list, not by an explicit denial.
 *
 * Adding a token here is a security decision. `htmlTrust.test.ts` fails on any
 * change to this string, so it cannot happen as a drive-by.
 */
export const TRUSTED_SANDBOX = "allow-scripts";

/**
 * Permissions-Policy delegation for a trusted frame: none.
 *
 * An empty `allow` delegates no powerful feature, so camera, microphone,
 * geolocation, clipboard, display-capture and the rest stay unavailable inside
 * the frame even though scripts run (requirement 8).
 */
export const TRUSTED_ALLOW = "";

/**
 * The URL that serves a granted document on `platform` — pure, so every form
 * is a table row in `htmlTrust.test.ts`. macOS and Linux address the scheme
 * directly; Windows goes through the http origin above.
 *
 * The token is encoded as ONE path segment. A real token is 64 hex chars and
 * encodes to itself; the encoding exists so that nothing else can add a
 * segment, a query or a fragment to the URL the frame loads (audit 20260907).
 */
export function trustedFrameUrlFor(token: string, platform: RuntimePlatform): string {
  const segment = encodeURIComponent(token);
  if (platform === "windows") return `${TRUSTED_WINDOWS_ORIGIN}/${segment}`;
  return `${TRUSTED_SCHEME}://${TRUSTED_HOST}/${segment}`;
}

/** The URL that serves a granted document on the running platform. */
export function trustedFrameUrl(token: string): string {
  return trustedFrameUrlFor(token, getRuntimePlatform());
}
