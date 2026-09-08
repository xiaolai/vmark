//! One PDF export at a time (#198, #199).
//!
//! Purpose: `export_pdf` renders, then read-modify-writes the output twice
//! (outline, page numbers), and reports progress to ONE window as stage-only
//! events. Two exports running at once would race over one file and
//! interleave their stages in one dialog. The dialog never starts two — but a
//! Tauri command is an IPC boundary, and a React `exporting` flag on the far
//! side of it is not what makes the backend correct. This is: a second export
//! while one is in flight is refused with `Conflict`, so the file and the
//! progress stream each have exactly one producer by construction.
//!
//! Managed state (`.manage()` in `lib.rs`), not a static: it is reachable from
//! the `AppHandle` every command carries, and per-app, so a test constructs
//! its own rather than sharing one across the binary (rule 50 §10).
//!
//! The renderer itself is NOT gated — `render_pdf` stages beside its own
//! output and the smoke harness runs it concurrently on purpose.
//!
//! @coordinates-with commands.rs — takes the slot for the length of `export_pdf`
//! @coordinates-with renderer/progress.rs — the single listener this makes correct
//! @module pdf_export/export_gate

use std::sync::atomic::{AtomicBool, Ordering};

/// Whether an export is in flight.
#[derive(Debug, Default)]
pub struct ExportGate {
    busy: AtomicBool,
}

/// The running export's hold on the gate. Dropping it reopens the gate — on
/// every exit path of the function that holds it, a `?` included.
#[must_use = "dropping the slot immediately reopens the gate"]
pub struct ExportSlot<'a> {
    gate: &'a ExportGate,
}

impl ExportGate {
    /// Take the slot, or `None` if an export already holds it.
    ///
    /// `then`, never `then_some`: the latter constructs its argument EAGERLY,
    /// so a caller that LOST the compare-and-swap would have built a slot
    /// only to drop it — and the drop reopens the gate. Four of eight
    /// contending threads got in that way; `export_gate.test.rs` pins it.
    pub fn try_begin(&self) -> Option<ExportSlot<'_>> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
            .then(|| ExportSlot { gate: self })
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::Acquire)
    }
}

impl Drop for ExportSlot<'_> {
    fn drop(&mut self) {
        self.gate.busy.store(false, Ordering::Release);
    }
}

#[cfg(test)]
#[path = "export_gate.test.rs"]
mod tests;
