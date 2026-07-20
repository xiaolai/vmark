//! Section-anchored edges — design-lifecycle-and-anchors.md §B.
//!
//! An edge pins `(upstream object, upstream revision)`, so ANY edit to a large
//! upstream reopens EVERY dependent edge — even when the passage the dependency
//! actually rests on never changed. Measured cost (2026-07-20): **11 of 28 edges
//! reopened, several 4×**. An anchor narrows the question from "did the file
//! change?" to "did the part I depend on change?".
//!
//! **Anchors are their own ledger entry, not an `InputRef` field.** The workflow
//! that motivates them is reactive — the logbook knows which edges are expensive
//! (`resolutions > 1`), so the prompt is "this reopened 4×, anchor it?" *after*
//! the fact. An already-appended transformation cannot be edited, so the anchor
//! must be a separate, revisable record.
//!
//! **Heading paths, not line ranges.** `["5. Resolution", "5.2 Waivers"]`
//! survives edits above it; a line range does not survive ordinary editing.
//!
//! **A lost anchor flags LOUDLY** — it never degrades to whole-file behaviour.
//! A vanished or ambiguous heading is strong evidence the dependency genuinely
//! broke, and silently falling back would hide exactly the signal worth having.

use super::canonical::{canonicalize_text, text_content_hash};
use super::types::ContentHash;

/// What happened when an anchor was resolved against a document.
#[derive(Debug, Clone, PartialEq)]
pub enum AnchorResolution {
    /// The heading path resolved to exactly one section.
    Found(ContentHash),
    /// No heading matched — the section was renamed or removed.
    NotFound,
    /// More than one section matched. Deliberately NOT "pick the first": an
    /// ambiguous anchor could silently start tracking the wrong section, which
    /// is worse than admitting the anchor no longer identifies one thing.
    Ambiguous,
    /// The path itself is unusable (empty, or all-empty segments).
    Invalid,
}

/// One parsed ATX heading.
struct Heading {
    level: usize,
    text: String,
    line: usize,
}

/// Parse ATX headings (`#`…`######`), skipping fenced code blocks.
///
/// Fence tracking is not optional: a fenced block containing `# comment` (shell,
/// Python, a nested markdown sample) would otherwise register as a heading and
/// could capture an anchor pointing at code.
fn headings(text: &str) -> Vec<Heading> {
    let mut out = Vec::new();
    let mut fence: Option<String> = None;
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim_end();
        let trimmed = line.trim_start();
        // ``` or ~~~ fences, of any length ≥3; a fence closes only on the same
        // marker character, so ``` inside a ~~~ block does not end it.
        if let Some(marker) = fence_marker(trimmed) {
            match &fence {
                Some(open) if marker.starts_with(open.as_str()) => fence = None,
                Some(_) => {}
                None => fence = Some(marker),
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if hashes == 0 || hashes > 6 {
            continue;
        }
        let rest = &trimmed[hashes..];
        // `#hashtag` is not a heading — ATX requires a space after the hashes.
        if !rest.starts_with(' ') && !rest.is_empty() {
            continue;
        }
        out.push(Heading {
            level: hashes,
            // Trailing `#`s are decorative in ATX and are not part of the text.
            text: rest.trim().trim_end_matches('#').trim().to_string(),
            line: i,
        });
    }
    out
}

fn fence_marker(trimmed: &str) -> Option<String> {
    for ch in ['`', '~'] {
        let n = trimmed.chars().take_while(|c| *c == ch).count();
        if n >= 3 {
            return Some(std::iter::repeat_n(ch, n).collect());
        }
    }
    None
}

/// Resolve a heading path to that section's normalised content hash.
///
/// The section is the heading line plus its body up to the next heading of the
/// SAME OR HIGHER level (i.e. subsections are included — depending on "§5" means
/// depending on all of §5). Content is canonicalised with the same rules capture
/// uses (CRLF, trailing whitespace, CJK spacing) so cosmetic edits do not
/// register as changes.
///
/// Matching is exact on trimmed heading text. Case and punctuation are
/// significant: renaming "5.2 Waivers" to "5.2 waivers" IS a change worth
/// surfacing, and quietly matching it would defeat the point.
pub fn resolve_anchor(text: &str, path: &[String]) -> AnchorResolution {
    let wanted: Vec<&str> = path
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if wanted.is_empty() || wanted.len() != path.len() {
        return AnchorResolution::Invalid;
    }
    let hs = headings(text);
    let lines: Vec<&str> = text.lines().collect();

    // Walk the path, narrowing the search window at each step.
    let mut lo = 0usize;
    let mut hi = lines.len();
    let mut level = 0usize;
    let mut chosen: Option<usize> = None;

    for segment in &wanted {
        let matches: Vec<&Heading> = hs
            .iter()
            .filter(|h| h.line >= lo && h.line < hi && h.level > level && h.text == *segment)
            .collect();
        // Only consider the SHALLOWEST level that matches, so a path segment
        // naming a top-level section is not confused by a same-named subsection.
        let Some(min_level) = matches.iter().map(|h| h.level).min() else {
            return AnchorResolution::NotFound;
        };
        let at: Vec<&&Heading> = matches.iter().filter(|h| h.level == min_level).collect();
        if at.len() > 1 {
            return AnchorResolution::Ambiguous;
        }
        let h = at[0];
        level = h.level;
        lo = h.line;
        hi = hs
            .iter()
            .find(|o| o.line > h.line && o.level <= h.level)
            .map(|o| o.line)
            .unwrap_or(lines.len());
        chosen = Some(h.line);
    }

    let Some(start) = chosen else {
        return AnchorResolution::Invalid;
    };
    let body = lines[start..hi].join("\n");
    AnchorResolution::Found(text_content_hash(&canonicalize_text(&body)))
}

/// Anchor an edge to a heading path, or clear it with an EMPTY path.
///
/// The baseline hash is computed from the upstream's CURRENT text at the moment
/// of anchoring — anchoring says "I depend on this section as it stands now".
/// Refuses a path that does not resolve to exactly one section: storing an
/// anchor that is already `NotFound`/`Ambiguous` would create an edge that can
/// only ever report `anchor-lost`.
pub fn set_anchor(
    kernel: &mut super::state::WorkspaceKernel,
    txf: &uuid::Uuid,
    input: u32,
    headings: &[String],
) -> Result<uuid::Uuid, String> {
    kernel.with_write_lock(|kernel| {
        let edge = kernel
            .index()
            .edge_by(txf, input)?
            .ok_or_else(|| format!("no such edge: {txf}#{input}"))?;
        let mut body = serde_json::json!({
            "edge": { "txf": txf.to_string(), "input": input },
            "headings": headings,
        });
        if !headings.is_empty() {
            let current = match kernel.index().resolve_live(&edge.upstream)? {
                super::dag::Resolved::Single(rev) => rev,
                _ => return Err("upstream has no single live revision to anchor against".into()),
            };
            let text = super::check_commands::snapshot_text(kernel, &edge.upstream, &current)?;
            match resolve_anchor(&text, headings) {
                AnchorResolution::Found(h) => {
                    body["anchored_hash"] = serde_json::json!(h.as_str());
                }
                AnchorResolution::NotFound => {
                    return Err("that heading path does not exist in the upstream".into())
                }
                AnchorResolution::Ambiguous => {
                    return Err("that heading path matches more than one section".into())
                }
                AnchorResolution::Invalid => return Err("invalid heading path".into()),
            }
        }
        let env = super::types::Envelope::create("edge-anchor", kernel.writer(), body);
        let id = env.id;
        kernel.append_and_apply(&env)?;
        Ok(id)
    })
}

#[cfg(test)]
#[path = "anchors.test.rs"]
mod tests;

/// One edge's anchor: the heading path it depends on, plus that section's hash
/// at the moment it was anchored (the baseline staleness compares against).
#[derive(Debug, Clone, PartialEq)]
pub struct Anchor {
    pub headings: Vec<String>,
    pub anchored_hash: ContentHash,
}

/// Current anchor per edge, projected from the ledger. Latest wins; an entry
/// with an EMPTY heading path clears the anchor, returning that edge to
/// whole-file behaviour. Both remain in history — this is append-only.
#[derive(Debug, Default, Clone)]
pub struct AnchorSet {
    by_edge: std::collections::HashMap<(uuid::Uuid, u32), Anchor>,
}

impl AnchorSet {
    pub fn from_entries(entries: &[super::types::Envelope]) -> Self {
        let mut by_edge = std::collections::HashMap::new();
        for e in entries {
            if e.kind != "edge-anchor" {
                continue;
            }
            let Some(edge) = e.body.get("edge") else {
                continue;
            };
            let Some(txf) = edge
                .get("txf")
                .and_then(|v| v.as_str())
                .and_then(|s| uuid::Uuid::parse_str(s).ok())
            else {
                continue;
            };
            let Some(input) = edge
                .get("input")
                .and_then(|v| v.as_u64())
                .and_then(|n| u32::try_from(n).ok())
            else {
                continue;
            };
            let headings: Vec<String> = e
                .body
                .get("headings")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|h| h.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            if headings.is_empty() {
                by_edge.remove(&(txf, input)); // explicit clear
                continue;
            }
            let Some(hash) = e
                .body
                .get("anchored_hash")
                .and_then(|v| v.as_str())
                .and_then(|s| ContentHash::parse(s).ok())
            else {
                continue;
            };
            by_edge.insert(
                (txf, input),
                Anchor {
                    headings,
                    anchored_hash: hash,
                },
            );
        }
        Self { by_edge }
    }

    pub fn get(&self, txf: &uuid::Uuid, input: u32) -> Option<&Anchor> {
        self.by_edge.get(&(*txf, input))
    }

    pub fn len(&self) -> usize {
        self.by_edge.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_edge.is_empty()
    }
}

/// How an anchored edge stands against the CURRENT upstream content.
#[derive(Debug, Clone, PartialEq)]
pub enum AnchorStatus {
    /// The depended-on section is byte-identical — the upstream moved, but not
    /// in a way that touches this dependency. No interruption.
    Unchanged,
    /// The section changed — this edge is genuinely stale.
    Changed,
    /// The heading vanished, was renamed, or became ambiguous. LOUD: this is
    /// evidence the dependency broke, and is never a silent fallback.
    Lost,
}

impl AnchorStatus {
    pub fn label(&self) -> &'static str {
        match self {
            AnchorStatus::Unchanged => "anchor-unchanged",
            AnchorStatus::Changed => "anchor-changed",
            AnchorStatus::Lost => "anchor-lost",
        }
    }
}

/// Evaluate an anchor against the upstream's current text.
pub fn evaluate(anchor: &Anchor, current_upstream_text: &str) -> AnchorStatus {
    match resolve_anchor(current_upstream_text, &anchor.headings) {
        AnchorResolution::Found(h) if h == anchor.anchored_hash => AnchorStatus::Unchanged,
        AnchorResolution::Found(_) => AnchorStatus::Changed,
        // NotFound / Ambiguous / Invalid all mean "this anchor no longer
        // identifies exactly one section" — surfaced, never downgraded.
        _ => AnchorStatus::Lost,
    }
}
