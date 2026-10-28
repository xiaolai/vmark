//! Comment threads (schema v5): records, the state machine, bounds and the
//! book the projection keeps of every retained thread.
//!
//! - `ids`, `records`, `replies`: the persisted and answered shapes.
//! - `addresses`: the set of comments a controlled write says it addresses.
//! - `rules`: who may do what from which state; `commentGen` exhaustion.
//! - `bounds`: the caps and the bytes each record is charged.
//! - `binding`: invariants of one record, checked on decode and append.
//! - `thread`: one thread's state and charges, and the checked step.
//! - `book`: per-thread state and usage, shared by the writer and replay.
//! - `text`: what each undeleted thread says, kept beside the book.
//! - `list`: the comment list a window reads, each anchor resolved.
//! - `wire`: the request bodies the handles decode.
//! - `create`, `ops`: creating, replying to and changing a thread under the
//!   writer lock; a create on unsaved text stages a schema-5 admission.
//! - `entry`: the user and agent handles on the controller. The handle a
//!   call arrives on is its caller; no request names one.
//! - `commands_user`, `commands_agent`: the two Tauri command families over
//!   those handles, one per caller class.
//!
//! @module agent_journal/comment

pub mod addresses;
pub mod binding;
pub mod book;
pub mod bounds;
pub mod commands_agent;
pub mod commands_user;
pub mod create;
pub mod entry;
pub mod ids;
pub mod list;
pub mod ops;
pub mod records;
pub mod replies;
pub mod rules;
pub mod text;
pub mod thread;
pub mod wire;

#[cfg(test)]
#[path = "../comment_support.test.rs"]
pub(crate) mod comment_support;

#[cfg(test)]
#[path = "../comment_bounds.test.rs"]
mod comment_bounds_tests;

#[cfg(test)]
#[path = "../comment_storage.test.rs"]
mod comment_storage_tests;

#[cfg(test)]
#[path = "../comment_addresses.test.rs"]
mod comment_addresses_tests;
#[cfg(test)]
#[path = "../comment_admission.test.rs"]
mod comment_admission_tests;
#[cfg(test)]
#[path = "../comment_list_cost.test.rs"]
mod comment_list_cost_tests;
#[cfg(test)]
#[path = "../comment_list.test.rs"]
mod comment_list_tests;
#[cfg(test)]
#[path = "../comment_physical.test.rs"]
mod comment_physical_tests;
#[cfg(test)]
#[path = "../comment_receipts.test.rs"]
mod comment_receipts_tests;
#[cfg(test)]
#[path = "../comment_replay.test.rs"]
mod comment_replay_tests;
#[cfg(test)]
#[path = "../comment_rules.test.rs"]
pub(crate) mod comment_rules_tests;
