; Custom finish page for Sorvia BotSwarm.
; Uses the STANDARD MUI finish page with two checkboxes (reliable — no nsDialogs):
;   - "Launch Sorvia BotSwarm"        (MUI_FINISHPAGE_RUN)
;   - "Create a desktop shortcut"     (MUI_FINISHPAGE_SHOWREADME, repurposed)
; The helper functions are defined INSIDE the macro so they only exist in the
; installer (avoids "function not referenced" warnings in the uninstaller).

!macro customFinishPage
  Function SorviaRunApp
    ExecShell "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  FunctionEnd

  Function SorviaMakeDesktopShortcut
    CreateShortcut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Sorvia BotSwarm"
  !define MUI_FINISHPAGE_RUN_FUNCTION "SorviaRunApp"

  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "SorviaMakeDesktopShortcut"

  !insertmacro MUI_PAGE_FINISH
!macroend

; ---------------------------------------------------------------------------
; Uninstaller: "Complete removal" option.
; The first uninstaller page asks whether to also wipe the user's data. Left
; unticked (the default, and what a silent /S uninstall does) the app's
; settings survive, so reinstalling picks up the saved theme, scenarios and
; server. Ticked, everything Sorvia BotSwarm ever wrote is removed.
; ---------------------------------------------------------------------------

; Only the uninstaller pass uses these — declaring them in the installer pass
; too trips NSIS warning 6001 ("never set"), which electron-builder treats as
; a build error.
!ifdef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  Var SorviaWipeAll       ; "1" once the user asks for a complete removal
  Var SorviaWipeCheckbox
!endif

!macro customUnWelcomePage
  Function un.SorviaRemovalPageCreate
    !insertmacro MUI_HEADER_TEXT "Uninstall Sorvia BotSwarm" "Choose how much to remove."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 34u "Sorvia BotSwarm will be removed from this computer.$\r$\n$\r$\nBy default your settings are kept — theme, scenarios, server list and language — so a future install starts where you left off."
    Pop $1

    ${NSD_CreateCheckbox} 0 40u 100% 12u "Complete removal (also delete settings and all app data)"
    Pop $SorviaWipeCheckbox

    ${NSD_CreateLabel} 14u 54u 96% 30u "Deletes the settings folder (%APPDATA%\Sorvia BotSwarm), cached data, the registry entries and any shortcuts left behind. This cannot be undone."
    Pop $2

    nsDialogs::Show
  FunctionEnd

  Function un.SorviaRemovalPageLeave
    ${NSD_GetState} $SorviaWipeCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $SorviaWipeAll "1"
    ${Else}
      StrCpy $SorviaWipeAll "0"
    ${EndIf}
  FunctionEnd

  UninstPage custom un.SorviaRemovalPageCreate un.SorviaRemovalPageLeave
!macroend

!macro customUnInstall
  ${If} $SorviaWipeAll == "1"
    DetailPrint "Complete removal: deleting settings and application data…"
    SetShellVarContext current
    RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
    RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
    RMDir /r "$LOCALAPPDATA\${PRODUCT_FILENAME}"
    RMDir /r "$LOCALAPPDATA\${PRODUCT_FILENAME}-updater"
    Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk"
    DeleteRegKey HKCU "Software\${PRODUCT_FILENAME}"
    DeleteRegKey HKCU "Software\Classes\${APP_PACKAGE_NAME}"
    RMDir /r "$INSTDIR"
    DetailPrint "Complete removal: done."
  ${EndIf}
!macroend
