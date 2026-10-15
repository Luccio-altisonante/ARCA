// node --experimental-vm-modules tests/web_paginazione_ui_test.mjs <module.mjs> <copy-root> [playwright-module]
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { application, ricercaUI, righeUI, available } from "./web_runtime_sillabe_test.mjs";

const root = path.resolve(process.argv[3]);
const encode = words => new TextEncoder().encode(words.join("\n") + "\n");
const words = n => Array.from({ length: n }, (_, i) => `voce${i}`);
const methodCalls = (app, name) => app.calls.filter(call => call.name === name);
const click = (app, selector) => app.elements.get(selector).onclick?.();
const pager = app => app.elements.get("#paginazione");
const summary = app => app.run("ultimoRisultato");
let groups = 0;

async function test(name, action) {
    await action();
    groups++;
    console.log(`PASS UI paginata: ${name}`);
}

await test("0/1/99/100/101, piu' pagine, estremi, avanti/indietro", async () => {
    for (const n of [0, 1, 99, 100, 101, 305]) {
        const expected = words(Math.max(1, n));
        const app = await application({ dictionary: encode(expected) });
        try {
            await app.settle();
            await ricercaUI(app, n ? "*" : "zzzz");
            assert.equal(summary(app).haSnapshot, true); assert.equal(summary(app).totale, n);
            assert.equal("righe" in summary(app), false);
            assert.equal("paroleVocabolario" in summary(app), false);
            assert.equal(pager(app).hidden, n <= 100);
            assert.deepEqual(righeUI(app), expected.slice(0, n ? 100 : 0));
            assert.equal(app.elements.get("#pagina-precedente").disabled, true);
            if (n > 100) {
                click(app, "#pagina-successiva");
                assert.deepEqual(righeUI(app), expected.slice(100, 200));
                click(app, "#pagina-precedente");
                assert.deepEqual(righeUI(app), expected.slice(0, 100));
                app.run("renderizzaRisultato(999999)");
                assert.deepEqual(righeUI(app), expected.slice(Math.floor((n - 1) / 100) * 100));
                assert.equal(app.elements.get("#pagina-successiva").disabled, true);
                const reads = app.pages.length;
                click(app, "#pagina-successiva"); assert.equal(app.pages.length, reads);
            }
            app.run("renderizzaRisultato(-99)");
            assert.equal(app.run("paginaCorrente"), 0);
            const reads = app.pages.length;
            click(app, "#pagina-precedente"); assert.equal(app.pages.length, reads);
            for (const page of app.pages) {
                assert.equal(page.args[2], 100);
                assert(page.args[1] >= 0 && (n ? page.args[1] < n : page.args[1] === 0));
                assert(page.sizes.every(size => size <= 100));
                assert.equal(page.deleted, 2);
            }
            assert.equal(methodCalls(app, "avvia_comando_paginato").length, 1);
            assert.equal(methodCalls(app, "esegui_comando").length, 0);
        } finally { await app.close(); }
    }
});

await test("nuovo comando dalla pagina 3, callback vecchie e fallimento dopo snapshot", async () => {
    const app = await application({ dictionary: encode(words(305)) });
    try {
        await app.settle(); await ricercaUI(app, "*");
        click(app, "#pagina-successiva"); click(app, "#pagina-successiva");
        assert.equal(app.run("paginaCorrente"), 2);
        app.run("globalThis.old = ultimoRisultato");
        const oldNext = app.elements.get("#pagina-successiva").onclick;
        await ricercaUI(app, "voce*");
        assert.equal(app.elements.get("#pagina-successiva").disabled, false);
        const before = app.calls.length;
        oldNext();
        assert.equal(app.run("leggiPaginaRisultato(globalThis.old, 0)"), null);
        app.run("renderizzaRisultato(1, globalThis.old)");
        assert.equal(app.calls.length, before);
        assert.equal(app.run("paginaCorrente"), 0);
        assert.deepEqual(righeUI(app), words(100));
        await ricercaUI(app, "^,100001,4");
        assert.equal(summary(app), null);
        assert.equal(pager(app).hidden, true);
        assert.equal(righeUI(app).length, 0);
        assert.match(app.elements.get("#risultato").children[0].textContent, /Input non valido/);
        const calls = app.calls.length;
        click(app, "#pagina-successiva"); assert.equal(app.calls.length, calls);
    } finally { await app.close(); }
});

await test("non paginabili: vuoto, %, uso ^, sola lettura, + e - personale", async () => {
    const app = await application();
    try {
        await app.settle();
        for (const command of ["", "%,10,20", "^", "+ nuova", "- roma"]) {
            const reads = app.pages.length;
            await ricercaUI(app, command);
            assert.equal(summary(app).haSnapshot, false);
            assert.equal(summary(app).idSnapshot, 0);
            assert.equal(pager(app).hidden, true); assert.equal(app.pages.length, reads);
        }
        await app.run('creaCopiaPersonale("personale", "roma\\n", true)');
        await app.run("usaVocabolarioPersonale()");
        for (const command of ["+ nuova", "- nuova"]) {
            const reads = app.pages.length;
            await ricercaUI(app, command);
            assert.equal(summary(app).haSnapshot, false);
            assert.equal(summary(app).vocabolarioModificato, true);
            assert.equal(app.pages.length, reads);
        }
        assert.equal(app.saved().aggiunte.includes("nuova"), false);
        assert.equal(app.saved().rimosse.includes("nuova"), true);
    } finally { await app.close(); }
});

await test("originale/personale/originale, ID identico e generazioni distinte proteggono read/free", async () => {
    const app = await application({ manifest: available });
    try {
        await app.settle(); await ricercaUI(app, "*");
        app.run("globalThis.old = ultimoRisultato");
        const old = summary(app), oldNext = app.elements.get("#pagina-successiva").onclick;
        await app.run(`creaCopiaPersonale("personale", ${JSON.stringify(words(305).join("\n") + "\n")}, true)`);
        await app.run("usaVocabolarioPersonale()");
        await ricercaUI(app, "*");
        assert.equal(summary(app).idSnapshot, old.idSnapshot);
        assert(summary(app).generazioneMotore > old.generazioneMotore);
        assert.equal(app.elements.get("#pagina-successiva").disabled, false);
        const reads = app.pages.length, frees = methodCalls(app, "libera_risultato").length;
        const current = summary(app), currentRows = righeUI(app);
        assert.equal(app.run("leggiPaginaRisultato(globalThis.old, 0)"), null);
        app.run("abbandonaRisultato(globalThis.old)");
        app.run("renderizzaRisultato(0, globalThis.old)"); oldNext();
        assert.equal(app.pages.length, reads);
        assert.equal(methodCalls(app, "libera_risultato").length, frees);
        assert.equal(summary(app), current); assert.deepEqual(righeUI(app), currentRows);
        app.run("renderizzaRisultato(0)"); assert.deepEqual(righeUI(app), currentRows);
        const generation = current.generazioneMotore;
        await app.run("usaVocabolarioOriginale()"); await app.settle();
        await ricercaUI(app, "*");
        assert(summary(app).generazioneMotore > generation);
        assert.equal(summary(app).idSnapshot, old.idSnapshot);
        assert.equal(app.elements.get("#filtra-sillabe").disabled, false);
    } finally { await app.close(); }
});

await test("Unicode, residui, grafia sorgente, duplicati e azioni di rimozione", async () => {
    const app = await application({ dictionary: encode(["roma", "roma   [-yx]", "roma", "citt\u00e0", "andr\u00f2", "p\u00e9sca"]) });
    try {
        await app.settle();
        for (const [command, expected] of [["citt?", ["citt\u00e0"]], ["andr?", ["andr\u00f2"]],
            ["p?sca", ["p\u00e9sca"]], ["*\u00e9sca", ["p\u00e9sca"]]]) {
            await ricercaUI(app, command); assert.deepEqual(righeUI(app), expected);
        }
        await app.run('creaCopiaPersonale("personale", "roma\\nroma   [-yx]\\nroma\\n", true)');
        await app.run("usaVocabolarioPersonale()"); await ricercaUI(app, "romayx 4");
        assert.deepEqual(righeUI(app), ["roma   [-yx]", "roma   [-yx]"]);
        const row = app.elements.get("#risultato").children[0];
        assert.match(row.children[1].attributes["aria-label"], /^Rimuovi roma dal/);
        const obsoleteRemove = row.children[1].listeners.click;
        await ricercaUI(app, "*"); obsoleteRemove();
        assert.equal(app.run("parolaDaRimuovere"), "");
        await ricercaUI(app, "romayx 4");
        app.elements.get("#risultato").children[0].children[1].listeners.click();
        assert.equal(app.run("parolaDaRimuovere"), "roma");
        await app.run("rimuoviParolaConfermata()");
        assert.equal(summary(app).tipo, "ricerca");
        assert.equal(app.saved().rimosse.includes("roma"), true);
        assert.equal(app.run('motore.esporta_vocabolario_testo().includes("roma   [-yx]")'), true);
    } finally { await app.close(); }
});

await test("rimozione filtrata dall'ultima pagina: contesto conservato e pagina ridotta", async () => {
    const app = await application({ dictionary: encode(words(101)) });
    try {
        await app.settle();
        await app.run(`creaCopiaPersonale("personale", ${JSON.stringify(words(101).join("\n") + "\n")}, true)`);
        await app.run("usaVocabolarioPersonale()");
        await app.run("filtraSillabe.checked = true; modalitaSillabe.value = 'ESATTAMENTE'; minimoSillabe.value = '2'; aggiornaFiltroSillabe()");
        await ricercaUI(app, "*");
        assert.equal(summary(app).totale, 101);
        click(app, "#pagina-successiva");
        assert.equal(app.run("paginaCorrente"), 1);
        const word = righeUI(app)[0];
        app.elements.get("#risultato").children[0].children[1].listeners.click();
        await app.run("rimuoviParolaConfermata()");
        assert.equal(summary(app).totale, 100);
        assert.equal(app.run("paginaCorrente"), 0);
        assert.equal(pager(app).hidden, true);
        assert.equal(app.elements.get("#filtra-sillabe").checked, true);
        assert.equal(app.elements.get("#modalita-sillabe").value, "ESATTAMENTE");
        assert.equal(app.elements.get("#minimo-sillabe").value, "2");
        assert(!righeUI(app).includes(word));
        assert.equal(methodCalls(app, "avvia_comando_paginato_con_filtro_sillabe").length, 2);
    } finally { await app.close(); }
});

await test("^: pagine stabili, 100000 risultati, solo 100 righe per lettura", async () => {
    const app = await application({ dictionary: encode(["roma", "amor", "ramo", "roma"]) });
    try {
        await app.settle(); await ricercaUI(app, "^,100000,4");
        assert.equal(summary(app).totale, 100000);
        const first = righeUI(app);
        click(app, "#pagina-successiva"); click(app, "#pagina-precedente");
        assert.deepEqual(righeUI(app), first);
        app.run("renderizzaRisultato(999)"); assert.equal(righeUI(app).length, 100);
        assert.equal(methodCalls(app, "avvia_comando_paginato").length, 1);
        assert.equal(methodCalls(app, "esegui_comando").length, 0);
        assert(app.pages.every(page => page.gets === 200 && page.sizes.every(size => size === 100) && page.deleted === 2));
    } finally { await app.close(); }
});

await test("errori pagina/conversione: entrambi gli handle liberati, snapshot e pager abbandonati", async () => {
    for (const stage of ["lettura", "conversione"]) {
        let fail = false;
        const app = await application({ dictionary: encode(words(305)),
            beforeCall(call) {
                if (fail && stage === "lettura" && call.name === "leggi_pagina_risultato") throw new Error("Lettura simulata");
            },
            afterCall(call, result) {
                if (fail && stage === "conversione" && call.name === "leggi_pagina_risultato") {
                    result.parole_vocabolario.get = () => { throw new Error("Conversione simulata"); };
                }
            },
        });
        try {
            await app.settle(); await ricercaUI(app, "*");
            fail = true; click(app, "#pagina-successiva");
            assert.equal(summary(app), null); assert.equal(pager(app).hidden, true);
            assert.equal(righeUI(app).length, 0);
            assert.match(app.elements.get("#risultato").children[0].textContent, /Errore durante la lettura/);
            assert(app.pages.every(page => page.deleted === 2));
            if (stage === "conversione") assert.equal(app.pages.at(-1).gets, 101);
            fail = false; await ricercaUI(app, "*"); assert.equal(righeUI(app).length, 100);
        } finally { await app.close(); }
    }
});

await test("558124 reali attraverso UI: uno start, tre pagine, zero API completa", async () => {
    const bytes = new Uint8Array(await readFile(path.join(root, "VocabolarioItaliano.txt")));
    const app = await application({ dictionary: bytes });
    try {
        await app.settle();
        const start = performance.now(); await ricercaUI(app, "*");
        const rendered = performance.now() - start;
        assert.equal(summary(app).totale, 558124); assert.equal(righeUI(app).length, 100);
        const first = righeUI(app);
        click(app, "#pagina-successiva"); assert.equal(righeUI(app).length, 100);
        click(app, "#pagina-precedente"); assert.deepEqual(righeUI(app), first);
        assert.equal(methodCalls(app, "avvia_comando_paginato").length, 1);
        assert.equal(methodCalls(app, "esegui_comando").length, 0);
        assert.equal(app.pages.length, 3);
        assert(app.pages.every(page => page.gets === 200 && page.deleted === 2 && page.sizes.every(size => size === 100)));
        console.log(JSON.stringify({ ui_vm_sanity_ms: {
            snapshot: methodCalls(app, "avvia_comando_paginato")[0].milliseconds,
            prima_pagina: methodCalls(app, "leggi_pagina_risultato")[0].milliseconds,
            comando_e_render_dom_simulato: rendered,
            righe_trasferite_per_pagina: 100, grafie_trasferite_per_pagina: 100,
        } }));
    } finally { await app.close(); }
});

console.log(`PASS: ${groups} gruppi UI paginata, oltre alla suite runtime importata`);

if (process.argv[4]) {
    const { chromium } = await import(pathToFileURL(process.argv[4]));
    const dist = path.join(root, "dist");
    const errors = [];
    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url, "http://localhost");
            const relative = decodeURIComponent(url.pathname.slice(1)) || "index.html";
            const file = path.resolve(dist, relative);
            if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
            let bytes = await readFile(file);
            if (relative.endsWith("/anagrammi.js")) {
                const source = bytes.toString("utf8");
                assert(source.includes("export default createAnagrammiModule"));
                // Instrument only the served test module, never production files.
                bytes = source.replace("export default createAnagrammiModule", `export default async function(options) {
                    const module = await createAnagrammiModule(options);
                    window.__pagination = {calls:[], gets:0, deleted:0};
                    for (const name of ['avvia_comando_paginato','avvia_comando_paginato_con_filtro_sillabe','leggi_pagina_risultato','esegui_comando']) {
                        const original = module.MotoreAnagrammi.prototype[name];
                        module.MotoreAnagrammi.prototype[name] = function(...args) {
                            const start = performance.now();
                            const raw = original.apply(this, args);
                            window.__pagination.calls.push({name,args,ms:performance.now()-start,
                                sizes: name === 'leggi_pagina_risultato' ? [raw.righe.size(),raw.parole_vocabolario.size()] : []});
                            return raw;
                        };
                    }
                    for (const name of ['get','delete']) {
                        const original = module.StringVector.prototype[name];
                        module.StringVector.prototype[name] = function(...args) {
                            window.__pagination[name === 'get' ? 'gets' : 'deleted']++;
                            return original.apply(this,args);
                        };
                    }
                    return module;
                }`);
            }
            const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm",
                ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
                ".png": "image/png", ".ico": "image/x-icon" };
            response.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
            response.end(bytes);
        } catch (error) {
            if (error.code !== "ENOENT") errors.push(error.message);
            response.writeHead(404).end();
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.PWA_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
            const context = await browser.newContext({ viewport, serviceWorkers: "block" });
            const page = await context.newPage();
            page.on("pageerror", error => errors.push(error.message));
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            await page.waitForFunction(() => !document.querySelector("#esegui").disabled);
            await page.evaluate(() => {
                const form = document.querySelector("#modulo-ricerca");
                let start;
                form.addEventListener("submit", () => { start = performance.now(); }, true);
                form.addEventListener("submit", () => { window.__renderMs = performance.now() - start; });
            });
            await page.locator("#comando").fill("*"); await page.locator("#comando").press("Enter");
            await page.waitForFunction(() => document.querySelectorAll(".testo-risultato").length === 100);
            const first = await page.locator(".testo-risultato").allTextContents();
            const metrics = await page.evaluate(() => ({ ...window.__pagination, renderMs: window.__renderMs }));
            assert.equal(metrics.calls.filter(call => call.name === "avvia_comando_paginato").length, 1);
            assert.equal(metrics.calls.filter(call => call.name === "esegui_comando").length, 0);
            assert.equal(metrics.gets, 200); assert.equal(metrics.deleted, 2);
            assert.deepEqual(metrics.calls.find(call => call.name === "leggi_pagina_risultato").sizes, [100, 100]);
            await page.locator("#pagina-successiva").click();
            await page.locator("#pagina-precedente").click();
            assert.deepEqual(await page.locator(".testo-risultato").allTextContents(), first);
            const after = await page.evaluate(() => window.__pagination);
            assert.equal(after.calls.filter(call => call.name === "avvia_comando_paginato").length, 1);
            assert.equal(after.calls.filter(call => call.name === "leggi_pagina_risultato").length, 3);
            assert.equal(after.gets, 600); assert.equal(after.deleted, 6);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            const bounds = await page.locator("#stato-pagina").evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth }));
            assert(bounds.scroll <= bounds.width);
            const screenshots = path.join(root, ".pagination-screenshots");
            await mkdir(screenshots, { recursive: true });
            await page.screenshot({ path: path.join(screenshots, `${viewport.width}.png`), fullPage: true });
            console.log(JSON.stringify({ chrome_ui_sanity: {
                viewport, snapshot_ms: metrics.calls.find(call => call.name === "avvia_comando_paginato").ms,
                pagina_ms: metrics.calls.find(call => call.name === "leggi_pagina_risultato").ms,
                comando_conversione_render_ms: metrics.renderMs, righe: 100, grafie: 100,
            } }));
            await context.close();
        }
        assert.deepEqual(errors, []);
        console.log("PASS Chrome desktop/mobile: UI reale, vocabolario ufficiale, solo 100+100, avanti/indietro, layout e screenshot");
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
