//! Main-thread-only WebKit data-store ownership for browser postures (WI-P6.1).
//!
//! An AiSandbox tab uses one shared **non-persistent** store by default. A tab
//! opened against a NAMED `profile` gets its OWN isolated store, so a login persists
//! and the AI can reuse it by name — the safe path for HttpOnly logins (the cookie
//! storage-state path cannot restore HttpOnly). Opening a named profile is
//! user-approved per call (see `profile_open.rs`); this module only owns the stores.
//!
//! `dataStoreForIdentifier:` is macOS 14+ (VMark's floor is 10.15). Below 14 a named
//! profile gets a SEPARATE non-persistent store — isolated, just not persistent —
//! NEVER the shared singleton (a pre-14 collapse into the singleton would break
//! cross-profile isolation; sec review WI-P6.1 H2).

use crate::browser::registry::AutomationMode;
use objc2::rc::Retained;
use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_foundation::{NSProcessInfo, NSString, NSUUID};
use objc2_web_kit::{WKWebViewConfiguration, WKWebsiteDataStore};
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::HashMap;

/// Cap on distinct named stores held at once — bounds an AI that opens `p1`, `p2`, …
/// to grow persistent stores without limit (sec review WI-P6.1 Medium).
const MAX_NAMED_STORES: usize = 32;

thread_local! {
    /// One app-lifetime non-persistent store shared by UNNAMED AI sandbox tabs.
    static AI_SANDBOX_STORE: RefCell<Option<Retained<WKWebsiteDataStore>>> = RefCell::new(None);
    /// One isolated store per profile name (persistent on macOS 14+, else a distinct
    /// non-persistent store — never the shared singleton).
    static NAMED_STORES: RefCell<HashMap<String, Retained<WKWebsiteDataStore>>> =
        RefCell::new(HashMap::new());
}

/// `dataStoreForIdentifier:` needs macOS 14+.
fn supports_named_stores() -> bool {
    NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        >= 14
}

/// A deterministic UUID for a profile name, so the same name always resolves to the
/// same persistent store. Namespaced SHA-256 with RFC-4122 version/variant bits set,
/// parsed from its string form (the public `NSUUID` constructor).
fn uuid_for_profile(name: &str) -> Option<Retained<NSUUID>> {
    let mut hasher = Sha256::new();
    hasher.update(b"vmark.browser.profile:");
    hasher.update(name.as_bytes());
    let d = hasher.finalize();
    let mut b = [0u8; 16];
    b.copy_from_slice(&d[..16]);
    b[6] = (b[6] & 0x0F) | 0x40; // version 4
    b[8] = (b[8] & 0x3F) | 0x80; // RFC 4122 variant
    let s = format!(
        "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    );
    let nss = NSString::from_str(&s);
    NSUUID::initWithUUIDString(NSUUID::alloc(), &nss)
}

/// Build an isolated store for `name`: persistent (14+) or a distinct non-persistent
/// store (below 14 / UUID failure). NEVER returns the shared singleton.
fn isolated_store_for(name: &str, mtm: MainThreadMarker) -> Retained<WKWebsiteDataStore> {
    if supports_named_stores() {
        if let Some(uuid) = uuid_for_profile(name) {
            return unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm) };
        }
    }
    unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) }
}

/// Select the data store for `mode`/`profile` on the configuration.
///
/// - AiSandbox + a named `profile` → an isolated store (persistent 14+, else distinct
///   non-persistent). Refused (falls back to the shared sandbox) only if the named
///   store cap is exceeded.
/// - AiSandbox (unnamed) → the shared non-persistent sandbox store.
/// - Human / AiShared → leave the config's default (the human's persistent store).
pub(super) fn configure(
    config: &WKWebViewConfiguration,
    mtm: MainThreadMarker,
    mode: AutomationMode,
    profile: Option<&str>,
) {
    if !matches!(mode, AutomationMode::AiSandbox) {
        return;
    }
    if let Some(name) = profile.filter(|n| !n.is_empty()) {
        let store = NAMED_STORES.with(|m| {
            let mut map = m.borrow_mut();
            if let Some(existing) = map.get(name) {
                return Some(existing.clone());
            }
            if map.len() >= MAX_NAMED_STORES {
                return None; // cap reached — do not grow further
            }
            let store = isolated_store_for(name, mtm);
            map.insert(name.to_string(), store.clone());
            Some(store)
        });
        if let Some(store) = store {
            unsafe { config.setWebsiteDataStore(&store) };
            return;
        }
        // Over cap: fall through to the shared sandbox store rather than a new profile.
    }
    let store = AI_SANDBOX_STORE.with(|slot| {
        let mut slot = slot.borrow_mut();
        slot.get_or_insert_with(|| unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) })
            .clone()
    });
    unsafe { config.setWebsiteDataStore(&store) };
}

/// Delete a named profile's persistent on-disk data and drop its cached store, so
/// "Remove profile" actually revokes the login (sec review WI-P6.1 Medium). No-op for
/// an unknown profile. macOS 14+ only (below 14 the stores are non-persistent, so
/// dropping the cache is enough).
pub(super) fn forget_profile(name: &str, mtm: MainThreadMarker) {
    NAMED_STORES.with(|m| {
        m.borrow_mut().remove(name);
    });
    if supports_named_stores() {
        if let Some(uuid) = uuid_for_profile(name) {
            let handler = block2::RcBlock::new(|_err: *mut objc2_foundation::NSError| {});
            unsafe {
                WKWebsiteDataStore::removeDataStoreForIdentifier_completionHandler(
                    &uuid, &handler, mtm,
                )
            };
        }
    }
}

/// Release the shared sandbox profile after AI views are torn down or posture
/// changes. Named persistent stores are intentionally NOT dropped here — they
/// outlive a tab so a profile's login survives for later reuse.
pub(super) fn clear() {
    AI_SANDBOX_STORE.with(|slot| *slot.borrow_mut() = None);
}
