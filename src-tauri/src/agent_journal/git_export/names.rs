//! Pure naming rules for the Git export: the branch, the one file in each
//! commit's tree, author identities and the single-line trailer values.
//!
//! Every string that reaches Git from the journal passes through here, so an
//! untrusted value (a session label, a client's display name, a provider
//! spelling) can never add a line to a commit message or a field to an
//! author header. Document keys from Windows (`C:\…`, `\\server\share\…`)
//! split the same way on every platform.
//!
//! @module agent_journal/git_export/names

use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::ids::DocId;

/// The file name used when the document has no usable path (an untitled tab).
pub const UNTITLED_FILE: &str = "untitled.md";

/// Git's per-component limit on common filesystems.
const MAX_NAME_BYTES: usize = 255;

/// `vmark-journal/<document-uuid>`.
pub fn branch_name(doc: DocId) -> String {
    format!("vmark-journal/{doc}")
}

/// `refs/heads/vmark-journal/<document-uuid>`.
pub fn branch_ref(doc: DocId) -> String {
    format!("refs/heads/{}", branch_name(doc))
}

/// Characters a Windows (NTFS) file name cannot hold, besides separators.
const NTFS_FORBIDDEN: [char; 7] = ['<', '>', ':', '"', '|', '?', '*'];

/// The tree entry name for a document key: the last path component of a
/// `path:` key split on `/` and `\`, with characters Windows refuses
/// replaced by `_`, or [`UNTITLED_FILE`].
pub fn tree_file_name(doc_key: &str) -> String {
    let Some(path) = doc_key.strip_prefix("path:") else {
        return UNTITLED_FILE.to_owned();
    };
    let last = path.rsplit(['/', '\\']).next().unwrap_or("");
    let last = last.replace(NTFS_FORBIDDEN, "_");
    usable_file_name(&last).unwrap_or_else(|| UNTITLED_FILE.to_owned())
}

/// `Some(name)` when `name` is one safe tree entry, checkoutable on every
/// platform: non-empty, not `.`/`..` or `.git`, no separator, control or
/// NTFS-forbidden character, no trailing dot or space, not a Windows
/// device name, at most 255 bytes.
pub fn usable_file_name(name: &str) -> Option<String> {
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.len() > MAX_NAME_BYTES
        || name
            .chars()
            .any(|c| c == '/' || c == '\\' || c.is_control() || NTFS_FORBIDDEN.contains(&c))
        || name.ends_with(['.', ' '])
        || is_dot_git(name)
        || is_device_name(name);
    (!bad).then(|| name.to_owned())
}

/// `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `COM¹`–`COM³`, `LPT1`–`LPT9`,
/// `LPT¹`–`LPT³`, `CONIN$`, `CONOUT$` in any case, alone or before any
/// extension: Windows opens the device (the console's input or output for
/// the last two) instead.
fn is_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end_matches(' ');
    let upper = stem.to_ascii_uppercase();
    if upper == "CONIN$" || upper == "CONOUT$" {
        return true;
    }
    let Some((prefix, port)) = upper.split_at_checked(3) else {
        return false;
    };
    match prefix {
        "CON" | "PRN" | "AUX" | "NUL" => port.is_empty(),
        "COM" | "LPT" => is_port_digit(port),
        _ => false,
    }
}

/// One of the port suffixes Windows reserves: `1`–`9` or a superscript
/// `¹`, `²`, `³`.
fn is_port_digit(port: &str) -> bool {
    let mut chars = port.chars();
    matches!(
        (chars.next(), chars.next()),
        (Some('1'..='9' | '\u{b9}' | '\u{b2}' | '\u{b3}'), None)
    )
}

/// `.git` in any case, also with the trailing dots and spaces Windows
/// ignores: Git refuses such a tree entry.
fn is_dot_git(name: &str) -> bool {
    name.trim_end_matches(['.', ' '])
        .eq_ignore_ascii_case(".git")
}

/// True for a path this platform treats as absolute (`Path::is_absolute`):
/// `/x` on Unix; `C:\x`, `C:/x`, `\\server\share` on Windows. Another
/// platform's spelling is a relative name here, which would resolve against
/// VMark's working directory. A NUL anywhere is never a path.
pub fn is_absolute_path_text(path: &str) -> bool {
    !path.contains('\0') && std::path::Path::new(path).is_absolute()
}

/// A label safe as one token: lowercase ASCII alphanumerics, `.`, `_`, `-`;
/// anything else becomes `-`.
fn token(raw: &str) -> String {
    let t: String = raw
        .trim()
        .chars()
        .map(|c| match c {
            'a'..='z' | '0'..='9' | '.' | '_' | '-' => c,
            'A'..='Z' => c.to_ascii_lowercase(),
            _ => '-',
        })
        .collect();
    let t = t.trim_matches('-').to_owned();
    if t.is_empty() {
        "unknown".to_owned()
    } else {
        t
    }
}

/// The stable attribution label: `human`, `legacy`, `system:<reason>`,
/// `mcp:<provider>` or `mcp:anonymous|unrecognized|ambiguous`.
pub fn actor_label(actor: &Actor) -> String {
    match actor {
        Actor::Human => "human".to_owned(),
        Actor::Legacy => "legacy".to_owned(),
        Actor::System { reason } => format!("system:{}", token(reason)),
        Actor::Mcp { principal, .. } => match principal {
            Principal::Anonymous => "mcp:anonymous".to_owned(),
            Principal::Unrecognized => "mcp:unrecognized".to_owned(),
            Principal::Ambiguous => "mcp:ambiguous".to_owned(),
            Principal::Provider { provider } => format!("mcp:{}", token(provider)),
        },
    }
}

/// Collapse `raw` to one line: control and separator characters become
/// spaces, bidi formatting characters are dropped (they can make a trailer
/// read as something else), runs of whitespace collapse, the result is
/// capped at `max_bytes` on a char boundary. `None` when nothing printable
/// remains.
pub fn one_line(raw: &str, max_bytes: usize) -> Option<String> {
    let spaced: String = raw
        .chars()
        .filter(|&c| !crate::peer_text::is_bidi_formatting(c))
        .map(|c| {
            if c.is_control() || c == '\u{2028}' || c == '\u{2029}' || c == '\u{85}' {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut out = String::new();
    for word in spaced.split_whitespace() {
        let sep = usize::from(!out.is_empty());
        if out.len() + sep + word.len() > max_bytes {
            if out.is_empty() {
                let mut end = max_bytes.min(word.len());
                while !word.is_char_boundary(end) {
                    end -= 1;
                }
                out.push_str(&word[..end]);
            }
            break;
        }
        if sep == 1 {
            out.push(' ');
        }
        out.push_str(word);
    }
    (!out.is_empty()).then_some(out)
}

/// A Git author identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ident {
    pub name: String,
    pub email: String,
}

/// The author for a revision's actor. Derived only from the trusted label,
/// so an untrusted display name never reaches the header.
pub fn ident_for(actor: &Actor) -> Ident {
    let name = actor_label(actor);
    let local = name.replace(':', ".");
    Ident {
        email: format!("{local}@vmark.invalid"),
        name,
    }
}

/// The committer for every exported commit.
pub fn committer() -> Ident {
    Ident {
        name: "VMark".to_owned(),
        email: "journal@vmark.invalid".to_owned(),
    }
}

/// Git's raw date format for journal milliseconds, in UTC.
pub fn git_date(at_ms: u64) -> String {
    format!("@{} +0000", at_ms / 1000)
}
