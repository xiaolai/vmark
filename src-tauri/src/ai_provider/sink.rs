//! Sink abstraction for AI provider output (ADR-1).
//!
//! Providers stream their output through a single `&dyn AiSink` rather than
//! emitting `ai:response` events directly to a `WebviewWindow`. This lets the
//! same provider code drive:
//!
//!   - **`WindowSink`** — preserves today's behavior: emits `ai:response`
//!     events to the frontend window for the editor genie path.
//!   - **`ChannelSink`** (added in WI-1.2) — pushes chunks into a *bounded*
//!     tokio mpsc channel so an in-process workflow runner can collect the
//!     full response. A cumulative byte-gate stops the producer once output
//!     reaches `MAX_COLLECT_BYTES`, so the channel can never buffer past the
//!     cap even when the collector is mid dispatch-poll and cannot drain.
//!
//! ## Why a trait, not duplicated functions
//!
//! See ADR-1 in `dev-docs/plans/20260418-genie-in-workflow.md`. Duplicating
//! the provider functions for headless use would double ~500 LOC of provider
//! code and create perpetual drift. Event loopback (emitting to the window
//! and listening back in Rust) wakes the entire frontend for every internal
//! genie chunk and complicates cancellation lifetimes.

use super::types::AiResponseChunk;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{Emitter, WebviewWindow};
use tokio::sync::mpsc::Sender;
use tokio_util::sync::CancellationToken;

/// Sink for AI provider output.
///
/// Each provider call emits zero or more `chunk` calls, then exactly one
/// terminal call: either `done` (success) or `error` (failure). After the
/// terminal call the sink may be dropped.
///
/// Implementors must be `Send + Sync` so providers can hold `&dyn AiSink`
/// across `await` points and across thread boundaries.
pub trait AiSink: Send + Sync {
    /// Emit a partial output chunk. Called zero or more times.
    fn chunk(&self, text: &str);

    /// Signal successful completion. Called exactly once per provider run.
    fn done(&self);

    /// Signal failure. Called exactly once per provider run, in place of `done`.
    fn error(&self, msg: &str);
}

/// Sink that emits `ai:response` events to a Tauri webview window.
///
/// Wire-compatible with today's behavior: the emitted `AiResponseChunk`
/// payload shape is byte-for-byte identical to what `types::emit_chunk`,
/// `types::emit_done`, and `types::emit_error` produce.
pub struct WindowSink {
    window: WebviewWindow,
    request_id: String,
}

impl WindowSink {
    /// Construct a sink bound to a specific webview window + request id.
    /// Every `ai:response` event the sink emits carries the `request_id` so
    /// the frontend listener can demultiplex concurrent invocations.
    pub fn new(window: WebviewWindow, request_id: String) -> Self {
        Self { window, request_id }
    }
}

impl AiSink for WindowSink {
    fn chunk(&self, text: &str) {
        let _ = self.window.emit(
            "ai:response",
            AiResponseChunk {
                request_id: self.request_id.clone(),
                chunk: text.to_string(),
                done: false,
                error: None,
            },
        );
    }

    fn done(&self) {
        let _ = self.window.emit(
            "ai:response",
            AiResponseChunk {
                request_id: self.request_id.clone(),
                chunk: String::new(),
                done: true,
                error: None,
            },
        );
    }

    fn error(&self, msg: &str) {
        let _ = self.window.emit(
            "ai:response",
            AiResponseChunk {
                request_id: self.request_id.clone(),
                chunk: String::new(),
                done: true,
                error: Some(msg.to_string()),
            },
        );
    }
}

/// Event sent from a `ChannelSink` to its receiver.
///
/// Each variant maps 1:1 to an `AiSink` trait method. The receiver
/// (`run_ai_prompt_collect`) drains in order and treats the first `Done` /
/// `Error` it sees as terminal.
#[derive(Debug, Clone, PartialEq)]
pub enum ChannelEvent {
    /// Partial output, produced by zero-or-more `AiSink::chunk` calls.
    Chunk(String),
    /// Successful completion. Exactly one of `Done` / `Error` is sent per
    /// provider run (via the corresponding `AiSink::done` / `AiSink::error`
    /// terminal call).
    Done,
    /// Failure. Carries the error message originally passed to `AiSink::error`.
    Error(String),
}

/// Sink that forwards calls to a *bounded* tokio mpsc channel.
///
/// Used by `run_ai_prompt_collect` to pull chunks back into a Rust caller
/// (e.g. the workflow runner) rather than to a frontend window. After the
/// terminal `done` or `error` event the receiver should close the channel.
///
/// ## Backpressure / memory bound
///
/// The collector runs the provider dispatch in the same task, so it cannot
/// drain mid dispatch-poll: a single poll of a fast provider can call
/// `chunk` many times in a row. To keep peak in-flight memory bounded, the
/// sink enforces a **cumulative byte-gate**: once the running total handed to
/// `chunk` reaches `MAX_COLLECT_BYTES`, the sink stops forwarding, fires
/// `cancel` (stopping the CLI child / REST request), and sets `overflowed`.
/// The bounded channel adds a coarse message-depth backstop; a `Full` send is
/// treated the same as the byte-gate tripping. This is why a count-only bound
/// is unsuitable here — legitimate output can burst many small chunks in one
/// poll (see `collect_drains_burst_before_done`), so the precise cap must be
/// measured in bytes, not messages.
pub struct ChannelSink {
    sender: Sender<ChannelEvent>,
    /// Running total of bytes handed to `chunk`. The gate compares this
    /// against `MAX_COLLECT_BYTES` before each forward, so the channel can
    /// never buffer more than the cap plus one in-flight chunk.
    sent_bytes: AtomicUsize,
    /// Fired when output exceeds the cap so the provider is stopped instead of
    /// producing without bound.
    cancel: CancellationToken,
    /// Set alongside `cancel` on overflow so the collector reports the cap
    /// error rather than a plain cancellation.
    overflowed: Arc<AtomicBool>,
}

impl ChannelSink {
    /// Construct a sink that forwards events to `sender`. The receiver end is
    /// owned by `run_ai_prompt_collect`. `cancel` is fired and `overflowed`
    /// set if output exceeds the collect cap, so the collector can stop the
    /// provider and surface the cap error. Send failures on a closed channel
    /// are logged at trace level and swallowed — providers don't need to react
    /// when the consumer has already moved on.
    pub fn new(
        sender: Sender<ChannelEvent>,
        cancel: CancellationToken,
        overflowed: Arc<AtomicBool>,
    ) -> Self {
        Self {
            sender,
            sent_bytes: AtomicUsize::new(0),
            cancel,
            overflowed,
        }
    }

    /// Mark the stream as over the cap and stop the producer.
    fn trip_overflow(&self) {
        self.overflowed.store(true, Ordering::SeqCst);
        self.cancel.cancel();
    }

    /// Forward one event, mapping a full queue to an overflow (cap) trip and a
    /// closed channel to a swallowed trace log.
    fn send_event(&self, event: ChannelEvent) {
        use tokio::sync::mpsc::error::TrySendError;
        match self.sender.try_send(event) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                // Message-depth backstop hit while the collector is not
                // draining. Treat as the output cap and stop the producer.
                self.trip_overflow();
            }
            Err(TrySendError::Closed(_)) => {
                log::trace!("ChannelSink send failed — receiver dropped");
            }
        }
    }
}

impl AiSink for ChannelSink {
    fn chunk(&self, text: &str) {
        if self.overflowed.load(Ordering::SeqCst) {
            return;
        }
        // Byte-gate: bound the cumulative output forwarded into the channel to
        // MAX_COLLECT_BYTES. The collector runs dispatch in the same task and
        // cannot drain mid-poll, so without this a fast provider could enqueue
        // unbounded bytes in a single poll before the receiver's cap is ever
        // checked. Once the cap is reached we stop forwarding and trip
        // overflow, so peak buffered output never exceeds the cap plus this
        // one in-flight chunk.
        let already_sent = self.sent_bytes.fetch_add(text.len(), Ordering::SeqCst);
        if already_sent.saturating_add(text.len()) > super::MAX_COLLECT_BYTES {
            self.trip_overflow();
            return;
        }
        self.send_event(ChannelEvent::Chunk(text.to_string()));
    }

    fn done(&self) {
        if self.overflowed.load(Ordering::SeqCst) {
            return;
        }
        self.send_event(ChannelEvent::Done);
    }

    fn error(&self, msg: &str) {
        if self.overflowed.load(Ordering::SeqCst) {
            return;
        }
        self.send_event(ChannelEvent::Error(msg.to_string()));
    }
}

#[cfg(test)]
pub(crate) mod testing {
    //! Test-only sink that records every call. Used across `ai_provider`
    //! tests in WI-1.2 and the workflow runner tests in WI-2.2.

    use super::AiSink;
    use std::sync::Mutex;

    #[derive(Debug, Clone, PartialEq)]
    pub enum SinkEvent {
        Chunk(String),
        Done,
        Error(String),
    }

    pub struct RecordingSink {
        events: Mutex<Vec<SinkEvent>>,
    }

    impl RecordingSink {
        pub fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }

        pub fn events(&self) -> Vec<SinkEvent> {
            self.events.lock().expect("sink mutex poisoned").clone()
        }

        pub fn collected_text(&self) -> String {
            self.events
                .lock()
                .expect("sink mutex poisoned")
                .iter()
                .filter_map(|e| match e {
                    SinkEvent::Chunk(s) => Some(s.as_str()),
                    _ => None,
                })
                .collect()
        }
    }

    impl AiSink for RecordingSink {
        fn chunk(&self, text: &str) {
            self.events
                .lock()
                .expect("sink mutex poisoned")
                .push(SinkEvent::Chunk(text.to_string()));
        }

        fn done(&self) {
            self.events
                .lock()
                .expect("sink mutex poisoned")
                .push(SinkEvent::Done);
        }

        fn error(&self, msg: &str) {
            self.events
                .lock()
                .expect("sink mutex poisoned")
                .push(SinkEvent::Error(msg.to_string()));
        }
    }
}

#[cfg(test)]
#[path = "sink.test.rs"]
mod tests;
