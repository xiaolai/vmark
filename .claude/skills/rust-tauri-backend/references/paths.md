# Rust/Tauri Backend Paths

## Core
- `src-tauri/src/`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/menu/` (mod.rs, localized.rs, commands.rs, dynamic.rs)
- `src-tauri/src/menu_events.rs`
- `src-tauri/src/macos_menu.rs`

## Useful scans
- `rg -n "tauri::command|invoke_handler|menu" src-tauri/src`
