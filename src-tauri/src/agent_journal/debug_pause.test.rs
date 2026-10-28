// WI-AL2.2g — the debug-only register pause that R102's duplicate-execution trace drives: only a positive whole number of milliseconds arms it, and it never exceeds its cap
use std::time::Duration;

use super::{pause_from, PAUSE_CAP};

#[test]
fn an_absent_empty_or_unparsable_value_does_not_pause() {
    for raw in [
        None,
        Some(""),
        Some("  "),
        Some("abc"),
        Some("-5"),
        Some("1.5"),
        Some("0"),
    ] {
        assert_eq!(pause_from(raw), None, "{raw:?}");
    }
}

#[test]
fn a_positive_value_pauses_that_long_up_to_the_cap() {
    assert_eq!(pause_from(Some("250")), Some(Duration::from_millis(250)));
    assert_eq!(pause_from(Some(" 40 ")), Some(Duration::from_millis(40)));
    assert_eq!(pause_from(Some("30000")), Some(PAUSE_CAP));
    assert_eq!(pause_from(Some("999999999")), Some(PAUSE_CAP));
}

#[tokio::test]
async fn an_unarmed_pause_returns_at_once() {
    // The variable is never set by the test suite; if a developer's shell
    // exports it, this test says so instead of waiting.
    assert!(
        std::env::var(super::PAUSE_ENV).is_err(),
        "unset the pause variable to run the tests"
    );
    let started = std::time::Instant::now();
    super::after_register("main", "00000000000000000000000000000000").await;
    assert!(started.elapsed() < Duration::from_millis(100));
}
