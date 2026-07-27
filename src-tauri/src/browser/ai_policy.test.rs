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
