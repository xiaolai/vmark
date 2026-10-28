// WI-AL3.2 — finding many quotes in one pass: each quote's starts equal a per-quote search's, overlapping and nested occurrences included, for quotes sharing prefixes and suffixes, repeated quotes, an empty quote and one longer than the text; and resolving anchors together answers what resolving each alone answers
use super::multi::occurrences_of_all;
use super::{resolve, resolve_all, OffsetHint, StoredAnchor};
use crate::agent_journal::ids::RevisionId;

fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// Every start of `needle` in `hay`, the slow way.
fn naive(hay: &[u16], needle: &[u16]) -> Vec<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return Vec::new();
    }
    (0..=hay.len() - needle.len())
        .filter(|&i| hay[i..i + needle.len()] == needle[..])
        .collect()
}

#[test]
fn every_quote_is_found_as_a_per_quote_search_finds_it() {
    let hay = units("aaaa abab ababab she hers his 👋👋 a👋b");
    let needles: Vec<Vec<u16>> = [
        "a",
        "aa",
        "aaa",
        "ab",
        "abab",
        "bab",
        "she",
        "he",
        "hers",
        "his",
        "s",
        "👋",
        "👋👋",
        "a👋b",
        "ab",
        "",
        "zzz",
        &"x".repeat(100),
    ]
    .iter()
    .map(|n| units(n))
    .collect();
    let all = occurrences_of_all(&hay, &needles);
    for (needle, found) in needles.iter().zip(&all) {
        assert_eq!(
            found,
            &naive(&hay, needle),
            "{}",
            String::from_utf16_lossy(needle)
        );
    }
}

#[test]
fn resolving_together_answers_what_resolving_alone_answers() {
    let text = "# A\n\nhello world\n\n## B\n\nhello again\n\nworld\n";
    let rev = RevisionId::new();
    let anchor = |quote: &str, prefix: &str, suffix: &str, path: &[&str], offset: Option<u64>| {
        StoredAnchor {
            quote: quote.into(),
            prefix: prefix.into(),
            suffix: suffix.into(),
            heading_path: path.iter().map(|s| (*s).to_string()).collect(),
            hint: offset.map(|offset| OffsetHint {
                revision: rev,
                offset,
            }),
        }
    };
    let anchors = [
        anchor("hello", "# A\n\n", " world", &["A"], None),
        anchor("hello", "", "", &["A", "B"], None),
        anchor("hello", "", "", &[], Some(25)),
        anchor("world", "x", "y", &[], None),
        anchor("gone", "", "", &[], None),
    ];
    let refs: Vec<&StoredAnchor> = anchors.iter().collect();
    for at in [Some(rev), None] {
        let together = resolve_all(text, &refs, at);
        let alone: Vec<_> = anchors.iter().map(|a| resolve(text, a, at)).collect();
        assert_eq!(together, alone);
    }
}
