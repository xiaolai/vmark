//! Agent edit journal — the durable, single-writer record of every document
//! revision an agent or a human produced, and the review state over it.
//!
//! Purpose: one append-only journal per installation, under the app-data
//! directory, that survives crashes and restarts and that every window
//! hydrates from. Nothing here touches the user's document folders.
//!
//! Layering, bottom up:
//! - `frame` — length + checksum framing, torn-tail scan (pure).
//! - `codec` — versioned envelope decoder (`codec_v1` upgrades v1; `admission` frames, receipts).
//! - `journal_file`, `blob_store` — durable append, fsync, compaction (I/O).
//! - `projection` — replay records into state; shared by live and restart.
//! - `review_rules`, `review_slots`, `review_matrix`, `pins` — pure rules over the projection.
//! - `provenance` — the capture-window accumulator and its persisted
//!   payload. `span_map`, `effects_rules`, `revert_gate` — spans mapped only
//!   through certified provenance, sticky blocks where a break reached
//!   them, capture transitions, and the `AMBIGUOUS_REVERT` gate (pure).
//! - `hunk_id`, `u64_wire`, `wire` — the formats shared with the TypeScript
//!   side, pinned by `src/test/fixtures/agentJournal/*.json`.
//! - `writer*` — the single writer: reservations, parent CAS, degraded
//!   queue, generation + broadcast, pin roots; `writer_epoch` (editing
//!   epochs, payload rules), `writer_revert` (the exact revert), `certificate`
//!   (selection edits). `hydration` — the window-side consumer of a snapshot plus the broadcast.
//! - `controlled` (its wire shapes in `controlled_wire`), `doc_registry`, `degraded_drain`, `refusal`, `commands`
//!   — the MCP edit tools as a window drives them over IPC: prepare,
//!   commit, abort, and the background drain of a degraded document.
//! - `capture` — a file save recorded as an observation and linearized onto
//!   the head (also after a held prepare settles, a drain, and a restart);
//!   `capture_seq` refuses a capture whose seq does not advance.
//! - `doc_key`, `doc_index`, `doc_renames`, `service_identity` — durable document identity:
//!   entry-spelling keys, the persisted key-to-UUID op log, and binds on Save As,
//!   rename and an external rename.
//! - `controlled_restore`, `controlled_revert`, `controller_history`, `controller_checkpoints`, `controller_doc_history`, `controller_concurrent_pair`,
//!   `commands_history` — restore, hunk revert, the uncommitted list, the history panel's revisions, a two-window save's both pairs, its checkpoints and review decisions over IPC.
//!   `generation_events` — the writer's broadcast as one coalesced Tauri event, so every window's panel re-reads when the journal changes.
//! - `gc_policy` — the collector's caps and warnings. `service_gc`, `service_legacy` — the startup retention pass and the retirement of the old checkpoint JSONL after a verified import.
//! - `git_export` — one document's journal exported to the Git branch `vmark-journal/<document-uuid>` with plumbing and a compare-and-swap.
//! - `comment_anchor` — a comment's quote, context and heading path, created from a selection and resolved in later revisions (pure); `comment` — comment threads: records, bounds, storage, the caller-class entry points and the comment list, and the two comment command families (`comment::commands_user`, `comment::commands_agent`), one per caller class.
//!
//! Key decisions:
//!   - `pub mod`: the API is consumed by the editor wiring that lands next;
//!     until then only tests and the startup task call most of it.
//!   - The collector (`writer_gc`, planned by `gc_plan`, rewritten by
//!     `gc_compact`) deletes only what `pins` does not reach.
//!
//! @module agent_journal

pub mod actor;
pub mod admission;
pub mod blob_store;
pub mod capture;
pub mod capture_seq;
pub mod codec;
mod codec_v1;
pub mod commands;
pub mod commands_history;
pub mod comment;
pub mod comment_anchor;
pub mod controlled;
pub mod controlled_restore;
pub mod controlled_revert;
pub mod controlled_wire;
pub mod controller;
pub mod controller_checkpoints;
pub mod controller_concurrent_pair;
pub mod controller_doc_history;
pub mod controller_history;
pub mod degraded_drain;
pub mod doc_index;
pub mod doc_key;
pub mod doc_registry;
mod doc_renames;
pub mod effects_rules;
pub mod errors;
pub mod faults;
pub mod frame;
mod gc_compact;
pub mod gc_plan;
pub mod gc_policy;
pub mod generation_events;
pub mod git_export;
pub mod hunk_id;
pub mod hydration;
pub mod ids;
pub mod journal_file;
mod journal_rewrite;
pub mod legacy_import;
pub mod pins;
pub mod projection;
mod projection_apply;
mod projection_checks;
mod projection_records;
mod projection_steps;
pub mod provenance;
pub mod provenance_field;
pub mod record;
pub mod refusal;
pub mod revert_gate;
pub mod review;
pub mod review_matrix;
pub mod review_rules;
pub mod review_slots;
mod schema_table;
pub mod service;
pub mod service_gc;
pub mod service_identity;
pub mod service_legacy;
pub mod span_map;
pub mod text;
pub mod u64_wire;
pub mod wire;
pub mod writer;
mod writer_base;
mod writer_budget;
pub mod writer_checkpoints;
mod writer_commit_window;
mod writer_degraded;
mod writer_derive;
pub mod writer_epoch;
pub mod writer_gc;
mod writer_legacy;
mod writer_observe;
mod writer_pins;
mod writer_reads;
pub mod writer_revert;
mod writer_review;
mod writer_txn;
mod writer_types;
mod writer_window;
mod writer_wire;

#[cfg(test)]
#[path = "test_golden_prov.test.rs"]
mod test_golden_prov;
#[cfg(test)]
#[path = "test_review_helpers.test.rs"]
mod test_review_helpers;
#[cfg(test)]
#[path = "test_support.test.rs"]
mod test_support;

#[cfg(test)]
#[path = "admission.test.rs"]
mod admission_tests;
#[cfg(test)]
#[path = "binding.test.rs"]
mod binding_tests;
#[cfg(test)]
#[path = "blob_stream.test.rs"]
mod blob_stream_tests;
#[cfg(test)]
#[path = "capture_claims.test.rs"]
mod capture_claims_tests;
#[cfg(test)]
#[path = "capture.test.rs"]
mod capture_tests;
#[cfg(test)]
#[path = "capture_trust.test.rs"]
mod capture_trust_tests;
#[cfg(test)]
#[path = "checkpoints.test.rs"]
mod checkpoints_tests;
#[cfg(test)]
#[path = "controlled_commit_failure.test.rs"]
mod controlled_commit_failure_tests;
#[cfg(test)]
#[path = "controlled_provenance.test.rs"]
mod controlled_provenance_tests;
#[cfg(test)]
#[path = "controlled.test.rs"]
mod controlled_tests;
#[cfg(test)]
#[path = "controller_checkpoints.test.rs"]
mod controller_checkpoints_tests;
#[cfg(test)]
#[path = "controller_doc_history.test.rs"]
mod controller_doc_history_tests;
#[cfg(test)]
#[path = "controller_history.test.rs"]
mod controller_history_tests;
#[cfg(test)]
#[path = "controller.test.rs"]
mod controller_tests;
#[cfg(test)]
#[path = "degraded_drain.test.rs"]
mod degraded_drain_tests;
#[cfg(test)]
#[path = "degraded_writer.test.rs"]
mod degraded_writer_tests;
#[cfg(test)]
#[path = "doc_index.test.rs"]
mod doc_index_tests;
#[cfg(test)]
#[path = "doc_key.test.rs"]
mod doc_key_tests;
#[cfg(test)]
#[path = "durability.test.rs"]
mod durability_tests;
#[cfg(test)]
#[path = "failure_modes.test.rs"]
mod failure_modes_tests;
#[cfg(test)]
#[path = "gc.test.rs"]
mod gc_tests;
#[cfg(test)]
#[path = "generation_events.test.rs"]
mod generation_events_tests;
#[cfg(test)]
#[path = "golden.test.rs"]
mod golden_tests;
#[cfg(test)]
#[path = "identity_service.test.rs"]
mod identity_service_tests;
#[cfg(test)]
#[path = "identity.test.rs"]
mod identity_tests;
#[cfg(test)]
#[path = "legacy_import.test.rs"]
mod legacy_import_tests;
#[cfg(test)]
#[path = "observations.test.rs"]
mod observations_tests;
#[cfg(test)]
#[path = "observed_base_replay.test.rs"]
mod observed_base_replay_tests;
#[cfg(test)]
#[path = "pins.test.rs"]
mod pins_tests;
#[cfg(test)]
#[path = "protocol.test.rs"]
mod protocol_tests;
#[cfg(test)]
#[path = "provenance_admission.test.rs"]
mod provenance_admission_tests;
#[cfg(test)]
#[path = "provenance_barriers.test.rs"]
mod provenance_barriers_tests;
#[cfg(test)]
#[path = "provenance_bounds.test.rs"]
mod provenance_bounds_tests;
#[cfg(test)]
#[path = "provenance_capture.test.rs"]
mod provenance_capture_tests;
#[cfg(test)]
#[path = "provenance_epochs.test.rs"]
mod provenance_epochs_tests;
#[cfg(test)]
#[path = "provenance_review_golden.test.rs"]
mod provenance_review_golden_tests;
#[cfg(test)]
#[path = "provenance_schema.test.rs"]
mod provenance_schema_tests;
#[cfg(test)]
#[path = "provenance.test.rs"]
mod provenance_tests;
#[cfg(test)]
#[path = "provenance_writer_golden.test.rs"]
mod provenance_writer_golden_tests;
#[cfg(test)]
#[path = "races.test.rs"]
mod races_tests;
#[cfg(test)]
#[path = "restore.test.rs"]
mod restore_tests;
#[cfg(test)]
#[path = "retire.test.rs"]
mod retire_tests;
#[cfg(test)]
#[path = "review_gen.test.rs"]
mod review_gen_tests;
#[cfg(test)]
#[path = "review.test.rs"]
mod review_tests;
#[cfg(test)]
#[path = "schema.test.rs"]
mod schema_tests;
#[cfg(test)]
#[path = "service_gc.test.rs"]
mod service_gc_tests;
#[cfg(test)]
#[path = "service.test.rs"]
mod service_tests;
#[cfg(test)]
#[path = "spans.test.rs"]
mod spans_tests;
#[cfg(test)]
#[path = "stages.test.rs"]
mod stages_tests;
#[cfg(test)]
#[path = "test_hooks.test.rs"]
mod test_hooks_tests;
#[cfg(test)]
#[path = "transitions.test.rs"]
mod transitions_tests;
#[cfg(test)]
#[path = "window_convergence.test.rs"]
mod window_convergence_tests;
#[cfg(test)]
#[path = "wire_text.test.rs"]
mod wire_text_tests;
