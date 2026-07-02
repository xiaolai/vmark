//! Pandoc Export
//!
//! Optional integration with Pandoc for exporting markdown to DOCX, EPUB,
//! LaTeX, ODT, RTF, and plain text. Pandoc is not bundled — it must be
//! installed separately by the user.
//!
//! @coordinates-with ai_provider/detection.rs — reuses login_shell_path()
//! @coordinates-with ai_provider/spawn.rs — reuses build_command()

pub mod commands;
