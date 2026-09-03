//! Dotted-decimal url-filters for a CIDR range, derived rather than hand-written.
//!
//! WebKit's url-filter dialect has no alternation, so one CIDR becomes SEVERAL
//! filters: the whole octets before the boundary are literal, the boundary octet
//! is decomposed into decimal character classes (`1[6-9]`, `2[0-9]`, `3[0-1]` for
//! 16–31), and every octet after it is `[0-9]+`. Deriving these from
//! `BLOCKED_IPV4_RANGES` is what makes the rule list and the navigation policy
//! ONE table: a range added to the policy is blocked for subresources too, with no
//! second list to forget (audit 2026-09-03 round 2, #6).

use super::{AUTHORITY, HOST_END, OCTET};

/// Every url-filter that, together, matches exactly the dotted-decimal hosts in
/// `network/prefix` (canonical spelling, as WebKit serialises IPv4 hosts).
pub(super) fn dotted_filters(network: u32, prefix: u8) -> Vec<String> {
    let octets = network.to_be_bytes();
    let whole = usize::from(prefix / 8);
    let rest = prefix % 8;
    let literal = |i: usize| vec![octets[i].to_string()];
    let any = || vec![OCTET.to_string()];
    let per_octet: Vec<Vec<String>> = (0..4)
        .map(|i| {
            if i < whole {
                literal(i)
            } else if i == whole && rest != 0 {
                let lo = u32::from(octets[i]);
                let hi = lo | (0xff >> rest);
                octet_patterns(lo, hi)
            } else {
                any()
            }
        })
        .collect();
    // Only one octet (the boundary) has more than one alternative, so the product
    // is that octet's alternatives with the others fixed.
    let mut out = Vec::new();
    let boundary = per_octet
        .iter()
        .position(|alts| alts.len() > 1)
        .unwrap_or(0);
    for alt in &per_octet[boundary] {
        let parts: Vec<&str> = (0..4)
            .map(|i| {
                if i == boundary {
                    alt.as_str()
                } else {
                    per_octet[i][0].as_str()
                }
            })
            .collect();
        out.push(format!(
            "{AUTHORITY}{}\\.{}\\.{}\\.{}{HOST_END}",
            parts[0], parts[1], parts[2], parts[3]
        ));
    }
    out
}

/// Decimal patterns (digits and `[a-b]` classes, no alternation) whose union is
/// exactly the integers `lo..=hi` (0–255), with no leading-zero spellings.
pub(super) fn octet_patterns(lo: u32, hi: u32) -> Vec<String> {
    if lo > hi {
        return Vec::new();
    }
    if lo == hi {
        return vec![lo.to_string()];
    }
    let digits = |n: u32| n.to_string().len() as u32;
    if digits(lo) != digits(hi) {
        // Split at the digit-count boundary (9|10, 99|100) and solve each side.
        let cut = 10u32.pow(digits(lo)) - 1;
        let mut out = octet_patterns(lo, cut);
        out.extend(octet_patterns(cut + 1, hi));
        return out;
    }
    let class = |a: u32, b: u32| {
        if a == b {
            a.to_string()
        } else {
            format!("[{a}-{b}]")
        }
    };
    if digits(lo) == 1 {
        return vec![class(lo, hi)];
    }
    let (lo_head, lo_last) = (lo / 10, lo % 10);
    let (hi_head, hi_last) = (hi / 10, hi % 10);
    if lo_head == hi_head {
        return vec![format!("{lo_head}{}", class(lo_last, hi_last))];
    }
    let mut out = Vec::new();
    let mut start = lo_head;
    let mut end = hi_head;
    if lo_last != 0 {
        out.push(format!("{lo_head}{}", class(lo_last, 9)));
        start += 1;
    }
    if hi_last != 9 {
        end -= 1;
    }
    for head in octet_patterns(start, end) {
        out.push(format!("{head}[0-9]"));
    }
    if hi_last != 9 {
        out.push(format!("{hi_head}{}", class(0, hi_last)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every value in 0..=255 is matched by exactly the patterns of the range
    /// that contains it — checked exhaustively for every (lo, hi) pair.
    #[test]
    fn octet_patterns_cover_exactly_the_range() {
        for lo in 0..=255u32 {
            for hi in lo..=255u32 {
                let regexes: Vec<regex::Regex> = octet_patterns(lo, hi)
                    .iter()
                    .map(|p| regex::Regex::new(&format!("^{p}$")).unwrap())
                    .collect();
                for v in 0..=255u32 {
                    let matched = regexes.iter().any(|r| r.is_match(&v.to_string()));
                    assert_eq!(matched, (lo..=hi).contains(&v), "[{lo},{hi}] vs {v}");
                }
            }
        }
    }

    #[test]
    fn a_slash_12_becomes_three_filters_on_the_second_octet() {
        let filters = dotted_filters(0xac10_0000, 12);
        assert_eq!(filters.len(), 3);
        assert!(filters.iter().any(|f| f.contains("172\\.1[6-9]\\.")));
        assert!(filters.iter().any(|f| f.contains("172\\.2[0-9]\\.")));
        assert!(filters.iter().any(|f| f.contains("172\\.3[0-1]\\.")));
    }

    #[test]
    fn whole_octet_prefixes_are_literal_and_the_rest_open() {
        assert_eq!(dotted_filters(0x0a00_0000, 8).len(), 1);
        assert!(dotted_filters(0xc000_0200, 24)[0].contains("192\\.0\\.2\\.[0-9]+"));
    }
}
