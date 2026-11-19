param(
    [switch]$Install,
    [switch]$Login,
    [switch]$Desktop,
    [switch]$Shortcut
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($Shortcut) {
    $linkPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'Facio.lnk'
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($linkPath)
    $link.TargetPath = Join-Path $PSHOME 'powershell.exe'
    $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$PSCommandPath`" -Desktop"
    $link.WorkingDirectory = $PSScriptRoot
    $link.IconLocation = Join-Path $PSScriptRoot 'assets\prod\t3-black-windows.ico'
    $link.Description = 'Facio desktop app'
    $link.Save()
    Write-Host "Created $linkPath"
    exit 0
}
$cacheRoot = if (Test-Path 'P:\') { 'P:\.caches' } else { Join-Path $env:LOCALAPPDATA 'facio-caches' }
$tempRoot = if (Test-Path 'P:\') { 'P:\.tmp\agents' } else { Join-Path $cacheRoot 'tmp' }
New-Item -ItemType Directory -Force -Path $cacheRoot, $tempRoot | Out-Null

$toolRoot = Join-Path $cacheRoot 't3-tooling'
$rustToolchain = '1.95.0'
$env:PNPM_HOME = Join-Path $cacheRoot 'pnpm-home'
$env:npm_config_cache = Join-Path $cacheRoot 'npm-cache'
$env:npm_config_manage_package_manager_versions = 'false'
$env:ELECTRON_CACHE = Join-Path $cacheRoot 'electron'
$env:XDG_CACHE_HOME = Join-Path $cacheRoot 'home-cache'
$env:TEMP = $tempRoot
$env:TMP = $env:TEMP
$env:T3CODE_HOME = Join-Path $PSScriptRoot '.t3'
$env:KIMI_CODE_HOME = Join-Path $env:T3CODE_HOME 'kimi'
$env:T3CODE_DEV_SEED = '0'
$env:T3CODE_TELEMETRY_ENABLED = '0'

if ($Install) {
    & npm.cmd install --prefix $toolRoot pnpm@12.14.0 node@26.13.1 --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Tooling installation failed.' }
}

$env:PATH = "$toolRoot\node_modules\node\bin;$toolRoot\node_modules\.bin;$PSScriptRoot\node_modules\.bin;$env:PATH"
if (!(Test-Path "$toolRoot\node_modules\node\bin\node.exe")) {
    throw 'Run .\Start-T3Fork.ps1 -Install first.'
}
if ($Install) {
    & pnpm.cmd install --frozen-lockfile --store-dir (Join-Path $cacheRoot 'pnpm-store')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    # Without the native monitor the server polls terminal processes with exponential backoff.
    & rustup.exe toolchain install $rustToolchain --profile minimal
    & rustup.exe run $rustToolchain cargo build --locked --release --manifest-path native\resource-monitor\Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Resource monitor build failed.' }
}

if ($Login) {
    & kimi login
    if ($LASTEXITCODE -ne 0) { throw 'Kimi sign-in failed.' }
    $configPath = Join-Path $env:KIMI_CODE_HOME 'config.toml'
    $kimiConfig = Get-Content -LiteralPath $configPath -Raw
    if ($kimiConfig.Contains('[models."kimi-code/k3.1-pro"]')) {
        $kimiConfig = $kimiConfig -replace '(?m)^default_model = .*$', 'default_model = "kimi-code/k3.1-pro"'
        Set-Content -LiteralPath $configPath -Value $kimiConfig
    }
    exit $LASTEXITCODE
}

$task = if ($Desktop) { 'dev:desktop' } else { 'dev' }
& vp.cmd run $task --home-dir $env:T3CODE_HOME --no-seed
exit $LASTEXITCODE
