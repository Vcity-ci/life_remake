#requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host "[start] $Message"
}

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command not found: $Name. Please install it and add to PATH."
  }
}

function Need-Install {
  if (-not (Test-Path 'node_modules')) { return $true }
  if (-not (Test-Path 'apps/backend/node_modules')) { return $true }
  if (-not (Test-Path 'apps/frontend/node_modules')) { return $true }
  if (-not (Test-Path 'packages/shared/node_modules')) { return $true }
  if (-not (Test-Path 'package-lock.json')) { return $true }

  $pkgTime = (Get-Item 'package.json').LastWriteTimeUtc
  $lockTime = (Get-Item 'package-lock.json').LastWriteTimeUtc
  if ($pkgTime -gt $lockTime) { return $true }

  return $false
}

Assert-Command 'node'
Assert-Command 'npm'

if (Need-Install) {
  Write-Step 'Dependencies are missing or outdated. Running npm install...'
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw 'npm install failed.'
  }
} else {
  Write-Step 'Dependencies are ready. Skipping install.'
}

if (-not (Test-Path 'apps/backend/.env')) {
  Write-Step 'apps/backend/.env not found. Creating from template...'
  Copy-Item 'apps/backend/.env.example' 'apps/backend/.env'
}

Write-Step 'Starting dev servers...'
npm run dev
