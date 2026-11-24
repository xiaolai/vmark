//! Linux fullscreen requests: one in flight per window, plus the latest state
//! the user asked for (#1715). A child of `menu/events/fullscreen.rs`.
//!
//! The window manager applies a request asynchronously and may coalesce or
//! reorder overlapping ones, so a burst of F11 presses is never sent as a
//! burst. The first press sends a request; further presses while it is in
//! flight only flip `desired`. When GTK reports the in-flight state
//! (`fullscreen_gtk.rs`), the slot settles if that is what the user wants,
//! or the next request goes out. A request the window manager never applies
//! expires after `PENDING_WINDOW`, and the realized state decides again.
//!
//! Pure over a map so the rules are testable without GTK; compiled on Linux
//! and under test only.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// How long an unacknowledged request is trusted over the realized state.
pub(super) const PENDING_WINDOW: Duration = Duration::from_millis(750);

/// One window's outstanding fullscreen work.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Pending {
    /// The state the request in flight asked for.
    pub in_flight: bool,
    /// When that request was sent.
    pub since: Instant,
    /// The state the user wants once everything lands.
    pub desired: bool,
}

static PENDING: Mutex<Option<HashMap<String, Pending>>> = Mutex::new(None);

/// The per-window slots. Never held across a native call: a state change can
/// be dispatched synchronously and would re-enter `apply_observed`.
pub(super) fn pending() -> MutexGuard<'static, Option<HashMap<String, Pending>>> {
    PENDING.lock().unwrap_or_else(|p| p.into_inner())
}

/// A press. Returns the slot to keep and the request to send now, if any.
pub(super) fn on_press(
    slot: Option<Pending>,
    realized: bool,
    now: Instant,
) -> (Pending, Option<bool>) {
    match slot {
        Some(slot) if now.saturating_duration_since(slot.since) < PENDING_WINDOW => (
            Pending {
                desired: !slot.desired,
                ..slot
            },
            None,
        ),
        _ => {
            let next = !realized;
            (
                Pending {
                    in_flight: next,
                    since: now,
                    desired: next,
                },
                Some(next),
            )
        }
    }
}

/// GTK reported the realized state. Returns the slot to keep (`None`: settled)
/// and the next request to send, if any. A state other than the one in
/// flight is an earlier transition landing, or the window manager acting, and
/// changes nothing.
pub(super) fn on_observed(
    slot: Pending,
    realized: bool,
    now: Instant,
) -> (Option<Pending>, Option<bool>) {
    if realized != slot.in_flight {
        return (Some(slot), None);
    }
    if slot.desired == realized {
        return (None, None);
    }
    (
        Some(Pending {
            in_flight: slot.desired,
            since: now,
            desired: slot.desired,
        }),
        Some(slot.desired),
    )
}

/// `on_press` against `label`'s slot in `map`; returns the request to send.
pub(super) fn apply_press(
    map: &mut HashMap<String, Pending>,
    label: &str,
    realized: bool,
    now: Instant,
) -> Option<bool> {
    let (slot, request) = on_press(map.get(label).copied(), realized, now);
    map.insert(label.to_string(), slot);
    request
}

/// `on_observed` against `label`'s slot in `map`; returns the request to send.
pub(super) fn apply_observed(
    map: &mut HashMap<String, Pending>,
    label: &str,
    realized: bool,
    now: Instant,
) -> Option<bool> {
    let slot = map.get(label).copied()?;
    let (slot, request) = on_observed(slot, realized, now);
    match slot {
        Some(slot) => map.insert(label.to_string(), slot),
        None => map.remove(label),
    };
    request
}
