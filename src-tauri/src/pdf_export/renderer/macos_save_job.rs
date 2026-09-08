//! The save-to-file half of `NSPrintOperation`, with its NATIVE completion.
//!
//! Purpose: `print_to_pdf` used to infer that the PDF was done by watching the
//! output file's size stop changing for ~700 ms, and after its deadline it
//! accepted any non-empty file as success (#213, #214). A slow or paused
//! writer could pass the first test with a truncated file and the second
//! accepted exactly the file the loop had just failed to prove complete.
//! AppKit reports completion: `runOperationModalForWindow:delegate:
//! didRunSelector:contextInfo:` sends `printOperationDidRun:success:
//! contextInfo:` when the job ends — `macos_print.test.rs` measured that it
//! fires for a WKWebView save job — so this waits for THAT, and then checks
//! that what was written is a PDF.
//!
//! The delegate keeps itself alive until the callback, exactly as the sheet
//! delegate in `macos_print.rs` does: a wait that gives up must not free an
//! object AppKit will still message. It also carries the OUTPUT PATH, because
//! a wait that gives up is not a cancellation — `NSPrintOperation` has no
//! cancel — so the job goes on writing a file the command has already
//! disowned. The late callback removes it (#425); the alternative is a
//! `*.vmark-staging-*.pdf` left beside the user's document.
//!
//! @coordinates-with macos_ops.rs — the only caller
//! @coordinates-with macos_print.rs — the sheet's delegate, the same pattern
//! @module pdf_export/renderer/macos_save_job

use core::ffi::c_void;
use std::cell::Cell;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol};
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSPrintOperation, NSWindow};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

use super::macos::run_loop_tick;
use super::staging::remove_temp;

/// How long the run loop is ticked for the operation to report. The overall
/// export has its own 180 s bound in `mod.rs`; this is the part spent inside
/// the print pipeline, and a job still running after it is reported as a
/// timeout — never as "probably done" (#214).
const SAVE_JOB_WAIT: Duration = Duration::from_secs(60);

pub(super) struct SaveJobIvars {
    /// The `success` flag AppKit sent, once it has.
    done: Cell<Option<bool>>,
    self_retain: Cell<Option<Retained<SaveJobDelegate>>>,
    /// The wait gave up before the callback came (#425). Nothing will publish
    /// what the job goes on to write, and the sink has already removed the
    /// name it knew — so the late callback removes the file itself.
    abandoned: Cell<bool>,
    /// The file the job was asked to write, for exactly that removal.
    output: PathBuf,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = SaveJobIvars]
    pub(super) struct SaveJobDelegate;

    unsafe impl NSObjectProtocol for SaveJobDelegate {}

    impl SaveJobDelegate {
        #[unsafe(method(printOperationDidRun:success:contextInfo:))]
        fn print_operation_did_run(
            &self,
            _operation: &NSPrintOperation,
            success: bool,
            _context: *mut c_void,
        ) {
            self.ivars().done.set(Some(success));
            if self.ivars().abandoned.get() {
                // The staging file this wrote is one nobody asked for any
                // more: the command reported a timeout and moved on, and a
                // leftover `*.vmark-staging-*.pdf` beside the user's output
                // is litter with their document in it (#425).
                log::warn!(
                    "[PDF] print operation reported success={success} after the wait gave up; removing {}",
                    self.ivars().output.display()
                );
                remove_temp(&self.ivars().output);
            }
            if let Some(me) = self.ivars().self_retain.take() {
                let _ = Retained::autorelease_ptr(me);
            }
        }
    }
);

impl SaveJobDelegate {
    fn new(mtm: MainThreadMarker, output: PathBuf) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(SaveJobIvars {
            done: Cell::new(None),
            self_retain: Cell::new(None),
            abandoned: Cell::new(false),
            output,
        });
        // SAFETY: NSObject's init has the standard signature.
        let this: Retained<Self> = unsafe { msg_send![super(this), init] };
        this.ivars().self_retain.set(Some(this.clone()));
        this
    }
}

/// Run `print_op` modally for `window` and wait for AppKit to say the job
/// ended. `Ok(())` only when it reports success AND a PDF is at
/// `output_path`.
pub(super) fn run_save_job(
    mtm: MainThreadMarker,
    print_op: &NSPrintOperation,
    window: &NSWindow,
    output_path: &str,
) -> Result<(), CommandError> {
    let delegate = SaveJobDelegate::new(mtm, PathBuf::from(output_path));
    let delegate_obj: &AnyObject = &delegate;
    // Run the print operation modally for the hidden window. This is required
    // for WKWebView — plain runOperation() produces blank PDFs.
    // SAFETY: print_op and window are valid objects; the delegate implements
    // the selector with the signature AppKit sends and retains itself until
    // that callback runs. Called on the main thread (mtm).
    unsafe {
        print_op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            window,
            Some(delegate_obj),
            Some(sel!(printOperationDidRun:success:contextInfo:)),
            std::ptr::null_mut(),
        );
    }

    let start = Instant::now();
    let mut ticks = 0u32;
    while start.elapsed() < SAVE_JOB_WAIT {
        run_loop_tick(0.1);
        ticks += 1;
        if let Some(success) = delegate.ivars().done.get() {
            log::debug!(
                "[PDF] print operation reported success={success} after {:.2}s",
                start.elapsed().as_secs_f64()
            );
            return if success {
                verify_pdf(Path::new(output_path))
            } else {
                Err(localized_error!(ErrorCode::Io, "errors.pdf.printRefused"))
            };
        }
        if ticks.is_multiple_of(50) {
            log::debug!(
                "[PDF] print waiting... tick {ticks} ({:.2}s)",
                start.elapsed().as_secs_f64()
            );
        }
    }
    // Nothing cancels an NSPrintOperation, and the delegate must stay alive
    // for the callback AppKit will still send (see the header). Tell it the
    // wait is over, so the file it is still writing is removed on arrival
    // rather than left beside the user's output (#425). Safe to set here and
    // not racy: the callback only ever runs inside `run_loop_tick`, and the
    // loop above has just left one.
    delegate.ivars().abandoned.set(true);
    log::debug!(
        "[PDF] print operation TIMEOUT after {:.2}s",
        start.elapsed().as_secs_f64()
    );
    Err(localized_error!(
        ErrorCode::Timeout,
        "errors.pdf.printTimeout"
    ))
}

/// Remove whatever is at the output path before the job runs (#212). The
/// old `let _ = remove_file(..)` let a stale file that could not be removed
/// sit there and be reported as the export's result.
pub(super) fn clear_stale_output(output_path: &str) -> Result<(), CommandError> {
    match std::fs::remove_file(output_path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(localized_error!(
            ErrorCode::Io,
            "errors.pdf.staleOutputNotRemoved",
            detail = e.to_string()
        )),
    }
}

/// How far back from the end `%%EOF` is looked for. The spec puts it on the
/// LAST line; real readers scan a trailing window to find the cross-reference
/// table, and 1 KiB is the conventional one.
const PDF_TRAILER_WINDOW: u64 = 1024;

/// What the file at the output path is.
#[derive(Debug, PartialEq, Eq)]
enum PdfShape {
    /// Header and trailer both present: a complete document.
    Complete,
    /// Missing, or nothing in it.
    Empty,
    /// Something is there, but it is not a whole PDF.
    NotPdf,
}

/// The file the job was asked for is there and is a WHOLE PDF. An output that
/// is not — empty, something else, or a document that stops before its
/// trailer — is removed, so the caller cannot open it as the export.
///
/// The header alone was not verification (#434): `%PDF-` is five bytes, and a
/// print that died partway through writes them before it writes anything else.
/// `%%EOF` is what says the writer finished, and it is the same marker every
/// reader looks for; checking both is the strongest structural claim available
/// without a PDF parser, which this crate has no reason to carry.
pub(super) fn verify_pdf(output_path: &Path) -> Result<(), CommandError> {
    let shape = match pdf_shape(output_path) {
        Ok(shape) => shape,
        // The file could not be EXAMINED — a permission failure, a transient
        // I/O error, an unreadable mount. That is not "empty" (audit 20260907
        // #433): reporting it as such names a cause the code never observed,
        // and every such failure was folded into the same message before. The
        // file is deliberately NOT removed: nothing here knows whether it holds
        // the user's document, and a removal that cannot even open it would
        // fail anyway.
        Err(e) => {
            log::warn!(
                "[PDF] could not examine the output at {}: {e}",
                output_path.display()
            );
            return Err(localized_error!(
                ErrorCode::Io,
                "errors.pdf.outputUnreadable",
                detail = e.to_string()
            ));
        }
    };
    match shape {
        PdfShape::Complete => Ok(()),
        PdfShape::Empty => {
            log::debug!("[PDF] output missing or empty at {}", output_path.display());
            let _ = std::fs::remove_file(output_path);
            Err(localized_error!(ErrorCode::Io, "errors.pdf.emptyOutput"))
        }
        PdfShape::NotPdf => {
            log::warn!(
                "[PDF] output at {} is not a complete PDF",
                output_path.display()
            );
            let _ = std::fs::remove_file(output_path);
            Err(localized_error!(ErrorCode::Io, "errors.pdf.outputNotPdf"))
        }
    }
}

/// Read just enough of the file to classify it: the five header bytes, then
/// the trailing window.
///
/// `Err` means the file could not be EXAMINED and says nothing about its shape.
/// Every one of these used to collapse into `Empty` or `NotPdf` (audit 20260907
/// #433) — so a permission failure was reported as "produced empty PDF", and
/// `verify_pdf` then tried to delete a file it had not even been able to open.
/// A file that is genuinely absent is still `Empty`: that is the classification
/// this function's own doc comment promises.
fn pdf_shape(output_path: &Path) -> Result<PdfShape, std::io::Error> {
    use std::io::{Seek, SeekFrom};

    let mut file = match std::fs::File::open(output_path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(PdfShape::Empty),
        Err(e) => return Err(e),
    };
    let mut head = [0u8; 5];
    match file.read(&mut head) {
        Ok(0) => return Ok(PdfShape::Empty),
        Ok(read) if read < head.len() || head != *b"%PDF-" => return Ok(PdfShape::NotPdf),
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    let len = file.metadata()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(PDF_TRAILER_WINDOW)))?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail)?;
    Ok(if tail.windows(5).any(|w| w == b"%%EOF") {
        PdfShape::Complete
    } else {
        PdfShape::NotPdf
    })
}

#[cfg(test)]
#[path = "macos_save_job.test.rs"]
mod tests;
