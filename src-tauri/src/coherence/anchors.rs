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

use super::canonical::text_content_hash;
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

/// One fenced-code-block state: which marker char, and how long the opener was.
struct Fence {
    ch: char,
    len: usize,
}

/// Leading spaces beyond this make a line indented CODE, not markup (CommonMark).
const MAX_INDENT: usize = 3;

/// Parse ATX headings (`#`…`######`), skipping fenced code blocks.
///
/// Fence tracking is not optional: a fenced block containing `# comment` (shell,
/// Python, a nested markdown sample) would otherwise register as a heading and
/// could capture an anchor pointing at code — a silent-suppression path.
///
/// Follows CommonMark closely enough that code cannot masquerade as structure:
/// - a closing fence must use the SAME character, be at least as long as the
///   opener, and have nothing but whitespace after it (so ```` ```not-a-close ````
///   does NOT close a block);
/// - 4+ leading spaces is indented code, so `    # Fake` is not a heading;
/// - the marker may be followed by any whitespace (space or tab), not only a
///   space.
fn headings(text: &str) -> Vec<Heading> {
    let mut out = Vec::new();
    let mut fence: Option<Fence> = None;
    for (i, raw) in text.lines().enumerate() {
        let indent = raw.len() - raw.trim_start_matches(' ').len();
        let trimmed = raw.trim_start_matches(' ').trim_end();
        if indent > MAX_INDENT {
            continue; // indented code: never markup
        }
        if let Some((ch, len)) = fence_run(trimmed) {
            match &fence {
                // A closing fence: same char, at least as long, nothing but
                // whitespace after it.
                Some(open)
                    if open.ch == ch && len >= open.len && trimmed[len..].trim().is_empty() =>
                {
                    fence = None
                }
                Some(_) => {}
                None => fence = Some(Fence { ch, len }),
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
        // ATX requires whitespace after the marker — `#hashtag` is prose. An
        // empty remainder is a bare `#`, which is a valid (empty) heading.
        if !rest.is_empty() && !rest.starts_with([' ', '\t']) {
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

/// The leading run of `\`` or `~` if it is at least 3 long.
fn fence_run(trimmed: &str) -> Option<(char, usize)> {
    for ch in ['`', '~'] {
        let n = trimmed.chars().take_while(|c| *c == ch).count();
        if n >= 3 {
            return Some((ch, n));
        }
    }
    None
}

/// Bounds on an anchor path — an anchor arriving over IPC or via a git-merged
/// ledger is untrusted input, and resolution cost scales with both.
pub const MAX_PATH_SEGMENTS: usize = 16;
pub const MAX_SEGMENT_BYTES: usize = 512;

/// Resolve a heading path to that section's normalised content hash.
///
/// The section is the heading line plus its body up to the next heading of the
/// SAME OR HIGHER level (subsections included — depending on "§5" means
/// depending on all of §5), hashed with the same canonicalisation capture uses.
///
/// Matching is EXACT and STRUCTURAL:
/// - each segment must match exactly one heading (any two matches, at any
///   levels, are `Ambiguous` — "shallowest wins" would silently ignore edits to
///   an identically-named sibling section);
/// - each segment must be a DIRECT child of the previous one (no omitted
///   ancestors), so moving an otherwise-identical block under a different
///   parent is a change, not a match;
/// - case and punctuation are significant: renaming a heading IS a change.
pub fn resolve_anchor(text: &str, path: &[String]) -> AnchorResolution {
    if path.is_empty()
        || path.len() > MAX_PATH_SEGMENTS
        || path.iter().any(|s| s.len() > MAX_SEGMENT_BYTES)
    {
        return AnchorResolution::Invalid;
    }
    let wanted: Vec<&str> = path.iter().map(|s| s.trim()).collect();
    if wanted.iter().any(|s| s.is_empty()) {
        return AnchorResolution::Invalid;
    }
    let hs = headings(text);

    // Walk the path, requiring a DIRECT parent-child step each time.
    let mut lo = 0usize; // first heading index in the current window
    let mut hi = hs.len(); // one past the last
    let mut parent_level: Option<usize> = None;
    let mut chosen: Option<usize> = None; // index into `hs`

    for segment in &wanted {
        // Every same-named heading in the window counts toward ambiguity,
        // whatever its level: "shallowest wins" would silently ignore edits to
        // an identically-named sibling section.
        let same_text: Vec<usize> = (lo..hi).filter(|&i| hs[i].text == *segment).collect();
        let candidates: Vec<usize> = match parent_level {
            // The FIRST segment may name a heading at any depth — a path need
            // not start at the document root.
            None => same_text.clone(),
            // A later segment must be a DIRECT child of the one just chosen:
            // the shallowest level inside its section. Allowing any deeper level
            // would let an omitted intermediate ancestor match, so an otherwise
            // identical block moved under a different parent would read as
            // unchanged.
            Some(pl) => {
                let Some(child_level) = (lo..hi).map(|i| hs[i].level).filter(|l| *l > pl).min()
                else {
                    return AnchorResolution::NotFound;
                };
                same_text
                    .iter()
                    .copied()
                    .filter(|&i| hs[i].level == child_level)
                    .collect()
            }
        };
        match (candidates.len(), same_text.len()) {
            (0, _) => return AnchorResolution::NotFound,
            (1, 1) => {}
            _ => return AnchorResolution::Ambiguous,
        }
        let idx = candidates[0];
        parent_level = Some(hs[idx].level);
        chosen = Some(idx);
        lo = idx + 1;
        hi = (idx + 1..hs.len())
            .find(|&j| hs[j].level <= hs[idx].level)
            .unwrap_or(hs.len());
    }

    let Some(idx) = chosen else {
        return AnchorResolution::Invalid;
    };
    // Slice by BYTE RANGE, not by re-joining lines: joining loses the section's
    // terminating newline, so "# H\nbody" and "# H\nbody\n" would hash
    // identically even though the canonical format treats a final newline as
    // content — a silent-suppression path.
    let start_byte = line_start_byte(text, hs[idx].line);
    let end_byte = match hs.get(hi) {
        Some(next) => line_start_byte(text, next.line),
        None => text.len(),
    };
    let body = &text[start_byte..end_byte];
    AnchorResolution::Found(text_content_hash(body))
}

/// Byte offset where a 0-based line begins.
fn line_start_byte(text: &str, line: usize) -> usize {
    let mut seen = 0usize;
    for (i, b) in text.bytes().enumerate() {
        if seen == line {
            return i;
        }
        if b == b'\n' {
            seen += 1;
        }
    }
    text.len()
}

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

/// Anchor an edge to a heading path, or clear it with an EMPTY path.
///
/// The baseline hash is computed from the upstream's CURRENT text at the moment
/// of anchoring — anchoring says "I depend on this section as it stands now".
/// Refuses a path that does not resolve to exactly one section: storing an
/// anchor that is already `NotFound`/`Ambiguous` would create an edge that can
/// only ever report `anchor-lost`. Path bounds are enforced by `resolve_anchor`,
/// which returns `Invalid` for an oversized or over-deep path.
/// Every heading path in `text` that can actually be anchored to.
///
/// Feeds the anchor picker. Two rules make it safe to send a returned path
/// straight back to `set_anchor`:
///
/// - Paths are full root-to-leaf, so each one resolves on its own rather than
///   depending on what the picker happened to display around it.
/// - A path that does not resolve UNAMBIGUOUSLY is dropped. Two same-text
///   siblings make `resolve_anchor` return `Ambiguous`, so offering either
///   would guarantee a rejection at set time — the picker must not show
///   options the setter refuses.
///
/// Over-deep paths are dropped for the same reason: `set_anchor` bounds them.
pub fn heading_paths(text: &str) -> Vec<Vec<String>> {
    let mut stack: Vec<Heading> = Vec::new();
    let mut out: Vec<Vec<String>> = Vec::new();
    for h in headings(text) {
        while stack.last().is_some_and(|t| t.level >= h.level) {
            stack.pop();
        }
        let path: Vec<String> = stack
            .iter()
            .map(|t| t.text.clone())
            .chain(std::iter::once(h.text.clone()))
            .collect();
        stack.push(h);
        if path.len() > MAX_PATH_SEGMENTS || path.iter().any(|s| s.len() > MAX_SEGMENT_BYTES) {
            continue;
        }
        if matches!(resolve_anchor(text, &path), AnchorResolution::Found(_)) {
            out.push(path);
        }
    }
    out
}

pub fn set_anchor(
    kernel: &mut super::state::WorkspaceKernel,
    txf: &uuid::Uuid,
    input: u32,
    headings: &[String],
) -> Result<uuid::Uuid, String> {
    // Bound the path even on the CLEAR path, so an oversized array cannot be
    // appended at all (the ledger cap is far too generous to be the only guard).
    if headings.len() > MAX_PATH_SEGMENTS || headings.iter().any(|h| h.len() > MAX_SEGMENT_BYTES) {
        return Err(format!(
            "anchor path too large (max {MAX_PATH_SEGMENTS} segments, {MAX_SEGMENT_BYTES} bytes each)"
        ));
    }
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
