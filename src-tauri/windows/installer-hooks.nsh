; VMark NSIS installer hooks.
;
; Four sections below. Sections 1 and 2 are uninstall repairs and run from
; NSIS_HOOK_POSTUNINSTALL, which Tauri inserts at the END of the uninstall
; section — after the APP_UNASSOCIATE loop that undoes the file associations.
; That ordering is what makes a repair possible; see
; crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi (the unassociate
; loop, then the hook a few dozen lines later). Section 3 runs from
; NSIS_HOOK_POSTINSTALL, after the install's APP_ASSOCIATE loop. Section 4 runs
; from NSIS_HOOK_PREINSTALL and NSIS_HOOK_PREUNINSTALL, before any file moves.
;
; ---------------------------------------------------------------------------
; 1. Re-create HKCR\.txt\ShellNew — issue #1142
; ---------------------------------------------------------------------------
;
; VMark registers a ".txt" file association (see fileAssociations in
; tauri.conf.json). Windows' NSIS uninstaller cleanup for that association
; removes HKEY_CLASSES_ROOT\.txt\ShellNew — a key that belongs to Windows, not
; VMark. That key (with its "NullFile" value) is what drives the
; "New > Text Document" entry in the desktop/Explorer right-click menu for EVERY
; application, so uninstalling VMark silently broke it system-wide.
;
; We keep the ".txt" association and repair the damage here instead: this
; POSTUNINSTALL hook runs AFTER Tauri's association cleanup and re-creates the
; OS-default ShellNew template. NullFile="" is exactly what Windows ships.
;
; VERIFIED on Windows for the first time on 2026-09-09, against v0.9.67:
; cycle 2 of the release-smoke Windows job deletes ShellNew from BOTH hives
; before uninstalling, so its presence afterwards can only mean this write
; landed — and it was present. Run 34313339017,
; "after uninstall (cycle 2): restored by the POSTUNINSTALL hook".
;
; That closes the caveat this header carried from the day it was written: the
; hook was authored on a macOS-primary machine and, until that run, had never
; executed on Windows at all. The v0.9.66 run could not reach cycle 2 — it
; failed in cycle 1 on the separate defect below.
;
; ---------------------------------------------------------------------------
; 2. Drop the empty ProgID the association cleanup leaves behind
; ---------------------------------------------------------------------------
;
; Found by the release-smoke Windows job on v0.9.66, its first ever run:
;
;     HKCR\.txt (default) before: 'txtfile'
;     uninstall changed the .txt association: 'txtfile' -> ''
;
; Tauri's macros back up the previous ProgID by reading from the SAME hive they
; write to (FileAssociation.nsh):
;
;     APP_ASSOCIATE:    ReadRegStr  $R0 SHELL_CONTEXT "Software\Classes\.txt" ""
;                       WriteRegStr     SHELL_CONTEXT "Software\Classes\.txt" "txt_backup" "$R0"
;     APP_UNASSOCIATE:  ReadRegStr  $R0 SHELL_CONTEXT "Software\Classes\.txt" "txt_backup"
;                       WriteRegStr     SHELL_CONTEXT "Software\Classes\.txt" "" "$R0"
;
; VMark installs per-user, so SHELL_CONTEXT is HKCU — but the machine-wide
; "txtfile" association lives in HKLM. The backup therefore records "", and the
; uninstaller writes that empty string back UNCONDITIONALLY. HKEY_CLASSES_ROOT
; is a merged view in which HKCU wins, so an empty default value sitting in HKCU
; SHADOWS the real HKLM one: after uninstalling VMark, .txt had no ProgID.
;
; A per-machine install does not have the bug — there the backup reads the hive
; the value actually lives in and restores it correctly. The defect is specific
; to the per-user mode VMark ships.
;
; Deleting the value (rather than writing HKLM's ProgID into HKCU) is what
; restores the previous state, and the same run proves the fall-through works:
; after the install, HKCU\Software\Classes\.txt existed and had no ShellNew
; subkey, yet "after install: HKCR\.txt\ShellNew\NullFile present" still passed
; — so HKCR merges per ENTRY, and an entry absent from HKCU resolves to HKLM.
; Writing a copied ProgID instead would leave a stale duplicate behind that no
; later uninstall owns.
;
; Only an EMPTY default is removed. A non-empty one means either the restore
; genuinely worked (per-machine install) or another application has since
; claimed the extension; in both cases the value is not ours to touch. The
; "<ext>_backup" value is deliberately LEFT in place: Tauri derives the file
; class from the bare extension when a fileAssociation declares no "name", so
; that value name is not unique to VMark and deleting it could break another
; Tauri app's own restore. It is inert — with no default value present, the
; merged view falls through to HKLM regardless.
;
; Both hives are repaired because SHCTX is not reliable at this point: the
; uninstall section runs "SetShellVarContext current" a few lines before the
; hook when the user ticks "delete application data". Repairing both is
; idempotent and cannot lose information — an empty default carries none.
;
; This must cover EVERY extension in tauri.conf.json's fileAssociations, not
; just .txt: .html, .htm, .svg and .json all commonly have machine-wide
; handlers to shadow. scripts/release-smoke-windows-installer.test.mjs reads
; that list and fails if an extension is missing from the macro below, so a new
; association cannot silently reintroduce this.

!macro VMARK_UNSHADOW_ASSOCIATION EXT
  Push $R0

  ReadRegStr $R0 HKCU "Software\Classes\.${EXT}" ""
  ${If} $R0 == ""
    DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
  ${EndIf}

  ReadRegStr $R0 HKLM "Software\Classes\.${EXT}" ""
  ${If} $R0 == ""
    DeleteRegValue HKLM "Software\Classes\.${EXT}" ""
  ${EndIf}

  Pop $R0
!macroend

; ---------------------------------------------------------------------------
; 3. Do not displace an extension's existing handler — issue #1378
; ---------------------------------------------------------------------------
;
; Measured on a clean Windows runner against the published v0.9.68 installer,
; by the release-smoke job's post-install diagnostic:
;
;     install claimed .txt  : 'txtfile'  -> 'txt'
;     install claimed .svg  : 'svgfile'  -> 'svg'
;     install claimed .html : 'htmlfile' -> 'html'
;     install claimed .htm  : 'htmlfile' -> 'htm'
;
; `APP_ASSOCIATE` writes `Software\Classes\.<ext>` unconditionally, so simply
; declaring an extension in `fileAssociations` takes the default away from
; whatever owned it. For the markdown extensions nothing owned them and that is
; the desired outcome; for these four it means installing a markdown editor
; silently displaced Notepad and the browser.
;
; The user-visible symptom in #1378 was the right-click "New > 文本文档" entry
; changing. That entry is built from `HKCR\.txt\ShellNew`, which still exists —
; what changed is its LABEL, which comes from the friendly name of the ProgID
; the extension points at. So the report's "ShellNew was deleted" is not what
; happened; the association takeover is.
;
; The rule here is a CONDITION, not a list: yield wherever HKLM already names a
; handler. That keeps VMark the default for `.md` and friends, which nothing
; else claims, while leaving a machine that has its own handler for `.json`
; alone too — without this file having to predict which those are.
;
; Yielding the default is not the same as becoming unavailable. `OpenWithProgids`
; is the documented way to stay in the Open With list, so VMark remains one
; choice for these types; it is simply no longer the one Windows picks without
; being asked. A user who does want VMark as the default can still say so, and
; their choice is recorded in `FileExts\.<ext>\UserChoice`, which outranks
; everything here.
;
; Runs from POSTINSTALL, which tauri-bundler inserts at the END of the install
; section — after the APP_ASSOCIATE loop. That ordering is what makes the
; repair possible, exactly as POSTUNINSTALL's ordering is below.

!macro VMARK_YIELD_EXISTING_HANDLER EXT
  Push $R0

  ReadRegStr $R0 HKLM "Software\Classes\.${EXT}" ""
  ${If} $R0 != ""
    ; Something already owns this type machine-wide. Keep VMark reachable
    ; through Open With, then hand the default back by deleting the value
    ; APP_ASSOCIATE just wrote into HKCU — HKCR then resolves to HKLM again.
    WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${EXT}" ""
    DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
  ${EndIf}

  Pop $R0
!macroend

; ---------------------------------------------------------------------------
; 4. Release the MCP sidecar's file lock before touching it — issue #1648
; ---------------------------------------------------------------------------
;
; Tauri's installer only checks that the MAIN binary is running. The MCP
; sidecar (`vmark-mcp-server.exe`, see externalBin in tauri.conf.json) is a
; separate process: an AI client such as Claude Desktop or Cursor spawns it, and
; it can outlive a VMark that was closed or killed. Windows will not overwrite
; or delete a running executable, so the installer's `File` instruction failed
; with NSIS's built-in English "Can't write" Abort/Retry/Ignore box. Abort ends
; in "Installation Aborted" even though the main program had already been
; replaced — an upgrade that looks failed and is half done.
;
; That dialog is NSIS's own and cannot be localised or reworded from a hook, so
; the fix makes it unreachable: PREINSTALL and PREUNINSTALL stop the sidecar
; first. Force-killing it is safe — it holds no state of its own, and the AI
; client that owns it respawns it on the next tool call. `/IM` matches by image
; name, run from $SYSDIR so a planted taskkill.exe beside the installer is never
; picked up.
;
; taskkill exits 128 when no such process exists, which is the normal case. Any
; other non-zero code (an elevated copy refusing the kill) aborts BEFORE this
; installer writes any file, with a message that names the component, instead of
; a half-applied upgrade. The one case it cannot fully cover: when the user picks
; "uninstall first" on the reinstall page, Tauri runs the PREVIOUSLY installed
; uninstaller before any hook here fires, and releases before this hook have no
; kill of their own. That uninstaller's Delete of the locked sidecar is
; non-fatal, so the usual outcome is fine; only if this kill then also fails is
; the old version already gone, which is why the message does not claim that
; nothing was changed. Tauri exposes no earlier hook point. The short Sleep gives Windows time to drop
; the image's file handle before the next instruction writes it.
;
; Known limitation: `/IM` matches by image name, so a development or second
; install's sidecar running as the same user is stopped too. Targeting by path
; needs wmic (removed from current Windows) or PowerShell; the sidecar is
; stateless and respawned by its client, so the trade is accepted.
; scripts/installer-hooks-sidecar.test.mjs pins this contract.

!macro VMARK_STOP_SIDECAR
  Push $R0

  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM vmark-mcp-server.exe'
  Pop $R0

  ; 0 = killed, 128 = no such process. Anything else (access denied for an
  ; elevated copy, taskkill failing to launch) means the file is still locked:
  ; stop here, before any file is replaced, rather than half-upgrade.
  ${If} $R0 != 0
  ${AndIf} $R0 != 128
    MessageBox MB_OK|MB_ICONSTOP \
      "VMark could not stop its MCP server (vmark-mcp-server.exe), so the installer cannot replace it.$\r$\n$\r$\nSetup stopped before updating it. Close the AI app that started it (for example Claude Desktop or Cursor) or end vmark-mcp-server.exe in Task Manager, then run Setup again." \
      /SD IDOK
    Pop $R0
    Abort
  ${EndIf}

  Sleep 500

  Pop $R0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro VMARK_STOP_SIDECAR
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro VMARK_STOP_SIDECAR
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Keep in sync with fileAssociations in src-tauri/tauri.conf.json.
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "md"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "markdown"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "mdown"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "mkd"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "mdx"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "txt"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "json"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "jsonl"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "yaml"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "yml"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "toml"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "mmd"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "svg"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "html"
  !insertmacro VMARK_YIELD_EXISTING_HANDLER "htm"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  WriteRegStr HKCR ".txt\ShellNew" "NullFile" ""

  ; Keep in sync with fileAssociations in src-tauri/tauri.conf.json.
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "md"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "markdown"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "mdown"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "mkd"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "mdx"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "txt"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "json"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "jsonl"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "yaml"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "yml"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "toml"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "mmd"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "svg"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "html"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "htm"
!macroend
