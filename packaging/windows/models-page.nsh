; The "AI models" page of the installer (docs/AI-POST.md §2.2), included by
; installer.nsi after MUI_LANGUAGE (it needs ${LANG_ENGLISH} and
; ${LANG_SPANISH}) and DATA_DIR. It runs `repackshot.exe --hardware` from
; $INSTDIR, which writes hw.ini (UTF-16): the computer, the recommendation,
; the inference runtime the choice rule picks for this system and every model
; of src/data/ai-models.json; the page shows one check box per desktop model
; that is available (name, size, licence; the recommended one ticked and
; marked "Recommended for your computer"), plus "None", plus (phase U10) a
; check box for the inference runtime the models need (the Vulkan build with a
; graphics card to use, the CPU build without one: the same rule and file as
; the application's). The runtime ticks itself when any model is chosen, can be
; unticked, and is unavailable while no model is chosen. On leaving the page
; writes DATA_DIR\pending-models.json for the application, which downloads the
; models and the runtime from its first start:
;   {"device": "gpu", "keys": ["ZIMAGE_Q8"], "runtime": "SDCPP_WIN_VULKAN"}
; (`runtime` only when models are chosen and the box is ticked).
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
Var RuntimeBox
Var RtKey
Var RtAvail
Var Chosen

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
LangString RuntimeLabel ${LANG_ENGLISH} "Inference runtime for the models"
LangString RuntimeLabel ${LANG_SPANISH} "Motor de ejecución de los modelos"
LangString RuntimeGpu ${LANG_ENGLISH} "Vulkan build, for the graphics card"
LangString RuntimeGpu ${LANG_SPANISH} "compilación Vulkan, para la tarjeta gráfica"
LangString RuntimeCpu ${LANG_ENGLISH} "CPU build, for the processor"
LangString RuntimeCpu ${LANG_SPANISH} "compilación CPU, para el procesador"
LangString RuntimeNone ${LANG_ENGLISH} "Inference runtime: there is no build for this system"
LangString RuntimeNone ${LANG_SPANISH} "Motor de ejecución: no hay compilación para este sistema"

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
  ReadINIStr $RtAvail "${HW}" "runtime" "available"
  ReadINIStr $RtKey "${HW}" "runtime" "key"
  ${If} $RtKey == ""
    StrCpy $RtAvail 0
  ${EndIf}
FunctionEnd

; The text of the runtime's check box into $8: "Inference runtime for the models:
; Vulkan build, for the graphics card · 29 MB — Recommended for your computer".
Function RuntimeText
  ${If} $RtAvail != 1
    StrCpy $8 "$(RuntimeNone)"
    Return
  ${EndIf}
  ReadINIStr $1 "${HW}" "runtime" "backend"
  ReadINIStr $2 "${HW}" "runtime" "size_mib"
  ${If} $1 == "VULKAN"
    StrCpy $3 "$(RuntimeGpu)"
  ${Else}
    StrCpy $3 "$(RuntimeCpu)"
  ${EndIf}
  StrCpy $8 "$(RuntimeLabel): $3 · $2 MB — $(Recommended)"
FunctionEnd

; Ticks and enables the runtime while any model is chosen, and unticks and disables it
; when none is: it ticks itself on the step from none to some (a person who unticked it
; keeps it unticked while choosing more), and is ticked again by a new detection.
Function SyncRuntime
  StrCpy $R2 0
  StrCpy $R0 0
  ${While} $R0 < $Count
    ReadINIStr $7 "${UI}" "model$R0" "hwnd"
    ${If} $7 != ""
      ${NSD_GetState} $7 $1
      ${If} $1 == ${BST_CHECKED}
        IntOp $R2 $R2 + 1
      ${EndIf}
    ${EndIf}
    IntOp $R0 $R0 + 1
  ${EndWhile}
  ${If} $RtAvail != 1
    EnableWindow $RuntimeBox 0
    ${NSD_Uncheck} $RuntimeBox
  ${ElseIf} $R2 > 0
    EnableWindow $RuntimeBox 1
    ${If} $Chosen == 0
      ${NSD_Check} $RuntimeBox
    ${EndIf}
  ${Else}
    ${NSD_Uncheck} $RuntimeBox
    EnableWindow $RuntimeBox 0
  ${EndIf}
  StrCpy $Chosen $R2
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
  ; The models were just set to the recommendation: the runtime follows them.
  Call RuntimeText
  ${NSD_SetText} $RuntimeBox $8
  StrCpy $Chosen 0
  Call SyncRuntime
FunctionEnd

Function ModelsPage
  ; A silent run is the application updating itself: it asks nothing, and the choice already made
  ; (pending-models.json, then the application's own settings) is not touched.
  IfSilent 0 +2
  Abort
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
  ; The inference runtime the models need (phase U10): one line, or two when the text is long.
  IntOp $R1 $R1 + 13
  Call RuntimeText
  StrLen $4 "$8"
  ${If} $4 > 80
    StrCpy $5 19
  ${Else}
    StrCpy $5 11
  ${EndIf}
  ${NSD_CreateCheckbox} 0 "$R1$U" 100% "$5$U" ""
  Pop $RuntimeBox
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
  Call SyncRuntime
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
  Call SyncRuntime
FunctionEnd

; Writes {"device": ..., "keys": [...], "runtime": ...} for the application's first start.
Function ModelsLeave
  IfSilent 0 +2
  Return
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
  ; The runtime goes with the models: only when some are chosen and the box is ticked.
  StrCpy $9 ""
  ${If} $5 != ""
  ${AndIf} $RtAvail == 1
    ${NSD_GetState} $RuntimeBox $1
    ${If} $1 == ${BST_CHECKED}
      StrCpy $9 ', "runtime": "$RtKey"'
    ${EndIf}
  ${EndIf}
  CreateDirectory "${DATA_DIR}"
  ClearErrors
  FileOpen $0 "${DATA_DIR}\pending-models.json" w
  ${IfNot} ${Errors}
    FileWrite $0 '{"device": "$6", "keys": [$5]$9}$\r$\n'
    FileClose $0
  ${EndIf}
FunctionEnd
