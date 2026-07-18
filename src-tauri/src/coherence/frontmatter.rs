//! Frontmatter identity convention (ADR-C4 services tier). Spec §2.1:
//! line-based reading of the reserved `vmark:` block (no YAML round-trip;
//! author bytes preserved), identity assignment on first capture, and the
//! §3.3 guarantee that assignment never moves the content hash. Duplicate
//! detection is scan-level (`scan.rs`); this module owns parse + assign.

use uuid::Uuid;

use super::canonical::insert_identity;
use super::types::ObjectId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileIdentity {
    pub id: ObjectId,
    pub schema: Option<String>,
}

/// Read `vmark.id` / `vmark.schema` from a document's frontmatter.
/// `None` for: no frontmatter, no `vmark` key, malformed frontmatter
/// (unterminated fence — content, not identity), or an invalid UUID.
pub fn read_identity(text: &str) -> Option<FileIdentity> {
    let after = text.strip_prefix("---\n")?;
    let fm = if let Some(pos) = after.find("\n---\n") {
        &after[..pos]
    } else if let Some(stripped) = after.strip_suffix("\n---") {
        stripped
    } else {
        return None;
    };
    let lines: Vec<&str> = fm.split('\n').collect();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].trim_end() == "vmark:" {
            let mut id: Option<Uuid> = None;
            let mut schema: Option<String> = None;
            let mut j = i + 1;
            while j < lines.len() && lines[j].starts_with([' ', '\t']) {
                let t = lines[j].trim_start();
                if let Some(v) = t.strip_prefix("id:") {
                    id = Uuid::parse_str(v.trim()).ok();
                } else if let Some(v) = t.strip_prefix("schema:") {
                    let v = v.trim();
                    if !v.is_empty() {
                        schema = Some(v.to_string());
                    }
                }
                j += 1;
            }
            return id.map(|id| FileIdentity { id: ObjectId(id), schema });
        }
        i += 1;
    }
    None
}

/// Mint a fresh UUIDv7 identity and insert it (spec §2.1). Returns the
/// rewritten content and the identity. By §3.3 the rewrite never changes
/// the content hash — tested against `text_content_hash`.
pub fn assign_identity(text: &str, schema: Option<&str>) -> (String, FileIdentity) {
    let id = Uuid::now_v7();
    let content = insert_identity(text, &id.to_string(), schema);
    (content, FileIdentity { id: ObjectId(id), schema: schema.map(str::to_string) })
}

#[cfg(test)]
#[path = "frontmatter.test.rs"]
mod tests;
