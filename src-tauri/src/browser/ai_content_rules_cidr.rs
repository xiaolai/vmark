//! Dotted-decimal url-filters for a CIDR range, derived rather than hand-written.
//!
//! WebKit's url-filter dialect has no alternation, so one CIDR becomes SEVERAL
//! filters: the whole octets before the boundary are literal, the boundary octet
//! is decomposed into decimal character classes (`1[6-9]`, `2[0-9]`, `3[0-1]` for
//! 16–31), and every octet after it is `[0-9]+`. Deriving these from
//! `BLOCKED_IPV4_RANGES` is what makes the rule list and the navigation policy
//! ONE table: a range added to the policy is blocked for subresources too, with no
//! second list to forget (audit 2026-09-03 round 2, #6).
//!
//! The digit-class decomposition (`range_patterns`) is radix-generic: decimal for
//! an IPv4 octet, hex for the 16-bit group of an IPv6 literal
//! (`ai_content_rules_cidr6.rs`, round 3 #9).

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

/// Decimal patterns whose union is exactly the integers `lo..=hi` (0–255), with
/// no leading-zero spellings.
pub(super) fn octet_patterns(lo: u32, hi: u32) -> Vec<String> {
    range_patterns(lo, hi, 10)
}

/// Lowercase-hex patterns whose union is exactly the integers `lo..=hi`
/// (0–ffff), with no leading-zero spellings — a 16-bit IPv6 group as WebKit
/// serialises it.
pub(super) fn hex_patterns(lo: u32, hi: u32) -> Vec<String> {
    range_patterns(lo, hi, 16)
}

/// `n` in `radix`, lowercase, no leading zeros.
fn spell(mut n: u32, radix: u32) -> String {
    if n == 0 {
        return "0".into();
    }
    let mut digits = Vec::new();
    while n > 0 {
        digits.push(char::from_digit(n % radix, radix).expect("a digit below the radix"));
        n /= radix;
    }
    digits.iter().rev().collect()
}

/// A character class for the digits `a..=b` in `radix`. A hex class must not
/// straddle `9`→`a` as one code-point range — `[3-c]` is `3-9`, `:;<=>?@`, `A-Z`,
/// `[\]^_\``, `a-c`, not the digits 3–c — so it is split at the letter boundary.
fn digit_class(a: u32, b: u32, radix: u32) -> String {
    let digit = |n: u32| char::from_digit(n, radix).expect("a digit below the radix");
    if a == b {
        return digit(a).to_string();
    }
    if b <= 9 || a >= 10 {
        format!("[{}-{}]", digit(a), digit(b))
    } else {
        format!("[{}-9a-{}]", digit(a), digit(b))
    }
}

/// Patterns (digits and `[a-b]` classes, no alternation) whose union is exactly
/// the integers `lo..=hi` written in `radix` without leading zeros.
fn range_patterns(lo: u32, hi: u32, radix: u32) -> Vec<String> {
    if lo > hi {
        return Vec::new();
    }
    if lo == hi {
        return vec![spell(lo, radix)];
    }
    let digits = |n: u32| spell(n, radix).len() as u32;
    if digits(lo) != digits(hi) {
        // Split at the digit-count boundary (9|10, 99|100; f|10, ff|100) and solve
        // each side.
        let cut = radix.pow(digits(lo)) - 1;
        let mut out = range_patterns(lo, cut, radix);
        out.extend(range_patterns(cut + 1, hi, radix));
        return out;
    }
    let class = |a: u32, b: u32| digit_class(a, b, radix);
    if digits(lo) == 1 {
        return vec![class(lo, hi)];
    }
    let (lo_head, lo_last) = (lo / radix, lo % radix);
    let (hi_head, hi_last) = (hi / radix, hi % radix);
    if lo_head == hi_head {
        return vec![format!(
            "{}{}",
            spell(lo_head, radix),
            class(lo_last, hi_last)
        )];
    }
    let top = radix - 1;
    let mut out = Vec::new();
    let mut start = lo_head;
    let mut end = hi_head;
    if lo_last != 0 {
        out.push(format!("{}{}", spell(lo_head, radix), class(lo_last, top)));
        start += 1;
    }
    if hi_last != top {
        end -= 1;
    }
    for head in range_patterns(start, end, radix) {
        out.push(format!("{head}{}", class(0, top)));
    }
    if hi_last != top {
        out.push(format!("{}{}", spell(hi_head, radix), class(0, hi_last)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn covers_exactly(
        patterns: &[String],
        lo: u32,
        hi: u32,
        radix: u32,
        values: impl Iterator<Item = u32>,
    ) {
        let regexes: Vec<regex::Regex> = patterns
            .iter()
            .map(|p| regex::Regex::new(&format!("^{p}$")).unwrap())
            .collect();
        for v in values {
            let spelled = spell(v, radix);
            let matched = regexes.iter().any(|r| r.is_match(&spelled));
            assert_eq!(
                matched,
                (lo..=hi).contains(&v),
                "[{lo},{hi}] radix {radix} vs {v}"
            );
        }
    }

    /// Every value in 0..=255 is matched by exactly the patterns of the range
    /// that contains it — checked exhaustively for every (lo, hi) pair.
    #[test]
    fn octet_patterns_cover_exactly_the_range() {
        for lo in 0..=255u32 {
            for hi in lo..=255u32 {
                covers_exactly(&octet_patterns(lo, hi), lo, hi, 10, 0..=255u32);
            }
        }
    }

    /// The hex twin: exhaustive over every pair below 0x100, and over every pair
    /// of the 16-bit values the policy table actually cuts at plus a spread of
    /// wide ranges, each checked against the values around both edges.
    #[test]
    fn hex_patterns_cover_exactly_the_range() {
        for lo in 0..=0xffu32 {
            for hi in lo..=0xffu32 {
                covers_exactly(&hex_patterns(lo, hi), lo, hi, 16, 0..=0x1ffu32);
            }
        }
        let wide = [
            (0xfc00, 0xfdff),
            (0xfe80, 0xfebf),
            (0xfec0, 0xfeff),
            (0xff00, 0xffff),
            (0x0010, 0x001f),
            (0x0000, 0xffff),
            (0x0001, 0xfffe),
            (0x00ff, 0x0100),
            (0x0fff, 0x1000),
            (0x1234, 0xabcd),
            (0x0a00, 0x0aff),
        ];
        for &(lo, hi) in &wide {
            let around = |edge: u32| edge.saturating_sub(3)..=(edge + 3).min(0xffff);
            let values = around(lo)
                .chain(around(hi))
                .chain((0..=0xffffu32).step_by(97));
            covers_exactly(&hex_patterns(lo, hi), lo, hi, 16, values);
        }
    }

    #[test]
    fn hex_classes_never_straddle_the_letter_boundary() {
        // `[3-c]` would admit `:;<=>?@A-Z[\]^_\`` — split at 9|a instead.
        assert_eq!(digit_class(3, 0xc, 16), "[3-9a-c]");
        assert_eq!(digit_class(0, 0xf, 16), "[0-9a-f]");
        assert_eq!(digit_class(0xa, 0xf, 16), "[a-f]");
        assert_eq!(digit_class(2, 9, 16), "[2-9]");
        assert_eq!(digit_class(7, 7, 16), "7");
        assert_eq!(hex_patterns(0xfe80, 0xfebf), vec!["fe[8-9a-b][0-9a-f]"]);
        assert_eq!(hex_patterns(0x10, 0x1f), vec!["1[0-9a-f]"]);
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
