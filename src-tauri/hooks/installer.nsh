!macro NSIS_HOOK_POSTINSTALL
  ; Register materio:// URL protocol association
  WriteRegStr HKCR "materio" "" "URL:Materio Protocol"
  WriteRegStr HKCR "materio" "URL Protocol" ""
  WriteRegStr HKCR "materio\shell" "" "open"
  WriteRegStr HKCR "materio\shell\open\command" "" '"$INSTDIR\Materio.exe" "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Unregister materio:// URL protocol
  DeleteRegKey HKCR "materio"
!macroend
