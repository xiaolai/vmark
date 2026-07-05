//! Tests for `text_substitution.rs` (included via `#[path]`; macOS-only).
//!
//! The keys must be PRESENT and false in the standard defaults after the
//! call — `boolForKey` alone returns false for missing keys, which would
//! make a no-op implementation pass.

use objc2_foundation::{ns_string, NSUserDefaults};

#[test]
fn smart_substitution_keys_are_set_and_disabled() {
    disable_smart_substitutions();

    let defaults = NSUserDefaults::standardUserDefaults();
    for key in [
        ns_string!("NSAutomaticDashSubstitutionEnabled"),
        ns_string!("NSAutomaticQuoteSubstitutionEnabled"),
        ns_string!("NSAutomaticPeriodSubstitutionEnabled"),
    ] {
        let present = defaults.objectForKey(key).is_some();
        assert!(present, "{key} should be written, not merely defaulted");
        let enabled = defaults.boolForKey(key);
        assert!(!enabled, "{key} should be disabled");
    }
}

use super::disable_smart_substitutions;
