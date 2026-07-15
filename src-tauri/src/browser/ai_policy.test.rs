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
        assert_eq!(validate_ai_navigation_url(url, false), Err(AiUrlError::Blocked));
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
        assert_eq!(validate_ai_navigation_url(url, false), Err(AiUrlError::Blocked), "{url}");
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
    for host in ["metadata.google.internal", "metadata", "instance-data", "LOCALHOST.", "app.localhost"] {
        let url = format!("https://{host}/");
        assert_eq!(validate_ai_navigation_url(&url, false), Err(AiUrlError::Blocked));
    }
}
