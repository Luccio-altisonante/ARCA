$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$emsdkRoot = if ($env:EMSDK) { $env:EMSDK } else { "C:\emsdk" }
$compiler = Join-Path $emsdkRoot "upstream\emscripten\em++.exe"
$cCompiler = Join-Path $emsdkRoot "upstream\emscripten\emcc.exe"
$sourceDictionary = Join-Path $projectRoot "VocabolarioItaliano.txt"
$datasetDocumentation = Join-Path $projectRoot "DATASET.md"
$dataDirectory = Join-Path $PSScriptRoot "data"
$webDictionary = Join-Path $dataDirectory "VocabolarioItaliano.txt"
$runtimeManifestPath = Join-Path $dataDirectory "runtime-sillabe.manifest.json"
$runtimeArtifactPath = $null
$distDirectory = Join-Path $projectRoot "dist"
$distDataDirectory = Join-Path $distDirectory "data"
$emsdkPythonDirectory = Join-Path $emsdkRoot "python"
$emsdkPython = Get-ChildItem -LiteralPath $emsdkPythonDirectory -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "python.exe") } |
    Select-Object -First 1

if (-not (Test-Path -LiteralPath $compiler)) {
    throw "Compilatore Emscripten non trovato in $compiler"
}
if (-not (Test-Path -LiteralPath $cCompiler)) {
    throw "Compilatore C Emscripten non trovato in $cCompiler"
}
if (-not $emsdkPython) {
    throw "Python incluso in Emscripten non trovato in $emsdkPythonDirectory"
}
if (-not (Test-Path -LiteralPath $sourceDictionary)) {
    throw "Vocabolario sorgente non trovato in $sourceDictionary"
}
if (-not (Test-Path -LiteralPath $datasetDocumentation)) {
    throw "Documentazione del dataset non trovata in $datasetDocumentation"
}

function Test-PositiveInteger($value) {
    return ($value -is [ValueType] -and $value -isnot [bool] -and
        $value -gt 0 -and $value -le 9007199254740991 -and [Math]::Truncate($value) -eq $value)
}

$runtimeManifest = Get-Content -LiteralPath $runtimeManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$fields = $runtimeManifest.PSObject.Properties.Name
if (-not $runtimeManifest -or $runtimeManifest -is [array] -or
    $fields -cnotcontains "schema" -or $fields -cnotcontains "disponibile" -or
    -not (Test-PositiveInteger $runtimeManifest.schema) -or $runtimeManifest.schema -ne 1 -or
    $runtimeManifest.disponibile -isnot [bool]) {
    throw "Manifest sillabico: schema o disponibilita' non validi."
}
if ($runtimeManifest.disponibile) {
    $shaPattern = '\A[0-9a-f]{64}\z'
    foreach ($field in "formato", "artifact", "artifact_sha256", "vocabolario_sha256", "numero_grafie") {
        if ($fields -cnotcontains $field) {
            throw "Manifest sillabico: campo obbligatorio mancante: $field"
        }
    }
    if ($runtimeManifest.formato -isnot [string] -or $runtimeManifest.formato -cne "sillabe-bitmap-le-v1" -or
        $runtimeManifest.artifact_sha256 -isnot [string] -or $runtimeManifest.artifact_sha256 -cnotmatch $shaPattern -or
        $runtimeManifest.vocabolario_sha256 -isnot [string] -or $runtimeManifest.vocabolario_sha256 -cnotmatch $shaPattern -or
        -not (Test-PositiveInteger $runtimeManifest.numero_grafie) -or $runtimeManifest.numero_grafie -gt 4294967295 -or
        $runtimeManifest.artifact -isnot [string] -or $runtimeManifest.artifact -cne "runtime-sillabe-$($runtimeManifest.artifact_sha256).bin" -or
        ($fields -contains "dimensione_byte" -and -not (Test-PositiveInteger $runtimeManifest.dimensione_byte)) -or
        ($fields -contains "annotazioni_sha256" -and ($runtimeManifest.annotazioni_sha256 -isnot [string] -or
            $runtimeManifest.annotazioni_sha256 -cnotmatch $shaPattern))) {
        throw "Manifest sillabico: metadati o nome artifact non validi."
    }
    $runtimeArtifactPath = Join-Path $dataDirectory $runtimeManifest.artifact
    if (-not (Test-Path -LiteralPath $runtimeArtifactPath -PathType Leaf)) {
        throw "Artifact sillabico dichiarato ma non trovato: $runtimeArtifactPath"
    }
}

$env:Path = "$($emsdkPython.FullName);$env:Path"

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceDictionary -Destination $webDictionary -Force

$sources = @(
    "$PSScriptRoot\bindings.cpp"
    "$projectRoot\core\testo.cpp"
    "$projectRoot\core\unicode.cpp"
    "$projectRoot\core\sillabe.cpp"
    "$projectRoot\core\sha256.cpp"
    "$projectRoot\core\runtime_sillabe.cpp"
    "$projectRoot\core\profilo_sillabe.cpp"
    "$projectRoot\core\vocabolario.cpp"
    "$projectRoot\core\ordinamento_rimario.cpp"
    "$projectRoot\core\ricerche.cpp"
    "$projectRoot\core\comandi.cpp"
    "$projectRoot\core\api.cpp"
)

$utf8procObject = Join-Path ([System.IO.Path]::GetTempPath()) ("utf8proc-" + [guid]::NewGuid() + ".o")
try {
    & $cCompiler `
        -O2 `
        -DUTF8PROC_STATIC `
        "-ffile-prefix-map=$projectRoot=." `
        -I"$projectRoot\third_party\utf8proc" `
        -c "$projectRoot\third_party\utf8proc\utf8proc.c" `
        -o $utf8procObject
    if ($LASTEXITCODE -ne 0) {
        throw "La compilazione di utf8proc e' terminata con codice $LASTEXITCODE"
    }

    & $compiler `
        -std=c++17 `
        -O2 `
        -DUTF8PROC_STATIC `
        "-ffile-prefix-map=$projectRoot=." `
        -I"$projectRoot\third_party\utf8proc" `
        -fexceptions `
        --bind `
        -sMODULARIZE=1 `
        -sEXPORT_ES6=1 `
        -sEXPORT_NAME=createAnagrammiModule `
        -sENVIRONMENT=web `
        -sALLOW_MEMORY_GROWTH=1 `
        -sDISABLE_EXCEPTION_CATCHING=0 `
        @sources `
        $utf8procObject `
        -o "$PSScriptRoot\anagrammi.js"
    if ($LASTEXITCODE -ne 0) {
        throw "La compilazione WebAssembly e' terminata con codice $LASTEXITCODE"
    }
} finally {
    if (Test-Path -LiteralPath $utf8procObject) {
        Remove-Item -LiteralPath $utf8procObject -Force
    }
}

$resolvedProjectRoot = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$resolvedDist = [System.IO.Path]::GetFullPath($distDirectory)
if (-not $resolvedDist.StartsWith($resolvedProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "La cartella dist deve trovarsi all'interno del progetto: $resolvedDist"
}

function Hash-Bytes([byte[]]$bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Write-Immutable([string]$path, [byte[]]$bytes) {
    if (Test-Path -LiteralPath $path) {
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne (Hash-Bytes $bytes)) {
            throw "URL di release gia' esistente con byte diversi: $path"
        }
        return
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
    [System.IO.File]::WriteAllBytes($path, $bytes)
}

$previousId = $null
$currentInventoryPath = Join-Path $distDirectory "release.json"
if (Test-Path -LiteralPath $currentInventoryPath) {
    $old = Get-Content -LiteralPath $currentInventoryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($old.release_id -is [string] -and $old.release_id -cmatch '\A[0-9a-f]{64}\z') {
        $previousId = $old.release_id
    }
}
New-Item -ItemType Directory -Path $distDataDirectory -Force | Out-Null

$utf8 = New-Object System.Text.UTF8Encoding($false)
$templateBytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "index.html"))
$workerBytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "service-worker.template.js"))
$workerTemplate = $utf8.GetString($workerBytes)
$manifestWeb = Get-Content -LiteralPath (Join-Path $PSScriptRoot "manifest.webmanifest") -Raw -Encoding UTF8 | ConvertFrom-Json
$manifestWeb.start_url = "../../"
$manifestWeb.scope = "../../"
$manifestWeb.id = "../../"
$manifestWebBytes = $utf8.GetBytes(($manifestWeb | ConvertTo-Json -Depth 10))
$iconNames = @(
    "apple-touch-icon.png", "favicon.ico", "icon-16.png", "icon-32.png", "icon-64.png",
    "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png"
)
$files = @{
    "app.js" = Join-Path $PSScriptRoot "app.js"
    "presentazione.js" = Join-Path $PSScriptRoot "presentazione.js"
    "assets/branding/hero-toscana-preview.png" = Join-Path $PSScriptRoot "assets/branding/hero-toscana-preview.png"
    "persistenza.js" = Join-Path $PSScriptRoot "persistenza.js"
    "runtime-sillabe-storage.js" = Join-Path $PSScriptRoot "runtime-sillabe-storage.js"
    "style.css" = Join-Path $PSScriptRoot "style.css"
    "anagrammi.js" = Join-Path $PSScriptRoot "anagrammi.js"
    "anagrammi.wasm" = Join-Path $PSScriptRoot "anagrammi.wasm"
    "data/VocabolarioItaliano.txt" = $sourceDictionary
    "data/coola.json" = Join-Path $dataDirectory "coola.json"
    "DATASET.md" = $datasetDocumentation
    "CREDITS.md" = Join-Path $projectRoot "CREDITS.md"
    "LICENSE" = Join-Path $projectRoot "LICENSE"
    "SILLABE_DATASET.md" = Join-Path $projectRoot "SILLABE_DATASET.md"
    "THIRD_PARTY_NOTICES.md" = Join-Path $projectRoot "THIRD_PARTY_NOTICES.md"
    "papers/ordinamento_arca_paper_it.pdf" = Join-Path $PSScriptRoot "papers/ordinamento_arca_paper_it.pdf"
    "papers/ordinamento_arca_paper_en.pdf" = Join-Path $PSScriptRoot "papers/ordinamento_arca_paper_en.pdf"
    "third_party/utf8proc/LICENSE.md" = Join-Path $projectRoot "third_party/utf8proc/LICENSE.md"
    "third_party/utf8proc/README.md" = Join-Path $projectRoot "third_party/utf8proc/README.md"
    "third_party/emscripten/README.md" = Join-Path $projectRoot "third_party/emscripten/README.md"
    "third_party/emscripten/LICENSE.txt" = Join-Path $projectRoot "third_party/emscripten/LICENSE.txt"
    "third_party/emscripten/musl-COPYRIGHT.txt" = Join-Path $projectRoot "third_party/emscripten/musl-COPYRIGHT.txt"
    "third_party/emscripten/libcxx-LICENSE.txt" = Join-Path $projectRoot "third_party/emscripten/libcxx-LICENSE.txt"
    "third_party/emscripten/libcxxabi-LICENSE.txt" = Join-Path $projectRoot "third_party/emscripten/libcxxabi-LICENSE.txt"
    "third_party/emscripten/compiler-rt-LICENSE.txt" = Join-Path $projectRoot "third_party/emscripten/compiler-rt-LICENSE.txt"
}
foreach ($icon in $iconNames) {
    $files["assets/icons/$icon"] = Join-Path $PSScriptRoot "assets/icons/$icon"
}
$assetBytes = @{}
foreach ($name in $files.Keys) { $assetBytes[$name] = [System.IO.File]::ReadAllBytes($files[$name]) }
$assetBytes["manifest.webmanifest"] = $manifestWebBytes
$names = [string[]]$assetBytes.Keys
[Array]::Sort($names, [StringComparer]::Ordinal)
$inputs = @(
    [ordered]@{ path = "index-template"; size_bytes = $templateBytes.Length; sha256 = Hash-Bytes $templateBytes }
    [ordered]@{ path = "service-worker-template"; size_bytes = $workerBytes.Length; sha256 = Hash-Bytes $workerBytes }
)
$assets = @()
$identity = "anagrammi-release-v1`n"
foreach ($input in $inputs) { $identity += "$($input.path)`t$($input.size_bytes)`t$($input.sha256)`n" }
foreach ($name in $names) {
    $entry = [ordered]@{ path = $name; size_bytes = $assetBytes[$name].Length; sha256 = Hash-Bytes $assetBytes[$name] }
    $assets += $entry
    $identity += "$($entry.path)`t$($entry.size_bytes)`t$($entry.sha256)`n"
}
$releaseId = Hash-Bytes ($utf8.GetBytes($identity))
$releaseRoot = Join-Path $distDirectory "releases"
$releaseDirectory = Join-Path $releaseRoot $releaseId
$html = $utf8.GetString($templateBytes)
foreach ($file in "style.css", "manifest.webmanifest", "app.js", "presentazione.js", "DATASET.md", "CREDITS.md", "LICENSE", "SILLABE_DATASET.md", "THIRD_PARTY_NOTICES.md", "papers/ordinamento_arca_paper_it.pdf", "papers/ordinamento_arca_paper_en.pdf") {
    $html = $html.Replace("./$file", "./releases/$releaseId/$file")
}
$html = $html.Replace("./assets/icons/", "./releases/$releaseId/assets/icons/")
$html = $html.Replace('<head>', "<head>`n    <meta name=`"anagrammi-release`" content=`"$releaseId`">")
$htmlBytes = $utf8.GetBytes($html)
$assets += [ordered]@{ path = "index.html"; size_bytes = $htmlBytes.Length; sha256 = Hash-Bytes $htmlBytes; derived = $true }
$inventory = [ordered]@{ schema = 1; release_id = $releaseId; identity_scheme = "anagrammi-release-v1";
    identity_inputs = $inputs; assets = $assets }
$inventoryJson = $inventory | ConvertTo-Json -Depth 20

foreach ($name in $names) { Write-Immutable (Join-Path $releaseDirectory $name) $assetBytes[$name] }
# La shell usa le copie immutabili; mantieni anche il percorso pubblico richiesto.
$distIconsDirectory = Join-Path $distDirectory "assets/icons"
New-Item -ItemType Directory -Path $distIconsDirectory -Force | Out-Null
foreach ($icon in $iconNames) {
    Copy-Item -LiteralPath $files["assets/icons/$icon"] -Destination (Join-Path $distIconsDirectory $icon) -Force
}
Write-Immutable (Join-Path $releaseDirectory "index.html") $htmlBytes
Write-Immutable (Join-Path $releaseDirectory "release.json") ($utf8.GetBytes($inventoryJson))
[System.IO.File]::WriteAllBytes((Join-Path $distDirectory "index.html"), $htmlBytes)
[System.IO.File]::WriteAllText($currentInventoryPath, $inventoryJson, $utf8)
$worker = $workerTemplate.Replace('__ANAGRAMMI_RELEASE_INVENTORY__', ($inventory | ConvertTo-Json -Compress -Depth 20))
[System.IO.File]::WriteAllText((Join-Path $distDirectory "service-worker.js"), $worker, $utf8)

# Rimuovi solo output legacy conosciuti e vecchie directory di release del nostro build.
foreach ($file in "app.js", "persistenza.js", "style.css", "anagrammi.js", "anagrammi.wasm", "data/VocabolarioItaliano.txt") {
    $legacy = Join-Path $distDirectory $file
    if (Test-Path -LiteralPath $legacy -PathType Leaf) { Remove-Item -LiteralPath $legacy -Force }
}
$resolvedReleaseRoot = [System.IO.Path]::GetFullPath($releaseRoot).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
foreach ($directory in Get-ChildItem -LiteralPath $releaseRoot -Directory) {
    if ($previousId -eq $releaseId) { continue }
    if ($directory.Name -cnotmatch '\A[0-9a-f]{64}\z' -or $directory.Name -eq $releaseId -or $directory.Name -eq $previousId) { continue }
    $target = [System.IO.Path]::GetFullPath($directory.FullName)
    if (-not $target.StartsWith($resolvedReleaseRoot, [StringComparison]::OrdinalIgnoreCase) -or
        ($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw "Directory release non sicura: $target" }
    Remove-Item -LiteralPath $target -Recurse -Force
}
Copy-Item -LiteralPath $runtimeManifestPath -Destination (Join-Path $distDataDirectory "runtime-sillabe.manifest.json") -Force
if ($runtimeArtifactPath) {
    Copy-Item -LiteralPath $runtimeArtifactPath -Destination (Join-Path $distDataDirectory $runtimeManifest.artifact) -Force
}

Write-Host "Creati web\anagrammi.js e web\anagrammi.wasm"
Write-Host "Copiato il vocabolario in web\data\VocabolarioItaliano.txt"
Write-Host "Creata la distribuzione statica in dist\"
Write-Host "Release immutabile: $releaseId"
