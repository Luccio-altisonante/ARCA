param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
if ($output -eq $root -or $output.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "La build offline deve restare fuori dal repository."
}
if (Test-Path -LiteralPath $output) {
    throw "Scegliere una nuova directory di build."
}

$gcc = (Get-Command gcc -ErrorAction Stop).Source
$gpp = (Get-Command g++ -ErrorAction Stop).Source
$files = @(
    "core/sillabe.cpp", "core/sillabe.hpp", "core/unicode.cpp", "core/unicode.hpp",
    "third_party/utf8proc/utf8proc.c", "third_party/utf8proc/utf8proc.h",
    "third_party/utf8proc/utf8proc_data.c", "tools/conta_sillabe_batch.cpp"
)
$hashes = [ordered]@{}
foreach ($file in $files) {
    $hashes[$file] = (Get-FileHash -LiteralPath (Join-Path $root $file) -Algorithm SHA256).Hash.ToLowerInvariant()
}

New-Item -ItemType Directory -Path $output | Out-Null
$object = Join-Path $output "utf8proc.o"
$runner = Join-Path $output "conta_sillabe_batch.exe"
$includeCore = "-I" + (Join-Path $root "core")
$includeUtf8 = "-I" + (Join-Path $root "third_party/utf8proc")
& $gcc -std=c99 -O2 -DUTF8PROC_STATIC $includeUtf8 -c (Join-Path $root "third_party/utf8proc/utf8proc.c") -o $object
if ($LASTEXITCODE -ne 0) { throw "Compilazione utf8proc fallita." }
& $gpp -std=c++17 -O2 -Wall -Wextra -DUTF8PROC_STATIC $includeCore $includeUtf8 `
    (Join-Path $root "tools/conta_sillabe_batch.cpp") (Join-Path $root "core/sillabe.cpp") `
    (Join-Path $root "core/unicode.cpp") $object -o $runner
if ($LASTEXITCODE -ne 0) { throw "Compilazione runner fallita." }
foreach ($file in $files) {
    $current = (Get-FileHash -LiteralPath (Join-Path $root $file) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($current -ne $hashes[$file]) { throw "Sorgente cambiato durante la build: $file" }
}
$manifest = [ordered]@{
    schema_version = 1
    runner_sha256 = (Get-FileHash -LiteralPath $runner -Algorithm SHA256).Hash.ToLowerInvariant()
    sorgenti = $hashes
    compilatori = @{ c = $gcc; cpp = $gpp }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath ($runner + ".build.json") -Encoding utf8
Write-Output $runner
