// WI-PDF2.1 (prerequisite) — the outcome sink's two guarantees.
//
// The sink exists because Windows and Linux cannot produce a result before the
// UI closure must return (ADR-PDF6), so the outcome is settled from a native
// callback later. That makes two properties load-bearing that a synchronous
// return never needed.

use super::*;

fn sink_with_temp() -> (
    Arc<RenderSink>,
    PathBuf,
    oneshot::Receiver<Result<(), CommandError>>,
) {
    let dir = std::env::temp_dir();
    // A UNIQUE path per call. Keying on `process::id()` alone gave all four
    // tests ONE path: each passed alone and they raced when run together,
    // because one test's settle/Drop removed the file another had just
    // written. Passing-in-isolation is the worst way for a test to be wrong.
    let path = dir.join(format!(
        "vmark-sink-test-{}-{}.html",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&path, b"<p>x</p>").expect("write temp");
    let (tx, rx) = oneshot::channel();
    (RenderSink::new(tx, path.clone()), path, rx)
}

#[tokio::test]
async fn settling_delivers_the_result_and_removes_the_temp_file() {
    let (sink, path, rx) = sink_with_temp();
    assert!(path.exists(), "precondition: temp file written");

    sink.settle(Ok(()));

    assert!(rx.await.expect("sender alive").is_ok());
    assert!(!path.exists(), "the sink owns the temp file and drops it");
}

#[tokio::test]
async fn a_second_settle_is_ignored_rather_than_panicking() {
    // A platform that both returns an error AND fires its callback would
    // otherwise double-send. The first outcome must win.
    let (sink, _path, rx) = sink_with_temp();

    sink.settle(Err(CommandError::internal("first")));
    sink.settle(Ok(())); // must not panic, must not overwrite

    let err = rx
        .await
        .expect("sender alive")
        .expect_err("first outcome wins");
    assert_eq!(err.message(), "first");
}

#[tokio::test]
async fn dropping_without_settling_reports_immediately_instead_of_hanging() {
    // The case this guards: a native callback that is released without ever
    // firing. Without the Drop guard the caller waits out the entire timeout
    // for a result that can never arrive.
    let (sink, path, rx) = sink_with_temp();

    drop(sink);

    let err = rx.await.expect("sender alive").expect_err("abandoned");
    assert_eq!(err.code(), ErrorCode::Internal);
    assert_eq!(err.i18n_key(), Some("errors.pdf.abandoned"));
    assert!(
        !path.exists(),
        "the temp file is dropped on abandonment too"
    );
}

#[tokio::test]
async fn dropping_after_settling_does_not_overwrite_the_outcome() {
    let (sink, _path, rx) = sink_with_temp();
    sink.settle(Ok(()));
    drop(sink);
    assert!(
        rx.await.expect("sender alive").is_ok(),
        "the real outcome survives the drop"
    );
}
