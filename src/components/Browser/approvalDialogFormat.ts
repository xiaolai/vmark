/**
 * approvalDialogFormat — the constants and pure formatters BrowserApprovalDialog
 * renders with (split for the file-size gate).
 *
 * @coordinates-with components/Browser/BrowserApprovalDialog — the consumer
 * @module components/Browser/approvalDialogFormat
 */
import { canonicalizeOrigin } from "@/lib/browser/origin/originGuard";

/** An Allow that lands sooner than this after the prompt (re)rendered is ignored:
 *  a human cannot read and decide a security prompt in under half a second, so an
 *  activation that fast was aimed at whatever was there before. Firefox applies the
 *  same "security delay" to its permission prompts. */
export const ACTIVATION_DELAY_MS = 500;

/** Longest accessible name the prompt prints. A page can name a control with a
 *  novel; the descriptor the gate binds is unaffected — this caps only the display,
 *  and a clipped name is marked so the user knows it is clipped. */
const MAX_DISPLAY_NAME = 200;

export function clipName(name: string): string {
  return name.length > MAX_DISPLAY_NAME ? `${name.slice(0, MAX_DISPLAY_NAME)}…` : name;
}

/** The committed origin as `scheme://host[:port]`, or the raw url if it is opaque
 *  (about:/data:) — an opaque origin can be neither granted nor authorized once, so
 *  the dialog still names it rather than showing a blank. */
export function displayOrigin(url: string): string {
  const origin = canonicalizeOrigin(url);
  if (!origin) return url;
  const defaultPort = origin.scheme === "https" ? 443 : 80;
  return origin.port === defaultPort
    ? `${origin.scheme}://${origin.host}`
    : `${origin.scheme}://${origin.host}:${origin.port}`;
}

