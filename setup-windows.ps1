# Dilly — one-time setup on Windows. Run from the folder that contains dilly.bundle:
#   powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1 -RepoUrl https://github.com/<you>/dilly.git
param([string]$RepoUrl = "")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here "dilly"

foreach ($cmd in @("git", "node", "npm")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd is not installed. Install Git for Windows and Node.js 22 LTS, then re-run." }
}
if (Test-Path $target) { throw "$target already exists — move it or delete it first." }

Write-Host "== Cloning from bundle (full history)"
git clone (Join-Path $here "dilly.bundle") $target
Set-Location $target
git branch -M main
git remote remove origin 2>$null

if ($RepoUrl) {
  Write-Host "== Pushing to $RepoUrl"
  git remote add origin $RepoUrl
  git push -u origin main
} else {
  Write-Host "== No -RepoUrl given: create an empty GitHub repo, then run:"
  Write-Host "   git remote add origin https://github.com/<you>/dilly.git; git push -u origin main"
}

Write-Host "== Installing packages"
npm install

if (-not (Test-Path ".env.local")) { Copy-Item ".env.example" ".env.local"; Write-Host "== Created .env.local — fill in Supabase keys after creating the project" }

if (Get-Command code -ErrorAction SilentlyContinue) { code . } else { Write-Host "Open $target in VS Code (File > Open Folder)." }
Write-Host "Done."
