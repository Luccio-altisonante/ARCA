// node tests/documentazione_operativa_test.mjs <root> [console-executable]
import assert from "node:assert/strict";
import { readFile, access, mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const read = file => readFile(path.join(root, file), "utf8");
const syllables = await read("tools/sillabe/README.md");
const reviewer = await read("tools/revisore_sillabe/README.md");
const runtime = await read("tools/sillabe/RUNTIME_SILLABE.md");
const consoleSource = await read("console/main.cpp");

function senzaSezioneStorica(text, start, end) {
    const first = text.indexOf(start), last = text.indexOf(end, first + start.length);
    assert(first >= 0 && last > first, "La progettazione storica deve essere delimitata");
    return text.slice(0, first) + text.slice(last);
}
const currentSyllables = senzaSezioneStorica(syllables,
    "### Progettazione storica del revisore e dello scambio", "## Runtime: stato attuale");
const currentRuntime = senzaSezioneStorica(runtime,
    "## Storia della migrazione e benchmark", "## Filtro sillabico personale ibrido");
assert.match(syllables, /quella fase storica, NON lo stato attuale/);
assert.match(runtime, /Snapshot storico precedente all'integrazione C\+\+\/WASM\/web/);
for (const text of [currentSyllables, reviewer, currentRuntime]) {
    assert.doesNotMatch(text, /curatela(?:\s+(?:ufficiale|reale|versionata))*\s+(?:(?:e'|e\u0300|\u00e8|risulta)\s+)?(?:ancora\s+)?vuota/i);
    assert.doesNotMatch(text, /(?:futuro\s+)?merge(?:\s+sul\s+PC)?[^.\n]*non\s+(?:ancora\s+)?(?:(?:e'|\u00e8)\s+)?implementato/i);
    assert.doesNotMatch(text, /nessuna integrazione C\+\+\/WASM\/web|Runtime futuro, non implementato|solo progettazione/i);
    assert.doesNotMatch(text, /Non sono stati creati binding, fetch, filtri UI/i);
    assert.doesNotMatch(text, /C:[\\/]+Users[\\/]|(?:Desktop|Documents)[\\/]|Programmaz|New project|anagrammi_cpp_nuovo|\.codex[\\/]/i);
}
assert.match(currentSyllables, /curatela ufficiale versionata/);
assert.match(currentSyllables, /precedenza sui\s+risultati automatici/);
for (const text of [currentSyllables, reviewer]) {
    assert.match(text, /unisci_proposte_curatela\.py/);
    assert.match(text, /base Git, decisione_base,[\s\S]*?storico e conflitti/);
    assert.match(text, /Non applica automaticamente la candidata/);
}
assert.match(reviewer, /manifesto schema 2/);
assert.match(reviewer, /manifesto e le code JSONL associate sono\s+artefatti esterni e NON sono distribuiti nel repository/);
assert.match(reviewer, /stessa esecuzione verificata/);
assert.match(reviewer, /coerente con la\s+curatela attuale/);
assert.match(reviewer, /Il solo clone non basta/);
assert.match(reviewer, /sostituire il seguente percorso generico/);
assert.match(reviewer, /--manifesto \$manifesto/);
assert.doesNotMatch(reviewer, /anagrammi-annotazioni-v2-83f81cdc-verificata[\\/]manifesto\.json/);
assert(reviewer.includes("[pipeline di annotazione](../sillabe/README.md)"));
assert.match(consoleSource, /"ARCA - versione C\+\+ console\\n"/);
assert.doesNotMatch(consoleSource, /Metti il file accanto all'eseguibile|Anagrammi e non solo - versione C\+\+ console/);

let links = 0;
for (const file of ["README.md", "tools/sillabe/README.md", "tools/sillabe/RUNTIME_SILLABE.md", "tools/revisore_sillabe/README.md"]) {
    for (const [, target] of (await read(file)).matchAll(/\]\(([^)]+)\)/g)) {
        if (/^[a-z]+:|^#/i.test(target)) continue;
        await access(path.resolve(root, path.dirname(file), target.split("#")[0]));
        links++;
    }
}
console.log(`PASS documentazione corrente/storia, R01-R04, portabilita e ${links} link Markdown relativi`);

if (process.argv[3]) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "arca-console-doc-test-"));
    try {
        const a = path.join(temporary, "A"), b = path.join(temporary, "B");
        await mkdir(a); await mkdir(b);
        const executable = path.join(a, path.basename(process.argv[3]));
        await copyFile(path.resolve(process.argv[3]), executable);
        const dictionary = path.join(a, "VocabolarioItaliano.txt");
        await writeFile(dictionary, "roma\nmare\n", "utf8");
        function invoke(cwd, args = []) {
            const result = spawnSync(executable, args, { cwd, input: ":quit\n", encoding: "utf8", windowsHide: true });
            assert.ifError(result.error);
            return result;
        }
        const absent = invoke(b);
        assert.equal(absent.status, 1);
        assert.match(absent.stderr, /directory corrente/);
        assert.match(absent.stderr, /percorso come primo argomento/);
        assert.doesNotMatch(absent.stderr, /accanto all'eseguibile/);
        for (const result of [invoke(a), invoke(b, [dictionary])]) {
            assert.equal(result.status, 0);
            assert.match(result.stdout, /ARCA - versione C\+\+ console/);
            assert.match(result.stdout, /2 parole caricate/);
        }
        const missingPath = path.join(b, "inesistente.txt");
        const missing = invoke(b, [missingPath]);
        assert.equal(missing.status, 1);
        assert(missing.stderr.includes("Vocabolario non trovato o vuoto: " + missingPath));
        const emptyPath = path.join(b, "vuoto.txt");
        await writeFile(emptyPath, "");
        const empty = invoke(b, [emptyPath]);
        assert.equal(empty.status, 1);
        assert(empty.stderr.includes(emptyPath));
        const normal = invoke(root);
        assert.equal(normal.status, 0);
        assert.match(normal.stdout, /ARCA - versione C\+\+ console/);
        assert.match(normal.stdout, /parole caricate da VocabolarioItaliano\.txt/);
        console.log("PASS console reale: cwd diversa, percorso esplicito, file mancante/vuoto, banner e avvio dalla root");
    } finally {
        assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
        await rm(temporary, { recursive: true, force: true });
    }
} else {
    console.log("SKIP processi console: passare il percorso dell'eseguibile come terzo argomento");
}
