// node --experimental-vm-modules tests/web_runtime_sillabe_test.mjs <modulo.mjs> [repository]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const root = path.resolve(process.argv[3] ?? process.cwd());
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
const source = await readFile(path.join(root, "web/app.js"), "utf8");
const storageSource = await readFile(path.join(root, "web/runtime-sillabe-storage.js"), "utf8");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const words = ["nota", "roma", "amor", "roma", "ramo", "non", "citta", "citt\u00e0"];
const dictionary = new TextEncoder().encode(words.join("\n") + "\n");
const counts = [[2], [3, 4], [2], [5], [4], [], [2], [2]];

function fixture(bytes = dictionary, syllables = counts) {
    const n = syllables.length;
    const values = [...new Set(syllables.flat())].sort((a, b) => a - b);
    const stride = Math.ceil(n / 8);
    const directory = 192 + 8 * n;
    const bitmaps = directory + 16 * values.length;
    const binary = new Uint8Array(bitmaps + stride * values.length);
    const view = new DataView(binary.buffer);
    const u32 = (offset, value) => view.setUint32(offset, value, true);
    const u64 = (offset, value) => view.setBigUint64(offset, BigInt(value), true);
    binary.set([83, 73, 76, 76, 66, 77, 0, 0]);
    view.setUint16(8, 1, true);
    view.setUint16(10, 192, true);
    u32(16, n); u32(20, values.length); u32(24, syllables.flat().length); u32(28, stride);
    u64(32, 192); u64(40, directory); u64(48, bitmaps); u64(56, binary.length);
    binary.set(Buffer.from(hash(bytes), "hex"), 64);
    binary.set(Buffer.from(hash("annotazioni sintetiche"), "hex"), 96);
    syllables.forEach((row, i) => {
        u32(192 + i * 8, 2);
        binary[192 + i * 8 + 4] = row.length > 1 ? 6 : row.length ? 1 : 4;
        binary[192 + i * 8 + 5] = 1;
    });
    values.forEach((value, j) => {
        let population = 0;
        syllables.forEach((row, i) => {
            if (row.includes(value)) {
                binary[bitmaps + j * stride + Math.floor(i / 8)] |= 1 << (i % 8);
                population++;
            }
        });
        u32(directory + j * 16, value);
        u32(directory + j * 16 + 4, population);
        u64(directory + j * 16 + 8, bitmaps + j * stride);
    });
    binary.set(Buffer.from(hash(binary.subarray(192)), "hex"), 128);
    return binary;
}

const binary = fixture();
const available = {
    schema: 1, disponibile: true, formato: "sillabe-bitmap-le-v1",
    artifact: `runtime-sillabe-${hash(binary)}.bin`, artifact_sha256: hash(binary),
    vocabolario_sha256: hash(dictionary), numero_grafie: words.length,
    annotazioni_sha256: hash("annotazioni sintetiche"), dimensione_byte: binary.length,
};
// Fixture esplicita di indisponibilita': il deployment puo' ora avere il runtime reale.
const placeholder = { schema: 1, disponibile: false };

class Element {
    dataset = {}; children = []; listeners = {}; textContent = ""; value = "";
    attributes = {}; checked = false; disabled = false; hidden = false; focused = false;
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
    focus() { this.focused = true; }
    showModal() {}
    close() {}
}

class RuntimeLocks {
    tail = Promise.resolve(); pending = 0;
    request(name, options, action) {
        assert.equal(options.mode, "exclusive");
        this.pending++;
        const task = this.tail.then(action).finally(() => { this.pending--; });
        this.tail = task.catch(() => {});
        return task;
    }
}

class RuntimeCaches {
    stores = new Map(); locks = new RuntimeLocks(); events = []; failPut = null;
    readGate = null; putGate = null; beforePut = null; afterPut = null;
    keysGate = null; deleteGate = null; beforeKeys = null; beforeDelete = null;
    async has(name) { return this.stores.has(name); }
    async keys() { return [...this.stores.keys()]; }
    async open(name) {
        if (!this.stores.has(name)) this.stores.set(name, new Map());
        const data = this.stores.get(name);
        const key = value => value.url ?? value.href ?? String(value);
        return {
            match: async input => {
                const url = key(input);
                if (url.endsWith(".bin") && this.readGate) await this.readGate;
                return data.get(url)?.clone();
            },
            put: async (input, response) => {
                const url = key(input);
                this.beforePut?.(url);
                if (this.putGate && url.endsWith(this.putGate.suffix)) await this.putGate.promise;
                if (this.failPut && url.endsWith(this.failPut)) throw new Error("quota runtime fixture");
                data.set(url, response.clone()); this.events.push({ name, url });
                this.afterPut?.(url);
            },
            keys: async () => {
                this.beforeKeys?.();
                if (this.keysGate) await this.keysGate;
                return [...data.keys()].map(url => ({ url }));
            },
            delete: async input => {
                const url = key(input);
                this.beforeDelete?.(url);
                if (this.deleteGate && url.endsWith(this.deleteGate.suffix)) await this.deleteGate.promise;
                return data.delete(url);
            },
        };
    }
    async pointer() {
        const data = this.stores.get("anagrammi-app-syllable-runtime-v1");
        const entry = [...(data ?? [])].find(([url]) => url.endsWith(".anagrammi-approved-runtime-v1"));
        return entry ? entry[1].clone().json() : null;
    }
    artifacts() {
        return [...(this.stores.get("anagrammi-app-syllable-runtime-v1")?.keys() ?? [])].filter(url => url.endsWith(".bin"));
    }
}

async function application(options = {}) {
    const settings = { dictionary, manifest: placeholder, artifact: binary, ...options };
    const requests = [];
    const elements = new Map();
    const windowListeners = {};
    const timers = new Map();
    const lifetimes = [];
    const staleCalls = [];
    const associations = [];
    const searches = [];
    const calls = [];
    const pages = [];
    const runtimeCache = options.runtimeCache ?? new RuntimeCaches();
    let timerId = 0;
    const testModule = Object.create(wasm);
    testModule.MotoreAnagrammi = function () {
        const target = new wasm.MotoreAnagrammi();
        const record = { id: lifetimes.length, deleted: false };
        lifetimes.push(record);
        return new Proxy(target, { get(object, name) {
            const value = Reflect.get(object, name);
            if (typeof value !== "function") return value;
            return (...args) => {
                if (record.deleted) {
                    staleCalls.push({ id: record.id, name });
                    throw new Error(`Metodo ${String(name)} su motore eliminato`);
                }
                if (name === "associa_runtime_sillabe_da_bytes") associations.push(record.id);
                if (["esegui_comando", "esegui_comando_con_filtro_sillabe",
                    "avvia_comando_paginato", "avvia_comando_paginato_con_filtro_sillabe"].includes(name)) {
                    searches.push({ name, args });
                }
                const call = { id: record.id, name, args };
                calls.push(call);
                options.beforeCall?.(call);
                const start = performance.now();
                const result = value.apply(target, args);
                call.milliseconds = performance.now() - start;
                if (name === "leggi_pagina_risultato") {
                    const page = { id: record.id, args, sizes: [], gets: 0, deleted: 0 };
                    for (const field of ["righe", "parole_vocabolario"]) {
                        const vector = result[field];
                        page.sizes.push(vector.size());
                        result[field] = new Proxy(vector, { get(handle, method) {
                            const fn = Reflect.get(handle, method);
                            if (typeof fn !== "function") return fn;
                            return (...params) => {
                                if (method === "get") page.gets++;
                                const output = fn.apply(handle, params);
                                if (method === "delete") page.deleted++;
                                return output;
                            };
                        } });
                    }
                    pages.push(page);
                }
                options.afterCall?.(call, result);
                if (name === "associa_runtime_sillabe_da_bytes") options.afterAssociation?.(record.id);
                if (name === "delete") record.deleted = true;
                return result;
            };
        } });
    };
    let saved = null;
    let failSave = false;
    const context = vm.createContext({
        Uint8Array, Error, SyntaxError, URL, Blob, Response, performance, AbortController,
        caches: runtimeCache, navigator: { locks: runtimeCache.locks },
        setTimeout(callback, milliseconds) {
            assert.equal(milliseconds, 30000);
            timers.set(++timerId, callback);
            return timerId;
        },
        clearTimeout(id) { timers.delete(id); },
        console: { table() {}, warn() {} },
        document: {
            querySelector(selector) {
                if (!elements.has(selector)) {
                    const element = new Element();
                    element.value = ({ "#modalita-sillabe": "ESATTAMENTE", "#minimo-sillabe": "2", "#massimo-sillabe": "3" })[selector] ?? "";
                    elements.set(selector, element);
                }
                return elements.get(selector);
            },
            querySelectorAll: () => [], createElement: () => new Element(),
        },
        window: { confirm: () => true, addEventListener: (type, cb) => { windowListeners[type] = cb; } },
        fetch: async (input, init = {}) => {
            const url = String(input);
            requests.push(url);
            if (url.endsWith("VocabolarioItaliano.txt")) {
                assert.equal(init.signal, undefined, "Timeout non applicato al vocabolario");
                if (settings.failDictionary) throw new Error("rete vocabolario");
                return { ok: true, arrayBuffer: async () => settings.dictionary.slice().buffer,
                    text: () => { throw new Error("Decodifica ufficiale vietata"); } };
            }
            if (url.endsWith("runtime-sillabe.manifest.json")) {
                assert(init.signal instanceof AbortSignal);
                const data = { ...settings, ...settings.manifestPlans?.shift() };
                await waitGate(data.waitManifest, init.signal);
                if (data.failManifest) throw new Error("rete manifest");
                return { ok: true, json: async () => {
                    await waitGate(data.waitJson, init.signal);
                    if (data.invalidJson) throw new SyntaxError("JSON invalido");
                    return data.manifest;
                } };
            }
            assert(init.signal instanceof AbortSignal);
            const data = { ...settings, ...settings.artifactPlans?.shift() };
            await waitGate(data.waitArtifact, init.signal);
            if (data.failArtifact) return { ok: false, status: 404 };
            return { ok: true, arrayBuffer: async () => {
                await waitGate(data.waitBody, init.signal);
                return data.artifact.slice().buffer;
            } };
        },
    });
    const persistence = new vm.SyntheticModule(
        ["leggiVocabolarioPersonale", "salvaVocabolarioPersonale", "eliminaVocabolarioPersonale"],
        function () {
            this.setExport("leggiVocabolarioPersonale", async () => structuredClone(saved));
            this.setExport("salvaVocabolarioPersonale", async record => {
                if (failSave) throw new Error("salvataggio fallito");
                saved = structuredClone(record);
            });
            this.setExport("eliminaVocabolarioPersonale", async () => { saved = null; });
        }, { context });
    // L'accesso allo stato lessicale esiste solo nella copia eseguita dal test.
    const module = new vm.SourceTextModule(source + "\nglobalThis.eseguiTest = codice => eval(codice);\n", {
        context, identifier: pathToFileURL(path.join(root, "web/app.js")).href,
        initializeImportMeta(meta) { meta.url = module.identifier; },
        importModuleDynamically: async specifier => {
            assert.equal(specifier, "./anagrammi.js");
            const dependency = new vm.SyntheticModule(["default"], function () {
                this.setExport("default", async () => testModule);
            }, { context });
            await dependency.link(() => {});
            await dependency.evaluate();
            return dependency;
        },
    });
    const storageModule = new vm.SourceTextModule(storageSource, { context });
    await module.link(specifier => {
        if (specifier === "./runtime-sillabe-storage.js") return storageModule;
        assert.equal(specifier, "./persistenza.js");
        return persistence;
    });
    await module.evaluate();
    const run = expression => context.eseguiTest(expression);
    const state = () => run("statoRuntimeSillabe.stato");
    const clock = () => {
        const callbacks = [...timers.values()];
        timers.clear();
        callbacks.forEach(callback => callback());
    };
    const settle = async () => {
        for (let i = 0; i < 80; i++) {
            await drain();
            if (state() !== "caricamento" && timers.size === 0 && runtimeCache.locks.pending === 0) break;
        }
        assert.notEqual(state(), "caricamento", "Runtime non completato");
        assert.equal(timers.size, 0, "Timer non ripulito");
        assert.equal(run("statoRuntimeSillabe.generazione === generazioneMotore"), true);
        assert.deepEqual(staleCalls, []);
        assert.equal(runtimeCache.locks.pending, 0, "Storage ancora pendente");
    };
    return { settings, requests, elements, run, state, saved: () => saved,
        timers, lifetimes, staleCalls, associations, searches, calls, pages, clock, settle, runtimeCache,
        failSave: value => { failSave = value; }, close: async () => {
            windowListeners.beforeunload();
            clock();
            await drain();
            assert.deepEqual(staleCalls, []);
            assert(lifetimes.every(record => record.deleted), "Motore non eliminato");
            assert.equal(timers.size, 0);
        } };
}

async function waitGate(gate, signal) {
    if (signal.aborted) throw signal.reason;
    if (!gate) return;
    let abort;
    const cancelled = new Promise((_, reject) => { abort = () => reject(signal.reason); });
    signal.addEventListener("abort", abort, { once: true });
    try { await Promise.race([gate, cancelled]); }
    finally { signal.removeEventListener("abort", abort); }
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function drain() {
    await new Promise(resolve => setImmediate(resolve));
}

function normalSearches(app) {
    for (const command of ["roma", "r?ma", "r*", "r?*", "&amor", "!roma", "$amor", "^,1,4"]) {
        assert.equal(app.run(`eseguiComandoStrutturato(${JSON.stringify(command)}).tipo`), "ricerca", command);
    }
}

const real = new Uint8Array(await readFile(path.join(root, "VocabolarioItaliano.txt")));
const realApp = await application({ dictionary: real });
await realApp.settle();
assert.equal(realApp.run("motore.numero_parole()"), 558124);
assert.equal(realApp.run("motore.esporta_vocabolario_testo()"), new TextDecoder().decode(real));
assert.equal(realApp.run("vocabolarioAttivo.bytes"), real.byteLength);
assert.equal(realApp.run("motore.sola_lettura()"), true);
assert.equal(realApp.state(), "non_disponibile");
assert.equal(realApp.requests.length, 2);
assert.equal(realApp.elements.get("#comando").disabled, false);
assert(realApp.run('eseguiComandoStrutturato("andr?").totale') > 0);
await realApp.close();
console.log("PASS vocabolario reale: 558124 parole, byte esatti, placeholder senza artifact");

const ready = await application({ manifest: available });
await ready.settle();
assert.equal(ready.state(), "pronto");
assert.equal(ready.requests.length, 3);
normalSearches(ready);
assert.equal(ready.run('(() => { const raw = motore.esegui_comando_con_filtro_sillabe("roma", modulo.ModalitaFiltroSillabe.ESATTAMENTE, 3, 0); vettoreInArray(raw.parole_vocabolario); return vettoreInArray(raw.righe).join(","); })()'), "roma");
// Stesso motore, identita', runtime e UI restano attivi dopo un errore di canonicita'.
ready.run("globalThis.motorePrima = motore; globalThis.statoPrima = statoRuntimeSillabe; globalThis.generazionePrima = generazioneMotore");
ready.settings.dictionary = new TextEncoder().encode("Roma\r\n");
assert.equal(await ready.run("usaVocabolarioOriginale()"), false);
assert.equal(ready.run("motore === globalThis.motorePrima && statoRuntimeSillabe === globalThis.statoPrima"), true);
assert.equal(ready.run("generazioneMotore === globalThis.generazionePrima"), true);
assert.equal(ready.run("motore.sola_lettura()"), true);
assert.equal(ready.run("motore.numero_parole()"), words.length);
assert.equal(ready.elements.get("#comando").disabled, false);
ready.settings.dictionary = dictionary;
let resumeManifest;
ready.settings.waitManifest = new Promise(resolve => { resumeManifest = resolve; });
const pending = ready.run("usaVocabolarioOriginale()");
assert.equal(await pending, true);
assert.equal(ready.state(), "caricamento");
assert.equal(ready.elements.get("#comando").disabled, false);
normalSearches(ready);
resumeManifest();
await ready.settle();
assert.equal(ready.state(), "pronto");
delete ready.settings.waitManifest;

await ready.run('creaCopiaPersonale("personale.txt", "nota\\nroma\\n", true)');
assert.equal(await ready.run("usaVocabolarioPersonale()"), true);
assert.equal(ready.state(), "pronto");
assert.equal(ready.run("motore.sola_lettura()"), false);
assert.equal(ready.run('(() => { const r = motore.esegui_comando_con_filtro_sillabe("roma", modulo.ModalitaFiltroSillabe.ESATTAMENTE, 3, 0); const n = r.righe.size(); r.righe.delete(); r.parole_vocabolario.delete(); return n; })()'), 1);
ready.elements.get("#comando").value = "+ amo";
await ready.run("eseguiComando()");
assert(ready.saved().aggiunte.includes("amo"));
assert.equal(ready.run("motore.numero_parole()"), 3);
ready.elements.get("#comando").value = "- nota";
await ready.run("eseguiComando()");
assert(ready.saved().rimosse.includes("nota"));
assert.equal(ready.run("motore.numero_parole()"), 2);
const personalExport = ready.run("motore.esporta_vocabolario_testo()");
assert.equal(await ready.run("usaVocabolarioPersonale()"), true);
assert.equal(ready.run("motore.esporta_vocabolario_testo()"), personalExport);
ready.failSave(true);
ready.elements.get("#comando").value = "+ sole";
await ready.run("eseguiComando()");
assert.equal(ready.run("motore.esporta_vocabolario_testo()"), personalExport);
ready.failSave(false);
ready.settings.failDictionary = true;
assert.equal(await ready.run("usaVocabolarioOriginale()"), false);
assert.equal(ready.run("motore.esporta_vocabolario_testo()"), personalExport);
assert.equal(ready.state(), "pronto");
ready.settings.failDictionary = false;
assert.equal(await ready.run("usaVocabolarioOriginale()"), true);
await ready.settle();
assert.equal(ready.state(), "pronto");
assert.equal(ready.run("motore.sola_lettura()"), true);
assert.equal(ready.run("motore.numero_parole()"), words.length);
await ready.close();
console.log("PASS runtime sintetico, transazioni, switch e modifiche/persistenza personali");

const wrongHash = "0".repeat(64);
const corrupt = binary.slice(); corrupt[0] ^= 1;
const incompatible = fixture(new TextEncoder().encode("altro snapshot\n"));
const wrongCount = fixture(dictionary, counts.slice(0, -1));
const cases = [
    { name: "hash artifact", manifest: { ...available, artifact_sha256: wrongHash, artifact: `runtime-sillabe-${wrongHash}.bin` } },
    { name: "hash vocabolario", artifact: incompatible, manifest: { ...available,
        artifact_sha256: hash(incompatible), artifact: `runtime-sillabe-${hash(incompatible)}.bin` } },
    { name: "runtime corrotto", artifact: corrupt, manifest: { ...available,
        artifact_sha256: hash(corrupt), artifact: `runtime-sillabe-${hash(corrupt)}.bin` } },
    { name: "cardinalita' incompatibile", artifact: wrongCount, manifest: { ...available,
        artifact_sha256: hash(wrongCount), artifact: `runtime-sillabe-${hash(wrongCount)}.bin`,
        numero_grafie: counts.length - 1, dimensione_byte: wrongCount.length } },
    { name: "rete manifest", failManifest: true },
    { name: "rete artifact", manifest: available, failArtifact: true },
    { name: "JSON", invalidJson: true },
    ...[null, [], { schema: 2, disponibile: false }, { schema: 1, disponibile: "false" },
        { ...available, artifact_sha256: "A".repeat(64) }, { ...available, vocabolario_sha256: "xyz" },
        { ...available, vocabolario_sha256: available.vocabolario_sha256 + "\n" },
        { ...available, artifact: "../runtime.bin" }, { ...available, artifact: "https://evil.test/a.bin" },
        { ...available, numero_grafie: 0 }, { ...available, numero_grafie: 1.5 },
        { ...available, dimensione_byte: -1 }, { ...available, annotazioni_sha256: null },
        { ...available, dimensione_byte: binary.length + 1 }, { ...available, formato: "v2" },
    ].map((manifest, i) => ({ name: `manifest invalido ${i}`, manifest })),
];
for (const test of cases) {
    const app = await application(test);
    const published = app.run("motore");
    const generation = app.run("generazioneMotore");
    await app.settle();
    assert.equal(app.run("motore"), published, "Errore runtime senza rollback");
    assert.equal(app.run("generazioneMotore"), generation);
    assert.equal(app.state(), "errore", test.name);
    assert(app.run("statoRuntimeSillabe.errore.length") > 0, test.name);
    assert.equal(app.run("motore.numero_parole()"), words.length, test.name);
    assert.equal(app.elements.get("#comando").disabled, false, test.name);
    normalSearches(app);
    assert.throws(() => app.run('motore.esegui_comando_con_filtro_sillabe("roma", modulo.ModalitaFiltroSillabe.ESATTAMENTE, 3, 0)'));
    await app.close();
}
console.log(`PASS ${cases.length} errori: degradazione senza bloccare le ricerche normali`);

const minimal = { ...available }; delete minimal.dimensione_byte; delete minimal.annotazioni_sha256;
const minimalApp = await application({ manifest: minimal });
await minimalApp.settle();
assert.equal(minimalApp.state(), "pronto"); await minimalApp.close();
console.log("PASS metadati opzionali assenti");

const noRollback = await application({ manifest: available });
await noRollback.settle();
const previousGeneration = noRollback.run("generazioneMotore");
const previousMotor = noRollback.lifetimes.at(-1);
const changedText = "casa\nnota\n";
const changedDictionary = new TextEncoder().encode(changedText);
const changedArtifact = fixture(changedDictionary, [[2], [2]]);
const badArtifactGate = deferred();
Object.assign(noRollback.settings, {
    dictionary: changedDictionary, artifact: changedArtifact, waitBody: badArtifactGate.promise,
    manifest: { ...available, artifact: `runtime-sillabe-${wrongHash}.bin`, artifact_sha256: wrongHash,
        vocabolario_sha256: hash(changedDictionary), numero_grafie: 2, dimensione_byte: changedArtifact.length },
});
assert.equal(await noRollback.run("usaVocabolarioOriginale()"), true);
await drain();
assert.equal(previousMotor.deleted, false, "La fonte ufficiale verificata resta separata dal nuovo motore attivo");
assert.equal(noRollback.run("generazioneMotore"), previousGeneration + 1);
assert.equal(noRollback.state(), "caricamento");
assert.equal(noRollback.elements.get("#comando").disabled, false);
const publishedBeforeError = noRollback.run("motore");
badArtifactGate.resolve();
await noRollback.settle();
assert.equal(noRollback.state(), "errore");
assert.equal(noRollback.run("motore"), publishedBeforeError);
assert.equal(noRollback.run("motore.esporta_vocabolario_testo()"), changedText);
assert.equal(noRollback.run("motore.numero_parole()"), 2);
normalSearches(noRollback);
await noRollback.close();
console.log("PASS nuovo vocabolario pubblicato resta attivo dopo errore hash runtime");

const rollbackGate = deferred();
const rollbackApp = await application({ manifest: available, waitBody: rollbackGate.promise });
await drain();
const rollbackMotor = rollbackApp.run("motore");
const rollbackState = rollbackApp.run("statoRuntimeSillabe");
const rollbackGeneration = rollbackApp.run("generazioneMotore");
const rollbackRecord = rollbackApp.lifetimes.at(-1);
rollbackApp.settings.dictionary = new TextEncoder().encode("Roma\r\n");
assert.equal(await rollbackApp.run("usaVocabolarioOriginale()"), false);
assert.equal(rollbackApp.run("motore"), rollbackMotor);
assert.equal(rollbackApp.run("statoRuntimeSillabe"), rollbackState);
assert.equal(rollbackApp.run("generazioneMotore"), rollbackGeneration);
assert.equal(rollbackRecord.deleted, false);
rollbackGate.resolve();
await rollbackApp.settle();
assert.equal(rollbackApp.state(), "pronto");
assert.deepEqual(rollbackApp.associations, [rollbackRecord.id]);
await rollbackApp.close();
console.log("PASS caricamento vocabolario fallito conserva generazione e richiesta runtime pendente");

for (const phase of ["waitManifest", "waitJson", "waitArtifact", "waitBody"]) {
    const gate = deferred();
    const app = await application({ manifest: available, [phase]: gate.promise });
    await drain();
    assert.equal(app.state(), "caricamento", phase);
    assert.equal(app.run("vocabolarioAttivo.modalita"), "originale");
    assert.equal(app.elements.get("#comando").disabled, false, "Runtime lento non blocca la ricerca");
    normalSearches(app);
    const published = app.run("motore");
    app.clock();
    await app.settle();
    assert.equal(app.state(), "errore", phase);
    assert(app.run('statoRuntimeSillabe.errore.includes("Tempo massimo")'));
    assert.equal(app.run("motore"), published);
    normalSearches(app);
    await app.close();
}
console.log("PASS timeout simulati di fetch/body manifest e artifact, nessuna attesa reale");

for (const phase of ["waitManifest", "waitJson", "waitArtifact", "waitBody"]) {
    const gate = deferred();
    const app = await application({ manifest: available, [phase]: gate.promise });
    await drain();
    assert.equal(app.state(), "caricamento");
    const original = app.lifetimes.at(-1);
    app.settings.manifest = placeholder;
    await app.run('creaCopiaPersonale("personale.txt", "nota\\nroma\\n", true)');
    assert.equal(await app.run("usaVocabolarioPersonale()"), true);
    assert.equal(original.deleted, true);
    const personalState = app.run("statoRuntimeSillabe");
    const personalMotor = app.run("motore");
    const generation = app.run("generazioneMotore");
    gate.resolve();
    await app.settle();
    assert.equal(app.run("statoRuntimeSillabe"), personalState, phase);
    assert.equal(app.run("motore"), personalMotor);
    assert.equal(app.run("generazioneMotore"), generation);
    assert.equal(app.state(), "pronto");
    assert.equal(app.run("motore.numero_parole()"), 2);
    assert.deepEqual(app.associations, []);
    delete app.settings[phase];
    app.settings.manifest = available;
    const beforeRequests = app.requests.length;
    assert.equal(await app.run("usaVocabolarioOriginale()"), true);
    await app.settle();
    assert.equal(app.state(), "pronto");
    assert(app.requests.length > beforeRequests, "Ritorno all'originale avvia un nuovo tentativo");
    assert.equal(app.run("generazioneMotore"), generation + 1);
    assert.deepEqual(app.associations, [app.lifetimes.at(-1).id]);
    await app.close();
}
console.log("PASS passaggio a personale dopo ciascun await, ritorno all'originale e lifetime WASM");

for (const oldFirst of [false, true]) {
    const a = deferred();
    const b = deferred();
    const app = await application({ manifest: available, artifactPlans: [{ waitBody: a.promise }] });
    await drain();
    const oldMotor = app.lifetimes.at(-1);
    app.settings.manifestPlans = [{ waitManifest: b.promise }];
    assert.equal(await app.run("usaVocabolarioOriginale()"), true);
    await drain();
    assert.equal(oldMotor.deleted, true);
    const generation = app.run("generazioneMotore");
    if (oldFirst) {
        const pendingState = app.run("statoRuntimeSillabe");
        a.resolve();
        await drain();
        assert.equal(app.run("statoRuntimeSillabe"), pendingState);
        assert.equal(app.state(), "caricamento");
        assert.deepEqual(app.associations, []);
        b.resolve();
        await app.settle();
    } else {
        b.resolve();
        await drain();
        assert.equal(app.state(), "pronto");
        const readyState = app.run("statoRuntimeSillabe");
        a.resolve();
        await app.settle();
        assert.equal(app.run("statoRuntimeSillabe"), readyState);
    }
    assert.equal(app.run("generazioneMotore"), generation);
    assert.equal(app.state(), "pronto");
    assert.deepEqual(app.associations, [app.lifetimes.at(-1).id]);
    normalSearches(app);
    await app.close();
}
console.log("PASS originale A/B con entrambi gli ordini di completamento, associa solo B");

for (const outcome of ["errore", "timeout", "non_disponibile"]) {
    const gate = deferred();
    const app = await application({ manifest: placeholder, waitManifest: gate.promise });
    await app.run('creaCopiaPersonale("personale.txt", "nota\\n", true)');
    await app.run("usaVocabolarioPersonale()");
    const personalState = app.run("statoRuntimeSillabe");
    if (outcome === "errore") gate.reject(new Error("vecchia richiesta fallita"));
    else if (outcome === "timeout") app.clock();
    else gate.resolve();
    await app.settle();
    assert.equal(app.run("statoRuntimeSillabe"), personalState);
    assert.deepEqual(app.associations, []);
    await app.close();
}
console.log("PASS errori, timeout e placeholder obsoleti non alterano il nuovo stato");

const closing = deferred();
const closingApp = await application({ manifest: available, waitBody: closing.promise });
await drain();
const beforeClose = closingApp.run("statoRuntimeSillabe");
await closingApp.close();
closing.resolve();
await drain();
assert.equal(closingApp.run("statoRuntimeSillabe"), beforeClose);
assert.deepEqual(closingApp.associations, []);
console.log("PASS chiusura con fetch pendente: nessun accesso al motore eliminato");

function manifestFor(bytes) {
    return { ...available, artifact: `runtime-sillabe-${hash(bytes)}.bin`,
        artifact_sha256: hash(bytes), dimensione_byte: bytes.length };
}
async function approvedStore() {
    const cache = new RuntimeCaches();
    let verified = false;
    cache.beforePut = () => assert.equal(verified, true, "Scrittura prima della verifica C++");
    const app = await application({ runtimeCache: cache, manifest: available,
        afterAssociation: () => { verified = true; } });
    await app.settle();
    assert.equal((await cache.pointer()).corrente.artifact_sha256, available.artifact_sha256);
    assert.equal(cache.events.at(-1).url.endsWith(".anagrammi-approved-runtime-v1"), true);
    cache.beforePut = null;
    await app.close();
    return cache;
}
const approved = await approvedStore();
const approvedPointer = await approved.pointer();
for (const test of cases.filter(row => ["hash artifact", "hash vocabolario", "runtime corrotto", "cardinalita' incompatibile", "JSON"].includes(row.name))) {
    const app = await application({ ...test, runtimeCache: approved });
    await app.settle();
    assert.equal(app.state(), "errore", test.name);
    assert.deepEqual(await approved.pointer(), approvedPointer);
    normalSearches(app);
    await app.close();
}
console.log("PASS approvazione dopo C++, puntatore ultimo; SHA/vocab/BITMAP/cardinalita'/JSON invalidi non promossi");

for (const field of ["vocabolario_sha256", "numero_grafie", "annotazioni_sha256"]) {
    const manifest = { ...available, [field]: field === "numero_grafie" ? words.length + 1 : wrongHash };
    const app = await application({ runtimeCache: approved, manifest, artifact: binary });
    await app.settle();
    assert.equal(app.state(), "errore", field);
    assert.deepEqual(app.associations, [], `Precheck ${field}: nessuna chiamata di associazione`);
    assert.deepEqual(await approved.pointer(), approvedPointer);
    assert.equal(approved.artifacts().length, 1);
    assert.throws(() => app.run('motore.esegui_comando_con_filtro_sillabe("roma", modulo.ModalitaFiltroSillabe.ESATTAMENTE, 3, 0)'));
    normalSearches(app); await app.close();
}
for (const [length, annotations] of [[0, false], [19, false], [95, false], [127, true]]) {
    const manifest = { ...available };
    delete manifest.dimensione_byte;
    if (!annotations) delete manifest.annotazioni_sha256;
    const app = await application({ runtimeCache: approved, manifest, artifact: binary.slice(0, length) });
    await app.settle();
    assert.equal(app.state(), "errore");
    assert.equal(app.run('statoRuntimeSillabe.errore.includes("header troppo corto per il precheck")'), true);
    assert.equal(app.run('statoRuntimeSillabe.errore.includes("RangeError")'), false);
    assert.deepEqual(app.associations, []);
    assert.deepEqual(await approved.pointer(), approvedPointer);
    normalSearches(app); await app.close();
}
console.log("PASS precheck prima di C++: vocab/cardinalita'/annotazioni falsi e header corti senza associazione/promozione");

const secondBinary = fixture(dictionary, counts.map(row => row.length ? [6] : []));
const secondManifest = manifestFor(secondBinary);
for (const suffix of [secondManifest.artifact, ".anagrammi-approved-runtime-v1"]) {
    const cache = await approvedStore();
    cache.failPut = suffix;
    const app = await application({ runtimeCache: cache, manifest: secondManifest, artifact: secondBinary });
    await app.settle();
    assert.equal(app.state(), "pronto");
    assert.ok(app.run("statoRuntimeSillabe.errorePersistenza.length"));
    assert.equal((await cache.pointer()).corrente.artifact_sha256, available.artifact_sha256);
    assert.equal(cache.artifacts().length, 1);
    assert.equal(app.run('(() => { const raw = motore.esegui_comando_con_filtro_sillabe("roma", modulo.ModalitaFiltroSillabe.ESATTAMENTE, 6, 0); return vettoreInArray(raw.righe).length; })()'), 4);
    await app.close();
}
console.log("PASS quota su byte/puntatore: B resta in memoria, A persistito intatto, candidati rimossi");

for (const options of [
    { failManifest: true },
    { manifest: available, failArtifact: true },
    { manifest: available, waitManifest: deferred().promise },
    { manifest: available, waitBody: deferred().promise },
]) {
    const app = await application({ ...options, runtimeCache: approved });
    await drain();
    if (options.waitManifest || options.waitBody) app.clock();
    await app.settle();
    assert.equal(app.state(), "pronto");
    assert.equal(app.run("statoRuntimeSillabe.origine"), "locale");
    assert.equal(app.associations.length, 1, "Fallback passa di nuovo dal binding C++");
    normalSearches(app);
    await app.close();
}
const intentionallyAbsent = await application({ runtimeCache: approved, manifest: placeholder });
await intentionallyAbsent.settle();
assert.equal(intentionallyAbsent.state(), "non_disponibile");
assert.equal(intentionallyAbsent.associations.length, 0);
assert.deepEqual(await approved.pointer(), approvedPointer);
await intentionallyAbsent.close();
console.log("PASS offline/rete/404/timeout -> locale riverificato; disponibile:false prevale senza fallback");

const incompatibleLocal = await approvedStore();
const changedLocalApp = await application({ runtimeCache: incompatibleLocal, dictionary: changedDictionary, failManifest: true });
await changedLocalApp.settle();
assert.equal(changedLocalApp.state(), "errore");
assert.equal(changedLocalApp.run("motore.numero_parole()"), 2);
assert.equal((await incompatibleLocal.pointer()).corrente, null);
assert.equal(incompatibleLocal.artifacts().length, 0);
normalSearches(changedLocalApp);
await changedLocalApp.close();
const damagedLocal = await approvedStore();
const damagedCache = await damagedLocal.open("anagrammi-app-syllable-runtime-v1");
await damagedCache.put(damagedLocal.artifacts()[0], new Response(corrupt));
const damagedApp = await application({ runtimeCache: damagedLocal, failManifest: true });
await damagedApp.settle();
assert.equal(damagedApp.state(), "errore");
assert.equal(damagedLocal.artifacts().length, 0);
normalSearches(damagedApp); await damagedApp.close();
console.log("PASS fallback incompatibile/corrotto rifiutato dal core e scartato, ricerche normali intatte");

for (const next of ["personale", "originale"]) {
    const cache = await approvedStore();
    const read = deferred(); cache.readGate = read.promise;
    const app = await application({ runtimeCache: cache, failManifest: true });
    await drain();
    if (next === "personale") {
        await app.run('creaCopiaPersonale("personale.txt", "nota\\nroma\\n", true)');
        await app.run("usaVocabolarioPersonale()");
    } else {
        app.settings.failManifest = false; app.settings.manifest = placeholder;
        await app.run("usaVocabolarioOriginale()");
        for (let i = 0; i < 10 && app.state() === "caricamento"; i++) await drain();
    }
    const currentState = app.run("statoRuntimeSillabe");
    read.resolve(); await app.settle();
    if (next === "personale") {
        assert.equal(app.run("statoRuntimeSillabe.generazione"), currentState.generazione);
        assert.equal(app.run("statoRuntimeSillabe.origine"), "locale", "Nuova generazione personale promossa da stima a dati ufficiali");
        assert.equal(app.run("motore.ha_profilo_sillabe_personale()"), true);
        assert(app.associations.every(id => !app.calls.some(call => call.id === id && call.name === "carica_vocabolario_ordinato_da_testo")));
    } else assert.equal(app.run("statoRuntimeSillabe"), currentState);
    assert.equal(app.associations.length, next === "personale" ? 1 : 0);
    assert.equal(app.state(), next === "personale" ? "pronto" : "non_disponibile");
    assert.equal((await cache.pointer()).corrente.artifact_sha256, available.artifact_sha256);
    await app.close();
}
for (const suffix of [secondManifest.artifact, ".anagrammi-approved-runtime-v1"]) {
    const cache = await approvedStore();
    const write = deferred(); cache.putGate = { suffix, promise: write.promise };
    let entered = false; cache.beforePut = url => { if (url.endsWith(suffix)) entered = true; };
    const app = await application({ runtimeCache: cache, manifest: secondManifest, artifact: secondBinary });
    for (let i = 0; i < 30 && !entered; i++) await drain();
    assert.equal(entered, true);
    await app.run('creaCopiaPersonale("personale.txt", "nota\\n", true)');
    await app.run("usaVocabolarioPersonale()");
    const state = app.run("statoRuntimeSillabe");
    write.resolve(); await app.settle();
    assert.equal(app.run("statoRuntimeSillabe"), state);
    assert.equal((await cache.pointer()).corrente.artifact_sha256, available.artifact_sha256);
    assert.equal(cache.artifacts().length, 1);
    await app.close();
}
console.log("PASS generation safety in lettura locale e put byte/puntatore, rollback commit obsoleto");

const approvalBinary = fixture(dictionary, counts.map(row => row.length ? [7] : []));
const approvalManifest = manifestFor(approvalBinary);
for (const phase of ["puntatore", "keys", "delete", "completa"]) {
    // P e A sono entrambi necessari al rollback; GC(B + A) puo' cancellare P.
    const cache = await approvedStore();
    const app = await application({ runtimeCache: cache, manifest: secondManifest, artifact: secondBinary });
    await app.settle();
    const before = await cache.pointer();
    const required = cache.artifacts();
    const own = await cache.open("anagrammi-app-syllable-runtime-v1");
    const snapshots = await Promise.all(required.map(async url => new Uint8Array(await (await own.match(url)).arrayBuffer())));
    const foreign = await cache.open("sillabe-reviewer-shell-approval-fixture");
    await foreign.put("https://foreign.test/keep", new Response("untouched"));
    const gate = deferred();
    let entered = false;
    await app.run(`globalThis.approvazioneAttiva = true;
        motore.associa_runtime_sillabe_da_bytes(new Uint8Array(${JSON.stringify([...approvalBinary])}), ${JSON.stringify(approvalManifest.artifact_sha256)});`);
    if (phase === "puntatore") {
        cache.afterPut = url => {
            if (url.endsWith(".anagrammi-approved-runtime-v1") && !entered) {
                entered = true;
                app.run("approvazioneAttiva = false");
            }
        };
    } else if (phase === "keys") {
        cache.keysGate = gate.promise;
        cache.beforeKeys = () => { entered = true; };
    } else if (phase === "delete") {
        cache.deleteGate = { suffix: available.artifact, promise: gate.promise };
        cache.beforeDelete = url => { if (url.endsWith(available.artifact)) entered = true; };
    }
    const start = cache.events.length;
    const result = app.run(`storageRuntimeSillabe.approva(${JSON.stringify(approvalManifest)},
        new Uint8Array(${JSON.stringify([...approvalBinary])}), () => approvazioneAttiva)`)
        .then(value => ({ value }), error => ({ error }));
    if (phase === "keys" || phase === "delete") {
        for (let i = 0; i < 80 && !entered; i++) await drain();
        assert.equal(entered, true, phase);
        assert.equal((await cache.pointer()).corrente.artifact_sha256, approvalManifest.artifact_sha256);
        app.run("approvazioneAttiva = false");
        gate.resolve();
    }
    const outcome = await result;
    cache.keysGate = null;
    if (phase === "completa") {
        assert.equal(outcome.value, true);
        const pointer = await cache.pointer();
        assert.deepEqual(pointer.corrente, approvalManifest);
        assert.deepEqual(pointer.precedente, secondManifest);
        assert.equal(await own.match(required.find(url => url.endsWith(available.artifact))), undefined);
        for (const manifest of [pointer.corrente, pointer.precedente]) {
            assert.ok(await own.match(cache.artifacts().find(url => url.endsWith(manifest.artifact))));
        }
    } else {
        assert.equal(entered, true, phase);
        assert.match(outcome.error.message, /Generazione runtime non piu/);
        assert.deepEqual(await cache.pointer(), before, phase);
        for (let i = 0; i < required.length; i++) {
            assert.deepEqual(new Uint8Array(await (await own.match(required[i])).arrayBuffer()), snapshots[i], phase);
        }
        assert.equal(cache.artifacts().some(url => url.endsWith(approvalManifest.artifact)), false);
        if (phase === "delete") {
            const writes = cache.events.slice(start);
            const restore = writes.findIndex(entry => entry.url.endsWith(available.artifact));
            assert.ok(restore >= 0, "P cancellato dalla delete in volo deve essere ripristinato");
            assert.ok(writes.at(-1).url.endsWith(".anagrammi-approved-runtime-v1"), "rollback: byte prima, puntatore ultimo");
        }
    }
    assert.equal(cache.artifacts().length, 2, phase);
    assert.equal(await (await foreign.match("https://foreign.test/keep")).text(), "untouched");
    await app.close();
}
console.log("PASS approva A+P -> B: obsolescenza dopo PUT/durante GC/delete, rollback completo; successo B+A massimo due artifact");

for (const phase of ["puntatore", "keys", "delete"]) {
    const cache = await approvedStore();
    const app = await application({ runtimeCache: cache, manifest: secondManifest, artifact: secondBinary });
    await app.settle();
    const before = await cache.pointer();
    const required = cache.artifacts();
    const own = await cache.open("anagrammi-app-syllable-runtime-v1");
    const snapshots = await Promise.all(required.map(async url => new Uint8Array(await (await own.match(url)).arrayBuffer())));
    const foreign = await cache.open("sillabe-reviewer-shell-discard-fixture");
    await foreign.put("https://foreign.test/keep", new Response("untouched"));
    const gate = deferred();
    let entered = false;
    if (phase === "puntatore") {
        cache.putGate = { suffix: ".anagrammi-approved-runtime-v1", promise: gate.promise };
        cache.beforePut = url => { if (url.endsWith(cache.putGate.suffix)) entered = true; };
    } else if (phase === "keys") {
        cache.keysGate = gate.promise;
        cache.beforeKeys = () => { entered = true; };
    } else {
        cache.deleteGate = { suffix: secondManifest.artifact, promise: gate.promise };
        cache.beforeDelete = url => { if (url.endsWith(secondManifest.artifact)) entered = true; };
    }
    const result = app.run("(() => { const generation = generazioneMotore; return storageRuntimeSillabe.scartaApprovato(statoRuntimeSillabe.manifest, () => generazioneOriginaleAttiva(generation)); })()")
        .then(() => null, error => error);
    for (let i = 0; i < 80 && !entered; i++) await drain();
    assert.equal(entered, true, phase);
    await app.run('creaCopiaPersonale("personale.txt", "nota\\n", true)');
    await app.run("usaVocabolarioPersonale()");
    const state = app.run("statoRuntimeSillabe");
    gate.resolve();
    assert.match((await result).message, /Generazione runtime non piu/);
    cache.keysGate = null;
    await app.settle();
    assert.equal(app.run("statoRuntimeSillabe"), state);
    assert.deepEqual(await cache.pointer(), before, phase);
    assert.equal(cache.artifacts().length, 2);
    for (let i = 0; i < required.length; i++) {
        assert.deepEqual(new Uint8Array(await (await own.match(required[i])).arrayBuffer()), snapshots[i], phase);
    }
    assert.equal(await (await foreign.match("https://foreign.test/keep")).text(), "untouched");
    await app.close();
}
console.log("PASS scartaApprovato obsoleto durante PUT/keys/delete: rollback puntatore e byte, entrambi i runtime preservati");

const changedGate = deferred();
const changedCache = await approvedStore(); changedCache.readGate = changedGate.promise;
const changedApp = await application({ runtimeCache: changedCache, failManifest: true });
await drain();
Object.assign(changedApp.settings, { dictionary: changedDictionary, failManifest: false,
    artifact: changedArtifact, manifest: { ...manifestFor(changedArtifact),
        vocabolario_sha256: hash(changedDictionary), numero_grafie: 2 } });
await changedApp.run("usaVocabolarioOriginale()"); await drain();
changedGate.resolve(); await changedApp.settle();
assert.equal(changedApp.state(), "pronto");
assert.equal(changedApp.run("motore.esporta_vocabolario_testo()"), changedText);
assert.deepEqual(changedApp.associations, [changedApp.lifetimes.at(-1).id]);
assert.equal((await changedCache.pointer()).corrente.artifact_sha256, hash(changedArtifact));
await changedApp.close();
console.log("PASS fallback A pendente -> snapshot originale B diverso: solo B associato/promosso");

const racedCache = await approvedStore();
const racedRead = deferred(); racedCache.readGate = racedRead.promise;
await (await racedCache.open("anagrammi-app-syllable-runtime-v1")).put(racedCache.artifacts()[0], new Response(corrupt));
const badReader = await application({ runtimeCache: racedCache, failManifest: true });
await drain();
const goodWriter = await application({ runtimeCache: racedCache, manifest: secondManifest, artifact: secondBinary });
await drain(); racedRead.resolve();
await goodWriter.settle(); await badReader.settle();
assert.equal(badReader.state(), "errore"); assert.equal(goodWriter.state(), "pronto");
assert.equal((await racedCache.pointer()).corrente.artifact_sha256, secondManifest.artifact_sha256);
await badReader.close(); await goodWriter.close();
console.log("PASS scarto di A corrotto non cancella B appena approvato da altra scheda");

const orphanCache = await approvedStore();
const orphanUrl = orphanCache.artifacts()[0].replace(available.artifact, `runtime-sillabe-${"a".repeat(64)}.bin`);
const orphanStore = await orphanCache.open("anagrammi-app-syllable-runtime-v1");
await orphanStore.put(orphanUrl, new Response(secondBinary));
const unrelatedUrl = `https://foreign.test/runtime-sillabe-${"b".repeat(64)}.bin`;
await orphanStore.put(unrelatedUrl, new Response("foreign bytes"));
const orphanApp = await application({ runtimeCache: orphanCache, failManifest: true });
await orphanApp.settle();
assert.equal(orphanApp.state(), "pronto");
assert.equal(await orphanStore.match(orphanUrl), undefined);
assert.equal(await (await orphanStore.match(unrelatedUrl)).text(), "foreign bytes");
await orphanApp.close();
console.log("PASS GC orfani da interruzione alla lettura offline, senza eliminare chiavi fuori canale");

const shared = await approvedStore();
for (const name of ["anagrammi-app-release-foreign", "sillabe-reviewer-shell-foreign", "unrelated"]) {
    const cache = await shared.open(name); await cache.put("https://foreign.test/keep", new Response("untouched"));
}
const tabOne = await application({ runtimeCache: shared, manifest: secondManifest, artifact: secondBinary });
const thirdBinary = fixture(dictionary, counts.map(row => row.length ? [7] : []));
const thirdManifest = manifestFor(thirdBinary);
const tabTwo = await application({ runtimeCache: shared, manifest: thirdManifest, artifact: thirdBinary });
await tabOne.settle(); await tabTwo.settle();
const sharedPointer = await shared.pointer();
assert.ok([secondManifest.artifact_sha256, thirdManifest.artifact_sha256].includes(sharedPointer.corrente.artifact_sha256));
assert.equal(shared.artifacts().length, 2);
for (const record of [sharedPointer.corrente, sharedPointer.precedente]) {
    assert.ok(shared.artifacts().some(url => url.endsWith(record.artifact)));
}
for (const name of ["anagrammi-app-release-foreign", "sillabe-reviewer-shell-foreign", "unrelated"]) {
    assert.equal(await (await (await shared.open(name)).match("https://foreign.test/keep")).text(), "untouched");
}
await tabOne.close(); await tabTwo.close();
const reread = await application({ runtimeCache: shared, failManifest: true });
await reread.settle(); assert.equal(reread.state(), "pronto"); await reread.close();
console.log("PASS schede concorrenti, ultimo scrittore verificato, GC corrente+precedente, cache estranee invariate");

const noLocksCache = new RuntimeCaches();
noLocksCache.locks.request = undefined;
const noLocksApp = await application({ runtimeCache: noLocksCache, manifest: available });
await noLocksApp.settle(); assert.equal(noLocksApp.state(), "pronto");
assert.equal(await noLocksCache.pointer(), null); await noLocksApp.close();
console.log("PASS Web Locks assenti: sessione online valida, nessuna scrittura condivisa non sicura");

function impostaFiltro(app, mode = "ESATTAMENTE", min = "2", max = "3") {
    app.elements.get("#filtra-sillabe").checked = true;
    app.elements.get("#modalita-sillabe").value = mode;
    app.elements.get("#minimo-sillabe").value = min;
    app.elements.get("#massimo-sillabe").value = max;
    app.elements.get("#filtra-sillabe").listeners.change();
}

async function ricercaUI(app, command) {
    app.elements.get("#comando").value = command;
    await app.run("eseguiComando()");
}

function righeUI(app) {
    return app.elements.get("#risultato").children.filter(row => row.className === "riga-risultato")
        .map(row => row.children[0].textContent);
}

for (const options of [{}, { manifest: { ...available, schema: 7 } }]) {
    const app = await application(options);
    await app.settle();
    assert.equal(app.elements.get("#filtra-sillabe").disabled, true);
    assert.equal(app.elements.get("#filtra-sillabe").checked, false);
    assert.equal(app.elements.get("#campi-sillabe").hidden, true);
    await ricercaUI(app, "roma");
    assert.equal(app.searches.at(-1).name, "avvia_comando_paginato");
    assert.equal(app.run("ultimoRisultato.tipo"), "ricerca");
    await app.close();
}
const uiGate = deferred();
const uiLoading = await application({ manifest: available, waitManifest: uiGate.promise });
assert.equal(uiLoading.state(), "caricamento");
assert.equal(uiLoading.elements.get("#filtra-sillabe").disabled, true);
assert.equal(uiLoading.elements.get("#stato-sillabe").textContent, "Caricamento dati sillabici...");
await ricercaUI(uiLoading, "roma");
assert.equal(uiLoading.searches.at(-1).name, "avvia_comando_paginato");
uiGate.resolve(); await uiLoading.settle();
assert.equal(uiLoading.elements.get("#filtra-sillabe").disabled, false);
assert.equal(uiLoading.elements.get("#filtra-sillabe").checked, false);

await ricercaUI(uiLoading, "*");
const baselineRows = righeUI(uiLoading);
for (const [mode, min, max, expected] of [
    ["ESATTAMENTE", "2", "999", ["nota", "amor", "citta", "citt\u00e0"]],
    ["ALMENO", "4", "999", ["roma", "roma", "ramo"]],
    ["AL_MASSIMO", "3", "999", ["nota", "roma", "amor", "citta", "citt\u00e0"]],
    ["TRA", "3", "4", ["roma", "ramo"]],
]) {
    impostaFiltro(uiLoading, mode, min, max);
    await ricercaUI(uiLoading, "*");
    const call = uiLoading.searches.at(-1);
    assert.equal(call.name, "avvia_comando_paginato_con_filtro_sillabe");
    assert.equal(call.args[1], wasm.ModalitaFiltroSillabe[mode]);
    assert.equal(call.args[2], Number(min));
    assert.equal(call.args[3], mode === "TRA" ? Number(max) : Number(min));
    assert.deepEqual(righeUI(uiLoading), expected);
    assert.equal(uiLoading.elements.get("#campo-massimo-sillabe").hidden, mode !== "TRA");
}
for (const [mode, min, max, field] of [
    ...["", "0", "-1", "1.5", "4294967296"].map(value => ["ESATTAMENTE", value, "3", "#minimo-sillabe"]),
    ...["", "0", "-1", "1.5", "4294967296"].map(value => ["TRA", "2", value, "#massimo-sillabe"]),
    ["TRA", "4", "3", "#massimo-sillabe"],
]) {
    impostaFiltro(uiLoading, mode, min, max);
    const calls = uiLoading.searches.length;
    await ricercaUI(uiLoading, "*");
    assert.equal(uiLoading.searches.length, calls, "Valori invalidi non arrivano al WASM");
    assert.equal(uiLoading.elements.get("#errore-sillabe").hidden, false);
    assert.equal(uiLoading.elements.get(field).attributes["aria-invalid"], "true");
    assert.equal(uiLoading.elements.get(field).focused, true);
}
impostaFiltro(uiLoading, "ESATTAMENTE", "4294967295");
await ricercaUI(uiLoading, "*");
assert.equal(uiLoading.searches.at(-1).args[2], 4294967295);
assert.deepEqual(righeUI(uiLoading), []);
uiLoading.elements.get("#filtra-sillabe").checked = false;
uiLoading.elements.get("#filtra-sillabe").listeners.change();
await ricercaUI(uiLoading, "*");
assert.equal(uiLoading.searches.at(-1).name, "avvia_comando_paginato");
assert.deepEqual(righeUI(uiLoading), baselineRows);

const reference = new wasm.MotoreAnagrammi();
reference.carica_vocabolario_ordinato_con_identita_da_bytes(dictionary);
reference.associa_runtime_sillabe_da_bytes(binary, available.artifact_sha256);
impostaFiltro(uiLoading, "ALMENO", "1");
try {
    for (const command of ["roma", "romax 4", "r?ma", "r*", "*ma", "*o*", "r?*", "?*m?", "&amor", "!roma", "$amor"]) {
        const raw = reference.esegui_comando_con_filtro_sillabe(command, wasm.ModalitaFiltroSillabe.ALMENO, 1, 1);
        const expected = [];
        try { for (let i = 0; i < raw.righe.size(); i++) expected.push(raw.righe.get(i)); }
        finally { raw.righe.delete(); raw.parole_vocabolario.delete(); }
        await ricercaUI(uiLoading, command);
        assert.deepEqual(righeUI(uiLoading), expected, command);
        assert.equal(uiLoading.searches.at(-1).args[0], command, "Nessun parser JS alternativo");
    }
    await ricercaUI(uiLoading, "^,1,4");
    assert.equal(uiLoading.searches.at(-1).name, "avvia_comando_paginato_con_filtro_sillabe");
    assert.equal(uiLoading.run("ultimoRisultato.tipo"), "ricerca");
    assert.equal(uiLoading.run("ultimoRisultato.totale"), 1);
    const original = uiLoading.run("motore.esporta_vocabolario_testo()");
    for (const command of ["+ nuova", "- roma"]) {
        await ricercaUI(uiLoading, command);
        assert.equal(uiLoading.run("ultimoRisultato"), null);
        assert.match(uiLoading.elements.get("#risultato").children[0].textContent, /\+ \/ - non sono ammesse/);
        assert.equal(uiLoading.run("motore.esporta_vocabolario_testo()"), original);
    }
} finally { reference.delete(); }
await uiLoading.run('creaCopiaPersonale("personale.txt", "nota\\nroma\\n", true)');
await uiLoading.run("usaVocabolarioPersonale()");
assert.equal(uiLoading.elements.get("#filtra-sillabe").disabled, false);
uiLoading.elements.get("#filtra-sillabe").checked = false;
await ricercaUI(uiLoading, "+ ramo");
assert.equal(uiLoading.run("ultimoRisultato.vocabolarioModificato"), true);
await ricercaUI(uiLoading, "ramo");
assert.equal(uiLoading.searches.at(-1).name, "avvia_comando_paginato");
assert.equal(righeUI(uiLoading).includes("ramo"), true);
const reloadGate = deferred();
uiLoading.settings.waitManifest = reloadGate.promise;
await uiLoading.run("usaVocabolarioOriginale()");
assert.equal(uiLoading.elements.get("#filtra-sillabe").disabled, true);
assert.equal(uiLoading.state(), "caricamento");
reloadGate.resolve(); await uiLoading.settle();
assert.equal(uiLoading.elements.get("#filtra-sillabe").disabled, false);
assert.equal(uiLoading.elements.get("#filtra-sillabe").checked, false);
for (const [manifest, expected] of [
    [{ schema: 1, disponibile: false }, "Filtro sillabico non disponibile"],
    [{ ...available, schema: 8 }, "Errore caricamento dati sillabici"],
]) {
    Object.assign(uiLoading.settings, { manifest: available, waitManifest: undefined });
    await uiLoading.run("usaVocabolarioOriginale()"); await uiLoading.settle();
    impostaFiltro(uiLoading);
    const next = deferred();
    Object.assign(uiLoading.settings, { manifest, waitManifest: next.promise });
    await uiLoading.run("usaVocabolarioOriginale()");
    assert.equal(uiLoading.elements.get("#filtra-sillabe").checked, false, "Nuova generazione disattiva il filtro");
    assert.equal(uiLoading.elements.get("#filtra-sillabe").disabled, true);
    assert.equal(uiLoading.elements.get("#stato-sillabe").textContent, "Caricamento dati sillabici...");
    next.resolve(); await uiLoading.settle();
    assert.equal(uiLoading.elements.get("#stato-sillabe").textContent, expected);
    assert.equal(uiLoading.elements.get("#filtra-sillabe").disabled, true);
    await ricercaUI(uiLoading, "roma");
    assert.equal(uiLoading.searches.at(-1).name, "avvia_comando_paginato");
}
await uiLoading.close();

const uiOffline = await application({ runtimeCache: await approvedStore(), failManifest: true });
await uiOffline.settle();
assert.equal(uiOffline.run("statoRuntimeSillabe.origine"), "locale");
assert.equal(uiOffline.elements.get("#filtra-sillabe").disabled, false);
assert.match(uiOffline.elements.get("#stato-sillabe").textContent, /offline/);
impostaFiltro(uiOffline); await ricercaUI(uiOffline, "*");
assert.equal(uiOffline.searches.at(-1).name, "avvia_comando_paginato_con_filtro_sillabe");
await uiOffline.close();
console.log("PASS UI sillabe con WASM reale: 4 modalita', uint32/invalidi senza chiamate, ricerche lessicali, +/- rifiutati, personale/originale e fallback locale");

const hybrid = await application({ manifest: available });
await hybrid.settle();
await hybrid.run('creaCopiaPersonale("ibrido.txt", "roma\\nnota\\nnon\\nnuova\\n", true)');
await hybrid.run("usaVocabolarioPersonale()");
assert.equal(hybrid.state(), "pronto");
assert.equal(hybrid.elements.get("#filtra-sillabe").disabled, false);
assert.match(hybrid.elements.get("#nota-sillabe").textContent, /stima automatica/);
for (const count of [3, 4, 5]) {
    impostaFiltro(hybrid, "ESATTAMENTE", String(count));
    await ricercaUI(hybrid, "r?ma"); assert.deepEqual(righeUI(hybrid), ["roma"]);
}
impostaFiltro(hybrid, "TRA", "1", "100");
await ricercaUI(hybrid, "non"); assert.deepEqual(righeUI(hybrid), []);
hybrid.elements.get("#filtra-sillabe").checked = false;
await ricercaUI(hybrid, "+ parolastranissima");
assert(hybrid.saved().aggiunte.includes("parolastranissima"));
impostaFiltro(hybrid, "ESATTAMENTE", "7"); await ricercaUI(hybrid, "parolastranissim*");
assert.deepEqual(righeUI(hybrid), ["parolastranissima"]);
assert.equal(hybrid.searches.at(-1).name, "avvia_comando_paginato_con_filtro_sillabe");
hybrid.elements.get("#filtra-sillabe").checked = false;
await ricercaUI(hybrid, "- parolastranissima");
assert(hybrid.saved().rimosse.includes("parolastranissima"));
impostaFiltro(hybrid, "ESATTAMENTE", "7"); await ricercaUI(hybrid, "parolastranissim*");
assert.deepEqual(righeUI(hybrid), []);
hybrid.elements.get("#filtra-sillabe").checked = false;
await ricercaUI(hybrid, "- roma"); await ricercaUI(hybrid, "+ roma");
impostaFiltro(hybrid, "ALMENO", "5"); await ricercaUI(hybrid, "r?ma"); assert.deepEqual(righeUI(hybrid), ["roma"]);
await hybrid.run("usaVocabolarioPersonale()");
impostaFiltro(hybrid, "AL_MASSIMO", "3"); await ricercaUI(hybrid, "r?ma"); assert.deepEqual(righeUI(hybrid), ["roma"]);
await hybrid.close();
const estimateOnly = await application({ manifest: placeholder });
await estimateOnly.settle();
await estimateOnly.run('creaCopiaPersonale("stima.txt", "nuova\\nbrrr\\n", true)');
await estimateOnly.run("usaVocabolarioPersonale()"); await estimateOnly.settle();
assert.equal(estimateOnly.state(), "pronto");
assert.equal(estimateOnly.associations.length, 0);
assert.match(estimateOnly.elements.get("#nota-sillabe").textContent, /Dati ufficiali non disponibili/);
impostaFiltro(estimateOnly, "ESATTAMENTE", String(wasm.conta_sillabe("nuova")));
await ricercaUI(estimateOnly, "*"); assert.deepEqual(righeUI(estimateOnly), ["nuova"]);
await estimateOnly.close();
console.log("PASS profilo personale ibrido/stima: grafia duplicata, ambiguita', esclusione, quattro filtri, +/- persistiti, reload e percorso paginato");

const upgradeGate = deferred();
const upgrading = await application({ manifest: available, waitBody: upgradeGate.promise });
await drain();
await upgrading.run('creaCopiaPersonale("in-attesa.txt", "roma\\n", true)');
await upgrading.run("usaVocabolarioPersonale()");
impostaFiltro(upgrading, "ESATTAMENTE", "2"); await ricercaUI(upgrading, "r?ma");
assert.deepEqual(righeUI(upgrading), ["roma"], "Stima utilizzabile durante il caricamento ufficiale");
upgradeGate.resolve(); await upgrading.settle();
assert.equal(upgrading.run("ultimoRisultato"), null, "Snapshot della stima liberato prima di nuove pagine");
assert.match(upgrading.elements.get("#risultato").children[0].textContent, /Dati sillabici aggiornati/);
impostaFiltro(upgrading, "ESATTAMENTE", "3"); await ricercaUI(upgrading, "r?ma");
assert.deepEqual(righeUI(upgrading), ["roma"]);
await upgrading.close();
console.log("PASS transizione stima -> dati ufficiali: risultato obsoleto liberato, nuova ricerca coerente, nessun reroll automatico");

export { dictionary, binary, available, application, ricercaUI, righeUI, fixture, wasm };
