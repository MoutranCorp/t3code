param(
    [switch]$Install,
    [switch]$Login,
    [switch]$Desktop
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$toolRoot = 'P:\.caches\t3-tooling'
$env:PNPM_HOME = 'P:\.caches\pnpm-home'
$env:npm_config_cache = 'P:\.caches\npm-cache'
$env:npm_config_manage_package_manager_versions = 'false'
$env:ELECTRON_CACHE = 'P:\.caches\electron'
$env:XDG_CACHE_HOME = 'P:\.caches\home-cache'
$env:TEMP = 'P:\.tmp\agents'
$env:TMP = $env:TEMP
$env:T3CODE_HOME = Join-Path $PSScriptRoot '.t3'
$env:KIMI_CODE_HOME = Join-Path $env:T3CODE_HOME 'kimi'
$env:T3CODE_DEV_SEED = '0'

if ($Install) {
    & npm.cmd install --prefix $toolRoot pnpm@12.14.0 node@26.12.1 --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Tooling installation failed.' }
}

$env:PATH = "$toolRoot\node_modules\node\bin;$toolRoot\node_modules\.bin;$PSScriptRoot\node_modules\.bin;$env:PATH"
if (!(Test-Path "$toolRoot\node_modules\node\bin\node.exe")) {
    throw 'Run .\Start-T3Fork.ps1 -Install first.'
}
if ($Install) {
    & pnpm.cmd install --frozen-lockfile --store-dir 'P:\.caches\pnpm-store'
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
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
