//! Native WebKit navigation identity correlated with registry tickets.
//!
//! The rule lives in `nav_ring.rs` (pure, every target, table-tested); this file
//! is the WebKit-facing shell: it turns a `WKNavigation` into its pointer key,
//! keeps the delegate's ring, and asks the registry which ticket is live.

use objc2::DefinedClass;
use objc2_web_kit::WKNavigation;
use tauri::Manager;

use super::NavDelegate;
use crate::browser::nav_ring;
use crate::browser::surface::BrowserSurface;

/// A `WKNavigation`'s identity: its address. WebKit keeps the object alive for
/// the life of the load, so a late callback carries the same key.
fn key_of(navigation: &WKNavigation) -> usize {
    navigation as *const WKNavigation as usize
}

impl NavDelegate {
    pub(crate) fn current_navigation_id(&self) -> String {
        let ivars = self.ivars();
        ivars
            .app
            .try_state::<BrowserSurface>()
            .and_then(|state| {
                state
                    .registry
                    .lock()
                    .ok()
                    .and_then(|reg| reg.navigation_ticket(&ivars.tab_id).map(|t| t.id.clone()))
            })
            .unwrap_or_else(|| format!("legacy-{}", ivars.tab_id))
    }

    /// The ticket the ring remembers `navigation` under — `None` for a navigation
    /// we never mapped, or the live ticket when the callback carried no object.
    pub(crate) fn navigation_id_for(&self, navigation: Option<&WKNavigation>) -> Option<String> {
        match navigation {
            Some(navigation) => self.mapped_navigation_id(navigation),
            None => Some(self.current_navigation_id()),
        }
    }

    fn mapped_navigation_id(&self, navigation: &WKNavigation) -> Option<String> {
        nav_ring::lookup(&self.ivars().native_navigation.borrow(), key_of(navigation))
            .map(str::to_owned)
    }

    /// A provisional start was reported: count it (`api_navigation` compares the
    /// count across a call, `nav_api_navigation.rs`) and pair the native navigation
    /// with its ticket.
    pub(crate) fn mark_navigation_started(&self, navigation: Option<&WKNavigation>) -> String {
        let starts = &self.ivars().starts;
        starts.set(starts.get().wrapping_add(1));
        let id = self
            .ivars()
            .pending_navigation_id
            .borrow_mut()
            .take()
            .unwrap_or_else(|| self.current_navigation_id());
        if let Some(navigation) = navigation {
            nav_ring::push(
                &mut self.ivars().native_navigation.borrow_mut(),
                key_of(navigation),
                id.clone(),
            );
        }
        id
    }

    pub(crate) fn remember_pending_navigation(&self, navigation_id: String) {
        self.ivars()
            .pending_navigation_id
            .replace(Some(navigation_id));
    }

    /// Does a delegate callback carrying `navigation` belong to the CURRENT
    /// navigation? The rule is `nav_ring::decide` (audit round 2 #19, round 4 —
    /// see its doc); this supplies the ring and the registry's word on the live
    /// ticket. Used by the redirect and commit callbacks so neither can mark or
    /// un-load the live navigation.
    pub(crate) fn callback_is_current(&self, navigation: Option<&WKNavigation>) -> bool {
        let known = navigation.map(|navigation| self.mapped_navigation_id(navigation));
        nav_ring::decide(known.as_ref().map(Option::as_deref), |id| {
            self.is_current_navigation(id)
        })
    }

    pub(crate) fn is_current_navigation(&self, navigation_id: &str) -> bool {
        self.ivars()
            .app
            .try_state::<BrowserSurface>()
            .and_then(|state| {
                state.registry.lock().ok().map(|reg| {
                    reg.navigation_ticket(&self.ivars().tab_id)
                        .map(|ticket| ticket.id == navigation_id)
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    }
}
