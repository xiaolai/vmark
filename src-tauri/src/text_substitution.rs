//! Disable macOS "smart" text substitutions app-wide (macOS-only module).
//!
//! Purpose: WKWebView applies the system NSSpellChecker substitution
//! pipeline to `contenteditable` content BELOW ProseMirror — with the OS
//! default "Use smart quotes and dashes" enabled, typing `--` becomes `—`
//! even inside code blocks (mermaid arrows `-->` corrupted to `—>`), and
//! straight quotes become curly ones in code/links. A markdown editor's
//! content is syntax; these substitutions corrupt it, so they are disabled
//! in the app's defaults domain (the standard approach for editor apps).
//! IME behavior and user-initiated text replacement are unaffected.

use objc2_foundation::{ns_string, NSUserDefaults};

/// Persist `false` for the smart-substitution keys in VMark's defaults
/// domain. Idempotent; called once at startup before any webview input.
pub(crate) fn disable_smart_substitutions() {
    let defaults = NSUserDefaults::standardUserDefaults();
    for key in [
        ns_string!("NSAutomaticDashSubstitutionEnabled"),
        ns_string!("NSAutomaticQuoteSubstitutionEnabled"),
        ns_string!("NSAutomaticPeriodSubstitutionEnabled"),
    ] {
        defaults.setBool_forKey(false, key);
    }
}

#[cfg(test)]
#[path = "text_substitution.test.rs"]
mod tests;
