//! Slidev export argument construction (Phase 7, WI-7.2).
//!
//! `slidev export` is CLI-only (verified in spike S0.3 — no programmatic export
//! API) and depends on `playwright-chromium` (~150 MB, provisioned on first
//! export). This module builds the export command's argument vector — the pure,
//! testable core. The spawn itself routes through `ai_provider::build_command`
//! plus `login_shell_path` against the provisioned Slidev bundle's `slidev` bin,
//! and Chromium provisioning is gated before the spawn (both = Phase 7 residue,
//! external infra).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlidevExportFormat {
    Pdf,
    Png,
    Pptx,
}

impl SlidevExportFormat {
    pub fn as_flag(self) -> &'static str {
        match self {
            SlidevExportFormat::Pdf => "pdf",
            SlidevExportFormat::Png => "png",
            SlidevExportFormat::Pptx => "pptx",
        }
    }
}

// Rust-side export-arg model/builder — a unit-tested reference for the CLI
// shape. The live export runs through the Node content server, so these have
// no production caller yet (the format model `SlidevExportFormat` does).
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportRequest {
    pub deck_path: String,
    pub format: SlidevExportFormat,
    pub output_path: String,
    /// One page per click animation (`--with-clicks`).
    pub with_clicks: bool,
    /// Optional page range, e.g. "1,4-5".
    pub range: Option<String>,
    /// Override Chromium with a system browser (`--executable-path`).
    pub executable_path: Option<String>,
}

/// Build the `slidev export …` argument vector (excluding the `slidev` binary
/// itself). Verified shape against the S0.3 CLI surface.
#[allow(dead_code)] // reference builder; live export goes through the Node server.
pub fn build_export_args(req: &ExportRequest) -> Vec<String> {
    let mut args = vec![
        "export".to_string(),
        req.deck_path.clone(),
        "--format".to_string(),
        req.format.as_flag().to_string(),
        "--output".to_string(),
        req.output_path.clone(),
    ];
    if req.with_clicks {
        args.push("--with-clicks".to_string());
    }
    if let Some(range) = &req.range {
        args.push("--range".to_string());
        args.push(range.clone());
    }
    if let Some(exe) = &req.executable_path {
        args.push("--executable-path".to_string());
        args.push(exe.clone());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> ExportRequest {
        ExportRequest {
            deck_path: "/decks/talk.md".into(),
            format: SlidevExportFormat::Pdf,
            output_path: "/out/talk.pdf".into(),
            with_clicks: false,
            range: None,
            executable_path: None,
        }
    }

    #[test]
    fn builds_minimal_pdf_export() {
        let args = build_export_args(&base());
        assert_eq!(
            args,
            vec![
                "export",
                "/decks/talk.md",
                "--format",
                "pdf",
                "--output",
                "/out/talk.pdf"
            ]
        );
    }

    #[test]
    fn formats_map_to_flags() {
        assert_eq!(SlidevExportFormat::Png.as_flag(), "png");
        assert_eq!(SlidevExportFormat::Pptx.as_flag(), "pptx");
    }

    #[test]
    fn includes_clicks_range_and_executable_path() {
        let req = ExportRequest {
            format: SlidevExportFormat::Png,
            with_clicks: true,
            range: Some("1,4-5".into()),
            executable_path: Some("/Applications/Chrome.app/chrome".into()),
            ..base()
        };
        let args = build_export_args(&req);
        assert!(args.contains(&"--with-clicks".to_string()));
        let r = args.iter().position(|a| a == "--range").unwrap();
        assert_eq!(args[r + 1], "1,4-5");
        let e = args.iter().position(|a| a == "--executable-path").unwrap();
        assert_eq!(args[e + 1], "/Applications/Chrome.app/chrome");
    }
}
