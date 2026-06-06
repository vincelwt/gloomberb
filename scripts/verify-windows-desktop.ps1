$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BundleDir = Join-Path $Root "build\stable-win-x64\Gloomberb-inno-source\Gloomberb"
$CoreDir = Join-Path $BundleDir "Resources\gloomberb-tui\node_modules\@opentui\core-win32-x64"
$InstallerPath = Join-Path $Root "artifacts\stable-win-x64-GloomberbSetup.exe"

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

  $env:ELECTROBUN_CONSOLE = "1"
  $GuiProcess = Start-Process `
    -FilePath (Join-Path $InstallDir "bin\launcher.exe") `
    -WorkingDirectory (Join-Path $InstallDir "bin") `
    -PassThru
  Start-Sleep -Seconds 8
  $GuiProcess.Refresh()
  if ($GuiProcess.HasExited) {
    throw "Windows GUI exited during smoke test with code $($GuiProcess.ExitCode)"
  }
} finally {
  if ($GuiProcess -and -not $GuiProcess.HasExited) {
    Stop-Process -Id $GuiProcess.Id -Force -ErrorAction SilentlyContinue
  }

  $Uninstaller = Get-ChildItem -Path $InstallDir -Filter "unins*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($Uninstaller) {
    & $Uninstaller.FullName /VERYSILENT /SUPPRESSMSGBOXES /NORESTART "/LOG=$UninstallLog"
  }
}
