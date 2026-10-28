// WI-AL2.2a — shared helpers for the admission and receipt tests: a controller over a real writer, prepare payloads that carry a request id and a capture, the coordinator's outcome classification (prepared, refused, indeterminate), and the observable writer state a refusal must leave unchanged
//! Helpers only; the cases live in the `admission_*` test files.

use std::sync::{mpsc, Arc};
use std::time::Duration;

use serde_json::{json, Value};

use crate::agent_journal::blob_store::BLOB_PACK;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::degraded_drain::{Backoff, DrainScheduler};
use crate::agent_journal::faults::Faults;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::test_support::{agent, config};
use crate::agent_journal::writer::{JournalEvent, Writer};
use crate::command_error::CommandError;

pub(crate) const KEY: &str = "path:/notes/admission.md";

/// A controller over a fresh writer in `dir`, fsyncing every append.
pub(crate) fn controller(dir: &std::path::Path) -> (Controller, Arc<Faults>) {
    let (cfg, faults) = config(dir, SyncPolicy::Full);
    let (w, _) = Writer::open(cfg).expect("open writer");
    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    let c = Controller::new(Arc::new(w), Arc::default(), Arc::new(drains));
    (c, faults)
}

pub(crate) fn request_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// A controlled prepare of `KEY` with `preimage` on `parent`, under
/// `request` when given.
pub(crate) fn body(parent: Option<RevisionId>, preimage: &str, request: Option<&str>) -> Value {
    let mut v = json!({
        "docKey": KEY,
        "parent": parent,
        "preimage": preimage,
        "actor": agent(),
        "tool": "document.write",
    });
    if let Some(id) = request {
        v["requestId"] = json!(id);
    }
    v
}

/// A capture binding `{view, session, seq}` as the window sends it.
pub(crate) fn capture(session: &str, seq: u64) -> Value {
    json!({ "view": "source", "session": session, "seq": seq.to_string() })
}

/// The outcome the coordinator reports for a prepare reply.
pub(crate) fn outcome<T>(r: &Result<T, CommandError>) -> &'static str {
    match r {
        Ok(_) => "prepared",
        Err(e)
            if e.detail()
                .is_some_and(|d| d["indeterminate"] == json!(true)) =>
        {
            "indeterminate"
        }
        Err(_) => "refused",
    }
}

pub(crate) fn journal_code(e: &CommandError) -> String {
    e.detail().expect("detail")["journalCode"]
        .as_str()
        .expect("journalCode")
        .to_owned()
}

/// A degraded queue's entries, each with the window base root it would move.
type QueueEntries = Vec<(TxnId, Option<String>)>;

/// Everything a refused prepare must leave as it was.
#[derive(Debug, PartialEq)]
pub(crate) struct Observable {
    pub journal_len: u64,
    pub pack_len: u64,
    pub generation: u64,
    pub proj: Projection,
    pub reservations: Vec<(DocId, TxnId)>,
    /// Each queue's entries with the window base root each would move.
    pub degraded: Vec<(DocId, QueueEntries)>,
    pub window_bases: Vec<(String, DocId, ObservedRef)>,
    pub unpinned: Vec<String>,
    pub unpinned_labels: Vec<String>,
    pub unpinned_overflow: bool,
    pub released: Vec<String>,
    pub uncertified_fallbacks: u64,
}

pub(crate) fn pack_len(dir: &std::path::Path) -> u64 {
    std::fs::metadata(dir.join(BLOB_PACK)).map_or(0, |m| m.len())
}

pub(crate) fn observable(w: &Writer, dir: &std::path::Path) -> Observable {
    let g = w.lock();
    let mut reservations: Vec<_> = g.reservations.iter().map(|(d, r)| (*d, r.txn)).collect();
    reservations.sort();
    let mut degraded: Vec<_> = g
        .degraded
        .iter()
        .map(|(d, q)| (*d, q.iter().map(|x| (x.txn, x.window.clone())).collect()))
        .collect();
    degraded.sort();
    let window_bases = g
        .window_bases
        .iter()
        .map(|(w, (d, r))| (w.clone(), *d, r.clone()))
        .collect();
    Observable {
        journal_len: g.journal.len(),
        pack_len: pack_len(dir),
        generation: g.proj.generation,
        proj: g.proj.clone(),
        reservations,
        degraded,
        window_bases,
        unpinned: g.unpinned.iter().cloned().collect(),
        unpinned_labels: g.unpinned_labels.iter().cloned().collect(),
        unpinned_overflow: g.unpinned_overflow,
        released: g.released.iter().cloned().collect(),
        uncertified_fallbacks: g.uncertified_fallbacks,
    }
}

/// The seqs of the `Appended` events received so far.
pub(crate) fn appended(rx: &mpsc::Receiver<JournalEvent>) -> Vec<u64> {
    rx.try_iter()
        .filter_map(|e| match e {
            JournalEvent::Appended(env) => Some(env.seq),
            _ => None,
        })
        .collect()
}

/// The pack holds `text`, readable through the writer.
pub(crate) fn stored_blob(w: &Writer, text: &str) -> bool {
    w.blob_text(&BlobHash::of_text(text)).is_ok()
}

/// Close `d`'s armed epoch, so a reopen appends nothing for it and the
/// live projection can be compared with the replayed one.
pub(crate) fn close_epoch(w: &Writer, d: DocId) {
    if let Some(epoch) = w.epoch(d) {
        w.close_epoch(d, epoch).expect("close epoch");
    }
}

/// The single document the controller resolved `KEY` to.
pub(crate) fn doc(c: &Controller) -> DocId {
    c.docs.resolve(KEY).expect("doc key")
}
