//! Wire types for the context surface, plus the on-disk location and enforcement
//! naming they depend on.
//!
//! Split out of `context_commands.rs` for size: the shapes crossing IPC, separated
//! from the commands that produce them.
//!
//! @coordinates-with context_commands.rs — the module this was split from
//! @module coherence/context_types

use serde::Serialize;
use uuid::Uuid;

use super::contexts::Enforcement;
use super::state::WorkspaceKernel;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRow {
    pub id: Uuid,
    pub name: String,
    pub parent: Option<Uuid>,
    pub enforcement: String,
    pub visible_claims: usize,
    /// Per-file load errors and structural chain errors, surfaced.
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextReceipt {
    pub id: Uuid,
}

pub(super) fn contexts_dir(kernel: &WorkspaceKernel) -> std::path::PathBuf {
    kernel.root().join(".vmark").join("contexts")
}

pub(super) fn enforcement_str(e: Enforcement) -> &'static str {
    match e {
        Enforcement::Enforcing => "enforcing",
        Enforcement::Greenhouse => "greenhouse",
    }
}
