// Run ONLY on a disposable project copy: this test changes fixture CSS/vocabulary.
// node tests/pwa_test.mjs <copy-root> <playwright-module> [--rebuild]
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile, writeFile, cp, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { verificaIcone } from "./pwa_icone_test.mjs";
import { verificaCrediti } from "./crediti_test.mjs";

const root = path.resolve(process.argv[2]);
const playwrightPath = process.argv[3];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const powershell = process.env.PWA_POWERSHELL ?? "pwsh.exe";
const prefix = "anagrammi-app-release-";
const metadata = "anagrammi-app-metadata-v1";
const foreign = ["sillabe-reviewer-shell-fixture", "another-app-fixture"];
const dist = path.join(root, "dist");
assert.ok(!await lstat(path.join(root, ".git")).catch(() => null),
    "Run in a disposable copy without .git, never in the repository");
const originalDictionary = await readFile(path.join(root, "VocabolarioItaliano.txt"));
const originalCss = await readFile(path.join(root, "web/style.css"));
const originalCount = originalDictionary.toString("utf8").split("\n").filter(Boolean).length;

function ps(command) {
    return execFileSync(powershell, ["-NoProfile", "-Command", command], {
        env: { ...process.env, EM_FROZEN_CACHE: "1" }, encoding: "utf8", stdio: "pipe",
    });
}
const quote = value => `'${value.replaceAll("'", "''")}'`;
async function inventory(directory) {
    await verificaIcone(root, directory);
    await verificaCrediti(root, directory);
    const item = JSON.parse(await readFile(path.join(directory, "release.json"), "utf8"));
    assert.equal(item.schema, 1);
    assert.equal(item.identity_scheme, "anagrammi-release-v1");
    const release = path.join(directory, "releases", item.release_id);
    for (const asset of item.assets) {
        const bytes = await readFile(path.join(release, asset.path));
        assert.equal(bytes.length, asset.size_bytes, asset.path);
        assert.equal(hash(bytes), asset.sha256, asset.path);
        assert.ok(!asset.path.startsWith("data/runtime-sillabe"));
    }
    let seed = "anagrammi-release-v1\n";
    for (const entry of [...item.identity_inputs, ...item.assets.filter(asset => !asset.derived)]) {
        seed += `${entry.path}\t${entry.size_bytes}\t${entry.sha256}\n`;
    }
    assert.equal(hash(seed), item.release_id);
    for (const [name, file] of [["index-template", "index.html"], ["service-worker-template", "service-worker.template.js"]]) {
        const bytes = await readFile(path.join(root, "web", file));
        assert.equal(item.identity_inputs.find(entry => entry.path === name).sha256, hash(bytes));
    }
    const html = await readFile(path.join(directory, "index.html"), "utf8");
    assert.equal(html, await readFile(path.join(release, "index.html"), "utf8"));
    for (const asset of ["app.js", "presentazione.js", "style.css", "manifest.webmanifest", "DATASET.md"]) {
        assert.ok(html.includes(`./releases/${item.release_id}/${asset}`));
        assert.ok(!html.includes(`"./${asset}"`));
    }
    const manifest = JSON.parse(await readFile(path.join(release, "manifest.webmanifest"), "utf8"));
    assert.equal(manifest.scope, "../../");
    assert.equal(manifest.start_url, "../../");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.short_name, "ARCA");
    assert.ok(item.assets.some(asset => asset.path === "assets/branding/hero-toscana-preview.png"));
    const runtimeManifest = JSON.parse(await readFile(path.join(directory, "data/runtime-sillabe.manifest.json")));
    assert.deepEqual(runtimeManifest, JSON.parse(await readFile(path.join(root, "web/data/runtime-sillabe.manifest.json"))));
    assert.ok(!item.assets.some(asset => asset.path.includes("runtime-sillabe.manifest") || asset.path.endsWith(".bin")));
    if (runtimeManifest.disponibile) {
        const runtime = await readFile(path.join(directory, "data", runtimeManifest.artifact));
        assert.equal(hash(runtime), runtimeManifest.artifact_sha256);
        assert.equal(runtime.length, runtimeManifest.dimensione_byte);
    }
    return item;
}
async function snapshot(name) {
    const directory = path.join(root, ".pwa-test-output", name);
    await cp(dist, directory, { recursive: true });
    return { directory, inventory: await inventory(directory) };
}

class FakeCaches {
    stores = new Map(); failPrefix = null;
    async keys() { return [...this.stores.keys()]; }
    async delete(name) { return this.stores.delete(name); }
    async open(name) {
        if (!this.stores.has(name)) this.stores.set(name, new Map());
        const data = this.stores.get(name);
        const key = request => typeof request === "string" ? request : request.url ?? request.href;
        return {
            match: async request => data.get(key(request))?.clone(),
            put: async (request, response) => {
                if (this.failPrefix && name.startsWith(this.failPrefix)) {
                    throw new DOMException("Fixture quota", "QuotaExceededError");
                }
                data.set(key(request), response.clone());
            },
        };
    }
}
async function worker(snapshot, caches, failure = null, corrupt = false) {
    const events = new Map();
    const context = vm.createContext({
        URL, Response, Uint8Array, crypto: webcrypto, caches, console,
        self: { registration: { scope: "https://fixture.test/anagrammi/" },
            addEventListener: (type, handler) => events.set(type, handler) },
        fetch: async input => {
            const relative = new URL(String(input)).pathname.replace(/^\/anagrammi\//, "");
            if (failure && relative.endsWith(failure)) {
                if (!corrupt) return new Response("missing", { status: 404 });
                const bytes = await readFile(path.join(snapshot.directory, relative));
                bytes[0] ^= 1;
                return new Response(bytes);
            }
            return new Response(await readFile(path.join(snapshot.directory, relative)));
        },
    });
    vm.runInContext(await readFile(path.join(snapshot.directory, "service-worker.js"), "utf8"), context);
    return {
        run(type) { let promise; events.get(type)({ waitUntil: value => { promise = value; } }); return promise; },
        intercepted(url) {
            let called = false;
            events.get("fetch")({ request: { method: "GET", mode: "cors", url }, respondWith: () => { called = true; } });
            return called;
        },
    };
}
async function unitTests(a, b, c) {
    const caches = new FakeCaches();
    for (const name of foreign) await caches.open(name);
    const wa = await worker(a, caches);
    await wa.run("install"); await wa.run("activate");
    assert.ok(!wa.intercepted("https://fixture.test/anagrammi/data/runtime-sillabe.manifest.json"));
    assert.ok(!wa.intercepted("https://fixture.test/anagrammi/data/runtime-sillabe-fixture.bin"));
    const broken = await worker(b, caches, "anagrammi.wasm");
    await assert.rejects(broken.run("install"), /non disponibile/);
    assert.ok(!(await caches.keys()).includes(prefix + b.inventory.release_id));
    const quota = await worker(b, caches);
    caches.failPrefix = prefix + b.inventory.release_id;
    await assert.rejects(quota.run("install"), /Fixture quota/);
    caches.failPrefix = null;
    assert.ok(!(await caches.keys()).includes(prefix + b.inventory.release_id));
    assert.ok((await caches.keys()).includes(prefix + a.inventory.release_id));
    const badBytes = await worker(b, caches, "anagrammi.wasm", true);
    await assert.rejects(badBytes.run("install"), /incoerente/);
    assert.ok(!(await caches.keys()).includes(prefix + b.inventory.release_id));
    for (const [icon, corrupt] of [["assets/icons/icon-192.png", false], ["assets/icons/icon-maskable-512.png", true]]) {
        const brokenIcon = await worker(b, caches, icon, corrupt);
        await assert.rejects(brokenIcon.run("install"), /non disponibile|incoerente/);
        assert.ok(!(await caches.keys()).includes(prefix + b.inventory.release_id));
        assert.ok((await caches.keys()).includes(prefix + a.inventory.release_id));
    }
    for (const [pdf, corrupt] of [["papers/ordinamento_arca_paper_it.pdf", false], ["papers/ordinamento_arca_paper_en.pdf", true]]) {
        const brokenPaper = await worker(b, caches, pdf, corrupt);
        await assert.rejects(brokenPaper.run("install"), /non disponibile|incoerente/);
        assert.ok(!(await caches.keys()).includes(prefix + b.inventory.release_id));
        assert.ok((await caches.keys()).includes(prefix + a.inventory.release_id));
    }
    const wb = await worker(b, caches);
    await wb.run("install"); await wb.run("activate");
    const wc = await worker(c, caches);
    await wc.run("install"); await wc.run("activate");
    assert.deepEqual((await caches.keys()).filter(name => name.startsWith(prefix)).sort(),
        [prefix + b.inventory.release_id, prefix + c.inventory.release_id].sort());
    for (const name of foreign) assert.ok((await caches.keys()).includes(name));
    console.log("PASS SW: precache incomplete/quota cleanup, runtime pass-through, GC isolation");
}

function smallRuntime(count) {
    const dictionary = Buffer.from("nota\nroma\n");
    const bytes = Buffer.alloc(225);
    bytes.set([83, 73, 76, 76, 66, 77, 0, 0]);
    bytes.writeUInt16LE(1, 8); bytes.writeUInt16LE(192, 10);
    for (const [offset, value] of [[16, 2], [20, 1], [24, 2], [28, 1]]) bytes.writeUInt32LE(value, offset);
    for (const [offset, value] of [[32, 192], [40, 208], [48, 224], [56, 225]]) bytes.writeBigUInt64LE(BigInt(value), offset);
    bytes.set(Buffer.from(hash(dictionary), "hex"), 64);
    bytes.set(Buffer.from(hash("test browser sintetico"), "hex"), 96);
    for (const offset of [192, 200]) { bytes.writeUInt32LE(2, offset); bytes[offset + 4] = 1; bytes[offset + 5] = 1; }
    bytes.writeUInt32LE(count, 208); bytes.writeUInt32LE(2, 212); bytes.writeBigUInt64LE(224n, 216);
    bytes[224] = 3;
    bytes.set(Buffer.from(hash(bytes.subarray(192)), "hex"), 128);
    return { bytes: [...bytes], dictionary: [...dictionary], manifest: {
        schema: 1, disponibile: true, formato: "sillabe-bitmap-le-v1", numero_grafie: 2,
        artifact: `runtime-sillabe-${hash(bytes)}.bin`, artifact_sha256: hash(bytes),
        vocabolario_sha256: hash(dictionary), dimensione_byte: bytes.length,
    } };
}

async function nativeRuntimeStorage(context, probe, origin, release) {
    const other = await context.newPage();
    await other.goto(origin + "/probe.html");
    const releaseBase = `${origin}/anagrammi/releases/${release.inventory.release_id}/`;
    for (const page of [probe, other]) {
        await page.evaluate(async ({ releaseBase, origin }) => {
            const { creaStorageRuntimeSillabe } = await import(releaseBase + "runtime-sillabe-storage.js");
            const { default: createModule } = await import(releaseBase + "anagrammi.js");
            const modulo = await createModule();
            const storage = creaStorageRuntimeSillabe(new URL("/runtime-test/data/runtime-sillabe.manifest.json", origin));
            // Il test usa C++ reale PRIMA di chiedere allo storage di promuovere.
            function verifica(record) {
                const motore = new modulo.MotoreAnagrammi();
                try {
                    motore.carica_vocabolario_ordinato_con_identita_da_bytes(new Uint8Array(record.dictionary));
                    motore.associa_runtime_sillabe_da_bytes(new Uint8Array(record.bytes), record.manifest.artifact_sha256);
                } finally { motore.delete(); }
            }
            globalThis.nativeRuntimeTest = {
                async approve(record) {
                    verifica(record);
                    return storage.approva(record.manifest, new Uint8Array(record.bytes), () => true);
                },
                async read(dictionary) {
                    const record = await storage.leggiApprovato(() => true);
                    verifica({ ...record, bytes: [...record.bytes], dictionary });
                    return record.manifest.artifact_sha256;
                },
            };
        }, { releaseBase, origin });
    }
    const one = smallRuntime(2), two = smallRuntime(3), three = smallRuntime(4);
    assert.equal(await probe.evaluate(record => nativeRuntimeTest.approve(record), one), true);
    assert.equal(await other.evaluate(dictionary => nativeRuntimeTest.read(dictionary), one.dictionary), one.manifest.artifact_sha256);
    await Promise.all([
        probe.evaluate(record => nativeRuntimeTest.approve(record), two),
        other.evaluate(record => nativeRuntimeTest.approve(record), three),
    ]);
    const saved = await probe.evaluate(async () => {
        const cache = await caches.open("anagrammi-app-syllable-runtime-v1");
        const response = await cache.match(new URL("/runtime-test/data/.anagrammi-approved-runtime-v1", location.origin));
        const pointer = await response.json();
        return { pointer, files: (await cache.keys()).map(request => request.url)
            .filter(url => new URL(url).pathname.startsWith("/runtime-test/data/") && url.endsWith(".bin")) };
    });
    assert.equal(saved.files.length, 2);
    for (const record of [saved.pointer.corrente, saved.pointer.precedente]) {
        assert.ok(saved.files.some(url => url.endsWith(record.artifact)));
    }
    await context.setOffline(true);
    assert.equal(await other.evaluate(dictionary => nativeRuntimeTest.read(dictionary), one.dictionary), saved.pointer.corrente.artifact_sha256);
    await context.setOffline(false);
    await other.close();
    console.log("PASS Chrome: Cache Storage/Web Locks reali, due schede, C++ prima di approvare e dopo lettura offline, GC massimo due artifact");
}

async function browserTests(a, b, c) {
    const { chromium } = await import(pathToFileURL(playwrightPath));
    let current = a;
    let missing = null;
    const requests = [];
    const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html",
        ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain",
        ".png": "image/png", ".ico": "image/x-icon" };
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        requests.push(url.pathname);
        if (url.pathname === "/probe.html") { res.end("<!doctype html><title>Probe</title>"); return; }
        if (!url.pathname.startsWith("/anagrammi/")) { res.writeHead(404).end(); return; }
        const relative = url.pathname.slice("/anagrammi/".length) || "index.html";
        if (relative.includes("..") || missing && relative === missing) { res.writeHead(404).end(); return; }
        try {
            const bytes = await readFile(path.join(current.directory, relative));
            res.writeHead(200, { "Content-Type": types[path.extname(relative)] ?? "application/octet-stream", "Cache-Control": "no-store" });
            res.end(bytes);
        } catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = origin + "/anagrammi/";
    const browser = await chromium.launch({ executablePath: process.env.PWA_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    const probe = await context.newPage();
    await probe.goto(origin + "/probe.html");
    const metadataState = () => probe.evaluate(async () => {
        const cache = await caches.open("anagrammi-app-metadata-v1");
        const entry = await cache.match(new URL("/anagrammi/.anagrammi-app-metadata", location.origin));
        return entry ? entry.json() : null;
    });
    async function until(check, description) {
        for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
        throw new Error("Timeout: " + description);
    }
    async function loaded(page, release, count) {
        await page.waitForFunction(() => !document.querySelector("#comando").disabled);
        assert.equal(await page.locator('meta[name="anagrammi-release"]').getAttribute("content"), release.inventory.release_id);
        assert.equal(Number((await page.locator("#conteggio").innerText()).replace(/\D/g, "")), count);
        const assets = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name)
            .filter(name => /\/(app\.js|persistenza\.js|runtime-sillabe-storage\.js|anagrammi\.(js|wasm)|VocabolarioItaliano\.txt|style\.css)(?:$|\?)/.test(name)));
        assert.ok(assets.some(name => name.endsWith("anagrammi.wasm")));
        assert.ok(assets.some(name => name.endsWith("VocabolarioItaliano.txt")));
        for (const name of assets) assert.ok(name.includes(`/releases/${release.inventory.release_id}/`), name);
    }
    async function clickVocabolario(page, selector) {
        if (!await page.locator(".gestione-vocabolario").evaluate(element => element.open)) {
            await page.locator(".gestione-vocabolario summary").click();
        }
        await page.locator(selector).click();
    }
    async function search(page, command, expected) {
        await page.locator("#comando").fill(command);
        await page.locator("#modulo-ricerca").evaluate(form => form.requestSubmit());
        await page.waitForFunction(text => document.querySelector("#risultato").textContent.includes(text), expected);
    }
    let page;
    try {
        page = await context.newPage();
        await page.goto(url); await loaded(page, a, originalCount);
        await until(async () => (await metadataState())?.current === a.inventory.release_id, "A activation");
        const firstRequests = requests.filter(name => /\/(app\.js|anagrammi\.(js|wasm)|VocabolarioItaliano\.txt)$/.test(name));
        for (const name of firstRequests) assert.ok(name.includes(`/releases/${a.inventory.release_id}/`));
        await page.reload(); await loaded(page, a, originalCount);
        assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
        await probe.evaluate(async names => { for (const name of names) await caches.open(name); }, foreign);
        await nativeRuntimeStorage(context, probe, origin, a);
        await context.setOffline(true);
        await page.reload(); await loaded(page, a, originalCount); await search(page, "casa", "casa");
        const fresh = await context.newPage();
        await fresh.goto(url); await loaded(fresh, a, originalCount); await search(fresh, "casa", "casa");
        await fresh.close();
        await page.locator("#file-vocabolario").setInputFiles({ name: "fixture.txt", mimeType: "text/plain", buffer: Buffer.from("roma\nnota\nramo\n") });
        await page.waitForFunction(() => document.querySelector("#tipo-vocabolario").textContent.includes("personale"));
        await search(page, "+ casa", "aggiunta");
        await page.reload(); await loaded(page, a, originalCount);
        await clickVocabolario(page, "#usa-personale");
        await page.waitForFunction(() => Number(document.querySelector("#conteggio").textContent.replace(/\D/g, "")) === 4);
        const downloadPromise = page.waitForEvent("download");
        await clickVocabolario(page, "#esporta-personale");
        const download = await downloadPromise;
        const exported = (await readFile(await download.path(), "utf8")).trim().split("\n");
        assert.ok(exported.includes("casa")); assert.equal(exported.length, 4);
        await clickVocabolario(page, "#usa-originale");
        await page.waitForFunction(count => Number(document.querySelector("#conteggio").textContent.replace(/\D/g, "")) === count, originalCount);
        await clickVocabolario(page, "#usa-personale");
        await page.waitForFunction(() => Number(document.querySelector("#conteggio").textContent.replace(/\D/g, "")) === 4);
        await clickVocabolario(page, "#usa-originale");
        await context.setOffline(false);
        current = b; missing = `releases/${b.inventory.release_id}/anagrammi.wasm`;
        await probe.evaluate(async () => (await navigator.serviceWorker.getRegistration("/anagrammi/")).update());
        await until(async () => !(await probe.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration("/anagrammi/");
            return Boolean(registration.installing);
        })), "failed B installation");
        assert.equal((await metadataState()).current, a.inventory.release_id);
        assert.ok(!(await probe.evaluate(() => caches.keys())).includes(prefix + b.inventory.release_id));
        await context.setOffline(true); await page.reload(); await loaded(page, a, originalCount);
        await context.setOffline(false); missing = null;
        await probe.evaluate(async () => (await navigator.serviceWorker.getRegistration("/anagrammi/")).update());
        await until(async () => probe.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration("/anagrammi/")).waiting)), "B waiting");
        assert.equal((await metadataState()).current, a.inventory.release_id);
        assert.equal(await page.locator('meta[name="anagrammi-release"]').getAttribute("content"), a.inventory.release_id);
        await page.close();
        await until(async () => (await metadataState())?.current === b.inventory.release_id, "B normal activation");
        await context.setOffline(true); page = await context.newPage(); await page.goto(url); await loaded(page, b, originalCount - 1);
        await search(page, "casa", "casa");
        await context.setOffline(false); current = c;
        await probe.evaluate(async () => (await navigator.serviceWorker.getRegistration("/anagrammi/")).update());
        await until(async () => probe.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration("/anagrammi/")).waiting)), "C waiting");
        await page.close();
        await until(async () => (await metadataState())?.current === c.inventory.release_id, "C activation");
        await context.setOffline(true); page = await context.newPage(); await page.goto(url); await loaded(page, c, originalCount - 1);
        const names = await probe.evaluate(() => caches.keys());
        assert.ok(names.includes("anagrammi-app-syllable-runtime-v1"));
        assert.ok([smallRuntime(3).manifest.artifact_sha256, smallRuntime(4).manifest.artifact_sha256].includes(
            await probe.evaluate(dictionary => nativeRuntimeTest.read(dictionary), smallRuntime(2).dictionary)));
        assert.deepEqual(names.filter(name => name.startsWith(prefix)).sort(), [prefix + b.inventory.release_id, prefix + c.inventory.release_id].sort());
        for (const name of foreign) assert.ok(names.includes(name));
        await clickVocabolario(page, "#usa-personale");
        await page.waitForFunction(() => Number(document.querySelector("#conteggio").textContent.replace(/\D/g, "")) === 4);
        await search(page, "casa", "casa");
        assert.deepEqual(errors, []);
        const runtimeManifest = JSON.parse(await readFile(path.join(root, "web/data/runtime-sillabe.manifest.json")));
        const binaries = requests.filter(name => name.endsWith(".bin"));
        if (runtimeManifest.disponibile) {
            assert.ok(binaries.length > 0);
            assert.ok(binaries.every(name => name.endsWith("/" + runtimeManifest.artifact)));
        } else assert.equal(binaries.length, 0);
        await context.setOffline(false);
        const unavailable = await browser.newContext();
        const unavailableErrors = [];
        await unavailable.route("**/service-worker.js", route => route.abort());
        const onlineOnly = await unavailable.newPage();
        onlineOnly.on("pageerror", error => unavailableErrors.push(error.message));
        await onlineOnly.goto(url); await loaded(onlineOnly, c, originalCount - 1);
        await search(onlineOnly, "casa", "casa");
        assert.deepEqual(unavailableErrors, []);
        await unavailable.close();
        console.log("PASS browser: first immutable load, SW, offline reload/new navigation, personal persistence/export,");
        console.log("PASS browser: failed B preserves A, complete B waits, B/C activate naturally, GC/foreign isolation, no mixed assets, SW failure nonblocking");
    } finally {
        await browser.close(); await new Promise(resolve => server.close(resolve));
    }
}

try {
    const before = await inventory(dist);
    if (process.argv.includes("--rebuild")) {
        console.log(ps(`& ${quote(path.join(root, "web/build.ps1"))}`));
        assert.deepEqual(await inventory(dist), before);
        console.log("PASS two full builds: identical inventory/release_id");
    }
    const a = await snapshot("A");
    // Extract the packaging part from the build AST, excluding ONLY native compilation.
    const packageScript = path.join(root, "web/build.package-test.ps1");
    ps(`$tokens=$null; $errors=$null; $ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(path.join(root, "web/build.ps1"))},[ref]$tokens,[ref]$errors); if($errors.Count){throw $errors}; $compilerTry=$ast.Find({param($n) $n -is [System.Management.Automation.Language.TryStatementAst] -and $n.Extent.Text.Contains('& $cCompiler')},$true); if(-not $compilerTry){throw 'Compiler AST missing'}; $text=$ast.Extent.Text.Remove($compilerTry.Extent.StartOffset,$compilerTry.Extent.EndOffset-$compilerTry.Extent.StartOffset); [IO.File]::WriteAllText(${quote(packageScript)},$text,[Text.UTF8Encoding]::new($false))`);
    const end = originalDictionary.at(-1) === 10 ? originalDictionary.length - 1 : originalDictionary.length;
    const lastLine = originalDictionary.lastIndexOf(10, end - 1) + 1;
    await writeFile(path.join(root, "VocabolarioItaliano.txt"), originalDictionary.subarray(0, lastLine));
    ps(`& ${quote(packageScript)}`);
    const b = await snapshot("B");
    assert.notEqual(a.inventory.release_id, b.inventory.release_id);
    await writeFile(path.join(root, "web/style.css"), Buffer.concat([originalCss, Buffer.from("\n/* PWA test release C */\n")]));
    ps(`& ${quote(packageScript)}`);
    const c = await snapshot("C");
    assert.notEqual(b.inventory.release_id, c.inventory.release_id);
    ps(`& ${quote(packageScript)}`);
    await readFile(path.join(dist, "releases", b.inventory.release_id, "app.js"));
    console.log("PASS inventory, immutable URLs, critical changes produce new ids, repeated build retains previous release");
    await unitTests(a, b, c);
    await browserTests(a, b, c);
} finally {
    await writeFile(path.join(root, "VocabolarioItaliano.txt"), originalDictionary);
    await writeFile(path.join(root, "web/style.css"), originalCss);
    const packageScript = path.join(root, "web/build.package-test.ps1");
    if (await readFile(packageScript).catch(() => null)) ps(`& ${quote(packageScript)}`);
}
