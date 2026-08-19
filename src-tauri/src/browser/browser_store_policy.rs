//! Pure data-store selection policy for browser postures (WI-NB10.1 / D6v2).
//!
//! `store_policy(mode, profile, macos_major)` is the ONE place the "which
//! `WKWebsiteDataStore` does this tab get?" decision lives. It is deliberately
//! platform-independent and side-effect-free so the whole decision table can be
//! unit-tested for every posture × macOS version WITHOUT a device or a WebKit
//! object — `browser_store_macos.rs` is the impure adapter that maps each arm to
//! an actual store, and that mapping is the only thing a device could exercise.
//!
//! ## What D6v2 changes
//!
//! Before this phase, Human and AiShared tabs left the `WKWebViewConfiguration`
//! default store (the app-wide OS default). D6v2 gives VMark human browsing its
//! own **identified persistent** store on macOS 14+, so a browsed page's cookies
//! and localStorage are isolated from the app's own webview and from every other
//! app that shares the default store. The cost is a one-time migration: existing
//! Human-tab logins do not carry over, and a downgrade re-shows the old default
//! store (disclosed in the PR body and the release note).
//!
//! ## macOS ≤ 13 is honest, not silent
//!
//! `dataStoreForIdentifier:` is macOS 14+. Below 14 there is no identified store,
//! so Human/AiShared fall back to [`StorePolicy::Default`] — the isolation goal is
//! simply **not met** there, and the arm says so rather than pretending. A named
//! AI profile still gets a *distinct* non-persistent store below 14 (isolated, not
//! persistent) — never the shared singleton, which would collapse cross-profile
//! isolation (sec review WI-P6.1 H2).
//!
//! ## Human identity is a SEPARATE namespace from AI profiles (collision safety)
//!
//! The plan's shorthand reads `uuid_for_profile("vmark-human-browsing")`, but AI
//! profile names validate as `[A-Za-z0-9._-]{1,64}` — so a sandbox profile named
//! `vmark-human-browsing` would derive the SAME UUID and alias the human store,
//! reading the human's cookies from inside the sandbox. [`StorePolicy::HumanPersistent`]
//! is therefore a distinct arm; the adapter derives its UUID from a namespace no
//! AI-profile input can produce (`browser_store_macos.rs::uuid_for_human`). The
//! mechanism the plan named (a deterministic identified store) is unchanged; only
//! the derivation input is separated so the sandbox boundary holds.

use crate::browser::registry::AutomationMode;

/// The macOS major version at or above which `dataStoreForIdentifier:` exists.
pub const MIN_IDENTIFIED_STORE_MACOS: i64 = 14;

/// The store a tab should be given, as a pure decision. The adapter in
/// `browser_store_macos.rs` maps each arm to a `WKWebsiteDataStore`; the 32-store
/// cap and its `PROFILE_STORE_LIMIT` fail-closed live in the adapter because they
/// are per-name runtime state, not part of this decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorePolicy {
    /// Leave the `WKWebViewConfiguration` default (the OS default persistent
    /// store). Human/AiShared on macOS ≤ 13 — the isolation goal is NOT met here.
    Default,
    /// The app-lifetime **shared non-persistent** store for UNNAMED AI sandbox
    /// tabs. Ephemeral by design: a throwaway sandbox keeps nothing.
    SharedSandbox,
    /// VMark's **identified persistent** human-browsing store (macOS 14+ Human and
    /// AiShared). Its identity is fixed and namespaced apart from AI profiles.
    HumanPersistent,
    /// A named AI profile's OWN identified **persistent** store (macOS 14+), so a
    /// login persists for later reuse by name.
    NamedPersistent(String),
    /// A named AI profile's OWN **distinct non-persistent** store (macOS ≤ 13):
    /// isolated but not persistent. Never the shared singleton.
    NamedEphemeral(String),
}

/// Decide the store for a tab. Inputs are exactly what the creation seam already
/// holds (`surface_create_macos.rs`): the resolved posture, its optional named
/// profile (AiSandbox only), and the host's macOS major version.
///
/// An empty profile name is treated as no profile — the same normalization the
/// adapter applied before, kept here so the decision is total.
pub fn store_policy(mode: AutomationMode, profile: Option<&str>, macos_major: i64) -> StorePolicy {
    let named = profile.filter(|name| !name.is_empty());
    match mode {
        AutomationMode::AiSandbox => match named {
            Some(name) if macos_major >= MIN_IDENTIFIED_STORE_MACOS => {
                StorePolicy::NamedPersistent(name.to_string())
            }
            Some(name) => StorePolicy::NamedEphemeral(name.to_string()),
            None => StorePolicy::SharedSandbox,
        },
        AutomationMode::Human | AutomationMode::AiShared => {
            if macos_major >= MIN_IDENTIFIED_STORE_MACOS {
                StorePolicy::HumanPersistent
            } else {
                StorePolicy::Default
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The three macOS versions the plan pins: 13 (no identified stores), 14 (the
    // floor where they appear), 26 (a modern release — same behaviour as 14).
    const V13: i64 = 13;
    const V14: i64 = 14;
    const V26: i64 = 26;

    #[test]
    fn human_gets_identified_store_on_14_plus_only() {
        assert_eq!(
            store_policy(AutomationMode::Human, None, V13),
            StorePolicy::Default
        );
        assert_eq!(
            store_policy(AutomationMode::Human, None, V14),
            StorePolicy::HumanPersistent
        );
        assert_eq!(
            store_policy(AutomationMode::Human, None, V26),
            StorePolicy::HumanPersistent
        );
    }

    #[test]
    fn ai_shared_tracks_human_exactly() {
        // AiShared operates in the human's context, so it must land on the SAME
        // store as Human at every version — that is what "shared" means.
        for v in [V13, V14, V26] {
            assert_eq!(
                store_policy(AutomationMode::AiShared, None, v),
                store_policy(AutomationMode::Human, None, v),
                "AiShared and Human diverged at macOS {v}"
            );
        }
    }

    #[test]
    fn ai_shared_ignores_a_stray_profile() {
        // AiShared never carries a named profile in practice; if one leaks in it
        // must not turn AiShared into a named-profile store.
        assert_eq!(
            store_policy(AutomationMode::AiShared, Some("p1"), V14),
            StorePolicy::HumanPersistent
        );
    }

    #[test]
    fn unnamed_sandbox_is_always_the_shared_ephemeral_store() {
        for v in [V13, V14, V26] {
            assert_eq!(
                store_policy(AutomationMode::AiSandbox, None, v),
                StorePolicy::SharedSandbox
            );
            // An empty name is not a name.
            assert_eq!(
                store_policy(AutomationMode::AiSandbox, Some(""), v),
                StorePolicy::SharedSandbox
            );
        }
    }

    #[test]
    fn named_sandbox_is_persistent_on_14_plus_ephemeral_below() {
        assert_eq!(
            store_policy(AutomationMode::AiSandbox, Some("work"), V13),
            StorePolicy::NamedEphemeral("work".into())
        );
        assert_eq!(
            store_policy(AutomationMode::AiSandbox, Some("work"), V14),
            StorePolicy::NamedPersistent("work".into())
        );
        assert_eq!(
            store_policy(AutomationMode::AiSandbox, Some("work"), V26),
            StorePolicy::NamedPersistent("work".into())
        );
    }

    #[test]
    fn a_sandbox_profile_named_like_the_human_key_is_still_a_named_profile() {
        // The collision-safety property at the decision layer: a profile called
        // "vmark-human-browsing" resolves to a NAMED profile arm, never the
        // HumanPersistent arm. The adapter's separate namespace then guarantees
        // the two never share a UUID.
        assert_eq!(
            store_policy(AutomationMode::AiSandbox, Some("vmark-human-browsing"), V14),
            StorePolicy::NamedPersistent("vmark-human-browsing".into())
        );
        assert_ne!(
            store_policy(AutomationMode::AiSandbox, Some("vmark-human-browsing"), V14),
            StorePolicy::HumanPersistent
        );
    }

    #[test]
    fn the_14_boundary_is_exact() {
        // Off-by-one guard: 13 is below, 14 is at, the floor.
        assert_eq!(
            store_policy(AutomationMode::Human, None, MIN_IDENTIFIED_STORE_MACOS - 1),
            StorePolicy::Default
        );
        assert_eq!(
            store_policy(AutomationMode::Human, None, MIN_IDENTIFIED_STORE_MACOS),
            StorePolicy::HumanPersistent
        );
    }
}
