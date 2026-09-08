// The recorder shim's SENSITIVITY helpers — the second half of `recorderShim.src.js`,
// split out for size. Concatenated INSIDE the same IIFE, after the core and before
// the shim body (both Rust `recorder_shim_macos.rs` and `recorderShim.ts` build the
// string in that order; `recorderShimRustParity.test.ts` pins it), so these are
// shim-local functions, not page globals. `attr` lives here — this file is its
// principal consumer — and the body reads it by hoisting within that one scope.
//
// A field is sensitive by its own attributes (type, autocomplete, identifier
// tokens in name/id/aria-label) or by its ACCESSIBLE NAME — the <label>,
// aria-labelledby or placeholder the core already resolves for the locator
// (audit 20260907, #391) — in English by token and in the other shipped
// languages by phrase (`SENSITIVE_PHRASES`). Two marks carry that observation forward, because a
// page changes attributes under the user — a show-password toggle flips `type`:
//   - the EPISODE mark (`sticky`): set on focus/input, cleared on change/focusout,
//     so a flip mid-typing cannot launder the commit that follows;
//   - the PERMANENT mark (`everSecret`): never cleared. The identity of a secret is
//     the element, not its current attributes — a field observed as a secret at any
//     point in the document's life stays one, across later commits and across focus
//     leaving for the eye button (audit 20260903, WI-FL6.4). A change the page makes
//     before the user ever touches the field is visible only as an attribute
//     mutation, so an observer over EVERY sensitivity-defining attribute feeds the
//     same mark, from the old value or the new one (#394).
// Both marks live in WeakMaps: every engine VMark ships has one, and a fallback that
// wrote `__vmark*` properties onto page elements let the page read and alter the
// classification (#392). The marks fail CLOSED, like the classifier: a mark that
// cannot be read is a secret, and once any mark has failed to write or read, the
// shim stops trusting its memory entirely (`marksBroken`) and treats every later
// commit as a secret — a page that breaks the WeakMaps cannot launder one (#393).
// The OBSERVER's installation is part of that same memory: it is the only thing that
// can see a rewrite the user never touched, so a setup that throws — or an engine
// with no MutationObserver — degrades the shim exactly like a broken mark rather than
// skipping quietly (#393, round 3).
// Bound worth knowing: the observer watches the document tree, not shadow roots — a
// field inside a shadow root is marked on the first focus/input that sees it.
// Identifier TOKENS that mark a field sensitive. Matched per token after splitting
// on punctuation, underscores and camelCase — \b never split `user_password` or
// `otpCode`, and `password` itself was missing.
var SENSITIVE_TOKENS = ["password", "passwd", "pwd", "passphrase", "otp", "totp", "mfa", "2fa", "token", "cvv", "cvv2", "cvc", "csc", "ssn", "secret", "pin", "passcode"];
// Words that NAME a secret in the languages VMark ships (#391, round 2), matched as
// SUBSTRINGS of the lowercased identifier or accessible name rather than as tokens:
// CJK has no word boundaries, and the ASCII tokenizer above splits an accented word
// ("contraseña") at the accent. Whole phrases only — a bare "code"/"código" is a
// postal code as often as a secret. A false positive costs one `{input}` variable
// (the replay asks the user to type it); a miss records the secret.
var SENSITIVE_PHRASES = [
  // en: the phrases a page actually LABELS a one-time secret with. English is
  // here rather than in the token list because the secret is the PAIR — a bare
  // "code" is a postal, ZIP, promo, country, discount or area code far more
  // often than a secret, and the tokenizer above cannot see the qualifier
  // (#391, round 3). Matched as substrings, so "Enter the verification code we
  // sent you" on a <label for> matches too.
  "verification code", "security code", "one-time code", "one time code", "onetime code",
  "confirmation code", "authentication code", "auth code", "recovery code", "backup code",
  "access code", "activation code", "one-time password", "one time password",
  // zh-CN / zh-TW: password, passphrase, verification / dynamic / security / one-time code
  "密码", "密碼", "口令", "验证码", "驗證碼", "校验码", "校驗碼", "动态码", "動態碼", "安全码", "安全碼", "一次性密码", "一次性密碼",
  // ja: password, PIN, authentication / confirmation code, one-time password
  "パスワード", "暗証番号", "認証コード", "確認コード", "ワンタイムパスワード",
  // ko: password, authentication number / code, security code, one-time password
  "비밀번호", "인증번호", "인증 번호", "인증코드", "인증 코드", "보안코드", "보안 코드", "일회용 비밀번호",
  // de / es / fr / it / pt-BR: password, verification / security code
  "passwort", "kennwort", "bestätigungscode", "verifizierungscode", "sicherheitscode",
  "contraseña", "contrasena", "código de verificación", "codigo de verificacion", "código de seguridad", "codigo de seguridad",
  "mot de passe", "code de vérification", "code de verification", "code de sécurité", "code de securite",
  "codice di verifica", "codice di sicurezza",
  "senha", "código de verificação", "codigo de verificacao", "código de segurança", "codigo de seguranca"
];
/** An attribute, never throwing: a hostile page's getter is not a reason to stop. */
function attr(el, name) {
  try {
    return (el.getAttribute && el.getAttribute(name)) || "";
  } catch (e) {
    return "";
  }
}

function sensitiveIdentifier(s) {
  var raw = String(s || "");
  // Two tokenizations: punctuation only (so `PassCode`/`passcode` stay one token) and
  // punctuation plus camelCase (so `otpCode`/`userPassword` split into their words).
  var plain = raw.toLowerCase().split(/[^a-z0-9]+/);
  var camel = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/);
  var parts = plain.concat(camel);
  for (var i = 0; i < parts.length; i++) {
    for (var j = 0; j < SENSITIVE_TOKENS.length; j++) if (parts[i] === SENSITIVE_TOKENS[j]) return true;
  }
  // Composed (NFC) so a page that decomposes its accents still matches the list.
  var lower = (typeof raw.normalize === "function" ? raw.normalize("NFC") : raw).toLowerCase();
  for (var k = 0; k < SENSITIVE_PHRASES.length; k++) if (lower.indexOf(SENSITIVE_PHRASES[k]) !== -1) return true;
  return false;
}
/** Set the moment ANY mark could not be written or read. The shim's memory of
 *  which fields are secrets is then unreliable, and an unreliable memory at a
 *  sensitivity boundary means every later commit is a secret (#393, round 2):
 *  a page that breaks the WeakMaps must not thereby launder one. The cost is
 *  one `{input}` variable per field, which the replay asks the user to type. */
var marksBroken = false;
var sticky = new WeakMap();
/** Elements ever observed as a secret field. Keyed weakly, so a removed field is
 *  collected with its mark; never cleared while the element lives. */
var everSecret = new WeakMap();
/** The PRISTINE map methods, captured now. The shim is injected at document
 *  start, so nothing page-authored has run yet and `WeakMap.prototype` is still
 *  the engine's. Later calls resolve `sticky.set` through that prototype, so a
 *  page that replaces `WeakMap.prototype.set` with a no-op made every mark
 *  silently vanish WITHOUT tripping `marksBroken` — laundering a secret through
 *  the one channel the WeakMaps were chosen to close (audit 20260907 round 2).
 *  Held as functions and `.call`ed, which the patch cannot reach. */
var wmGet = WeakMap.prototype.get;
var wmSet = WeakMap.prototype.set;
var wmDelete = WeakMap.prototype["delete"];
/** The attributes a field is sensitive BY — what the observer below watches.
 *  `placeholder` and `aria-labelledby` are here because `isSensitiveNow` also
 *  judges the ACCESSIBLE NAME, which they define: a page that set
 *  `placeholder="Password"` and removed it before the first focus erased the
 *  only evidence the field was one (audit 20260907 round 2). */
var SENSITIVE_ATTRS = ["type", "autocomplete", "name", "id", "aria-label", "placeholder", "aria-labelledby"];

/** The element's sensitivity-defining attributes, with `name` read as `value`
 *  when given — how the observer evaluates the state a mutation replaced. */
function attrsOf(el, name, value) {
  function get(n) {
    return n === name ? String(value || "") : attr(el, n);
  }
  return {
    type: get("type"),
    autocomplete: get("autocomplete"),
    ident:
      get("name") + " " + get("id") + " " + get("aria-label") + " " + get("placeholder") +
      labelledText(el, get("aria-labelledby")),
  };
}

/** The TEXT an `aria-labelledby` id list points at. Resolved rather than read as
 *  a raw id string, because the id is rarely the secret's name and the OLD value
 *  is the whole point: a page that drops `aria-labelledby="pw-label"` before the
 *  first focus erases the only evidence the field was a password, and the id
 *  alone would not have said so. Bounded by what the id list names — a change to
 *  the LABEL's own text is a mutation on another element and is not covered. */
function labelledText(el, ids) {
  var out = "";
  var list = String(ids || "").split(/\s+/);
  try {
    var root = __vmarkRootOf(el);
    for (var i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      var t = root.getElementById(list[i]);
      if (t) out += " " + (t.textContent || "");
    }
  } catch (e) {}
  return out;
}

function sensitiveAttrs(a) {
  var it = a.type.toLowerCase();
  if (it === "password" || it === "file") return true;
  var ac = a.autocomplete.toLowerCase().split(/\s+/);
  for (var i = 0; i < ac.length; i++) {
    var tok = ac[i];
    if (tok.indexOf("cc-") === 0 || tok === "new-password" || tok === "current-password" || tok === "one-time-code") return true;
  }
  return sensitiveIdentifier(a.ident);
}

function isSensitiveNow(el) {
  try {
    if (sensitiveAttrs(attrsOf(el))) return true;
    // The accessible name is what most fields are actually called — a <label for>,
    // aria-labelledby, a placeholder — and the core resolves it for the locator.
    return sensitiveIdentifier(__vmarkName(el));
  } catch (e) {
    // A field the classifier cannot read is not thereby cleared: a page whose
    // attribute reads throw is refusing inspection, and at a sensitivity
    // boundary a failure is a secret, never a value to record (audit #393).
    return true;
  }
}

function rememberSecret(el) {
  try {
    wmSet.call(everSecret, el, true);
  } catch (e) {
    marksBroken = true; // a secret we could not write down; trust nothing after it
  }
}

function wasEverSecret(el) {
  try {
    return !!wmGet.call(everSecret, el);
  } catch (e) {
    marksBroken = true;
    return true; // a mark that cannot be READ is a secret, never a clearance
  }
}

function markSensitive(el) {
  if (!isSensitiveNow(el)) return;
  rememberSecret(el);
  try {
    wmSet.call(sticky, el, true);
  } catch (e) {
    marksBroken = true;
  }
}

function wasSensitive(el) {
  if (marksBroken) return true;
  if (wasEverSecret(el)) return true;
  try {
    return !!wmGet.call(sticky, el);
  } catch (e) {
    marksBroken = true;
    return true;
  }
}

function clearSensitive(el) {
  try {
    wmDelete.call(sticky, el);
  } catch (e) {
    marksBroken = true;
  }
}

// An attribute the page rewrites is the laundering a show-password toggle (or a
// framework re-render) performs, whether or not the user has touched the field yet:
// a field that was sensitive under the OLD value, or is under the new one, is a
// secret for good. `attributeOldValue` is what tells a rewrite apart from a field
// created that way; `subtree` reaches fields added later. Records are delivered as
// a microtask, so the mark lands before the user's next event.
var sensitivityObserver = null;
function applySensitivityRecords(records) {
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    try {
      if (sensitiveAttrs(attrsOf(r.target, r.attributeName, r.oldValue)) || isSensitiveNow(r.target)) rememberSecret(r.target);
    } catch (e) {
      rememberSecret(r.target); // unreadable under mutation: a secret, fail closed (#393)
    }
  }
}
/** Apply the observer's PENDING records now. Its callback is a microtask, so a
 *  page that flips `type` away from password and then commits the field in the
 *  SAME task — inside its own input handler, then `blur()` — reached the commit
 *  before the permanent mark existed, and the value was recorded as ordinary
 *  (audit 20260907 round 2). Every commit path drains first, which is the only
 *  ordering that makes the observer's evidence available when it is needed. */
function flushSensitivity() {
  if (!sensitivityObserver) return;
  try {
    applySensitivityRecords(sensitivityObserver.takeRecords());
  } catch (e) {
    marksBroken = true;
  }
}
try {
  if (typeof MutationObserver !== "function") throw new Error("no MutationObserver");
  sensitivityObserver = new MutationObserver(applySensitivityRecords);
  sensitivityObserver.observe(document, { attributes: true, attributeFilter: SENSITIVE_ATTRS, attributeOldValue: true, subtree: true });
} catch (e) {
  // Same policy as a broken mark, for the same reason (#393, round 3): the
  // observer is the ONLY thing that can see a rewrite before the user ever
  // touches the field, so a shim without one has an incomplete memory of which
  // fields are secrets — and an incomplete memory at a sensitivity boundary
  // makes every later commit a secret. A missing constructor is not a quieter
  // case than a refused `observe`: both leave the same blind spot, and skipping
  // silently is what let a page launder one.
  marksBroken = true;
}
