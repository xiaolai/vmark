//! Comment identities and the closed enums a comment record carries.
//!
//! A comment id is `c<seq>` and a reply id `r<seq>`: the journal sequence
//! of the record that created it, in canonical decimal (no sign, no
//! leading zero). The writer mints both, so an id is never chosen by a
//! caller, and since sequences never repeat (the generation floor survives
//! compaction) a deleted id is never minted again. Decode and staging
//! bind each id to its own envelope's `seq` (`binding`).
//!
//! @module agent_journal/comment/ids

use std::fmt;

use serde::{Deserialize, Serialize};

macro_rules! seq_id {
    ($name:ident, $prefix:literal, $what:literal) => {
        #[doc = concat!("A ", $what, " id: `", $prefix, "` and the sequence of the record that created it.")]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(u64);

        impl $name {
            /// The id minted by the record at `seq`.
            pub fn at(seq: u64) -> Self {
                Self(seq)
            }

            /// The sequence the id names.
            pub fn seq(self) -> u64 {
                self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = String;
            fn try_from(s: String) -> Result<Self, String> {
                s.strip_prefix($prefix)
                    .and_then(crate::agent_journal::u64_wire::parse)
                    .map(Self)
                    .ok_or_else(|| format!(concat!("not a canonical ", $what, " id: {:?}"), s))
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> String {
                id.to_string()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, concat!($prefix, "{}"), self.0)
            }
        }
    };
}

seq_id!(CommentId, "c", "comment");
seq_id!(ReplyId, "r", "reply");

/// Who acted, chosen by the controller entry point the call arrived on and
/// never decoded from a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommentCaller {
    User,
    Agent,
}

/// A thread's state. Deletion is a record of its own, not a state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadState {
    Open,
    Addressed,
    Resolved,
    Reopened,
}

impl CommentCaller {
    pub const ALL: [Self; 2] = [Self::User, Self::Agent];
}

impl ThreadState {
    pub const ALL: [Self; 4] = [Self::Open, Self::Addressed, Self::Resolved, Self::Reopened];
}
