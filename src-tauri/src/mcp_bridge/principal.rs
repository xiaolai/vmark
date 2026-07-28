//! Who a bridge connection is — derived from the credential it authenticated
//! with, never from a name it asserts about itself.
//!
//! ## What this replaced (audit 20260728 §2.1)
//!
//! The authorization principal used to be `identity.name`: a string out of the
//! client's own `identify` message, which any authenticated client could send
//! and re-send. With ONE shared bridge token, every token-holder could claim to
//! be `codex-cli`, exercise a delegation a human granted to codex-cli, and have
//! `coherence.resolve` write `{"type":"agent","id":"codex-cli"}` into the
//! ratification receipt. The sharpest harm was not privilege escalation — a
//! same-UID process already has full workspace tool access — it was that the
//! audit receipt was **forgeable**, and a ledger that attributes an action to a
//! principal anyone can claim is worse than one with no attribution, because it
//! is trusted.
//!
//! ## What it is now
//!
//! Install writes a credential VMark minted into the AI client's own MCP config
//! (`mcp_config::client_token_field`). The sidecar reads it from
//! `VMARK_MCP_TOKEN` and presents it in the auth frame. The principal is the
//! provider that credential belongs to, and `identify` is informational only —
//! it labels connections in the UI and in logs and reaches no authorization
//! decision.
//!
//! ## The honest boundary
//!
//! This does **not** defend against a hostile same-UID process. That process
//! can read `~/.claude.json` and `~/.codex/config.toml` exactly as it can read
//! the bridge's 0600 port file (§2.4, accepted), so it can still obtain another
//! client's credential. What changed is real but bounded, and it is worth
//! stating precisely rather than overstating — overstatement is the defect
//! WI-6 existed to correct:
//!
//! - Impersonation now costs *reading another client's config file* instead of
//!   *typing a different string*. Against a different-UID or browser attacker
//!   — the ones the token exists to stop — it is a full stop.
//! - Honest misattribution is gone. `detectClientIdentity()` in the sidecar
//!   GUESSES its own name from the parent process name, so a wrapper script or
//!   a renamed binary was enough to make the ledger record the wrong actor with
//!   nobody attacking anything.
//! - A receipt now traces to something VMark issued and stored in one named
//!   place, so "which client held this credential" is answerable after the
//!   fact.

use super::token_compare::token_matches;
use crate::mcp_config::client_tokens::ProviderToken;

/// The identity a bridge connection authenticated as.
///
/// Four states, not `Option<String>`: the three ways a connection can fail to
/// be identified have different causes and different remedies, and collapsing
/// them produces the unactionable "no live delegation authorizes …" that this
/// work exists to replace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BridgePrincipal {
    /// Authenticated with the shared bridge token and presented no per-client
    /// credential. Every install predating this mechanism is here.
    Anonymous,
    /// Presented a credential no configured provider holds — rotated away,
    /// hand-edited, or belonging to a config VMark could not parse at startup.
    Unrecognized,
    /// Presented a credential two or more providers share, so it names none of
    /// them. Carries the sharers so the refusal can say which.
    Ambiguous(Vec<String>),
    /// Verified: the credential VMark issued to this provider.
    Provider(String),
}

impl BridgePrincipal {
    /// Resolve the principal from the credential presented at auth time.
    ///
    /// Scans **every** configured credential rather than returning at the first
    /// match. That is what detects the two-providers-one-token case, and it
    /// also removes a data-dependent early exit from the comparison — the
    /// per-entry compare is `token_matches`, the same best-effort constant-time
    /// fold the shared bridge token uses.
    pub(crate) fn resolve(presented: Option<&str>, configured: &[ProviderToken]) -> Self {
        let Some(presented) = presented.map(str::trim).filter(|t| !t.is_empty()) else {
            return BridgePrincipal::Anonymous;
        };
        let owners: Vec<String> = configured
            .iter()
            .filter(|entry| token_matches(presented, &entry.token))
            .map(|entry| entry.provider.clone())
            .collect();
        match owners.len() {
            0 => BridgePrincipal::Unrecognized,
            1 => BridgePrincipal::Provider(owners.into_iter().next().expect("len == 1")),
            _ => BridgePrincipal::Ambiguous(owners),
        }
    }

    /// The provider id authorized to take delegated actions, or the localized
    /// reason it is refused.
    ///
    /// Fails **closed**: only a credential that resolved to exactly one
    /// provider authorizes anything. Every refusal names the remedy, because
    /// the whole migration story is users whose existing installs land in
    /// `Anonymous` until they re-run Install.
    pub(crate) fn authorized_id(&self) -> Result<&str, String> {
        match self {
            BridgePrincipal::Provider(id) => Ok(id),
            BridgePrincipal::Anonymous => {
                Err(rust_i18n::t!("errors.mcp.principalMissing").to_string())
            }
            BridgePrincipal::Unrecognized => {
                Err(rust_i18n::t!("errors.mcp.principalUnknown").to_string())
            }
            BridgePrincipal::Ambiguous(providers) => Err(rust_i18n::t!(
                "errors.mcp.principalAmbiguous",
                detail = providers.join(", ")
            )
            .to_string()),
        }
    }

    /// A short label for logs. Never a client-supplied string — that is the
    /// whole point — so it cannot be confused with `ClientIdentity::display_name`.
    pub(crate) fn label(&self) -> String {
        match self {
            BridgePrincipal::Anonymous => "unidentified".to_string(),
            BridgePrincipal::Unrecognized => "unrecognized-credential".to_string(),
            BridgePrincipal::Ambiguous(providers) => format!("ambiguous({})", providers.join(", ")),
            BridgePrincipal::Provider(id) => id.clone(),
        }
    }
}

#[cfg(test)]
#[path = "principal.test.rs"]
mod tests;
