//! Wire types for the coherence command surface, plus actor identity and the
//! timestamp format they carry.
//!
//! Split out of `commands.rs` for size: the shapes crossing IPC, separated from
//! the commands that produce them.
//!
//! @coordinates-with commands.rs — the module this was split from
//! @module coherence/command_types

use uuid::Uuid;

use super::types::WriterId;
use crate::ai_provider::build_command;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ResolveRequest {
    /// "accept-newer" appends a ratification; "waive" appends a waiver.
    pub action: String,
    pub txf: Uuid,
    pub input: u32,
    #[serde(default)]
    pub reason: Option<String>,
    /// D3.2: optional waiver expiry (RFC 3339); projection treats an
    /// expired waiver as absent, the record stays in history.
    #[serde(default)]
    pub expires: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ResolveReceipt {
    pub entry_id: Uuid,
    pub kind: String,
    pub resolved_against: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CoherenceStatus {
    pub initialized: bool,
    pub objects: usize,
    pub open_items: usize,
    pub quarantined: usize,
    pub writer: WriterId,
}

pub(super) fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// v1 actor identity (spec §5.4.3): git user.name, else OS username.
/// Never blank.
pub fn actor_identity(root: &std::path::Path) -> String {
    if let Ok(out) = build_command("git", &["config", "user.name"])
        .current_dir(root)
        .output()
    {
        if out.status.success() {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown-human".to_string())
}
