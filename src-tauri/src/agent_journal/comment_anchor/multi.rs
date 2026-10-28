//! Every occurrence of many quotes in one text, in a single pass over it
//! (Aho–Corasick over UTF-16 units), so finding all of a document's
//! passages costs the text plus the quotes plus the matches, never the
//! text once per quote.
//!
//! Key decisions:
//!   - Overlapping occurrences are all reported, as a per-quote search
//!     would report them; each quote's starts come out ascending.
//!   - An empty quote, or one longer than the text, has no occurrence.
//!   - Edges live in one map keyed by (node, unit): a trie of up to the
//!     logical comment caps would waste memory as a dense table.
//!
//! @module agent_journal/comment_anchor/multi

use std::collections::{HashMap, VecDeque};

use super::work;

const NONE: u32 = u32::MAX;

/// The starts of every occurrence of each of `needles` in `hay`, one list per needle.
pub(super) fn occurrences_of_all(hay: &[u16], needles: &[Vec<u16>]) -> Vec<Vec<usize>> {
    let mut edges: HashMap<(u32, u16), u32> = HashMap::new();
    let mut children: Vec<Vec<(u16, u32)>> = vec![Vec::new()];
    let mut ends: Vec<Vec<u32>> = vec![Vec::new()];
    for (p, needle) in needles.iter().enumerate() {
        if needle.is_empty() || needle.len() > hay.len() {
            continue;
        }
        work::add(needle.len());
        let mut node = 0u32;
        for &u in needle {
            node = match edges.get(&(node, u)) {
                Some(&next) => next,
                None => {
                    let next = ends.len() as u32;
                    ends.push(Vec::new());
                    children.push(Vec::new());
                    children[node as usize].push((u, next));
                    edges.insert((node, u), next);
                    next
                }
            };
        }
        ends[node as usize].push(p as u32);
    }

    // Failure links, breadth first; `dict` is the nearest proper suffix
    // node at which some needle ends.
    let mut fail = vec![0u32; ends.len()];
    let mut dict = vec![NONE; ends.len()];
    let mut queue: VecDeque<u32> = children[0].iter().map(|&(_, c)| c).collect();
    while let Some(v) = queue.pop_front() {
        for &(u, c) in &children[v as usize] {
            let mut f = fail[v as usize];
            let target = loop {
                if let Some(&t) = edges.get(&(f, u)) {
                    break t;
                }
                if f == 0 {
                    break 0;
                }
                f = fail[f as usize];
            };
            fail[c as usize] = target;
            dict[c as usize] = if ends[target as usize].is_empty() {
                dict[target as usize]
            } else {
                target
            };
            queue.push_back(c);
        }
    }

    let mut out = vec![Vec::new(); needles.len()];
    let mut s = 0u32;
    work::add(hay.len());
    for (i, &u) in hay.iter().enumerate() {
        s = loop {
            if let Some(&t) = edges.get(&(s, u)) {
                break t;
            }
            if s == 0 {
                break 0;
            }
            s = fail[s as usize];
        };
        let mut m = if ends[s as usize].is_empty() {
            dict[s as usize]
        } else {
            s
        };
        while m != NONE {
            for &p in &ends[m as usize] {
                out[p as usize].push(i + 1 - needles[p as usize].len());
            }
            m = dict[m as usize];
        }
    }
    out
}
