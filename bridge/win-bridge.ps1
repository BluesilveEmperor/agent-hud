# win-bridge.ps1 — AgentHUD Windows media bridge
#
# Uses Windows Runtime (WinRT) SystemMediaTransportControls to detect the
# currently playing media (title / artist / app) and streams changes as
# JSON lines to stdout. The Electron main process (winbridge.ts) reads these
# lines and forwards them to the renderer via SystemStore.
#
# Requirements: Windows 10+ (WinRT available via PowerShell). No external
# dependencies — uses the built-in Windows.Media.* WinRT types.
#
# Output protocol (one JSON object per line):
#   {"kind":"ready","media":true|false}
#   {"kind":"media","none":true}                     — no media session
#   {"kind":"media","playing":bool,"title":"...","artist":"...","app":"..."}

$ErrorActionPreference = "Stop"

# --- UTF-8 output encoding -------------------------------------------------
# PowerShell 5.1 defaults to the system OEM codepage (GBK on Chinese Windows)
# for stdout. Node.js reads our stdout as UTF-8, so Chinese song titles /
# artist names would become mojibake (replacement characters). Force UTF-8.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# --- WinRT bootstrap ------------------------------------------------------
# Load the WinRT types needed for SMTC. On Windows 10/11 these are always
# available; the [Windows.Media.*] assembly is loaded on first reference.
try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
} catch {
    # If WinRT is unavailable, emit ready with media=false and exit
    Write-Output '{"kind":"ready","media":false}'
    exit 0
}

# --- Await helper ---------------------------------------------------------
# PowerShell 5.1 does not expose WinRT extension methods like .AwaitOperation()
# directly. We use reflection to call AsTask() on IAsyncOperation<T> and block
# on the resulting .NET Task. This is the standard pattern for awaiting WinRT
# async operations from PowerShell scripts.
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await-Operation {
    param($Op, $ResultType)
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($Op))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

# --- Get the session manager ----------------------------------------------
$manager = Await-Operation `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

if (-not $manager) {
    Write-Output '{"kind":"ready","media":false}'
    exit 0
}

# --- App icon extraction -------------------------------------------------
# Extracts the application icon for a given AUMID (Application User Model ID)
# and returns it as a base64-encoded PNG data URL. Icons are cached per AUMID
# so we only extract once per app — the extraction involves process lookups
# and GDI+ bitmap conversion which would be wasteful to repeat every poll.
Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

$script:iconCache = @{}
$script:lastIconAumid = ""

# Known AUMID → exe name mappings for common Win32 apps whose AUMID doesn't
# directly match their process name.
$script:aumidExeMap = @{
    "ChromeHTML"     = "chrome.exe"
    "Microsoft Edge" = "msedge.exe"
    "msedge"         = "msedge.exe"
    "Spotify"        = "Spotify.exe"
}

function Get-AppIconBase64 {
    param([string]$Aumid)

    if (-not $Aumid) { return $null }
    if ($script:iconCache.ContainsKey($Aumid)) {
        return $script:iconCache[$Aumid]
    }

    $result = $null

    try {
        # --- Strategy 1: UWP / Store app (AUMID contains "!") -----------
        # Package Family Name + "!" + AppId → use PackageManager to get
        # the package's Logo image (a PNG file on disk).
        if ($Aumid -match "!") {
            $pkgFamilyName = ($Aumid -split "!")[0]
            try {
                [Windows.Management.Deployment.PackageManager, Windows.Management, ContentType = WindowsRuntime] | Out-Null
                $pkgManager = New-Object Windows.Management.Deployment.PackageManager
                $package = $pkgManager.FindPackageForUser("", $pkgFamilyName)
                if ($package -and $package.Logo) {
                    $logoPath = $package.Logo
                    # Logo may be a URI — strip the file:/// prefix if present.
                    $logoPath = $logoPath -replace '^file:///', ''
                    if (Test-Path $logoPath) {
                        $bytes = [System.IO.File]::ReadAllBytes($logoPath)
                        $result = "data:image/png;base64," + [Convert]::ToBase64String($bytes)
                    }
                }
            } catch {}
        }

        # --- Resolve an exe path for Win32 strategies -------------------
        $exePath = $null

        # Strategy 2: AUMID is already a full exe path
        if (-not $result -and $Aumid -match '\.exe$' -and (Test-Path $Aumid)) {
            $exePath = $Aumid
        }

        # Strategy 3: AUMID is an exe name — try Get-Command (searches PATH)
        if (-not $result -and -not $exePath -and $Aumid -match '\.exe$') {
            $cmd = Get-Command $Aumid -ErrorAction SilentlyContinue
            if ($cmd) { $exePath = $cmd.Source }
        }

        # Strategy 4: Known AUMID → exe name mapping
        if (-not $result -and -not $exePath) {
            $mapped = $script:aumidExeMap[$Aumid]
            if ($mapped) {
                $cmd = Get-Command $mapped -ErrorAction SilentlyContinue
                if ($cmd) {
                    $exePath = $cmd.Source
                } else {
                    # Try registry App Paths
                    $regKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$mapped"
                    if (Test-Path $regKey) {
                        $regVal = (Get-ItemProperty $regKey -ErrorAction SilentlyContinue).'(default)'
                        if ($regVal -and (Test-Path $regVal)) { $exePath = $regVal }
                    }
                }
            }
        }

        # Strategy 5: Match by process name (strip .exe, find running process)
        if (-not $result -and -not $exePath) {
            $procName = $Aumid -replace '\.exe$', ''
            try {
                $proc = Get-Process -Name $procName -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($proc -and $proc.MainModule) {
                    $exePath = $proc.MainModule.FileName
                }
            } catch {}
        }

        # --- Extract icon from exe via GDI+ -----------------------------
        if (-not $result -and $exePath -and (Test-Path $exePath)) {
            $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
            if ($icon) {
                $bitmap = $icon.ToBitmap()
                # Resize to 32×32 for consistent, compact data-URL size.
                $resized = New-Object System.Drawing.Bitmap(32, 32)
                $graphics = [System.Drawing.Graphics]::FromImage($resized)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.DrawImage($bitmap, 0, 0, 32, 32)
                $ms = New-Object System.IO.MemoryStream
                $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                $result = "data:image/png;base64," + [Convert]::ToBase64String($ms.ToArray())
                $graphics.Dispose()
                $resized.Dispose()
                $bitmap.Dispose()
                $icon.Dispose()
                $ms.Dispose()
            }
        }
    } catch {}

    $script:iconCache[$Aumid] = $result
    return $result
}

$script:lastMedia = $null

# Status enum shortcut
$StatusPlaying = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing

function Get-SessionInfo {
    param($session)
    if (-not $session) { return $null }

    try {
        $info = Await-Operation `
            $session.TryGetMediaPropertiesAsync() `
            ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if (-not $info) { return $null }
        $title = $info.Title
        $artist = $info.Artist
        $app = $session.SourceAppUserModelId
        if (-not $app) { $app = "" }

        $playback = $session.GetPlaybackInfo()
        $playing = $false
        if ($playback -and $playback.PlaybackStatus -eq $StatusPlaying) {
            $playing = $true
        }

        return @{
            title   = $title
            artist  = $artist
            app     = $app
            playing = $playing
        }
    } catch {
        return $null
    }
}

function Emit-Media {
    $current = $manager.GetCurrentSession()
    $info = Get-SessionInfo -session $current

    if (-not $info) {
        if ($script:lastMedia -ne "none") {
            Write-Output '{"kind":"media","none":true}'
            $script:lastMedia = "none"
        }
        return
    }

    $key = "$($info.title)|$($info.artist)|$($info.playing)|$($info.app)"
    if ($key -ne $script:lastMedia) {
        $escapedTitle  = ($info.title  -replace '\\', '\\' -replace '"', '\"')
        $escapedArtist = ($info.artist -replace '\\', '\\' -replace '"', '\"')
        $escapedApp    = ($info.app    -replace '\\', '\\' -replace '"', '\"')
        $playStr = if ($info.playing) { "true" } else { "false" }

        # Only include the icon field when the source app changes — avoids
        # re-sending a multi-KB base64 string with every song title change.
        $iconField = ""
        if ($info.app -ne $script:lastIconAumid) {
            $icon = Get-AppIconBase64 -Aumid $info.app
            if ($icon) {
                $iconField = ",`"icon`":`"$icon`""
            }
            $script:lastIconAumid = $info.app
        }

        $json = "{`"kind`":`"media`",`"playing`":$playStr,`"title`":`"$escapedTitle`",`"artist`":`"$escapedArtist`",`"app`":`"$escapedApp`"$iconField}"
        Write-Output $json
        $script:lastMedia = $key
    }
}

# --- Initial ready signal -------------------------------------------------
$hasSession = $null -ne $manager.GetCurrentSession()
$readyMedia = if ($hasSession) { "true" } else { "false" }
Write-Output "{`"kind`":`"ready`",`"media`":$readyMedia}"

# Emit initial media state
Emit-Media

# --- Poll loop ------------------------------------------------------------
# WinRT events from PowerShell are unreliable across process boundaries, so
# we poll every 2 seconds. This is cheap (no IPC, just a COM property read).
while ($true) {
    Start-Sleep -Seconds 2
    try {
        Emit-Media
    } catch {
        # Swallow transient errors; the session manager may briefly be
        # unavailable during app switches.
    }
}
