//! macOS-specific menu fixes.
//!
//! Workaround for muda's broken `set_as_help_menu_for_nsapp()`.
//! See: https://github.com/tauri-apps/muda/pull/322

use objc2::MainThreadMarker;
use objc2_app_kit::NSApplication;
use objc2_foundation::NSString;

/// Fix the Help menu on macOS.
///
/// This finds the "Help" submenu in the app's main menu and properly registers it
/// with NSApplication so macOS shows the native search field.
///
/// Must be called after `app.set_menu()`.
pub fn fix_help_menu() {
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("[macos_menu] Not on main thread, cannot fix Help menu");
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        eprintln!("[macos_menu] No main menu found");
        return;
    };

    // Find the Help menu by title
    let help_title = NSString::from_str("Help");
    let Some(help_item) = main_menu.itemWithTitle(&help_title) else {
        eprintln!("[macos_menu] No 'Help' menu item found");
        return;
    };

    let Some(help_submenu) = help_item.submenu() else {
        eprintln!("[macos_menu] Help item has no submenu");
        return;
    };

    // Register as the Help menu — this enables the native search field
    app.setHelpMenu(Some(&help_submenu));

    #[cfg(debug_assertions)]
    eprintln!("[macos_menu] Help menu registered with search field");
}

/// Fix the Window menu on macOS.
///
/// This finds the "Window" submenu and registers it with NSApplication
/// so macOS adds native window management items.
pub fn fix_window_menu() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        return;
    };

    let window_title = NSString::from_str("Window");
    let Some(window_item) = main_menu.itemWithTitle(&window_title) else {
        // Window menu is optional
        return;
    };

    let Some(window_submenu) = window_item.submenu() else {
        return;
    };

    app.setWindowsMenu(Some(&window_submenu));

    #[cfg(debug_assertions)]
    eprintln!("[macos_menu] Window menu registered");
}

/// Apply all macOS menu fixes.
pub fn apply_menu_fixes() {
    fix_help_menu();
    fix_window_menu();
}
