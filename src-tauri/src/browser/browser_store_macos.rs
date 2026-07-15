//! Main-thread-only WebKit data-store ownership for browser postures.

use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_web_kit::{WKWebViewConfiguration, WKWebsiteDataStore};
use std::cell::RefCell;

use crate::browser::registry::AutomationMode;

thread_local! {
    /// One app-lifetime non-persistent store shared by AI sandbox tabs.
    static AI_SANDBOX_STORE: RefCell<Option<Retained<WKWebsiteDataStore>>> = RefCell::new(None);
}

pub(super) fn configure(
    config: &WKWebViewConfiguration,
    mtm: MainThreadMarker,
    mode: AutomationMode,
) {
    if !matches!(mode, AutomationMode::AiSandbox) {
        return;
    }
    let store = AI_SANDBOX_STORE.with(|slot| {
        let mut slot = slot.borrow_mut();
        slot.get_or_insert_with(|| unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) })
            .clone()
    });
    unsafe { config.setWebsiteDataStore(&store) };
}

pub(super) fn clear() {
    AI_SANDBOX_STORE.with(|slot| *slot.borrow_mut() = None);
}
