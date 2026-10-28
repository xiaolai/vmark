---
name: rust-tauri-backend
description: Implement or modify VMark's Rust/Tauri v2 backend and its frontend bridge - Tauri commands, invoke/emit/listen IPC, menu items and accelerators, Tauri plugins and capabilities, windows, filesystem and platform behaviour in src-tauri. Use for any change under src-tauri/ or to a webview-to-Rust bridge.
---

# Rust + Tauri Backend (VMark)

VMark-specific conventions only; general Tauri v2 API questions go to the
official docs (v2.tauri.app), not memory. The binding rules are in `AGENTS.md`
and `.claude/rules/50-codebase-conventions.md` §10; this skill is the
checklist that applies them.

## Bridge direction

| Direction | Mechanism | Frontend side |
|---|---|---|
| Webview → Rust | `invoke("name", args)` → `#[tauri::command] fn name` | `src/services/` (never from `src/utils/`, which is leaf-pure) |
| Rust → webview | `app.emit()` / `window.emit()` | `listen()` in a hook or service, with cleanup on unmount |
| Menu → webview | `menu/events.rs` emits `menu:{id}` generically | a `menu:{id}` listener |

## Adding a command

1. Put it in `src-tauri/src/<feature>/commands.rs`; register it in the
   `all_commands!` list in `src-tauri/src/command_registry.rs`.
   `pnpm lint:ipc-contract` fails on any `invoke("x")` without a registered `x`.
2. Return `Result<T, CommandError>` (`command_error.rs`); user-facing messages
   use `localized_error!` with a key in all ten `src-tauri/locales/*.yml`
   (`pnpm lint:command-errors`). The frontend renders with
   `commandErrorMessage`, never `String(e)`.
3. A command that creates a window MUST be `async` (`pnpm lint:window-thread`;
   WebView2 deadlocks otherwise). Going async removes the serialization the
   blocking IPC loop gave you — re-check for check-then-act races.
4. State lives in `.manage()` and is reached through `State<'_, T>`; no mutable
   `static` where an `AppHandle` can reach.
5. Never a bare `Command::new("tool")`: use `ai_provider::build_command()` and
   `ai_provider::login_shell_path()`.
6. Use inline format args: `format!("{variable}")`.

## Menus and shortcuts

- `menu/localized.rs` `create_localized_menu` is the single builder; labels go
  in `src-tauri/locales/en.yml` (then all locales).
- Every menu item needs a real SF Symbol in `MENU_ICONS`
  (`src-tauri/src/macos_menu_icons.rs`).
- Shortcut changes follow the three-file sync in
  `.claude/rules/41-keyboard-shortcuts.md`.

## Plugins and capabilities

Add the crate to `src-tauri/Cargo.toml`, register `.plugin()` in
`src-tauri/src/app_plugins.rs`, and grant the narrowest permission in
`src-tauri/capabilities/*.json` (`default.json` unless a window-scoped file
fits). `cargo machete` (`lint:rust-deps`) runs in CI.

## Platform code

macOS is primary; isolate platform code with `cfg`. Tests using
`tauri::test` must be gated `#[cfg(not(target_os = "windows"))]`.

## Verify

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
bash scripts/check-cross-target.sh   # when adding a tauri::test mock-runtime test
pnpm lint:ipc-contract && pnpm lint:command-errors && pnpm lint:window-thread
```

Find existing bridges with `rg -n 'invoke\(|emit\(|listen\(' src src-tauri/src`
and commands with `rg -n '#\[tauri::command\]' src-tauri/src`.
