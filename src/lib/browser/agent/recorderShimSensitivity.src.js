// The recorder shim's SENSITIVITY helpers — the second half of `recorderShim.src.js`,
// split out for size. Concatenated INSIDE the same IIFE, after the core and before
// the shim body (both Rust `recorder_shim_macos.rs` and `recorderShim.ts` build the
// string in that order; `recorderShimRustParity.test.ts` pins it), so these are
// shim-local functions, not page globals. `attr` is the body's helper: a function
// declaration in the same scope, hoisted, so call-time resolution is fine.
//
// A field is sensitive by its own attributes (type, autocomplete, identifier
// tokens), and the mark is STICKY across an episode of typing until the field
// changes or loses focus — see the body for where it is set and cleared.
// Identifier TOKENS that mark a field sensitive. Matched per token after splitting
// on punctuation, underscores and camelCase — \b never split `user_password` or
// `otpCode`, and `password` itself was missing.
var SENSITIVE_TOKENS = ["password", "passwd", "pwd", "otp", "totp", "mfa", "2fa", "token", "cvv", "cvv2", "cvc", "csc", "ssn", "secret", "pin", "passcode"];
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
  return false;
}
var sticky = typeof WeakMap === "function" ? new WeakMap() : null;

function isSensitiveNow(el) {
  try {
    var it = (attr(el, "type") || "").toLowerCase();
    if (it === "password" || it === "file") return true;
    var ac = (attr(el, "autocomplete") || "").toLowerCase().split(/\s+/);
    for (var i = 0; i < ac.length; i++) {
      var tok = ac[i];
      if (tok.indexOf("cc-") === 0 || tok === "new-password" || tok === "current-password" || tok === "one-time-code") return true;
    }
    if (sensitiveIdentifier(attr(el, "name") + " " + attr(el, "id") + " " + attr(el, "aria-label"))) return true;
  } catch (e) {}
  return false;
}

function markSensitive(el) {
  if (!isSensitiveNow(el)) return;
  try {
    if (sticky) sticky.set(el, true);
    else el.__vmarkSensitive = true;
  } catch (e) {}
}

function wasSensitive(el) {
  try {
    return sticky ? !!sticky.get(el) : !!el.__vmarkSensitive;
  } catch (e) {
    return false;
  }
}

function clearSensitive(el) {
  try {
    if (sticky) sticky["delete"](el);
    else delete el.__vmarkSensitive;
  } catch (e) {}
}
