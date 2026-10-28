//! The process's webview pages: which page generation is live for which
//! window label and page identity.
//!
//! A page registers its own random identity and gets a generation minted
//! from one process counter; every framed request names that pair, and is
//! answered only while the pair is registered under the invoking label.
//!
//! Key decisions:
//!   - The counter starts at 1, is never reset (not by a new writer either)
//!     and never wraps: at `u64::MAX` registration refuses. A generation is
//!     never reissued, so a revoked one is dead forever and its request
//!     state can be dropped.
//!   - `started` empties a label's registrations (or opens the label) and
//!     `destroy` removes the label; a label never opened answers a
//!     registration `staleGeneration` and creates nothing.
//!   - A label holds at most `REGISTRATIONS_PER_LABEL`. Past it a
//!     registration refuses and is counted; nothing is evicted, because the
//!     table cannot tell which registration is the live page's.
//!   - `replaces` swaps the caller's own live pair for the new one in one
//!     step, taking no slot; a dead pair is ignored; anything else is an
//!     invalid request. A repeated identity is answered before `replaces`,
//!     so a re-executed replace returns the same generation.
//!   - The table has its own lock and never takes the writer lock; a caller
//!     holding both takes the writer lock first, and never holds this one
//!     across I/O.
//!
//! @module agent_journal/admission/page_table

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde_json::{json, Value};

use crate::agent_journal::admission::identity::{parse_generation, Incarnation, PageIdentity};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::refusal::{refusal, unavailable};
use crate::agent_journal::writer::Writer;
use crate::command_error::CommandError;

/// Live registrations a window label may hold at once.
pub const REGISTRATIONS_PER_LABEL: usize = 8;

/// Every live page registration in the process.
#[derive(Debug)]
pub struct PageTable {
    inner: Mutex<Table>,
}

#[derive(Debug)]
struct Table {
    /// The next generation to mint.
    next: u64,
    labels: HashMap<String, Vec<(PageIdentity, u64)>>,
    cap_refusals: u64,
}

impl Default for PageTable {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Table {
                next: 1,
                labels: HashMap::new(),
                cap_refusals: 0,
            }),
        }
    }
}

/// A registration's reply: the writer's incarnation and the pair the page
/// names on every request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registration {
    pub incarnation: Incarnation,
    pub webview_generation: u64,
    pub page_identity: PageIdentity,
}

impl Registration {
    /// `{bind: {pageIdentity}, reply: {incarnation, webviewGeneration, pageIdentity}}`.
    pub fn wire(&self) -> Value {
        json!({
            "bind": { "pageIdentity": self.page_identity.as_str() },
            "reply": {
                "incarnation": self.incarnation.as_str(),
                "webviewGeneration": self.webview_generation.to_string(),
                "pageIdentity": self.page_identity.as_str(),
            },
        })
    }
}

/// Where a generation stands for an invoking label and identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Liveness {
    /// Registered under the label, with that identity.
    Own,
    /// Registered under the label, with another identity.
    OtherIdentity,
    /// Registered under another label.
    OtherLabel,
    /// Registered under no label.
    Dead,
}

impl Table {
    fn holder(&self, gen: u64) -> Option<(&str, &PageIdentity)> {
        self.labels.iter().find_map(|(label, regs)| {
            regs.iter()
                .find(|(_, g)| *g == gen)
                .map(|(id, _)| (label.as_str(), id))
        })
    }

    fn mint(&mut self) -> Result<u64, TxnError> {
        if self.next == u64::MAX {
            log::error!("agent journal: the page generation counter is exhausted");
            return Err(TxnError::Saturated(
                "page generation counter exhausted".into(),
            ));
        }
        self.next += 1;
        Ok(self.next - 1)
    }
}

impl PageTable {
    fn lock(&self) -> MutexGuard<'_, Table> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A page load started in `label`: every registration it held is
    /// revoked, and the label is open for new ones.
    pub fn started(&self, label: &str) {
        self.lock()
            .labels
            .entry(label.to_owned())
            .or_default()
            .clear();
    }

    /// `label`'s window is gone: its registrations are revoked and later
    /// registrations for it create nothing.
    pub fn destroy(&self, label: &str) {
        self.lock().labels.remove(label);
    }

    /// Register `page_identity` under `label`, replacing the caller's own
    /// pair `replaces` (identity, generation) when given. See the module
    /// docs for the cases and their order.
    pub fn register(
        &self,
        writer: Option<&Writer>,
        label: &str,
        page_identity: &str,
        replaces: Option<(&str, &str)>,
    ) -> Result<Registration, CommandError> {
        let writer = writer.ok_or_else(unavailable)?;
        let page = self
            .register_in(label, page_identity, replaces)
            .map_err(|e| refusal(&e))?;
        Ok(Registration {
            incarnation: writer.incarnation().clone(),
            webview_generation: page.1,
            page_identity: page.0,
        })
    }

    fn register_in(
        &self,
        label: &str,
        page_identity: &str,
        replaces: Option<(&str, &str)>,
    ) -> Result<(PageIdentity, u64), TxnError> {
        let id = PageIdentity::parse(page_identity)?;
        let replaces = match replaces {
            Some((rid, rgen)) => Some((PageIdentity::parse(rid)?, parse_generation(rgen)?)),
            None => None,
        };
        let mut t = self.lock();
        if !t.labels.contains_key(label) {
            log::warn!("agent journal: page registration for unopened window {label}");
            return Err(TxnError::StaleRegistration(format!(
                "window {label} is not open"
            )));
        }
        if let Some((_, g)) = t.labels[label].iter().find(|(held, _)| *held == id) {
            return Ok((id, *g));
        }
        if let Some((rid, rgen)) = replaces {
            match t.holder(rgen) {
                Some((l, held)) if l == label && *held == rid => {
                    let gen = t.mint()?;
                    let regs = t.labels.get_mut(label).expect("label checked above");
                    regs.retain(|(_, g)| *g != rgen);
                    regs.push((id.clone(), gen));
                    return Ok((id, gen));
                }
                Some(_) => {
                    return Err(TxnError::InvalidRequest(format!(
                        "replaces names generation {rgen}, which is not this page's"
                    )))
                }
                None => {}
            }
        }
        if t.labels[label].len() >= REGISTRATIONS_PER_LABEL {
            t.cap_refusals += 1;
            log::warn!(
                "agent journal: window {label} holds {REGISTRATIONS_PER_LABEL} page registrations"
            );
            return Err(TxnError::Saturated(format!(
                "window {label} is at its registration cap"
            )));
        }
        let gen = t.mint()?;
        t.labels
            .get_mut(label)
            .expect("label checked above")
            .push((id.clone(), gen));
        Ok((id, gen))
    }

    /// Where `gen` stands for a request from `label` naming `identity`.
    pub(crate) fn liveness(&self, label: &str, gen: u64, identity: &PageIdentity) -> Liveness {
        let table = self.lock();
        let holder = table.holder(gen);
        match holder {
            None => Liveness::Dead,
            Some((l, _)) if l != label => Liveness::OtherLabel,
            Some((_, held)) if held != identity => Liveness::OtherIdentity,
            Some(_) => Liveness::Own,
        }
    }

    /// Whether `gen` is registered under any label.
    #[cfg(test)]
    pub(crate) fn is_live(&self, gen: u64) -> bool {
        self.lock().holder(gen).is_some()
    }

    /// Every generation some label holds, read in one critical section.
    pub(crate) fn live_generations(&self) -> HashSet<u64> {
        let t = self.lock();
        t.labels.values().flatten().map(|(_, g)| *g).collect()
    }

    /// Registrations refused because their label already held the cap.
    pub fn registration_cap_refusals(&self) -> u64 {
        self.lock().cap_refusals
    }

    #[cfg(test)]
    pub(crate) fn registrations(&self, label: &str) -> usize {
        self.lock().labels.get(label).map_or(0, Vec::len)
    }

    /// Labels the table holds (open windows), registrations or not.
    #[cfg(test)]
    pub(crate) fn labels(&self) -> usize {
        self.lock().labels.len()
    }

    #[cfg(test)]
    pub(crate) fn set_next(&self, next: u64) {
        self.lock().next = next;
    }
}
