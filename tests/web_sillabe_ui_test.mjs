// node --experimental-vm-modules tests/web_sillabe_ui_test.mjs <module.mjs> <copy-root> <playwright-module>
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Include la suite runtime e usa le sue fixture BITMAP-V1, mai artifact reali.
const { dictionary, binary, available } = await import("./web_runtime_sillabe_test.mjs");
const root = path.resolve(process.argv[3]);
const dist = path.join(root, "dist");
const { chromium } = await import(pathToFileURL(process.argv[4]));
let plan = { manifest: available };
const errors = [];
const requests = [];
const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url, "http://localhost");
        requests.push(url.pathname);
        response.setHeader("Cache-Control", "no-store");
        if (url.pathname.endsWith("/data/VocabolarioItaliano.txt")) {
            response.setHeader("Content-Type", "text/plain; charset=utf-8");
            response.end(dictionary); return;
        }
        if (url.pathname === "/anagrammi/data/runtime-sillabe.manifest.json") {
            const current = plan;
            current.entered = true;
            if (current.wait) await current.wait;
            response.setHeader("Content-Type", "application/json");
            response.statusCode = current.fail ? 503 : 200;
            response.end(JSON.stringify(current.manifest)); return;
        }
        if (url.pathname === `/anagrammi/data/${available.artifact}`) {
            response.setHeader("Content-Type", "application/octet-stream");
            response.end(binary); return;
        }
        if (!url.pathname.startsWith("/anagrammi/")) { response.writeHead(404).end(); return; }
        const relative = decodeURIComponent(url.pathname.slice("/anagrammi/".length)) || "index.html";
        const file = path.resolve(dist, relative);
        if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
        const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm",
            ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
            ".png": "image/png", ".ico": "image/x-icon" };
        response.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
        response.end(await readFile(file));
    } catch (error) {
        if (error.code !== "ENOENT") errors.push(error.message);
        response.writeHead(404).end();
    }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/anagrammi/`;
const browser = await chromium.launch({
    executablePath: process.env.PWA_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
});
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
async function status(text) {
    await page.waitForFunction(expected => document.querySelector("#stato-sillabe").textContent === expected, text);
}
async function rows() { return page.locator(".testo-risultato").allTextContents(); }
async function clickVocabolario(selector) {
    if (!await page.locator(".gestione-vocabolario").evaluate(element => element.open)) {
        await page.locator(".gestione-vocabolario summary").click();
    }
    await page.locator(selector).click();
}
async function search(command) {
    await page.locator("#comando").fill(command);
    await page.locator("#comando").press("Enter");
}
async function selected(mode, min, max) {
    await page.locator("#modalita-sillabe").selectOption(mode);
    await page.locator("#minimo-sillabe").fill(min);
    if (mode === "TRA") await page.locator("#massimo-sillabe").fill(max);
}
async function persisted() {
    await page.waitForFunction(async () => {
        const cache = await caches.open("anagrammi-app-syllable-runtime-v1");
        return Boolean(await cache.match(new URL("./data/.anagrammi-approved-runtime-v1", document.baseURI)));
    });
}
async function noOverflow() {
    const violations = await page.evaluate(() => {
        const app = document.querySelector("#app");
        return [document.documentElement.scrollWidth > innerWidth,
            ...[...app.querySelectorAll(".filtro-sillabe input, .filtro-sillabe select, .filtro-sillabe label, #stato-sillabe")]
                .filter(node => node.getClientRects().length)
                .map(node => node.getBoundingClientRect().right > innerWidth)];
    });
    assert.ok(violations.every(value => !value), "Nessun overflow dei controlli desktop/mobile");
}
try {
    let release;
    plan = { manifest: available, wait: new Promise(resolve => { release = resolve; }) };
    await page.goto(url);
    await status("Caricamento dati sillabici...");
    assert.equal(await page.locator("#filtra-sillabe").isDisabled(), true);
    await search("roma");
    assert.deepEqual(await rows(), ["roma", "amor", "roma", "ramo"]);
    release(); await status("Filtro sillabico disponibile");
    assert.equal(await page.locator("#filtra-sillabe").isChecked(), false);
    await persisted();
    // Label e tastiera reali, non eventi sintetici del mock DOM.
    await page.getByLabel("Filtra per sillabe").focus();
    await page.keyboard.press("Space");
    assert.equal(await page.locator("#campi-sillabe").isVisible(), true);
    assert.equal(await page.getByLabel("Modalit\u00e0", { exact: true }).isEnabled(), true);
    for (const [mode, min, max, expected] of [
        ["ESATTAMENTE", "2", "2", ["nota", "amor", "citta", "citt\u00e0"]],
        ["ALMENO", "4", "4", ["roma", "roma", "ramo"]],
        ["AL_MASSIMO", "3", "3", ["nota", "roma", "amor", "citta", "citt\u00e0"]],
        ["TRA", "3", "4", ["roma", "ramo"]],
    ]) {
        await selected(mode, min, max);
        await search("*");
        assert.deepEqual(await rows(), expected, mode);
        assert.equal(await page.locator("#massimo-sillabe").isVisible(), mode === "TRA");
    }
    await selected("ESATTAMENTE", "2", "2");
    for (const value of ["", "0", "-1", "1.5", "4294967296"]) {
        await page.locator("#minimo-sillabe").fill(value);
        await search("*");
        assert.equal(await page.locator("#errore-sillabe").textContent(), "Inserisci un numero intero da 1 a 4294967295.");
        assert.equal(await page.locator("#minimo-sillabe").getAttribute("aria-invalid"), "true");
        assert.equal(await page.locator("#minimo-sillabe").getAttribute("aria-describedby"), "errore-sillabe");
        assert.equal(await page.locator("#minimo-sillabe").evaluate(node => node === document.activeElement), true);
    }
    await selected("TRA", "4", "3"); await search("*");
    assert.equal(await page.locator("#errore-sillabe").textContent(), "Il massimo deve essere maggiore o uguale al minimo.");
    await selected("ESATTAMENTE", "4294967295", "3"); await search("*");
    assert.deepEqual(await rows(), []);
    await selected("ALMENO", "1", "1");
    for (const command of ["roma", "romax 4", "r?ma", "r*", "*ma", "*o*", "r?*", "?*m?", "&amor", "!roma", "$amor", "^,1,4"]) {
        await search(command);
        assert.ok((await rows()).length > 0, command);
    }
    for (const command of ["+ nuova", "- roma"]) {
        await search(command);
        assert.match(await page.locator("#risultato").textContent(), /\+ \/ - non sono ammesse/);
        assert.equal(await page.locator("#conteggio").textContent(), "8 parole");
    }
    await selected("TRA", "3", "4"); await search("*");
    await mkdir(path.join(root, ".ui-sillabe-screenshots"), { recursive: true });
    await noOverflow();
    await page.screenshot({ path: path.join(root, ".ui-sillabe-screenshots/desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow();
    await page.screenshot({ path: path.join(root, ".ui-sillabe-screenshots/mobile.png") });
    await page.setViewportSize({ width: 320, height: 740 });
    await selected("TRA", "4294967295", "4294967295"); await noOverflow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload(); await status("Filtro sillabico disponibile");
    assert.equal(await page.locator("#filtra-sillabe").isChecked(), false, "Reload non ripristina il filtro");
    await page.locator("#filtra-sillabe").check();
    await clickVocabolario("#crea-personale");
    await page.waitForFunction(() => document.querySelector("#vocabolario-attivo").dataset.modalita === "personale");
    await status("Filtro sillabico disponibile");
    assert.equal(await page.locator("#filtra-sillabe").isDisabled(), false);
    await page.locator("#filtra-sillabe").check();
    await selected("TRA", "3", "5"); await search("r?ma");
    assert.deepEqual(await rows(), ["roma", "roma"]);
    // La rimozione da icona ripristina il contesto dello snapshot, non i controlli cambiati dopo.
    for (const mode of ["ESATTAMENTE", "ALMENO", "AL_MASSIMO", "TRA", null]) {
        await page.locator("#filtra-sillabe").setChecked(mode !== null);
        if (mode) await selected(mode, "2", "3");
        await search("*");
        const before = await rows();
        const fields = await page.evaluate(() => ["modalita-sillabe", "minimo-sillabe", "massimo-sillabe"]
            .map(id => document.getElementById(id).value));
        await page.locator("#filtra-sillabe").setChecked(mode === null);
        if (mode === null) await selected("TRA", "7", "8");
        await page.getByRole("button", { name: "Rimuovi nota dal vocabolario personale", exact: true }).click();
        await page.locator("#conferma-eliminazione").click();
        await page.waitForFunction(() => document.querySelector("#conteggio").textContent === "7 parole" &&
            document.querySelector(".footer-risultati"));
        assert.deepEqual(await rows(), before.filter(word => word !== "nota"), mode ?? "senza filtro");
        assert.equal(await page.locator("#filtra-sillabe").isChecked(), mode !== null);
        assert.deepEqual(await page.evaluate(() => ["modalita-sillabe", "minimo-sillabe", "massimo-sillabe"]
            .map(id => document.getElementById(id).value)), fields);
        await page.locator("#filtra-sillabe").uncheck(); await search("+ nota");
        await page.waitForFunction(() => document.querySelector("#conteggio").textContent === "8 parole");
    }
    await page.locator("#filtra-sillabe").uncheck();
    await search("+ nuova");
    await page.waitForFunction(() => document.querySelector("#risultato").textContent.includes("aggiunta"));
    assert.equal(await page.locator("#conteggio").textContent(), "9 parole");
    const download = page.waitForEvent("download");
    await clickVocabolario("#esporta-personale");
    const exported = await readFile(await (await download).path(), "utf8");
    assert.ok(exported.includes("nuova\n"));
    await page.reload(); await status("Filtro sillabico disponibile");
    await clickVocabolario("#usa-personale");
    await page.waitForFunction(() => document.querySelector("#vocabolario-attivo").dataset.modalita === "personale");
    await search("nuova"); assert.deepEqual(await rows(), ["nuova"]);
    let resume;
    plan = { manifest: available, wait: new Promise(resolve => { resume = resolve; }) };
    await clickVocabolario("#usa-originale");
    await status("Caricamento dati sillabici...");
    assert.equal(await page.locator("#filtra-sillabe").isDisabled(), true);
    resume(); await status("Filtro sillabico disponibile");
    assert.equal(await page.locator("#filtra-sillabe").isChecked(), false);
    await page.locator("#filtra-sillabe").check();
    await persisted();
    plan = { fail: true, manifest: available };
    await page.reload(); await status("Filtro sillabico disponibile offline");
    await page.locator("#filtra-sillabe").check();
    await selected("TRA", "3", "4"); await search("*");
    assert.deepEqual(await rows(), ["roma", "ramo"]);
    plan = { manifest: { ...available, schema: 8 } };
    await page.reload(); await status("Errore caricamento dati sillabici");
    assert.equal(await page.locator("#filtra-sillabe").isDisabled(), true);
    await search("roma"); assert.deepEqual(await rows(), ["roma", "amor", "roma", "ramo"]);
    plan = { manifest: { schema: 1, disponibile: false } };
    await page.reload(); await status("Filtro sillabico non disponibile");
    assert.equal(await page.locator("#filtra-sillabe").isDisabled(), true);
    await search("roma"); assert.deepEqual(await rows(), ["roma", "amor", "roma", "ramo"]);
    page.on("dialog", dialog => dialog.accept());
    await page.locator("#file-vocabolario").setInputFiles({ name: "personale.txt", mimeType: "text/plain",
        buffer: Buffer.from("roma\nnota\namor\n") });
    await page.waitForFunction(() => document.querySelector("#vocabolario-attivo").dataset.modalita === "personale");
    assert.equal(await page.locator("#filtra-sillabe").isDisabled(), false);
    await search("*"); assert.equal((await rows()).length, 3);
    await page.reload(); await status("Filtro sillabico non disponibile");
    await clickVocabolario("#usa-personale");
    await page.waitForFunction(() => document.querySelector("#vocabolario-attivo").dataset.modalita === "personale");
    await search("*"); assert.equal((await rows()).length, 3);
    const finalDownload = page.waitForEvent("download");
    await clickVocabolario("#esporta-personale");
    const importedExport = await readFile(await (await finalDownload).path(), "utf8");
    assert.equal(importedExport.split("\n").filter(Boolean).length, 3);
    assert.ok(requests.some(value => value.endsWith(available.artifact)));
    assert.deepEqual(errors, []);
    console.log("PASS Chrome UI reale/WASM sintetico: stati runtime, tastiera/label/errori, 4 criteri e sintassi, +/- senza mutazioni, reload/offline/personale/import-export, layout desktop/mobile");
} finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
