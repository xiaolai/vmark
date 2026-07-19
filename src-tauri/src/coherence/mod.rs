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

pub mod accept;
pub mod accept_group;
pub mod accept_precondition;
pub mod adopt;
pub mod canonical;
pub mod capture;
pub mod cas;
pub mod check_commands;
pub mod check_sweep;
pub mod check_sweep_command;
pub mod check_sweep_run;
pub mod checker;
pub mod claim_commands;
pub mod claims;
pub mod commands;
pub mod context_commands;
pub mod contexts;
pub mod dag;
pub mod delegation;
pub mod delegation_commands;
pub mod edge_kind;
pub mod envelope;
pub mod frontmatter;
pub mod gitops;
pub mod index;
pub mod index_checks;
pub mod index_query;
pub mod index_row;
pub(crate) mod index_state;
pub mod ledger;
pub mod merge_audit;
pub mod merge_surface;
pub mod operator;
pub mod operator_accept;
pub mod operator_commands;
pub mod paths;
pub mod preview;
pub mod project;
pub mod provenance;
pub mod provenance_commands;
pub mod read_view;
pub mod scan;
pub(crate) mod scan_diagnostics;
pub(crate) mod scan_walk;
pub mod state;
pub mod types;
