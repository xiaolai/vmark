//! Content-server runtime provisioning state machine (Phase 1, WI-1.1; ADR-2).
//!
//! Provisions a version-pinned, signed-manifest-verified JS bundle (base KB or
//! Slidev) into app-data. The Node binary itself ships codesigned inside the
//! app bundle (ADR-2) — only the inert-ish JS tree is provisioned here, and it
//! is treated as code: checksum-verified before extraction, extracted to a
//! staging dir, then atomically swapped into place.
//!
//! This module is pure logic + filesystem helpers (no network, no Tauri) so the
//! state transitions, checksum verification, and atomic-swap planning are unit
//! testable. The downloader and Tauri command surface live in `mod.rs`.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Which provisioned bundle. Base KB is small; Slidev is the ~451 MB tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BundleKind {
    BaseKb,
    Slidev,
}

impl BundleKind {
    pub fn dir_name(self) -> &'static str {
        match self {
            BundleKind::BaseKb => "base-kb",
            BundleKind::Slidev => "slidev",
        }
    }
}

/// Signed manifest accompanying a bundle tarball. Constructed by the downloader
/// (Phase 1 WI-1.1) + the CI bundle-build pipeline (ADR-2, external infra);
/// fields are validated against the downloaded tarball before extraction.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BundleManifest {
    pub kind: BundleKind,
    pub version: String,
    /// Lowercase hex SHA-256 of the tarball bytes.
    pub sha256: String,
    pub size: u64,
}

/// Lifecycle of a provisioned bundle (review D2.1 — explicit state machine).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum ProvisionState {
    Missing,
    Downloading { received: u64, total: u64 },
    Verifying,
    Extracting,
    Ready { version: String },
    Failed { reason: String },
}

/// Events that drive the state machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProvisionEvent {
    StartDownload { total: u64 },
    Progress { received: u64 },
    DownloadComplete,
    ChecksumOk,
    ChecksumFailed,
    Extracted { version: String },
    Errored { reason: String },
}

/// Pure transition function. Invalid transitions yield `Failed` rather than
/// panicking — provisioning must fail loud but never crash the app.
pub fn transition(state: &ProvisionState, event: ProvisionEvent) -> ProvisionState {
    use ProvisionEvent as E;
    use ProvisionState as S;
    match (state, event) {
        (S::Missing, E::StartDownload { total }) => S::Downloading { received: 0, total },
        (S::Downloading { total, .. }, E::Progress { received }) => S::Downloading {
            received,
            total: *total,
        },
        (S::Downloading { .. }, E::DownloadComplete) => S::Verifying,
        (S::Verifying, E::ChecksumOk) => S::Extracting,
        (S::Verifying, E::ChecksumFailed) => S::Failed {
            reason: "checksum mismatch".into(),
        },
        (S::Extracting, E::Extracted { version }) => S::Ready { version },
        // Any state can fail.
        (_, E::Errored { reason }) => S::Failed { reason },
        // Anything else is an illegal transition.
        (s, e) => S::Failed {
            reason: format!("illegal transition from {s:?} on {e:?}"),
        },
    }
}

impl ProvisionState {
    pub fn is_ready(&self) -> bool {
        matches!(self, ProvisionState::Ready { .. })
    }
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            ProvisionState::Ready { .. } | ProvisionState::Failed { .. }
        )
    }
}

/// Verify tarball bytes against a manifest's SHA-256 (constant work, no early
/// length shortcut needed — hashing dominates).
pub fn verify_checksum(bytes: &[u8], expected_hex: &str) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let actual = hex_encode(&digest);
    // Case-insensitive compare against the expected hex.
    actual.eq_ignore_ascii_case(expected_hex.trim())
}

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_transitions_to_ready() {
        let mut s = ProvisionState::Missing;
        s = transition(&s, ProvisionEvent::StartDownload { total: 100 });
        assert!(matches!(s, ProvisionState::Downloading { total: 100, .. }));
        s = transition(&s, ProvisionEvent::Progress { received: 50 });
        assert_eq!(
            s,
            ProvisionState::Downloading {
                received: 50,
                total: 100
            }
        );
        s = transition(&s, ProvisionEvent::DownloadComplete);
        assert_eq!(s, ProvisionState::Verifying);
        s = transition(&s, ProvisionEvent::ChecksumOk);
        assert_eq!(s, ProvisionState::Extracting);
        s = transition(
            &s,
            ProvisionEvent::Extracted {
                version: "1.0.0".into(),
            },
        );
        assert!(s.is_ready() && s.is_terminal());
    }

    #[test]
    fn checksum_failure_is_terminal_failed() {
        let s = transition(&ProvisionState::Verifying, ProvisionEvent::ChecksumFailed);
        assert!(matches!(s, ProvisionState::Failed { .. }));
        assert!(s.is_terminal());
    }

    #[test]
    fn errored_from_any_state_fails() {
        let s = transition(
            &ProvisionState::Downloading {
                received: 1,
                total: 2,
            },
            ProvisionEvent::Errored {
                reason: "net".into(),
            },
        );
        assert_eq!(
            s,
            ProvisionState::Failed {
                reason: "net".into()
            }
        );
    }

    #[test]
    fn illegal_transition_fails_loud_not_panics() {
        let s = transition(&ProvisionState::Missing, ProvisionEvent::ChecksumOk);
        assert!(matches!(s, ProvisionState::Failed { .. }));
    }

    #[test]
    fn verify_checksum_matches_known_sha256() {
        // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        let ok = verify_checksum(
            b"hello",
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        );
        assert!(ok);
        assert!(verify_checksum(
            b"hello",
            "2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824"
        ));
        assert!(!verify_checksum(b"hello", "deadbeef"));
    }
}
