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
