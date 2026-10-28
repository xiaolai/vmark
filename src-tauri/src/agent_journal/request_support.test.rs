// WI-AL2.2f — shared helpers for the request-protocol tests: a controller beside a page table, a page registered under a window label, frozen payloads that carry the identity fields, and readers for the refusal detail and the writer's request state
//! Helpers only; the cases live in the `request_*` and
//! `duplicate_requests` test files.

use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::admission_support::{body, controller, doc, request_id, KEY};
use crate::agent_journal::admission::page_table::PageTable;
use crate::agent_journal::capture_tests::capture_payload;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::ids::{RevisionId, TxnId};
use crate::agent_journal::projection::TxnStatus;
use crate::command_error::CommandError;

pub(crate) use crate::agent_journal::admission::admission_support::journal_code;
pub(crate) use crate::agent_journal::admission::page_table_tests::ident;

/// A controller over a fresh writer, and the process's page table.
pub(crate) struct Rig {
    pub dir: tempfile::TempDir,
    pub c: Controller,
    pub faults: Arc<Faults>,
    pub pages: Arc<PageTable>,
}

/// A registered page: the label it lives under and its pair.
#[derive(Debug, Clone)]
pub(crate) struct Page {
    pub label: String,
    pub identity: String,
    pub generation: String,
}

pub(crate) fn rig() -> Rig {
    let dir = tempfile::tempdir().expect("tempdir");
    let (c, faults) = controller(dir.path());
    Rig {
        dir,
        c,
        faults,
        pages: Arc::default(),
    }
}

/// `p` with its identity fields replaced.
pub(crate) fn with(p: &str, key: &str, value: Value) -> String {
    let mut v: Value = serde_json::from_str(p).expect("payload");
    v[key] = value;
    v.to_string()
}

impl Rig {
    /// Reopen the writer on the same directory (a new incarnation),
    /// keeping the page table, as a process that replaced its writer would.
    pub(crate) fn reopen(self) -> Self {
        let Rig { dir, c, pages, .. } = self;
        drop(c);
        let (c, faults) = controller(dir.path());
        Rig {
            dir,
            c,
            faults,
            pages,
        }
    }

    /// Open `label` (a delivered `Started`) and register page `n` in it.
    pub(crate) fn page(&self, label: &str, n: u32) -> Page {
        self.pages.started(label);
        self.register(label, n)
    }

    /// Register page `n` under an already-open `label`.
    pub(crate) fn register(&self, label: &str, n: u32) -> Page {
        let r = self
            .pages
            .register(Some(&self.c.writer), label, &ident(n), None)
            .expect("register");
        Page {
            label: label.into(),
            identity: r.page_identity.to_string(),
            generation: r.webview_generation.to_string(),
        }
    }

    /// `body` frozen for `page`: the writer's incarnation and the page's
    /// pair, with a request id when `body` has none.
    pub(crate) fn frame(&self, page: &Page, mut body: Value) -> String {
        if body.get("requestId").is_none() {
            body["requestId"] = json!(request_id());
        }
        body["incarnation"] = json!(self.c.writer.incarnation().to_string());
        body["webviewGeneration"] = json!(page.generation);
        body["pageIdentity"] = json!(page.identity);
        body.to_string()
    }

    /// A frozen controlled prepare of `KEY` with `preimage` on `parent`.
    pub(crate) fn p(&self, page: &Page, parent: Option<RevisionId>, preimage: &str) -> String {
        self.frame(page, body(parent, preimage, Some(&request_id())))
    }

    /// `p` on `KEY`'s current head, the head a window expects (R32).
    pub(crate) fn p_head(&self, page: &Page, preimage: &str) -> String {
        self.p(page, self.c.writer.head(doc(&self.c)), preimage)
    }

    /// `p` prepared from `page`'s label: the bound reply as JSON.
    pub(crate) fn prepare(&self, page: &Page, p: &str) -> Result<Value, CommandError> {
        self.prepare_as(&page.label, p)
    }

    pub(crate) fn prepare_as(&self, label: &str, p: &str) -> Result<Value, CommandError> {
        let out = self.c.prepare_framed(&self.pages, label, p)?;
        Ok(serde_json::to_value(out).expect("reply"))
    }

    /// Abandon `p` from `label`: the reply as JSON.
    pub(crate) fn abandon(&self, label: &str, p: &str) -> Result<Value, CommandError> {
        let out = self.c.abandon(&self.pages, label, p)?;
        Ok(serde_json::to_value(out).expect("reply"))
    }

    pub(crate) fn commit(
        &self,
        page: &Page,
        txn: TxnId,
        post: &str,
    ) -> Result<Value, CommandError> {
        let payload = json!({ "postimage": post }).to_string();
        let out = self.c.commit_owned(
            &self.pages,
            &page.label,
            &txn.0.to_string(),
            &payload,
            &page.identity,
            &page.generation,
        )?;
        Ok(serde_json::to_value(out).expect("reply"))
    }

    pub(crate) fn abort(&self, page: &Page, txn: TxnId) -> Result<Value, CommandError> {
        let out = self.c.abort_owned(
            &self.pages,
            &page.label,
            &txn.0.to_string(),
            "edited",
            &page.identity,
            &page.generation,
        )?;
        Ok(serde_json::to_value(out).expect("reply"))
    }

    pub(crate) fn status(&self, txn: TxnId) -> Option<TxnStatus> {
        self.c
            .writer
            .lock()
            .proj
            .txns
            .get(&txn)
            .map(|t| t.status.clone())
    }

    /// `(inflight, fences, owners, receipts, reservations)`.
    pub(crate) fn sizes(&self) -> (usize, usize, usize, usize, usize) {
        let g = self.c.writer.lock();
        (
            g.requests.inflight_len(),
            g.requests.fences_len(),
            g.requests.owners.len(),
            g.proj.requests.len(),
            g.reservations.len(),
        )
    }

    pub(crate) fn journal_len(&self) -> u64 {
        self.c.writer.lock().journal.len()
    }
}

/// The prepared transaction a bound prepare reply names.
pub(crate) fn txn_of(reply: &Value) -> TxnId {
    serde_json::from_value(reply["reply"]["txn"].clone()).expect("txn")
}

pub(crate) fn detail(e: &CommandError) -> &Value {
    e.detail().expect("detail")
}

/// `detail.request.state`, or `""` for a refusal that names no request.
pub(crate) fn state(e: &CommandError) -> String {
    detail(e)["request"]["state"]
        .as_str()
        .unwrap_or("")
        .to_owned()
}

/// `(journalCode, request.state, uncertain)`.
pub(crate) fn answer(e: &CommandError) -> (String, String, Option<bool>) {
    (journal_code(e), state(e), detail(e)["uncertain"].as_bool())
}

pub(crate) type Held = thread::JoinHandle<Result<Value, CommandError>>;

/// Start `p`'s original attempt and hold it after its in-flight entry is
/// taken, before the critical section that admits it. Send on the
/// returned channel to let it go on.
pub(crate) fn hold_original(r: &Rig, page: &Page, p: &str) -> (Held, mpsc::Sender<()>) {
    let (at, reached) = mpsc::channel();
    let (go, wait) = mpsc::channel::<()>();
    r.faults.before_nth_lock(
        2,
        Some(Box::new(move || {
            at.send(()).unwrap();
            wait.recv().unwrap();
        })),
    );
    let (c, pages, label, p) = (
        r.c.clone(),
        r.pages.clone(),
        page.label.clone(),
        p.to_owned(),
    );
    let h = thread::spawn(move || {
        c.prepare_framed(&pages, &label, &p)
            .map(|b| serde_json::to_value(b).unwrap())
    });
    reached
        .recv_timeout(Duration::from_secs(5))
        .expect("the original paused before admission");
    (h, go)
}

/// The human saves of `KEY`'s document waiting to be linearized.
pub(crate) fn pending(r: &Rig) -> usize {
    let d = doc(&r.c);
    r.c.writer
        .snapshot()
        .state
        .docs
        .get(&d)
        .map_or(0, |s| s.pending.len())
}

/// A human save of `KEY` from window `main/t1`, held behind the open
/// transaction's reservation.
pub(crate) fn held_save(r: &Rig) {
    let save = capture_payload(KEY, "main/t1", None, "human", &Actor::Human);
    r.c.capture(&save).expect("capture");
    assert_eq!(pending(r), 1, "the save waits behind the reservation");
}
