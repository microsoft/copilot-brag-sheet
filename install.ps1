<#
.SYNOPSIS
    Install copilot-brag-sheet extension.
.NOTES
    irm https://raw.githubusercontent.com/vidhartbhatia/copilot-brag-sheet/main/install.ps1 | iex
    # or from cloned repo: .\install.ps1
#>

$ErrorActionPreference = "Stop"

$RepoUrl   = "https://github.com/vidhartbhatia/copilot-brag-sheet.git"
$ExtName   = "copilot-brag-sheet"
$CopilotHome = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $env:USERPROFILE ".copilot" }
$TargetDir = Join-Path $CopilotHome "extensions" $ExtName

Write-Host "Installing $ExtName..." -ForegroundColor Cyan
Write-Host ""

# ── Checks ───────────────────────────────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Error "git required"; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "Node.js 18+ required"; exit 1 }

$nodeMajor = [int](node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if ($nodeMajor -lt 18) { Write-Error "Node.js 18+ required (found v$(node --version))"; exit 1 }

# ── Install extension files ──────────────────────────────────────────────────
if (Test-Path $TargetDir) { Remove-Item $TargetDir -Recurse -Force }

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { $PWD.Path }

if (Test-Path (Join-Path $ScriptDir "extension.mjs")) {
    New-Item -ItemType Directory -Path (Join-Path $TargetDir "lib"), (Join-Path $TargetDir "bin") -Force | Out-Null
    Copy-Item (Join-Path $ScriptDir "extension.mjs"), (Join-Path $ScriptDir "package.json"), (Join-Path $ScriptDir "plugin.json") $TargetDir
    Copy-Item (Join-Path $ScriptDir "lib" "*.mjs") (Join-Path $TargetDir "lib")
    Copy-Item (Join-Path $ScriptDir "bin" "*.mjs") (Join-Path $TargetDir "bin")
} else {
    git clone --depth 1 --quiet $RepoUrl $TargetDir
    foreach ($item in @(".git",".github","test","docs","AGENTS.md","CONTRIBUTING.md","ROADMAP.md","CODEOWNERS","CHANGELOG.md","CODE_OF_CONDUCT.md","SECURITY.md","install.sh","install.ps1")) {
        $p = Join-Path $TargetDir $item
        if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

Write-Host "  ✅ Extension installed to $TargetDir" -ForegroundColor Green

# ── Run interactive setup ────────────────────────────────────────────────────
$setupScript = Join-Path $TargetDir "bin" "setup.mjs"
$isInteractive = [Environment]::UserInteractive -and $Host.Name -ne 'ServerRemoteHost'

if ($isInteractive -and (Test-Path $setupScript)) {
    Write-Host ""
    node $setupScript
} else {
    Write-Host ""
    Write-Host "🎉 Installed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next steps:"
    Write-Host "    1. Run the setup wizard:  node $setupScript"
    Write-Host "    2. Run /clear in Copilot CLI"
    Write-Host "    3. Say 'brag' to save an accomplishment"
    Write-Host ""
}
