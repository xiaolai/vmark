//! The journal generation broadcast, carried to every window: the writer's
//! in-process subscription becomes the Tauri event `GENERATION_EVENT`, so a
//! history panel in any window re-reads when the journal changes.
//!
//! Key decisions:
//!   - Coalesced: a burst of appends is one event naming the writer's
//!     generation after the burst, read after the queue is drained, so the
//!     last event always names the latest generation and a hundred writes
//!     cost no more re-reads than the windows can do. A burst is at most
//!     `COALESCE_MAX` events: a stream that never goes idle still emits.
//!   - The payload is only the generation (decimal string, as every u64
//!     crosses into JavaScript); windows re-read what they show through the
//!     history commands, which check the caller's document key. A failed
//!     start is announced once with `generation: null`, so a window waiting
//!     on the journal shows it unavailable without polling.
//!   - The forwarder holds the writer weakly and ends when the subscription
//!     closes; a failed emit is logged, never retried (the next append
//!     re-announces the generation).
//!   - Live updates are a status of their own (`LiveUpdates`, in the
//!     journal status), separate from the writer's health. The started
//!     forwarder marks them ready from inside its thread, so `ready` always
//!     means events will follow. A thread that cannot spawn is retried a
//!     bounded number of times, then marked failed, logged at error level,
//!     and announced by one event so open panels re-read the status and
//!     fall back to polling.
//!
//! @module agent_journal/generation_events

use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex, PoisonError, Weak};
use std::time::Duration;

use serde::Serialize;

use crate::agent_journal::writer::{JournalEvent, Writer};

/// The Tauri event every window listens to.
pub const GENERATION_EVENT: &str = "agent-journal:generation";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GenerationEvent {
    generation: Option<String>,
}

impl GenerationEvent {
    pub fn ready(generation: u64) -> Self {
        Self {
            generation: Some(generation.to_string()),
        }
    }

    /// The journal did not start: nothing will be recorded this session.
    pub fn failed() -> Self {
        Self { generation: None }
    }
}

/// Whether journal changes reach the windows as events. Separate from the
/// writer's health: a writer can record while no event is forwarded.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LiveUpdates {
    #[default]
    Starting,
    Ready,
    Failed,
}

/// The forwarder's [`LiveUpdates`], shared with the journal status.
#[derive(Debug, Default)]
pub struct LiveUpdatesCell(Mutex<LiveUpdates>);

impl LiveUpdatesCell {
    pub fn get(&self) -> LiveUpdates {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn set(&self, value: LiveUpdates) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = value;
    }
}

/// Most events one emission coalesces: a stream that never goes idle still
/// emits once per this many events.
pub(crate) const COALESCE_MAX: usize = 64;

/// Emit one `generation()` per burst of events (at most `COALESCE_MAX`)
/// until the subscription closes.
pub fn forward(
    rx: &Receiver<JournalEvent>,
    generation: impl Fn() -> u64,
    mut emit: impl FnMut(u64),
) {
    while rx.recv().is_ok() {
        let mut coalesced = 1;
        while coalesced < COALESCE_MAX && rx.try_recv().is_ok() {
            coalesced += 1;
        }
        emit(generation());
    }
}

/// Hands one generation to every window.
pub(crate) type Emit = Arc<dyn Fn(u64) + Send + Sync>;

/// The forwarder's thread body, handed to the spawner.
pub(crate) type ForwardJob = Box<dyn FnOnce() + Send>;

/// How many times a forwarder thread that cannot spawn is tried.
pub(crate) const SPAWN_ATTEMPTS: u32 = 3;

/// Announce the start outcome, then forward the writer's broadcast to every
/// window on a background thread.
pub fn spawn<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    writer: Option<&Arc<Writer>>,
    live: &Arc<LiveUpdatesCell>,
) {
    use tauri::Emitter;
    let Some(writer) = writer else {
        if let Err(e) = app.emit(GENERATION_EVENT, GenerationEvent::failed()) {
            log::warn!("agent journal: could not announce the failed start: {e}");
        }
        return;
    };
    let app = app.clone();
    let emit: Emit = Arc::new(move |g: u64| {
        if let Err(e) = app.emit(GENERATION_EVENT, GenerationEvent::ready(g)) {
            log::warn!("agent journal: could not broadcast generation {g}: {e}");
        }
    });
    let spawner = |job: ForwardJob| {
        std::thread::Builder::new()
            .name("agent-journal-events".into())
            .spawn(job)
            .map(|_| ())
    };
    if !start_forwarder(writer, &emit, live, Duration::from_millis(100), spawner) {
        log::error!(
            "agent journal: no live history updates this session: its event thread cannot start"
        );
    }
}

/// Start the forwarder through `spawn`, retrying a failed spawn up to
/// `SPAWN_ATTEMPTS` times (waiting `backoff` times the attempt between
/// tries). `live` is marked ready by the running forwarder itself, after it
/// subscribed and before its first event: no window reads `ready` from a
/// forwarder that never ran. When no attempt started, `live` is marked
/// failed and one event invalidates every window's status read; `false`.
pub(crate) fn start_forwarder(
    writer: &Arc<Writer>,
    emit: &Emit,
    live: &Arc<LiveUpdatesCell>,
    backoff: Duration,
    mut spawn: impl FnMut(ForwardJob) -> std::io::Result<()>,
) -> bool {
    for attempt in 1..=SPAWN_ATTEMPTS {
        let rx = writer.subscribe();
        let weak: Weak<Writer> = Arc::downgrade(writer);
        let emit = emit.clone();
        let running = live.clone();
        let job: ForwardJob = Box::new(move || {
            let generation = || weak.upgrade().map_or(0, |w| w.generation());
            running.set(LiveUpdates::Ready);
            emit(generation());
            forward(&rx, generation, |g| emit(g));
        });
        match spawn(job) {
            Ok(()) => return true,
            Err(e) => {
                log::warn!("agent journal: event thread did not start (attempt {attempt}): {e}");
                if attempt < SPAWN_ATTEMPTS {
                    std::thread::sleep(backoff * attempt);
                }
            }
        }
    }
    live.set(LiveUpdates::Failed);
    emit(writer.generation());
    false
}
