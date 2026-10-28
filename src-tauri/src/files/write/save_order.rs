//! Saves to one file land in the order they were asked for.
//!
//! Purpose: the frontend queues saves per path SPELLING, so a document's
//! autosave through a symlink and its Save As onto the symlink's referent run
//! in two queues, and the per-file lock (`target_lock.rs`) orders them only
//! by Rust admission. The older one, admitted second, would publish last: the
//! disk holds older text while the document reads as saved. Every save names
//! when it was asked for (`SaveOrder`); under the file's lock a save older
//! than one already published there is refused as `superseded`, and nothing
//! is written.
//!
//! Key decisions:
//! - Keyed by the file alone. The sequence is a hybrid logical clock the
//!   webview issues (`saveTargetClaim.ts`): wall-clock time, never below the
//!   last one it issued. So saves compare by when they were asked for across
//!   documents, a closed and reopened document, and windows — a tab moved to
//!   another window included — and the last one asked for wins. Each window
//!   keeps its own clock, which reads whole milliseconds, so two windows'
//!   saves to one file within the same millisecond, or with the clock
//!   stepping back between them, are ordered arbitrarily.
//! - The refusal carries the newest sequence (`detail.newest`); the webview
//!   raises its clock to it, so a clock that stepped back loses once, not
//!   until wall time catches up. `detail.recorded` says whether that save
//!   reached this file or is the floor's, so a close can tell whether the
//!   file holds its own save.
//! - An equal sequence is refused: one webview never issues a sequence
//!   twice, so an equal one is another window's, and the file keeps the
//!   first to publish. Every sequence recorded for a file has one owner.
//! - Checked and recorded while the caller holds the file's lock, so no other
//!   writer of the file runs between the check and the publication.
//! - Recorded only after a publication succeeded: a refused or failed save
//!   supersedes nothing.
//! - Bounded: at most `CAPACITY` files, the least recently published
//!   dropped first. A dropped entry raises a floor that every file
//!   without an entry is checked against, so forgetting refuses an old
//!   save (it is retried with a new sequence) rather than letting it
//!   overwrite a newer one. The floor is a time `CAPACITY` files ago, so it
//!   refuses only a save asked for before all of them and still not written.
//! - A save with no order (an internal writer) is never refused and records
//!   nothing.
//!
//! Known limitations:
//! - Keyed by the lock key, which folds names more than a case-sensitive
//!   volume does (`Straße.md` and `STRASSE.md` share one). Two distinct files
//!   it folds together share one record: a save to one can be refused as
//!   superseded by a newer — or, from another window in the same millisecond,
//!   an equal — save to the other. It is refused, never overwritten.
//!
//! @coordinates-with files/write/target_lock.rs — the lock both run under
//! @coordinates-with src/services/persistence/saveTargetClaim.ts — issues the order
//! @module files/write/save_order

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard, OnceLock};

/// When a save was asked for, on the webview's hybrid logical clock.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveOrder {
    pub seq: u64,
}

/// JavaScript's largest exact integer: the webview cannot count past it.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Most files remembered.
pub(crate) const CAPACITY: usize = 1024;

#[derive(Default)]
struct Published {
    seqs: HashMap<String, u64>,
    /// The files in `seqs`, least recently published first: the one dropped
    /// at capacity.
    oldest_first: VecDeque<String>,
    /// The newest sequence among the dropped entries.
    floor: u64,
}

/// A static for the same reason as `target_lock`'s: the write core holds no
/// `AppHandle`, and every writer of a file must meet the same record.
static PUBLISHED: OnceLock<Mutex<Published>> = OnceLock::new();

fn published() -> MutexGuard<'static, Published> {
    PUBLISHED
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Refuse an order the webview could not have issued.
pub(crate) fn validate(order: &SaveOrder) -> Result<(), CommandError> {
    if order.seq == 0 || order.seq > MAX_SAFE_INTEGER {
        return Err(CommandError::invalid_input("save order: bad sequence"));
    }
    Ok(())
}

/// Refuse `order` unless it is newer than every save already published to
/// the file `key` names — or, with no entry for it, than the floor. An equal
/// sequence is another window's (one webview never issues one twice), so it
/// is refused too, and every sequence on a file has one owner. Call with the
/// file's lock held.
pub(crate) fn check(
    key: &str,
    order: &SaveOrder,
    target: &std::path::Path,
) -> Result<(), CommandError> {
    let book = published();
    let recorded = book.seqs.get(key).copied();
    let newest = recorded.unwrap_or(book.floor);
    if newest >= order.seq {
        return Err(superseded(target, newest, recorded.is_some()));
    }
    Ok(())
}

/// Record that `order` published to the file `key` names. Call with the
/// file's lock held, after the publication succeeded.
pub(crate) fn record(key: &str, order: &SaveOrder) {
    let mut book = published();
    if let Some(newest) = book.seqs.get_mut(key) {
        *newest = (*newest).max(order.seq);
        // Published again: it is now the most recent, so it is dropped last.
        if let Some(at) = book.oldest_first.iter().position(|k| k == key) {
            book.oldest_first.remove(at);
        }
        book.oldest_first.push_back(key.to_string());
        return;
    }
    if book.oldest_first.len() >= CAPACITY {
        if let Some(oldest) = book.oldest_first.pop_front() {
            if let Some(seq) = book.seqs.remove(&oldest) {
                book.floor = book.floor.max(seq);
            }
        }
    }
    book.oldest_first.push_back(key.to_string());
    book.seqs.insert(key.to_string(), order.seq);
}

/// Run `publish` unless `order` was superseded at the file `key` names, and
/// record `order` once it has published. Call with the file's lock held.
pub(crate) fn ordered(
    key: &str,
    order: Option<&SaveOrder>,
    target: &std::path::Path,
    publish: impl FnOnce() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    let Some(order) = order else { return publish() };
    check(key, order, target)?;
    publish()?;
    record(key, order);
    Ok(())
}

/// A save asked for later, `newest`, already reached `target` — or, when not
/// `recorded`, the floor: a save that reached some forgotten file.
fn superseded(target: &std::path::Path, newest: u64, recorded: bool) -> CommandError {
    localized_error!(
        ErrorCode::Conflict,
        "errors.save.superseded",
        path = target.display()
    )
    .with_detail(json!({
        "kind": "superseded",
        "path": target.to_string_lossy(),
        "newest": newest,
        "recorded": recorded,
    }))
}

#[cfg(test)]
#[path = "save_order.test.rs"]
mod tests;
