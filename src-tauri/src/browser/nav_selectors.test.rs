// WI-S0.11 — every selector we declare for a WebKit delegate protocol must actually BE in
// that protocol.
//
// This test exists because of a bug that shipped. `expire_authority` (R7a) was wired to a
// callback named `webView:didSameDocumentNavigation:` so that an SPA rewriting its DOM via
// pushState would expire the AI's one-shot authority. That selector does not exist. The
// public WKNavigationDelegate protocol has NO same-document method — WebKit's is the
// private three-part `_webView:navigation:didSameDocumentNavigation:`.
//
// Nothing caught it. `define_class!` registers whatever method name you hand it; the
// compiler is happy, the app builds, clippy is silent, and the runtime simply never calls
// the method. A security control that is decoration is worse than none, because it reads
// as done. Correctness here is a property of the ObjC runtime, not of the Rust types — so
// this test asks the runtime.
//
// It reads THIS delegate's own source, so it cannot drift: add a method to a delegate impl
// block and it is checked, with no list to remember to update.
use objc2::runtime::{AnyProtocol, Bool, Sel};
use std::ffi::{c_char, c_void, CString};

#[repr(C)]
struct ObjCMethodDescription {
    name: *const c_void, // SEL — null when the protocol has no such method
    types: *const c_char,
}

unsafe extern "C" {
    fn protocol_getMethodDescription(
        proto: *const AnyProtocol,
        sel: Sel,
        is_required_method: Bool,
        is_instance_method: Bool,
    ) -> ObjCMethodDescription;
}

/// Is `selector` a member of `protocol` — required OR optional?
fn protocol_has(protocol: &str, selector: &str) -> bool {
    let proto_name = CString::new(protocol).unwrap();
    let proto = AnyProtocol::get(&proto_name)
        .unwrap_or_else(|| panic!("no such ObjC protocol: {protocol}"));
    let sel = Sel::register(&CString::new(selector).unwrap());
    // Delegate methods are overwhelmingly optional, so both tables must be consulted.
    [true, false].into_iter().any(|required| {
        // SAFETY: `proto` is a live protocol and `sel` a registered selector.
        let desc =
            unsafe { protocol_getMethodDescription(proto, sel, Bool::new(required), Bool::YES) };
        !desc.name.is_null()
    })
}

/// Pull `(protocol, selector)` pairs out of the `unsafe impl <Protocol> for NavDelegate`
/// blocks — i.e. exactly the methods we are asserting WebKit will call.
///
/// Inherent `impl NavDelegate` blocks are deliberately skipped: `observeValueForKeyPath:`
/// is an NSObject method we OVERRIDE, not a protocol method we implement.
fn declared_protocol_selectors(src: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    let mut protocol: Option<String> = None;
    let mut depth = 0usize;
    for line in src.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("unsafe impl ") {
            if let Some(name) = rest.split_whitespace().next() {
                if name.starts_with("WK") {
                    protocol = Some(name.to_string());
                    depth = 0;
                }
            }
        }
        if protocol.is_some() {
            depth += trimmed.matches('{').count();
            depth = depth.saturating_sub(trimmed.matches('}').count());
            if depth == 0 && trimmed.contains('}') {
                protocol = None;
            }
        }
        let (Some(proto), Some(sel)) = (
            protocol.as_ref(),
            trimmed
                .strip_prefix("#[unsafe(method(")
                .and_then(|r| r.strip_suffix("))]")),
        ) else {
            continue;
        };
        found.push((proto.clone(), sel.to_string()));
    }
    found
}

#[test]
fn every_declared_delegate_selector_exists_in_its_protocol() {
    let declared = declared_protocol_selectors(include_str!("nav_delegate_macos.rs"));
    assert!(
        declared.len() >= 8,
        "parsed only {} selectors — the parser has drifted from the source, and a test that \
         checks nothing passes silently",
        declared.len()
    );
    for (protocol, selector) in declared {
        assert!(
            protocol_has(&protocol, &selector),
            "`{selector}` is not a method of `{protocol}`. define_class! will register it \
             anyway and the runtime will never call it — so whatever it does is dead code. \
             Check the real protocol; if the callback you want is WebKit SPI, it is not \
             available and you need a different mechanism (see nav_kvo_macos.rs)."
        );
    }
}

// The bug itself, nailed down: the selector that shipped is not real, and the private one
// WebKit actually uses is not in the public protocol either. If a future objc2/SDK ever
// promoted a same-document callback to the public protocol, this test would fail and tell
// us we can drop the KVO observer.
#[test]
fn there_is_no_public_same_document_navigation_callback() {
    assert!(
        !protocol_has("WKNavigationDelegate", "webView:didSameDocumentNavigation:"),
        "this selector was invented; it must never be reintroduced"
    );
    assert!(
        !protocol_has(
            "WKNavigationDelegate",
            "_webView:navigation:didSameDocumentNavigation:"
        ),
        "WebKit's same-document callback is SPI, not part of the public protocol"
    );
}
