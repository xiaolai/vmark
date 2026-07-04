//! Insert-menu child submenus: Links, Table, Info Boxes.
//!
//! Purpose: Builds the child submenus of the Insert menu for
//! `create_localized_menu`. Split out of `insert_menu.rs` so each builder
//! stays a focused function and the files stay under the size gate.

use rust_i18n::t;
use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

use super::AccelFn;

/// Build the Links submenu.
pub(super) fn links(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "links-submenu",
        &t!("menu.insert.links"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "link",
                &t!("menu.insert.links.link"),
                true,
                accel("link", "CmdOrCtrl+K"),
            )?,
            &MenuItem::with_id(
                app,
                "wiki-link",
                &t!("menu.insert.links.wikiLink"),
                true,
                accel("wiki-link", "Alt+CmdOrCtrl+K"),
            )?,
            &MenuItem::with_id(
                app,
                "bookmark",
                &t!("menu.insert.links.bookmark"),
                true,
                accel("bookmark", "Alt+CmdOrCtrl+B"),
            )?,
        ],
    )
}

/// Build the Table submenu.
pub(super) fn table(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "table-submenu",
        &t!("menu.insert.table"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "insert-table",
                &t!("menu.insert.table.insert"),
                true,
                accel("insert-table", "CmdOrCtrl+Shift+T"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "add-row-before",
                &t!("menu.insert.table.addRowAbove"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "add-row-after",
                &t!("menu.insert.table.addRowBelow"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "add-col-before",
                &t!("menu.insert.table.addColBefore"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "add-col-after",
                &t!("menu.insert.table.addColAfter"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "delete-row",
                &t!("menu.insert.table.deleteRow"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "delete-col",
                &t!("menu.insert.table.deleteCol"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "delete-table",
                &t!("menu.insert.table.deleteTable"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "align-left",
                &t!("menu.insert.table.alignLeft"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "align-center",
                &t!("menu.insert.table.alignCenter"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "align-right",
                &t!("menu.insert.table.alignRight"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "align-all-left",
                &t!("menu.insert.table.alignAllLeft"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "align-all-center",
                &t!("menu.insert.table.alignAllCenter"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "align-all-right",
                &t!("menu.insert.table.alignAllRight"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "format-table",
                &t!("menu.insert.table.format"),
                true,
                accel("format-table", "Alt+CmdOrCtrl+T"),
            )?,
        ],
    )
}

/// Build the Info Boxes submenu.
pub(super) fn info_boxes(
    app: &tauri::AppHandle,
    accel: &AccelFn,
) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "info-box-submenu",
        &t!("menu.insert.infoBox"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "info-note",
                &t!("menu.insert.infoBox.note"),
                true,
                accel("info-note", "Alt+CmdOrCtrl+N"),
            )?,
            &MenuItem::with_id(
                app,
                "info-tip",
                &t!("menu.insert.infoBox.tip"),
                true,
                accel("info-tip", "CmdOrCtrl+Alt+Shift+T"),
            )?,
            &MenuItem::with_id(
                app,
                "info-important",
                &t!("menu.insert.infoBox.important"),
                true,
                accel("info-important", "CmdOrCtrl+Alt+Shift+I"),
            )?,
            &MenuItem::with_id(
                app,
                "info-warning",
                &t!("menu.insert.infoBox.warning"),
                true,
                accel("info-warning", "CmdOrCtrl+Shift+W"),
            )?,
            &MenuItem::with_id(
                app,
                "info-caution",
                &t!("menu.insert.infoBox.caution"),
                true,
                accel("info-caution", "CmdOrCtrl+Shift+U"),
            )?,
        ],
    )
}
