//! Disable macOS App Nap for the VMark process.
//!
//! App Nap suspends the webview when VMark is backgrounded, causing MCP
//! bridge timeouts because `app.emit()` events are never handled by the
//! frozen frontend JavaScript. Disabling App Nap keeps the webview alive.
//!
//! Known limitation: no automated test. The only effect is a process activity
//! held with the OS, and `NSProcessInfo` has no call that reports whether a
//! process is napping, so a unit test has nothing to observe. Check it by hand: with
//! VMark in the background, Activity Monitor's "App Nap" column reads "No".

use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
use std::sync::Once;

static INIT: Once = Once::new();

/// Disable App Nap by starting a long-lived NSProcessInfo activity.
///
/// Safe to call multiple times — only the first call takes effect.
/// The activity token is leaked intentionally to keep it alive for the
/// process lifetime (no matching `endActivity:` call).
pub fn disable_app_nap() {
    INIT.call_once(|| {
        let reason = NSString::from_str("MCP bridge must respond while backgrounded");
        let process_info = NSProcessInfo::processInfo();
        let token = process_info.beginActivityWithOptions_reason(
            NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
            &reason,
        );
        // Leak the token so the activity stays active for the process lifetime.
        std::mem::forget(token);
        log::info!("[app_nap] Disabled App Nap (UserInitiatedAllowingIdleSystemSleep)");
    });
}
