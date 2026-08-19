// WI-N1.3 — AI navigation policy: strict URL and private-network rejection
use super::*;

#[test]
fn accepts_public_http_urls_and_returns_trimmed_value() {
    assert_eq!(
        validate_ai_navigation_url("  https://Example.com/path  ", false),
        Ok("https://Example.com/path".to_string())
    );
}

#[test]
fn rejects_unsupported_schemes_and_userinfo() {
    for url in [
        "file:///etc/passwd",
        "data:text/html,hello",
        "javascript:alert(1)",
        "https://user:password@example.com/",
        "https://example.com\\@127.0.0.1/",
    ] {
        assert_eq!(
            validate_ai_navigation_url(url, false),
            Err(AiUrlError::Blocked)
        );
    }
}

// Audit 20260803 §6 — "you may not go there" and "that is not a URL" are two
// different answers. Every rejection used to be `Blocked`, which the command
// layer turned into `permission-denied` + `SSRF_BLOCKED`: an empty string, a
// typo, or a truncated paste was reported to the user (and to the AI client)
// as a SECURITY refusal. It made the real refusals harder to see and told the
// caller that fixing its argument could not help.
#[test]
fn an_unusable_url_is_invalid_input_not_a_policy_refusal() {
    for url in [
        "",
        "   ",
        "https://",
        "http://",
        "https://:8080/",
        "https:// example.com/",
        "https://exa mple.com/",
        "https://[not-an-ipv6/",
    ] {
        assert_eq!(
            validate_ai_navigation_url(url, false),
            Err(AiUrlError::Invalid),
            "{url:?} is malformed, not refused"
        );
    }
}

#[test]
fn a_reachable_but_forbidden_destination_stays_a_policy_refusal() {
    // The other side of the split: these parse perfectly. Misclassifying one of
    // THESE as invalid input would be the dangerous direction — the frontend
    // would invite the caller to "fix" a URL that policy will never allow.
    for url in [
        "http://127.0.0.1/",
        "http://169.254.169.254/",
        "https://metadata.google.internal/",
        "https://printer.local/",
        "file:///etc/passwd",
        "https://user:password@example.com/",
    ] {
        assert_eq!(
            validate_ai_navigation_url(url, false),
            Err(AiUrlError::Blocked),
            "{url}"
        );
    }
}

#[test]
fn rejects_loopback_and_private_literal_addresses() {
    for url in [
        "http://127.0.0.1/",
        "http://127.1/",
        "http://2130706433/",
        "http://0x7f000001/",
        "http://0177.0.0.1/",
        "http://localhost/",
        "http://[::1]/",
        "http://10.0.0.1/",
        "http://172.16.0.1/",
        "http://192.168.1.1/",
        "http://169.254.169.254/",
        "http://[fd00::1]/",
        "http://[fe80::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://192.0.2.1/",
        "http://198.18.0.1/",
        "http://[2001:db8::1]/",
    ] {
        assert_eq!(
            validate_ai_navigation_url(url, false),
            Err(AiUrlError::Blocked),
            "{url}"
        );
    }
}

// WI-NB3.2 — transition/translation prefixes that EMBED an IPv4 address, and
// the deprecated ranges NeoBrowser's guard covered while this one did not
// (prior-art report 20260819 §B8). Each embedded-v4 spelling of a private
// address must be exactly as blocked as the address it embeds.
#[test]
fn rejects_ipv6_disguises_of_private_ipv4_addresses() {
    for url in [
        // 6to4: 2002:<v4>::/16 — 2002:7f00:0001 embeds 127.0.0.1; c0a8:0101 is 192.168.1.1.
        "http://[2002:7f00:1::1]/",
        "http://[2002:c0a8:101::1]/",
        "http://[2002:a9fe:a9fe::1]/", // 169.254.169.254
        // NAT64 well-known prefix 64:ff9b::/96 — last 32 bits are the v4.
        "http://[64:ff9b::127.0.0.1]/",
        "http://[64:ff9b::7f00:1]/",
        "http://[64:ff9b::c0a8:101]/",
        // Deprecated IPv4-COMPATIBLE (::a.b.c.d) — ::7f00:1 is 127.0.0.1.
        "http://[::127.0.0.1]/",
        "http://[::c0a8:101]/",
        // Deprecated site-local fec0::/10.
        "http://[fec0::1]/",
        "http://[feff::1]/",
    ] {
        assert_eq!(
            validate_ai_navigation_url(url, false),
            Err(AiUrlError::Blocked),
            "{url}"
        );
    }
}

#[test]
fn public_addresses_inside_transition_prefixes_stay_navigable() {
    // 6to4/NAT64 embedding a PUBLIC v4 is ordinary reachability, not a dodge:
    // 2002:0102:0304 embeds 1.2.3.4; the NAT64 form embeds 8.8.8.8.
    assert!(validate_ai_navigation_url("http://[2002:102:304::1]/", false).is_ok());
    assert!(validate_ai_navigation_url("http://[64:ff9b::8.8.8.8]/", false).is_ok());
}

#[test]
fn loopback_opt_in_covers_its_disguises_but_nothing_else() {
    // With loopback allowed, the loopback DISGUISES follow (same address), but
    // private ranges inside the same prefixes stay blocked.
    assert!(validate_ai_navigation_url("http://[64:ff9b::127.0.0.1]/", true).is_ok());
    assert!(validate_ai_navigation_url("http://[::127.0.0.1]/", true).is_ok());
    assert!(validate_ai_navigation_url("http://[2002:7f00:1::1]/", true).is_ok());
    assert_eq!(
        validate_ai_navigation_url("http://[64:ff9b::c0a8:101]/", true),
        Err(AiUrlError::Blocked)
    );
    assert_eq!(
        validate_ai_navigation_url("http://[fec0::1]/", true),
        Err(AiUrlError::Blocked)
    );
}

#[test]
fn loopback_can_be_explicitly_enabled_without_opening_private_ranges() {
    assert!(validate_ai_navigation_url("http://127.0.0.1:8080/", true).is_ok());
    assert!(validate_ai_navigation_url("http://localhost:3000/", true).is_ok());
    assert!(validate_ai_navigation_url("http://app.localhost:3000/", true).is_ok());
    assert_eq!(
        validate_ai_navigation_url("http://192.168.1.1/", true),
        Err(AiUrlError::Blocked)
    );
}

#[test]
fn rejects_metadata_and_special_hostnames() {
    for host in [
        "metadata.google.internal",
        "metadata",
        "instance-data",
        "LOCALHOST.",
        "app.localhost",
    ] {
        let url = format!("https://{host}/");
        assert_eq!(
            validate_ai_navigation_url(&url, false),
            Err(AiUrlError::Blocked)
        );
    }
}

// WI-1.7 — LAN-facing name suffixes. The IP-literal blocks never fire for these:
// they are `Host::Domain`, so the private-range checks are simply not reached and
// the request leaves the machine to whatever mDNS/DNS returns. Blocking them by
// NAME is the only place this can be caught before WebKit resolves.
//
// Deliberately NOT gated behind `allow_loopback`. That toggle means "my own
// machine"; `.local` and `home.arpa` resolve to LAN PEERS — routers, NAS boxes,
// printers, other people's laptops. Folding them into a loopback opt-in would
// silently widen it from one host to an entire network.
#[test]
fn rejects_lan_facing_name_suffixes_regardless_of_loopback_opt_in() {
    for host in [
        "printer.local",
        "NAS.LOCAL",
        "router.home.arpa",
        "db.internal",
        "instance.compute.internal",
        "foo.bar.internal",
    ] {
        let url = format!("https://{host}/");
        for allow_loopback in [false, true] {
            assert_eq!(
                validate_ai_navigation_url(&url, allow_loopback),
                Err(AiUrlError::Blocked),
                "{host} must be blocked with allow_loopback={allow_loopback}"
            );
        }
    }
}

#[test]
fn public_hostnames_that_merely_contain_the_suffixes_are_still_allowed() {
    // The block is on the SUFFIX, not a substring: `notlocal.com` and
    // `internal.example.com` are ordinary public names and must still work, or the
    // fix would break real navigation.
    for host in [
        "notlocal.com",
        "local.example.com",
        "internal.example.com",
        "myinternal.com",
        "home.arpa.example.com",
    ] {
        let url = format!("https://{host}/");
        assert!(
            validate_ai_navigation_url(&url, false).is_ok(),
            "{host} must remain navigable"
        );
    }
}
