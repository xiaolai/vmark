//! Resolving stored anchors in a revision's text, tier by tier. A list of
//! anchors shares one encoding of the text, one reading of its headings
//! into sections (each heading's path, built once) and one search pass
//! (`multi`), so its cost is linear in the text plus the anchors (each
//! candidate's heading path a binary search, log of the headings), never
//! their product: no walk over the headings per anchor. Every heading read
//! goes through `Headings::get`, and every text read through a primitive
//! that counts itself (`work`), so the growth tests see any re-read.
//!
//! @module agent_journal/comment_anchor/resolve

use std::cell::OnceCell;

use super::multi::occurrences_of_all;
use super::outline::{headings, Heading};
use super::work::{self, utf16};
use super::{Resolution, StoredAnchor, Tier};
use crate::agent_journal::ids::RevisionId;

/// Find `anchor` in `text`. `at` is the revision `text` is; the offset hint
/// applies only when it is the anchor's creation revision.
pub fn resolve(text: &str, anchor: &StoredAnchor, at: Option<RevisionId>) -> Resolution {
    // `resolve_all` answers exactly one resolution per anchor.
    resolve_all(text, &[anchor], at)
        .pop()
        .unwrap_or(Resolution::Orphaned)
}

/// Find each of `anchors` in `text`, as `resolve` would one by one, with
/// the text encoded once, its headings read at most once, and every quote
/// found in one pass over it.
pub fn resolve_all(
    text: &str,
    anchors: &[&StoredAnchor],
    at: Option<RevisionId>,
) -> Vec<Resolution> {
    let hay = utf16(text);
    let quotes: Vec<Vec<u16>> = anchors.iter().map(|a| utf16(&a.quote)).collect();
    let found = occurrences_of_all(&hay, &quotes);
    let outline: OnceCell<Sections> = OnceCell::new();
    let heads = || outline.get_or_init(|| Sections::of(headings(text)));
    anchors
        .iter()
        .zip(&quotes)
        .zip(found)
        .map(|((anchor, quote), all)| resolve_found(&hay, anchor, quote, all, at, &heads))
        .collect()
}

/// `anchor`'s resolution, given every start of its quote in `hay`.
fn resolve_found<'h>(
    hay: &[u16],
    anchor: &StoredAnchor,
    quote: &[u16],
    all: Vec<usize>,
    at: Option<RevisionId>,
    heads: &dyn Fn() -> &'h Sections,
) -> Resolution {
    if all.is_empty() {
        return Resolution::Orphaned;
    }
    let hint = anchor
        .hint
        .as_ref()
        .filter(|h| Some(h.revision) == at)
        .map(|h| h.offset);
    let decide = |tier: Tier, found: Vec<usize>| decide(tier, &found, quote.len(), hint);

    let prefix = utf16(&anchor.prefix);
    let suffix = utf16(&anchor.suffix);
    let in_context: Vec<usize> = all
        .iter()
        .copied()
        .filter(|&i| {
            let after = i + quote.len();
            work::add(prefix.len() + suffix.len());
            i >= prefix.len()
                && hay[i - prefix.len()..i] == prefix[..]
                && hay.get(after..after + suffix.len()) == Some(&suffix[..])
        })
        .collect();
    if !in_context.is_empty() {
        return decide(Tier::Context, in_context);
    }
    let in_path = within_path(heads(), &all, &anchor.heading_path);
    if !in_path.is_empty() {
        return decide(Tier::HeadingPath, in_path);
    }
    decide(Tier::Anywhere, all)
}

fn decide(tier: Tier, found: &[usize], len: usize, hint: Option<u64>) -> Resolution {
    let resolved = |start: usize, by_hint: bool| Resolution::Resolved {
        tier,
        start: start as u64,
        end: (start + len) as u64,
        by_hint,
    };
    match found {
        [only] => resolved(*only, false),
        _ => match hint.and_then(|h| found.iter().copied().find(|&c| c as u64 == h)) {
            Some(start) => resolved(start, true),
            None => Resolution::Ambiguous {
                tier,
                candidates: found.iter().map(|&c| c as u64).collect(),
            },
        },
    }
}

/// A text's headings, ascending by offset, read only through `get`, which
/// counts every heading read: any walk over them, or search into them, is
/// counted at one seam, so a per-anchor walk shows in the growth tests.
struct Headings(Vec<Heading>);

impl Headings {
    fn get(&self, i: usize) -> Option<&Heading> {
        work::add(1);
        self.0.get(i)
    }

    fn len(&self) -> usize {
        self.0.len()
    }
}

/// A text's headings with the heading path in force from each one to the
/// next, built in one pass.
struct Sections {
    headings: Headings,
    /// `paths[i]`: indices into `headings` of the path from heading `i` on.
    paths: Vec<Vec<usize>>,
}

impl Sections {
    fn of(headings: Vec<Heading>) -> Self {
        let headings = Headings(headings);
        let depth = |i: usize| headings.get(i).map_or(0, |h| h.depth);
        let mut stack: Vec<usize> = Vec::new();
        let mut paths = Vec::with_capacity(headings.len());
        for i in 0..headings.len() {
            let d = depth(i);
            while stack.last().is_some_and(|&top| depth(top) >= d) {
                stack.pop();
            }
            stack.push(i);
            paths.push(stack.clone());
        }
        Self { headings, paths }
    }

    /// The heading path enclosing UTF-16 offset `at` (a heading encloses
    /// its own line): a binary search, each probe a counted read.
    fn path_at(&self, at: u64) -> &[usize] {
        let (mut lo, mut hi) = (0, self.headings.len());
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.headings.get(mid).is_some_and(|h| h.offset <= at) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        match lo {
            0 => &[],
            n => &self.paths[n - 1],
        }
    }
}

/// The candidates (ascending) whose enclosing heading path is `path`.
fn within_path(sections: &Sections, candidates: &[usize], path: &[String]) -> Vec<usize> {
    candidates
        .iter()
        .copied()
        .filter(|&c| {
            let at = sections.path_at(c as u64);
            at.len() == path.len()
                && at
                    .iter()
                    .zip(path)
                    .all(|(&i, p)| sections.headings.get(i).is_some_and(|h| h.text == *p))
        })
        .collect()
}
