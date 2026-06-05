$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodeDir = Join-Path $root ".tools\node"
$gitDir = Join-Path $root ".tools\git\cmd"
$npm = Join-Path $nodeDir "npm.cmd"

if (Test-Path $nodeDir) {
  $env:PATH = "$nodeDir;$env:PATH"
}

if (Test-Path $gitDir) {
  $env:PATH = "$gitDir;$env:PATH"
}

if (-not (Test-Path $npm)) {
  $npm = "npm"
}

Push-Location $root
try {
  & $npm exec -- tsx scripts/smoke-api-repository.ts
} finally {
  Pop-Location
}
