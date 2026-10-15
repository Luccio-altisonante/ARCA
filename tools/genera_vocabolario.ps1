param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$InputDump,

    [Parameter(Position = 1)]
    [string]$OutputVocabulary,

    [string]$ReportJson
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputVocabulary) {
    $OutputVocabulary = Join-Path $projectRoot "VocabolarioItaliano.txt"
}
if (-not $ReportJson) {
    $ReportJson = Join-Path $projectRoot "report-vocabolario.json"
}

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCommand) {
    $python = $pythonCommand.Source
} elseif (Test-Path -LiteralPath "C:\emsdk\python\3.13.3_64bit\python.exe") {
    $python = "C:\emsdk\python\3.13.3_64bit\python.exe"
} else {
    throw "Python 3 non trovato."
}

$compilerCommand = Get-Command g++ -ErrorAction SilentlyContinue
if (-not $compilerCommand) {
    throw "g++ non trovato."
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("anagrammi-vocabolario-" + [guid]::NewGuid())
$extractedVocabulary = Join-Path $temporaryDirectory "vocabolario-estratto.txt"
$extractionReport = Join-Path $temporaryDirectory "report-estrazione.json"
$orderingTool = Join-Path $temporaryDirectory "ordina_vocabolario.exe"

New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
try {
    & $python `
        (Join-Path $PSScriptRoot "genera_vocabolario_wiktionary.py") `
        $InputDump `
        $extractedVocabulary `
        --report-json $extractionReport
    if ($LASTEXITCODE -ne 0) {
        throw "L'estrazione Wiktionary e' terminata con codice $LASTEXITCODE."
    }

    & $compilerCommand.Source `
        -std=c++17 `
        -O2 `
        (Join-Path $PSScriptRoot "ordina_vocabolario.cpp") `
        (Join-Path $projectRoot "core\ordinamento_rimario.cpp") `
        -o $orderingTool
    if ($LASTEXITCODE -ne 0) {
        throw "La compilazione dell'ordinatore e' terminata con codice $LASTEXITCODE."
    }

    $outputParent = Split-Path -Parent ([System.IO.Path]::GetFullPath($OutputVocabulary))
    New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
    & $orderingTool $extractedVocabulary $OutputVocabulary
    if ($LASTEXITCODE -ne 0) {
        throw "L'ordinamento rimario e' terminato con codice $LASTEXITCODE."
    }

    $report = Get-Content -LiteralPath $extractionReport -Raw | ConvertFrom-Json
    $report.output = [System.IO.Path]::GetFullPath($OutputVocabulary)
    $report.output_sha256 = (Get-FileHash -LiteralPath $OutputVocabulary -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.dimensione_output_byte = (Get-Item -LiteralPath $OutputVocabulary).Length
    $report | Add-Member -NotePropertyName ordinamento -NotePropertyValue "rimario legacy del progetto (core/ordinamento_rimario.cpp)"

    $reportPath = [System.IO.Path]::GetFullPath($ReportJson)
    New-Item -ItemType Directory -Path (Split-Path -Parent $reportPath) -Force | Out-Null
    $json = $report | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText(
        $reportPath,
        $json + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false))

    Write-Host "Vocabolario generato: $([System.IO.Path]::GetFullPath($OutputVocabulary))"
    Write-Host "Report generato: $reportPath"
} finally {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $resolvedTemporary = [System.IO.Path]::GetFullPath($temporaryDirectory)
    if ($resolvedTemporary.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $resolvedTemporary)) {
        Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
    }
}
