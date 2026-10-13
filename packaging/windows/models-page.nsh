; The "AI models" page of the installer (docs/AI-POST.md §2.2), included by
; installer.nsi after MUI_LANGUAGE (it needs ${LANG_ENGLISH} and
; ${LANG_SPANISH}) and DATA_DIR. It runs `repackshot.exe --hardware` from
; $INSTDIR, which writes hw.ini (UTF-16): the computer, the recommendation
; and every model of src/data/ai-models.json; the page shows one check box per
; desktop model that is available (name, size, licence; the recommended one
; ticked and marked "Recommended for your computer"), plus "None",
; and on leaving writes DATA_DIR\pending-models.json for the application.
; PREVIEW_HW_INI (packaging checks only) shows the page from a prepared INI.

!define HW "$PLUGINSDIR\hw.ini"
!define UI "$PLUGINSDIR\ui.ini"

Var ModelsDialog
Var HwLabel
Var GpuRadio
Var CpuRadio
Var NoneBox
Var Device
Var Found
Var Count
Var U

LangString ModelsTitle ${LANG_ENGLISH} "AI models"
LangString ModelsTitle ${LANG_SPANISH} "Modelos de IA"
LangString ModelsSubtitle ${LANG_ENGLISH} "Optional: one, several or none. Repackshot downloads them the first time it starts, with pause and resume; Settings changes this later."
LangString ModelsSubtitle ${LANG_SPANISH} "Opcional: uno, varios o ninguno. Repackshot los descarga la primera vez que arranca, con pausa y reanudación; luego se cambia en Ajustes."
LangString Detected ${LANG_ENGLISH} "Your computer:"
LangString Detected ${LANG_SPANISH} "Tu equipo:"
LangString DetectFailed ${LANG_ENGLISH} "Your computer could not be detected, so nothing is recommended. Choose any model, or none."
LangString DetectFailed ${LANG_SPANISH} "No se ha podido detectar tu equipo, así que no se recomienda nada. Elige el modelo que quieras, o ninguno."
LangString Threads ${LANG_ENGLISH} "threads"
LangString Threads ${LANG_SPANISH} "hilos"
LangString RunOnGpu ${LANG_ENGLISH} "Run on the graphics card"
LangString RunOnGpu ${LANG_SPANISH} "Ejecutar en la tarjeta gráfica"
LangString RunOnCpu ${LANG_ENGLISH} "Run on the processor (minutes per image)"
LangString RunOnCpu ${LANG_SPANISH} "Ejecutar en el procesador (minutos por imagen)"
LangString Recommended ${LANG_ENGLISH} "Recommended for your computer"
LangString Recommended ${LANG_SPANISH} "Recomendado para tu equipo"
LangString NonCommercial ${LANG_ENGLISH} "not for commercial use"
LangString NonCommercial ${LANG_SPANISH} "no apto para uso comercial"
LangString NoneChoice ${LANG_ENGLISH} "None: install without AI models"
LangString NoneChoice ${LANG_SPANISH} "Ninguno: instalar sin modelos de IA"
LangString Restricted ${LANG_ENGLISH} "use restrictions"
LangString Restricted ${LANG_SPANISH} "restricciones de uso"

; Runs the launcher's detection: $Device is "" (it decides), "gpu" or "cpu".
Function DetectHardware
  Delete "${HW}"
!ifdef PREVIEW_HW_INI
  CopyFiles /SILENT "${PREVIEW_HW_INI}" "${HW}"
!else
  ${If} $Device == ""
    ExecWait '"$INSTDIR\repackshot.exe" --hardware "${HW}"' $0
  ${Else}
    ExecWait '"$INSTDIR\repackshot.exe" --hardware "${HW}" --device $Device' $0
  ${EndIf}
!endif
  ReadINIStr $Device "${HW}" "recommendation" "device"
  ReadINIStr $Found "${HW}" "hardware" "gpu_found"
  ReadINIStr $Count "${HW}" "models" "count"
  ${If} $Count == ""
    StrCpy $Count 0
  ${EndIf}
FunctionEnd

; The text of model $R0's check box, without the recommendation, into $8.
Function ModelText
  ${If} $LANGUAGE == ${LANG_SPANISH}
    ReadINIStr $1 "${HW}" "model$R0" "label_es"
  ${Else}
    ReadINIStr $1 "${HW}" "model$R0" "label_en"
  ${EndIf}
  ReadINIStr $2 "${HW}" "model$R0" "size_gib"
  ReadINIStr $3 "${HW}" "model$R0" "licence"
  StrCpy $4 $3 11
  ${If} $4 == "LicenseRef-"
    StrCpy $3 $3 "" 11
  ${EndIf}
  ReadINIStr $4 "${HW}" "model$R0" "restrictions"
  ${If} $4 == 1
    StrCpy $3 "$3 ($(Restricted))"
  ${EndIf}
  ReadINIStr $4 "${HW}" "model$R0" "commercial"
  ${If} $4 != 1
    StrCpy $3 "$3, $(NonCommercial)"
  ${EndIf}
  StrCpy $8 "$1 · $2 GB · $3"
FunctionEnd

; The hardware line, the device and the check boxes from hw.ini.
Function Refresh
  ReadINIStr $0 "${HW}" "hardware" "detected"
  ReadINIStr $1 "${HW}" "hardware" "cpu"
  ReadINIStr $2 "${HW}" "hardware" "threads"
  ReadINIStr $3 "${HW}" "hardware" "ram_gib"
  ReadINIStr $4 "${HW}" "hardware" "gpu"
  ReadINIStr $5 "${HW}" "hardware" "vram_gib"
  StrCpy $6 "$1  ·  $2 $(Threads)  ·  $3 GB RAM"
  ${If} $4 != ""
    StrCpy $6 "$6  ·  $4, $5 GB"
  ${EndIf}
  ${If} $0 == 1
    ${NSD_SetText} $HwLabel "$(Detected) $6"
  ${Else}
    ${NSD_SetText} $HwLabel "$(DetectFailed)"
  ${EndIf}
  ${If} $Found == 1
    ${If} $Device == "gpu"
      ${NSD_Check} $GpuRadio
      ${NSD_Uncheck} $CpuRadio
    ${Else}
      ${NSD_Uncheck} $GpuRadio
      ${NSD_Check} $CpuRadio
    ${EndIf}
  ${EndIf}
  StrCpy $R0 0
  ${While} $R0 < $Count
    ReadINIStr $7 "${UI}" "model$R0" "hwnd"
    ${If} $7 != ""
      Call ModelText
      ReadINIStr $9 "${HW}" "model$R0" "recommended"
      ${If} $9 == 1
        ${NSD_SetText} $7 "$8 — $(Recommended)"
        ${NSD_Check} $7
      ${Else}
        ${NSD_SetText} $7 $8
        ${NSD_Uncheck} $7
      ${EndIf}
    ${EndIf}
    IntOp $R0 $R0 + 1
  ${EndWhile}
  ReadINIStr $9 "${HW}" "recommendation" "key"
  ${If} $9 == ""
    ${NSD_Check} $NoneBox
  ${Else}
    ${NSD_Uncheck} $NoneBox
  ${EndIf}
FunctionEnd

Function ModelsPage
  !insertmacro MUI_HEADER_TEXT "$(ModelsTitle)" "$(ModelsSubtitle)"
  InitPluginsDir
  StrCpy $U "u"
  StrCpy $Device ""
  Call DetectHardware
  nsDialogs::Create 1018
  Pop $ModelsDialog
  ${If} $ModelsDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 18u ""
  Pop $HwLabel
  StrCpy $R1 20
  ${If} $Found == 1
    ${NSD_CreateFirstRadioButton} 0 20u 42% 11u "$(RunOnGpu)"
    Pop $GpuRadio
    ${NSD_CreateAdditionalRadioButton} 42% 20u 58% 11u "$(RunOnCpu)"
    Pop $CpuRadio
    ${NSD_OnClick} $GpuRadio OnGpu
    ${NSD_OnClick} $CpuRadio OnCpu
    StrCpy $R1 33
  ${EndIf}
  StrCpy $R0 0
  ${While} $R0 < $Count
    WriteINIStr "${UI}" "model$R0" "hwnd" ""
    ReadINIStr $1 "${HW}" "model$R0" "desktop"
    ReadINIStr $2 "${HW}" "model$R0" "available"
    ${If} $1 == 1
    ${AndIf} $2 == 1
      ; A row that cannot hold its text and the recommendation on one line (about 80
      ; characters) gets two.
      Call ModelText
      StrLen $4 "$8 — $(Recommended)"
      ${If} $4 > 80
        StrCpy $5 19
      ${Else}
        StrCpy $5 11
      ${EndIf}
      ${NSD_CreateCheckbox} 0 "$R1$U" 100% "$5$U" ""
      Pop $3
      WriteINIStr "${UI}" "model$R0" "hwnd" $3
      ${NSD_OnClick} $3 OnModel
      IntOp $R1 $R1 + $5
      IntOp $R1 $R1 + 1
    ${EndIf}
    IntOp $R0 $R0 + 1
  ${EndWhile}
  IntOp $R1 $R1 + 2
  ${NSD_CreateCheckbox} 0 "$R1$U" 100% 11u "$(NoneChoice)"
  Pop $NoneBox
  ${NSD_OnClick} $NoneBox OnNone
  Call Refresh
  nsDialogs::Show
FunctionEnd

Function OnGpu
  Pop $0
  StrCpy $Device "gpu"
  Call DetectHardware
  Call Refresh
FunctionEnd

Function OnCpu
  Pop $0
  StrCpy $Device "cpu"
  Call DetectHardware
  Call Refresh
FunctionEnd

Function OnModel
  Pop $0
  ${NSD_GetState} $0 $1
  ${If} $1 == ${BST_CHECKED}
    ${NSD_Uncheck} $NoneBox
  ${EndIf}
FunctionEnd

Function OnNone
  Pop $0
  ${NSD_GetState} $NoneBox $1
  ${If} $1 == ${BST_CHECKED}
    StrCpy $R0 0
    ${While} $R0 < $Count
      ReadINIStr $7 "${UI}" "model$R0" "hwnd"
      ${If} $7 != ""
        ${NSD_Uncheck} $7
      ${EndIf}
      IntOp $R0 $R0 + 1
    ${EndWhile}
  ${EndIf}
FunctionEnd

; Writes {"device": ..., "keys": [...]} for the application's first start.
Function ModelsLeave
  StrCpy $5 ""
  StrCpy $R0 0
  ${While} $R0 < $Count
    ReadINIStr $7 "${UI}" "model$R0" "hwnd"
    ${If} $7 != ""
      ${NSD_GetState} $7 $1
      ${If} $1 == ${BST_CHECKED}
        ReadINIStr $2 "${HW}" "model$R0" "key"
        ${If} $5 == ""
          StrCpy $5 '"$2"'
        ${Else}
          StrCpy $5 '$5, "$2"'
        ${EndIf}
      ${EndIf}
    ${EndIf}
    IntOp $R0 $R0 + 1
  ${EndWhile}
  StrCpy $6 $Device
  ${If} $6 != "gpu"
    StrCpy $6 "cpu"
  ${EndIf}
  CreateDirectory "${DATA_DIR}"
  ClearErrors
  FileOpen $0 "${DATA_DIR}\pending-models.json" w
  ${IfNot} ${Errors}
    FileWrite $0 '{"device": "$6", "keys": [$5]}$\r$\n'
    FileClose $0
  ${EndIf}
FunctionEnd
