//! Insert menu: links, media, table, code/math/diagram blocks, info boxes.
//!
//! Purpose: Builds the Insert menu section for `create_localized_menu`.
//! Child submenus (Links, Table, Info Boxes) come from `insert_submenus`.

use rust_i18n::t;
use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

use super::AccelFn;

/// Build the Insert menu.
pub(super) fn build(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    let links_submenu = super::insert_submenus::links(app, accel)?;
    let table_submenu = super::insert_submenus::table(app, accel)?;
    let info_boxes_submenu = super::insert_submenus::info_boxes(app, accel)?;

    Submenu::with_id_and_items(
        app,
        "insert-menu",
        &t!("menu.insert"),
        true,
        &[
            &links_submenu,
            &MenuItem::with_id(
                app,
                "image",
                &t!("menu.insert.image"),
                true,
                accel("image", "Shift+CmdOrCtrl+I"),
            )?,
            &MenuItem::with_id(
                app,
                "video",
                &t!("menu.insert.video"),
                true,
                accel("video", ""),
            )?,
            &MenuItem::with_id(
                app,
                "audio",
                &t!("menu.insert.audio"),
                true,
                accel("audio", ""),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &table_submenu,
            &MenuItem::with_id(
                app,
                "code-fences",
                &t!("menu.insert.codeBlock"),
                true,
                accel("code-fences", "Alt+CmdOrCtrl+C"),
            )?,
            &MenuItem::with_id(
                app,
                "math-block",
                &t!("menu.insert.mathBlock"),
                true,
                accel("math-block", "Alt+CmdOrCtrl+Shift+M"),
            )?,
            &MenuItem::with_id(
                app,
                "diagram",
                &t!("menu.insert.diagram"),
                true,
                accel("diagram", "Alt+CmdOrCtrl+Shift+D"),
            )?,
            &MenuItem::with_id(
                app,
                "mindmap",
                &t!("menu.insert.mindmap"),
                true,
                accel("mindmap", "Alt+CmdOrCtrl+Shift+K"),
            )?,
            &MenuItem::with_id(
                app,
                "horizontal-line",
                &t!("menu.insert.horizontalLine"),
                true,
                accel("horizontal-line", "Alt+CmdOrCtrl+-"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "footnote",
                &t!("menu.insert.footnote"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "collapsible-block",
                &t!("menu.insert.collapsible"),
                true,
                accel("collapsible-block", "Alt+CmdOrCtrl+D"),
            )?,
            &info_boxes_submenu,
        ],
    )
}
