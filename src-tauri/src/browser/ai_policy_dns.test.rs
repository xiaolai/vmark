// Audit 20260903 round 4 (#7 / #8) — resolved-address pre-flight for AI
// navigations. The URL-text policy passes a public-looking name whose DNS answer
// is loopback, LAN or metadata; this module refuses it BEFORE the navigation is
// issued, and refuses CLOSED when the name cannot be resolved inside the bound.
use super::*;
use std::cell::RefCell;
use std::net::IpAddr;
use std::thread;
use std::time::{Duration, Instant};

fn ip(text: &str) -> IpAddr {
    text.parse()
        .unwrap_or_else(|_| panic!("{text} is not an IP address"))
}

fn refused(host: &str, reason: PreflightReason) -> DestinationRefused {
    DestinationRefused {
        host: host.to_string(),
        reason,
    }
}

/// Answers every name with one fixed set and records the names it was asked.
struct Answers {
    addrs: Vec<IpAddr>,
    asked: RefCell<Vec<String>>,
}

impl Answers {
    fn of(addrs: &[&str]) -> Self {
        Self {
            addrs: addrs.iter().map(|a| ip(a)).collect(),
            asked: RefCell::new(Vec::new()),
        }
    }
}

impl DestinationResolver for Answers {
    fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, ResolveFailure> {
        self.asked.borrow_mut().push(host.to_string());
        Ok(self.addrs.clone())
    }
}

/// Fails the way the OS resolver can.
struct Failing(ResolveFailure);

impl DestinationResolver for Failing {
    fn resolve(&self, _host: &str) -> Result<Vec<IpAddr>, ResolveFailure> {
        Err(self.0.clone())
    }
}

/// A resolver the test asserts is never consulted.
struct NeverCalled;

impl DestinationResolver for NeverCalled {
    fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, ResolveFailure> {
        panic!("the resolver was consulted for {host}");
    }
}

const PUBLIC_NAME: &str = "https://public.example/path?q=1";

// ------------------------------------------------------ preflight_destination

#[test]
fn an_ip_literal_host_skips_resolution_the_address_policy_already_judged_it() {
    // Every literal spelling `validate_ai_navigation_url` understands — the ones
    // it REFUSES included — is skipped here: the pre-flight runs after that
    // validator, so a literal that reached it has already been judged, and
    // resolving one would only ask the OS to echo it back.
    for url in [
        "http://93.184.216.34/",
        "http://[2001:4860:4860::8888]/",
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://2130706433/",
        "http://0x7f.1/",
        "http://[::ffff:10.0.0.1]/",
    ] {
        assert_eq!(
            preflight_destination(&NeverCalled, url, false),
            Ok(()),
            "{url}"
        );
    }
}

#[test]
fn a_name_answering_only_public_addresses_is_allowed() {
    let resolver = Answers::of(&["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
    assert_eq!(preflight_destination(&resolver, PUBLIC_NAME, false), Ok(()));
    assert_eq!(*resolver.asked.borrow(), vec!["public.example".to_string()]);
}

#[test]
fn one_private_record_among_public_ones_refuses() {
    // A resolver may hand back several records and the connection may use ANY of
    // them; a single private address in the set is the whole attack.
    let resolver = Answers::of(&[
        "93.184.216.34",
        "10.0.0.5",
        "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    assert_eq!(
        preflight_destination(&resolver, PUBLIC_NAME, false),
        Err(refused("public.example", PreflightReason::ResolvesPrivate))
    );
}

#[test]
fn every_blocked_address_family_refuses_under_the_default_posture() {
    for addr in [
        // Loopback.
        "127.0.0.1",
        "::1",
        // RFC 1918.
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        // Link-local, including the cloud metadata address.
        "169.254.169.254",
        "fe80::1",
        // Shared address space; unspecified / "this" network.
        "100.64.0.1",
        "0.0.0.0",
        "::",
        // Embedded IPv4: mapped, 6to4, NAT64.
        "::ffff:10.0.0.1",
        "2002:0a00:0001::",
        "64:ff9b::a00:1",
        // Unique-local, site-local, multicast.
        "fd00::1",
        "fec0::1",
        "224.0.0.1",
        "ff02::1",
        // Documentation, benchmarking, TEST-NET.
        "2001:db8::1",
        "198.18.0.1",
        "203.0.113.9",
    ] {
        let resolver = Answers::of(&[addr]);
        assert_eq!(
            preflight_destination(&resolver, PUBLIC_NAME, false),
            Err(refused("public.example", PreflightReason::ResolvesPrivate)),
            "{addr}"
        );
    }
}

#[test]
fn loopback_answers_follow_the_allow_loopback_posture_and_lan_answers_do_not() {
    for addr in ["127.0.0.1", "::1"] {
        let resolver = Answers::of(&[addr]);
        assert_eq!(
            preflight_destination(&resolver, PUBLIC_NAME, false),
            Err(refused("public.example", PreflightReason::ResolvesPrivate)),
            "{addr}"
        );
        assert_eq!(
            preflight_destination(&resolver, PUBLIC_NAME, true),
            Ok(()),
            "{addr}"
        );
    }
    // "My own machine" never widens to the LAN.
    let resolver = Answers::of(&["127.0.0.1", "192.168.1.20"]);
    assert_eq!(
        preflight_destination(&resolver, PUBLIC_NAME, true),
        Err(refused("public.example", PreflightReason::ResolvesPrivate))
    );
}

#[test]
fn an_empty_answer_refuses_as_unresolved() {
    let resolver = Answers::of(&[]);
    assert_eq!(
        preflight_destination(&resolver, PUBLIC_NAME, true),
        Err(refused("public.example", PreflightReason::Unresolved))
    );
}

#[test]
fn a_resolver_failure_refuses_as_unresolved_never_allows() {
    for failure in [
        ResolveFailure::Timeout,
        ResolveFailure::Lookup("nodename nor servname provided".into()),
    ] {
        let resolver = Failing(failure.clone());
        assert_eq!(
            preflight_destination(&resolver, PUBLIC_NAME, true),
            Err(refused("public.example", PreflightReason::Unresolved)),
            "{failure:?}"
        );
    }
}

#[test]
fn a_url_without_a_host_is_refused_rather_than_skipped() {
    for url in ["", "   ", "not a url", "https://", "https://:8080/"] {
        let outcome = preflight_destination(&NeverCalled, url, true);
        assert_eq!(
            outcome.map_err(|r| r.reason),
            Err(PreflightReason::Unresolved),
            "{url:?}"
        );
    }
}

#[test]
fn the_host_is_normalized_before_the_resolver_and_the_refusal_see_it() {
    let resolver = Answers::of(&["10.0.0.5"]);
    assert_eq!(
        preflight_destination(&resolver, "  https://Public.Example.:8443/x  ", false),
        Err(refused("public.example", PreflightReason::ResolvesPrivate))
    );
    assert_eq!(*resolver.asked.borrow(), vec!["public.example".to_string()]);
}

// --------------------------------------------------------- destination_allowed

#[test]
fn destination_allowed_fails_closed_on_an_empty_answer_and_on_any_blocked_address() {
    let public = ip("93.184.216.34");
    assert!(
        !destination_allowed(&[], true),
        "no answer is not permission"
    );
    assert!(destination_allowed(&[public], false));
    assert!(!destination_allowed(&[public, ip("10.0.0.5")], false));
    assert!(!destination_allowed(&[ip("127.0.0.1")], false));
    assert!(destination_allowed(&[ip("127.0.0.1")], true));
    assert!(!destination_allowed(&[ip("::ffff:169.254.169.254")], true));
}

#[test]
fn reason_tokens_are_the_wire_vocabulary() {
    assert_eq!(
        PreflightReason::ResolvesPrivate.as_str(),
        "resolves-private"
    );
    assert_eq!(PreflightReason::Unresolved.as_str(), "unresolved");
}

// ------------------------------------------------------------- bounded_lookup

#[test]
fn a_prompt_answer_comes_back_through_the_bounded_wait() {
    let answer = bounded_lookup(Duration::from_secs(5), || Ok(vec![ip("93.184.216.34")]));
    assert_eq!(answer, Ok(vec![ip("93.184.216.34")]));
}

#[test]
fn a_hung_lookup_expires_at_the_bound_instead_of_blocking_the_caller() {
    let started = Instant::now();
    let answer: Result<Vec<IpAddr>, ResolveFailure> =
        bounded_lookup(Duration::from_millis(50), || {
            thread::sleep(Duration::from_millis(600));
            Ok(vec![ip("93.184.216.34")])
        });
    assert_eq!(answer, Err(ResolveFailure::Timeout));
    assert!(
        started.elapsed() < Duration::from_millis(500),
        "the caller waited for the bound, not for the lookup: {:?}",
        started.elapsed()
    );
}

#[test]
fn a_lookup_that_panics_refuses_rather_than_allowing() {
    let answer: Result<Vec<IpAddr>, ResolveFailure> =
        bounded_lookup(Duration::from_secs(5), || {
            panic!("deliberate: a dead resolver thread must refuse, never allow");
        });
    assert!(
        matches!(answer, Err(ResolveFailure::Lookup(_))),
        "{answer:?}"
    );
}

// ------------------------------------------------------------ SystemResolver

#[test]
fn localhost_resolves_offline_and_follows_the_loopback_posture() {
    // `localhost` comes from the hosts file on every platform — no network — so
    // the REAL resolver is exercised end to end.
    let resolver = SystemResolver::default();
    assert_eq!(
        preflight_destination(&resolver, "http://localhost:3000/", false),
        Err(refused("localhost", PreflightReason::ResolvesPrivate))
    );
    assert_eq!(
        preflight_destination(&resolver, "http://localhost:3000/", true),
        Ok(())
    );
}

#[test]
fn the_system_resolver_returns_each_address_once() {
    let addrs = resolve_destination("localhost", RESOLVE_TIMEOUT)
        .expect("localhost resolves from the hosts file");
    assert!(!addrs.is_empty());
    assert!(addrs.iter().all(|a| a.is_loopback()), "{addrs:?}");
    let mut deduped = addrs.clone();
    deduped.sort();
    deduped.dedup();
    assert_eq!(deduped.len(), addrs.len(), "duplicates: {addrs:?}");
}
