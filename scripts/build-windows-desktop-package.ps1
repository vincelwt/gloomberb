$ErrorActionPreference = "Stop"

$MaxAttempts = 3

for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt += 1) {
  Write-Host "Building Windows desktop package (attempt $Attempt of $MaxAttempts)..."
  & bun run desktop:release:windows
  if ($LASTEXITCODE -eq 0) {
    exit 0
  }

  if ($Attempt -eq $MaxAttempts) {
    exit $LASTEXITCODE
  }

  $DelaySeconds = 10 * $Attempt
  Write-Host "Windows desktop package build failed with exit code $LASTEXITCODE. Retrying in $DelaySeconds seconds..."
  Start-Sleep -Seconds $DelaySeconds
}
