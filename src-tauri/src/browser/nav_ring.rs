//! The pure half of WebKit navigation identity (audit 20260903 round 4, #19).
//!
//! WebKit hands every `WKNavigationDelegate` callback the `WKNavigation` it is
//! about — and it can deliver a callback for an OLDER navigation after a newer one
//! has started: a late redirect, a stale commit. `nav_registry_identity_macos.rs`
//! pairs each native navigation (by pointer identity, `usize`) with the registry
//! ticket it belongs to; this module is that pairing with WebKit removed, so the
//! rule can be table-tested on every target.
//!
//! The ring holds the last [`CAPACITY`] navigations a tab started. Older ones are
//! evicted, and a callback carrying an evicted navigation is unmapped — which
//! [`decide`] treats as NOT current, because every load we started or observed was
//! recorded at its provisional start; the only way to be unmapped is to have been
//! superseded that many times over. A callback with no navigation object at all
//! cannot be attributed and is taken as current.
//!
//! The entries are the delegate's own `Vec<(usize, String)>` ivar; the functions
//! here are the only writers and readers it uses.
//!
//! @coordinates-with browser/nav_registry_identity_macos.rs — the WebKit caller

/// A native navigation's identity (its `WKNavigation` pointer) paired with the
/// registry ticket id it was started under.
pub type Entry = (usize, String);

/// How many navigations a tab remembers. Eight is far more than can be in flight
/// at once, and bounds a tab that navigates forever.
pub const CAPACITY: usize = 8;

/// Record that native navigation `key` started under ticket `id`. Re-pushing a
/// key replaces its ticket (a `WKNavigation` object is never two loads at once);
/// past `CAPACITY` the OLDEST entry is evicted.
pub fn push(ring: &mut Vec<Entry>, key: usize, id: String) {
    ring.retain(|(existing, _)| *existing != key);
    ring.push((key, id));
    if ring.len() > CAPACITY {
        ring.remove(0);
    }
}

/// The ticket `key` was started under, if it is still remembered.
pub fn lookup(ring: &[Entry], key: usize) -> Option<&str> {
    ring.iter()
        .find_map(|(known, id)| (*known == key).then_some(id.as_str()))
}

/// Does a delegate callback belong to the CURRENT navigation?
///
/// `known` is what the callback carried, resolved through [`lookup`]: `None` — no
/// navigation object at all, unattributable, taken as current; `Some(None)` — a
/// navigation we never mapped (evicted, superseded), NOT current; `Some(Some(id))`
/// — decided by `is_current`, the registry's word on the live ticket. Used by the
/// redirect and commit callbacks so neither can mark or un-load the live
/// navigation on behalf of a dead one.
pub fn decide(known: Option<Option<&str>>, is_current: impl FnOnce(&str) -> bool) -> bool {
    match known {
        None => true,
        Some(None) => false,
        Some(Some(id)) => is_current(id),
    }
}

#[cfg(test)]
#[path = "nav_ring.test.rs"]
mod tests;
