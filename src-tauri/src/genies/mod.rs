//! AI Genies — file reader and default genie installer
//!
//! Scans the global genies directory (`<appDataDir>/genies/`) for markdown
//! genie files.

pub mod commands;
mod install;
mod parsing;
mod scanning;
mod types;

// Re-export public API used by other modules (lib.rs, menu/dynamic.rs)
pub use commands::global_genies_dir;
pub use install::install_default_genies;
pub use scanning::scan_genies_with_titles;
pub use types::GenieMenuEntry;

#[cfg(test)]
mod tests;
