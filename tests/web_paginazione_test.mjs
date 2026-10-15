// node tests/web_paginazione_test.mjs <modulo.mjs> [repository per sanity benchmark]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = path.resolve(process.argv[2]);
const { default: createModule } = await import(pathToFileURL(modulePath));
const compiled = new WebAssembly.Module(await readFile(modulePath.replace(/\.mjs$/, ".wasm")));
const wasm = await createModule({
    instantiateWasm(imports, receive) {
        const instance = new WebAssembly.Instance(compiled, imports);
        receive(instance);
        return instance.exports;
    },
});
const modes = wasm.ModalitaFiltroSillabe;
const max = 4294967295;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = words => new TextEncoder().encode(words.join("\n") + "\n");
let tests = 0;

function test(name, action) {
    action();
    tests++;
    console.log(`PASS: ${name}`);
}

function fails(action) {
    let caught = false;
    const handles = wasm.count_emval_handles?.();
    try { action(); } catch (error) {
        caught = true;
        // Production may expose C++ exceptions as objects, not Error instances.
        // A diagnostic build can export the Emscripten exception lifetime helper.
        if (typeof wasm.decrementExceptionRefcount === "function" &&
            typeof error?.excPtr === "number") wasm.decrementExceptionRefcount(error);
    }
    assert(caught, "La chiamata deve fallire, senza restituire un risultato parziale");
    if (handles !== undefined) assert.equal(wasm.count_emval_handles(), handles, "Nessun handle emval perso");
}

function vectorToArray(vector) {
    return Array.from({ length: vector.size() }, (_, index) => vector.get(index));
}

function extract(raw, convert = vectorToArray) {
    const { righe, parole_vocabolario, ...metadata } = raw;
    try {
        return { ...metadata, righe: convert(righe), parole_vocabolario: convert(parole_vocabolario) };
    } finally {
        // Both owned Embind handles must survive conversion, then be released.
        try { righe.delete(); } finally { parole_vocabolario.delete(); }
    }
}

function metadata(result) {
    return Object.fromEntries([
        "tipo", "footer", "messaggio", "parola_modificata",
        "vocabolario_modificato", "richiede_salvataggio",
    ].map(key => [key, result[key]]));
}

function engine(words, counts) {
    const motor = new wasm.MotoreAnagrammi();
    try {
        const bytes = encode(words);
        motor.carica_vocabolario_ordinato_con_identita_da_bytes(bytes);
        if (counts) {
            const binary = fixture(bytes, counts);
            motor.associa_runtime_sillabe_da_bytes(binary, hash(binary));
        }
        return motor;
    } catch (error) { motor.delete(); throw error; }
}

// Entirely synthetic BITMAP-V1, including source identities and payload digest.
function fixture(bytes, counts) {
    const n = counts.length;
    const values = [...new Set(counts.flat())].sort((a, b) => a - b);
    const stride = Math.ceil(n / 8);
    const directory = 192 + 8 * n;
    const bitmaps = directory + 16 * values.length;
    const binary = new Uint8Array(bitmaps + stride * values.length);
    const view = new DataView(binary.buffer);
    const u32 = (offset, value) => view.setUint32(offset, value, true);
    const u64 = (offset, value) => view.setBigUint64(offset, BigInt(value), true);
    binary.set([83, 73, 76, 76, 66, 77, 0, 0]);
    view.setUint16(8, 1, true); view.setUint16(10, 192, true);
    u32(16, n); u32(20, values.length); u32(24, counts.flat().length); u32(28, stride);
    u64(32, 192); u64(40, directory); u64(48, bitmaps); u64(56, binary.length);
    binary.set(Buffer.from(hash(bytes), "hex"), 64);
    binary.set(Buffer.from(hash("paginazione: annotazioni sintetiche"), "hex"), 96);
    counts.forEach((row, i) => {
        u32(192 + i * 8, 2);
        binary[192 + i * 8 + 4] = row.length > 1 ? 6 : row.length ? 1 : 4;
        binary[192 + i * 8 + 5] = 1;
    });
    values.forEach((value, j) => {
        let population = 0;
        counts.forEach((row, i) => {
            if (row.includes(value)) {
                binary[bitmaps + j * stride + Math.floor(i / 8)] |= 1 << (i % 8);
                population++;
            }
        });
        u32(directory + j * 16, value); u32(directory + j * 16 + 4, population);
        u64(directory + j * 16 + 8, bitmaps + j * stride);
    });
    binary.set(Buffer.from(hash(binary.subarray(192)), "hex"), 128);
    return binary;
}

function page(motor, summary, offset = 0, limit = 100) {
    const result = extract(motor.leggi_pagina_risultato(summary.id_snapshot, offset, limit));
    assert.equal(result.id_snapshot, summary.id_snapshot);
    assert.equal(result.offset, offset);
    assert.equal(result.count, result.righe.length);
    assert.equal(result.count, result.parole_vocabolario.length);
    assert(result.count <= limit);
    return result;
}

function equivalent(motor, command, filter) {
    const full = extract(filter
        ? motor.esegui_comando_con_filtro_sillabe(command, ...filter)
        : motor.esegui_comando(command));
    const summary = filter
        ? motor.avvia_comando_paginato_con_filtro_sillabe(command, ...filter)
        : motor.avvia_comando_paginato(command);
    assert.deepEqual(metadata(summary), metadata(full), command);
    assert.equal(summary.totale, full.righe.length, command);
    assert.equal("righe" in summary, false);
    assert.equal("parole_vocabolario" in summary, false);
    const rows = [], words = [];
    if (summary.ha_snapshot) {
        for (let offset = 0; offset < summary.totale; offset += 2) {
            const current = page(motor, summary, offset, 2);
            rows.push(...current.righe); words.push(...current.parole_vocabolario);
        }
        assert.deepEqual(page(motor, summary, summary.totale).righe, []);
    } else assert.equal(summary.id_snapshot, 0);
    assert.deepEqual(rows, full.righe, command);
    assert.deepEqual(words, full.parole_vocabolario, command);
    return { full, summary };
}

test("0/1/99/100/101 risultati, limiti, ultimo blocco e pagine ripetute", () => {
    for (const n of [0, 1, 99, 100, 101, 305]) {
        // At n=0 keep a nonempty vocabulary, but choose a valid no-match query.
        const motor = engine(Array.from({ length: Math.max(1, n) }, () => "roma"));
        try {
            const summary = motor.avvia_comando_paginato(n ? "*" : "zzzz");
            assert.equal(summary.ha_snapshot, true);
            assert(summary.id_snapshot > 0);
            assert.equal(summary.totale, n);
            const first = page(motor, summary);
            assert.equal(first.count, Math.min(n, 100));
            assert.deepEqual(page(motor, summary), first);
            assert.equal(page(motor, summary, 0, 0).count, 0);
            assert.equal(page(motor, summary, n).count, 0);
            assert.equal(page(motor, summary, n + 1).count, 0);
            assert.equal(page(motor, summary, max, max).count, 0);
            assert.equal(page(motor, summary, 0, max).count, n);
            if (n > 100) assert.equal(page(motor, summary, 100).count, Math.min(n - 100, 100));
            if (n) assert.equal(page(motor, summary, n - 1).count, 1);
        } finally { motor.delete(); }
    }
});

test("Number validato prima del cast/core: type, finite, integer, range", () => {
    const motor = engine(["roma"]);
    try {
        const summary = motor.avvia_comando_paginato("*");
        const invalid = [NaN, Infinity, -Infinity, 0.5, -1, max + 1,
            Number.MAX_SAFE_INTEGER, "1", true, null, undefined, {}, 1n, new Number(1)];
        for (const bad of [0, ...invalid]) {
            fails(() => motor.leggi_pagina_risultato(bad, 0, 1));
            fails(() => motor.libera_risultato(bad));
        }
        for (const bad of invalid) {
            fails(() => motor.leggi_pagina_risultato(summary.id_snapshot, bad, 1));
            fails(() => motor.leggi_pagina_risultato(summary.id_snapshot, 0, bad));
        }
        // Especially overflowed free must never wrap to current id=1.
        assert.equal(page(motor, summary).count, 1);
        motor.libera_risultato(max);
        assert.equal(page(motor, summary).count, 1);
    } finally { motor.delete(); }
});

test("ownership: due vettori indipendenti, finally anche se la seconda conversione fallisce", () => {
    const motor = engine(["roma", "amor", "ramo"]);
    try {
        const summary = motor.avvia_comando_paginato("*");
        const handles = wasm.count_emval_handles?.();
        const raw = motor.leggi_pagina_risultato(summary.id_snapshot, 0, 2);
        let conversions = 0;
        assert.throws(() => extract(raw, vector => {
            if (++conversions === 2) throw new Error("Errore di conversione simulato");
            return vectorToArray(vector);
        }), /conversione simulato/);
        assert.equal(raw.righe.isDeleted(), true);
        assert.equal(raw.parole_vocabolario.isDeleted(), true);
        const expected = page(motor, summary, 0, 2);
        for (let i = 0; i < 100; i++) assert.deepEqual(page(motor, summary, 0, 2), expected);
        assert.deepEqual(page(motor, summary, 2, 2).parole_vocabolario, ["ramo"]);
        // A returned page owns its data even after the snapshot is freed.
        const retained = motor.leggi_pagina_risultato(summary.id_snapshot, 0, 2);
        motor.libera_risultato(summary.id_snapshot);
        assert.deepEqual(extract(retained).righe, expected.righe);
        if (handles !== undefined) assert.equal(wasm.count_emval_handles(), handles);
    } finally { motor.delete(); }
});

test("ID locale all'istanza, stale/inesistente, free stale/current", () => {
    const motor = engine(["roma"]), other = engine(["amor"]);
    try {
        // No global token: equal numeric IDs from different engines are unrelated.
        const a = motor.avvia_comando_paginato("*");
        const independent = other.avvia_comando_paginato("*");
        assert.equal(a.id_snapshot, independent.id_snapshot);
        assert.deepEqual(page(other, independent).righe, ["amor"]);
        const b = motor.avvia_comando_paginato("*");
        fails(() => page(motor, a));
        fails(() => motor.leggi_pagina_risultato(max, 0, 1));
        motor.libera_risultato(a.id_snapshot);
        assert.equal(page(motor, b).count, 1);
        motor.libera_risultato(b.id_snapshot);
        motor.libera_risultato(b.id_snapshot);
        fails(() => page(motor, b));
    } finally { motor.delete(); other.delete(); }
});

const words = ["nota", "roma", "amor", "roma", "ramo", "non", "citta", "citt\u00e0",
    "andr\u00f2", "p\u00e9sca", "p\u00e8sca", "roma   [-yx]"];
const counts = [[2], [3, 4], [2], [5], [4], [], [2], [2], [2], [2], [2], [6]];
const commands = ["roma", "romayx 4", "*", "ro*", "*ma", "*om*", "?oma", "?o*a",
    "&ar", "!ar", "$romayx", "andr?", "citt?", "p?sca", "*\u00e9sca", "zzzz", "", "%,10,20", "^"];

test("equivalenza completa/pagine: tutte le ricerche deterministiche e tutti i metadata", () => {
    const motor = engine(words, counts);
    try {
        for (const command of commands) equivalent(motor, command);
        const { full } = equivalent(motor, "romayx 4");
        assert(full.righe.includes("roma   [-yx]"));
        assert.equal(full.parole_vocabolario.filter(word => word === "roma").length, 2);
        assert(!full.parole_vocabolario.includes("roma   [-yx]"));
    } finally { motor.delete(); }
});

test("quattro filtri, ambiguita' una volta, duplicati distinti e residui", () => {
    const motor = engine(words, counts);
    const filters = [[modes.ESATTAMENTE, 3, 0], [modes.ALMENO, 4, 0],
        [modes.AL_MASSIMO, 2, 0], [modes.TRA, 2, 4]];
    try {
        for (const command of commands) {
            for (const filter of filters) equivalent(motor, command, filter);
        }
        const filtered = (command, filter) => page(motor,
            motor.avvia_comando_paginato_con_filtro_sillabe(command, ...filter)).parole_vocabolario;
        assert.deepEqual(filtered("roma", filters[0]), ["roma"]);
        assert.deepEqual(filtered("roma", filters[1]), ["roma", "roma", "ramo"]);
        assert.deepEqual(filtered("roma", filters[2]), ["amor"]);
        assert.deepEqual(filtered("roma", filters[3]), ["roma", "amor", "ramo"]);
        const residual = motor.avvia_comando_paginato_con_filtro_sillabe("romayx 4", modes.ESATTAMENTE, 3, 0);
        assert.deepEqual(page(motor, residual).righe, ["roma   [-yx]"]);
        assert.deepEqual(page(motor, residual).parole_vocabolario, ["roma"]);
        const empty = motor.avvia_comando_paginato_con_filtro_sillabe("*", modes.ESATTAMENTE, 99, 0);
        assert.equal(empty.ha_snapshot, true); assert.equal(empty.totale, 0);
        assert.equal(page(motor, empty).count, 0);
    } finally { motor.delete(); }
});

test("factory e conversione filtro storica condivise, nessun coercion delle modalita'", () => {
    const motor = engine(words, counts);
    try {
        const invalid = [["ESATTAMENTE", 2, 0], [0, 2, 0], [{}, 2, 0],
            [modes.ESATTAMENTE, 0, 0], [modes.ALMENO, -1, 0],
            [modes.AL_MASSIMO, max + 1, 0], [modes.TRA, 4, 2],
            [modes.TRA, 2, Infinity], [modes.ESATTAMENTE, NaN, 0],
            [modes.ESATTAMENTE, 2.5, 0], [modes.TRA, 2, 0]];
        for (const filter of invalid) {
            const summary = motor.avvia_comando_paginato("*");
            fails(() => motor.avvia_comando_paginato_con_filtro_sillabe("*", ...filter));
            assert.equal(page(motor, summary).count, words.length, "Errore del binding prima del core");
            fails(() => motor.esegui_comando_con_filtro_sillabe("*", ...filter));
        }
        equivalent(motor, "*", [modes.ESATTAMENTE, max, 0]);
        equivalent(motor, "*", [modes.ESATTAMENTE, 2, NaN]); // unused max, same historic semantics
    } finally { motor.delete(); }
});

test("runtime assente e comandi falliti invalidano; modifiche con filtro rifiutate", () => {
    const missing = engine(["roma"]), motor = engine(words, counts);
    try {
        const old = missing.avvia_comando_paginato("*");
        fails(() => missing.avvia_comando_paginato_con_filtro_sillabe("*", modes.ESATTAMENTE, 2, 0));
        fails(() => page(missing, old));
        for (const command of ["+ nuova", "- roma", "^,nonnumero,4", "^,100001,4"]) {
            const summary = motor.avvia_comando_paginato("*");
            const before = motor.esporta_vocabolario_testo();
            fails(() => motor.avvia_comando_paginato_con_filtro_sillabe(command, modes.TRA, 2, 6));
            fails(() => page(motor, summary));
            assert.equal(motor.esporta_vocabolario_testo(), before);
        }
    } finally { missing.delete(); motor.delete(); }
});

test("no snapshot: metadata +/-, empty, %, ^ invalido; sola lettura invariata", () => {
    for (const readonly of [false, true]) {
        for (const command of ["+ nuova", "- roma", "- assente", "", "%,10,20", "^"]) {
            const fullMotor = engine(["roma"]), pagedMotor = engine(["roma"]);
            try {
                fullMotor.imposta_sola_lettura(readonly); pagedMotor.imposta_sola_lettura(readonly);
                const full = extract(fullMotor.esegui_comando(command));
                const summary = pagedMotor.avvia_comando_paginato(command);
                assert.equal(summary.ha_snapshot, false); assert.equal(summary.id_snapshot, 0);
                assert.equal(summary.totale, 0);
                assert.deepEqual(metadata(summary), metadata(full));
                assert.equal(pagedMotor.esporta_vocabolario_testo(), fullMotor.esporta_vocabolario_testo());
                if (readonly) assert.equal(pagedMotor.esporta_vocabolario_testo(), "roma\n");
            } finally { fullMotor.delete(); pagedMotor.delete(); }
        }
    }
});

test("nuovo comando/caricamento/mutazioni personali invalidano lo snapshot", () => {
    const motor = engine(words, counts);
    const changes = [
        () => motor.esegui_comando_testo("*"),
        () => extract(motor.esegui_comando("*")),
        () => motor.avvia_comando_paginato(""),
        () => motor.carica_vocabolario_da_testo("roma\namor\n"),
        () => motor.carica_vocabolario_ordinato_da_testo("roma\namor\n"),
        () => motor.carica_vocabolario_ordinato_con_identita_da_bytes(encode(["roma", "amor"])),
        () => motor.aggiungi_parola("nuova"),
        () => motor.rimuovi_parola("roma"),
        () => {
            const removed = new wasm.StringVector(), added = new wasm.StringVector();
            try { removed.push_back("roma"); added.push_back("nuova"); motor.applica_modifiche(removed, added); }
            finally { removed.delete(); added.delete(); }
        },
    ];
    try {
        for (const change of changes) {
            motor.carica_vocabolario_ordinato_con_identita_da_bytes(encode(words));
            const summary = motor.avvia_comando_paginato("*");
            change(); fails(() => page(motor, summary));
        }
        motor.carica_vocabolario_ordinato_con_identita_da_bytes(encode(words));
        const summary = motor.avvia_comando_paginato("*");
        fails(() => motor.carica_vocabolario_ordinato_con_identita_da_bytes(new TextEncoder().encode("ROMA\n")));
        assert.equal(page(motor, summary).count, words.length, "Caricamento fallito conserva lo stato");
        const artifact = fixture(encode(words), counts);
        motor.associa_runtime_sillabe_da_bytes(artifact, hash(artifact));
        motor.aggiungi_parola("nuova");
        fails(() => motor.avvia_comando_paginato_con_filtro_sillabe("*", modes.ESATTAMENTE, 2, 0));
    } finally { motor.delete(); }
});

test("read-only: mutazioni dirette non cambiano snapshot/vocabolario/runtime", () => {
    const motor = engine(words, counts);
    try {
        motor.imposta_sola_lettura(true);
        const summary = motor.avvia_comando_paginato_con_filtro_sillabe("*", modes.TRA, 2, 6);
        const before = motor.esporta_vocabolario_testo(), expected = page(motor, summary);
        assert.equal(motor.aggiungi_parola("nuova"), false);
        assert.equal(motor.rimuovi_parola("roma"), false);
        const removed = new wasm.StringVector(), added = new wasm.StringVector();
        try { removed.push_back("roma"); added.push_back("nuova"); motor.applica_modifiche(removed, added); }
        finally { removed.delete(); added.delete(); }
        assert.equal(motor.esporta_vocabolario_testo(), before);
        assert.deepEqual(page(motor, summary), expected);
        assert.equal(motor.avvia_comando_paginato_con_filtro_sillabe("*", modes.TRA, 2, 6).totale, expected.count);
    } finally { motor.delete(); }
});

test("^: snapshot stabile, pagine senza reroll, replacement, filtro prima dei draw", () => {
    const motor = engine(["roma", "amor", "roma"], [[2, 3], [1], [4]]);
    try {
        const summary = motor.avvia_comando_paginato_con_filtro_sillabe("^,101,4", modes.TRA, 2, 3);
        assert.equal(summary.totale, 101);
        assert(summary.footer.includes("su 1 parole"));
        const first = page(motor, summary);
        const second = page(motor, summary, 100);
        assert.equal(first.count, 100); assert.equal(second.count, 1);
        assert(first.parole_vocabolario.every(word => word === "roma"));
        assert.deepEqual(second.parole_vocabolario, ["roma"]);
        assert.deepEqual(page(motor, summary), first);
        const unfiltered = motor.avvia_comando_paginato("^,305,4");
        assert.equal(unfiltered.totale, 305);
        assert(unfiltered.footer.includes("su 3 parole")); // duplicate source positions stay in the pool
        const randomFirst = page(motor, unfiltered);
        page(motor, unfiltered, 100);
        assert.deepEqual(page(motor, unfiltered), randomFirst);
        assert(new Set(randomFirst.righe).size < randomFirst.count); // guaranteed replacement, not statistical
        const budget = motor.avvia_comando_paginato("^,100000,4");
        assert.equal(budget.totale, 100000); assert.equal(page(motor, budget, 99999).count, 1);
        fails(() => motor.avvia_comando_paginato("^,100001,4"));
        fails(() => page(motor, budget));
        for (const command of ["^,0,4", "^,10,99"]) {
            const empty = motor.avvia_comando_paginato(command);
            assert.equal(empty.ha_snapshot, true); assert.equal(empty.totale, 0);
            assert.equal(page(motor, empty).count, 0);
        }
    } finally { motor.delete(); }
});

test("ricerca grande: solo sintesi e 100+100 elementi JS, senza API completa", () => {
    const motor = engine(Array.from({ length: 558124 }, () => "roma"));
    try {
        const summary = motor.avvia_comando_paginato("*");
        assert.equal(summary.totale, 558124);
        assert.equal(Object.values(summary).some(value => Array.isArray(value) || value?.get), false);
        const raw = motor.leggi_pagina_risultato(summary.id_snapshot, 0, 100);
        assert.equal(raw.righe.size(), 100); assert.equal(raw.parole_vocabolario.size(), 100);
        let gets = 0;
        const output = extract(raw, vector => Array.from({ length: vector.size() }, (_, i) => {
            gets++; return vector.get(i);
        }));
        assert.equal(gets, 200);
        assert.equal(output.righe.length, 100); assert.equal(output.parole_vocabolario.length, 100);
        assert.equal(raw.righe.isDeleted(), true); assert.equal(raw.parole_vocabolario.isDeleted(), true);
    } finally { motor.delete(); }
});

console.log(`PASS: ${tests} gruppi paginazione, modulo WASM reale`);

if (process.argv[3]) {
    const bytes = new Uint8Array(await readFile(path.join(process.argv[3], "VocabolarioItaliano.txt")));
    const motor = new wasm.MotoreAnagrammi();
    try {
        motor.carica_vocabolario_ordinato_con_identita_da_bytes(bytes);
        // Small warm-up only; the large-copy regression above never uses the old API.
        extract(motor.esegui_comando("zzzzzzzzzz"));
        let start = performance.now();
        const raw = motor.esegui_comando("*");
        const oldCall = performance.now() - start;
        start = performance.now();
        const full = extract(raw);
        const oldExtract = performance.now() - start;
        start = performance.now();
        const summary = motor.avvia_comando_paginato("*");
        const snapshotCall = performance.now() - start;
        start = performance.now();
        const plainSummary = { ...summary };
        const summaryCopy = performance.now() - start;
        start = performance.now();
        const firstRaw = motor.leggi_pagina_risultato(summary.id_snapshot, 0, 100);
        const pageCall = performance.now() - start;
        start = performance.now();
        const first = extract(firstRaw);
        const pageExtract = performance.now() - start;
        assert.equal(plainSummary.totale, full.righe.length);
        assert.deepEqual(metadata(plainSummary), metadata(full));
        assert.deepEqual(first.righe, full.righe.slice(0, 100));
        assert.deepEqual(first.parole_vocabolario, full.parole_vocabolario.slice(0, 100));
        console.log(JSON.stringify({ sanity_wasm_ms: {
            risultati: summary.totale, vecchia_chiamata: oldCall, vecchia_estrazione: oldExtract,
            snapshot_e_conversione_sintesi_embind: snapshotCall, copia_sintesi_js: summaryCopy,
            prima_pagina_chiamata: pageCall, prima_pagina_estrazione: pageExtract,
        }, note: "value_object converte gia' la sintesi durante la chiamata; copia JS non e' conversione C++ separata. Non e' un benchmark UI." }, null, 2));
    } finally { motor.delete(); }
}
