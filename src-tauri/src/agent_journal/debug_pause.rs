//! A debug-only fault hook that holds the register command's reply after the
//! registration has executed, so a native check can interrupt its delivery
//! with a reload and record whether Tauri's IPC fallback executes the command
//! a second time, and what that second execution was answered.
//!
//! Armed by `VMARK_DEBUG_JOURNAL_REGISTER_PAUSE_MS`, read at each call: absent,
//! unparsable or zero is no pause, and the pause is capped at 30 s so a typo
//! cannot wedge a page. Both log lines carry the label and the page identity,
//! so the trace correlates with the registration the fallback repeats.
//!
//! Its one call site compiles only under `debug_assertions`, so a release
//! build has no path to it, whatever its environment. The module itself
//! compiles in every build, so its tests are found wherever `cargo test` runs.

#![cfg_attr(not(debug_assertions), allow(dead_code))]

use std::time::Duration;

/// The variable that arms the pause, in milliseconds.
pub const PAUSE_ENV: &str = "VMARK_DEBUG_JOURNAL_REGISTER_PAUSE_MS";

/// The longest pause the variable can ask for.
pub const PAUSE_CAP: Duration = Duration::from_secs(30);

/// The pause a raw variable value asks for, or `None` for no pause.
pub fn pause_from(raw: Option<&str>) -> Option<Duration> {
    let ms: u64 = raw?.trim().parse().ok()?;
    (ms > 0).then(|| Duration::from_millis(ms).min(PAUSE_CAP))
}

/// Hold the register reply of `label`'s page `page_identity` (a registered,
/// so validated, identity) for the armed pause.
pub async fn after_register(label: &str, page_identity: &str) {
    let Some(pause) = pause_from(std::env::var(PAUSE_ENV).ok().as_deref()) else {
        return;
    };
    log::info!(
        "[agent_journal] debug pause: register executed for {label} page {page_identity}; holding the reply {} ms",
        pause.as_millis()
    );
    tokio::time::sleep(pause).await;
    log::info!("[agent_journal] debug pause: releasing the register reply for {label} page {page_identity}");
}

#[cfg(test)]
#[path = "debug_pause.test.rs"]
mod tests;
