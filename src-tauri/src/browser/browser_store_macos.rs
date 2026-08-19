//! Main-thread-only WebKit data-store ownership for browser postures
//! (WI-P6.1 / WI-NB10.2). The impure adapter over the pure `store_policy`
//! decision in `browser_store_policy.rs`: it maps each `StorePolicy` arm to an
//! actual `WKWebsiteDataStore` and owns the caches, the 32-store cap, and the
//! macOS-version read. Every branch a device could exercise is decided upstream
//! and unit-tested there; this file is only the objc2 realization.
//!
//! - An UNNAMED AI sandbox tab uses one shared **non-persistent** store.
//! - A named AI `profile` gets its OWN isolated store (persistent 14+, else a
//!   distinct non-persistent one), so a login persists for reuse by name — the
//!   safe path for HttpOnly logins. Opening a named profile is user-approved per
//!   call (`profile_open.rs`); this module only owns the stores.
//! - **Human and AiShared** tabs get VMark's own **identified persistent** store
//!   on macOS 14+ (WI-NB10.2 / D6v2), isolating browsed-page storage from the
//!   app's default store; on macOS ≤ 13 they keep the default store (isolation
//!   goal not met — stated in `store_policy`). This costs existing Human-tab
//!   logins a one-time migration.
//!
//! `dataStoreForIdentifier:` is macOS 14+ (VMark's floor is 10.15). Below 14 a
//! named profile gets a SEPARATE non-persistent store — isolated, just not
//! persistent — NEVER the shared singleton (a pre-14 collapse into the singleton
//! would break cross-profile isolation; sec review WI-P6.1 H2).
//!
//! The human store's UUID is derived from a namespace (`vmark.browser.human`)
//! that no AI-profile name can produce, so a sandbox profile literally named
//! `vmark-human-browsing` can never alias the human store (see
//! `browser_store_policy.rs`).

use crate::browser::browser_store_policy::{store_policy, StorePolicy, MIN_IDENTIFIED_STORE_MACOS};
use crate::browser::registry::AutomationMode;
use objc2::rc::Retained;
use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_foundation::{NSProcessInfo, NSRunLoop, NSString, NSUUID};
use objc2_web_kit::{WKWebViewConfiguration, WKWebsiteDataStore};
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

/// Cap on distinct named stores held at once — bounds an AI that opens `p1`, `p2`, …
/// to grow persistent stores without limit (sec review WI-P6.1 Medium).
const MAX_NAMED_STORES: usize = 32;

thread_local! {
    /// One app-lifetime non-persistent store shared by UNNAMED AI sandbox tabs.
    static AI_SANDBOX_STORE: RefCell<Option<Retained<WKWebsiteDataStore>>> = const { RefCell::new(None) };
    /// One isolated store per profile name (persistent on macOS 14+, else a distinct
    /// non-persistent store — never the shared singleton).
    static NAMED_STORES: RefCell<HashMap<String, Retained<WKWebsiteDataStore>>> =
        RefCell::new(HashMap::new());
    /// The single identified persistent human-browsing store (macOS 14+). Long-lived
    /// like the named stores — deliberately NOT dropped by `clear()`.
    static HUMAN_STORE: RefCell<Option<Retained<WKWebsiteDataStore>>> = const { RefCell::new(None) };
}

/// The host's macOS major version. The ONLY version read in the store layer — the
/// pure `store_policy` takes this as an argument so the decision table is testable
/// at 13/14/26 without a device.
fn current_macos_major() -> i64 {
    NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion as i64
}

/// Finish an RFC-4122 v4 UUID from a 32-byte hash: set the version/variant bits and
/// parse the canonical string via the public `NSUUID` constructor. Shared by the
/// profile and human derivations so both produce identity the same way.
fn finalize_uuid(digest: &[u8]) -> Option<Retained<NSUUID>> {
    let mut b = [0u8; 16];
    b.copy_from_slice(&digest[..16]);
    b[6] = (b[6] & 0x0F) | 0x40; // version 4
    b[8] = (b[8] & 0x3F) | 0x80; // RFC 4122 variant
    let s = format!(
        "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    );
    let nss = NSString::from_str(&s);
    NSUUID::initWithUUIDString(NSUUID::alloc(), &nss)
}

/// A deterministic UUID for a profile name, so the same name always resolves to the
/// same persistent store. Namespace `vmark.browser.profile:` — UNCHANGED, so
/// existing named-profile stores keep their identity across this refactor.
fn uuid_for_profile(name: &str) -> Option<Retained<NSUUID>> {
    let mut hasher = Sha256::new();
    hasher.update(b"vmark.browser.profile:");
    hasher.update(name.as_bytes());
    finalize_uuid(&hasher.finalize())
}

/// The identity of VMark's human-browsing store. A namespace (`vmark.browser.human`)
/// with no name component — no AI-profile name (which always hashes after
/// `vmark.browser.profile:`) can collide with it, so the sandbox boundary holds.
fn uuid_for_human() -> Option<Retained<NSUUID>> {
    let mut hasher = Sha256::new();
    hasher.update(b"vmark.browser.human");
    finalize_uuid(&hasher.finalize())
}

/// Build (or reuse) a named profile's isolated store. `persistent` comes from the
/// policy arm, not a re-read of the OS version. Enforces the 32-store cap and
/// **fails closed** with `PROFILE_STORE_LIMIT` rather than sharing the sandbox
/// store when the cap is exceeded (sec review WI-P6.1 H2).
fn named_store(
    name: &str,
    mtm: MainThreadMarker,
    persistent: bool,
) -> Result<Retained<WKWebsiteDataStore>, String> {
    let store = NAMED_STORES.with(|m| {
        let mut map = m.borrow_mut();
        if let Some(existing) = map.get(name) {
            return Some(existing.clone());
        }
        if map.len() >= MAX_NAMED_STORES {
            return None; // cap reached — refuse rather than share
        }
        let store = build_isolated_store(name, mtm, persistent);
        map.insert(name.to_string(), store.clone());
        Some(store)
    });
    store.ok_or_else(|| crate::browser::surface::fail::PROFILE_STORE_LIMIT.to_string())
}

/// A fresh isolated store: persistent identified (14+) or a distinct non-persistent
/// one. NEVER the shared singleton. `persistent` is authoritative; a UUID-parse
/// failure degrades to non-persistent (isolated, just not durable).
fn build_isolated_store(
    name: &str,
    mtm: MainThreadMarker,
    persistent: bool,
) -> Retained<WKWebsiteDataStore> {
    if persistent {
        if let Some(uuid) = uuid_for_profile(name) {
            return unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm) };
        }
    }
    unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) }
}

/// The app-lifetime shared non-persistent store for unnamed AI sandbox tabs.
fn shared_sandbox_store(mtm: MainThreadMarker) -> Retained<WKWebsiteDataStore> {
    AI_SANDBOX_STORE.with(|slot| {
        let mut slot = slot.borrow_mut();
        slot.get_or_insert_with(|| unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) })
            .clone()
    })
}

/// VMark's identified persistent human-browsing store (macOS 14+). `None` only if
/// the (constructed-valid) UUID string fails to parse — the caller then leaves the
/// config default rather than dropping the human onto a non-persistent store.
fn human_store(mtm: MainThreadMarker) -> Option<Retained<WKWebsiteDataStore>> {
    HUMAN_STORE.with(|slot| {
        let mut slot = slot.borrow_mut();
        if let Some(existing) = slot.as_ref() {
            return Some(existing.clone());
        }
        let uuid = uuid_for_human()?;
        let store = unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm) };
        *slot = Some(store.clone());
        Some(store)
    })
}

/// Select the data store for `mode`/`profile` on the configuration, per the pure
/// `store_policy` decision. The store is chosen before `WKWebView` construction —
/// the only safe WebKit seam.
pub(super) fn configure(
    config: &WKWebViewConfiguration,
    mtm: MainThreadMarker,
    mode: AutomationMode,
    profile: Option<&str>,
) -> Result<(), String> {
    match store_policy(mode, profile, current_macos_major()) {
        // Human/AiShared on macOS ≤ 13: leave the config's default persistent store.
        StorePolicy::Default => Ok(()),
        StorePolicy::SharedSandbox => {
            let store = shared_sandbox_store(mtm);
            unsafe { config.setWebsiteDataStore(&store) };
            Ok(())
        }
        StorePolicy::HumanPersistent => {
            // On the impossible UUID-parse failure, leave the config default
            // (persistent) store rather than degrade the human to a non-persistent
            // one that would lose logins on every launch.
            if let Some(store) = human_store(mtm) {
                unsafe { config.setWebsiteDataStore(&store) };
            }
            Ok(())
        }
        StorePolicy::NamedPersistent(name) => {
            let store = named_store(&name, mtm, true)?;
            unsafe { config.setWebsiteDataStore(&store) };
            Ok(())
        }
        StorePolicy::NamedEphemeral(name) => {
            let store = named_store(&name, mtm, false)?;
            unsafe { config.setWebsiteDataStore(&store) };
            Ok(())
        }
    }
}

/// Delete a named profile's persistent on-disk data and drop its cached store, so
/// "Remove profile" actually revokes the login (sec review WI-P6.1 Removal). The
/// deletion is **confirmed**: we pump the run loop until the completion handler fires
/// and return an error on failure/timeout, so the UI never reports a profile gone
/// while its login survives on disk. Below macOS 14 the per-profile store is
/// non-persistent, so dropping the cached handle above is a complete revocation.
pub(super) fn forget_profile(name: &str, mtm: MainThreadMarker) -> Result<(), String> {
    NAMED_STORES.with(|m| {
        m.borrow_mut().remove(name);
    });
    if current_macos_major() < MIN_IDENTIFIED_STORE_MACOS {
        return Ok(());
    }
    let Some(uuid) = uuid_for_profile(name) else {
        return Err("could not derive the profile store identity".into());
    };
    let result: Rc<RefCell<Option<Result<(), String>>>> = Rc::new(RefCell::new(None));
    let sink = result.clone();
    let handler = block2::RcBlock::new(move |err: *mut objc2_foundation::NSError| {
        // The NSError (if any) is a generic file-system error, never a credential; we
        // record only success/failure, not its text.
        let outcome = if err.is_null() {
            Ok(())
        } else {
            Err("the profile store could not be removed".to_string())
        };
        *sink.borrow_mut() = Some(outcome);
    });
    unsafe {
        WKWebsiteDataStore::removeDataStoreForIdentifier_completionHandler(&uuid, &handler, mtm)
    };
    let run_loop = NSRunLoop::mainRunLoop();
    super::pump_until(&run_loop, Duration::from_secs(5), 0.05, || {
        result.borrow().is_some()
    });
    let outcome = result.borrow_mut().take();
    outcome.unwrap_or_else(|| Err("timed out confirming the profile store was removed".into()))
}

/// Release the shared sandbox profile after AI views are torn down or posture
/// changes. Named persistent stores and the human store are intentionally NOT
/// dropped here — they outlive a tab so a login survives for later reuse.
pub(super) fn clear() {
    AI_SANDBOX_STORE.with(|slot| *slot.borrow_mut() = None);
}
