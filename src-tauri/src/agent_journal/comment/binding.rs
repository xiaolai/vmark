//! Static comment invariants, checked on every decode (`codec::check_shape`)
//! and before every append, so the writer and replay agree byte for byte:
//!
//! - `c<seq>` and `r<seq>` are minted from the envelope's own sequence;
//! - a committed record's or tombstone's addresses are at most
//!   `MAX_ADDRESSES`, each named once (`addresses::check_set`);
//! - a body is non-empty and within `MAX_BODY_BYTES`;
//! - a stored anchor keeps its bounds (quote, 32-unit prefix and suffix,
//!   heading path) and its offset hint names the creation revision;
//! - a `commentState` edge is one some caller may take, and that caller
//!   may take it; only the user deletes;
//! - a receipt's stored answer names its record: document, ids, revision
//!   and text hash, `generation == seq`, `commentGen` 0 for a create and
//!   `expectedCommentGen + 1` for a reply.
//!
//! What depends on the thread's history (its state, generation, the
//! creation revision) is the book's to check (`comment::book`).
//!
//! Key decisions:
//!   - An anchor's content (quote, context, heading path, hint offset) is
//!     not re-derived from the creation text on replay: the writer derives
//!     it from that text, the book binds the record to the text's hash, the
//!     text may since have been collected, and re-deriving every anchor
//!     would read every creation text at open. Resolving trusts nothing
//!     else in it: a hint only breaks a tie among the quote's real matches,
//!     so an anchor that does not describe its text orphans its own thread
//!     or lands where its own quote occurs, never past the text.
//!
//! @module agent_journal/comment/binding

use crate::agent_journal::comment::addresses::check_set;
use crate::agent_journal::comment::bounds::{check_body, MAX_BODY_BYTES};
use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ReplyId};
use crate::agent_journal::comment::records::{CommentCreated, CommentRecord};
use crate::agent_journal::comment::replies::{CommentCreatedReply, CommentRepliedReply};
use crate::agent_journal::comment::rules::{allowed, state_action};
use crate::agent_journal::comment_anchor::{StoredAnchor, CONTEXT_UNITS, MAX_QUOTE_UTF8_BYTES};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::record::{Envelope, Record};
use crate::coherence::anchors::{MAX_PATH_SEGMENTS, MAX_SEGMENT_BYTES};

/// Refuse a comment record that breaks a static invariant.
pub fn check(env: &Envelope) -> Result<(), TxnError> {
    let corrupt = |why: String| TxnError::Corrupt(format!("seq {}: {why}", env.seq));
    if let Record::Committed { addresses, .. } | Record::Tombstone { addresses, .. } = &env.record {
        check_set(addresses).map_err(|why| corrupt(format!("addresses: {why}")))?;
    }
    let Some(rec) = CommentRecord::of(&env.record) else {
        return Ok(());
    };
    let body = |b: &str| {
        check_body(b)
            .map_err(|_| corrupt(format!("a body is empty or over {MAX_BODY_BYTES} bytes")))
    };
    match rec {
        CommentRecord::Created(c) => {
            if c.comment != CommentId::at(env.seq) {
                return Err(corrupt(format!("{} is not minted at its seq", c.comment)));
            }
            body(&c.body)?;
            anchor(c).map_err(|why| corrupt(why.into()))
        }
        CommentRecord::Replied(r) => {
            if r.reply != ReplyId::at(env.seq) {
                return Err(corrupt(format!("{} is not minted at its seq", r.reply)));
            }
            body(&r.body)
        }
        CommentRecord::State(s) => {
            let legal = state_action(s.from, s.to)
                .is_some_and(|a| allowed(a, s.caller, s.from) == Some(s.to));
            if !legal {
                return Err(corrupt(format!(
                    "{:?} → {:?} is no edge for {:?}",
                    s.from, s.to, s.caller
                )));
            }
            Ok(())
        }
        CommentRecord::Deleted(d) if d.caller != CommentCaller::User => {
            Err(corrupt("only the user deletes a thread".into()))
        }
        CommentRecord::Deleted(_) => Ok(()),
    }
}

/// A heading path within `MAX_PATH_SEGMENTS` × `MAX_SEGMENT_BYTES`.
pub fn heading_path_fits(path: &[String]) -> bool {
    path.len() <= MAX_PATH_SEGMENTS && path.iter().all(|s| s.len() <= MAX_SEGMENT_BYTES)
}

fn anchor(c: &CommentCreated) -> Result<(), &'static str> {
    let StoredAnchor {
        quote,
        prefix,
        suffix,
        heading_path,
        hint,
    } = &c.anchor;
    let units = |s: &str| s.encode_utf16().count();
    if quote.len() > MAX_QUOTE_UTF8_BYTES {
        return Err("an anchor quote is over its bound");
    }
    if units(prefix) > CONTEXT_UNITS || units(suffix) > CONTEXT_UNITS {
        return Err("an anchor prefix or suffix is over 32 UTF-16 units");
    }
    if !heading_path_fits(heading_path) {
        return Err("an anchor heading path is over its bound");
    }
    match hint {
        Some(h) if h.revision == c.revision => Ok(()),
        _ => Err("an anchor's offset hint does not name the creation revision"),
    }
}

/// A created thread's stored answer names its record (module docs).
pub fn created_receipt(env: &Envelope, r: &CommentCreatedReply) -> Result<(), TxnError> {
    let ok = matches!(&env.record, Record::CommentCreated(c)
        if (c.doc, c.comment, c.revision, &c.text_hash) == (r.doc, r.comment, r.revision, &r.text_hash))
        && r.generation == env.seq
        && r.comment_gen == 0;
    bound(env, ok)
}

/// A reply's stored answer names its record (module docs).
pub fn replied_receipt(env: &Envelope, r: &CommentRepliedReply) -> Result<(), TxnError> {
    let ok = matches!(&env.record, Record::CommentReplied(c)
        if (c.doc, c.comment, c.reply) == (r.doc, r.comment, r.reply)
            && c.expected_comment_gen.checked_add(1) == Some(r.comment_gen))
        && r.generation == env.seq;
    bound(env, ok)
}

fn bound(env: &Envelope, ok: bool) -> Result<(), TxnError> {
    if ok {
        Ok(())
    } else {
        Err(TxnError::Corrupt(format!(
            "seq {}: the receipt names another comment record",
            env.seq
        )))
    }
}
