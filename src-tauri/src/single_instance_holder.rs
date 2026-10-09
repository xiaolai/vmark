//! Windows: refuse a second launch when the VMark holding the single-instance
//! lock cannot be reached (#1527).
//!
//! Purpose: close the gap the single-instance plugin leaves open. Its Windows
//! backend creates the named mutex `{id}-sim`; when the mutex already exists it
//! looks for the holder's hidden message window (`{id}-sic` / `{id}-siw`) and
//! forwards argv to it. When that window is MISSING it does nothing at all: the
//! second process carries on as a full second VMark. That is the state #1527
//! captured. A process with no top-level windows still held the lock and the
//! WebView2 profile, and every later launch became another VMark whose webview
//! failed with `0x800700AA` (the profile is in use) and left a dead window.
//! `single_instance.rs` explains why a second VMark is destructive even when its
//! webview does start.
//!
//! Key decisions:
//!   - Runs as a plugin registered just BEFORE the single-instance plugin, so it
//!     decides before the plugin can fall through and before any window exists.
//!   - A missing window is not proof on the first look: the holder creates the
//!     mutex a moment before the window, so the probe polls for about two
//!     seconds and gives up only when the lock stays held with no window.
//!   - Fails OPEN. If the plugin ever renames its objects the probe sees no
//!     lock and the launch proceeds exactly as it did before this module.
//!     Refusing a healthy launch would be worse than the bug.
//!   - Unreachable means a native message box, then exit. There is no logger
//!     yet, and no webview to show anything in. The box names the way out (end
//!     the stuck process) instead of killing a process that may hold unsaved
//!     work. The text follows the OS language, because the user's VMark
//!     language arrives later, from the frontend.
//!
//! @coordinates-with single_instance.rs — the second-launch forwarding this guards
//! @coordinates-with app_plugins.rs — registers this plugin ahead of the single-instance plugin

// Compiled on every target so the decision logic is tested on macOS, where
// `cargo test` runs. Only the Win32 probe and the plugin are Windows-only.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

/// What one look at the lock found.
pub(crate) struct Probe {
    pub lock_held: bool,
    pub window_found: bool,
}

/// Who holds the single-instance lock, from this launch's point of view.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Holder {
    /// Nobody: this launch becomes the running VMark.
    None,
    /// A VMark whose message window exists: the plugin forwards to it.
    Reachable,
    /// A VMark that holds the lock but has no message window to forward to.
    Unreachable,
}

/// Look up to `attempts` times (at least once), calling `wait` between looks.
pub(crate) fn classify(
    mut probe: impl FnMut() -> Probe,
    attempts: u32,
    mut wait: impl FnMut(),
) -> Holder {
    let attempts = attempts.max(1);
    for attempt in 1..=attempts {
        let seen = probe();
        if !seen.lock_held {
            return Holder::None;
        }
        if seen.window_found {
            return Holder::Reachable;
        }
        if attempt < attempts {
            wait();
        }
    }
    Holder::Unreachable
}

/// The plugin's kernel object names (tauri-plugin-single-instance 2.5, built
/// without its `semver` feature, which would append the version to `id`).
pub(crate) struct ObjectNames {
    pub mutex: String,
    pub class: String,
    pub window: String,
}

impl ObjectNames {
    pub(crate) fn for_identifier(id: &str) -> Self {
        Self {
            mutex: format!("{id}-sim"),
            class: format!("{id}-sic"),
            window: format!("{id}-siw"),
        }
    }
}

/// The shipped locale bundle closest to an OS locale name such as `zh-HK`.
/// Chinese splits by script (Traditional for TW, HK, MO and `Hant`); every
/// other language matches by its primary subtag; anything else is English.
pub(crate) fn bundle_for_os_locale<'a>(os: &str, shipped: &[&'a str]) -> &'a str {
    let tag = os.replace('_', "-").to_ascii_lowercase();
    let find = |want: &str| {
        shipped
            .iter()
            .copied()
            .find(|b| b.eq_ignore_ascii_case(want))
    };
    if let Some(exact) = find(&tag) {
        return exact;
    }
    let primary = tag.split('-').next().unwrap_or_default();
    if primary == "zh" {
        let traditional = tag
            .split('-')
            .any(|p| matches!(p, "hant" | "tw" | "hk" | "mo"));
        if let Some(bundle) = find(if traditional { "zh-TW" } else { "zh-CN" }) {
            return bundle;
        }
    }
    shipped
        .iter()
        .copied()
        .find(|b| {
            b.split('-')
                .next()
                .unwrap_or_default()
                .eq_ignore_ascii_case(primary)
        })
        .or_else(|| find("en"))
        .unwrap_or("en")
}

#[cfg(target_os = "windows")]
mod win {
    use super::{classify, Holder, ObjectNames, Probe};
    use std::time::Duration;
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{CloseHandle, ERROR_FILE_NOT_FOUND};
    use windows::Win32::Globalization::GetUserDefaultLocaleName;
    use windows::Win32::System::Threading::{OpenMutexW, SYNCHRONIZATION_SYNCHRONIZE};
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, MessageBoxW, MB_ICONWARNING, MB_OK, MB_SETFOREGROUND,
    };

    const ATTEMPTS: u32 = 20;
    const INTERVAL: Duration = Duration::from_millis(100);

    /// Any answer but "no such mutex" counts as held: access denied means it
    /// exists under another integrity level, and refusing then is still right.
    fn lock_held(name: &HSTRING) -> bool {
        // SAFETY: `name` is a NUL-terminated wide string that outlives the call.
        match unsafe { OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, false, name) } {
            Ok(handle) => {
                // SAFETY: `handle` was just returned by `OpenMutexW` and is closed once.
                let _ = unsafe { CloseHandle(handle) };
                true
            }
            Err(error) => error.code() != ERROR_FILE_NOT_FOUND.to_hresult(),
        }
    }

    pub(super) fn holder(id: &str) -> Holder {
        let names = ObjectNames::for_identifier(id);
        let (mutex, class, window) = (
            HSTRING::from(names.mutex),
            HSTRING::from(names.class),
            HSTRING::from(names.window),
        );
        classify(
            || Probe {
                lock_held: lock_held(&mutex),
                // SAFETY: both names are NUL-terminated wide strings held above.
                window_found: unsafe { FindWindowW(&class, &window) }.is_ok(),
            },
            ATTEMPTS,
            || std::thread::sleep(INTERVAL),
        )
    }

    fn os_locale() -> String {
        let mut buf = [0u16; 85]; // LOCALE_NAME_MAX_LENGTH
                                  // SAFETY: the API writes at most `buf.len()` units into `buf`.
        let len = unsafe { GetUserDefaultLocaleName(&mut buf) };
        let len = usize::try_from(len).unwrap_or(0).saturating_sub(1);
        String::from_utf16_lossy(&buf[..len.min(buf.len())])
    }

    pub(super) fn explain_and_refuse() {
        let shipped = rust_i18n::available_locales!();
        let shipped: Vec<&str> = shipped.iter().map(|l| l.as_ref()).collect();
        let locale = super::bundle_for_os_locale(&os_locale(), &shipped);
        let title = rust_i18n::t!("singleInstance.unreachable.title", locale = locale);
        let body = rust_i18n::t!("singleInstance.unreachable.body", locale = locale);
        // SAFETY: no owner window; both strings live until the box is dismissed.
        unsafe {
            MessageBoxW(
                None,
                &HSTRING::from(body.as_ref()),
                &HSTRING::from(title.as_ref()),
                MB_OK | MB_ICONWARNING | MB_SETFOREGROUND,
            );
        }
    }
}

/// The guard plugin. Register it immediately before the single-instance plugin.
#[cfg(target_os = "windows")]
pub(crate) fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("single-instance-holder")
        .setup(|app, _api| {
            if win::holder(&app.config().identifier) == Holder::Unreachable {
                win::explain_and_refuse();
                app.cleanup_before_exit();
                std::process::exit(1);
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
#[path = "single_instance_holder.test.rs"]
mod tests;
