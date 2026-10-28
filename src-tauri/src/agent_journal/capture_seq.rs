//! The capture binding of a save: a window names the provenance capture it
//! froze as `{view, session, seq}`, and the writer refuses a capture whose
//! `seq` does not extend the last one it recorded for that session. This is
//! the guard against a lost, duplicated or reordered IPC message landing a
//! stale capture after a newer one; it is a consistency check inside the
//! webview's trust (a hostile webview can already write any text), not an
//! authenticity proof.
//!
//! Key decisions:
//!   - Checked, appended and recorded in one critical section of the writer
//!     lock, so two captures of one session cannot both pass the check.
//!   - Recorded only once the observation is durable or queued (`journaled:
//!     no` lands later, in order). A save refused before its append — an
//!     unknown observed parent, a provenance map that does not certify it —
//!     records nothing, so the window may resend the same capture.
//!   - A save elided through a verified `claimsRevision` appends nothing but
//!     is checked and recorded like any other, under the lock that verifies
//!     the claim: otherwise a delayed earlier capture of the session would
//!     pass the check and journal its stale text after it.
//!   - Keyed by session alone, not by view: the session mints the seq, so it
//!     orders every capture of that session whichever view froze it.
//!   - In memory only, never replayed. A session lives inside one webview
//!     lifetime and never outlives the process, so after a restart every
//!     capture comes from a new session and no recorded seq could apply. The
//!     minter must therefore never reuse a session id across webview
//!     incarnations (a reload mints new ones); a reused id restarting its seq
//!     is refused, which fails closed.
//!   - Bounded at `MAX_SESSIONS`: past it the least recently recorded
//!     session is forgotten, and its next capture is checked as a new
//!     session's. Only a capture of that session still in flight could then
//!     land stale, after its session sat idle while `MAX_SESSIONS` others
//!     recorded. Refusing new sessions instead would stop journaling every
//!     bound save for the rest of a long run.
//!   - Optional on the wire: a save that names no capture is unbound and not
//!     checked (a tab with no provenance session). A window sends each
//!     session's captures in seq order, one answered before the next is
//!     sent, so a legitimate reordering never reaches this check.
//!   - A controlled or restore prepare binds its capture the same way
//!     (`admission::prepare`): checked after the parent CAS and before
//!     admission, recorded only once its record or frame is durable; an
//!     identical retry answered from its receipt is not checked again.
//!   - `u64::MAX` is a valid seq that nothing extends: that session is done.
//!
//! @module agent_journal/capture_seq

use std::collections::{BTreeMap, HashMap};

use serde::Deserialize;

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::writer::{ObserveOutcome, ObserveRequest, Writer};

/// Longest accepted capture `view` or `session`, in UTF-8 bytes.
pub const CAPTURE_ID_MAX_BYTES: usize = 128;

/// A frozen capture's identity, validated at decode.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "CaptureIdWire")]
pub struct CaptureId {
    pub view: String,
    pub session: String,
    pub seq: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaptureIdWire {
    view: String,
    session: String,
    #[serde(with = "crate::agent_journal::u64_wire")]
    seq: u64,
}

impl TryFrom<CaptureIdWire> for CaptureId {
    type Error = String;

    fn try_from(w: CaptureIdWire) -> Result<Self, String> {
        for (name, value) in [("view", &w.view), ("session", &w.session)] {
            if value.is_empty() || value.len() > CAPTURE_ID_MAX_BYTES {
                return Err(format!(
                    "capture {name} must be 1..={CAPTURE_ID_MAX_BYTES} bytes"
                ));
            }
        }
        Ok(Self {
            view: w.view,
            session: w.session,
            seq: w.seq,
        })
    }
}

/// Most sessions the table remembers (see module docs).
pub(crate) const MAX_SESSIONS: usize = 16_384;

/// The last capture seq recorded per session, in memory (see module docs).
#[derive(Debug)]
pub(crate) struct CaptureSeqs {
    cap: usize,
    /// Session → (last seq, the tick it was last recorded at).
    last: HashMap<String, (u64, u64)>,
    /// Tick → session: recording order, oldest first.
    order: BTreeMap<u64, String>,
    tick: u64,
}

impl Default for CaptureSeqs {
    fn default() -> Self {
        Self::with_cap(MAX_SESSIONS)
    }
}

impl CaptureSeqs {
    pub(crate) fn with_cap(cap: usize) -> Self {
        Self {
            cap,
            last: HashMap::new(),
            order: BTreeMap::new(),
            tick: 0,
        }
    }

    pub(crate) fn check(&self, id: &CaptureId) -> Result<(), TxnError> {
        match self.last.get(&id.session) {
            Some(&(last, _)) if id.seq <= last => Err(TxnError::InvalidRequest(format!(
                "capture seq {} does not extend the last seq {last} recorded for its session",
                id.seq
            ))),
            _ => Ok(()),
        }
    }

    pub(crate) fn record(&mut self, id: &CaptureId) {
        self.tick += 1;
        if let Some((_, at)) = self.last.insert(id.session.clone(), (id.seq, self.tick)) {
            self.order.remove(&at);
        }
        self.order.insert(self.tick, id.session.clone());
        while self.last.len() > self.cap {
            let Some((_, oldest)) = self.order.pop_first() else {
                break;
            };
            self.last.remove(&oldest);
        }
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.last.len()
    }
}

/// `observe_for_window`, refusing a `capture` whose seq does not extend its
/// session's before anything is written, and recording it once the
/// observation is durable or queued.
pub(crate) fn observe_bound(
    w: &Writer,
    req: ObserveRequest,
    window: &str,
    capture: Option<&CaptureId>,
) -> Result<ObserveOutcome, TxnError> {
    let mut g = w.lock();
    if let Some(id) = capture {
        g.capture_seqs.check(id)?;
    }
    let out = w.observe_in(&mut g, req, Some(window))?;
    if let Some(id) = capture {
        g.capture_seqs.record(id);
    }
    Ok(out)
}

#[cfg(test)]
#[path = "capture_seq.test.rs"]
mod tests;
