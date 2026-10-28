//! Creating a thread, inside one critical section of the writer lock.
//!
//! Order: the receipt lookup (an identical retry gets its stored answer,
//! with nothing appended); parent CAS; writer healthy, document not
//! degraded or reserved; then the record built in full, its answer and
//! receipt included, before anything is written.
//!
//! The thread is bound to the exact text its anchor was made on. When the
//! window's buffer is the head's text and nothing is pending, the
//! `commentCreated` is one top-level record on the head. Otherwise one
//! schema-5 `admission` frame holds the pending captures linearized, the
//! buffer recorded as a human baseline when needed (as a controlled
//! prepare records it), and the `commentCreated` last, on the revision the
//! frame just made. A refused baseline refuses the comment, and nothing is
//! appended. A comment never labels buffer coordinates with an older head.
//!
//! The book is held to every cap (`comment::book`) against the state the
//! record lands on, before the publish.
//!
//! @module agent_journal/comment/create

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::blobs::StagedBlobs;
use crate::agent_journal::admission::prepare::{needs_baseline, Request, Responder};
use crate::agent_journal::admission::publish::Staging;
use crate::agent_journal::admission::receipt::{Outcome, Receipt};
use crate::agent_journal::admission::reconcile::lookup;
use crate::agent_journal::admission::reduce::preflight;
use crate::agent_journal::admission::stage::{stage_baseline, Frame, Live};
use crate::agent_journal::comment::binding::heading_path_fits;
use crate::agent_journal::comment::bounds::{check_body, Limits};
use crate::agent_journal::comment::ids::{CommentCaller, CommentId};
use crate::agent_journal::comment::records::{CommentCreated, CommentRecord};
use crate::agent_journal::comment::replies::CommentCreatedReply;
use crate::agent_journal::comment::wire::CreateRequest;
use crate::agent_journal::comment_anchor::{create_anchor, AnchorSelection};
use crate::agent_journal::controlled::Prep;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, TxnId};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::provenance_field::decode_field;
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V5};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::writer::{Inner, Writer};
use crate::agent_journal::writer_types::now_ms;
use crate::coherence::anchors::{MAX_PATH_SEGMENTS, MAX_SEGMENT_BYTES};

/// A decoded create: the baseline fields as a prepare carries them, and
/// the thread's own.
pub(crate) struct CreatePrep {
    prep: Prep,
    selection: AnchorSelection,
    body: String,
    author: String,
    caller: CommentCaller,
}

/// Check `req` for `caller`'s route: the user route takes no actor; the
/// agent route names a valid MCP actor. The body is bounded here.
pub(crate) fn create_prep(
    req: CreateRequest,
    caller: CommentCaller,
) -> Result<CreatePrep, TxnError> {
    let initiator = match (caller, req.actor) {
        (CommentCaller::User, None) => Actor::Human,
        (CommentCaller::Agent, Some(a @ Actor::Mcp { .. })) => {
            a.validate().map_err(TxnError::InvalidRequest)?;
            a
        }
        (CommentCaller::User, Some(_)) => {
            return Err(TxnError::InvalidRequest(
                "the user route takes no actor".into(),
            ))
        }
        (CommentCaller::Agent, _) => {
            return Err(TxnError::InvalidRequest(
                "an agent comment is attributed to an MCP actor".into(),
            ))
        }
    };
    check_body(&req.body)?;
    Ok(CreatePrep {
        prep: Prep {
            parent: req.parent,
            observed_parent: req.observed_parent,
            preimage: req.text,
            actor: initiator.clone(),
            initiator,
            tool: String::new(),
            review_op: ReviewOp::None,
            baseline_provenance: decode_field(req.baseline_provenance)?,
            baseline_touched: req.baseline_touched,
            certificate: None,
            capture: None,
            addresses: Vec::new(),
        },
        selection: req.selection,
        body: req.body,
        author: req.author,
        caller,
    })
}

/// Create the thread `c` asks for on `doc`. See the module docs.
pub(crate) fn create_admitted(
    w: &Writer,
    g: &mut Inner,
    doc: DocId,
    c: CreatePrep,
    request: &Request,
) -> Result<Outcome, TxnError> {
    if let Some(stored) = lookup(g, request)? {
        return Ok(stored);
    }
    let head = g.proj.head(doc);
    if c.prep.parent != head {
        return Err(TxnError::StaleParent { head });
    }
    g.healthy()?;
    g.not_busy(doc)?;
    let pending = g.proj.docs.get(&doc).is_some_and(|d| !d.pending.is_empty());
    let next_seq = g.next_generation()?;
    let staging = if pending || needs_baseline(&g.proj, head, &c.prep) {
        let live = Live {
            next_seq,
            proj: &g.proj,
            pack: &mut g.blobs,
        };
        staged(live, doc, &c, request)?
    } else {
        direct(&g.proj, next_seq, doc, &c, request)?
    };
    let response = staging.response.clone();
    w.publish(g, staging)?;
    Ok(response)
}

/// The one top-level `commentCreated`, on the head.
fn direct(
    proj: &Projection,
    seq: u64,
    doc: DocId,
    c: &CreatePrep,
    request: &Request,
) -> Result<Staging, TxnError> {
    let (record, response, receipt) = mint(proj, doc, seq, c, request)?;
    let txn = TxnId::new();
    let env = Envelope {
        schema_version: SCHEMA_V5,
        seq,
        txn,
        at: now_ms(),
        record,
        receipt,
    };
    admit(proj, &env)?;
    preflight(proj, &env).map_err(|e| TxnError::Invariant(format!("staged comment: {e}")))?;
    Ok(Staging {
        env,
        blobs: Vec::new(),
        staged: None,
        doc,
        txn,
        response,
        fallback: None,
    })
}

/// The schema-5 frame: pending captures, the baseline when needed, then
/// the `commentCreated` on the revision they leave.
fn staged(
    live: Live<'_>,
    doc: DocId,
    c: &CreatePrep,
    request: &Request,
) -> Result<Staging, TxnError> {
    let mut f = Frame {
        proj: live.proj.clone(),
        items: Vec::new(),
        next_seq: live.next_seq,
        at: now_ms(),
        schema: SCHEMA_V5,
    };
    let mut blobs = StagedBlobs::new(live.pack);
    f.linearize_pending(&mut blobs, doc)?;
    let head = f.proj.head(doc);
    if needs_baseline(&f.proj, head, &c.prep) {
        stage_baseline(&mut f, &mut blobs, doc, head, &c.prep)?;
        f.linearize_pending(&mut blobs, doc)?;
    }
    let seq = f.next_seq;
    let (record, response, receipt) = mint(&f.proj, doc, seq, c, request)?;
    let txn = TxnId::new();
    let env = Envelope {
        schema_version: f.schema,
        seq,
        txn,
        at: f.at,
        record,
        receipt,
    };
    admit(&f.proj, &env)?;
    f.push_receipted(txn, env.record, env.receipt)?;
    let staged_blobs = blobs.into_staged();
    let (env, proj) = f.into_envelope()?;
    preflight(live.proj, &env)
        .map_err(|e| TxnError::Invariant(format!("staged comment admission: {e}")))?;
    Ok(Staging {
        env,
        blobs: staged_blobs,
        staged: Some(proj),
        doc,
        txn,
        response,
        fallback: None,
    })
}

/// Hold `env`'s comment record to the book and every cap on `proj`.
pub(crate) fn admit(proj: &Projection, env: &Envelope) -> Result<(), TxnError> {
    let rec = CommentRecord::of(&env.record)
        .ok_or_else(|| TxnError::Invariant("a comment entry point built another kind".into()))?;
    proj.comments
        .plan(env, rec, &proj.revisions, Some(&Limits::REAL))
        .map(drop)
}

/// The record, answer and receipt of a thread minted at `seq` on `doc`'s
/// head, whose text must be exactly the window's.
fn mint(
    proj: &Projection,
    doc: DocId,
    seq: u64,
    c: &CreatePrep,
    request: &Request,
) -> Result<(Record, Outcome, Option<Receipt>), TxnError> {
    let text = &c.prep.preimage;
    let revision = proj
        .head(doc)
        .ok_or_else(|| TxnError::InvalidRequest("the document has no text to comment on".into()))?;
    let text_hash = BlobHash::of_text(text);
    if proj.postimage_of(Some(revision)).as_ref() != Some(&text_hash) {
        return Err(TxnError::Invariant(
            "a comment's revision is not the window's text".into(),
        ));
    }
    let anchor = create_anchor(text, &c.selection, revision)?.anchor;
    if !heading_path_fits(&anchor.heading_path) {
        let longest = anchor
            .heading_path
            .iter()
            .map(String::len)
            .max()
            .unwrap_or(0);
        let (bound, limit, total) = if anchor.heading_path.len() > MAX_PATH_SEGMENTS {
            ("headingPath", MAX_PATH_SEGMENTS, anchor.heading_path.len())
        } else {
            ("headingSegment", MAX_SEGMENT_BYTES, longest)
        };
        return Err(TxnError::CommentLimit {
            bound,
            limit: limit as u64,
            total: total as u64,
        });
    }
    let comment = CommentId::at(seq);
    let response = Outcome::CommentCreated(CommentCreatedReply {
        doc,
        comment,
        revision,
        text_hash: text_hash.clone(),
        generation: seq,
        comment_gen: 0,
    });
    let record = Record::CommentCreated(CommentCreated {
        doc,
        comment,
        revision,
        text_hash,
        anchor,
        body: c.body.clone(),
        author: c.author.clone(),
        caller: c.caller,
    });
    let receipt = Responder::receipt(Some(request), &response);
    Ok((record, response, receipt))
}
