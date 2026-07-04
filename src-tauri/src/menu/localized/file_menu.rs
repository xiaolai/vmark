//! File menu: New/Open/Save/Export plus platform-specific items.
//!
//! Purpose: Builds the File menu section for `create_localized_menu`.
//! Child submenus come from `file_submenus` (recent files/workspaces,
//! document history) and `export_menu` (Export). The common item run is
//! built once; platform differences are appended as a cfg-gated tail:
//! non-macOS carries Settings and Exit here because there is no App menu,
//! and omits Print (macOS-only `pdf_export` backend).

use rust_i18n::t;
use tauri::menu::{IsMenuItem, MenuItem, PredefinedMenuItem, Submenu};

use super::AccelFn;

/// Build the File menu.
pub(super) fn build(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    let recent_submenu = super::file_submenus::recent_files(app)?;
    let recent_workspaces_submenu = super::file_submenus::recent_workspaces(app)?;
    let history_submenu = super::file_submenus::doc_history(app)?;
    let export_submenu = super::export_menu::build(app, accel)?;

    // Items shared by every platform, in menu order.
    let mut items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = vec![
        Box::new(MenuItem::with_id(
            app,
            "new",
            &t!("menu.file.new"),
            true,
            accel("new", "CmdOrCtrl+N"),
        )?),
        Box::new(MenuItem::with_id(
            app,
            "new-window",
            &t!("menu.file.newWindow"),
            true,
            accel("new-window", "CmdOrCtrl+Shift+N"),
        )?),
        Box::new(PredefinedMenuItem::separator(app)?),
        Box::new(MenuItem::with_id(
            app,
            "quick-open",
            &t!("menu.file.quickOpen"),
            true,
            accel("quick-open", "CmdOrCtrl+O"),
        )?),
        Box::new(MenuItem::with_id(
            app,
            "open",
            &t!("menu.file.openFile"),
            true,
            accel("open", ""),
        )?),
        Box::new(MenuItem::with_id(
            app,
            "open-folder",
            &t!("menu.file.openWorkspace"),
            true,
            accel("open-folder", "CmdOrCtrl+Shift+O"),
        )?),
        Box::new(recent_submenu),
        Box::new(recent_workspaces_submenu),
        Box::new(PredefinedMenuItem::separator(app)?),
        Box::new(MenuItem::with_id(
            app,
            "close",
            &t!("menu.file.close"),
            true,
            accel("close", "CmdOrCtrl+W"),
        )?),
        Box::new(MenuItem::with_id(
            app,
            "close-workspace",
            &t!("menu.file.closeWorkspace"),
            true,
            None::<&str>,
        )?),
        Box::new(PredefinedMenuItem::separator(app)?),
        Box::new(MenuItem::with_id(
            app,
            "save",
            &t!("menu.file.save"),
            true,
            accel("save", "CmdOrCtrl+S"),
        )?),
        Box::new(MenuItem::with_id(
            app,
            "save-as",
            &t!("menu.file.saveAs"),
            true,
            accel("save-as", "CmdOrCtrl+Shift+S"),
        )?),
        Box::new(MenuItem::with_id(
            app,
            "move-to",
            &t!("menu.file.moveTo"),
            true,
            accel("move-to", ""),
        )?),
        Box::new(PredefinedMenuItem::separator(app)?),
        Box::new(export_submenu),
    ];

    // macOS tail: Print (native PDF export backend is macOS-only), then
    // Document History.
    #[cfg(target_os = "macos")]
    {
        items.push(Box::new(MenuItem::with_id(
            app,
            "export-pdf",
            &t!("menu.file.print"),
            true,
            accel("export-pdf", "CmdOrCtrl+P"),
        )?));
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        items.push(Box::new(history_submenu));
    }

    // Non-macOS tail. `export-pdf` (Print) is omitted on Windows/Linux: the
    // underlying Rust command (pdf_export::commands::print_document) is gated
    // to macOS because it uses NSPrintOperation against a WKWebView, and
    // neither the command nor a cross-platform equivalent exists on other
    // targets. Cross-platform alternative: Export → HTML, then print to PDF
    // from the system browser. Issue #929. Settings and Exit live here
    // because there is no App menu.
    #[cfg(not(target_os = "macos"))]
    {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        items.push(Box::new(history_submenu));
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        items.push(Box::new(MenuItem::with_id(
            app,
            "preferences",
            &t!("menu.app.settings"),
            true,
            accel("preferences", "CmdOrCtrl+,"),
        )?));
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        items.push(Box::new(MenuItem::with_id(
            app,
            "save-all-quit",
            &t!("menu.file.saveAllExit"),
            true,
            accel("save-all-quit", "Alt+CmdOrCtrl+Shift+Q"),
        )?));
        items.push(Box::new(MenuItem::with_id(
            app,
            "quit",
            &t!("menu.file.exit"),
            true,
            accel("quit", "CmdOrCtrl+Q"),
        )?));
    }

    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|i| &**i).collect();
    Submenu::with_id_and_items(app, "file-menu", &t!("menu.file"), true, &refs)
}
