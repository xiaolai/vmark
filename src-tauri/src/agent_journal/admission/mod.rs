//! Admissions and request receipts (journal schemas v3 to v5: v4 adds the
//! revert receipts, v5 the comment receipts and admissions).
//!
//! - `receipt` — a prepare's request id, payload digest and stored reply,
//!   kept on its `prepared` so a retried request is answered from the
//!   journal instead of written twice.
//! - `answer` — the refusal a decoded request id gets: its state, the
//!   wire token that state maps to, and whether the caller is `uncertain`.
//! - `shape` — the static rules of an `admission` frame: a multi-record
//!   write (observations, their linearizations, a baseline, the outcome)
//!   persisted as one frame so it is durable whole or not at all.
//! - `observed_base` — the frozen predecessor a baseline is recorded on.
//! - `prepare`, `stage`, `publish` — a controlled prepare written as one
//!   top-level record or one staged admission frame, durable whole or not
//!   at all, answered from its receipt when retried.
//! - `reconcile` — the receipt lookup and the exhaustive classification of
//!   a receipted request's transaction.
//! - `reduce` — what `Projection::apply` checks before an admission's
//!   items, or a receipted record, reduce.
//! - `page_events`, `cleanup_worker` — a page load, a destroyed window or a
//!   replaced registration revokes generations and signals the one worker
//!   whose passes sweep what the revoked pages owned.
//!
//! @module agent_journal/admission

pub mod abandon;
pub mod answer;
pub(crate) mod blobs;
pub mod bound;
pub mod cleanup_worker;
pub(crate) mod framed;
pub mod identity;
pub(crate) mod observed_base;
pub mod owned;
pub mod page_events;
pub mod page_table;
pub(crate) mod payload;
pub(crate) mod prepare;
pub(crate) mod prepared_record;
pub(crate) mod publish;
pub mod receipt;
pub(crate) mod reconcile;
pub(crate) mod reduce;
pub mod requests;
pub mod shape;
pub(crate) mod stage;

#[cfg(test)]
#[path = "../admission_shape.test.rs"]
mod admission_shape_tests;

#[cfg(test)]
#[path = "../admission_receipts.test.rs"]
mod admission_receipts_tests;

#[cfg(test)]
#[path = "../admission_support.test.rs"]
pub(crate) mod admission_support;

#[cfg(test)]
#[path = "../admission_outcomes.test.rs"]
mod admission_outcomes_tests;

#[cfg(test)]
#[path = "../admission_staging.test.rs"]
mod admission_staging_tests;

#[cfg(test)]
#[path = "../admission_replay.test.rs"]
mod admission_replay_tests;

#[cfg(test)]
#[path = "../admission_compaction.test.rs"]
mod admission_compaction_tests;

#[cfg(test)]
#[path = "../receipt_fixtures.test.rs"]
mod receipt_fixtures_tests;

#[cfg(test)]
#[path = "../admission_torn.test.rs"]
mod admission_torn_tests;

#[cfg(test)]
#[path = "../admission_clone_cost.test.rs"]
mod admission_clone_cost_tests;
#[cfg(test)]
#[path = "../revert_admission.test.rs"]
mod revert_admission_tests;
#[cfg(test)]
#[path = "../revert_compaction_crash.test.rs"]
mod revert_compaction_crash_tests;
#[cfg(test)]
#[path = "../revert_differential.test.rs"]
mod revert_differential_tests;
#[cfg(test)]
#[path = "../revert_receipts.test.rs"]
mod revert_receipts_tests;
#[cfg(test)]
#[path = "../revert_refusal_retention.test.rs"]
mod revert_refusal_retention_tests;
#[cfg(test)]
#[path = "../revert_support.test.rs"]
mod revert_support;

#[cfg(test)]
#[path = "../request_commit.test.rs"]
mod request_commit_tests;

#[cfg(test)]
#[path = "../page_table.test.rs"]
pub(crate) mod page_table_tests;

#[cfg(test)]
#[path = "../request_support.test.rs"]
pub(crate) mod request_support;

#[cfg(test)]
#[path = "../request_inflight.test.rs"]
mod request_inflight_tests;

#[cfg(test)]
#[path = "../request_order.test.rs"]
mod request_order_tests;

#[cfg(test)]
#[path = "../request_bounds.test.rs"]
mod request_bounds_tests;

#[cfg(test)]
#[path = "../request_text.test.rs"]
mod request_text_tests;

#[cfg(test)]
#[path = "../request_abandon.test.rs"]
mod request_abandon_tests;

#[cfg(test)]
#[path = "../request_sweep.test.rs"]
mod request_sweep_tests;

#[cfg(test)]
#[path = "../request_pages.test.rs"]
mod request_pages_tests;

#[cfg(test)]
#[path = "../request_restart.test.rs"]
mod request_restart_tests;

#[cfg(test)]
#[path = "../duplicate_requests.test.rs"]
mod duplicate_requests_tests;

#[cfg(test)]
#[path = "../request_settle.test.rs"]
mod request_settle_tests;

#[cfg(test)]
#[path = "../lifecycle_support.test.rs"]
pub(crate) mod lifecycle_support;

#[cfg(test)]
#[path = "../cleanup_worker.test.rs"]
mod cleanup_worker_tests;

#[cfg(test)]
#[path = "../page_lifecycle.test.rs"]
mod page_lifecycle_tests;

#[cfg(test)]
#[path = "../owner_death.test.rs"]
mod owner_death_tests;

#[cfg(test)]
#[path = "../request_abandon_race.test.rs"]
mod request_abandon_race_tests;

#[cfg(test)]
#[path = "../expected_head.test.rs"]
mod expected_head_tests;
#[cfg(test)]
#[path = "../revert_commit.test.rs"]
mod revert_commit_tests;

#[cfg(test)]
#[path = "../revert_controller.test.rs"]
mod revert_controller_tests;

#[cfg(test)]
#[path = "../review_op_table.test.rs"]
mod review_op_table_tests;
#[cfg(test)]
#[path = "../review_restart.test.rs"]
mod review_restart_tests;
#[cfg(test)]
#[path = "../review_revert.test.rs"]
mod review_revert_tests;
#[cfg(test)]
#[path = "../review_span_gc.test.rs"]
mod review_span_gc_tests;
