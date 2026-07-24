# media-control.ps1 — AgentHUD media control bridge
#
# Sends a media control command (play / pause / playpause / next / prev) to
# the current SMTC session. Invoked by winbridge.ts via execFile.
#
# Usage: powershell -File media-control.ps1 <action>

param(
    [Parameter(Position = 0)]
    [ValidateSet("next", "prev", "playpause", "play", "pause")]
    [string]$Action
)

if (-not $Action) { exit 1 }

$ErrorActionPreference = "Stop"

# --- WinRT bootstrap ------------------------------------------------------
try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
} catch {
    exit 1
}

# --- Await helper (same pattern as win-bridge.ps1) ------------------------
# PowerShell 5.1 does not expose .AwaitOperation() on IAsyncOperation<T>.
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

$manager = Await-Operation `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

if (-not $manager) { exit 1 }

$session = $manager.GetCurrentSession()
if (-not $session) { exit 1 }

$StatusPlaying = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing

# --- Execute the requested action -----------------------------------------
# Each Try*Async returns IAsyncOperation<bool>; we await it to ensure the
# command is dispatched before the script exits.
switch ($Action) {
    "play" {
        Await-Operation $session.TryPlayAsync() ([bool]) | Out-Null
    }
    "pause" {
        Await-Operation $session.TryPauseAsync() ([bool]) | Out-Null
    }
    "playpause" {
        # Toggle based on current status
        $playback = $session.GetPlaybackInfo()
        if ($playback.PlaybackStatus -eq $StatusPlaying) {
            Await-Operation $session.TryPauseAsync() ([bool]) | Out-Null
        } else {
            Await-Operation $session.TryPlayAsync() ([bool]) | Out-Null
        }
    }
    "next" {
        Await-Operation $session.TrySkipNextAsync() ([bool]) | Out-Null
    }
    "prev" {
        Await-Operation $session.TrySkipPreviousAsync() ([bool]) | Out-Null
    }
}
