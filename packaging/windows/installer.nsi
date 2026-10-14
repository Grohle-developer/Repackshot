; The Repackshot installer for Windows: NSIS 3, Modern UI 2, English and
; Spanish, per user (no administrator rights), in
; %LOCALAPPDATA%\Programs\Repackshot.
;
; Pages: language, licence, folder, shortcuts, files, AI models, finish
; (with "Open Repackshot"). The AI models page (docs/AI-POST.md §2.2) runs
; `repackshot.exe --hardware` (the launcher detects the computer and applies
; the recommendation of src/data/ai-models.json, the same as the settings),
; shows one check box per desktop model with the recommended one ticked, and
; writes the choice to %LOCALAPPDATA%\Repackshot\pending-models.json; the
; application downloads it on its first start. The uninstaller asks whether to
; delete the models and settings too (no by default).
;
; Updating from inside the application (phase P5): the launcher downloads this installer, checks its
; SHA-256, closes itself and runs it as `setup.exe /S /LAUNCH`. So: a silent run first waits (up to 30 s)
; for repackshot.exe to let go of its file, because the application that started it is still closing;
; it changes nothing the person chose (no models page, no new desktop shortcut); and /LAUNCH starts the
; application again when it is done, silently too.
;
; Built by packaging/release.mjs:
;   makensis -WX -INPUTCHARSET UTF8 -DVERSION=0.1.0 -DVERSION4=0.1.0.0
;     -DSTAGE=<files> -DOUTFILE=<setup.exe> -DICON=<repackshot.ico>
;     -DLICENSE_TXT=<LICENSE as UTF-8 with BOM> packaging/windows/installer.nsi

; 64-bit, like the application (which needs x64 Windows anyway); Unicode.
Target amd64-unicode
ManifestDPIAware true
ManifestSupportedOS all
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !error "define VERSION (see packaging/release.mjs)"
!endif
!ifndef VERSION4
  !error "define VERSION4 (see packaging/release.mjs)"
!endif
!ifndef STAGE
  !error "define STAGE (see packaging/release.mjs)"
!endif
!ifndef OUTFILE
  !error "define OUTFILE (see packaging/release.mjs)"
!endif
!ifndef ICON
  !error "define ICON (see packaging/release.mjs)"
!endif
!ifndef LICENSE_TXT
  !error "define LICENSE_TXT (see packaging/release.mjs)"
!endif

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!insertmacro GetParameters
!insertmacro GetOptions

!define APP_KEY "Software\Repackshot"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Repackshot"
!define DATA_DIR "$LOCALAPPDATA\Repackshot"

Name "Repackshot"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Repackshot"
InstallDirRegKey HKCU "${APP_KEY}" "InstallDir"
BrandingText "Repackshot ${VERSION}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_NODESC
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${APP_KEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "InstallerLanguage"
!define MUI_FINISHPAGE_RUN "$INSTDIR\repackshot.exe"
!define MUI_FINISHPAGE_RUN_TEXT "$(OpenRepackshot)"

!insertmacro MUI_PAGE_LICENSE "${LICENSE_TXT}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
Page custom ModelsPage ModelsLeave
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
UninstPage custom un.DataPage un.DataLeave
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Spanish"
!insertmacro MUI_RESERVEFILE_LANGDLL

VIProductVersion "${VERSION4}"
VIFileVersion "${VERSION4}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "Repackshot"
VIAddVersionKey /LANG=${LANG_ENGLISH} "CompanyName" "Grohle"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright" "Copyright 2026 Grohle. PolyForm Noncommercial 1.0.0"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "Repackshot installer"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${VERSION}"

LangString SecProgram ${LANG_ENGLISH} "Repackshot and its Start menu shortcut"
LangString SecProgram ${LANG_SPANISH} "Repackshot y su acceso en el menú Inicio"
LangString SecDesktop ${LANG_ENGLISH} "Desktop shortcut"
LangString SecDesktop ${LANG_SPANISH} "Acceso directo en el escritorio"
LangString OpenRepackshot ${LANG_ENGLISH} "Open Repackshot"
LangString OpenRepackshot ${LANG_SPANISH} "Abrir Repackshot"
LangString CloseFirst ${LANG_ENGLISH} "Repackshot is running. Close its window, then press Retry."
LangString CloseFirst ${LANG_SPANISH} "Repackshot está abierto. Cierra su ventana y pulsa Reintentar."
LangString UnDataTitle ${LANG_ENGLISH} "Your models and settings"
LangString UnDataTitle ${LANG_SPANISH} "Tus modelos y ajustes"
LangString UnDataSubtitle ${LANG_ENGLISH} "Repackshot is removed. Choose whether its data goes too."
LangString UnDataSubtitle ${LANG_SPANISH} "Se quita Repackshot. Elige si se borran también sus datos."
LangString UnDeleteData ${LANG_ENGLISH} "Also delete my AI models and settings, in this folder:"
LangString UnDeleteData ${LANG_SPANISH} "Borrar también mis modelos de IA y mis ajustes, en esta carpeta:"

Var Dialog
Var DeleteBox
Var DeleteData

; ---------------------------------------------------------------- running?

!macro CHECK_NOT_RUNNING PREFIX
Function ${PREFIX}CheckNotRunning
  Push $1
  StrCpy $1 0
  retry:
  IfFileExists "$INSTDIR\repackshot.exe" 0 done
  ClearErrors
  FileOpen $0 "$INSTDIR\repackshot.exe" a
  IfErrors 0 close
  ; A silent run is the application updating itself: it is closing as this starts, so wait for it
  ; to let go of its program file, twice a second for up to 30 seconds, before asking anyone anything.
  IfSilent 0 ask
  IntOp $1 $1 + 1
  IntCmp $1 60 ask 0 ask
  Sleep 500
  Goto retry
  ask:
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CloseFirst)" /SD IDCANCEL IDRETRY retry
  Pop $1
  Abort
  close:
  FileClose $0
  done:
  Pop $1
FunctionEnd
!macroend
!insertmacro CHECK_NOT_RUNNING ""
!insertmacro CHECK_NOT_RUNNING "un."

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd

; `setup.exe /S /LAUNCH` (what the application runs to update itself): start the application when the
; installation is done. Not silent, the finish page offers it.
Function .onInstSuccess
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/LAUNCH" $R1
  IfErrors done
  Exec '"$INSTDIR\repackshot.exe"'
  done:
FunctionEnd

Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

; ---------------------------------------------------------------- files

Section "$(SecProgram)" SecProgram
  SectionIn RO
  Call CheckNotRunning
  SetOutPath "$INSTDIR"
  ; An update replaces the interface whole.
  RMDir /r "$INSTDIR\app"
  File "${STAGE}/repackshot.exe"
  File "${STAGE}/WebView2Loader.dll"
  File "${STAGE}/LICENSE"
  File "${STAGE}/THIRD-PARTY-NOTICES.txt"
  File "${STAGE}/README.txt"
  SetOutPath "$INSTDIR\app"
  File /r "${STAGE}/app/*.*"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortCut "$SMPROGRAMS\Repackshot.lnk" "$INSTDIR\repackshot.exe" "" "$INSTDIR\repackshot.exe" 0
  ; The shortcut gets the AppUserModelID the window's process has (Repackshot.App): a pinned shortcut and
  ; the running window are one taskbar button. Failing it only costs that, so the exit code is ignored.
  ExecWait '"$INSTDIR\repackshot.exe" --shortcut-id "$SMPROGRAMS\Repackshot.lnk"' $0
  WriteRegStr HKCU "${APP_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "Repackshot"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Grohle"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\repackshot.exe,0"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://github.com/Grohle-developer/Repackshot"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "$(SecDesktop)" SecDesktop
  ; A silent run is an update: it renews a desktop shortcut that is there, and does not bring back one
  ; the person deleted.
  IfSilent 0 create
  IfFileExists "$DESKTOP\Repackshot.lnk" create done
  create:
  CreateShortCut "$DESKTOP\Repackshot.lnk" "$INSTDIR\repackshot.exe" "" "$INSTDIR\repackshot.exe" 0
  ExecWait '"$INSTDIR\repackshot.exe" --shortcut-id "$DESKTOP\Repackshot.lnk"' $0
  done:
SectionEnd

; ---------------------------------------------------------------- AI models

!include "${__FILEDIR__}/models-page.nsh"

; ---------------------------------------------------------------- uninstall

Function un.DataPage
  !insertmacro MUI_HEADER_TEXT "$(UnDataTitle)" "$(UnDataSubtitle)"
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  ${NSD_CreateCheckbox} 0 0 100% 12u "$(UnDeleteData)"
  Pop $DeleteBox
  ${NSD_CreateLabel} 12u 14u 100% 12u "${DATA_DIR}"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function un.DataLeave
  ${NSD_GetState} $DeleteBox $DeleteData
FunctionEnd

Section "Uninstall"
  Call un.CheckNotRunning
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\repackshot.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Repackshot.lnk"
  Delete "$DESKTOP\Repackshot.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "${APP_KEY}"
  ${If} $DeleteData == ${BST_CHECKED}
    RMDir /r "${DATA_DIR}"
  ${EndIf}
SectionEnd
