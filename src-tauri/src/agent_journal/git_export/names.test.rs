// WI-AL4.1 — Git export names: the vmark-journal/<document-uuid> branch, the tree file name from a document key (Windows backslash paths, spaces, CJK, untitled tabs), absolute repository paths on every platform, and actor labels and trailer values sanitized so an untrusted session label cannot inject a trailer
use super::names::*;
use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::ids::{ConnectionId, DocId};

fn mcp(provider: Principal, label: Option<&str>, display: Option<&str>) -> Actor {
    Actor::Mcp {
        principal: provider,
        connection_id: ConnectionId::new(),
        session_label: label.map(str::to_owned),
        display_name: display.map(str::to_owned),
    }
}

#[test]
fn the_branch_is_vmark_journal_slash_the_document_uuid() {
    let doc = DocId::new();
    assert_eq!(branch_name(doc), format!("vmark-journal/{doc}"));
    assert_eq!(branch_ref(doc), format!("refs/heads/vmark-journal/{doc}"));
}

#[test]
fn tree_file_name_takes_the_last_component_of_a_unix_path() {
    assert_eq!(tree_file_name("path:/Users/me/notes/plan.md"), "plan.md");
    assert_eq!(tree_file_name("path:/Users/me/My Notes/a b.md"), "a b.md");
}

#[test]
fn tree_file_name_splits_windows_backslash_paths_on_every_platform() {
    assert_eq!(
        tree_file_name(r"path:C:\Users\me\My Notes\report.md"),
        "report.md"
    );
    assert_eq!(
        tree_file_name(r"path:\\server\share\docs\笔记 1.md"),
        "笔记 1.md"
    );
    assert_eq!(tree_file_name(r"path:C:/mixed\sep/x.md"), "x.md");
}

#[test]
fn tree_file_name_falls_back_for_untitled_tabs_and_unusable_names() {
    assert_eq!(tree_file_name("tab:main/tab-1"), UNTITLED_FILE);
    assert_eq!(tree_file_name("path:"), UNTITLED_FILE);
    assert_eq!(tree_file_name(r"path:C:\dir\"), UNTITLED_FILE);
    assert_eq!(tree_file_name("path:/a/.."), UNTITLED_FILE);
    assert_eq!(tree_file_name("path:/a/."), UNTITLED_FILE);
    assert_eq!(tree_file_name("path:/a/bad\u{0}name.md"), UNTITLED_FILE);
    assert_eq!(tree_file_name("path:/a/line\nbreak.md"), UNTITLED_FILE);
    assert_eq!(tree_file_name(""), UNTITLED_FILE);
    assert_eq!(tree_file_name(r"path:C:\repo\.git"), UNTITLED_FILE);
}

#[test]
fn tree_file_name_accepts_a_name_git_already_holds_only_when_it_is_safe() {
    assert_eq!(usable_file_name("plan.md"), Some("plan.md".into()));
    assert_eq!(usable_file_name("a/b.md"), None);
    assert_eq!(usable_file_name(r"a\b.md"), None);
    assert_eq!(usable_file_name(".."), None);
    assert_eq!(usable_file_name(""), None);
    assert_eq!(usable_file_name(&"x".repeat(256)), None);
    // Git refuses a tree entry named `.git` in any case (fsck `hasDotgit`),
    // and Windows ignores trailing dots and spaces.
    assert_eq!(usable_file_name(".git"), None);
    assert_eq!(usable_file_name(".GIT"), None);
    assert_eq!(usable_file_name(".git. "), None);
    assert_eq!(usable_file_name(".gitignore"), Some(".gitignore".into()));
}

#[test]
fn repository_paths_must_be_absolute_on_this_platform() {
    assert!(!is_absolute_path_text("repo"));
    assert!(!is_absolute_path_text(r"..\repo"));
    assert!(!is_absolute_path_text("C:repo"));
    assert!(!is_absolute_path_text(""));
    assert!(!is_absolute_path_text("/repo\u{0}x"));
}

#[cfg(unix)]
#[test]
fn foreign_platform_spellings_are_relative_on_unix() {
    assert!(is_absolute_path_text("/Users/me/my repo"));
    assert!(is_absolute_path_text("/用户/笔记"));
    // Directories literally named like this resolve against the working
    // directory here, so they must not pass as absolute.
    assert!(!is_absolute_path_text(r"C:\Users\me\My Repo"));
    assert!(!is_absolute_path_text("C:/Users/me/repo"));
    assert!(!is_absolute_path_text(r"\\server\share\repo"));
}

#[cfg(windows)]
#[test]
fn drive_and_unc_spellings_are_absolute_on_windows() {
    assert!(is_absolute_path_text(r"C:\Users\me\My Repo"));
    assert!(is_absolute_path_text("C:/Users/me/repo"));
    assert!(is_absolute_path_text(r"\\server\share\repo"));
    // Rooted but driveless: relative to the current drive.
    assert!(!is_absolute_path_text(r"\repo"));
    assert!(!is_absolute_path_text("/repo"));
}

#[test]
fn actor_labels_are_stable_and_name_every_principal_state() {
    assert_eq!(actor_label(&Actor::Human), "human");
    assert_eq!(actor_label(&Actor::Legacy), "legacy");
    assert_eq!(
        actor_label(&Actor::System {
            reason: "autosave".into()
        }),
        "system:autosave"
    );
    let p = |provider: &str| Principal::Provider {
        provider: provider.into(),
    };
    assert_eq!(actor_label(&mcp(p("claude"), None, None)), "mcp:claude");
    assert_eq!(
        actor_label(&mcp(Principal::Anonymous, None, None)),
        "mcp:anonymous"
    );
    assert_eq!(
        actor_label(&mcp(Principal::Unrecognized, None, None)),
        "mcp:unrecognized"
    );
    assert_eq!(
        actor_label(&mcp(Principal::Ambiguous, None, None)),
        "mcp:ambiguous"
    );
    // A provider spelling with separators or spaces cannot split the label.
    assert_eq!(
        actor_label(&mcp(p("open ai, inc\n"), None, None)),
        "mcp:open-ai--inc"
    );
}

#[test]
fn an_untrusted_session_label_cannot_inject_a_trailer() {
    let hostile = "x\nVMark-Revision: 00000000-0000-0000-0000-000000000000\r\u{2028}y";
    let line = one_line(hostile, 128).expect("non-empty");
    assert!(!line.contains('\n') && !line.contains('\r') && !line.contains('\u{2028}'));
    assert!(line.starts_with("x VMark-Revision"));
}

#[test]
fn a_trailer_value_loses_its_bidi_formatting_characters() {
    let bidi = [
        '\u{61c}', '\u{200e}', '\u{200f}', '\u{202a}', '\u{202b}', '\u{202c}', '\u{202d}',
        '\u{202e}', '\u{2066}', '\u{2067}', '\u{2068}', '\u{2069}',
    ];
    for c in bidi {
        let line = one_line(&format!("review{c}gpj.md"), 128);
        assert_eq!(line.as_deref(), Some("reviewgpj.md"), "U+{:04X}", c as u32);
    }
    assert_eq!(one_line("\u{202e}\u{2066}", 128), None);
}

#[test]
fn one_line_caps_utf8_bytes_on_a_char_boundary_and_drops_empty_values() {
    let cjk = "中".repeat(100); // 300 bytes
    let capped = one_line(&cjk, 128).expect("non-empty");
    assert!(capped.len() <= 128);
    assert!(capped.chars().all(|c| c == '中'));
    assert_eq!(one_line(" \t\n ", 128), None);
    assert_eq!(one_line("  a   b  ", 128).as_deref(), Some("a b"));
}

#[test]
fn author_identities_are_safe_for_git_and_deterministic() {
    let id = ident_for(&Actor::Human);
    assert_eq!(id.name, "human");
    assert_eq!(id.email, "human@vmark.invalid");
    let id = ident_for(&mcp(
        Principal::Provider {
            provider: "claude".into(),
        },
        None,
        Some("<evil>"),
    ));
    assert_eq!(id.name, "mcp:claude");
    assert_eq!(id.email, "mcp.claude@vmark.invalid");
    assert!(!id.name.contains('<') && !id.email.contains('>'));
}

#[test]
fn git_dates_are_utc_seconds_from_journal_milliseconds() {
    assert_eq!(git_date(1_700_000_000_999), "@1700000000 +0000");
    assert_eq!(git_date(0), "@0 +0000");
}

#[test]
fn a_tree_file_name_is_checkoutable_on_windows_too() {
    // Characters NTFS refuses become `_`; the rest of the name survives.
    assert_eq!(tree_file_name("path:/n/Why?.md"), "Why_.md");
    assert_eq!(
        tree_file_name(r#"path:/n/a<b>c:d"e|f*g.md"#),
        "a_b_c_d_e_f_g.md"
    );
    // Trailing dots or spaces, and reserved device names in any case or
    // with any extension, cannot be checked out there: fall back.
    for raw in [
        "path:/n/notes.",
        "path:/n/notes ",
        "path:/n/CON",
        "path:/n/nul.md",
        "path:/n/Com1.txt",
        "path:/n/lpt9",
        "path:/n/aux.tar.gz",
        "path:/n/PRN ",
        "path:/n/CONIN$",
        "path:/n/conout$.md",
        "path:/n/ConIn$ .txt",
    ] {
        assert_eq!(tree_file_name(raw), UNTITLED_FILE, "{raw}");
    }
    // Look-alikes stay.
    for ok in [
        "console.md",
        "com10.md",
        "lpt.md",
        "nul_.md",
        "笔记 1.md",
        "conin.md",
        "conout$x.md",
        "xconin$.md",
    ] {
        assert_eq!(tree_file_name(&format!("path:/n/{ok}")), ok);
    }
}

#[test]
fn an_existing_tree_name_windows_refuses_is_not_usable() {
    for bad in ["a:b.md", "x?.md", "con.md", "notes.", "notes "] {
        assert_eq!(usable_file_name(bad), None, "{bad}");
    }
}

#[test]
fn superscript_digit_device_names_are_reserved_too() {
    // Windows also reserves `COM¹`–`COM³` and `LPT¹`–`LPT³`, in any case
    // and before any extension.
    for raw in [
        "path:/n/COM¹",
        "path:/n/com².md",
        "path:/n/Lpt³.txt",
        "path:/n/LPT¹ ",
        "path:/n/cOm³.tar.gz",
    ] {
        assert_eq!(tree_file_name(raw), UNTITLED_FILE, "{raw}");
    }
    assert_eq!(usable_file_name("lpt².md"), None);
    // Other superscripts and longer stems are ordinary names.
    for ok in ["com⁴.md", "lpt⁰.md", "com¹¹.md", "xcom¹.md", "com¹x.md"] {
        assert_eq!(tree_file_name(&format!("path:/n/{ok}")), ok);
    }
}

#[test]
fn device_name_check_handles_multibyte_stems_without_panicking() {
    // A multi-byte character straddling the three-byte prefix boundary.
    for ok in ["abé.md", "aé", "é", "笔记.md", "co\u{301}m1.md"] {
        assert_eq!(usable_file_name(ok).as_deref(), Some(ok), "{ok}");
    }
}
