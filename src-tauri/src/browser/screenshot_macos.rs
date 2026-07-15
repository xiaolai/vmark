//! Native screenshot capture for the browser surface (WI-P1.1, macOS).
//!
//! Included via `#[path]` from surface_macos.rs; `super::` is that module.
//!
//! `takeSnapshot` (SPIKE-5: 14 ms on the embedded webview) captures the LIVE
//! rendered view. It reads no page JS or DOM, so — unlike `eval` — it needs no
//! isolated world and touches no page state. The resulting `NSImage` is encoded
//! NSImage → JPEG (bounded quality, to cap the base64 payload handed to the
//! model) → base64. The authoritative auth gate
//! (`commands_auth::browser_screenshot`) runs BEFORE this is ever called;
//! nothing here re-decides authorization.

use base64::Engine as _;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage,
    NSImageCompressionFactor,
};
use objc2_foundation::{NSData, NSDictionary, NSError, NSNumber, NSRunLoop};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;
use tauri::AppHandle;

/// JPEG quality for captures — bounded well below 1.0 so a full-page retina
/// snapshot does not balloon the base64 payload the model receives.
const JPEG_QUALITY: f64 = 0.7;

/// Encoded JPEG bytes, or a stable reason string. Shared between the async
/// completion handler and the pumping caller.
type CaptureResult = Result<Vec<u8>, String>;

/// Capture the tab's current rendering as a base64-encoded JPEG.
///
/// The capture is asynchronous (a completion handler), so the run loop is pumped
/// until it fires, exactly as `eval_js` does. A tab whose native view is gone
/// yields `no webview`; a snapshot that fails or produces no image yields a
/// stable reason string rather than a panic.
pub fn screenshot(app: &AppHandle, tab_id: String) -> Result<String, String> {
    super::on_main(app, move |_mtm| {
        let webview = super::WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;

        let out: Rc<RefCell<Option<CaptureResult>>> = Rc::new(RefCell::new(None));
        let sink = out.clone();
        let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            *sink.borrow_mut() = Some(encode_snapshot(image, error));
        });
        // A `None` configuration captures the whole view (SPIKE-5).
        unsafe { webview.takeSnapshotWithConfiguration_completionHandler(None, &handler) };

        let run_loop = NSRunLoop::mainRunLoop();
        super::pump_until(&run_loop, Duration::from_secs(10), 0.02, || {
            out.borrow().is_some()
        });

        let bytes = out
            .borrow_mut()
            .take()
            .ok_or_else(|| "SCREENSHOT_TIMEOUT".to_string())??;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
}

/// Convert the snapshot `NSImage` to bounded-quality JPEG bytes, or a stable
/// reason string. Runs inside the completion handler on the main thread. The
/// block does not own the image, so it is borrowed, never released here.
fn encode_snapshot(image: *mut NSImage, error: *mut NSError) -> CaptureResult {
    if !error.is_null() {
        return Err("SNAPSHOT_FAILED".into());
    }
    if image.is_null() {
        return Err("SNAPSHOT_EMPTY".into());
    }
    let image: &NSImage = unsafe { &*image };
    let tiff = image.TIFFRepresentation().ok_or("SNAPSHOT_NO_TIFF")?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("SNAPSHOT_NO_BITMAP")?;

    // JPEG with an explicit compression factor: { NSImageCompressionFactor: 0.7 }.
    let factor: Retained<NSNumber> = NSNumber::numberWithDouble(JPEG_QUALITY);
    let key: &NSBitmapImageRepPropertyKey = unsafe { NSImageCompressionFactor };
    let value: &AnyObject = factor.as_ref();
    let props: Retained<NSDictionary<NSBitmapImageRepPropertyKey, AnyObject>> =
        NSDictionary::from_slices(&[key], &[value]);

    let jpeg: Retained<NSData> =
        unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::JPEG, &props) }
            .ok_or("SNAPSHOT_ENCODE_FAILED")?;
    Ok(jpeg.to_vec())
}
