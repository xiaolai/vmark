//! File-menu child submenus: Open Recent, Open Recent Workspace, Document History.
//!
//! Purpose: Builds the static child submenus of the File menu for
//! `create_localized_menu`. Extracted verbatim from `localized.rs` to keep
//! that file under the size gate. The recent-files/workspaces submenus are
//! placeholders repopulated at runtime by `menu::dynamic`.

use rust_i18n::t;
use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

use crate::menu::{RECENT_FILES_SUBMENU_ID, RECENT_WORKSPACES_SUBMENU_ID};

/// Build the Open Recent (files) submenu placeholder.
pub(super) fn recent_files(app: &tauri::AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        RECENT_FILES_SUBMENU_ID,
        &t!("menu.file.openRecent"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "no-recent",
                &t!("menu.recentFiles.empty"),
                false,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "clear-recent",
                &t!("menu.recentFiles.clear"),
                true,
                None::<&str>,
            )?,
        ],
    )
}

/// Build the Open Recent Workspace submenu placeholder.
pub(super) fn recent_workspaces(app: &tauri::AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        RECENT_WORKSPACES_SUBMENU_ID,
        &t!("menu.file.openRecentWorkspace"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "no-recent-workspace",
                &t!("menu.recentWorkspaces.empty"),
                false,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "clear-recent-workspaces",
                &t!("menu.recentWorkspaces.clear"),
                true,
                None::<&str>,
            )?,
        ],
    )
}

/// Build the Document History submenu.
pub(super) fn doc_history(app: &tauri::AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "doc-history-submenu",
        &t!("menu.file.docHistory"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "clear-workspace-history",
                &t!("menu.file.docHistory.clearWorkspace"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "clear-history",
                &t!("menu.file.docHistory.clearAll"),
                true,
                None::<&str>,
            )?,
        ],
    )
}
