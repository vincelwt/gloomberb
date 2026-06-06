$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$PackageJson = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$BundleDir = Join-Path $Root "build\stable-win-x64\Gloomberb-inno-source\Gloomberb"
$CoreDir = Join-Path $BundleDir "Resources\gloomberb-tui\node_modules\@opentui\core-win32-x64"
$InstallerPath = Join-Path $Root "artifacts\stable-win-x64-GloomberbSetup.exe"
$UpdateManifestPath = Join-Path $Root "artifacts\stable-win-x64-update.json"
$GuiArtifactDir = Join-Path $Root "artifacts\windows-gui-verification"
$BundleAppIconPath = Join-Path $BundleDir "Resources\app.ico"
$BundleLogoIconPath = Join-Path $BundleDir "Resources\gloomberb-logo.ico"

New-Item -ItemType Directory -Force -Path $GuiArtifactDir | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class GloomberbWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out GloomberbWindowRect rect);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW", SetLastError = true)]
  public static extern IntPtr GetClassLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint = "GetClassLongW", SetLastError = true)]
  public static extern uint GetClassLong32(IntPtr hWnd, int nIndex);

  public static IntPtr GetClassLongPtrCompat(IntPtr hWnd, int nIndex)
  {
    if (IntPtr.Size == 8)
      return GetClassLongPtr64(hWnd, nIndex);

    return new IntPtr((long)GetClassLong32(hWnd, nIndex));
  }

  [DllImport("user32.dll")]
  public static extern IntPtr CopyIcon(IntPtr hIcon);

  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr hIcon);
}

[StructLayout(LayoutKind.Sequential)]
public struct GloomberbWindowRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
"@

function Get-VisibleWindows {
  $Windows = New-Object System.Collections.Generic.List[object]
  $Callback = [GloomberbWin32+EnumWindowsProc]{
    param([IntPtr]$Handle, [IntPtr]$Param)

    if (-not [GloomberbWin32]::IsWindowVisible($Handle)) {
      return $true
    }

    $TextLength = [GloomberbWin32]::GetWindowTextLength($Handle)
    if ($TextLength -le 0) {
      return $true
    }

    $TitleBuilder = New-Object System.Text.StringBuilder ($TextLength + 1)
    [void][GloomberbWin32]::GetWindowText($Handle, $TitleBuilder, $TitleBuilder.Capacity)
    $Title = $TitleBuilder.ToString()
    if ([string]::IsNullOrWhiteSpace($Title)) {
      return $true
    }

    $ProcessIdValue = [uint32]0
    [void][GloomberbWin32]::GetWindowThreadProcessId($Handle, [ref]$ProcessIdValue)
    $Process = Get-Process -Id ([int]$ProcessIdValue) -ErrorAction SilentlyContinue
    $Windows.Add([pscustomobject]@{
      Id = [int]$ProcessIdValue
      ProcessName = if ($Process) { $Process.ProcessName } else { "" }
      MainWindowTitle = $Title
      Handle = $Handle.ToInt64()
    })
    return $true
  }

  [void][GloomberbWin32]::EnumWindows($Callback, [IntPtr]::Zero)
  $Windows | Sort-Object Id, Handle
}

function New-WindowHandleSet {
  param([object[]]$Windows)

  $Handles = @{}
  foreach ($Window in $Windows) {
    $Handles[[string]$Window.Handle] = $true
  }
  return $Handles
}

function Save-WindowInventory {
  param([string]$Path)

  Get-VisibleWindows |
    Format-Table -AutoSize Id, ProcessName, Handle, MainWindowTitle |
    Out-String |
    Set-Content -Path $Path -Encoding UTF8
}

function Wait-ForNewWindows {
  param(
    [hashtable]$KnownHandles,
    [int]$MinimumCount,
    [string]$Label,
    [int]$TimeoutSeconds = 35
  )

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $Windows = @(Get-VisibleWindows | Where-Object { -not $KnownHandles.ContainsKey([string]$_.Handle) })
    if ($Windows.Count -ge $MinimumCount) {
      return $Windows
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $Deadline)

  Save-WindowInventory (Join-Path $GuiArtifactDir "windows-timeout-$($Label -replace '[^A-Za-z0-9_-]', '-').txt")
  throw "Timed out waiting for $Label. Expected at least $MinimumCount new visible window(s)."
}

function Focus-Window {
  param([object]$Window)

  $Handle = [IntPtr]::new([long]$Window.Handle)
  [GloomberbWin32]::ShowWindow($Handle, 9) | Out-Null
  [GloomberbWin32]::SetForegroundWindow($Handle) | Out-Null
  $Bounds = Get-WindowBounds $Window
  $CenterX = [int]($Bounds.Left + ($Bounds.Width / 2))
  $CenterY = [int]($Bounds.Top + ($Bounds.Height / 2))
  [GloomberbWin32]::SetCursorPos($CenterX, $CenterY) | Out-Null
  Start-Sleep -Milliseconds 750
}

function Get-WindowHandle {
  param([object]$Window)

  [IntPtr]::new([long]$Window.Handle)
}

function Click-WindowControl {
  param(
    [object]$Window,
    [ValidateSet("minimize", "maximize", "close")]
    [string]$Action
  )

  $Handle = Get-WindowHandle $Window
  [GloomberbWin32]::ShowWindow($Handle, 9) | Out-Null
  [GloomberbWin32]::SetForegroundWindow($Handle) | Out-Null
  Start-Sleep -Milliseconds 300

  $Bounds = Get-WindowBounds $Window
  $OffsetFromRight = switch ($Action) {
    "close" { 14 }
    "maximize" { 44 }
    "minimize" { 74 }
  }
  $X = [int]($Bounds.Left + $Bounds.Width - $OffsetFromRight)
  $Y = [int]($Bounds.Top + 14)
  [GloomberbWin32]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 80
  [GloomberbWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [GloomberbWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 700
}

function Assert-CustomWindowControls {
  param(
    [object]$Window,
    [string]$Label
  )

  $Window = Resolve-VisibleWindowByTitle -Title $Window.MainWindowTitle -Label $Label
  $Handle = Get-WindowHandle $Window
  $OriginalBounds = Get-WindowBounds $Window

  Click-WindowControl -Window $Window -Action "maximize"
  $Window = Resolve-VisibleWindowByTitle -Title $Window.MainWindowTitle -Label $Label
  $Handle = Get-WindowHandle $Window
  if (-not [GloomberbWin32]::IsZoomed($Handle)) {
    throw "$Label custom maximize control did not maximize the window."
  }

  Click-WindowControl -Window $Window -Action "maximize"
  $Window = Resolve-VisibleWindowByTitle -Title $Window.MainWindowTitle -Label $Label
  $Handle = Get-WindowHandle $Window
  if ([GloomberbWin32]::IsZoomed($Handle)) {
    throw "$Label custom maximize control did not restore the window."
  }
  $RestoredBounds = Get-WindowBounds $Window
  if ($RestoredBounds.Width -lt [Math]::Max(320, [int]($OriginalBounds.Width * 0.6)) -or $RestoredBounds.Height -lt [Math]::Max(240, [int]($OriginalBounds.Height * 0.6))) {
    throw "$Label custom maximize restore left unexpected bounds: $($RestoredBounds | ConvertTo-Json -Compress)"
  }

  Click-WindowControl -Window $Window -Action "minimize"
  $Window = Resolve-VisibleWindowByTitle -Title $Window.MainWindowTitle -Label $Label
  $Handle = Get-WindowHandle $Window
  if (-not [GloomberbWin32]::IsIconic($Handle)) {
    throw "$Label custom minimize control did not minimize the window."
  }
  [GloomberbWin32]::ShowWindow($Handle, 9) | Out-Null
  [GloomberbWin32]::SetForegroundWindow($Handle) | Out-Null
  Start-Sleep -Milliseconds 700
  $Window = Resolve-VisibleWindowByTitle -Title $Window.MainWindowTitle -Label $Label
  $Handle = Get-WindowHandle $Window
  if ([GloomberbWin32]::IsIconic($Handle)) {
    throw "$Label custom minimize control did not restore through ShowWindow."
  }
}

function Capture-DesktopScreenshot {
  param([string]$Path)

  $Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $Bitmap = New-Object System.Drawing.Bitmap $Bounds.Width, $Bounds.Height
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  try {
    $Graphics.CopyFromScreen($Bounds.Location, [System.Drawing.Point]::Empty, $Bounds.Size)
    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $Graphics.Dispose()
    $Bitmap.Dispose()
  }
}

function Get-WindowBounds {
  param([object]$Window)

  $Handle = [IntPtr]::new([long]$Window.Handle)
  $Rect = New-Object GloomberbWindowRect
  if (-not [GloomberbWin32]::GetWindowRect($Handle, [ref]$Rect)) {
    throw "Could not read window bounds for $($Window.ProcessName) $($Window.Handle)."
  }

  $Width = $Rect.Right - $Rect.Left
  $Height = $Rect.Bottom - $Rect.Top
  if ($Width -le 1 -or $Height -le 1) {
    throw "Window bounds are invalid for $($Window.ProcessName) $($Window.Handle): $($Rect | ConvertTo-Json -Compress)"
  }

  [pscustomobject]@{
    Left = $Rect.Left
    Top = $Rect.Top
    Width = $Width
    Height = $Height
  }
}

function Capture-WindowScreenshot {
  param(
    [object]$Window,
    [string]$Path
  )

  $Bounds = Get-WindowBounds $Window
  $Bitmap = New-Object System.Drawing.Bitmap $Bounds.Width, $Bounds.Height
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  try {
    $Graphics.CopyFromScreen($Bounds.Left, $Bounds.Top, 0, 0, [System.Drawing.Size]::new($Bounds.Width, $Bounds.Height))
    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $Graphics.Dispose()
    $Bitmap.Dispose()
  }
}

function Get-VisibleWindowByTitle {
  param([string]$Title)

  $Candidates = @(
    Get-VisibleWindows |
      Where-Object { $_.MainWindowTitle -eq $Title } |
      ForEach-Object {
        try {
          $Bounds = Get-WindowBounds $_
          [pscustomobject]@{
            Window = $_
            Area = $Bounds.Width * $Bounds.Height
          }
        } catch {
          $null
        }
      } |
      Where-Object { $_ -ne $null }
  )

  $Candidates |
    Sort-Object Area -Descending |
    Select-Object -First 1 -ExpandProperty Window
}

function Resolve-VisibleWindowByTitle {
  param(
    [string]$Title,
    [string]$Label,
    [int]$TimeoutSeconds = 10
  )

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $Window = Get-VisibleWindowByTitle $Title
    if ($Window) {
      return $Window
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $Deadline)

  throw "$Label window could not be reacquired by title: $Title"
}

function Capture-WindowScreenshotByTitle {
  param(
    [string]$Title,
    [string]$Path,
    [string]$Label,
    [int]$TimeoutSeconds = 15,
    [int]$InitialDelaySeconds = 0
  )

  if ($InitialDelaySeconds -gt 0) {
    Start-Sleep -Seconds $InitialDelaySeconds
  }

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $LastError = $null
  do {
    $Window = Get-VisibleWindowByTitle $Title
    if ($Window) {
      try {
        Focus-Window $Window
        Capture-WindowScreenshot $Window $Path
        Assert-ScreenshotHasContent $Path $Label
        return $Window
      } catch {
        $LastError = $_
      }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $Deadline)

  if ($LastError) {
    throw "$Label screenshot could not be captured from '$Title': $($LastError.Exception.Message)"
  }
  throw "$Label window was not visible: $Title"
}

function Get-ScreenshotStats {
  param([string]$Path)

  $Bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $StepX = [Math]::Max(1, [int][Math]::Floor($Bitmap.Width / 48))
    $StepY = [Math]::Max(1, [int][Math]::Floor($Bitmap.Height / 32))
    $UniqueColors = @{}
    $Samples = 0
    for ($Y = 0; $Y -lt $Bitmap.Height; $Y += $StepY) {
      for ($X = 0; $X -lt $Bitmap.Width; $X += $StepX) {
        $Color = $Bitmap.GetPixel($X, $Y).ToArgb()
        $UniqueColors[[string]$Color] = $true
        $Samples += 1
      }
    }

    [pscustomobject]@{
      Width = $Bitmap.Width
      Height = $Bitmap.Height
      Samples = $Samples
      UniqueColors = $UniqueColors.Count
    }
  } finally {
    $Bitmap.Dispose()
  }
}

function Assert-ScreenshotHasContent {
  param(
    [string]$Path,
    [string]$Label
  )

  $Stats = Get-ScreenshotStats $Path
  if ($Stats.Width -le 1 -or $Stats.Height -le 1 -or $Stats.UniqueColors -lt 8) {
    throw "$Label screenshot appears blank: $($Stats | ConvertTo-Json -Compress)"
  }
}

function Assert-IcoFile {
  param(
    [string]$Path,
    [string]$Label
  )

  $Bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($Bytes.Length -lt 6 -or $Bytes[0] -ne 0 -or $Bytes[1] -ne 0 -or $Bytes[2] -ne 1 -or $Bytes[3] -ne 0) {
    throw "$Label is not a valid ICO file: $Path"
  }

  $ImageCount = [BitConverter]::ToUInt16($Bytes, 4)
  if ($ImageCount -lt 1) {
    throw "$Label does not contain any icon images: $Path"
  }
}

function Assert-GloomberbIconImage {
  param(
    [string]$Path,
    [string]$Label
  )

  $Bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $OpaquePixels = 0
    $RedPixels = 0
    $GreenPixels = 0
    $LightPixels = 0

    for ($Y = 0; $Y -lt $Bitmap.Height; $Y += 1) {
      for ($X = 0; $X -lt $Bitmap.Width; $X += 1) {
        $Color = $Bitmap.GetPixel($X, $Y)
        if ($Color.A -lt 16) {
          continue
        }

        $OpaquePixels += 1
        if ($Color.R -ge 170 -and $Color.G -le 140 -and $Color.B -le 140) {
          $RedPixels += 1
        }
        if ($Color.G -ge 170 -and $Color.R -le 150 -and $Color.B -le 130) {
          $GreenPixels += 1
        }
        if ($Color.R -ge 210 -and $Color.G -ge 210 -and $Color.B -ge 210) {
          $LightPixels += 1
        }
      }
    }

    $BaseAccentMinimum = if ($Bitmap.Width -le 16 -or $Bitmap.Height -le 16) { 2 } else { 4 }
    $MinimumAccentPixels = [Math]::Max($BaseAccentMinimum, [int][Math]::Floor($OpaquePixels * 0.01))
    if ($RedPixels -lt $MinimumAccentPixels -or $GreenPixels -lt $MinimumAccentPixels -or $LightPixels -lt $MinimumAccentPixels) {
      throw "$Label does not look like the Gloomberb icon: $(@{ width = $Bitmap.Width; height = $Bitmap.Height; opaque = $OpaquePixels; red = $RedPixels; green = $GreenPixels; light = $LightPixels; minimum = $MinimumAccentPixels } | ConvertTo-Json -Compress)"
    }
  } finally {
    $Bitmap.Dispose()
  }
}

function Assert-IconHasTransparentCorners {
  param(
    [string]$Path,
    [string]$Label
  )

  $Bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $CornerPixels = @(
      $Bitmap.GetPixel(0, 0),
      $Bitmap.GetPixel($Bitmap.Width - 1, 0),
      $Bitmap.GetPixel(0, $Bitmap.Height - 1),
      $Bitmap.GetPixel($Bitmap.Width - 1, $Bitmap.Height - 1)
    )
    $TransparentCorners = @($CornerPixels | Where-Object { $_.A -lt 16 }).Count
    if ($TransparentCorners -lt 3) {
      throw "$Label is still a square icon; expected transparent rounded corners."
    }
  } finally {
    $Bitmap.Dispose()
  }
}

function Export-AssociatedIcon {
  param(
    [string]$ExecutablePath,
    [string]$OutputPath,
    [string]$Label
  )

  $Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExecutablePath)
  if (-not $Icon) {
    throw "Could not extract associated icon for ${Label}: $ExecutablePath"
  }

  try {
    $Bitmap = $Icon.ToBitmap()
    try {
      $Bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $Bitmap.Dispose()
    }
  } finally {
    $Icon.Dispose()
  }

  Assert-ScreenshotHasContent $OutputPath "$Label associated icon"
  Assert-GloomberbIconImage $OutputPath "$Label associated icon"
  Assert-IconHasTransparentCorners $OutputPath "$Label associated icon"
}

function Assert-WindowsUpdateManifest {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    throw "Missing Windows desktop update manifest: $Path"
  }

  $Manifest = Get-Content $Path -Raw | ConvertFrom-Json
  if ($Manifest.version -ne $PackageJson.version) {
    throw "Windows update manifest version mismatch: expected $($PackageJson.version), got $($Manifest.version)"
  }
  if ($Manifest.platform -ne "win") {
    throw "Windows update manifest platform mismatch: expected win, got $($Manifest.platform)"
  }
  if ($Manifest.arch -ne "x64") {
    throw "Windows update manifest arch mismatch: expected x64, got $($Manifest.arch)"
  }
  if ([string]::IsNullOrWhiteSpace([string]$Manifest.hash)) {
    throw "Windows update manifest is missing the bundle hash."
  }
}

function Get-WindowIconHandle {
  param([object]$Window)

  $Handle = [IntPtr]::new([long]$Window.Handle)
  $WmGetIcon = [uint32]0x007F
  foreach ($IconType in @(2, 0, 1)) {
    $IconHandle = [GloomberbWin32]::SendMessage($Handle, $WmGetIcon, [IntPtr]::new([int]$IconType), [IntPtr]::Zero)
    if ($IconHandle -ne [IntPtr]::Zero) {
      return $IconHandle
    }
  }

  foreach ($ClassIndex in @(-34, -14)) {
    $IconHandle = [GloomberbWin32]::GetClassLongPtrCompat($Handle, $ClassIndex)
    if ($IconHandle -ne [IntPtr]::Zero) {
      return $IconHandle
    }
  }

  return [IntPtr]::Zero
}

function Export-WindowIcon {
  param(
    [object]$Window,
    [string]$OutputPath,
    [string]$Label
  )

  $IconHandle = Get-WindowIconHandle $Window
  if ($IconHandle -eq [IntPtr]::Zero) {
    throw "Could not read window icon handle for ${Label}."
  }

  $IconCopy = [GloomberbWin32]::CopyIcon($IconHandle)
  if ($IconCopy -eq [IntPtr]::Zero) {
    throw "Could not copy window icon handle for ${Label}."
  }

  try {
    $Icon = [System.Drawing.Icon]::FromHandle($IconCopy)
    try {
      $Bitmap = $Icon.ToBitmap()
      try {
        $Bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $Bitmap.Dispose()
      }
    } finally {
      $Icon.Dispose()
    }
  } finally {
    [void][GloomberbWin32]::DestroyIcon($IconCopy)
  }

  Assert-ScreenshotHasContent $OutputPath "$Label window icon"
  Assert-GloomberbIconImage $OutputPath "$Label window icon"
  Assert-IconHasTransparentCorners $OutputPath "$Label window icon"
}

function Resolve-HomeDir {
  if ($env:HOME) {
    return $env:HOME
  }
  if ($env:USERPROFILE) {
    return $env:USERPROFILE
  }
  throw "Could not resolve Windows home directory for desktop config seeding."
}

function Get-GlobalConfigPath {
  $HomeDir = Resolve-HomeDir
  Join-Path (Join-Path $HomeDir ".gloomberb") "config.json"
}

function Stop-ProcessIds {
  param([object[]]$ProcessIds)

  foreach ($ProcessId in ($ProcessIds | Sort-Object -Unique)) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $ProcessId -Timeout 10 -ErrorAction SilentlyContinue
  }
}

function Write-JsonFile {
  param(
    [string]$Path,
    [hashtable]$Value
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $Value |
    ConvertTo-Json -Depth 8 |
    Set-Content -Path $Path -Encoding UTF8
}

function Seed-DesktopConfig {
  $GlobalConfigPath = Get-GlobalConfigPath
  $GlobalConfigDir = Split-Path -Parent $GlobalConfigPath
  if (Test-Path $GlobalConfigPath) {
    throw "Refusing to overwrite existing Gloomberb config during Windows verification: $GlobalConfigPath"
  }

  $DataDir = Join-Path $env:TEMP "GloomberbDesktopData-$PID"
  $DataConfigPath = Join-Path $DataDir "config.json"
  $Layout = @{
    dockRoot = @{
      kind = "pane"
      instanceId = "portfolio-list:main"
    }
    instances = @(
      @{
        instanceId = "portfolio-list:main"
        paneId = "portfolio-list"
        title = "Main Portfolio"
        params = @{ collectionId = "main" }
        binding = @{ kind = "none" }
      },
      @{
        instanceId = "portfolio-list:watchlist"
        paneId = "portfolio-list"
        title = "Detached Watchlist"
        params = @{ collectionId = "watchlist" }
        binding = @{ kind = "none" }
      }
    )
    floating = @()
    detached = @(
      @{
        instanceId = "portfolio-list:watchlist"
        x = 96
        y = 96
        width = 760
        height = 460
      }
    )
  }
  Write-JsonFile $GlobalConfigPath @{ dataDir = $DataDir }
  Write-JsonFile $DataConfigPath @{
    dataDir = $DataDir
    onboardingComplete = $true
    layout = $Layout
    layouts = @(
      @{
        name = "Verification"
        layout = $Layout
        paneState = @{}
        focusedPaneId = "portfolio-list:main"
        activePanel = "left"
      }
    )
    activeLayoutIndex = 0
  }

  [pscustomobject]@{
    DataDir = $DataDir
    GlobalConfigPath = $GlobalConfigPath
  }
}

function Restore-EnvironmentVariable {
  param(
    [string]$Name,
    [AllowNull()]
    [string]$Value
  )

  if ($null -eq $Value) {
    Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item -Path "Env:$Name" -Value $Value
  }
}

function Capture-OnboardingScreenshot {
  param(
    [string]$InstallDir,
    [string]$OutputPath
  )

  $OnboardingHome = Join-Path $env:TEMP "GloomberbOnboardingHome-$PID"
  $OnboardingProcess = $null
  $OnboardingWindowProcessIds = @()
  $PreviousHome = $env:HOME
  $PreviousUserProfile = $env:USERPROFILE
  $PreviousElectrobunConsole = $env:ELECTROBUN_CONSOLE

  if (Test-Path $OnboardingHome) {
    Remove-Item -Path $OnboardingHome -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $OnboardingHome | Out-Null

  try {
    $env:HOME = $OnboardingHome
    $env:USERPROFILE = $OnboardingHome
    $env:ELECTROBUN_CONSOLE = "1"

    $InitialWindows = @(Get-VisibleWindows)
    $InitialWindowHandles = New-WindowHandleSet $InitialWindows
    Save-WindowInventory (Join-Path $GuiArtifactDir "windows-onboarding-before-launch.txt")

    $OnboardingProcess = Start-Process `
      -FilePath (Join-Path $InstallDir "bin\launcher.exe") `
      -WorkingDirectory (Join-Path $InstallDir "bin") `
      -PassThru
    $OnboardingWindows = @(Wait-ForNewWindows `
      -KnownHandles $InitialWindowHandles `
      -MinimumCount 1 `
      -Label "Gloomberb onboarding window")
    $OnboardingWindowProcessIds += $OnboardingProcess.Id
    $OnboardingWindowProcessIds += @($OnboardingWindows | Select-Object -ExpandProperty Id | Where-Object { $_ })

    Save-WindowInventory (Join-Path $GuiArtifactDir "windows-onboarding-after-launch.txt")
    $null = Capture-WindowScreenshotByTitle `
      -Title "Gloomberb" `
      -Path $OutputPath `
      -Label "Onboarding window" `
      -InitialDelaySeconds 8
  } finally {
    Stop-ProcessIds $OnboardingWindowProcessIds

    if ($OnboardingProcess -and -not $OnboardingProcess.HasExited) {
      Stop-Process -Id $OnboardingProcess.Id -Force -ErrorAction SilentlyContinue
    }

    Restore-EnvironmentVariable "HOME" $PreviousHome
    Restore-EnvironmentVariable "USERPROFILE" $PreviousUserProfile
    Restore-EnvironmentVariable "ELECTROBUN_CONSOLE" $PreviousElectrobunConsole
    Remove-Item -Path $OnboardingHome -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$RequiredPaths = @(
  (Join-Path $BundleDir "bin\launcher.exe"),
  (Join-Path $BundleDir "bin\bun.exe"),
  (Join-Path $BundleDir "bin\gloomberb.cmd"),
  $BundleAppIconPath,
  $BundleLogoIconPath,
  (Join-Path $BundleDir "Resources\gloomberb-tui\tui-entry.js"),
  (Join-Path $CoreDir "index.js"),
  (Join-Path $Root "artifacts\stable-win-x64-Gloomberb-Setup.zip"),
  (Join-Path $Root "artifacts\stable-win-x64-Gloomberb.tar.zst"),
  $UpdateManifestPath,
  $InstallerPath
)

foreach ($Path in $RequiredPaths) {
  if (-not (Test-Path $Path)) {
    throw "Missing expected Windows desktop file: $Path"
  }
}

Assert-WindowsUpdateManifest $UpdateManifestPath
Assert-IcoFile $BundleAppIconPath "Bundled app icon"
Assert-IcoFile $BundleLogoIconPath "Bundled logo icon"
Export-AssociatedIcon `
  -ExecutablePath (Join-Path $BundleDir "bin\launcher.exe") `
  -OutputPath (Join-Path $GuiArtifactDir "windows-icon-launcher.png") `
  -Label "Launcher"
Export-AssociatedIcon `
  -ExecutablePath (Join-Path $BundleDir "bin\bun.exe") `
  -OutputPath (Join-Path $GuiArtifactDir "windows-icon-bun.png") `
  -Label "TUI runtime"
Export-AssociatedIcon `
  -ExecutablePath $InstallerPath `
  -OutputPath (Join-Path $GuiArtifactDir "windows-icon-installer.png") `
  -Label "Installer"

$NativeLibraries = Get-ChildItem -Path $CoreDir -Filter "*.dll" -File -ErrorAction SilentlyContinue
if (-not $NativeLibraries) {
  throw "Missing OpenTUI Windows native DLL in $CoreDir"
}

& (Join-Path $BundleDir "bin\gloomberb.cmd") help
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$InstallDir = Join-Path $env:TEMP "GloomberbInstall-$PID"
$InstallLog = Join-Path $env:TEMP "gloomberb-install-$PID.log"
$UninstallLog = Join-Path $env:TEMP "gloomberb-uninstall-$PID.log"
$GuiProcess = $null
$LaunchedWindowProcessIds = @()
$SeededDesktopConfig = $null

try {
  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
  }

  $InstallProcess = Start-Process `
    -FilePath $InstallerPath `
    -ArgumentList @(
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NORESTART",
      "/CURRENTUSER",
      "/DIR=$InstallDir",
      "/LOG=$InstallLog"
    ) `
    -Wait `
    -PassThru
  if ($InstallProcess.ExitCode -ne 0) {
    Get-Content $InstallLog -ErrorAction SilentlyContinue
    exit $InstallProcess.ExitCode
  }

  $InstalledCli = Join-Path $InstallDir "bin\gloomberb.cmd"
  if (-not (Test-Path $InstalledCli)) {
    Get-Content $InstallLog -ErrorAction SilentlyContinue
    Get-ChildItem -Path $InstallDir -Recurse -Depth 3 -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName
    throw "Installed TUI command was not found: $InstalledCli"
  }

  & $InstalledCli help
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  Capture-OnboardingScreenshot `
    -InstallDir $InstallDir `
    -OutputPath (Join-Path $GuiArtifactDir "windows-gui-onboarding.png")

  $SeededDesktopConfig = Seed-DesktopConfig

  $env:ELECTROBUN_CONSOLE = "1"
  $InitialWindows = @(Get-VisibleWindows)
  $InitialWindowHandles = New-WindowHandleSet $InitialWindows
  Save-WindowInventory (Join-Path $GuiArtifactDir "windows-before-launch.txt")

  $GuiProcess = Start-Process `
    -FilePath (Join-Path $InstallDir "bin\launcher.exe") `
    -WorkingDirectory (Join-Path $InstallDir "bin") `
    -PassThru
  $LaunchedWindows = @(Wait-ForNewWindows `
    -KnownHandles $InitialWindowHandles `
    -MinimumCount 2 `
    -Label "Gloomberb main and detached windows")
  $LaunchedWindowProcessIds += $GuiProcess.Id
  $LaunchedWindowProcessIds += @($LaunchedWindows | Select-Object -ExpandProperty Id)

  $MainWindow = $LaunchedWindows | Where-Object { $_.MainWindowTitle -eq "Gloomberb" } | Select-Object -First 1
  $DetachedWindow = $LaunchedWindows | Where-Object { $_.MainWindowTitle -eq "Detached Watchlist" } | Select-Object -First 1
  if (-not $MainWindow) {
    throw "Could not find the Gloomberb main window in the Windows GUI smoke test."
  }
  if (-not $DetachedWindow) {
    throw "Could not find the detached watchlist window in the Windows GUI smoke test."
  }

  Export-WindowIcon `
    -Window $MainWindow `
    -OutputPath (Join-Path $GuiArtifactDir "windows-window-icon-main.png") `
    -Label "Main window"
  Export-WindowIcon `
    -Window $DetachedWindow `
    -OutputPath (Join-Path $GuiArtifactDir "windows-window-icon-popout.png") `
    -Label "Detached pop-out"

  Assert-CustomWindowControls `
    -Window $DetachedWindow `
    -Label "Detached pop-out"

  Save-WindowInventory (Join-Path $GuiArtifactDir "windows-after-launch.txt")

  $MainScreenshot = Join-Path $GuiArtifactDir "windows-gui-main.png"
  $MainWindow = Capture-WindowScreenshotByTitle `
    -Title "Gloomberb" `
    -Path $MainScreenshot `
    -Label "Main window" `
    -InitialDelaySeconds 8

  $PopOutScreenshot = Join-Path $GuiArtifactDir "windows-gui-popout.png"
  $DetachedWindow = Capture-WindowScreenshotByTitle `
    -Title "Detached Watchlist" `
    -Path $PopOutScreenshot `
    -Label "Detached pop-out"

  $DesktopScreenshot = Join-Path $GuiArtifactDir "windows-gui-desktop.png"
  Capture-DesktopScreenshot $DesktopScreenshot
  Assert-ScreenshotHasContent $DesktopScreenshot "Windows desktop"

  Resolve-VisibleWindowByTitle -Title "Gloomberb" -Label "Main window liveness" | Out-Null
  Resolve-VisibleWindowByTitle -Title "Detached Watchlist" -Label "Detached pop-out liveness" | Out-Null

  $GuiProcess.Refresh()
  if ($GuiProcess.HasExited -and $GuiProcess.ExitCode -ne 0) {
    throw "Windows GUI exited during smoke test with code $($GuiProcess.ExitCode)"
  }
} catch {
  try {
    Capture-DesktopScreenshot (Join-Path $GuiArtifactDir "windows-gui-failure.png")
  } catch {
    Write-Host "Could not capture Windows GUI failure screenshot: $($_.Exception.Message)"
  }
  try {
    Save-WindowInventory (Join-Path $GuiArtifactDir "windows-failure.txt")
  } catch {
    Write-Host "Could not capture Windows GUI failure window inventory: $($_.Exception.Message)"
  }
  throw
} finally {
  Stop-ProcessIds $LaunchedWindowProcessIds

  if ($GuiProcess -and -not $GuiProcess.HasExited) {
    Stop-Process -Id $GuiProcess.Id -Force -ErrorAction SilentlyContinue
  }

  if ($SeededDesktopConfig) {
    Remove-Item -Path $SeededDesktopConfig.GlobalConfigPath -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $SeededDesktopConfig.DataDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  $Uninstaller = Get-ChildItem -Path $InstallDir -Filter "unins*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($Uninstaller) {
    & $Uninstaller.FullName /VERYSILENT /SUPPRESSMSGBOXES /NORESTART "/LOG=$UninstallLog"
  }
}
