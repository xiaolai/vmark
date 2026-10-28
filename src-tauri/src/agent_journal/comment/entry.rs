//! The comment entry points, one handle per caller class. The caller is
//! the handle, never a request field: the user handle records `user` and
//! may take every action the state machine gives a user; the agent handle
//! records `agent`, names an MCP actor on create, and offers only create,
//! reply, `markAddressed` and the read-only list. The Tauri `comment_user_*` and
//! `comment_agent_*` families (`commands_user`,
//! `commands_agent`) each reach exactly one handle.
//!
//! Create and reply are framed requests (`admission::framed`): their
//! payload's digest is over the raw bytes and their receipt answers an
//! identical retry. A state change or a deletion is guarded only by
//! `expectedCommentGen` (`comment::ops`).
//!
//! @module agent_journal/comment/entry

use crate::agent_journal::admission::bound::{Bound, RequestBind};
use crate::agent_journal::admission::page_table::PageTable;
use crate::agent_journal::admission::payload::Frame;
use crate::agent_journal::admission::receipt::Outcome;
use crate::agent_journal::comment::create::{create_admitted, create_prep};
use crate::agent_journal::comment::ids::CommentCaller;
use crate::agent_journal::comment::list::CommentList;
use crate::agent_journal::comment::ops::{reply_admitted, reply_prep, transition, Transitioned};
use crate::agent_journal::comment::replies::{CommentCreatedReply, CommentRepliedReply};
use crate::agent_journal::comment::rules::Action;
use crate::agent_journal::comment::wire::{CreateRequest, ReplyRequest, StateRequest};
use crate::agent_journal::controlled::reused_id;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::wire::decode_json;
use crate::command_error::CommandError;

/// The comment entry points of one caller class.
#[derive(Clone, Copy)]
pub struct Comments<'a> {
    c: &'a Controller,
    caller: CommentCaller,
}

/// The user's comment entry points.
#[derive(Clone, Copy)]
pub struct UserComments<'a>(Comments<'a>);

/// An agent's comment entry points.
#[derive(Clone, Copy)]
pub struct AgentComments<'a>(Comments<'a>);

impl Controller {
    pub fn comments_user(&self) -> UserComments<'_> {
        UserComments(Comments {
            c: self,
            caller: CommentCaller::User,
        })
    }

    pub fn comments_agent(&self) -> AgentComments<'_> {
        AgentComments(Comments {
            c: self,
            caller: CommentCaller::Agent,
        })
    }
}

impl Comments<'_> {
    fn create(
        self,
        pages: &PageTable,
        label: &str,
        payload: &str,
    ) -> Result<Bound<RequestBind, CommentCreatedReply>, CommandError> {
        let frame = Frame::decode(payload)?;
        let req: CreateRequest = decode_json(frame.body().as_bytes()).map_err(|e| refusal(&e))?;
        let request = frame.request(Some(req.request_id))?;
        let key = req.doc_key.clone();
        let prep = create_prep(req, self.caller).map_err(|e| refusal(&e))?;
        let work = |w: &_, g: &mut _, doc, r| create_admitted(w, g, doc, prep, &r);
        match self
            .c
            .run_framed_with(pages, label, &frame, &request, &key, work)?
        {
            Outcome::CommentCreated(reply) => Ok(Bound {
                bind: frame.bind(&request),
                reply,
            }),
            _ => Err(refusal(&reused_id())),
        }
    }

    fn reply(
        self,
        pages: &PageTable,
        label: &str,
        payload: &str,
    ) -> Result<Bound<RequestBind, CommentRepliedReply>, CommandError> {
        let frame = Frame::decode(payload)?;
        let req: ReplyRequest = decode_json(frame.body().as_bytes()).map_err(|e| refusal(&e))?;
        let request = frame.request(Some(req.request_id))?;
        let key = req.doc_key.clone();
        let prep = reply_prep(req, self.caller).map_err(|e| refusal(&e))?;
        let work = |w: &_, g: &mut _, doc, r| reply_admitted(w, g, doc, prep, &r);
        match self
            .c
            .run_framed_with(pages, label, &frame, &request, &key, work)?
        {
            Outcome::CommentReplied(reply) => Ok(Bound {
                bind: frame.bind(&request),
                reply,
            }),
            _ => Err(refusal(&reused_id())),
        }
    }

    fn act(self, req: &StateRequest, action: Action) -> Result<Transitioned, CommandError> {
        let doc = self.c.docs.resolve(&req.doc_key).map_err(|e| refusal(&e))?;
        let out = transition(
            &self.c.writer,
            doc,
            req.comment,
            req.expected_comment_gen,
            self.caller,
            action,
        );
        self.c.settle_prepare(doc, out.is_ok());
        out.map_err(|e| refusal(&e))
    }
}

/// The shared create, reply, `markAddressed` and list of a handle.
macro_rules! common_entry_points {
    ($handle:ident) => {
        impl $handle<'_> {
            /// Create a thread from a framed payload.
            ///
            /// # Errors
            /// The journal refusal; once the payload decodes, a request answer.
            pub fn create(
                self,
                pages: &PageTable,
                label: &str,
                payload: &str,
            ) -> Result<Bound<RequestBind, CommentCreatedReply>, CommandError> {
                self.0.create(pages, label, payload)
            }

            /// Reply to a thread from a framed payload.
            ///
            /// # Errors
            /// As `create`.
            pub fn reply(
                self,
                pages: &PageTable,
                label: &str,
                payload: &str,
            ) -> Result<Bound<RequestBind, CommentRepliedReply>, CommandError> {
                self.0.reply(pages, label, payload)
            }

            /// Mark an open or reopened thread addressed.
            ///
            /// # Errors
            /// The journal refusal.
            pub fn mark_addressed(self, req: &StateRequest) -> Result<Transitioned, CommandError> {
                self.0.act(req, Action::MarkAddressed)
            }

            /// The document's threads against the window's text
            /// (`comment::list`), read-only and the same for either caller.
            ///
            /// # Errors
            /// An invalid payload or document key.
            pub fn list(self, payload: &str) -> Result<CommentList, CommandError> {
                self.0.c.comment_list(payload)
            }
        }
    };
}

common_entry_points!(UserComments);
common_entry_points!(AgentComments);

impl UserComments<'_> {
    /// Resolve a thread. Allowed until `commentGen` reaches `u64::MAX - 1`.
    ///
    /// # Errors
    /// The journal refusal.
    pub fn resolve(self, req: &StateRequest) -> Result<Transitioned, CommandError> {
        self.0.act(req, Action::Resolve)
    }

    /// Reopen a resolved thread.
    ///
    /// # Errors
    /// The journal refusal.
    pub fn reopen(self, req: &StateRequest) -> Result<Transitioned, CommandError> {
        self.0.act(req, Action::Reopen)
    }

    /// Delete a resolved thread. Always allowed at any `commentGen`.
    ///
    /// # Errors
    /// The journal refusal.
    pub fn delete(self, req: &StateRequest) -> Result<Transitioned, CommandError> {
        self.0.act(req, Action::Delete)
    }
}
