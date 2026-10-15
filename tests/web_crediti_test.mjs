// node tests/web_crediti_test.mjs <root> <playwright-module> [external-output-directory]
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verificaCrediti, documentiCrediti, testoArca, origineArca } from "./crediti_test.mjs";
import { verificaBlocchiStoria, paperPdf } from "./storia_test.mjs";

const root = path.resolve(process.argv[2]);
const out = process.argv[4] ? path.resolve(process.argv[4]) : await mkdtemp(path.join(os.tmpdir(), "arca-credits-"));
const relative = path.relative(root, out);
assert(relative && (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)), "Output fuori dal repository");
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(process.argv[3]));
const dist = path.join(root, "dist");
const report = { ...await verificaCrediti(root), errors: [], checks: [] };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
    ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".pdf": "application/pdf" };
const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url, "http://localhost");
        assert(url.pathname.startsWith("/arca/"));
        const file = path.resolve(dist, decodeURIComponent(url.pathname.slice(6)) || "index.html");
        assert(file.startsWith(dist + path.sep));
        response.setHeader("Content-Type", path.basename(file) === "LICENSE" ? "text/plain; charset=utf-8" :
            types[path.extname(file)] ?? "application/octet-stream");
        response.setHeader("Cache-Control", "no-store");
        response.end(await readFile(file));
    } catch (error) { report.errors.push("HTTP: " + error.message); response.writeHead(404).end(); }
});
let browser;
try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/arca/`;
    report.url = url;
    browser = await chromium.launch({ executablePath: process.env.PWA_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    report.browser = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    let offline = false;
    page.on("pageerror", error => report.errors.push(error.message));
    page.on("console", message => {
        if (message.type() === "error" && !(offline && /net::ERR_INTERNET_DISCONNECTED/.test(message.text()))) report.errors.push(message.text());
    });
    page.on("response", response => { if (response.status() >= 400) report.errors.push(response.status() + ": " + response.url()); });
    // Nessun test o navigazione dipende da servizi esterni.
    await context.route("**/*", route => {
        // Risorsa locale del visualizzatore PDF integrato di Chrome, non una richiesta di rete.
        if (route.request().url() === "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/pdf_embedder.css") return route.continue();
        if (new URL(route.request().url()).origin !== new URL(url).origin) {
            report.errors.push("Richiesta esterna inattesa: " + route.request().url());
            return route.abort();
        }
        return route.continue();
    });
    const ready = () => page.waitForFunction(() => document.querySelector("#stato-sillabe").textContent.includes("Filtro sillabico disponibile"), null, { timeout: 120000 });
    await page.goto(url); await ready();
    await page.evaluate(async () => {
        const worker = (await navigator.serviceWorker.ready).active;
        if (worker.state !== "activated") await new Promise(resolve => {
            worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); });
        });
    });
    await page.reload(); await ready();
    assert(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
    const releaseBase = new URL(`releases/${report.release}/`, url).href;
    async function documents() {
        const result = await page.evaluate(async urls => {
            const rows = [];
            for (const url of urls) {
                const response = await fetch(url);
                rows.push({ status: response.status, body: Array.from(new Uint8Array(await response.arrayBuffer())) });
            }
            return rows;
        }, documentiCrediti.map(file => releaseBase + file));
        for (const [index, item] of result.entries()) {
            assert.equal(item.status, 200);
            assert.equal(hash(Buffer.from(item.body)), hash(await readFile(path.join(root, documentiCrediti[index]))));
        }
    }
    await documents();
    async function papers() {
        const result = await page.evaluate(async urls => {
            const rows = [];
            for (const url of urls) {
                const response = await fetch(url);
                rows.push({ status: response.status, type: response.headers.get("Content-Type"),
                    body: Array.from(new Uint8Array(await response.arrayBuffer())) });
            }
            return rows;
        }, paperPdf.map(file => releaseBase + file));
        for (const [index, item] of result.entries()) {
            assert.equal(item.status, 200);
            assert.equal(item.type, "application/pdf");
            assert.equal(hash(Buffer.from(item.body)), hash(await readFile(path.join(root, "web", paperPdf[index]))));
        }
    }
    await papers();
    const cached = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(request => request.url), "anagrammi-app-release-" + report.release);
    for (const file of documentiCrediti) assert(cached.includes(releaseBase + file));
    for (const file of paperPdf) assert(cached.includes(releaseBase + file));
    assert(!cached.some(url => /\/papers\/.*\.(tex|png)$/.test(url)));
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : width === 320 ? 740 : 844 });
        if (width !== 1440 && await page.locator("#menu-navigazione").getAttribute("aria-expanded") !== "true") await page.locator("#menu-navigazione").click();
        await page.locator('[data-dialog="crediti"]').click();
        assert.equal(await page.locator("#crediti section").count(), 4);
        assert.equal((await page.locator("#crediti section").first().locator("p").first().innerText()).replace(/\s+/g, " "), testoArca);
        assert.equal(await page.locator("#crediti-arca").innerText(), "ARCA");
        assert.equal(await page.locator("#crediti section").first().locator("a").first().getAttribute("href"), origineArca);
        const localLinks = await page.locator('#crediti a[href^="./"]').evaluateAll(elements => elements.map(element => element.href));
        assert.equal(localLinks.length, 5);
        assert.match(await page.locator("#crediti-software + p").innerText(), /GNU GPL versione 3 o successiva \(GPL-3\.0-or-later\)/);
        assert.doesNotMatch(await page.locator("#crediti").innerText(), /provvisori[ao]|in attesa di conferma|GPL-3\.0-only/i);
        assert.equal(await page.locator('#crediti a[href$="/LICENSE"]').getAttribute("href"), `./releases/${report.release}/LICENSE`);
        assert(localLinks.every(link => link.startsWith(releaseBase)));
        assert(await page.locator("#crediti").evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth &&
            dialog.getBoundingClientRect().left >= 0 && dialog.getBoundingClientRect().right <= innerWidth &&
            dialog.getBoundingClientRect().height <= innerHeight));
        await page.screenshot({ path: path.join(out, `crediti-${width}.png`) });
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector("#crediti").open &&
            document.activeElement === document.querySelector('[data-dialog="crediti"]'));
        assert.equal(await page.locator("#navigazione").isVisible(), true);
        assert.equal(await page.locator("#menu-navigazione").getAttribute("aria-expanded"), String(width !== 1440));
        await page.locator('[data-dialog="crediti"]').click();
        await page.locator('#crediti button').click();
        assert.equal(await page.locator("#crediti").isVisible(), false);
        await page.waitForFunction(() => document.activeElement === document.querySelector('[data-dialog="crediti"]'));
        await page.locator('[data-dialog="storia"]').click();
        const story = page.locator("#storia");
        verificaBlocchiStoria(await story.locator("h2, p, h3, li").allTextContents());
        assert(await story.evaluate(dialog => {
            const box = dialog.getBoundingClientRect();
            return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
                dialog.scrollWidth <= dialog.clientWidth && dialog.scrollHeight > dialog.clientHeight &&
                document.documentElement.scrollWidth <= innerWidth;
        }));
        await story.evaluate(dialog => { dialog.scrollTop = 0; });
        await page.screenshot({ path: path.join(out, `storia-${width}.png`) });
        await story.locator(".paper-storia").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, `storia-paper-${width}.png`) });
        const links = story.locator("a");
        assert.equal(await links.count(), 2);
        for (let index = 0; index < paperPdf.length; index++) {
            const link = links.nth(index);
            assert.equal(await link.getAttribute("href"), `./releases/${report.release}/${paperPdf[index]}`);
            assert.equal(await link.getAttribute("target"), "_blank");
            assert.equal(await link.getAttribute("rel"), "noopener");
            const popupPromise = page.waitForEvent("popup");
            await link.click();
            const popup = await popupPromise;
            await popup.waitForURL(releaseBase + paperPdf[index]);
            assert.equal(await popup.evaluate(() => window.opener === null), true);
            await popup.close();
        }
        await story.locator("button").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, `storia-fine-${width}.png`) });
        await page.keyboard.press("Escape");
        assert.equal(await story.isVisible(), false);
        await page.waitForFunction(() => document.activeElement === document.querySelector('[data-dialog="storia"]'));
        assert.equal(await page.locator("#navigazione").isVisible(), true);
        assert.equal(await page.locator("#menu-navigazione").getAttribute("aria-expanded"), String(width !== 1440));
        report.checks.push(`Storia e Crediti: Escape restituisce il focus al trigger esatto; menu visibile a ${width}x${width === 1440 ? 1000 : width === 320 ? 740 : 844}; Crediti verificato anche con pulsante Chiudi`);
        if (width === 320) {
            await page.locator('[data-dialog="storia"]').click();
            await story.locator("button").click();
            await page.waitForFunction(() => !document.querySelector("#storia").open &&
                document.activeElement === document.querySelector('[data-dialog="storia"]'));
        }
    }
    report.checks.push("Attribuzioni invariate; GPL-3.0-or-later definitiva e LICENSE; Storia integrale approvata; layout/scroll/focus 1440/390/320; PDF cliccabili in nuove schede senza opener; 13 documenti e 2 PDF HTTP 200, byte originali e precache");
    await context.setOffline(true); offline = true;
    await page.reload(); await ready(); await documents(); await papers();
    assert.match(await page.locator("#stato-sillabe").innerText(), /offline/);
    // La navigazione diretta ai documenti usa la shell anche senza rete.
    const documentPage = await context.newPage();
    for (const file of documentiCrediti) {
        const response = await documentPage.goto(releaseBase + file);
        assert.equal(response.status(), 200);
        assert.equal(response.fromServiceWorker(), true);
        assert.equal(hash(await response.body()), hash(await readFile(path.join(root, file))));
    }
    await documentPage.close();
    report.checks.push("Offline reale: fetch dei due PDF, fetch e navigazione dei 13 documenti incluso LICENSE dalla shell; runtime separato ancora disponibile offline");
    assert.deepEqual(report.errors, []);
    report.result = "PASS";
    await writeFile(path.join(out, "crediti-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
