//! Review effects the writer derives itself, for callers that hold no
//! worker-side ledger: the spans and capture transitions of every live
//! hunk through the record's own window, with no new hunks — except a
//! restore's one `restore` hunk, which covers the whole text (the
//! overwritten text is its base, so reverting it gives that text back),
//! and a certified selection edit's one hunk per changed run. A record with
//! no certified map gets a whole-document barrier window, so every older
//! live hunk is blocked rather than guessed at. The derived effects are
//! submitted back through `commit` / `linearize_next`, which re-derive and
//! refuse any difference; a race between the two calls fails closed.

use crate::agent_journal::admission::blobs::BlobRead;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::projection::{ObservationEntry, Projection, RevisionKind};
use crate::agent_journal::provenance::{Certificate, Provenance};
use crate::agent_journal::review::{Hunk, HunkKind, Range, ReviewEffects, ReviewOp};
use crate::agent_journal::span_map::{derive, DeriveCtx};
use crate::agent_journal::text::utf16_len;
use crate::agent_journal::writer::certificate::Certification;
use crate::agent_journal::writer::{CommitRequest, Inner, Writer};
use crate::agent_journal::writer_revert::referenced_blob;
use crate::agent_journal::writer_txn::open_txn;
use crate::agent_journal::writer_window::linearization_window;

/// What linearizing a document's oldest pending observation works from:
/// shared by effect derivation and by `linearize_next`, which re-checks.
pub(crate) struct LinearizeCtx {
    pub observation: TxnId,
    /// The linear parent: the document's head now.
    pub head: Option<RevisionId>,
    pub entry: ObservationEntry,
    /// The observation's postimage text.
    pub post: String,
    pub window: Provenance,
    pub kind: RevisionKind,
}

/// `None` when nothing of `doc` is pending.
pub(crate) fn linearize_ctx(g: &mut Inner, doc: DocId) -> Result<Option<LinearizeCtx>, TxnError> {
    linearize_ctx_from(&g.proj, &mut g.blobs, doc)
}

/// `linearize_ctx` over any projection and blob view: a staged admission
/// derives from its clone and its in-memory blobs.
pub(crate) fn linearize_ctx_from(
    proj: &Projection,
    blobs: &mut dyn BlobRead,
    doc: DocId,
) -> Result<Option<LinearizeCtx>, TxnError> {
    let Some(&observation) = proj.docs.get(&doc).and_then(|d| d.pending.first()) else {
        return Ok(None);
    };
    let head = proj.head(doc);
    let head_text = match head {
        None => String::new(),
        Some(_) => {
            let hash = proj
                .postimage_of(head)
                .ok_or_else(|| TxnError::Invariant("head has no text".into()))?;
            referenced_blob(blobs, &hash)?
        }
    };
    let entry = proj.observations[&observation].clone();
    let post = referenced_blob(blobs, &entry.postimage)?;
    let (window, kind) = linearization_window(proj, doc, observation, &head_text, &post)?;
    Ok(Some(LinearizeCtx {
        observation,
        head,
        entry,
        post,
        window,
        kind,
    }))
}

/// Effects linearizing the oldest pending observation of `doc` must
/// carry; `None` when nothing is pending. Takes the held writer lock, so a
/// caller derives and appends in one critical section.
pub(crate) fn linearize_effects_in(
    g: &mut Inner,
    doc: DocId,
) -> Result<Option<ReviewEffects>, TxnError> {
    let Some(ctx) = linearize_ctx(g, doc)? else {
        return Ok(None);
    };
    derived(
        &g.proj,
        doc,
        ctx.head,
        &ReviewOp::None,
        &ctx.window,
        &ctx.post,
        Vec::new(),
    )
    .map(Some)
}

/// The spans and transitions every live hunk of `doc` takes through
/// `window`, plus `new_hunks`, against `proj`.
pub(crate) fn derived(
    proj: &Projection,
    doc: DocId,
    parent: Option<RevisionId>,
    op: &ReviewOp,
    window: &Provenance,
    postimage: &str,
    new_hunks: Vec<Hunk>,
) -> Result<ReviewEffects, TxnError> {
    let empty = Default::default();
    let d = proj.docs.get(&doc).unwrap_or(&empty);
    let ctx = DeriveCtx {
        doc: d,
        parent,
        op,
        window,
        postimage,
        new_hunks: &new_hunks,
        reverted: None,
    };
    let out = derive(&ctx).map_err(|e| TxnError::Invariant(format!("span mapping: {e}")))?;
    Ok(ReviewEffects {
        spans: out.spans,
        transitions: out.transitions,
        new_hunks,
        ..ReviewEffects::default()
    })
}

/// A restore's single hunk: the whole of `pre` (the parent's text) becomes
/// the whole of `post`.
fn restore_hunk(
    parent: Option<RevisionId>,
    revision: RevisionId,
    pre: &str,
    post: &str,
) -> Result<Hunk, TxnError> {
    let base_range = Range {
        start: 0,
        end: utf16_len(pre),
    };
    let target_range = Range {
        start: 0,
        end: utf16_len(post),
    };
    let (base_text_hash, target_text_hash) = (BlobHash::of_text(pre), BlobHash::of_text(post));
    let id = Hunk::compute_id(
        parent,
        revision,
        base_range,
        target_range,
        &base_text_hash,
        &target_text_hash,
    )
    .map_err(TxnError::Invariant)?;
    Ok(Hunk {
        id,
        kind: HunkKind::Restore,
        base: parent,
        target: revision,
        base_range,
        target_range,
        base_text_hash,
        target_text_hash,
    })
}

impl Writer {
    /// Effects committing open transaction `txn` as `req` must carry
    /// (`req.effects` is ignored). With no provenance a
    /// `review` commit is a `wholeDocumentWrite` barrier unless its
    /// selection certificate checks (`derive_commit_effects_with`).
    #[cfg(test)]
    pub fn derive_commit_effects(
        &self,
        txn: TxnId,
        req: &CommitRequest,
    ) -> Result<ReviewEffects, TxnError> {
        self.derive_commit_effects_with(txn, req, None)
    }

    /// `derive_commit_effects` for a selection edit: a certificate that
    /// checks contributes its window and writer-derived hunks.
    pub(crate) fn derive_commit_effects_with(
        &self,
        txn: TxnId,
        req: &CommitRequest,
        sent: Option<&Certificate>,
    ) -> Result<ReviewEffects, TxnError> {
        let mut g = self.lock();
        let t = open_txn(&g, txn)?;
        let preimage = referenced_blob(&mut g.blobs, &t.preimage)?;
        let (window, reverted, certification) =
            self.commit_window(&mut g, &t, &preimage, req, sent)?;
        // A revert's effects are its plan's, derived under this lock from
        // the head text; the window sends none.
        if let Some((_, _, effects)) = reverted {
            return Ok(effects);
        }
        let new_hunks = match t.review_op {
            ReviewOp::Restore { .. } => {
                vec![restore_hunk(
                    t.parent,
                    t.revision,
                    &preimage,
                    &req.postimage,
                )?]
            }
            _ => match certification {
                Certification::Certified(hunks) => hunks,
                _ => Vec::new(),
            },
        };
        derived(
            &g.proj,
            t.doc,
            t.parent,
            &t.review_op,
            &window,
            &req.postimage,
            new_hunks,
        )
    }
}
