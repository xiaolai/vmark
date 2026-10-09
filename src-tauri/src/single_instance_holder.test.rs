// #1527 — a second launch must not become a second VMark when the instance
// holding the lock cannot be reached.
use super::*;
use std::cell::Cell;

fn probes(seq: &[(bool, bool)]) -> impl FnMut() -> Probe + '_ {
    let next = Cell::new(0usize);
    move || {
        let i = next.get().min(seq.len() - 1);
        next.set(next.get() + 1);
        Probe {
            lock_held: seq[i].0,
            window_found: seq[i].1,
        }
    }
}

#[test]
fn no_lock_means_this_launch_is_the_first() {
    assert_eq!(classify(probes(&[(false, false)]), 5, || {}), Holder::None);
}

#[test]
fn a_lock_with_its_window_is_reachable_and_left_to_the_plugin() {
    assert_eq!(
        classify(probes(&[(true, true)]), 5, || {}),
        Holder::Reachable
    );
}

#[test]
fn a_holder_still_starting_up_is_waited_for() {
    // The holder creates the lock a moment before its window.
    let seq = [(true, false), (true, false), (true, true)];
    let waits = Cell::new(0);
    let held = classify(probes(&seq), 5, || waits.set(waits.get() + 1));
    assert_eq!(held, Holder::Reachable);
    assert_eq!(waits.get(), 2);
}

#[test]
fn a_holder_that_exits_while_waited_for_frees_the_launch() {
    let seq = [(true, false), (false, false)];
    assert_eq!(classify(probes(&seq), 5, || {}), Holder::None);
}

#[test]
fn a_lock_whose_window_never_appears_is_unreachable() {
    let waits = Cell::new(0);
    let held = classify(probes(&[(true, false)]), 5, || waits.set(waits.get() + 1));
    assert_eq!(held, Holder::Unreachable);
    assert_eq!(waits.get(), 4, "no wait after the last probe");
}

#[test]
fn zero_attempts_still_probes_once() {
    assert_eq!(classify(probes(&[(false, false)]), 0, || {}), Holder::None);
}

#[test]
fn object_names_match_the_plugin_without_its_semver_feature() {
    let names = ObjectNames::for_identifier("app.vmark");
    assert_eq!(names.mutex, "app.vmark-sim");
    assert_eq!(names.class, "app.vmark-sic");
    assert_eq!(names.window, "app.vmark-siw");
}

#[test]
fn os_locales_map_onto_the_shipped_bundles() {
    let shipped = [
        "de", "en", "es", "fr", "it", "ja", "ko", "pt-BR", "zh-CN", "zh-TW",
    ];
    for (os, bundle) in [
        ("zh-CN", "zh-CN"),
        ("zh-SG", "zh-CN"),
        ("zh-Hans-CN", "zh-CN"),
        ("zh-TW", "zh-TW"),
        ("zh-HK", "zh-TW"),
        ("zh-Hant", "zh-TW"),
        ("ja-JP", "ja"),
        ("pt-PT", "pt-BR"),
        ("PT_br", "pt-BR"),
        ("de-AT", "de"),
        ("en-GB", "en"),
        ("sv-SE", "en"),
        ("", "en"),
    ] {
        assert_eq!(bundle_for_os_locale(os, &shipped), bundle, "{os}");
    }
}
