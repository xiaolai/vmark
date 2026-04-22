# Tauri v2 Integration Paths

## Rust side
- `src-tauri/src/` (commands, menu, platform integration)
- `src-tauri/src/menu/` (mod.rs, localized.rs, commands.rs, dynamic.rs)
- `src-tauri/src/menu_events.rs`

## Frontend side
- `src/hooks/` (menu events, file ops, workspace)
- `src/plugins/` (editor plugins, keymaps)
- `src/utils/` (IPC helpers, shared utilities)

## Useful scans
- `rg -n "invoke\(|emit\(|listen\(" src src-tauri`
