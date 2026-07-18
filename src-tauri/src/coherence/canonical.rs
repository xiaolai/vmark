//! Canonicalization and content hashing (pure — ADR-C4). Spec §3.
//!
//! Text pipeline: UTF-8 → NFC → LF, then identity masking (the reserved
//! `vmark.id`/`vmark.schema` lines are excluded), then SHA-256. Binary
//! content hashes raw bytes with no canonicalization (§3.4). The CAS
//! stores exactly the masked canonical bytes (§4.2), so every snapshot is
//! self-verifying against its key.

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use super::types::ContentHash;

/// NFC + LF normalization (spec §3.1). No other transformation: trailing
/// whitespace and final-newline presence are content.
pub fn canonicalize_text(input: &str) -> String {
    let nfc: String = input.nfc().collect();
    // \r\n and bare \r both become \n.
    let mut out = String::with_capacity(nfc.len());
    let mut chars = nfc.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out
}

/// Remove the reserved identity keys from a canonical (LF) document's
/// frontmatter (spec §3.2 / §2.1): drop `id:`/`schema:` lines inside the
/// top-level `vmark:` mapping, drop the mapping if emptied, drop the
/// whole frontmatter block if emptied. Malformed frontmatter (no closing
/// fence) is content — returned untouched.
pub fn mask_identity(text: &str) -> String {
    let Some(after) = text.strip_prefix("---\n") else {
        return text.to_string();
    };
    let (fm, rest) = if let Some(pos) = after.find("\n---\n") {
        (&after[..pos], &after[pos + 5..])
    } else if let Some(stripped) = after.strip_suffix("\n---") {
        (stripped, "")
    } else {
        return text.to_string();
    };

    let lines: Vec<&str> = fm.split('\n').collect();
    let mut out: Vec<&str> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.trim_end() == "vmark:" {
            let mut kept: Vec<&str> = Vec::new();
            let mut j = i + 1;
            while j < lines.len() && lines[j].starts_with([' ', '\t']) {
                let t = lines[j].trim_start();
                if !(t.starts_with("id:") || t.starts_with("schema:")) {
                    kept.push(lines[j]);
                }
                j += 1;
            }
            if !kept.is_empty() {
                out.push(line);
                out.extend(kept);
            }
            i = j;
        } else {
            out.push(line);
            i += 1;
        }
    }
    let masked_fm = out.join("\n");
    if masked_fm.trim().is_empty() {
        rest.to_string()
    } else {
        format!("---\n{masked_fm}\n---\n{rest}")
    }
}

/// Spec §3.2: hash of the identity-masked canonical bytes.
pub fn text_content_hash(input: &str) -> ContentHash {
    let masked = mask_identity(&canonicalize_text(input));
    let digest: [u8; 32] = Sha256::digest(masked.as_bytes()).into();
    ContentHash::from_digest(&digest)
}

/// The exact bytes the CAS stores for a text document (spec §4.2) — the
/// same bytes `text_content_hash` hashed, keeping snapshots self-verifying.
pub fn canonical_masked_bytes(input: &str) -> String {
    mask_identity(&canonicalize_text(input))
}

/// Spec §3.4: raw-byte hashing for binary content.
pub fn binary_content_hash(bytes: &[u8]) -> ContentHash {
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    ContentHash::from_digest(&digest)
}

/// Inverse of `mask_identity` for materialization (spec §4.2) and first
/// capture (spec §2.1): insert the reserved `vmark:` block, preserving
/// author frontmatter byte-for-byte. Appended at the end of an existing
/// frontmatter block, or a new block is prepended. Malformed frontmatter
/// (unterminated fence) is content — a fresh block is prepended above it.
pub fn insert_identity(text: &str, id: &str, schema: Option<&str>) -> String {
    let vmark_block = match schema {
        Some(s) => format!("vmark:\n  id: {id}\n  schema: {s}"),
        None => format!("vmark:\n  id: {id}"),
    };
    if let Some(after) = text.strip_prefix("---\n") {
        if let Some(pos) = after.find("\n---\n") {
            let fm = &after[..pos];
            let rest = &after[pos + 5..];
            return format!("---\n{fm}\n{vmark_block}\n---\n{rest}");
        }
        if let Some(fm) = after.strip_suffix("\n---") {
            return format!("---\n{fm}\n{vmark_block}\n---\n");
        }
    }
    format!("---\n{vmark_block}\n---\n{text}")
}

/// Spec §3.1/§3.4: invalid UTF-8 means the file is treated as binary.
pub fn is_probably_binary(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_err()
}

#[cfg(test)]
#[path = "canonical.test.rs"]
mod tests;
