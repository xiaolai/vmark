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

/** The URI scheme registered by `trusted_html::protocol::SCHEME`. */
export const TRUSTED_SCHEME = "vmark-trusted";

/** Host segment. Carries no meaning — the token is the only selector. */
const TRUSTED_HOST = "doc";

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
 * The URL that serves a granted document.
 *
 * **KNOWN GAP — macOS/Linux only.** Tauri exposes a custom protocol as
 * `scheme://host/path` on macOS and Linux, but as `http://<scheme>.localhost/…`
 * on Windows and Android. This builder emits only the first form, and the app
 * CSP's `frame-src` allows only that origin, so trusted preview cannot work on
 * Windows as written.
 *
 * Not fixed here deliberately. The correct fix routes through Tauri's
 * platform-aware `convertFileSrc`, whose exact output shape this code cannot
 * confirm without a Windows build to run it in — and a guessed URL for a
 * security-relevant origin is precisely how `frame-ancestors 'self'` came to
 * ship and silently disable the whole feature. Verify on Windows, then change
 * this and `tauri.conf.json` together.
 */
export function trustedFrameUrl(token: string): string {
  return `${TRUSTED_SCHEME}://${TRUSTED_HOST}/${token}`;
}
