//! Native `WKHTTPCookieStore` capture/replay for storage-state (WI-P6.2, macOS).
//!
//! Included via `#[path]` from surface_macos.rs; `super::` is that module, so this
//! reaches its private `on_main`/`WEBVIEWS`/`pump_until`. The cookie APIs are async
//! (completion handlers), so the run loop is pumped until they fire, like
//! `eval_js`/`screenshot`. Values are SECRET — this module marshals them between the
//! keychain blob and WebKit; it never logs them.
//!
//! Security posture (mandatory cookie /security-review):
//!   - **Capture is domain-scoped** to the committed host — `getAllCookies` returns
//!     the WHOLE store, so we keep only cookies whose domain covers the origin the
//!     user asked to save (no over-collection of unrelated sites). [M1]
//!   - **Replay preserves** Secure / Expires / SameSite, and is **domain-scoped**
//!     to the committed host, so a saved cookie can never be planted under an
//!     unrelated origin. [H1 / L1]
//!   - **HttpOnly cookies are NOT restored.** `cookieWithProperties:` cannot create
//!     an HttpOnly cookie, so restoring one would drop the flag and expose the
//!     credential to `document.cookie` on an untrusted page. We skip them rather
//!     than downgrade them — HttpOnly logins are the named-context feature's job. [H1]
//!   - **Replay is confirmed + fail-closed**: each set carries a completion handler;
//!     we wait (bounded) for all to land and error on a partial/failed restore, and a
//!     malformed on-domain saved cookie is an error, not a silent skip. [M3]
//!   - **Freshness**: replay refuses if the tab navigated off the approved host
//!     before the write. [M2]

use crate::browser::session_state::StoredCookie;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_foundation::{
    NSArray, NSDate, NSDictionary, NSHTTPCookie, NSHTTPCookieDomain, NSHTTPCookieExpires,
    NSHTTPCookieName, NSHTTPCookiePath, NSHTTPCookiePropertyKey, NSHTTPCookieSameSitePolicy,
    NSHTTPCookieSecure, NSHTTPCookieValue, NSRunLoop, NSString,
};
use std::cell::{Cell, RefCell};
use std::ptr::NonNull;
use std::rc::Rc;
use std::time::Duration;
use tauri::AppHandle;

/// Does a cookie `domain` cover `host`, per `NSHTTPCookie` domain semantics?
///   - A **domain cookie** (leading dot, `.example.com`) covers the base host and
///     its subdomains (`example.com`, `www.example.com`).
///   - A **host-only cookie** (no leading dot, `example.com`) covers ONLY the exact
///     host — never a subdomain. Conflating the two would over-capture a parent's
///     host-only cookie while on a subdomain. (Sec review cookie M1.)
/// Never a suffix match across a label boundary (`evil-example.com` ≠ `example.com`).
/// Pure — unit-tested. NOTE: not public-suffix-aware; WebKit's own ingestion rejects
/// supercookie domains and the blob is keychain-stored (not attacker-editable), so
/// PSL rejection is a defence-in-depth follow-up, not a live hole. (Cookie L1.)
pub(crate) fn cookie_domain_matches(domain: &str, host: &str) -> bool {
    let host = host.trim().to_ascii_lowercase();
    let raw = domain.trim().to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    match raw.strip_prefix('.') {
        // Domain cookie: exact base OR a subdomain of it.
        Some(base) if !base.is_empty() => host == base || host.ends_with(&format!(".{base}")),
        // Host-only cookie: exact host only.
        Some(_) => false, // a bare "." is not a valid domain
        None if raw.is_empty() => false,
        None => host == raw,
    }
}

/// Snapshot the cookies whose domain covers `committed_host` (NOT the whole store).
/// Best-effort: a tab whose native view is gone yields `no webview`; a timeout yields
/// an error, so a failed capture never silently produces an empty cookie set.
pub fn capture_cookies(
    app: &AppHandle,
    tab_id: String,
    committed_host: String,
) -> Result<Vec<StoredCookie>, String> {
    super::on_main(app, move |_mtm| {
        let webview = super::WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
        let store = unsafe { webview.configuration().websiteDataStore().httpCookieStore() };

        let out: Rc<RefCell<Option<Vec<StoredCookie>>>> = Rc::new(RefCell::new(None));
        let sink = out.clone();
        let handler = RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
            let arr = unsafe { cookies.as_ref() };
            let mut v = Vec::new();
            for cookie in arr.iter() {
                let domain = cookie.domain().to_string();
                // Domain-scope the CAPTURE — never persist unrelated sites' cookies.
                if !cookie_domain_matches(&domain, &committed_host) {
                    continue;
                }
                v.push(StoredCookie {
                    name: cookie.name().to_string(),
                    value: cookie.value().to_string(),
                    domain,
                    path: cookie.path().to_string(),
                    secure: cookie.isSecure(),
                    http_only: cookie.isHTTPOnly(),
                    expires: cookie.expiresDate().map(|d| d.timeIntervalSince1970()),
                    // Only keep a recognised SameSite value; an unexpected string is
                    // dropped rather than stored (fail-safe). (Sec review cookie.)
                    same_site: cookie
                        .sameSitePolicy()
                        .map(|s| s.to_string())
                        .filter(|s| matches!(s.to_ascii_lowercase().as_str(), "strict" | "lax" | "none")),
                });
            }
            *sink.borrow_mut() = Some(v);
        });
        unsafe { store.getAllCookies(&handler) };

        let run_loop = NSRunLoop::mainRunLoop();
        super::pump_until(&run_loop, Duration::from_secs(3), 0.05, || out.borrow().is_some());
        let captured = out.borrow_mut().take();
        captured.ok_or_else(|| "cookie capture timed out".to_string())
    })
}

/// Rebuild a cookie, preserving Secure / Expires / SameSite. Returns `None` for a
/// malformed cookie (caller fails closed). HttpOnly cookies are handled by the
/// caller (skipped) — this cannot recreate the flag.
fn build_cookie(c: &StoredCookie) -> Option<Retained<NSHTTPCookie>> {
    let name = NSString::from_str(&c.name);
    let value = NSString::from_str(&c.value);
    let domain = NSString::from_str(&c.domain);
    let path = NSString::from_str(if c.path.is_empty() { "/" } else { &c.path });
    // Owned values kept alive for the whole function so the ref slices stay valid.
    let secure_val = c.secure.then(|| NSString::from_str("TRUE"));
    let expires_val = c.expires.map(NSDate::dateWithTimeIntervalSince1970);
    let samesite_val = c.same_site.as_ref().map(|s| NSString::from_str(s));

    let mut keys: Vec<&NSHTTPCookiePropertyKey> = unsafe {
        vec![
            NSHTTPCookieName,
            NSHTTPCookieValue,
            NSHTTPCookieDomain,
            NSHTTPCookiePath,
        ]
    };
    let mut vals: Vec<&AnyObject> =
        vec![name.as_ref(), value.as_ref(), domain.as_ref(), path.as_ref()];
    if let Some(v) = &secure_val {
        keys.push(unsafe { NSHTTPCookieSecure });
        vals.push(v.as_ref());
    }
    if let Some(v) = &expires_val {
        keys.push(unsafe { NSHTTPCookieExpires });
        vals.push(v.as_ref());
    }
    if let Some(v) = &samesite_val {
        keys.push(unsafe { NSHTTPCookieSameSitePolicy });
        vals.push(v.as_ref());
    }
    let props: Retained<NSDictionary<NSHTTPCookiePropertyKey, AnyObject>> =
        NSDictionary::from_slices(&keys, &vals);
    unsafe { NSHTTPCookie::cookieWithProperties(&props) }
}

/// Replay cookies into the tab's data store. Domain-scoped to `committed_host`,
/// HttpOnly cookies skipped, Secure/Expires/SameSite preserved, and confirmed:
/// each set is awaited and a partial/failed restore is an error.
pub fn apply_cookies(
    app: &AppHandle,
    tab_id: String,
    committed_host: String,
    committed_origin: String,
    cookies: Vec<StoredCookie>,
) -> Result<(), String> {
    super::on_main(app, move |_mtm| {
        let webview = super::WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
        // [M2] Freshness on the main thread, immediately before the write: refuse if
        // the tab has navigated off the approved ORIGIN (scheme+host+port, not just
        // host — an HTTPS→HTTP or port change must not slip through). A residual
        // async window remains (setCookie completes after this check while the run
        // loop pumps); it is bounded and the cookie stays domain-scoped regardless.
        let current_origin = unsafe { webview.URL() }
            .and_then(|u| u.absoluteString())
            .and_then(|s| url::Url::parse(&s.to_string()).ok())
            .map(|u| u.origin().ascii_serialization());
        if current_origin.as_deref() != Some(committed_origin.as_str()) {
            return Err(
                "stale command: the tab left the approved origin before the cookies could be restored"
                    .into(),
            );
        }
        let store = unsafe { webview.configuration().websiteDataStore().httpCookieStore() };

        // Build the set we will actually write: on-domain, non-HttpOnly. A malformed
        // on-domain cookie fails the whole restore closed (never a silent skip). [H1/M3]
        let mut to_set: Vec<Retained<NSHTTPCookie>> = Vec::new();
        for c in &cookies {
            if !cookie_domain_matches(&c.domain, &committed_host) {
                continue; // off-domain (capture already filters; belt and braces)
            }
            if c.http_only {
                continue; // cannot restore securely — skip rather than downgrade [H1]
            }
            let cookie = build_cookie(c)
                .ok_or_else(|| "a saved on-domain cookie is malformed; restore aborted".to_string())?;
            to_set.push(cookie);
        }
        let expected = to_set.len();
        if expected == 0 {
            return Ok(());
        }
        // [M3] Confirm each set via its completion handler; fail closed if not all land.
        let done = Rc::new(Cell::new(0usize));
        for cookie in &to_set {
            let d = done.clone();
            let handler = RcBlock::new(move || d.set(d.get() + 1));
            unsafe { store.setCookie_completionHandler(cookie, Some(&handler)) };
        }
        let run_loop = NSRunLoop::mainRunLoop();
        super::pump_until(&run_loop, Duration::from_secs(3), 0.05, || done.get() >= expected);
        if done.get() < expected {
            return Err("cookie restore timed out before all cookies were set".into());
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::cookie_domain_matches;

    #[test]
    fn a_domain_cookie_covers_the_base_and_its_subdomains() {
        assert!(cookie_domain_matches(".example.com", "example.com"));
        assert!(cookie_domain_matches(".example.com", "www.example.com"));
        assert!(cookie_domain_matches(".example.com", "a.b.example.com"));
    }

    #[test]
    fn a_host_only_cookie_covers_only_the_exact_host() {
        // [Sec review cookie M1] host-only (no leading dot) is EXACT-host only —
        // it must NOT be treated as covering subdomains.
        assert!(cookie_domain_matches("example.com", "example.com"));
        assert!(!cookie_domain_matches("example.com", "app.example.com"));
        assert!(!cookie_domain_matches("app.example.com", "example.com"));
    }

    #[test]
    fn a_cookie_never_leaks_across_a_label_boundary() {
        assert!(!cookie_domain_matches("example.com", "evil-example.com"));
        assert!(!cookie_domain_matches(".example.com", "evil-example.com"));
        assert!(!cookie_domain_matches("example.com", "notexample.com"));
        assert!(!cookie_domain_matches("example.com", "example.com.attacker.com"));
        assert!(!cookie_domain_matches("example.com", "attacker.com"));
        assert!(!cookie_domain_matches("", "example.com"));
        assert!(!cookie_domain_matches(".", "example.com"));
        assert!(!cookie_domain_matches("example.com", ""));
    }
}
