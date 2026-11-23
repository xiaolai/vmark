//! Tests for `menu/events/fullscreen_geometry.rs` — the pre-full-screen
//! geometry records that undo the window-state plugin's monitor-sized save
//! on Linux (#1723).

use std::collections::HashMap;

use super::*;

const NORMAL: Geometry = Geometry {
    width: 900,
    height: 600,
    x: 120,
    y: 80,
};

fn records(pairs: &[(&str, Geometry)]) -> Records {
    pairs.iter().map(|(l, g)| (l.to_string(), *g)).collect()
}

// --- parse_records / serialize_records ----------------------------------------

#[test]
fn records_round_trip_through_the_file_format() {
    let saved = records(&[("main", NORMAL), ("doc-2", Geometry { x: -40, ..NORMAL })]);
    assert_eq!(parse_records(&serialize_records(&saved)), saved);
}

#[test]
fn a_missing_empty_or_corrupt_file_reads_as_no_records() {
    for raw in [
        &b""[..],
        b"   ",
        b"{",
        b"not json",
        b"[]",
        b"null",
        b"{\"main\": 5}",
        b"{\"main\": {\"width\": -1, \"height\": 600, \"x\": 0, \"y\": 0}}",
        b"\xff\xfe\x00",
    ] {
        assert_eq!(parse_records(raw), Records::new(), "{raw:?}");
    }
}

#[test]
fn a_bad_entry_costs_only_itself() {
    let raw = br#"{
        "main": {"width": 0, "height": 600, "x": 0, "y": 0},
        "doc-3": {"width": 4294967295, "height": 600, "x": 0, "y": 0},
        "doc-4": "garbage",
        "doc-2": {"width": 900, "height": 600, "x": 120, "y": 80}
    }"#;
    assert_eq!(parse_records(raw), records(&[("doc-2", NORMAL)]));
}

#[test]
fn edges_are_bounded_at_both_ends() {
    let at = |width, height| Geometry {
        width,
        height,
        ..NORMAL
    };
    let mut map = Records::new();
    assert!(record_entry(&mut map, "a", Some(at(MAX_EDGE, 1))));
    assert!(!record_entry(&mut map, "b", Some(at(MAX_EDGE + 1, 600))));
    assert!(!record_entry(&mut map, "c", Some(at(900, 0))));
    assert_eq!(map.len(), 1);
}

#[test]
fn unicode_labels_survive_the_file() {
    let saved = records(&[("文档-1", NORMAL)]);
    assert_eq!(parse_records(&serialize_records(&saved)), saved);
}

// --- record_entry ---------------------------------------------------------------

#[test]
fn entering_full_screen_records_the_geometry_before_it() {
    let mut map = Records::new();
    assert!(record_entry(&mut map, "main", Some(NORMAL)));
    assert_eq!(map, records(&[("main", NORMAL)]));
}

#[test]
fn entering_without_a_known_normal_geometry_records_nothing() {
    let mut map = Records::new();
    assert!(!record_entry(&mut map, "main", None));
    assert!(map.is_empty());
}

#[test]
fn re_entering_with_the_same_geometry_is_not_a_change() {
    let mut map = records(&[("main", NORMAL)]);
    assert!(!record_entry(&mut map, "main", Some(NORMAL)));
    let wider = Geometry {
        width: 1000,
        ..NORMAL
    };
    assert!(record_entry(&mut map, "main", Some(wider)));
    assert_eq!(map["main"], wider);
}

// --- NormalHistory --------------------------------------------------------------

const MONITOR: MonitorRect = MonitorRect {
    x: 0,
    y: 0,
    width: 2560,
    height: 1440,
};
const FULL: Geometry = Geometry {
    width: 2560,
    height: 1440,
    x: 0,
    y: 0,
};

#[test]
fn the_latest_normal_sample_is_the_one_recorded() {
    // Wayland: the FULLSCREEN state is known before the monitor-sized
    // configure, so that configure is never sampled.
    let mut h = NormalHistory::default();
    h.push(
        Geometry {
            width: 800,
            ..NORMAL
        },
        &[MONITOR],
    );
    h.push(NORMAL, &[MONITOR]);
    assert_eq!(h.normal, Some(NORMAL));
    // A move alone is a new sample.
    let moved = Geometry { x: 300, ..NORMAL };
    h.push(moved, &[MONITOR]);
    assert_eq!(h.normal, Some(moved));
}

#[test]
fn monitor_sized_configures_ahead_of_the_state_are_skipped() {
    // X11: one or more monitor-sized configures — a resize, then a move —
    // can land while GTK still reports a normal window.
    let mut h = NormalHistory::default();
    h.push(NORMAL, &[MONITOR]);
    h.push(FULL, &[MONITOR]);
    h.push(Geometry { x: 40, ..FULL }, &[MONITOR]);
    assert_eq!(h.normal, Some(NORMAL));
    // With nothing before them there is nothing trustworthy to record.
    let mut only_full = NormalHistory::default();
    only_full.push(FULL, &[MONITOR]);
    assert_eq!(only_full.normal, None);
}

#[test]
fn any_connected_monitor_size_counts() {
    let small = MonitorRect {
        x: 2560,
        y: 0,
        width: 1920,
        height: 1080,
    };
    let mut h = NormalHistory::default();
    h.push(NORMAL, &[MONITOR, small]);
    h.push(
        Geometry {
            width: 1920,
            height: 1080,
            x: 2560,
            y: 0,
        },
        &[MONITOR, small],
    );
    assert_eq!(h.normal, Some(NORMAL));
}

// --- parse_saved_sizes / retire_at_exit -------------------------------------------

#[test]
fn the_plugins_file_is_read_per_entry() {
    let raw = br#"{
        "main": {"width": 1800, "height": 1200, "x": 0, "y": 0, "prev_x": 0, "prev_y": 0,
                 "maximized": false, "visible": true, "decorated": true, "fullscreen": false},
        "doc-2": {"width": "wide"}
    }"#;
    let sizes = parse_saved_sizes(raw);
    assert_eq!(sizes.get("main"), Some(&(1800, 1200)));
    assert_eq!(sizes.len(), 1);
    assert!(parse_saved_sizes(b"{").is_empty());
}

#[test]
fn a_record_is_retired_only_once_the_plugin_saved_the_normal_size() {
    let other = Geometry {
        width: 700,
        ..NORMAL
    };
    let mut map = records(&[
        ("main", NORMAL),   // left full screen; plugin saved 900x600
        ("doc-2", other),   // still or closed full screen; plugin saved the monitor
        ("doc-9", NORMAL),  // not opened this run
        ("文档-1", NORMAL), // left full screen; plugin saved 900x600
        ("doc-5", NORMAL),  // the plugin's save failed: no entry
    ]);
    let normal: HashMap<String, Geometry> = [
        ("main", NORMAL),
        ("doc-2", other),
        ("文档-1", NORMAL),
        ("doc-5", NORMAL),
    ]
    .into_iter()
    .map(|(l, g)| (l.to_string(), g))
    .collect();
    let saved: HashMap<String, (u32, u32)> = [
        ("main", (900, 600)),
        ("doc-2", (2560, 1440)),
        ("doc-9", (900, 600)),
        ("文档-1", (900, 600)),
    ]
    .into_iter()
    .map(|(l, s)| (l.to_string(), s))
    .collect();
    assert!(retire_at_exit(&mut map, &normal, &saved));
    assert_eq!(
        map,
        records(&[("doc-2", other), ("doc-5", NORMAL), ("doc-9", NORMAL)])
    );
    assert!(!retire_at_exit(&mut map, &normal, &saved));
}

// --- on_any_monitor --------------------------------------------------------------

#[test]
fn a_position_is_restored_only_onto_a_present_monitor() {
    let monitors = [MonitorRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    }];
    assert!(on_any_monitor(NORMAL, &monitors));
    let gone = Geometry {
        x: 4000,
        y: 4000,
        ..NORMAL
    };
    assert!(!on_any_monitor(gone, &monitors));
    assert!(!on_any_monitor(NORMAL, &[]));
    // Only a corner on screen still counts, as in the plugin.
    let corner = Geometry {
        x: -800,
        y: -500,
        ..NORMAL
    };
    assert!(on_any_monitor(corner, &monitors));
}

#[test]
fn extreme_coordinates_do_not_overflow() {
    let monitors = [MonitorRect {
        x: i32::MAX - 10,
        y: i32::MAX - 10,
        width: u32::MAX,
        height: u32::MAX,
    }];
    let far = Geometry {
        width: u32::MAX,
        height: u32::MAX,
        x: i32::MAX,
        y: i32::MAX,
    };
    // Must not panic in a debug build; the answer itself is incidental.
    let _ = on_any_monitor(far, &monitors);
}

#[test]
fn the_records_file_never_shares_the_plugins_file() {
    // Overwriting the plugin's state with ours would lose every other window.
    assert_ne!(RECORDS_FILE, tauri_plugin_window_state::DEFAULT_FILENAME);
}
