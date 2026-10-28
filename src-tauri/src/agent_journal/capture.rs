//! Observational capture of a save, as a window drives it over IPC: the
//! disk save already happened, so nothing here blocks or refuses it; this
//! only records what was saved and reports how far it got.
//!
//! Order: the request is validated first (initiator, author, observed
//! parent). A save that claims a revision (`claimsRevision`) the writer
//! verifies — it is the head, holds exactly the saved text, and nothing is
//! pending or queued — is `journaled: yes` at the head and appends nothing
//! (its capture seq is still checked and recorded, `capture_claim`).
//! Otherwise the save is a `pendingObservation` — author the human unless
//! the window names the agent whose own output it persists, initiator the
//! person, autosave or agent that asked for the save — on the window's
//! observed parent (the revision or pending observation its buffer was
//! built on; when the window names none, the head, or genesis for a new
//! document), refused first if its capture seq does not extend its
//! session's (`capture_seq`). Once that
//! append is durable the window's base root moves to it, then every pending
//! observation of the document is linearized in order unless a reservation
//! or the degraded queue holds it (`journaled: pending`, linearized when
//! the commit, abort or drain settles, or at the next startup). A failed
//! append is queued for the drainer (`journaled: no`), within the degraded
//! budget; the window's base moves when the drainer lands it.
//!
//! Key decisions:
//!   - A save may carry the window's certified map (observed parent →
//!     postimage, under its armed epoch); live hunks then map through it.
//!     Without one the revision is a `snapshotOnly` (or, for a concurrent
//!     observation, `parentMismatch`) barrier: no live hunk is moved
//!     through text nobody certified. Fail closed. A map that does not
//!     certify the save is refused before anything is appended, with
//!     `field: provenance`, and the window resends without it.
//!   - Text equality alone never elides a save: a person may have edited
//!     and typed back, and the save's barrier is what keeps live hunks from
//!     being certified through that. Only `document.write`'s own save — its
//!     text is the postimage read back at apply — claims its revision.
//!   - The author is who produced the text, never inferred from the
//!     initiator: a `workspace.save` by an agent persists the person's edits.
//!   - Refusals (ill-formed text, an unknown observed parent, a malformed
//!     payload) are errors with a journal code, not `journaled: no`: the
//!     window reports them as "history not recorded" with the reason.
//!   - Pending saves linearize in the order their observations reached the
//!     writer. That is the disk order within a window (saves to one path
//!     are serialized there); across windows nothing records which disk
//!     write landed last, and startup cannot reconstruct it.
//!
//! @module agent_journal/capture

use serde::{Deserialize, Serialize};

use crate::agent_journal::actor::Actor;
use crate::agent_journal::capture_seq::{observe_bound, CaptureId};
use crate::agent_journal::controlled::linearize_one;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::provenance::ProvenancePayload;
use crate::agent_journal::provenance_field::{decode_field, ProvenanceField};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::wire::decode_json;
use crate::agent_journal::writer::{Journaled, ObserveRequest, Writer};
use crate::agent_journal::writer_observe::resolve_base;

#[path = "capture_claim.rs"]
mod claim;
use claim::elide_claimed;

/// Longest accepted window root name, in UTF-8 bytes.
pub const WINDOW_MAX_BYTES: usize = 512;

/// Most consecutive head races one linearization pass absorbs.
const STALE_RETRIES: u32 = 3;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureRequest {
    pub doc_key: String,
    /// The window's base-root name (`<window>/<tab>`).
    pub window: String,
    /// What the saved buffer was built on; `None`: the head.
    #[serde(default)]
    pub observed_parent: Option<ObservedRef>,
    pub postimage: String,
    /// Who asked for the save.
    pub initiator: Actor,
    /// Who produced the saved text; `None`: the human. Human or agent only.
    #[serde(default)]
    pub author: Option<Actor>,
    /// The revision the window says the saved text is, untouched since. The
    /// writer elides the save only when it verifies the claim.
    #[serde(default)]
    pub claims_revision: Option<RevisionId>,
    /// The window's certified map observed parent → postimage, under its
    /// armed epoch; `None`: a `snapshotOnly` barrier.
    #[serde(default)]
    pub provenance: Option<ProvenanceField>,
    /// The capture this save froze; `None`: unbound (`capture_seq`).
    #[serde(default)]
    pub capture: Option<CaptureId>,
}

/// How far a save got into the journal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JournaledFlag {
    /// A linearized revision holds the saved text.
    Yes,
    /// Durable as a pending observation, not linearized yet.
    Pending,
    /// Not durable: queued in memory for the drainer.
    No,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureReply {
    pub doc: DocId,
    pub journaled: JournaledFlag,
    /// The observation recorded; `None` when the head already held the text.
    pub observation: Option<TxnId>,
    /// The revision holding the saved text, once linearized.
    pub revision: Option<RevisionId>,
}

/// Decode a capture payload: well-formed text first (`INVALID_TEXT`), then
/// shape, a bounded window name and a non-legacy initiator.
pub fn decode_capture(payload: &[u8]) -> Result<CaptureRequest, TxnError> {
    let req: CaptureRequest = decode_json(payload)?;
    if req.window.is_empty() || req.window.len() > WINDOW_MAX_BYTES {
        return Err(TxnError::InvalidRequest(format!(
            "window must be 1..={WINDOW_MAX_BYTES} bytes"
        )));
    }
    if matches!(req.initiator, Actor::Legacy) {
        return Err(TxnError::InvalidRequest(
            "a save is initiated by a person, VMark or an agent".into(),
        ));
    }
    Ok(req)
}

/// Record a save of `doc`. See the module docs for the order.
pub fn capture_save(
    w: &Writer,
    doc: DocId,
    mut req: CaptureRequest,
) -> Result<CaptureReply, TxnError> {
    let (author, provenance) = validate_save(w, doc, &mut req)?;
    if let Some(reply) = elide_claimed(w, doc, &req)? {
        return Ok(reply);
    }
    let observed_parent = req.observed_parent.unwrap_or_else(|| {
        w.head(doc)
            .map_or(ObservedRef::Genesis, |revision| ObservedRef::Revision {
                revision,
            })
    });
    let observe = ObserveRequest {
        doc,
        actor: author,
        initiator: req.initiator,
        postimage: req.postimage,
        observed_parent,
        provenance,
    };
    let out = observe_bound(w, observe, &req.window, req.capture.as_ref())?;
    if out.journaled == Journaled::No {
        return Ok(reply(doc, JournaledFlag::No, Some(out.observation), None));
    }
    Ok(settle_durable(w, doc, out.observation))
}

/// The author (a person or an agent, well-formed), the initiator, the
/// decoded certified map and the observed parent, before anything is written.
fn validate_save(
    w: &Writer,
    doc: DocId,
    req: &mut CaptureRequest,
) -> Result<(Actor, Option<ProvenancePayload>), TxnError> {
    let author = req.author.clone().unwrap_or(Actor::Human);
    if !matches!(author, Actor::Human | Actor::Mcp { .. }) {
        return Err(TxnError::InvalidRequest(
            "a save's text is written by a person or an agent".into(),
        ));
    }
    author.validate().map_err(TxnError::InvalidRequest)?;
    req.initiator.validate().map_err(TxnError::InvalidRequest)?;
    let provenance = decode_field(req.provenance.take())?;
    if let Some(base) = &req.observed_parent {
        resolve_base(&w.lock(), doc, base.clone())?;
    }
    Ok((author, provenance))
}

/// After a durable observation (whose append already moved the window's
/// base root, in the same critical section): linearize what is pending, and
/// report whether this observation landed.
fn settle_durable(w: &Writer, doc: DocId, observation: TxnId) -> CaptureReply {
    linearize_pending(w, doc);
    let revision = w
        .lock()
        .proj
        .observations
        .get(&observation)
        .and_then(|o| o.linearized);
    let journaled = revision.map_or(JournaledFlag::Pending, |_| JournaledFlag::Yes);
    reply(doc, journaled, Some(observation), revision)
}

fn reply(
    doc: DocId,
    journaled: JournaledFlag,
    observation: Option<TxnId>,
    revision: Option<RevisionId>,
) -> CaptureReply {
    CaptureReply {
        doc,
        journaled,
        observation,
        revision,
    }
}

/// How a linearization pass ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Linearization {
    pub landed: usize,
    /// Stopped on a failure a later pass can clear: an append that did not
    /// become durable, or the head moving under it more than `STALE_RETRIES`
    /// times. The caller hands the document to the background retry.
    pub retry: bool,
}

/// Linearize every pending observation of `doc`, oldest first, until none
/// is left or something holds the document (a reservation, the degraded
/// queue, an unhealthy writer). Never fails: what is left stays durable and
/// pending.
pub fn linearize_pending(w: &Writer, doc: DocId) -> Linearization {
    let (mut landed, mut races) = (0, 0);
    loop {
        match linearize_one(w, doc, w.head(doc)) {
            Ok(Some(_)) => (landed, races) = (landed + 1, 0),
            Ok(None) => {
                return Linearization {
                    landed,
                    retry: false,
                }
            }
            Err(TxnError::StaleParent { .. }) if races < STALE_RETRIES => races += 1,
            Err(e) => {
                let held = matches!(e.code(), "JOURNAL_BUSY" | "JOURNAL_DEGRADED");
                if !held {
                    log::warn!("agent journal: pending saves of a document stay pending: {e}");
                }
                let retry = matches!(
                    e,
                    TxnError::Io(_) | TxnError::Indeterminate(_) | TxnError::StaleParent { .. }
                );
                return Linearization { landed, retry };
            }
        }
    }
}

/// The documents holding pending observations.
pub fn docs_with_pending(w: &Writer) -> Vec<DocId> {
    w.lock()
        .proj
        .docs
        .iter()
        .filter(|(_, d)| !d.pending.is_empty())
        .map(|(id, _)| *id)
        .collect()
}

/// Linearize the pending observations of every document, as startup does
/// after replay. Returns how many landed.
pub fn linearize_all_pending(w: &Writer) -> usize {
    docs_with_pending(w)
        .into_iter()
        .map(|d| linearize_pending(w, d).landed)
        .sum()
}
