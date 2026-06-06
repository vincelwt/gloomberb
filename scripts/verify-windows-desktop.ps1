$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BundleDir = Join-Path $Root "build\stable-win-x64\Gloomberb-inno-source\Gloomberb"
$CoreDir = Join-Path $BundleDir "Resources\gloomberb-tui\node_modules\@opentui\core-win32-x64"
$InstallerPath = Join-Path $Root "artifacts\stable-win-x64-GloomberbSetup.exe"
$GuiArtifactDir = Join-Path $Root "artifacts\windows-gui-verification"

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
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out GloomberbWindowRect rect);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
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

  Get-VisibleWindows |
    Where-Object { $_.MainWindowTitle -eq $Title } |
    Select-Object -First 1
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

$RequiredPaths = @(
  (Join-Path $BundleDir "bin\launcher.exe"),
  (Join-Path $BundleDir "bin\bun.exe"),
  (Join-Path $BundleDir "bin\gloomberb.cmd"),
  (Join-Path $BundleDir "Resources\gloomberb-tui\tui-entry.js"),
  (Join-Path $CoreDir "index.js"),
  (Join-Path $Root "artifacts\stable-win-x64-Gloomberb-Setup.zip"),
  (Join-Path $Root "artifacts\stable-win-x64-Gloomberb.tar.zst"),
  (Join-Path $Root "artifacts\stable-win-x64-update.json"),
  $InstallerPath
)

foreach ($Path in $RequiredPaths) {
  if (-not (Test-Path $Path)) {
    throw "Missing expected Windows desktop file: $Path"
  }
}

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

  Save-WindowInventory (Join-Path $GuiArtifactDir "windows-after-launch.txt")
  $MainWindow = Get-VisibleWindowByTitle "Gloomberb"
  $DetachedWindow = Get-VisibleWindowByTitle "Detached Watchlist"
  if (-not $MainWindow) {
    throw "Could not find the Gloomberb main window in the Windows GUI smoke test."
  }
  if (-not $DetachedWindow) {
    throw "Could not find the detached watchlist window in the Windows GUI smoke test."
  }

  Capture-DesktopScreenshot (Join-Path $GuiArtifactDir "windows-gui-desktop.png")

  $PopOutScreenshot = Join-Path $GuiArtifactDir "windows-gui-popout.png"
  $DetachedWindow = Capture-WindowScreenshotByTitle `
    -Title "Detached Watchlist" `
    -Path $PopOutScreenshot `
    -Label "Detached pop-out"

  $MainScreenshot = Join-Path $GuiArtifactDir "windows-gui-main.png"
  $MainWindow = Capture-WindowScreenshotByTitle `
    -Title "Gloomberb" `
    -Path $MainScreenshot `
    -Label "Main window" `
    -InitialDelaySeconds 8

  $GuiProcess.Refresh()
  if ($GuiProcess.HasExited) {
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
