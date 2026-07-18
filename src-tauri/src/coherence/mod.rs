//! Coherence layer kernel (spec: dev-docs/specs/coherence-format-v0.md;
//! plan: dev-docs/plans/20260718-coherence-layer.md).
//!
//! Module boundaries per ADR-C4:
//! - Pure kernel (no I/O): `types`, `canonical`, `dag`, `project`
//! - Storage (filesystem + SQLite): `ledger`, `cas`, `index`
//! - Services: `scan`, `capture`, `gitops`, `frontmatter`, `state`,
//!   `commands` (Tauri surface)
//!
//! Invariants: every write is a Transformation (I1); history is
//! append-only (I2); origin provenance is immutable and resolutions are
//! append-only records (I5). No module exposes a mutating API over
//! recorded history — the only writes are appends.

pub mod adopt;
pub mod canonical;
pub mod capture;
pub mod cas;
pub mod check_commands;
pub mod checker;
pub mod claim_commands;
pub mod claims;
pub mod commands;
pub mod context_commands;
pub mod contexts;
pub mod dag;
pub mod envelope;
pub mod frontmatter;
pub mod gitops;
pub mod index;
pub mod index_checks;
pub mod index_query;
pub mod index_row;
pub(crate) mod index_state;
pub mod ledger;
pub mod paths;
pub mod project;
pub mod provenance;
pub mod scan;
pub(crate) mod scan_walk;
pub mod state;
pub mod types;
