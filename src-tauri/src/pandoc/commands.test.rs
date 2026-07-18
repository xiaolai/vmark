//! Tests for `commands.rs` (moved from the inline `#[cfg(test)]` module;
//! included via `#[path]`).

use super::*;

// ---- ALLOWED_EXTENSIONS constant ----

// Constant-membership tests removed — the behavioral tests on
// validate_extension() + the length assertion below cover these with better signal.

#[test]
fn allowed_extensions_rejects_dangerous() {
    for ext in &["exe", "sh", "bat", "html", "pdf", "js", "py"] {
        assert!(
            !ALLOWED_EXTENSIONS.contains(ext),
            "{} should not be allowed",
            ext
        );
    }
}

#[test]
fn allowed_extensions_rejects_pdf() {
    assert!(!ALLOWED_EXTENSIONS.contains(&"pdf"));
}

#[test]
fn allowed_extensions_rejects_js() {
    assert!(!ALLOWED_EXTENSIONS.contains(&"js"));
}

#[test]
fn allowed_extensions_has_exactly_six_entries() {
    assert_eq!(ALLOWED_EXTENSIONS.len(), 6);
}

// ---- validate_extension ----

#[test]
fn validate_extension_accepts_docx() {
    assert!(validate_extension("/tmp/output.docx").is_ok());
}

#[test]
fn validate_extension_accepts_epub() {
    assert!(validate_extension("/tmp/book.epub").is_ok());
}

#[test]
fn validate_extension_accepts_tex() {
    assert!(validate_extension("/home/user/paper.tex").is_ok());
}

#[test]
fn validate_extension_accepts_odt() {
    assert!(validate_extension("document.odt").is_ok());
}

#[test]
fn validate_extension_accepts_rtf() {
    assert!(validate_extension("notes.rtf").is_ok());
}

#[test]
fn validate_extension_accepts_txt() {
    assert!(validate_extension("readme.txt").is_ok());
}

#[test]
fn validate_extension_is_case_insensitive() {
    assert!(validate_extension("file.DOCX").is_ok());
    assert!(validate_extension("file.Docx").is_ok());
    assert!(validate_extension("file.DocX").is_ok());
    assert!(validate_extension("file.EPUB").is_ok());
    assert!(validate_extension("file.TXT").is_ok());
}

#[test]
fn validate_extension_rejects_exe() {
    let err = validate_extension("malware.exe").unwrap_err();
    assert!(err.contains("Unsupported format"));
    assert!(err.contains(".exe"));
}

#[test]
fn validate_extension_rejects_sh() {
    assert!(validate_extension("script.sh").is_err());
}

#[test]
fn validate_extension_rejects_html() {
    assert!(validate_extension("page.html").is_err());
}

#[test]
fn validate_extension_rejects_pdf() {
    assert!(validate_extension("document.pdf").is_err());
}

#[test]
fn validate_extension_rejects_js() {
    assert!(validate_extension("app.js").is_err());
}

#[test]
fn validate_extension_rejects_py() {
    assert!(validate_extension("script.py").is_err());
}

#[test]
fn validate_extension_rejects_bat() {
    assert!(validate_extension("run.bat").is_err());
}

#[test]
fn validate_extension_rejects_no_extension() {
    let err = validate_extension("/tmp/output").unwrap_err();
    assert!(err.contains("Unsupported format"));
    // Empty extension shows as '.'
    assert!(err.contains("'.'"));
}

#[test]
fn validate_extension_uses_last_extension_for_double_dot() {
    // "file.tar.gz" — only the last extension ("gz") is checked
    assert!(validate_extension("archive.tar.gz").is_err());
}

#[test]
fn validate_extension_handles_dot_only_filename() {
    // ".docx" — on Unix this is a hidden file named "docx" with no extension
    // std::path::Path::new(".docx").extension() returns None
    assert!(validate_extension(".docx").is_err());
}

#[test]
fn validate_extension_handles_path_with_spaces() {
    assert!(validate_extension("/tmp/my documents/output file.docx").is_ok());
}

#[test]
fn validate_extension_error_lists_supported_formats() {
    let err = validate_extension("bad.xyz").unwrap_err();
    assert!(err.contains("docx"));
    assert!(err.contains("epub"));
    assert!(err.contains("tex"));
    assert!(err.contains("odt"));
    assert!(err.contains("rtf"));
    assert!(err.contains("txt"));
}

// ---- build_pandoc_args ----

#[test]
fn build_pandoc_args_base_without_source_dir() {
    let args = build_pandoc_args("/tmp/out.docx", None);
    assert_eq!(
        args,
        vec!["-f", "markdown", "-o", "/tmp/out.docx", "--standalone"]
    );
}

#[test]
fn build_pandoc_args_with_source_dir() {
    let args = build_pandoc_args("/tmp/out.epub", Some("/home/user/docs"));
    assert_eq!(
        args,
        vec![
            "-f",
            "markdown",
            "-o",
            "/tmp/out.epub",
            "--standalone",
            "--resource-path=/home/user/docs",
        ]
    );
}

#[test]
fn build_pandoc_args_source_dir_with_spaces() {
    let args = build_pandoc_args("out.docx", Some("/home/user/my docs"));
    let last = args.last().unwrap();
    assert_eq!(last, "--resource-path=/home/user/my docs");
}

#[test]
fn build_pandoc_args_always_uses_standalone() {
    let args = build_pandoc_args("out.tex", None);
    assert!(args.contains(&"--standalone".to_string()));
}

#[test]
fn build_pandoc_args_always_specifies_markdown_format() {
    let args = build_pandoc_args("out.txt", None);
    let f_idx = args.iter().position(|a| a == "-f").unwrap();
    assert_eq!(args[f_idx + 1], "markdown");
}

#[test]
fn build_pandoc_args_output_path_follows_o_flag() {
    let args = build_pandoc_args("/custom/path.rtf", None);
    let o_idx = args.iter().position(|a| a == "-o").unwrap();
    assert_eq!(args[o_idx + 1], "/custom/path.rtf");
}

// ---- resolve_pandoc_path ----

#[test]
fn resolve_pandoc_path_returns_option() {
    // This test verifies the function returns Some or None without panicking.
    // On CI without pandoc, this returns None. On dev machines with pandoc, Some.
    let result = resolve_pandoc_path();
    match &result {
        Some(path) => {
            // If found, the path should be non-empty and point to a real file
            assert!(!path.is_empty());
            assert!(
                std::path::Path::new(path).exists(),
                "Resolved path '{}' should exist on disk",
                path
            );
        }
        None => {
            // Pandoc not installed — this is valid in CI
        }
    }
}

// ---- PANDOC_TIMEOUT constant ----

#[test]
fn pandoc_timeout_is_two_minutes() {
    assert_eq!(PANDOC_TIMEOUT, Duration::from_secs(120));
}
