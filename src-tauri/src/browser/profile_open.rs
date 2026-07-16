//! Per-use profile-open authorization (WI-P6.1 H1).
//!
//! Opening a named persistent context could otherwise let a malicious AI open a
//! guessed profile (`github-work`) and read authenticated page content with no
//! consent. This is the single-use grant that gates it — bound to
//! `(profile, destination origin)`, minted by the user's "Allow once", consumed
//! authoritatively inside `browser_ai_create` BEFORE the profile is applied.
//!
//! Unlike a one-shot it is NOT tab-bound: the tab does not exist yet at approval
//! time. It IS origin-bound (through the same guard as standing grants, never
//! looser) and single-use, exactly like a one-shot.
//!
//! @coordinates-with browser/origin_guard.rs — the shared origin matching
//! @coordinates-with services/browser/grantSync.ts — mints these from the store

use crate::browser::origin_guard::{canonicalize_origin, origin_matches_pattern};

/// A single-use authorization to open `profile` at a page whose origin matches
/// `origin_pattern`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ProfileOpen {
    pub profile: String,
    #[serde(rename = "originPattern")]
    pub origin_pattern: String,
}

/// A profile name is untrusted (AI-supplied) and becomes a keychain/store identity;
/// enforce the exact charset + length HERE too (not only at the frontend), so a
/// compromised renderer or future native caller can't smuggle a weird name in.
pub fn validate_profile(profile: &str) -> Result<(), String> {
    if profile.is_empty() || profile.len() > 64 {
        return Err("profile must be 1..=64 chars".into());
    }
    if !profile
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("profile must be [A-Za-z0-9._-]".into());
    }
    Ok(())
}

/// Spend a grant authorizing opening `profile` at `target_url`'s origin, if one
/// matches. Removes it (single-use) and returns true. Both the profile (exact) and
/// the origin (through the shared guard — never looser than a standing grant) must
/// match, so an approval for "open work on github.com" cannot open a different
/// profile or a different origin.
pub fn consume_profile_open(
    grants: &mut Vec<ProfileOpen>,
    profile: &str,
    target_url: &str,
) -> bool {
    if validate_profile(profile).is_err() {
        return false;
    }
    let Some(origin) = canonicalize_origin(target_url) else {
        return false;
    };
    let Some(index) = grants
        .iter()
        .position(|g| g.profile == profile && origin_matches_pattern(&origin, &g.origin_pattern))
    else {
        return false;
    };
    grants.remove(index);
    true
}

#[cfg(test)]
#[path = "profile_open.test.rs"]
mod tests;
