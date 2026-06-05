$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodeDir = Join-Path $root ".tools\node"
$gitDir = Join-Path $root ".tools\git\cmd"

if (Test-Path $nodeDir) {
  $env:PATH = "$nodeDir;$env:PATH"
}

if (Test-Path $gitDir) {
  $env:PATH = "$gitDir;$env:PATH"
}

Write-Host "Project: $root"
Write-Host ""

Write-Host "Node:"
node --version

Write-Host "npm:"
& (Join-Path $nodeDir "npm.cmd") --version

Write-Host "Git:"
git --version

Write-Host "Docker:"
try {
  docker --version
  docker compose version
} catch {
  Write-Host "Docker is not available. Install Docker Desktop to run Postgres and Redis from docker-compose.yml."
}

Write-Host ""
Write-Host "Use this PowerShell command before local development:"
Write-Host "`$env:PATH = `"$nodeDir;$gitDir;`$env:PATH`""
