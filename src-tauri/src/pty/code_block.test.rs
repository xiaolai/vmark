// WI-WCR2 — scripts execute through an INTERNAL PTY and share its lifetime.
use super::*;

#[test]
fn source_validation_and_encoding() {
    let python: CodeBlockRequest =
        serde_json::from_str(r#"{"shell":"python","source":"print('hello')"}"#).unwrap();
    assert_eq!(python.script_bytes().unwrap(), b"print('hello')");
    let powershell = CodeBlockRequest {
        shell: CodeShell::PowerShell,
        source: "中文 😀".into(),
    };
    assert_eq!(
        powershell.script_bytes().unwrap(),
        [b"\xef\xbb\xbf".as_slice(), "中文 😀".as_bytes()].concat()
    );
    if encoding::cmd_code_page() != 65001 {
        assert!(encoding::encode_cmd("echo \u{10ffff}").is_err());
    }
    for source in ["", " \r\n", "echo\0hidden"] {
        assert!(CodeBlockRequest {
            shell: CodeShell::Cmd,
            source: source.into()
        }
        .script_bytes()
        .is_err());
    }
    assert!(CodeBlockRequest {
        shell: CodeShell::Cmd,
        source: "x".repeat(1024 * 1024 + 1)
    }
    .script_bytes()
    .is_err());
    let source = "echo test\r\n^\nnext";
    let bytes = CodeBlockRequest {
        shell: CodeShell::Cmd,
        source: source.into(),
    }
    .script_bytes()
    .unwrap();
    assert_eq!(
        String::from_utf8(bytes).unwrap(),
        "@echo off\r\necho test\r\n^\r\nnext\r\n"
    );
}

#[cfg(target_os = "windows")]
#[test]
fn internal_pty_runs_both_interpreters_and_cleans_scripts() {
    assert_interpreters(&[CodeShell::PowerShell, CodeShell::Cmd]);
}

#[cfg(target_os = "windows")]
#[test]
#[ignore = "requires an installed Python runtime"]
fn internal_python_runs_and_cleans_script() {
    assert_interpreters(&[CodeShell::Python]);
}

#[cfg(target_os = "windows")]
fn assert_interpreters(shells: &[CodeShell]) {
    use std::time::{Duration, Instant};
    let dir = tempfile::Builder::new()
        .prefix("中文 notes & (100%)")
        .tempdir()
        .unwrap();
    let root = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32");
    for &shell in shells {
        let marker = dir.path().join("cmd-internal-ok.txt");
        let marker_text = marker.to_string_lossy();
        let (file, source) = match shell {
            CodeShell::PowerShell => (
                root.join("WindowsPowerShell")
                    .join("v1.0")
                    .join("powershell.exe"),
                format!(
                    "Write-Output '中文'\n[IO.File]::WriteAllText('{}', 'done 中文')",
                    marker_text.replace('\'', "''")
                ),
            ),
            CodeShell::Cmd => (
                root.join("cmd.exe"),
                if encoding::encode_cmd("中文").is_ok() {
                    "title VMARK-Internal-CMD\necho CMD: 中文与多行命令验证\n> \"cmd-internal-ok.txt\" echo done\ncd".into()
                } else {
                    "echo CMD\n> \"cmd-internal-ok.txt\" echo done\ncd".into()
                },
            ),
            CodeShell::Python => (
                root.join("WindowsPowerShell").join("v1.0").join("powershell.exe"),
                format!("from pathlib import Path\nprint('Python 中文')\nPath({:?}).write_text('done 中文', encoding='utf-8')", marker_text),
            ),
        };
        let file = file.to_string_lossy().into_owned();
        let request = CodeBlockRequest { shell, source };
        let script = request.prepare(&file).unwrap();
        let script_path = script.to_path_buf();
        let command = super::super::spawn_policy::vet(
            super::super::spawn_policy::ShellSource::system(),
            file,
            Vec::new(),
            BTreeMap::new(),
            |_| Ok(Vec::new()),
        )
        .unwrap();
        let session = Arc::new(
            super::super::session::create_session_with_script(
                "code-block-test".into(),
                command,
                100,
                30,
                dir.path().to_str(),
                Some(script),
            )
            .unwrap(),
        );
        let output = Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = Arc::clone(&output);
        assert!(session
            .start_reader("code-block-reader".into(), move |session, mut source| {
                let mut buf = [0u8; 4096];
                while let Ok(super::super::output::Chunk::Data(n)) = source.read(&mut buf) {
                    captured.lock().unwrap().extend_from_slice(&buf[..n]);
                    // ConPTY asks the terminal for its cursor before starting the shell.
                    // xterm answers this in the app; the native harness must do so too.
                    if buf[..n].windows(4).any(|bytes| bytes == b"\x1b[6n") {
                        session
                            .writer
                            .lock()
                            .unwrap()
                            .write_all(b"\x1b[1;1R")
                            .unwrap();
                    }
                }
            })
            .is_ok());
        session
            .writer
            .lock()
            .unwrap()
            .write_all(shell.command().as_bytes())
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        while !marker.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(25));
        }
        let mut reused_paths = Vec::new();
        for (index, language) in [CodeShell::PowerShell, CodeShell::Cmd]
            .into_iter()
            .enumerate()
        {
            let reuse_marker = dir.path().join(format!("reuse-{index}.txt"));
            let source = if matches!(language, CodeShell::Cmd) {
                format!("> \"reuse-{index}.txt\" echo reused")
            } else {
                format!(
                    "[IO.File]::WriteAllText('{}', 'reused')",
                    reuse_marker.to_string_lossy().replace('\'', "''")
                )
            };
            let request = CodeBlockRequest {
                shell: language,
                source,
            };
            run_in_session(&session, request).unwrap();
            reused_paths.extend(
                session
                    .code_block_scripts
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|path| path.to_path_buf()),
            );
            let current_script = reused_paths.last().unwrap();
            let deadline = Instant::now() + Duration::from_secs(20);
            while (!reuse_marker.exists() || current_script.exists()) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(25));
            }
            assert!(
                reuse_marker.exists(),
                "Reuse failed: {}",
                String::from_utf8_lossy(&output.lock().unwrap())
            );
            assert_eq!(
                std::fs::read_to_string(reuse_marker).unwrap().trim(),
                "reused"
            );
            assert!(
                !current_script.exists(),
                "Completed Run retained its script"
            );
        }
        super::super::session::terminate(&[session]);
        assert!(
            marker.exists(),
            "{} did not execute its code block: {}",
            shell.executable(),
            String::from_utf8_lossy(&output.lock().unwrap())
        );
        assert!(std::fs::read_to_string(&marker).unwrap().contains("done"));
        let expected = if matches!(shell, CodeShell::Cmd) && encoding::encode_cmd("中文").is_err()
        {
            "CMD"
        } else {
            "中文"
        };
        assert!(String::from_utf8_lossy(&output.lock().unwrap()).contains(expected));
        assert!(!script_path.exists(), "PTY teardown retained its script");
        assert!(
            reused_paths.iter().all(|path| !path.exists()),
            "PTY teardown retained reused scripts"
        );
        std::fs::remove_file(&marker).unwrap();
    }
}
