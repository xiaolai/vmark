//! # VMark Main
//!
//! Purpose: Binary entry point — delegates immediately to `lib.rs::run()`.
//! The `windows_subsystem` attribute hides the console window on Windows release builds.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vmark_lib::run()
}
