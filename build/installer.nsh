; electron-builder includes this file in the NSIS installer automatically
; (directories.buildResources/installer.nsh). Adapted from T3 Code's installer hook.
;
; After an in-app update, electron-builder's StartApp relaunches through
; StdUtils.ExecShellAsUser, which always drops elevation, so a PotPlayerChat that
; the user ran as administrator (to read an elevated PotPlayer) came back without
; it. The per-user installer inherits the elevation of the app that spawned it,
; so starting the app directly with Exec restores the level it had before the
; update, elevated or not. Exception: if electron-updater cannot spawn the
; installer and falls back to elevate.exe, the installer and therefore the app
; run elevated.
; customInstall is the last hook before StartApp; quitting here skips it and
; leaves only the installer's own success exit.
!macro customInstall
  ${if} ${isUpdated}
  ${andIf} ${isForceRun}
    HideWindow
    ; Exec starts in $OUTDIR. The app resolves its bundled regedit scripts
    ; relative to the working directory, as the shortcuts' start-in folder does.
    SetOutPath "$INSTDIR"
    Exec '"$appExe"'
    !insertmacro quitSuccess
  ${endIf}
!macroend
