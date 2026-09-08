/**
 * The credential vocabulary the persistence redactor classifies against.
 *
 * Purpose: `url.ts` is the URL-shape module; this is the SECURITY judgement it
 * applies — which path segments and which parameter names carry a secret. Split
 * out when the vocabulary and the reasoning behind it outgrew the file
 * (audit R3 #783/#789); `url.ts` re-exports `credentialPath` so its existing
 * consumers (the workflow recorder) are unaffected.
 *
 * It is a SUPERSET of the recorder shim's `SENSITIVE_TOKENS` (#789), and
 * `url.test.ts` reads that list out of `recorderShimSensitivity.src.js` and
 * fails if it ever stops being one. The two lists were written independently
 * and had drifted: `pwd`, `passphrase`, `totp`, `mfa`, `2fa`, `cvv`, `cvv2`,
 * `cvc`, `csc`, `ssn`, `pin` and `passcode` named a secret to the recorder and
 * named nothing here — yet a field the recorder calls sensitive posts under
 * that same name, and both modules exist to keep a secret out of a file that
 * outlives the session. The shim cannot import this module (it is ES5 injected
 * raw into a page world), so a test is the only join available.
 *
 * `csrf` and `credential` were added by review alongside them. `state` was NOT,
 * though it is OAuth's CSRF nonce: `?state=CA` on a store locator and
 * `?state=open` on a filter are the far commoner readings, so dropping it
 * would restore the wrong page for a nonce that is worthless once the flow
 * ended.
 *
 * @coordinates-with src/lib/browser/url.ts — urlForPersistence, the caller
 * @coordinates-with src/lib/browser/agent/recorderShimSensitivity.src.js — the recorder's list
 * @module lib/browser/urlCredentials
 */

/** Delete every parameter whose name carries a credential; true when any went. */
export function dropCredentialParams(params: URLSearchParams): boolean {
  const drop = [...params.keys()].filter(isCredentialParam);
  for (const k of drop) params.delete(k);
  return drop.length > 0;
}

/** A camelCase spelling (`accessToken`, `sessionId`, `apiKey`) is split at its case
 *  boundaries first, so the one list below covers `access_token` and `accessToken`
 *  alike (audit 20260907, #396). BOTH boundaries: an ACRONYM head has no lowercase
 *  to split on, so `APIToken`/`JWTToken` stayed one word and walked past the list. */
function isCredentialParam(name: string): boolean {
  const split = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return CREDENTIAL_PARAM.test(split);
}

/** Does this path carry a credential — a flow word (`reset`, `magic-login`, `invite`,
 *  `callback`…, in any hyphen/underscore spelling), a long opaque token-shaped
 *  segment, or a JWT? Segments are percent-decoded before they are classified.
 *  Shared by persistence and the workflow recorder, so the two redactors cannot
 *  drift. */
export function credentialPath(pathname: string): boolean {
  return pathname.split("/").some((raw) => {
    // Classify the DECODED segment: `password%2Dreset` is `password-reset` to the
    // server, and the encoded spelling walked past every rule (audit 20260907,
    // #398). A segment that will not decode is treated as a credential — this is
    // a redactor, and a malformed escape is not a shape an ordinary path takes.
    const seg = decodeSegment(raw);
    if (seg === null) return true;
    return credentialSegment(seg) || TOKEN_SEGMENT.test(seg) || JWT_SEGMENT.test(seg);
  });
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Path words that name a credential-bearing flow. */
const CREDENTIAL_WORD = /^(reset|magic|token|verify|confirm|invite|activate|auth|callback|sso)$/i;
/** A segment names a flow when ANY of its hyphen/underscore-delimited words does:
 *  `password-reset`, `password_reset`, `reset_password`, `verify-email` and
 *  `magic_link` are all real spellings, and the whole-segment match that preceded
 *  this let every compound one through (WI-FL6.4). `oauth` and `tokens` are still
 *  whole words, so they do not match. */
function credentialSegment(segment: string): boolean {
  return segment.split(/[-_]/).some((word) => CREDENTIAL_WORD.test(word));
}
/** A long opaque segment: hex, base64url or a random id — the shape a token takes. */
const TOKEN_SEGMENT = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{20,}$/;
/** A JWT: three base64url runs joined by dots, the first encoding `{"` (`eyJ`). The
 *  dots keep it out of TOKEN_SEGMENT, so it needs its own rule. */
const JWT_SEGMENT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** Query/fragment parameter names that carry a credential rather than an address —
 *  tokens, secrets, and every common session-id spelling (`sid`, `sessid`,
 *  `jsessionid`, `phpsessid`, `asp.net_sessionid`…), OAuth verifiers and tickets.
 *  Boundaries are SYMMETRIC: a dot opened a name but did not close one, so
 *  `token.value` walked straight past (round 2). The module header above records
 *  which names were added by review, and which one deliberately was not. */
const CREDENTIAL_PARAM =
  /(^|_|-|\.)(token|access_token|id_token|refresh_token|oauth_token|oauth_verifier|bearer|jwt|secret|credential|password|passwd|pwd|passphrase|otp|totp|mfa|2fa|pin|passcode|cvv2?|cvc|csc|ssn|auth|authorization|csrf|session|sessionid|sessid|sess|sid|jsessionid|phpsessid|aspsessionid|asp\.net_sessionid|cfid|cftoken|api_?key|apikey|signature|sig|code|ticket|nonce)($|_|-|\.)/i;
