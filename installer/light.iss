; ============================================================================
;  AgentHUD — Inno Setup script
;  Builds a Windows installer from the staged app folder (release\AgentHUD).
;
;  Prerequisites:
;    1) npm run dist          (= npm run build && npm run stage)
;                             → produces ..\release\AgentHUD\
;    2) iscc installer\light.iss
;
; Output:  ..\release\AgentHUD-Setup-4.0.0.exe   (per-user, no admin needed)
; ============================================================================

#define MyAppName "AgentHUD"
#define MyAppVersion "4.0.0"
#define MyAppPublisher "AgentHUD"
#define MyAppExeName "AgentHUD.exe"

[Setup]
; A unique, stable identity for this app (do NOT reuse for other apps).
AppId={{B7E6B9A2-2D4C-4E1F-9C3A-7A1F2E5D8C40}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
VersionInfoVersion=4.0.0.0
VersionInfoProductName={#MyAppName}

; Per-user install → no UAC prompt, lands in %LocalAppData%\Programs\AgentHUD.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes

; Branding & chrome.
SetupIconFile=light.ico
UninstallDisplayIcon={app}\light.ico
UninstallDisplayName={#MyAppName}
WizardStyle=modern
MinVersion=10.0

; Output.
OutputDir=..\release
OutputBaseFilename=AgentHUD-Setup-{#MyAppVersion}
Compression=lzma2/ultra
SolidCompression=yes

[Languages]
; Official Simplified Chinese messages (Inno 6.5.0+), vendored next to this
; script so the build does not depend on the local Inno install's Languages/.
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："
Name: "autostart"; Description: "开机时自动启动 AgentHUD（推荐）"; GroupDescription: "附加任务："

[Files]
; The entire staged app tree → install folder.
Source: "..\release\AgentHUD\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\light.ico"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\light.ico"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Make sure a running instance is closed before removing files.
Filename: "{cmd}"; Parameters: "/C taskkill /IM {#MyAppExeName} /F"; Flags: runhidden; RunOnceId: "KillAgentHUD"

[Code]
// Close any running AgentHUD.exe before overwriting files (smooth upgrades).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/C taskkill /IM {#MyAppExeName} /F', '',
       SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
