//! The closed browser-operation vocabulary (R4/R5).
//!
//! Mirrors `BROWSER_OPERATIONS` / `NEVER_AUTOMATED` in
//! `lib/browser/approval/grants.ts`. Kept separate from origin canonicalization:
//! an operation is an authorization *token*, orthogonal to which origin it runs
//! against. Anything outside this closed set is rejected rather than treated as an
//! opaque permission — that is how a hard denial or an operation-scoped grant
//! cannot be bypassed by a misspelled or case-variant spelling (`"Upload"`).
//!
//! `publish` was removed from the set (audit 20260903): it had no consumer on
//! either side, so it was a grantable token that authorized nothing — inert
//! authority the user could be shown and could never observe.
//!
//! @coordinates-with src/lib/browser/approval/grants.ts — the mirrored vocabulary

/// Operations the AI may NEVER perform autonomously, even with a matching grant.
/// An AI-chosen file upload is an exfiltration path, so upload targets stay
/// human-chosen (mirrors `NEVER_AUTOMATED` in the TS layer).
pub(crate) const NEVER_AUTOMATED: &[&str] = &["upload"];

/// Operations that are known and one-shot-able (per-call approval) but can NEVER
/// be authorized by a standing grant — raw isolated-world `eval` (`execute_js`)
/// is too powerful to grant once and reuse silently (ADR-A6). This is the
/// AUTHORITATIVE enforcement: even if a caller pushes `eval` into the grant set
/// via `browser_set_grants`, the origin guard refuses it, so `eval` always
/// requires a fresh per-call one-shot. Mirrors `NEVER_GRANTABLE` in
/// `src/lib/browser/approval/grants.ts`.
///
/// `session` joins `eval` here (WI-P6.3): loading a saved credential blob into a
/// context is user-gated per call and must never become a standing "this site may
/// restore sessions" grant. `record` joins them (WI-NB7.3): starting a recording of
/// the user's own actions is a per-use consent, never a standing permission.
pub(crate) const NEVER_GRANTABLE: &[&str] = &["eval", "session", "record"];

/// Operations whose one-shot must bind the exact PAYLOAD that will run, not merely
/// `(origin, operation, target)`.
///
/// `style` and `eval` carry a caller-supplied script/CSS, so an "Allow once" the
/// user approved for payload A must NOT authorize a substituted payload B on the
/// retry. The driver binds a hash of the exact script the eval will run and
/// refuses a mismatched retry. (Security review P5 — High #1, Medium #4.)
///
/// `type`, `key` and `scroll` bind too (audit 20260903 A-05): the built script
/// EMBEDS the text to type, the key plus its modifiers, or the scroll delta, so
/// binding the script hash binds the payload. Before this an "Allow once" for
/// `key` authorized any key with any modifiers on the retry, and one for `type`
/// bound the element but not the text. `click` stays target-only — its script
/// carries nothing beyond the descriptor the prompt already showed.
pub(crate) fn operation_binds_payload(operation: &str) -> bool {
    // An UNKNOWN spelling binds nothing because it authorizes nothing: every
    // route refuses it before a binding question is asked.
    BrowserOperation::from_wire(operation).is_some_and(BrowserOperation::binds_payload)
}

/// The closed browser-operation vocabulary, with `from_wire` as its single
/// definition: `is_known_operation` and `operation_binds_payload` both delegate
/// to it, and every route that can authorize an operation asks one of them.
///
/// It is NOT a wire type, and a `Deserialize` impl claiming to be one was
/// removed (audit 20260903 round 3, #26): the command boundary takes
/// `operation: String` (`browser_eval`) and `operations: Vec<String>`
/// (`StandingGrant`), so the deserializer had exactly one caller — its own test —
/// while the doc comment above it advertised enforcement that was not happening
/// anywhere. The enforcement is real, but it lives at the decision points
/// (`is_operation_granted`, `consume_one_shot`, `mint_one_shot`,
/// `set_standing_grants`), each of which refuses an unknown spelling. Typing the
/// wire itself would be a genuine improvement and a larger change: `StandingGrant`
/// is mirrored from the TS store and compared as strings by `origin_guard`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserOperation {
    Read,
    Attach,
    Click,
    Type,
    Scroll,
    Key,
    Style,
    Navigate,
    Upload,
    Eval,
    Session,
    Record,
}

impl BrowserOperation {
    /// Does an approval for this operation bind the exact payload (script hash)?
    ///
    /// EXHAUSTIVE on purpose: a new payload-carrying operation added to the enum
    /// fails to compile until it says which side it is on. The old string match
    /// silently defaulted a new operation to "unbound", and the vocabulary loop
    /// test could not tell.
    pub(crate) fn binds_payload(self) -> bool {
        match self {
            // `session` binds an `action:handle` descriptor, so an "Allow once" for
            // "load work_login" cannot be spent on loading a different saved session
            // (WI-P6.3) — the same anti-substitution reasoning as style/eval.
            Self::Style | Self::Eval | Self::Session | Self::Type | Self::Key | Self::Scroll => {
                true
            }
            // `click` is target-only: its script carries nothing beyond the
            // descriptor the prompt already showed. The rest carry no script.
            Self::Read
            | Self::Attach
            | Self::Click
            | Self::Navigate
            | Self::Upload
            | Self::Record => false,
        }
    }

    /// Parse a wire operation string, or `None` for unknown/variant spellings.
    /// The one definition of the set — `src/lib/browser/approval/grants.ts` is
    /// asserted equal to these arms by `operationVocabulary.test.ts`, which reads
    /// this function from source.
    pub(crate) fn from_wire(s: &str) -> Option<Self> {
        match s {
            "read" => Some(Self::Read),
            "attach" => Some(Self::Attach),
            "click" => Some(Self::Click),
            "type" => Some(Self::Type),
            "scroll" => Some(Self::Scroll),
            "key" => Some(Self::Key),
            "style" => Some(Self::Style),
            "navigate" => Some(Self::Navigate),
            "upload" => Some(Self::Upload),
            "eval" => Some(Self::Eval),
            "session" => Some(Self::Session),
            "record" => Some(Self::Record),
            _ => None,
        }
    }
}

/// Is `operation` a known browser operation? Misspellings and case variants
/// (`"Upload"`, `"read "`) are NOT — mirrors `isBrowserOperation` in the TS layer.
pub fn is_known_operation(operation: &str) -> bool {
    BrowserOperation::from_wire(operation).is_some()
}

#[cfg(test)]
#[path = "operation.test.rs"]
mod tests;
