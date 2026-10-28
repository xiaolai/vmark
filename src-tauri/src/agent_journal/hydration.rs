//! Window-side hydration: subscribe first, then take the snapshot (state +
//! generation) atomically; buffered events at or below the snapshot's
//! generation are dropped, the next one is applied in order, and any gap
//! (a lost broadcast) or `Resync` (compaction) forces a re-fetch. A feed
//! whose writer is gone (a reopen) resubscribes to the writer it is pumped
//! against and re-fetches, so a view never stays silently stale.
//!
//! This is the reference model of the protocol the webview follows; it is
//! compiled for tests only, where it proves windows converge.

#![cfg(test)]

use std::sync::mpsc::{Receiver, TryRecvError};

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::projection::Projection;
use crate::agent_journal::writer::{JournalEvent, Writer};

pub struct HydratedView {
    pub generation: u64,
    pub state: Projection,
    /// How many times a gap, a resync or a lost feed forced a full snapshot.
    pub refetches: usize,
    rx: Receiver<JournalEvent>,
}

impl HydratedView {
    pub fn hydrate(w: &Writer) -> Self {
        let rx = w.subscribe();
        let snap = w.snapshot();
        Self {
            generation: snap.generation,
            state: snap.state,
            refetches: 0,
            rx,
        }
    }

    fn refetch(&mut self, w: &Writer) {
        let snap = w.snapshot();
        self.state = snap.state;
        self.generation = snap.generation;
        self.refetches += 1;
    }

    /// Apply every buffered event.
    pub fn pump(&mut self, w: &Writer) -> Result<(), TxnError> {
        loop {
            let event = match self.rx.try_recv() {
                Ok(event) => event,
                Err(TryRecvError::Empty) => return Ok(()),
                Err(TryRecvError::Disconnected) => {
                    // Subscribe before the snapshot, as in `hydrate`.
                    self.rx = w.subscribe();
                    self.refetch(w);
                    continue;
                }
            };
            match event {
                JournalEvent::Appended(env) if env.seq <= self.generation => {}
                JournalEvent::HealthChanged => {}
                JournalEvent::Appended(env) if env.seq == self.generation + 1 => {
                    self.state.apply(&env)?;
                    self.generation = env.seq;
                }
                _ => self.refetch(w),
            }
        }
    }
}
