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

// Audit 20260903 round 3, #9 — the v6 side is a table too. Every range refuses its
// edges through the one public entry point, and the neighbours just outside are
// judged by the tables alone (or, for an embedded-IPv4 spelling, by the v4 table).
#[test]
fn every_blocked_ipv6_range_refuses_its_edges_and_the_tables_alone_judge_the_rest() {
    use crate::browser::ai_policy_addr::{blocked_ipv6, BLOCKED_IPV6_RANGES};
    use std::net::Ipv6Addr;
    for &(network, prefix) in BLOCKED_IPV6_RANGES {
        let first = u128::from(network);
        // The host mask, `checked_shr` because a /128 shifts by the full width
        // (`u128::MAX >> 128` overflows rather than yielding 0).
        let last = first | u128::MAX.checked_shr(u32::from(prefix)).unwrap_or(0);
        for value in [first, last] {
            let url = format!("http://[{}]/", Ipv6Addr::from(value));
            assert_eq!(
                validate_ai_navigation_url(&url, false),
                Err(AiUrlError::Blocked),
                "{url}"
            );
            assert!(
                blocked_ipv6(Ipv6Addr::from(value), true),
                "{url} is not loopback"
            );
        }
    }
    // Ordinary public addresses are in no range.
    for public in [
        "2001:4860:4860::8888",
        "2600::",
        "2a00:1450:4001::1",
        "2001:db9::1",
        "2001:20::1",
        "fe00::1",
        "fb00::1",
    ] {
        let address: Ipv6Addr = public.parse().unwrap();
        assert!(!blocked_ipv6(address, false), "{public}");
        assert!(validate_ai_navigation_url(&format!("http://[{public}]/"), false).is_ok());
    }
    // Loopback is gated by the toggle, never by the table.
    assert!(blocked_ipv6(Ipv6Addr::LOCALHOST, false));
    assert!(!blocked_ipv6(Ipv6Addr::LOCALHOST, true));
}

// Audit 20260903 round 3, #21 — the pure half of the same-document decision, the
// KVO observer's question with the registry facts passed in.
#[test]
fn a_same_document_navigation_on_a_human_tab_needs_only_the_feature_on() {
    let on = AiBrowserPolicy {
        enabled: true,
        epoch: 9,
        ..AiBrowserPolicy::default()
    };
    // A human tab is not posture-bound and not destination-policed.
    assert!(same_document_allowed(
        AutomationMode::Human,
        &on,
        0,
        false,
        "http://10.0.0.1/x"
    ));
    assert!(!same_document_allowed(
        AutomationMode::Human,
        &AiBrowserPolicy::default(),
        0,
        false,
        "https://example.com/"
    ));
}

#[test]
fn a_same_document_navigation_on_an_ai_tab_needs_the_current_epoch_and_a_policy_pass() {
    let on = AiBrowserPolicy {
        enabled: true,
        epoch: 2,
        ..AiBrowserPolicy::default()
    };
    let sandbox = AutomationMode::AiSandbox;
    assert!(same_document_allowed(
        sandbox,
        &on,
        2,
        false,
        "https://example.com/app#route"
    ));
    assert!(
        !same_document_allowed(sandbox, &on, 1, false, "https://example.com/app#route"),
        "bound to an older posture"
    );
    assert!(
        !same_document_allowed(sandbox, &on, 2, false, "http://169.254.169.254/latest"),
        "a blocked destination"
    );
    let off = AiBrowserPolicy {
        enabled: false,
        ..on
    };
    assert!(!same_document_allowed(
        sandbox,
        &off,
        2,
        false,
        "https://example.com/"
    ));
}

#[test]
fn a_same_document_navigation_on_a_shared_tab_needs_the_approved_origin_too() {
    let on = AiBrowserPolicy {
        enabled: true,
        session: AiSessionMode::Shared,
        ..AiBrowserPolicy::default()
    };
    let shared = AutomationMode::AiShared;
    assert!(same_document_allowed(
        shared,
        &on,
        0,
        true,
        "https://example.com/x"
    ));
    assert!(
        !same_document_allowed(shared, &on, 0, false, "https://example.com/x"),
        "an origin the navigation was not approved for"
    );
    assert!(
        !same_document_allowed(shared, &on, 0, true, "http://[fe80::1]/"),
        "approval does not override the destination policy"
    );
    assert!(
        !same_document_allowed(shared, &on, 1, true, "https://example.com/x"),
        "an older posture epoch"
    );
}

// Audit 20260903 P-01 — a subframe on an AI-owned tab meets the same destination
// policy as the main frame; a human tab keeps today's behaviour.
#[test]
fn ai_owned_subframes_run_the_destination_policy() {
    let policy = AiBrowserPolicy {
        enabled: true,
        ..AiBrowserPolicy::default()
    };
    for mode in [AutomationMode::AiSandbox, AutomationMode::AiShared] {
        assert!(subframe_load_allowed(
            mode,
            &policy,
            "https://example.com/frame"
        ));
        for blocked in [
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/",
            "http://[::1]/",
            "http://localhost:3000/",
            "http://printer.local/",
            "file:///etc/passwd",
            "https://user:pw@example.com/",
        ] {
            assert!(
                !subframe_load_allowed(mode, &policy, blocked),
                "{mode:?} subframe to {blocked} must be refused"
            );
        }
    }
}

#[test]
fn human_subframes_are_untouched_by_the_policy() {
    let policy = AiBrowserPolicy::default(); // even disabled
    for url in [
        "http://10.0.0.1/",
        "http://localhost/",
        "https://example.com/",
    ] {
        assert!(subframe_load_allowed(AutomationMode::Human, &policy, url));
    }
}

#[test]
fn network_free_frames_stay_allowed_on_ai_tabs() {
    // about:blank / srcdoc / blob / data frames are how pages build portals and ad
    // slots; they reach no network, so refusing them breaks pages for nothing.
    let policy = AiBrowserPolicy {
        enabled: true,
        ..AiBrowserPolicy::default()
    };
    for url in [
        "about:blank",
        "about:srcdoc",
        "blob:https://example.com/3f2a",
        "data:text/html,<p>hi</p>",
        "ABOUT:BLANK",
    ] {
        assert!(
            subframe_load_allowed(AutomationMode::AiSandbox, &policy, url),
            "{url}"
        );
    }
    // javascript: and every other scheme still meet the validator.
    assert!(!subframe_load_allowed(
        AutomationMode::AiSandbox,
        &policy,
        "javascript:alert(1)"
    ));
}

#[test]
fn ai_subframes_honour_the_loopback_opt_in_and_a_disabled_browser() {
    let mut policy = AiBrowserPolicy {
        enabled: true,
        allow_loopback: true,
        ..AiBrowserPolicy::default()
    };
    assert!(subframe_load_allowed(
        AutomationMode::AiSandbox,
        &policy,
        "http://127.0.0.1:5173/"
    ));
    assert!(!subframe_load_allowed(
        AutomationMode::AiSandbox,
        &policy,
        "http://10.0.0.1/"
    ));
    policy.enabled = false;
    assert!(
        !subframe_load_allowed(AutomationMode::AiSandbox, &policy, "https://example.com/"),
        "a disabled browser grants an AI tab nothing, subframes included"
    );
}
