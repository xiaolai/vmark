//! One-shot Windows code blocks owned by an existing internal PTY session.
//! Source is a temporary script; its guard follows the PTY's teardown path.
//! @module pty/code_block
use crate::command_error::CommandError;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Manager;
#[path = "code_block_encoding.rs"]
mod encoding;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CodeShell {
    PowerShell,
    Cmd,
    Python, // A PowerShell host retains the terminal when Python finishes.
}

#[derive(Deserialize)]
pub struct CodeBlockRequest {
    shell: CodeShell,
    source: String,
}

impl CodeShell {
    fn executable(self) -> &'static str {
        match self {
            Self::PowerShell | Self::Python => "powershell.exe",
            Self::Cmd => "cmd.exe",
        }
    }
    fn command(self) -> String {
        match self {
            Self::PowerShell => {
                ". ([scriptblock]::Create([IO.File]::ReadAllText($env:VMARK_CODE_BLOCK_SCRIPT)))\r".into()
            }
            Self::Cmd => format!("chcp {} >nul\r\"%VMARK_CODE_BLOCK_SCRIPT%\"\r", encoding::cmd_code_page()),
            Self::Python => concat!(
                "& { $env:PYTHONIOENCODING = 'utf-8'; ",
                "$p = Join-Path $PWD '.venv/Scripts/python.exe'; ",
                "if (Test-Path -LiteralPath $p -PathType Leaf) { & $p $env:VMARK_CODE_BLOCK_SCRIPT } ",
                "elseif ($p = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue) ",
                "{ & ($p.Source) -3 $env:VMARK_CODE_BLOCK_SCRIPT } else { ",
                "$p = Get-Command python.exe -All -CommandType Application -ErrorAction SilentlyContinue ",
                "| Where-Object { $_.Source -notlike '*\\Microsoft\\WindowsApps\\*' } | Select-Object -First 1; ",
                "if (!$p) { throw [IO.FileNotFoundException]::new('python.exe') }; ",
                "& ($p.Source) $env:VMARK_CODE_BLOCK_SCRIPT } }\r"
            ).into(),
        }
    }
}

impl CodeBlockRequest {
    fn reuse_command(&self, host: &str, script: &std::path::Path) -> Result<String, CommandError> {
        let path = script.to_string_lossy().replace('\'', "''");
        let source = match self.shell {
            CodeShell::Cmd => format!(
                "& {{ $previous = $env:VMARK_CODE_BLOCK_SCRIPT; try {{ $env:VMARK_CODE_BLOCK_SCRIPT = '{path}'; & $env:ComSpec /d /c 'chcp {} >nul & \"%VMARK_CODE_BLOCK_SCRIPT%\"' }} finally {{ $env:VMARK_CODE_BLOCK_SCRIPT = $previous }} }}",
                encoding::cmd_code_page()
            ),
            _ => self.shell.command().trim_end_matches('\r').replace("$env:VMARK_CODE_BLOCK_SCRIPT", &format!("'{path}'")),
        };
        let source = format!("try {{ {source} }} finally {{ [IO.File]::Delete('{path}') }}");
        let name = std::path::Path::new(host)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        match name.as_str() {
            "powershell.exe" | "pwsh.exe" => Ok(format!("{source}\r")),
            "cmd.exe" => {
                let root = std::env::var_os("SystemRoot")
                    .ok_or_else(|| CommandError::not_found("SystemRoot is missing"))?;
                let powershell = std::path::PathBuf::from(root)
                    .join("System32/WindowsPowerShell/v1.0/powershell.exe");
                let bytes: Vec<u8> = source.encode_utf16().flat_map(u16::to_le_bytes).collect();
                let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                Ok(format!(
                    "\"{}\" -NoLogo -NoProfile -EncodedCommand {encoded}\r",
                    powershell.display()
                ))
            }
            _ => Err(CommandError::unsupported(
                "Code-block reuse requires PowerShell or CMD",
            )),
        }
    }

    fn prepare(&self, file: &str) -> Result<tempfile::TempPath, CommandError> {
        if !cfg!(target_os = "windows") {
            return Err(CommandError::unsupported(
                "Windows code blocks require Windows",
            ));
        }
        let name = std::path::Path::new(file)
            .file_name()
            .and_then(|name| name.to_str());
        if !name.is_some_and(|name| name.eq_ignore_ascii_case(self.shell.executable())) {
            return Err(CommandError::invalid_input(
                "Code block interpreter does not match its language",
            ));
        }
        let bytes = self.script_bytes()?;
        let suffix = match self.shell {
            CodeShell::PowerShell => ".ps1",
            CodeShell::Cmd => ".cmd",
            CodeShell::Python => ".py",
        };
        let mut file = tempfile::Builder::new()
            .prefix("vmark-code-")
            .suffix(suffix)
            .tempfile()
            .map_err(|error| CommandError::from_io(&error, "Cannot create code-block script"))?;
        file.write_all(&bytes)
            .map_err(|error| CommandError::from_io(&error, "Cannot write code-block script"))?;
        Ok(file.into_temp_path())
    }
    fn script_bytes(&self) -> Result<Vec<u8>, CommandError> {
        if self.source.trim().is_empty()
            || self.source.len() > 1024 * 1024
            || self.source.contains('\0')
        {
            return Err(CommandError::invalid_input(
                "Code block is empty, contains NUL, or exceeds 1 MiB",
            ));
        }
        Ok(match self.shell {
            CodeShell::PowerShell => [b"\xef\xbb\xbf".as_slice(), self.source.as_bytes()].concat(),
            CodeShell::Python => self.source.as_bytes().to_vec(),
            CodeShell::Cmd => encoding::encode_cmd(&format!(
                "@echo off\r\n{}\r\n",
                self.source
                    .replace("\r\n", "\n")
                    .replace('\r', "\n")
                    .replace('\n', "\r\n")
            ))?,
        })
    }
}

#[derive(Serialize)]
pub struct CodeBlockSpawn {
    pid: u32,
    command: String,
}

/// Spawn through the same vetted shell policy and session registry as a normal PTY.
#[tauri::command]
pub async fn pty_spawn_code_block(
    file: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    code_block: CodeBlockRequest,
    window: tauri::Window,
) -> Result<CodeBlockSpawn, CommandError> {
    let owner = window.label().to_string();
    let command_line = code_block.shell.command();
    let session = tokio::task::spawn_blocking(move || {
        let command = super::spawn_policy::vet(
            super::spawn_policy::ShellSource::system(),
            file.clone(),
            Vec::new(),
            env,
            |_| Ok(Vec::new()),
        )?;
        let script = code_block.prepare(&file)?;
        super::session::create_session_with_script(
            owner,
            command,
            cols,
            rows,
            cwd.as_deref(),
            Some(script),
        )
        .map_err(super::pty_io)
    })
    .await
    .map_err(|error| super::pty_internal("Code-block PTY spawn task failed", error))??;
    let state = window.state::<super::PtyState>();
    let pid = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().await.insert(pid, Arc::new(session));
    Ok(CodeBlockSpawn {
        pid,
        command: command_line,
    })
}

fn run_in_session(
    session: &super::session::Session,
    code_block: CodeBlockRequest,
) -> Result<(), CommandError> {
    let script = code_block.prepare(code_block.shell.executable())?;
    let command = code_block.reuse_command(&session.shell_file, &script)?;
    {
        let mut scripts = session
            .code_block_scripts
            .lock()
            .map_err(|error| super::pty_internal("Code-block script lock failed", error))?;
        if session.shutdown.load(Ordering::Acquire) {
            return Err(CommandError::not_found("Terminal was closed"));
        }
        scripts.retain(|path| path.exists());
        scripts.push(script);
    }
    super::input::write_input(session, command.as_bytes(), super::input::STALL_LIMIT)
        .map_err(super::pty_io)
}

/// Run in an existing window-owned PTY without replacing its shell or output.
#[tauri::command]
pub async fn pty_run_code_block(
    pid: u32,
    code_block: CodeBlockRequest,
    window: tauri::Window,
) -> Result<(), CommandError> {
    let state = window.state::<super::PtyState>();
    let session = super::session::get_session(&state, pid)
        .await
        .map_err(|_| super::session_gone(pid))?;
    if session.owner != window.label() {
        return Err(CommandError::invalid_input(
            "Terminal belongs to another window",
        ));
    }
    tokio::task::spawn_blocking(move || run_in_session(&session, code_block))
        .await
        .map_err(|error| super::pty_internal("Code-block execution failed", error))?
}

#[cfg(test)]
#[path = "code_block.test.rs"]
mod tests;
