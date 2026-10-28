//! The comment list a window reads: every undeleted thread of a document,
//! oldest first, with its state, `commentGen`, text and replies, and its
//! anchor resolved against the text the window holds now.
//!
//! Key decisions:
//!   - The window sends its buffer (`{docKey, text}`); the anchor is
//!     resolved against exactly that text. The offset hint applies only
//!     when that text is the head's and the head is the creation revision
//!     (`comment_anchor::resolve`), so a thread whose creation revision was
//!     collected resolves with no hint (R36, reopen after GC).
//!   - `creationRetained` says whether the creation revision's text is
//!     still kept; a collected one reads "creation revision no longer
//!     retained" in the panel.
//!   - A key the journal has never seen lists nothing and is not minted.
//!   - The lock is held only to copy the threads (an `Arc` per text); the
//!     window's text is hashed before it is taken and resolved after it is
//!     released, so a long document never stalls
//!     the writer. All anchors are resolved together (`resolve_all`): the
//!     text is encoded and its headings read once per list, so the cost is
//!     linear in threads plus text, not their product.
//!   - An undeleted thread whose text the book lacks is journal corruption
//!     (`JOURNAL_CORRUPT`): the list fails rather than hide the thread.
//!
//! @module agent_journal/comment/list

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ReplyId, ThreadState};
use crate::agent_journal::comment::text::ThreadText;
use crate::agent_journal::comment_anchor::{resolve_all, Resolution, StoredAnchor};
use crate::agent_journal::controller::{decode, Controller};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::refusal::refusal;
use crate::command_error::CommandError;

/// List a document's threads against the window's text.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListRequest {
    pub doc_key: String,
    pub text: String,
}

/// One reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyView {
    pub reply: ReplyId,
    pub body: String,
    pub author: String,
    pub caller: CommentCaller,
}

/// One undeleted thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadView {
    pub comment: CommentId,
    pub state: ThreadState,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub comment_gen: u64,
    /// The revision the thread was created on.
    pub revision: RevisionId,
    /// Whether that revision's text is still kept.
    pub creation_retained: bool,
    /// The passage the thread is about, as stored.
    pub quote: String,
    pub body: String,
    pub author: String,
    pub caller: CommentCaller,
    pub replies: Vec<ReplyView>,
    /// Where the passage is in the window's text.
    pub anchor: Resolution,
}

/// A document's threads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentList {
    /// `None` for a key the journal has never seen.
    pub doc: Option<DocId>,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
    pub threads: Vec<ThreadView>,
}

/// A thread copied under the lock, resolved after it.
struct Copied {
    comment: CommentId,
    state: ThreadState,
    comment_gen: u64,
    revision: RevisionId,
    retained: bool,
    text: Arc<ThreadText>,
}

impl Controller {
    /// The comment list (`{docKey, text}`); see the module docs.
    ///
    /// # Errors
    /// An invalid payload or document key; `JOURNAL_CORRUPT` when an
    /// undeleted thread has no text in the book (never a silent drop).
    pub(crate) fn comment_list(&self, payload: &str) -> Result<CommentList, CommandError> {
        let req: ListRequest = decode(payload)?;
        let doc = self.docs.find(&req.doc_key).map_err(|e| refusal(&e))?;
        let sent = BlobHash::of_text(&req.text);
        let (generation, at, copied) = {
            let g = self.writer.lock();
            let p = &g.proj;
            let Some(doc) = doc else {
                return Ok(CommentList {
                    doc: None,
                    generation: p.generation,
                    threads: Vec::new(),
                });
            };
            let head = p.head(doc);
            let at = head.filter(|h| p.revisions.get(h).is_some_and(|m| m.postimage == sent));
            let book = &p.comments;
            let copied: Vec<Copied> = book
                .threads
                .iter()
                .filter(|(_, t)| t.doc == doc && !t.deleted)
                .map(|(id, t)| {
                    let text = book.texts.get(id).ok_or_else(|| {
                        refusal(&TxnError::Corrupt(format!(
                            "comment {id} is not deleted but its text is missing from the comment book"
                        )))
                    })?;
                    Ok(Copied {
                        comment: *id,
                        state: t.state,
                        comment_gen: t.comment_gen,
                        revision: t.revision,
                        retained: p.revisions.get(&t.revision).is_some_and(|m| !m.collected),
                        text: Arc::clone(text),
                    })
                })
                .collect::<Result<_, CommandError>>()?;
            (p.generation, at, copied)
        };
        let anchors: Vec<&StoredAnchor> = copied.iter().map(|c| &c.text.anchor).collect();
        let found = resolve_all(&req.text, &anchors, at);
        let threads = copied
            .into_iter()
            .zip(found)
            .map(|(c, anchor)| view(c, anchor))
            .collect();
        Ok(CommentList {
            doc,
            generation,
            threads,
        })
    }
}

fn view(c: Copied, anchor: Resolution) -> ThreadView {
    let t = &c.text;
    ThreadView {
        comment: c.comment,
        state: c.state,
        comment_gen: c.comment_gen,
        revision: c.revision,
        creation_retained: c.retained,
        quote: t.anchor.quote.clone(),
        body: t.body.clone(),
        author: t.author.clone(),
        caller: t.caller,
        replies: t
            .replies
            .iter()
            .map(|r| ReplyView {
                reply: r.reply,
                body: r.body.clone(),
                author: r.author.clone(),
                caller: r.caller,
            })
            .collect(),
        anchor,
    }
}
