//! Native WebKit navigation identity correlated with registry tickets.

use objc2::DefinedClass;
use objc2_web_kit::WKNavigation;
use tauri::Manager;

use super::NavDelegate;
use crate::browser::surface::BrowserSurface;

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

    pub(crate) fn navigation_id_for(&self, navigation: Option<&WKNavigation>) -> Option<String> {
        let key = navigation.map(|nav| nav as *const WKNavigation as usize);
        if let Some(key) = key {
            return self
                .ivars()
                .native_navigation
                .borrow()
                .iter()
                .find_map(|(known, id)| (*known == key).then(|| id.clone()));
        }
        Some(self.current_navigation_id())
    }

    pub(crate) fn mark_navigation_started(&self, navigation: Option<&WKNavigation>) -> String {
        let id = self
            .ivars()
            .pending_navigation_id
            .borrow_mut()
            .take()
            .unwrap_or_else(|| self.current_navigation_id());
        if let Some(navigation) = navigation {
            let key = navigation as *const WKNavigation as usize;
            let mut known = self.ivars().native_navigation.borrow_mut();
            known.retain(|(existing, _)| *existing != key);
            known.push((key, id.clone()));
            if known.len() > 8 {
                known.remove(0);
            }
        }
        id
    }

    pub(crate) fn remember_pending_navigation(&self, navigation_id: String) {
        self.ivars()
            .pending_navigation_id
            .replace(Some(navigation_id));
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
