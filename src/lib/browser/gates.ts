/**
 * Gate classifier (WI-NB2.2) — turns a page-signals snapshot into an advisory
 * verdict: is the page a login wall, a consent interstitial, a human-verification
 * challenge, or a rate-limit notice?
 *
 * Purpose: after a navigation the model needs to know it is looking at a gate,
 * not the content it asked for — otherwise it acts on the interstitial (the
 * NeoBrowser lesson: their tool clicked cookie banners for 40 minutes). The
 * verdict is ADVISORY ONLY: it changes what the model is told, never what is
 * authorized. Its hints all point at the user, never at routing around the gate.
 *
 * Key decisions:
 *   - PRECISION over recall. Every verdict needs either a RENDERED challenge
 *     widget (size-checked in the signals script) or >=2 independent signals.
 *     NeoBrowser's single-substring classifier walled any page mentioning
 *     "cloudflare", any "$429" price, any footer "403" — and, run on a search
 *     results page, walled every query containing those words. The Python
 *     original required two patterns; the Rust port dropped the conjunction and
 *     paid for it. The conjunction is the load-bearing idea here.
 *   - Text-only verdicts additionally require a TERSE page (< 1500 chars of
 *     visible text): real interstitials are short; an article *about* CAPTCHAs
 *     is long. The widget path is exempt — a rendered widget is definitive.
 *   - Leaf-pure: no DOM, no stores — jsdom-free unit testing of the whole
 *     signal corpus. The DOM half lives in `agent/gateScript.ts`.
 *
 * @coordinates-with lib/browser/agent/gateScript.ts — produces GateSignals
 * @coordinates-with services/mcpBridge/v2/browserGateProbe.ts — runs both
 * @module lib/browser/gates
 */

/** One navigation's worth of page signals, produced by `buildGateSignalsScript`. */
export interface GateSignals {
  url: string;
  title: string;
  /** First 4000 chars of visible body text. */
  textHead: string;
  /** A challenge widget (recaptcha/hcaptcha/turnstile frame) is RENDERED at
   *  interactive size — the one single-signal verdict, because it is a layout
   *  fact, not a phrase. */
  challengeWidget: boolean;
  /** A visibly rendered password input exists. */
  passwordField: boolean;
}

export type GateKind = "challenge" | "consent" | "login-required" | "rate-limited";

export interface GateVerdict {
  kind: GateKind;
  /** What the model should do next — always "involve the user", never "retry". */
  hint: string;
}

const HINTS: Record<GateKind, string> = {
  challenge:
    "the page is showing a human-verification challenge — tell the user and wait; do not attempt to solve or bypass it",
  consent:
    "a consent interstitial is blocking the content — ask the user how to proceed; with their agreement the dialog's buttons are ordinary act targets",
  "login-required":
    "the page wants the user to sign in — stop and ask them; a previously saved session (session_load) may help if they approve it",
  "rate-limited":
    "the site is rate-limiting — stop retrying and tell the user; more attempts make it worse",
};

const TERSE_LIMIT = 1500;

function verdict(kind: GateKind): GateVerdict {
  return { kind, hint: HINTS[kind] };
}

/** Classify a signals snapshot, or null when the page reads as ordinary content. */
export function classifyGate(s: GateSignals): GateVerdict | null {
  const title = s.title.toLowerCase();
  const text = s.textHead.toLowerCase();
  const terse = s.textHead.trim().length < TERSE_LIMIT;

  let url: URL | null = null;
  try {
    url = new URL(s.url);
  } catch {
    url = null;
  }

  // challenge — the rendered widget is definitive; text-only needs title AND
  // body phrases AND a terse page.
  if (s.challengeWidget) return verdict("challenge");
  const titleChallenge = /just a moment|attention required|verify you are|are you a robot|checking your browser/.test(
    title,
  );
  const textChallenge =
    /verify (that )?you are human|complete the (security )?check|i'?m not a robot|press and hold|unusual traffic|automated queries/.test(
      text,
    );
  if (titleChallenge && textChallenge && terse) return verdict("challenge");

  // consent — a consent URL AND consent content.
  const urlConsent =
    url !== null && (url.hostname.startsWith("consent.") || /(^|\/)consent(\/|$)/.test(url.pathname));
  const contentConsent = /before you continue|accept all|cookie|consent/.test(`${title} ${text}`);
  if (urlConsent && contentConsent) return verdict("consent");

  // login-required — a rendered password field AND login context.
  const titleLogin = /sign in|log in|login|登录|ログイン|iniciar sesi/i.test(s.title);
  const pathLogin = url !== null && /(^|\/)((sign|log)-?in)(\/|$)/.test(url.pathname);
  if (s.passwordField && (titleLogin || pathLogin)) return verdict("login-required");

  // rate-limited — two independent phrase hits, terse page. A bare "429" counts
  // only in the TITLE (a price or an id in body text must never trip this).
  const rateHits = [
    /too many requests|rate limit/.test(title),
    /too many requests|rate.?limit(ed)?/.test(text) && /try again/.test(text),
    /\b429\b/.test(title),
  ].filter(Boolean).length;
  if (rateHits >= 2 && terse) return verdict("rate-limited");

  return null;
}
