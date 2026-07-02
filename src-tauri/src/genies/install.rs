//! Default genies installer.
//!
//! Bundles default genie templates (via `include_str!`) and installs
//! them into the app data directory on first run.

use super::commands::global_genies_dir;
use std::fs::{self, OpenOptions};
use std::io::Write as IoWrite;
use tauri::AppHandle;

struct DefaultGenie {
    path: &'static str,
    content: &'static str,
}

const DEFAULT_GENIES: &[DefaultGenie] = &[
    // Editing
    DefaultGenie {
        path: "editing/polish.md",
        content: include_str!("../../resources/genies/editing/polish.md"),
    },
    DefaultGenie {
        path: "editing/condense.md",
        content: include_str!("../../resources/genies/editing/condense.md"),
    },
    DefaultGenie {
        path: "editing/fix-grammar.md",
        content: include_str!("../../resources/genies/editing/fix-grammar.md"),
    },
    DefaultGenie {
        path: "editing/simplify.md",
        content: include_str!("../../resources/genies/editing/simplify.md"),
    },
    // Creative
    DefaultGenie {
        path: "creative/expand.md",
        content: include_str!("../../resources/genies/creative/expand.md"),
    },
    DefaultGenie {
        path: "creative/rephrase.md",
        content: include_str!("../../resources/genies/creative/rephrase.md"),
    },
    DefaultGenie {
        path: "creative/vivid.md",
        content: include_str!("../../resources/genies/creative/vivid.md"),
    },
    DefaultGenie {
        path: "creative/continue.md",
        content: include_str!("../../resources/genies/creative/continue.md"),
    },
    // Structure
    DefaultGenie {
        path: "structure/summarize.md",
        content: include_str!("../../resources/genies/structure/summarize.md"),
    },
    DefaultGenie {
        path: "structure/outline.md",
        content: include_str!("../../resources/genies/structure/outline.md"),
    },
    DefaultGenie {
        path: "structure/headline.md",
        content: include_str!("../../resources/genies/structure/headline.md"),
    },
    // Tools
    DefaultGenie {
        path: "tools/translate.md",
        content: include_str!("../../resources/genies/tools/translate.md"),
    },
    DefaultGenie {
        path: "tools/rewrite-in-english.md",
        content: include_str!("../../resources/genies/tools/rewrite-in-english.md"),
    },
];

/// Genie names (file stems) for every bundled default genie.
///
/// The name is the file stem of each `DEFAULT_GENIES` path — i.e. the token a
/// `uses: genie/<name>` workflow step references. This is the single source of
/// truth for "which genies ship with the app", used to validate that bundled
/// sample workflows only reference genies that actually exist.
#[cfg(test)]
pub fn default_genie_names() -> Vec<&'static str> {
    DEFAULT_GENIES
        .iter()
        .filter_map(|g| {
            std::path::Path::new(g.path)
                .file_stem()
                .and_then(|s| s.to_str())
        })
        .collect()
}

/// Install default genies into `<appDataDir>/genies/` if they don't already exist.
pub fn install_default_genies(app: &AppHandle) -> Result<(), String> {
    let base = global_genies_dir(app)?;

    for genie in DEFAULT_GENIES {
        let target = base.join(genie.path);

        // Create parent directories
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create dir {:?}: {}", parent, e))?;
        }

        // Atomic create — skip if file already exists (no TOCTOU race)
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(mut file) => {
                file.write_all(genie.content.as_bytes())
                    .map_err(|e| format!("Failed to write {:?}: {}", target, e))?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                continue;
            }
            Err(e) => {
                return Err(format!("Failed to create {:?}: {}", target, e));
            }
        }
    }

    Ok(())
}
