//! The geometry a Linux window had before it went full screen, kept on disk
//! until the window-state plugin has saved a normal size for it (#1723). A child of
//! `menu/events/fullscreen.rs`; `fullscreen_restore.rs` explains the
//! window-state plugin gap this undoes, and does the I/O.
//!
//! Pure so the rules are testable without GTK; compiled on Linux and under
//! test only. Units are the window-state plugin's: physical inner size and
//! physical outer position.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

/// The records file, in the app config dir beside the plugin's own.
pub(crate) const RECORDS_FILE: &str = ".fullscreen-geometry.json";

/// The largest edge a record may ask for: X11's coordinate limit, far past
/// any real monitor. Anything larger is damage, not a window.
pub(crate) const MAX_EDGE: u32 = 32_767;

/// A window's normal geometry.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Geometry {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

impl Geometry {
    fn is_usable(&self) -> bool {
        (1..=MAX_EDGE).contains(&self.width) && (1..=MAX_EDGE).contains(&self.height)
    }
}

/// A monitor's physical bounds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Pre-full-screen geometry by window label.
pub(crate) type Records = BTreeMap<String, Geometry>;

/// Read the records file. Each entry stands alone: an unreadable file or
/// entry is skipped, never an error — a damaged file must not keep a window
/// from opening, nor cost the other windows their records.
pub(crate) fn parse_records(raw: &[u8]) -> Records {
    let Ok(entries) = serde_json::from_slice::<BTreeMap<String, serde_json::Value>>(raw) else {
        return Records::new();
    };
    entries
        .into_iter()
        .filter_map(|(label, value)| {
            let g: Geometry = serde_json::from_value(value).ok()?;
            g.is_usable().then_some((label, g))
        })
        .collect()
}

pub(crate) fn serialize_records(records: &Records) -> Vec<u8> {
    // Serializing a map of plain structs cannot fail.
    serde_json::to_vec_pretty(records).unwrap_or_default()
}

/// A window's most recent normal geometry that is not exactly a monitor's
/// size.
///
/// GTK need not report the FULLSCREEN state before the monitor-sized
/// configures that come with it (X11 sends them as separate notifications),
/// so a "normal" sample of exactly a monitor's size is taken to be one of
/// those and skipped. The cost: a window the user sized to exactly a monitor,
/// without maximizing it, keeps the size it had before that.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct NormalHistory {
    pub normal: Option<Geometry>,
}

impl NormalHistory {
    /// A configure while GTK reported the window neither full screen,
    /// maximized nor minimized.
    pub fn push(&mut self, g: Geometry, monitors: &[MonitorRect]) {
        let monitor_sized = monitors
            .iter()
            .any(|m| m.width == g.width && m.height == g.height);
        if !monitor_sized {
            self.normal = Some(g);
        }
    }
}

/// `label` entered full screen; `before` is its normal geometry, if known.
/// Returns whether `records` changed.
pub(crate) fn record_entry(records: &mut Records, label: &str, before: Option<Geometry>) -> bool {
    match before.filter(Geometry::is_usable) {
        Some(g) => records.insert(label.to_string(), g) != Some(g),
        None => false,
    }
}

/// Each window's size in the window-state plugin's file. Unreadable entries
/// are skipped.
pub(crate) fn parse_saved_sizes(raw: &[u8]) -> HashMap<String, (u32, u32)> {
    #[derive(Deserialize)]
    struct Saved {
        width: u32,
        height: u32,
    }
    let Ok(entries) = serde_json::from_slice::<BTreeMap<String, serde_json::Value>>(raw) else {
        return HashMap::new();
    };
    entries
        .into_iter()
        .filter_map(|(label, value)| {
            let s: Saved = serde_json::from_value(value).ok()?;
            Some((label, (s.width, s.height)))
        })
        .collect()
}

/// After the window-state plugin's exit save: retire each record the plugin
/// has now saved over — the size it saved for that label is the window's
/// latest normal size seen this run. Anything else keeps its record: a
/// window still full screen, closed in full screen, quit before its normal
/// size came back, whose restored size never landed, not opened this run,
/// or whose plugin save failed. Returns whether `records` changed.
pub(crate) fn retire_at_exit(
    records: &mut Records,
    normal: &HashMap<String, Geometry>,
    saved: &HashMap<String, (u32, u32)>,
) -> bool {
    let before = records.len();
    records.retain(|label, _| {
        let superseded = matches!(
            (normal.get(label), saved.get(label)),
            (Some(g), Some(&size)) if (g.width, g.height) == size
        );
        !superseded
    });
    records.len() != before
}

/// Whether any corner of `g` lies on a monitor — the window-state plugin's
/// own test before it restores a position.
pub(crate) fn on_any_monitor(g: Geometry, monitors: &[MonitorRect]) -> bool {
    let (x, y) = (i64::from(g.x), i64::from(g.y));
    let (w, h) = (i64::from(g.width), i64::from(g.height));
    let corners = [(x, y), (x + w, y), (x, y + h), (x + w, y + h)];
    monitors.iter().any(|m| {
        let (left, top) = (i64::from(m.x), i64::from(m.y));
        let (right, bottom) = (left + i64::from(m.width), top + i64::from(m.height));
        corners
            .iter()
            .any(|&(cx, cy)| cx >= left && cx < right && cy >= top && cy < bottom)
    })
}

#[cfg(test)]
#[path = "fullscreen_geometry.test.rs"]
mod tests;
