//! Pin roots on the writer: which revisions and blobs are reachable.
//!
//! This module computes the set and holds the caller-registered roots;
//! the collector (`writer_gc`) tombstones what the set does not reach.

use crate::agent_journal::ids::{BlobHash, DocId};
use crate::agent_journal::pins::{self, PinSet, Roots};
use crate::agent_journal::record::ObservedRef;
use std::collections::BTreeSet;

use crate::agent_journal::writer::{Inner, Writer};
use crate::agent_journal::writer_budget::window_label;

pub(crate) fn compute_pins(g: &Inner) -> PinSet {
    pins_with(g, queued_roots(g))
}

/// The pins the journal and the live windows reach, without the degraded
/// queue's blobs: those carry their text in memory until they drain, so
/// the pack need not hold them yet.
pub(crate) fn journal_pins(g: &Inner) -> PinSet {
    pins_with(g, Vec::new())
}

/// Every blob a queued record carries or names.
pub(crate) fn queued_roots(g: &Inner) -> Vec<BlobHash> {
    g.degraded
        .values()
        .flatten()
        .flat_map(|q| q.roots())
        .collect()
}

fn pins_with(g: &Inner, queued_blobs: Vec<BlobHash>) -> PinSet {
    pins::compute(
        &g.proj,
        Roots {
            window_bases: &g.window_bases,
            external: &g.external,
            queued_blobs,
        },
    )
}

fn forget_queued_window(g: &mut Inner, window: &str) {
    for q in g.degraded.values_mut().flatten() {
        if q.window.as_deref() == Some(window) {
            q.window = None;
        }
    }
}

/// `register_window_base` under a lock the caller already holds.
pub(crate) fn set_window_base(g: &mut Inner, window: &str, doc: DocId, base: ObservedRef) {
    if let Some((held_doc, held)) = g.window_bases.get(window) {
        if (*held_doc, held) == (doc, &base) || older_capture(g, &base, held) {
            return;
        }
    }
    forget_queued_window(g, window);
    if g.admits_window(window) {
        g.window_bases.insert(window.to_string(), (doc, base));
    }
}

/// Both are durable observations and `base` was appended before `held`.
fn older_capture(g: &Inner, base: &ObservedRef, held: &ObservedRef) -> bool {
    let seq = |r: &ObservedRef| match r {
        ObservedRef::Pending { observation } => g.proj.observations.get(observation).map(|o| o.seq),
        _ => None,
    };
    matches!((seq(base), seq(held)), (Some(new), Some(cur)) if new < cur)
}

impl Writer {
    /// Every root revision and blob, with the reasons each is pinned.
    pub fn pins(&self) -> PinSet {
        compute_pins(&self.lock())
    }

    /// A window's live editor base; replaced by the window's next call.
    /// A queued capture of the window no longer moves it when it lands.
    /// Past the window budget a new name is not registered (logged).
    /// Registering the base the window already holds, or an observation
    /// older than the one it holds (a capture's caller answering late), is a
    /// no-op. Captures move it themselves (`set_window_base`, under their
    /// append's lock); tests seed it here.
    #[cfg(test)]
    pub fn register_window_base(&self, window: &str, doc: DocId, base: ObservedRef) {
        set_window_base(&mut self.lock(), window, doc, base);
    }

    /// The window closed: drop its base root, and let no queued capture
    /// register it again. Idempotent.
    pub fn clear_window_base(&self, window: &str) {
        let mut g = self.lock();
        forget_queued_window(&mut g, window);
        g.window_bases.remove(window);
        g.unpinned.remove(window);
        g.remember_released(window);
    }

    /// The app window `label` was destroyed: release every base-root name
    /// it held (`<label>/…`), in the base table, the unpinned set and the
    /// queue, as `clear_window_base` would, and refuse any later name under
    /// it. The webview's own releases die with it, so the app calls this
    /// from its `Destroyed` handler.
    pub fn release_window_label(&self, label: &str) {
        let mut g = self.lock();
        let ours = |name: &str| window_label(name) == label;
        let mut names: BTreeSet<String> =
            g.window_bases.keys().filter(|n| ours(n)).cloned().collect();
        names.extend(g.unpinned.iter().filter(|n| ours(n)).cloned());
        names.extend(
            g.degraded
                .values()
                .flatten()
                .filter_map(|q| q.window.clone())
                .filter(|n| ours(n)),
        );
        for name in &names {
            forget_queued_window(&mut g, name);
            g.window_bases.remove(name);
            g.unpinned.remove(name);
            g.remember_released(name);
        }
        g.unpinned_labels.remove(label);
        // The label itself, so a capture still in flight cannot register a
        // name this window never held. A label can be built again (`main`
        // is a fixed label), so the rebuild reopens it
        // (`reopen_window_label`).
        g.remember_released(label);
    }

    /// The app window `label` is being built again (`main` is rebuilt under
    /// its fixed label): forget the bare label `release_window_label`
    /// remembered, so the new window's names register. Every released name
    /// stays remembered, so a late capture under a name the old window held
    /// is still refused; one in flight under a name it never held now
    /// registers, over-pinning that base until the label is released again.
    /// Idempotent; a no-op for a label never released, and for a name.
    pub fn reopen_window_label(&self, label: &str) {
        if window_label(label) != label {
            return;
        }
        self.lock().released.retain(|r| r != label);
    }

    /// Attribute an unpinned overflow to the app windows alive now. Past
    /// every budget only a flag is kept (see `admits_window`), which no
    /// window's release could clear. When `live` (every app window label
    /// still open) fits the window budget, the flag becomes exactly those
    /// labels, since any of them may hold an unpinned base, and each clears
    /// as its window is destroyed. Names whose window is gone are dropped.
    /// More live windows than the budget keep the flag: the collector
    /// stays deferred, which never loses text.
    pub fn reconcile_live_windows(&self, live: &BTreeSet<String>) {
        let mut g = self.lock();
        if !g.unpinned_overflow || live.len() > g.budget.window_bases {
            return;
        }
        g.unpinned.retain(|name| live.contains(window_label(name)));
        g.unpinned_labels = live.iter().cloned().collect();
        g.unpinned_overflow = false;
    }

    /// A caller-held root. No production caller holds one yet, so this is
    /// test-only; a caller added later needs a matching release, or its
    /// pin outlives it until restart.
    #[cfg(test)]
    pub fn register_external_root(&self, revision: crate::agent_journal::ids::RevisionId) {
        self.lock().external.insert(revision);
    }
}

#[cfg(test)]
#[path = "writer_reopen.test.rs"]
mod reopen_tests;
