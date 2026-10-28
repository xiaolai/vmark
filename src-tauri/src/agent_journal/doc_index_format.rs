//! The identity index's on-disk format: the version header every log
//! starts with, and the operation lines after it.
//!
//! Key decisions:
//!   - The first line names the format version and the key policy (how a
//!     path becomes a key). A log is replayed only when both are exactly
//!     this build's. Anything else — a headerless log, a missing field, an
//!     incomplete header, another version — is `Incompatible`, judged
//!     before any repair, replay, compaction or append, so the file is left
//!     byte-for-byte as it was. There is no migration and no reset.
//!   - The key policy has no folding tables to version: keys are the
//!     directory entry's stored spelling (`files/entry_spelling.rs`). A
//!     change to how a key is spelled is a new `KEY_POLICY`.
//!   - A header anywhere but the first line is not an operation: the body
//!     parse rejects it as damage.
//!
//! @coordinates-with agent_journal/doc_index.rs — writes and replays the log
//! @module agent_journal/doc_index_format

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{IndexEntry, IndexError};

/// The index format this build reads and writes.
pub const FORMAT_VERSION: u32 = 1;
/// How this build turns a path into a key.
pub const KEY_POLICY: &str = "entry-spelling-1";

/// The first line of every index this build writes, newline included.
pub fn header_line() -> String {
    format!("{{\"op\":\"header\",\"format\":{FORMAT_VERSION},\"keyPolicy\":\"{KEY_POLICY}\"}}\n")
}

fn expected() -> String {
    format!("{FORMAT_VERSION}/{KEY_POLICY}")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    op: String,
    format: u32,
    key_policy: String,
}

/// The length of `bytes`'s header line, newline included, when it is this
/// build's. Pure: nothing is written.
///
/// # Errors
/// `Incompatible`, naming what was found: `incomplete` (no whole first
/// line), `unversioned` (a first line that is not a header),
/// `unreadable` (a header missing or mistyping a field), or the
/// header's own `format/policy`.
pub fn check_header(bytes: &[u8]) -> Result<usize, IndexError> {
    let incompatible = |found: String| IndexError::Incompatible {
        found,
        expected: expected(),
    };
    let Some(end) = bytes.iter().position(|&b| b == b'\n') else {
        return Err(incompatible("incomplete".into()));
    };
    let first = &bytes[..end];
    let header: Header = match serde_json::from_slice::<Header>(first) {
        Ok(h) if h.op == "header" => h,
        Ok(_) => return Err(incompatible("unversioned".into())),
        Err(_) => {
            let tagged = serde_json::from_slice::<serde_json::Value>(first)
                .is_ok_and(|v| v.get("op").and_then(|o| o.as_str()) == Some("header"));
            let found = if tagged { "unreadable" } else { "unversioned" };
            return Err(incompatible(found.into()));
        }
    };
    if header.format != FORMAT_VERSION || header.key_policy != KEY_POLICY {
        return Err(incompatible(format!(
            "{}/{}",
            header.format, header.key_policy
        )));
    }
    Ok(end + 1)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum Op {
    Put {
        key: String,
        entry: IndexEntry,
    },
    Move {
        from: String,
        to: String,
        entry: IndexEntry,
    },
}

pub(super) fn line(op: &Op) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(op).expect("index ops always serialize");
    bytes.push(b'\n');
    bytes
}

pub(super) fn apply(entries: &mut BTreeMap<String, IndexEntry>, op: Op) {
    match op {
        Op::Put { key, entry } => {
            entries.insert(key, entry);
        }
        Op::Move { from, to, entry } => {
            entries.remove(&from);
            entries.insert(to, entry);
        }
    }
}
